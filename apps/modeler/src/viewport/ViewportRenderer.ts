import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { cloneMesh, edgeKey, meshEdges, type PolyMesh, type Vec3 } from "../mesh/PolyMesh";
import { emptySelection, selectedVertices, type EditSelection } from "../mesh/selection";
import type { ModelerScene } from "../scene/ModelerScene";
import type { ParticleSystem } from "../effects/particles";
import { EditOverlay } from "./EditOverlay";
import { ModalTransform, type ModalKind, type ModalOptions } from "./ModalTransform";
import { NavGizmo, type ViewName } from "./NavGizmo";
import { applyShading, type Shading } from "./shading";

export type ToolId = "select" | "move" | "rotate" | "scale";
export type { ViewName } from "./NavGizmo";

const VIEW_DIRECTIONS: Record<ViewName, [number, number, number]> = {
  front: [0, 0, 1],
  back: [0, 0, -1],
  right: [1, 0, 0],
  left: [-1, 0, 0],
  top: [0, 1, 0.0001],
  bottom: [0, -1, 0.0001],
};

const HOME_POSITION = new THREE.Vector3(5, 4, 6);

/** three.js 로 3D 화면을 그리고 마우스 조작(돌려보기, 선택, 변형)을 처리한다. */
export class ViewportRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private perspective = new THREE.PerspectiveCamera(45, 1, 0.05, 1000);
  /** 평면 보기 (숫자패드 5). 멀리 있어도 크기가 같아 보여서 치수를 맞추기 좋다. */
  private orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, -500, 1000);
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = this.perspective;
  private renderPass: RenderPass;
  private modal: ModalTransform;
  private gizmo: NavGizmo;
  private readout: HTMLDivElement;
  private tool: ToolId = "move";
  private snap = false;
  private shading: Shading = "solid";
  /** 마지막으로 본 마우스 위치 (캔버스 기준). G/R/S 를 누를 때 여기서 시작한다. */
  private pointer = { x: 0, y: 0, inside: false };
  private orbit: OrbitControls;
  private transform: TransformControls;
  private selectionBox = new THREE.BoxHelper(new THREE.Object3D(), 0xffc83d);
  private raycaster = new THREE.Raycaster();
  private pointerDown: { x: number; y: number } | null = null;

  // 편집 모드
  private overlay: EditOverlay | null = null;
  private overlayVersion = -1;
  /** 고른 점들의 가운데에 놓는 손잡이. 기즈모를 여기에 붙여서 점들을 함께 움직인다. */
  private pivot = new THREE.Object3D();
  /** 크기 도구로 끌 때 움직이지 않을 점 (오브젝트 기준 좌표와 처음 월드 위치) */
  private scaleAnchor: { local: THREE.Vector3; world: THREE.Vector3 } | null = null;
  private editDrag: {
    pivotStartInverse: THREE.Matrix4;
    meshWorldInverse: THREE.Matrix4;
    startPoly: PolyMesh;
    startWorld: Map<number, THREE.Vector3>;
  } | null = null;
  private resizeObserver: ResizeObserver;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private unsubscribe: () => void;
  private frame = 0;

  constructor(
    private container: HTMLElement,
    private model: ModelerScene,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    // 아주 밝은 빛도 하얗게 뭉개지지 않고 색이 남도록
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // 빛 번짐: 아주 밝은 부분(빛나는 오브젝트, 불꽃)만 주변으로 번진다.
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.35, 1.4);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.scene.background = new THREE.Color(0x232838);
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
      if (e.value) {
        this.beginEditDrag();
        this.beginScaleAnchor();
      } else {
        this.editDrag = null;
        this.scaleAnchor = null;
        // 다 끌었으면 실행 취소 기록에 남긴다.
        model.commit();
      }
    });
    this.transform.addEventListener("objectChange", () => {
      if (this.editDrag) {
        this.updateEditDrag();
      } else {
        this.applyScaleAnchor();
        this.selectionBox.update();
        model.touch();
      }
    });
    this.scene.add(this.pivot);
    this.scene.add(this.transform.getHelper());

    this.selectionBox.visible = false;
    this.scene.add(this.selectionBox);

    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerleave", () => (this.pointer.inside = false));

    this.readout = document.createElement("div");
    this.readout.className = "modal-readout";
    this.readout.hidden = true;
    container.appendChild(this.readout);

    this.modal = new ModalTransform({
      camera: () => this.camera,
      canvas,
      scene: this.scene,
      pointer: () => (this.pointer.inside ? this.pointer : { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }),
      snapEnabled: () => this.snap,
      changed: (target, poly) => {
        if (target.type === "vertices" && poly) {
          this.model.setEditingPoly(poly);
          this.overlay?.update(poly, this.model.getEditSelection());
        } else {
          this.selectionBox.update();
        }
        model.touch();
      },
      finished: (confirmed) => {
        this.orbit.enabled = true;
        this.setTool(this.tool);
        if (confirmed) this.modalConfirm?.();
        this.modalConfirm = null;
      },
      readout: (text) => {
        this.readout.hidden = text === null;
        this.readout.textContent = text ?? "";
      },
    });

    this.gizmo = new NavGizmo(
      container,
      (view) => this.setView(view),
      (dx, dy) => this.orbitBy(dx, dy),
    );

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.unsubscribe = model.subscribe(() => this.syncSelection());
    this.syncSelection();

    let last = performance.now();
    const loop = () => {
      this.frame = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      this.orbit.update();
      this.gizmo.update(this.camera);
      applyShading(this.model.allMeshes(), this.shading);
      this.updateParticles(dt);
      this.composer.render(dt);
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

    // 금속과 유리가 비칠 수 있도록 방 안 같은 주변 빛을 깐다.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.45;
    pmrem.dispose();

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(5, 10, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    // 면에 줄무늬 그림자(섀도 애크니)가 생기지 않게
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -10;
    sun.shadow.camera.right = sun.shadow.camera.top = 10;
    this.scene.add(sun);
  }

  setTool(tool: ToolId) {
    this.tool = tool;
    if (this.modal?.active) return;
    if (tool === "select") {
      this.transform.enabled = false;
      this.transform.getHelper().visible = false;
    } else {
      this.transform.enabled = true;
      this.transform.getHelper().visible = true;
      this.transform.setMode(tool === "move" ? "translate" : tool);
    }
  }

  /** 격자에 맞춰 움직이기: 이동 0.25, 회전 15도, 크기 0.25 단위 */
  setSnap(enabled: boolean) {
    this.snap = enabled;
    this.transform.setTranslationSnap(enabled ? 0.25 : null);
    this.transform.setRotationSnap(enabled ? THREE.MathUtils.degToRad(15) : null);
    this.transform.setScaleSnap(enabled ? 0.25 : null);
  }

  setBloom(enabled: boolean) {
    this.bloom.enabled = enabled;
  }

  setShading(shading: Shading) {
    this.shading = shading;
  }

  /** 처음 시점으로 돌아가기. 길을 잃은 초보자를 위한 버튼. */
  resetView() {
    this.camera.position.copy(HOME_POSITION);
    this.orbit.target.set(0, 0.5, 0);
    this.fitOrthographic();
  }

  /** 앞, 뒤, 옆, 위, 아래에서 똑바로 보기. 지금 보던 거리는 그대로 둔다. */
  setView(view: ViewName) {
    const distance = this.camera.position.distanceTo(this.orbit.target);
    this.camera.position.copy(this.orbit.target).addScaledVector(new THREE.Vector3(...VIEW_DIRECTIONS[view]).normalize(), distance);
    this.camera.lookAt(this.orbit.target);
  }

  /** 숫자패드 4/6/8/2: 15도씩 돌려 보기 */
  orbitStep(horizontal: number, vertical: number) {
    const step = THREE.MathUtils.degToRad(15);
    const offset = this.camera.position.clone().sub(this.orbit.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta += horizontal * step;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi - vertical * step, 0.001, Math.PI - 0.001);
    this.camera.position.copy(this.orbit.target).add(new THREE.Vector3().setFromSpherical(spherical));
    this.camera.lookAt(this.orbit.target);
  }

  private orbitBy(dx: number, dy: number) {
    const offset = this.camera.position.clone().sub(this.orbit.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta -= dx * 0.012;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi - dy * 0.012, 0.001, Math.PI - 0.001);
    this.camera.position.copy(this.orbit.target).add(new THREE.Vector3().setFromSpherical(spherical));
    this.camera.lookAt(this.orbit.target);
  }

  isOrthographic() {
    return this.camera === this.orthographic;
  }

  /** 숫자패드 5: 원근 보기와 평면 보기를 바꾼다. 화면에 보이는 크기는 그대로 둔다. */
  toggleOrthographic(): boolean {
    const from = this.camera;
    if (from === this.perspective) {
      this.orthographic.position.copy(from.position);
      this.orthographic.quaternion.copy(from.quaternion);
      this.useCamera(this.orthographic);
      this.fitOrthographic();
    } else {
      // 평면 보기에서 휠로 확대한 만큼 원근 카메라를 가까이 둔다.
      const dir = from.position.clone().sub(this.orbit.target);
      dir.setLength(dir.length() / this.orthographic.zoom);
      this.perspective.position.copy(this.orbit.target).add(dir);
      this.perspective.quaternion.copy(from.quaternion);
      this.useCamera(this.perspective);
    }
    return this.isOrthographic();
  }

  private useCamera(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera) {
    this.camera = camera;
    this.orbit.object = camera;
    this.transform.camera = camera;
    this.renderPass.camera = camera;
    this.resize();
    this.orbit.update();
  }

  /** 평면 보기의 화면 크기를 지금 거리에서 원근 보기와 같아 보이게 맞춘다. */
  private fitOrthographic() {
    if (this.camera !== this.orthographic) return;
    const distance = this.camera.position.distanceTo(this.orbit.target);
    const half = distance * Math.tan(THREE.MathUtils.degToRad(this.perspective.fov / 2));
    const aspect = this.perspective.aspect;
    Object.assign(this.orthographic, { left: -half * aspect, right: half * aspect, top: half, bottom: -half, zoom: 1 });
    this.orthographic.updateProjectionMatrix();
  }

  // ---------- 모달 변형 (G, R, S) ----------

  private modalConfirm: (() => void) | null = null;

  /**
   * G/R/S: 손잡이 없이 마우스로 바로 옮기고, 돌리고, 늘린다. 편집 모드면 고른 점들을, 아니면 고른 오브젝트를 움직인다.
   * 움직일 것이 없으면 false.
   */
  startModal(kind: ModalKind, options: ModalOptions = {}): boolean {
    const edit = this.model.getSnapshot().edit;
    let target: Parameters<ModalTransform["begin"]>[1];
    if (edit) {
      const mesh = this.model.editingMesh();
      const poly = this.model.editingPoly();
      const vertices = poly ? selectedVertices(poly, this.model.getEditSelection()) : new Set<number>();
      if (!mesh || !poly || vertices.size === 0) return false;
      target = { type: "vertices", mesh, poly, vertices };
    } else {
      const mesh = this.model.getMesh(this.model.getSnapshot().selectedId);
      if (!mesh || !mesh.visible) return false;
      target = { type: "object", object: mesh };
    }
    this.orbit.enabled = false;
    this.transform.enabled = false;
    this.transform.getHelper().visible = false;
    this.modalConfirm = options.onConfirm ?? (() => this.model.commit());
    this.modal.begin(kind, target, { ...options, onConfirm: undefined });
    return true;
  }

  modalActive() {
    return this.modal.active;
  }

  /** 모달 변형 중에 누른 키. 처리했으면 true. */
  modalKey(e: KeyboardEvent) {
    return this.modal.key(e);
  }

  modalKeyUp(e: KeyboardEvent) {
    this.modal.keyUp(e);
  }

  /** 선택한 오브젝트가 화면 가운데 오도록 맞추기. 아무것도 안 골랐으면 장면 전체를 맞춘다. */
  frameSelected() {
    const mesh = this.model.getMesh(this.model.getSnapshot().selectedId);
    const targets = mesh ? [mesh] : this.model.allMeshes().filter((m) => m.userData.kind !== "effect" && m.visible);
    if (targets.length === 0) return this.resetView();
    const box = new THREE.Box3();
    targets.forEach((m) => box.expandByObject(m));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const dir = this.camera.position.clone().sub(this.orbit.target).normalize();
    this.orbit.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(dir, Math.max(sphere.radius * (mesh ? 3.5 : 2.4), 1.5));
    this.fitOrthographic();
  }

  private syncSelection() {
    const snapshot = this.model.getSnapshot();
    if (snapshot.edit) return this.syncEditMode();
    this.disposeOverlay();

    const mesh = this.model.getMesh(snapshot.selectedId);
    if (mesh) {
      this.selectionBox.setFromObject(mesh);
      this.selectionBox.visible = true;
      if (this.transform.object !== mesh) this.transform.attach(mesh);
    } else {
      this.selectionBox.visible = false;
      this.transform.detach();
    }
  }

  /**
   * 크기 도구로 한쪽 손잡이를 끌면 반대쪽 면은 제자리에 있고 끈 쪽만 늘어나게 한다.
   * (기본 동작은 가운데를 기준으로 양쪽이 같이 늘어나서 초보자가 헷갈린다.)
   * 가운데 흰 상자(전체 크기)를 끌면 바닥에 붙은 채로 커진다.
   */
  private beginScaleAnchor() {
    const mesh = this.transform.object;
    const axis = this.transform.axis;
    if (this.editDrag || this.transform.mode !== "scale" || !(mesh instanceof THREE.Mesh) || !axis) return;

    const box = mesh.geometry.boundingBox ?? (mesh.geometry.computeBoundingBox(), mesh.geometry.boundingBox!);
    const local = box.getCenter(new THREE.Vector3());
    // 잡은 곳이 축의 어느 쪽인지 (오브젝트 기준 방향으로 바꿔서 본다)
    // pointStart 는 three.js 가 실제로 갖고 있지만 타입 정의에는 빠져 있다.
    const pointStart = (this.transform as unknown as { pointStart: THREE.Vector3 }).pointStart;
    const grabbed = pointStart.clone().applyQuaternion(mesh.getWorldQuaternion(new THREE.Quaternion()).invert());

    if (axis === "XYZ") {
      local.y = box.min.y;
    } else {
      for (const a of ["x", "y", "z"] as const) {
        if (!axis.includes(a.toUpperCase())) continue;
        local[a] = grabbed[a] >= 0 ? box.min[a] : box.max[a];
      }
    }
    mesh.updateMatrixWorld(true);
    this.scaleAnchor = { local, world: mesh.localToWorld(local.clone()) };
  }

  private applyScaleAnchor() {
    const mesh = this.transform.object;
    if (!this.scaleAnchor || !mesh) return;
    mesh.updateMatrixWorld(true);
    const now = mesh.localToWorld(this.scaleAnchor.local.clone());
    const shift = this.scaleAnchor.world.clone().sub(now);
    // 오브젝트들은 원점에 있는 그룹 안에 있어서 월드 이동량을 그대로 더하면 된다.
    mesh.position.add(shift);
    mesh.updateMatrixWorld(true);
  }

  // ---------- 편집 모드 ----------

  private syncEditMode() {
    const mesh = this.model.editingMesh()!;
    const poly = this.model.editingPoly()!;
    const edit = this.model.getSnapshot().edit!;
    this.selectionBox.visible = false;

    if (!this.overlay) this.overlay = new EditOverlay();
    if (this.overlay.group.parent !== mesh) mesh.add(this.overlay.group);
    if (this.overlayVersion !== edit.version) {
      this.overlay.update(poly, this.model.getEditSelection());
      this.overlayVersion = edit.version;
    }

    if (this.editDrag) return;
    if (edit.center) {
      this.pivot.position.fromArray(edit.center).applyMatrix4(mesh.matrixWorld);
      this.pivot.rotation.set(0, 0, 0);
      this.pivot.scale.set(1, 1, 1);
      this.pivot.updateMatrixWorld(true);
      if (this.transform.object !== this.pivot) this.transform.attach(this.pivot);
    } else {
      this.transform.detach();
    }
  }

  private disposeOverlay() {
    this.overlay?.dispose();
    this.overlay = null;
    this.overlayVersion = -1;
    if (this.transform.object === this.pivot) this.transform.detach();
  }

  private beginEditDrag() {
    const mesh = this.model.editingMesh();
    const poly = this.model.editingPoly();
    if (!mesh || !poly || this.transform.object !== this.pivot) return;
    mesh.updateMatrixWorld(true);
    this.pivot.updateMatrixWorld(true);
    const startWorld = new Map<number, THREE.Vector3>();
    selectedVertices(poly, this.model.getEditSelection()).forEach((v) =>
      startWorld.set(v, new THREE.Vector3(...poly.vertices[v]).applyMatrix4(mesh.matrixWorld)),
    );
    this.editDrag = {
      pivotStartInverse: this.pivot.matrixWorld.clone().invert(),
      meshWorldInverse: mesh.matrixWorld.clone().invert(),
      startPoly: poly,
      startWorld,
    };
  }

  /** 손잡이가 움직인 만큼 고른 점들을 똑같이 옮기고, 돌리고, 늘린다. */
  private updateEditDrag() {
    const drag = this.editDrag!;
    this.pivot.updateMatrixWorld(true);
    const delta = this.pivot.matrixWorld.clone().multiply(drag.pivotStartInverse);
    const next = cloneMesh(drag.startPoly);
    drag.startWorld.forEach((world, v) => {
      const local = world.clone().applyMatrix4(delta).applyMatrix4(drag.meshWorldInverse);
      next.vertices[v] = [local.x, local.y, local.z];
    });
    this.model.setEditingPoly(next);
    this.overlay?.update(next, this.model.getEditSelection());
  }

  /** 편집 모드에서 클릭한 곳의 점, 선, 면을 찾는다. Shift 를 누르면 더하거나 뺀다. */
  private pickEdit(e: PointerEvent) {
    const mesh = this.model.editingMesh();
    const poly = this.model.editingPoly();
    if (!mesh || !poly) return;
    const current = this.model.getEditSelection();
    const rect = this.renderer.domElement.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    mesh.updateMatrixWorld(true);

    const toScreen = (p: Vec3) => {
      const world = new THREE.Vector3(...p).applyMatrix4(mesh.matrixWorld);
      const ndc = world.clone().project(this.camera);
      return { world, x: ((ndc.x + 1) / 2) * rect.width, y: ((1 - ndc.y) / 2) * rect.height, behind: ndc.z > 1 };
    };
    // 그 점이 다른 면에 가려져 있는지
    const hidden = (world: THREE.Vector3) => {
      // 평면 보기에서는 모든 시선이 나란하므로 점 바로 앞에서 쏜다.
      const origin = this.isOrthographic()
        ? world.clone().addScaledVector(this.camera.getWorldDirection(new THREE.Vector3()), -100)
        : this.camera.position;
      const dir = world.clone().sub(origin);
      const dist = dir.length();
      this.raycaster.set(origin, dir.normalize());
      const hit = this.raycaster.intersectObject(mesh, false)[0];
      return !!hit && hit.distance < dist - Math.max(1e-3 * dist, 1e-4);
    };

    let picked: { kind: "vertex"; index: number } | { kind: "edge"; key: string } | { kind: "face"; index: number } | null =
      null;

    if (current.mode === "vertex") {
      const candidates = poly.vertices
        .map((v, index) => ({ index, ...toScreen(v) }))
        .map((c) => ({ ...c, d: Math.hypot(c.x - px, c.y - py) }))
        .filter((c) => c.d < 14 && !c.behind)
        .sort((a, b) => a.d - b.d);
      const hit = candidates.find((c) => !hidden(c.world));
      if (hit) picked = { kind: "vertex", index: hit.index };
    } else if (current.mode === "edge") {
      const candidates = meshEdges(poly)
        .map(([a, b]) => {
          const sa = toScreen(poly.vertices[a]);
          const sb = toScreen(poly.vertices[b]);
          const t = segmentT(px, py, sa.x, sa.y, sb.x, sb.y);
          const d = Math.hypot(sa.x + (sb.x - sa.x) * t - px, sa.y + (sb.y - sa.y) * t - py);
          return { key: edgeKey(a, b), d, behind: sa.behind || sb.behind, world: sa.world.clone().lerp(sb.world, t) };
        })
        .filter((c) => c.d < 10 && !c.behind)
        .sort((a, b) => a.d - b.d);
      const hit = candidates.find((c) => !hidden(c.world));
      if (hit) picked = { kind: "edge", key: hit.key };
    } else {
      const ndc = new THREE.Vector2((px / rect.width) * 2 - 1, -(py / rect.height) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
      const hit = this.raycaster.intersectObject(mesh, false)[0];
      if (hit && hit.faceIndex != null) {
        picked = { kind: "face", index: (mesh.geometry.userData.triangleFace as number[])[hit.faceIndex] };
      }
    }

    const next: EditSelection = e.shiftKey
      ? {
          mode: current.mode,
          vertices: new Set(current.vertices),
          edges: new Set(current.edges),
          faces: new Set(current.faces),
        }
      : emptySelection(current.mode);
    if (picked) {
      const toggle = <T,>(set: Set<T>, value: T) => (set.has(value) && e.shiftKey ? set.delete(value) : set.add(value));
      if (picked.kind === "vertex") toggle(next.vertices, picked.index);
      if (picked.kind === "edge") toggle(next.edges, picked.key);
      if (picked.kind === "face") toggle(next.faces, picked.index);
    } else if (e.shiftKey) {
      return;
    }
    this.model.setEditSelection(next);
  }

  private onPointerMove = (e: PointerEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top, inside: true };
  };

  private onPointerDown = (e: PointerEvent) => {
    if (e.button === 0) this.pointerDown = { x: e.clientX, y: e.clientY };
  };

  private onPointerUp = (e: PointerEvent) => {
    const start = this.pointerDown;
    this.pointerDown = null;
    // 드래그(돌려보기)가 아니라 제자리 클릭일 때만 선택한다.
    if (!start || e.button !== 0 || this.transform.dragging) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) return;
    if (this.model.getSnapshot().edit) return this.pickEdit(e);

    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.model.allMeshes().filter((m) => m.visible), false)[0];
    this.model.select(hit ? hit.object.userData.id : null);
  };

  private updateParticles(dt: number) {
    const height = this.renderer.domElement.clientHeight;
    for (const mesh of this.model.allMeshes()) {
      const particles = mesh.userData.particles as ParticleSystem | undefined;
      if (!particles) continue;
      particles.setViewport(height, this.perspective.fov);
      particles.update(dt);
    }
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(window.devicePixelRatio);
    this.composer.setSize(w, h);
    this.perspective.aspect = w / h;
    this.perspective.updateProjectionMatrix();
    if (this.camera === this.orthographic) {
      const half = this.orthographic.top;
      this.orthographic.left = -half * this.perspective.aspect;
      this.orthographic.right = half * this.perspective.aspect;
      this.orthographic.updateProjectionMatrix();
    }
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.modal.cancel();
    this.gizmo.dispose();
    this.readout.remove();
    this.disposeOverlay();
    this.unsubscribe();
    this.resizeObserver.disconnect();
    this.orbit.dispose();
    this.transform.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

/** 점 (px, py) 에서 선분에 가장 가까운 위치 (0~1) */
function segmentT(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  return len === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len));
}
