/**
 * 텍스처 칠하기 모드의 붓질: 오브젝트 위를 끌면 칠하고, 빈 곳을 끌면 원래대로 화면을 돌린다.
 * 붓 크기는 화면 픽셀 기준이라 확대해도 같은 크기로 보인다 (조각 붓과 같다).
 */
import * as THREE from "three";
import type { PaintSettings } from "../mesh/texturePaint";
import type { ModelerScene } from "../scene/ModelerScene";

interface Host {
  canvas: HTMLCanvasElement;
  camera: () => THREE.PerspectiveCamera | THREE.OrthographicCamera;
  model: ModelerScene;
  setOrbit: (enabled: boolean) => void;
  scene: THREE.Scene;
  /** 스포이트로 색을 찍었을 때 */
  onPick: (color: string) => void;
}

export class PaintTool {
  private settings: PaintSettings | null = null;
  private id: string | null = null;
  private raycaster = new THREE.Raycaster();
  private cursor: THREE.LineLoop;
  private stroke: { last: THREE.Vector3; radius: number; erase: boolean } | null = null;

  constructor(private host: Host) {
    const pts = Array.from({ length: 48 }, (_, i) => new THREE.Vector3(Math.cos((i / 48) * Math.PI * 2), Math.sin((i / 48) * Math.PI * 2), 0));
    this.cursor = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false }),
    );
    this.cursor.renderOrder = 999;
    this.cursor.visible = false;
    host.scene.add(this.cursor);
    const parent = host.canvas.parentElement!;
    parent.addEventListener("pointerdown", this.onDown, { capture: true });
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
  }

  get active() {
    return !!this.settings;
  }

  set(id: string | null, settings: PaintSettings | null) {
    this.settings = id ? settings : null;
    this.id = id;
    if (!this.settings) this.cursor.visible = false;
    else (this.cursor.material as THREE.LineBasicMaterial).color.set(settings!.brush === "erase" ? 0x7fb2ff : settings!.brush === "pick" ? 0xffd166 : 0xffffff);
  }

  private mesh() {
    return this.host.model.getMesh(this.id);
  }

  private hit(e: PointerEvent) {
    const mesh = this.mesh();
    if (!mesh || !mesh.visible) return null;
    const rect = this.host.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.host.camera());
    return this.raycaster.intersectObject(mesh, false)[0] ?? null;
  }

  private worldRadius(point: THREE.Vector3) {
    const cam = this.host.camera();
    const h = this.host.canvas.clientHeight || 1;
    const px = this.settings!.radius;
    if (cam instanceof THREE.OrthographicCamera) return ((cam.top - cam.bottom) / cam.zoom / h) * px;
    const dist = cam.position.distanceTo(point);
    return ((2 * dist * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / h) * px;
  }

  private showCursor(hit: THREE.Intersection | null) {
    if (!hit || !hit.face) {
      this.cursor.visible = false;
      return;
    }
    const r = this.settings!.brush === "pick" ? this.worldRadius(hit.point) * 0.25 : this.worldRadius(hit.point);
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    this.cursor.position.copy(hit.point).addScaledVector(n, r * 0.02);
    this.cursor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    this.cursor.scale.setScalar(r);
    this.cursor.visible = true;
  }

  private onDown = (e: PointerEvent) => {
    if (!this.settings || e.button !== 0 || e.altKey) return;
    const hit = this.hit(e);
    if (!hit) return; // 빈 곳은 화면 돌리기
    e.stopPropagation();
    const paint = this.host.model.ensurePaint(this.id);
    if (!paint) return;
    if (this.settings.brush === "pick") {
      if (hit.uv) this.host.onPick(paint.pick(hit.uv.x, hit.uv.y));
      return;
    }
    this.host.setOrbit(false);
    paint.begin();
    // Ctrl 을 누르고 칠하면 잠깐 지우개
    this.stroke = { last: hit.point.clone(), radius: this.worldRadius(hit.point), erase: this.settings.brush === "erase" || e.ctrlKey };
    this.dab(hit);
    this.showCursor(hit);
  };

  private dab(hit: THREE.Intersection, point = hit.point) {
    const mesh = this.mesh()!;
    const paint = this.host.model.getPaint(this.id);
    if (!paint || !hit.face) return;
    const s = this.settings!;
    const st = this.stroke!;
    const local = mesh.worldToLocal(point.clone());
    const scale = mesh.getWorldScale(new THREE.Vector3());
    const radius = st.radius / Math.max(1e-6, (Math.abs(scale.x) + Math.abs(scale.y) + Math.abs(scale.z)) / 3);
    const color = st.erase ? (mesh.userData.color as string) : s.color;
    paint.dab(mesh.geometry, local, radius, hit.face.normal, color, s.strength, s.hardness);
    if (s.symmetry) {
      const mirrored = local.clone();
      mirrored.x = -mirrored.x;
      const n = hit.face.normal.clone();
      n.x = -n.x;
      paint.dab(mesh.geometry, mirrored, radius, n, color, s.strength, s.hardness);
    }
  }

  private onMove = (e: PointerEvent) => {
    if (!this.settings) return;
    const st = this.stroke;
    if (e.target !== this.host.canvas && !st) {
      this.cursor.visible = false;
      return;
    }
    const hit = this.hit(e);
    this.showCursor(hit);
    if (!st || !hit) return;
    // 붓 반지름의 1/4 마다 한 번씩 찍어서 빠르게 움직여도 끊기지 않게
    const step = st.radius * 0.25;
    const dist = st.last.distanceTo(hit.point);
    if (dist < step) return;
    const n = Math.min(16, Math.floor(dist / step));
    for (let i = 1; i <= n; i++) this.dab(hit, st.last.clone().lerp(hit.point, i / n));
    st.last.copy(hit.point);
  };

  private onUp = () => {
    if (!this.stroke) return;
    this.stroke = null;
    this.host.setOrbit(true);
    if (this.id) this.host.model.paintStrokeEnded(this.id);
  };

  dispose() {
    this.host.canvas.parentElement?.removeEventListener("pointerdown", this.onDown, { capture: true });
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    this.cursor.geometry.dispose();
    (this.cursor.material as THREE.Material).dispose();
    this.host.scene.remove(this.cursor);
  }
}
