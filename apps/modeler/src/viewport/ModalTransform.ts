import * as THREE from "three";
import { cloneMesh, type PolyMesh } from "../mesh/PolyMesh";

export type ModalKind = "grab" | "rotate" | "scale";
type AxisName = "x" | "y" | "z";

const AXIS_DIR: Record<AxisName, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};
const AXIS_COLOR: Record<AxisName | "custom", number> = { x: 0xe5646a, y: 0x7ccf5a, z: 0x5b8de8, custom: 0xffc83d };
const KIND_LABEL: Record<ModalKind, string> = { grab: "이동", rotate: "회전", scale: "크기" };

export interface ModalOptions {
  /** 처음부터 이 방향(월드)으로만 움직인다. 돌출할 때 면이 바라보는 쪽. */
  direction?: THREE.Vector3;
  /** 화면 위 안내에 보일 이름 (없으면 이동/회전/크기) */
  label?: string;
  onCancel?: () => void;
  /** 확정할 때 기록을 남기는 방법. 없으면 commit(). */
  onConfirm?: () => void;
}

/** 모달 변형이 움직이는 대상 */
export type ModalTarget =
  | { type: "object"; object: THREE.Object3D }
  | { type: "vertices"; mesh: THREE.Mesh; poly: PolyMesh; vertices: Set<number> };

interface ModalHost {
  camera(): THREE.Camera;
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  /** 마지막으로 본 마우스 위치 (캔버스 기준 픽셀) */
  pointer(): { x: number; y: number };
  snapEnabled(): boolean;
  /** 비례 편집 (블렌더의 O): 고른 점 둘레의 점도 거리에 따라 조금씩 따라온다 */
  proportional(): boolean;
  /** 대상이 바뀐 뒤 화면을 다시 그리라고 알린다. */
  changed(target: ModalTarget, poly?: PolyMesh): void;
  finished(confirmed: boolean): void;
  readout(text: string | null): void;
}

/**
 * 블렌더식 모달 변형: G(이동), R(회전), S(크기)를 누르면 손잡이 없이 마우스를 움직이는 대로 따라온다.
 * X/Y/Z 로 방향을 고정하고, 숫자를 쳐서 정확한 값을 넣고, 클릭이나 Enter 로 확정, 오른쪽 클릭이나 Esc 로 취소한다.
 * Shift 를 누르고 움직이면 천천히, Ctrl 을 누르면 칸에 맞춰 움직인다.
 */
export class ModalTransform {
  private kind: ModalKind = "grab";
  private target: ModalTarget | null = null;
  private options: ModalOptions = {};
  private axis: AxisName | "custom" | null = null;
  private typed = "";
  private ctrl = false;
  /** Shift 로 천천히 움직이는 것까지 반영한 가상의 마우스 위치 */
  private mouse = new THREE.Vector2();
  private startMouse = new THREE.Vector2();
  private lastRaw = new THREE.Vector2();
  private pivot = new THREE.Vector3();
  private start: {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    scale: THREE.Vector3;
    world?: Map<number, THREE.Vector3>;
    meshWorldInverse?: THREE.Matrix4;
  } | null = null;
  private axisLine: THREE.Line | null = null;
  /** 비례 편집 반경 (월드). 휠이나 PageUp/PageDown 으로 바꾼다. */
  private radius = 1;
  /** 비례 편집 때 따라 움직일 점: 처음 월드 위치와 고른 점까지 거리 */
  private falloff: Map<number, { world: THREE.Vector3; dist: number }> | null = null;
  private radiusRing: THREE.LineLoop | null = null;

  constructor(private host: ModalHost) {}

  get active() {
    return this.target !== null;
  }

