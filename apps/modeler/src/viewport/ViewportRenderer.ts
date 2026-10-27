import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { ModelerScene } from "../scene/ModelerScene";

export type ToolId = "select" | "move" | "rotate" | "scale";

const HOME_POSITION = new THREE.Vector3(5, 4, 6);

/** three.js 로 3D 화면을 그리고 마우스 조작(돌려보기, 선택, 변형)을 처리한다. */
export class ViewportRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 0.05, 1000);
  private orbit: OrbitControls;
  private transform: TransformControls;
  private selectionBox = new THREE.BoxHelper(new THREE.Object3D(), 0xffa64d);
  private raycaster = new THREE.Raycaster();
  private pointerDown: { x: number; y: number } | null = null;
  private resizeObserver: ResizeObserver;
  private unsubscribe: () => void;
  private frame = 0;

  constructor(
    private container: HTMLElement,
    private model: ModelerScene,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x2b2e33);
    this.setupWorld();
    this.scene.add(model.root);

    this.camera.position.copy(HOME_POSITION);

    // 왼쪽 드래그나 휠 버튼 드래그로 돌려보기, 오른쪽 드래그로 이동, 휠로 확대/축소
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.orbit.enableDamping = true;
    this.orbit.target.set(0, 0.5, 0);

    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.addEventListener("dragging-changed", (e) => {
      this.orbit.enabled = !e.value;
      // 다 끌었으면 실행 취소 기록에 남긴다.
      if (!e.value) model.commit();
    });
    this.transform.addEventListener("objectChange", () => {
      this.selectionBox.update();
      model.touch();
    });
    this.scene.add(this.transform.getHelper());

    this.selectionBox.visible = false;
    this.scene.add(this.selectionBox);

    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerup", this.onPointerUp);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.unsubscribe = model.subscribe(() => this.syncSelection());
    this.syncSelection();

    const loop = () => {
      this.frame = requestAnimationFrame(loop);
      this.orbit.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  private setupWorld() {
    const grid = new THREE.GridHelper(40, 40, 0x5d636c, 0x43474e);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.8;
    // 그림자 받는 바닥과 겹쳐 깜빡이지 않도록 아주 살짝 띄운다.
    grid.position.y = 0.002;
    this.scene.add(grid);

    // 블렌더처럼 빨간 선은 X 축, 파란 선은 Z 축
    const axis = (color: number, to: THREE.Vector3) =>
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([to.clone().multiplyScalar(-20), to.clone().multiplyScalar(20)]),
        new THREE.LineBasicMaterial({ color }),
      );
    const axes = [axis(0xd9534f, new THREE.Vector3(1, 0, 0)), axis(0x4a7fd9, new THREE.Vector3(0, 0, 1))];
    axes.forEach((a) => (a.position.y = 0.004));
    this.scene.add(...axes);

    // 그림자만 보이는 투명 바닥. 깊이를 기록하지 않아야 격자가 가려지지 않는다.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.ShadowMaterial({ opacity: 0.25, depthWrite: false }),
    );
    ground.renderOrder = -1;
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(5, 10, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -10;
    sun.shadow.camera.right = sun.shadow.camera.top = 10;
    this.scene.add(sun);
  }

  setTool(tool: ToolId) {
    if (tool === "select") {
      this.transform.enabled = false;
      this.transform.getHelper().visible = false;
    } else {
      this.transform.enabled = true;
      this.transform.getHelper().visible = true;
      this.transform.setMode(tool === "move" ? "translate" : tool);
    }
  }

  /** 처음 시점으로 돌아가기. 길을 잃은 초보자를 위한 버튼. */
  resetView() {
    this.camera.position.copy(HOME_POSITION);
    this.orbit.target.set(0, 0.5, 0);
  }

  /** 선택한 오브젝트가 화면 가운데 오도록 맞추기 */
  frameSelected() {
    const mesh = this.model.getMesh(this.model.getSnapshot().selectedId);
    if (!mesh) return this.resetView();
    const sphere = new THREE.Box3().setFromObject(mesh).getBoundingSphere(new THREE.Sphere());
    const dir = this.camera.position.clone().sub(this.orbit.target).normalize();
    this.orbit.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(dir, Math.max(sphere.radius * 3.5, 1.5));
  }

  private syncSelection() {
    const mesh = this.model.getMesh(this.model.getSnapshot().selectedId);
    if (mesh) {
      this.selectionBox.setFromObject(mesh);
      this.selectionBox.visible = true;
      if (this.transform.object !== mesh) this.transform.attach(mesh);
    } else {
      this.selectionBox.visible = false;
      this.transform.detach();
    }
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.button === 0) this.pointerDown = { x: e.clientX, y: e.clientY };
  };

  private onPointerUp = (e: PointerEvent) => {
    const start = this.pointerDown;
    this.pointerDown = null;
    // 드래그(돌려보기)가 아니라 제자리 클릭일 때만 선택한다.
    if (!start || e.button !== 0 || this.transform.dragging) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.model.allMeshes(), false)[0];
    this.model.select(hit ? hit.object.userData.id : null);
  };

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.unsubscribe();
    this.resizeObserver.disconnect();
    this.orbit.dispose();
    this.transform.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
