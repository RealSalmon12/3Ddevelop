/**
 * 조각 모드의 붓질: 오브젝트 위를 끌면 붓을 찍고, 빈 곳을 끌면 원래대로 화면을 돌린다.
 * Ctrl: 반대로 (파기), Shift: 잠깐 부드럽게. 붓 크기는 화면 픽셀 기준이라 확대해도 같은 크기로 보인다.
 */
import * as THREE from "three";
import { SculptSession, type SculptSettings } from "../mesh/sculpt";
import type { Vec3 } from "../mesh/PolyMesh";
import type { ModelerScene } from "../scene/ModelerScene";

interface Host {
  canvas: HTMLCanvasElement;
  camera: () => THREE.PerspectiveCamera | THREE.OrthographicCamera;
  model: ModelerScene;
  /** 붓질하는 동안 화면 돌리기를 끈다 */
  setOrbit: (enabled: boolean) => void;
  scene: THREE.Scene;
}

export class SculptTool {
  private settings: SculptSettings | null = null;
  private id: string | null = null;
  private session: SculptSession | null = null;
  private raycaster = new THREE.Raycaster();
  private cursor: THREE.LineLoop;
  private stroke: { last: THREE.Vector3; invert: boolean; smooth: boolean; radius: number; dabs: number; grabPlane?: THREE.Plane; grabFrom?: THREE.Vector3 } | null = null;

  constructor(private host: Host) {
    const pts = Array.from({ length: 48 }, (_, i) => new THREE.Vector3(Math.cos((i / 48) * Math.PI * 2), Math.sin((i / 48) * Math.PI * 2), 0));
    this.cursor = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false }),
    );
    this.cursor.renderOrder = 999;
    this.cursor.visible = false;
    host.scene.add(this.cursor);
    // 화면 돌리기(OrbitControls)보다 먼저 받아야 해서 부모에서 capture 로 듣는다.
    const parent = host.canvas.parentElement!;
    parent.addEventListener("pointerdown", this.onDown, { capture: true });
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
  }

  get active() {
    return !!this.settings;
  }

  get stroking() {
    return !!this.stroke;
  }

  /** null 이면 조각 모드를 끈다 */
  set(id: string | null, settings: SculptSettings | null) {
    this.settings = id ? settings : null;
    if (this.id !== id) {
      this.id = id;
      this.session = null;
    }
    if (!this.settings) this.cursor.visible = false;
  }

  private mesh() {
    return this.host.model.getMesh(this.id);
  }

  /** 되돌리기 등으로 모양이 바뀌었으면 새로 준비한다 */
  private ensureSession() {
    const poly = this.host.model.sculptPoly(this.id);
    if (!poly) return null;
    if (this.session?.poly !== poly) this.session = new SculptSession(poly);
    return this.session;
  }

  private hit(e: PointerEvent) {
    const mesh = this.mesh();
    if (!mesh || !mesh.visible) return null;
    const rect = this.host.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.host.camera());
    return this.raycaster.intersectObject(mesh, false)[0] ?? null;
  }

  /** 화면 픽셀 반지름을 그 깊이의 장면 길이로 */
  private worldRadius(point: THREE.Vector3) {
    const cam = this.host.camera();
    const h = this.host.canvas.clientHeight || 1;
    const px = this.settings!.radius;
    if (cam instanceof THREE.OrthographicCamera) return ((cam.top - cam.bottom) / cam.zoom / h) * px;
    const dist = cam.position.distanceTo(point);
    return ((2 * dist * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / h) * px;
  }

  private toLocal(p: THREE.Vector3): Vec3 {
    const v = this.mesh()!.worldToLocal(p.clone());
    return [v.x, v.y, v.z];
  }

  /** 장면 길이를 오브젝트 기준 길이로 (크기를 바꾼 오브젝트도 붓 크기가 맞게) */
  private localLength(len: number) {
    const s = this.mesh()!.getWorldScale(new THREE.Vector3());
    return len / Math.max(1e-6, (Math.abs(s.x) + Math.abs(s.y) + Math.abs(s.z)) / 3);
  }

  private showCursor(hit: THREE.Intersection | null) {
    if (!hit || !hit.face) {
      this.cursor.visible = false;
      return;
    }
    const r = this.worldRadius(hit.point);
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    this.cursor.position.copy(hit.point).addScaledVector(n, r * 0.02);
    this.cursor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    this.cursor.scale.setScalar(r);
    (this.cursor.material as THREE.LineBasicMaterial).color.set(this.stroke?.invert ? 0x7fb2ff : 0xffffff);
    this.cursor.visible = true;
  }

  private onDown = (e: PointerEvent) => {
    if (!this.settings || e.button !== 0 || e.altKey) return;
    const hit = this.hit(e);
    if (!hit) return; // 빈 곳은 화면 돌리기
    const session = this.ensureSession();
    if (!session) return;
    e.stopPropagation();
    this.host.setOrbit(false);
    const radius = this.worldRadius(hit.point);
    this.stroke = { last: hit.point.clone(), invert: e.ctrlKey, smooth: e.shiftKey, radius, dabs: 0 };
    if (this.settings.brush === "grab" && !e.shiftKey) {
      session.beginGrab(this.toLocal(hit.point), this.localLength(radius), this.settings.symmetry);
      const normal = new THREE.Vector3();
      this.host.camera().getWorldDirection(normal);
      this.stroke.grabPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, hit.point);
      this.stroke.grabFrom = hit.point.clone();
    } else this.dab(hit.point);
    this.showCursor(hit);
  };

  private dab(point: THREE.Vector3) {
    const st = this.stroke!;
    const s = this.settings!;
    const session = this.session!;
    const brush = st.smooth ? "smooth" : s.brush;
    if (session.dab(brush, this.toLocal(point), this.localLength(st.radius), s.strength, st.invert, s.symmetry)) {
      st.dabs++;
      if (st.dabs % 3 === 0) session.updateNormals();
      this.host.model.sculptChanged(this.id!);
    }
  }

  private onMove = (e: PointerEvent) => {
    if (!this.settings) return;
    const st = this.stroke;
    if (st?.grabPlane) {
      // 잡아끌기: 화면과 나란한 평면 위에서 마우스를 따라간다
      const rect = this.host.canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.host.camera());
      const to = this.raycaster.ray.intersectPlane(st.grabPlane, new THREE.Vector3());
      if (!to) return;
      const mesh = this.mesh()!;
      const a = mesh.worldToLocal(st.grabFrom!.clone());
      const b = mesh.worldToLocal(to.clone());
      if (this.session!.dragGrab([b.x - a.x, b.y - a.y, b.z - a.z], this.settings.strength)) this.host.model.sculptChanged(this.id!);
      st.grabFrom = to;
      this.cursor.position.copy(to);
      return;
    }
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
    const n = Math.min(12, Math.floor(dist / step));
    for (let i = 1; i <= n; i++) this.dab(st.last.clone().lerp(hit.point, i / n));
    st.last.copy(hit.point);
  };

  private onUp = () => {
    if (!this.stroke) return;
    this.stroke = null;
    this.session?.endGrab();
    this.session?.updateNormals();
    this.host.setOrbit(true);
    this.host.model.commit();
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