  begin(kind: ModalKind, target: ModalTarget, options: ModalOptions = {}) {
    if (this.target) this.finish(false);
    this.kind = kind;
    this.target = target;
    this.options = options;
    this.axis = options.direction ? "custom" : null;
    this.typed = "";
    this.ctrl = false;

    const p = this.host.pointer();
    this.mouse.set(p.x, p.y);
    this.startMouse.copy(this.mouse);
    this.lastRaw.copy(this.mouse);

    if (target.type === "object") {
      const o = target.object;
      o.updateMatrixWorld(true);
      this.pivot.setFromMatrixPosition(o.matrixWorld);
      this.start = { position: o.position.clone(), quaternion: o.quaternion.clone(), scale: o.scale.clone() };
    } else {
      const { mesh, poly, vertices } = target;
      mesh.updateMatrixWorld(true);
      const world = new Map<number, THREE.Vector3>();
      this.pivot.set(0, 0, 0);
      vertices.forEach((v) => {
        const w = new THREE.Vector3(...poly.vertices[v]).applyMatrix4(mesh.matrixWorld);
        world.set(v, w);
        this.pivot.add(w);
      });
      this.pivot.divideScalar(Math.max(vertices.size, 1));
      this.falloff = null;
      if (this.host.proportional()) {
        this.falloff = new Map();
        const picked = [...world.values()];
        poly.vertices.forEach((v, i) => {
          if (vertices.has(i)) return;
          const w = new THREE.Vector3(...v).applyMatrix4(mesh.matrixWorld);
          let dist = Infinity;
          for (const p of picked) dist = Math.min(dist, p.distanceTo(w));
          this.falloff!.set(i, { world: w, dist });
        });
      }
      this.start = {
        position: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
        scale: new THREE.Vector3(1, 1, 1),
        world,
        meshWorldInverse: mesh.matrixWorld.clone().invert(),
      };
    }

    // 회전과 크기는 가운데에서 조금 떨어진 곳을 잡아야 각도와 배율이 안정적이다.
    if (kind !== "grab") {
      const c = this.pivotScreen();
      if (this.startMouse.distanceTo(c) < 40) {
        this.startMouse.set(c.x + 80, c.y);
        this.mouse.copy(this.startMouse);
      }
    }

    window.addEventListener("pointermove", this.onMove, true);
    window.addEventListener("pointerdown", this.onDown, true);
    window.addEventListener("contextmenu", this.onContext, true);
    window.addEventListener("wheel", this.onWheel, { capture: true, passive: false });
    this.updateAxisLine();
    this.apply();
  }

  /** 키보드 입력. 처리했으면 true. */
  key(e: KeyboardEvent): boolean {
    if (!this.target) return false;
    const key = e.key.toLowerCase();
    if (e.key === "Control") {
      this.ctrl = true;
    } else if (key === "escape") {
      this.finish(false);
    } else if (key === "enter" || key === " ") {
      this.finish(true);
    } else if (key === "x" || key === "y" || key === "z") {
      this.axis = this.axis === key ? (this.options.direction ? "custom" : null) : key;
      this.updateAxisLine();
    } else if (/^[0-9.]$/.test(e.key)) {
      this.typed += e.key;
    } else if (e.key === "-") {
      this.typed = this.typed.startsWith("-") ? this.typed.slice(1) : `-${this.typed}`;
    } else if (key === "backspace") {
      this.typed = this.typed.slice(0, -1);
    } else if (key === "pageup" || key === "pagedown") {
      this.radius = Math.max(0.05, Math.min(100, this.radius * (key === "pageup" ? 1.15 : 1 / 1.15)));
    } else if (key === "g" || key === "r" || key === "s") {
      // 하는 도중에 다른 변형으로 바꾸기 (블렌더처럼)
      const next = ({ g: "grab", r: "rotate", s: "scale" } as const)[key];
      if (next !== this.kind) {
        this.restore();
        this.kind = next;
        this.typed = "";
        this.startMouse.copy(this.mouse);
        if (next !== "grab" && this.startMouse.distanceTo(this.pivotScreen()) < 40) {
          this.startMouse.set(this.pivotScreen().x + 80, this.pivotScreen().y);
          this.mouse.copy(this.startMouse);
        }
      }
    } else {
      return true;
    }
    if (this.target) this.apply();
    return true;
  }

  keyUp(e: KeyboardEvent) {
    if (e.key === "Control" && this.target) {
      this.ctrl = false;
      this.apply();
    }
  }

  cancel() {
    if (this.target) this.finish(false);
  }

  private onMove = (e: PointerEvent) => {
    const rect = this.host.canvas.getBoundingClientRect();
    const raw = new THREE.Vector2(e.clientX - rect.left, e.clientY - rect.top);
    const step = raw.clone().sub(this.lastRaw).multiplyScalar(e.shiftKey ? 0.1 : 1);
    this.lastRaw.copy(raw);
    this.mouse.add(step);
    this.ctrl = e.ctrlKey;
    this.apply();
  };

  private onDown = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    this.finish(e.button === 0);
  };

  private onContext = (e: Event) => e.preventDefault();

  /** 비례 편집 중이면 휠로 반경을 바꾼다 (화면 확대 대신) */
  private onWheel = (e: WheelEvent) => {
    if (!this.falloff) return;
    e.preventDefault();
    e.stopPropagation();
    this.radius = Math.max(0.05, Math.min(100, this.radius * (e.deltaY < 0 ? 1 / 1.15 : 1.15)));
    this.apply();
  };

  private finish(confirmed: boolean) {
    const options = this.options;
    if (!confirmed) this.restore();
    window.removeEventListener("pointermove", this.onMove, true);
    window.removeEventListener("pointerdown", this.onDown, true);
    window.removeEventListener("wheel", this.onWheel, true);
    this.removeRing();
    this.falloff = null;
    // 오른쪽 클릭으로 취소할 때 뒤따르는 메뉴 이벤트까지 막고 나서 뗀다.
    setTimeout(() => window.removeEventListener("contextmenu", this.onContext, true), 0);
    this.removeAxisLine();
    this.target = null;
    this.start = null;
    this.host.readout(null);
    this.host.finished(confirmed);
    if (confirmed) options.onConfirm?.();
    else options.onCancel?.();
  }

  private restore() {
    const target = this.target;
    const start = this.start;
    if (!target || !start) return;
    if (target.type === "object") {
      target.object.position.copy(start.position);
      target.object.quaternion.copy(start.quaternion);
      target.object.scale.copy(start.scale);
      this.host.changed(target);
    } else {
      this.host.changed(target, target.poly);
    }
  }

  // ---------- 계산 ----------

  private toPixels(world: THREE.Vector3) {
    const rect = this.host.canvas.getBoundingClientRect();
    const ndc = world.clone().project(this.host.camera());
    return new THREE.Vector2(((ndc.x + 1) / 2) * rect.width, ((1 - ndc.y) / 2) * rect.height);
  }

  private pivotScreen() {
    return this.toPixels(this.pivot);
  }

  private rayAt(px: THREE.Vector2) {
    const rect = this.host.canvas.getBoundingClientRect();
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2((px.x / rect.width) * 2 - 1, -(px.y / rect.height) * 2 + 1), this.host.camera());
    return raycaster.ray;
  }

  private axisVector(): THREE.Vector3 | null {
    if (this.axis === "custom") return this.options.direction!.clone().normalize();
    return this.axis ? AXIS_DIR[this.axis].clone() : null;
  }

  private viewDirection() {
    return this.host.camera().getWorldDirection(new THREE.Vector3());
  }

  private typedNumber(): number | null {
    if (!this.typed || this.typed === "-" || this.typed === ".") return null;
    const n = Number(this.typed);
    return Number.isFinite(n) ? n : null;
  }

  /** 지금 상태에서의 이동량 (월드) */
  private grabOffset(): THREE.Vector3 {
    const typed = this.typedNumber();
    const axis = this.axisVector();
    if (typed !== null) return (axis ?? AXIS_DIR.x.clone()).multiplyScalar(typed);

    const r0 = this.rayAt(this.startMouse);
    const r1 = this.rayAt(this.mouse);
    let offset: THREE.Vector3;
    if (axis) {
      // 마우스 광선과 가장 가까운 축 위의 점을 찾아서 그만큼 옮긴다.
      offset = axis.clone().multiplyScalar(closestOnAxis(this.pivot, axis, r1) - closestOnAxis(this.pivot, axis, r0));
    } else {
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(this.viewDirection(), this.pivot);
      const a = r0.intersectPlane(plane, new THREE.Vector3());
      const b = r1.intersectPlane(plane, new THREE.Vector3());
      offset = a && b ? b.sub(a) : new THREE.Vector3();
    }
    if (this.snapping()) {
      const step = 0.25;
      if (axis && this.axis === "custom") {
        const len = Math.round(offset.dot(axis) / step) * step;
        offset = axis.multiplyScalar(len);
      } else {
        offset.set(Math.round(offset.x / step) * step, Math.round(offset.y / step) * step, Math.round(offset.z / step) * step);
      }
    }
    return offset;
  }

  /** 회전축과 각도 (라디안) */
  private rotation(): { axis: THREE.Vector3; angle: number } {
    const view = this.viewDirection();
    const axis = this.axisVector() ?? view.clone().negate();
    // 축이 화면 안쪽을 향하면 각도를 뒤집어서, 화면에서 마우스를 돌린 방향과 물체가 도는 방향이 같게 한다.
    const sign = axis.dot(view) > 0 ? -1 : 1;

    const typed = this.typedNumber();
    if (typed !== null) return { axis, angle: THREE.MathUtils.degToRad(typed) };

    const c = this.pivotScreen();
    const a0 = Math.atan2(-(this.startMouse.y - c.y), this.startMouse.x - c.x);
    const a1 = Math.atan2(-(this.mouse.y - c.y), this.mouse.x - c.x);
    let angle = (a1 - a0) * sign;
    angle = Math.atan2(Math.sin(angle), Math.cos(angle));
    if (this.snapping()) {
      const step = THREE.MathUtils.degToRad(15);
      angle = Math.round(angle / step) * step;
    }
    return { axis, angle };
  }

  private scaleFactor(): number {
    const typed = this.typedNumber();
    if (typed !== null) return typed;
    const c = this.pivotScreen();
    const d0 = Math.max(this.startMouse.distanceTo(c), 1);
    let f = this.mouse.distanceTo(c) / d0;
    if (this.snapping()) f = Math.round(f * 10) / 10;
    return f;
  }

  private snapping() {
    return this.host.snapEnabled() !== this.ctrl;
  }

  private apply() {
    const target = this.target;
    const start = this.start;
    if (!target || !start) return;

    // 월드 기준으로 가운데(pivot)를 중심 삼아 움직이는 행렬
    const delta = new THREE.Matrix4();
    let text = "";
    const axisLabel = this.axis === "custom" ? " · 면 방향" : this.axis ? ` · ${this.axis.toUpperCase()}축` : "";

    if (this.kind === "grab") {
      const offset = this.grabOffset();
      delta.makeTranslation(offset.x, offset.y, offset.z);
      text = `X ${fmt(offset.x)}  Y ${fmt(offset.y)}  Z ${fmt(offset.z)}`;
    } else if (this.kind === "rotate") {
      const { axis, angle } = this.rotation();
      const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);
      delta.compose(new THREE.Vector3(), q, new THREE.Vector3(1, 1, 1));
      text = `${fmt(THREE.MathUtils.radToDeg(angle), 1)}°`;
    } else {
      const f = this.scaleFactor();
      const axis = this.axisVector();
      const s = axis
        ? new THREE.Vector3(1, 1, 1).add(axis.clone().set(Math.abs(axis.x), Math.abs(axis.y), Math.abs(axis.z)).multiplyScalar(f - 1))
        : new THREE.Vector3(f, f, f);
      delta.makeScale(s.x, s.y, s.z);
      text = `${fmt(f)}배`;
    }
    if (this.kind !== "grab") {
      const toOrigin = new THREE.Matrix4().makeTranslation(-this.pivot.x, -this.pivot.y, -this.pivot.z);
      const back = new THREE.Matrix4().makeTranslation(this.pivot.x, this.pivot.y, this.pivot.z);
      delta.premultiply(back).multiply(toOrigin);
    }

    if (target.type === "object") {
      const o = target.object;
      if (this.kind === "grab") {
        o.position.copy(start.position).add(new THREE.Vector3().setFromMatrixPosition(delta));
      } else if (this.kind === "rotate") {
        const { axis, angle } = this.rotation();
        o.quaternion.copy(start.quaternion).premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
      } else {
        // 오브젝트는 자기 축 방향으로 늘린다. 돌아가 있어도 비뚤어지지 않는다.
        const f = this.scaleFactor();
        const s = this.axis && this.axis !== "custom" ? new THREE.Vector3(1, 1, 1).setComponent("xyz".indexOf(this.axis), f) : new THREE.Vector3(f, f, f);
        o.scale.copy(start.scale).multiply(s);
      }
      this.host.changed(target);
    } else {
      const next = cloneMesh(target.poly);
      start.world!.forEach((world, v) => {
        const local = world.clone().applyMatrix4(delta).applyMatrix4(start.meshWorldInverse!);
        next.vertices[v] = [local.x, local.y, local.z];
      });
      if (this.falloff) {
        this.falloff.forEach(({ world, dist }, v) => {
          if (dist >= this.radius) {
            next.vertices[v] = [...target.poly.vertices[v]];
            return;
          }
          // 부드러운 감쇠: 가까울수록 많이, 반경 끝에서 0
          const t = 1 - dist / this.radius;
          const w = t * t * (3 - 2 * t);
          const moved = world.clone().applyMatrix4(delta);
          const local = world.clone().lerp(moved, w).applyMatrix4(start.meshWorldInverse!);
          next.vertices[v] = [local.x, local.y, local.z];
        });
        this.updateRing();
      }
      this.host.changed(target, next);
    }

    const typed = this.typed ? ` · 입력: ${this.typed}` : "";
    const snap = this.snapping() ? " · 칸 맞춤" : "";
    const prop = this.falloff ? ` · 비례 편집 반경 ${fmt(this.radius, 2)} (휠로 조절)` : "";
    this.host.readout(
      `${this.options.label ?? KIND_LABEL[this.kind]}${axisLabel} · ${text}${typed}${snap}${prop}\n` +
        "클릭·Enter 확정 · 오른쪽 클릭·Esc 취소 · X/Y/Z 방향 고정 · 숫자로 값 입력 · Shift 천천히 · Ctrl 칸 맞춤",
    );
  }

  private updateAxisLine() {
    this.removeAxisLine();
    const axis = this.axisVector();
    if (!axis || !this.axis) return;
    const geometry = new THREE.BufferGeometry().setFromPoints([
      this.pivot.clone().addScaledVector(axis, -500),
      this.pivot.clone().addScaledVector(axis, 500),
    ]);
    this.axisLine = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color: AXIS_COLOR[this.axis], depthTest: false, transparent: true, opacity: 0.9 }),
    );
    this.axisLine.renderOrder = 999;
    this.axisLine.raycast = () => {};
    this.host.scene.add(this.axisLine);
  }

  /** 비례 편집 반경을 화면을 마주 보는 동그라미로 */
  private updateRing() {
    if (!this.radiusRing) {
      const pts = Array.from({ length: 64 }, (_, i) => new THREE.Vector3(Math.cos((i / 64) * Math.PI * 2), Math.sin((i / 64) * Math.PI * 2), 0));
      this.radiusRing = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0xffc83d, depthTest: false, transparent: true, opacity: 0.7 }),
      );
      this.radiusRing.renderOrder = 999;
      this.radiusRing.raycast = () => {};
      this.host.scene.add(this.radiusRing);
    }
    this.radiusRing.position.copy(this.pivot);
    this.radiusRing.quaternion.copy(this.host.camera().quaternion);
    this.radiusRing.scale.setScalar(this.radius);
  }

  private removeRing() {
    if (!this.radiusRing) return;
    this.radiusRing.removeFromParent();
    this.radiusRing.geometry.dispose();
    (this.radiusRing.material as THREE.Material).dispose();
    this.radiusRing = null;
  }

  private removeAxisLine() {
    if (!this.axisLine) return;
    this.axisLine.removeFromParent();
    this.axisLine.geometry.dispose();
    (this.axisLine.material as THREE.Material).dispose();
    this.axisLine = null;
  }
}

/** 축 직선 위에서 광선과 가장 가까운 점의 위치 (pivot 에서 축 방향으로 몇 칸) */
function closestOnAxis(origin: THREE.Vector3, axis: THREE.Vector3, ray: THREE.Ray): number {
  const w0 = origin.clone().sub(ray.origin);
  const b = axis.dot(ray.direction);
  const d = axis.dot(w0);
  const e = ray.direction.dot(w0);
  const denom = 1 - b * b;
  // 축이 화면을 똑바로 뚫고 들어가면 어느 점이든 같아 보인다.
  if (denom < 1e-4) return 0;
  return (b * e - d) / denom;
}

function fmt(n: number, digits = 3) {
  const f = 10 ** digits;
  return String(Math.round(n * f) / f);
}
