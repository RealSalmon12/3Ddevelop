/**
 * 뼈대 모드 화면: 뼈를 선과 관절 구슬로 그리고, 클릭으로 뼈를 고른다.
 * - 포즈: 고른 뼈의 관절에 회전 손잡이가 붙는다. 돌리면 그 뼈와 자식 뼈, 거기 붙은 살이 함께 움직인다.
 * - 관절 위치: 쉬는 자세에서 관절(구슬)을 끌어 뼈 자리를 맞춘다.
 */
import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { poseMatrices, posedJoints, type Rig } from "../mesh/rig";
import type { ModelerScene } from "../scene/ModelerScene";

export type RigMode = "pose" | "joint";

interface Host {
  canvas: HTMLCanvasElement;
  camera: () => THREE.PerspectiveCamera | THREE.OrthographicCamera;
  model: ModelerScene;
  scene: THREE.Scene;
  setOrbit: (enabled: boolean) => void;
  /** 화면에서 뼈를 골랐을 때 */
  onSelect: (boneId: string | null, end: "head" | "tail") => void;
}

const BONE = 0x8fd3ff;
const ACTIVE = 0xffc83d;

export class RigTool {
  private id: string | null = null;
  private mode: RigMode = "pose";
  private bone: string | null = null;
  private end: "head" | "tail" = "tail";
  private group = new THREE.Group();
  /** 손잡이를 붙일 틀 (포즈: 부모 뼈가 움직인 자리, 관절: 오브젝트) */
  private frame = new THREE.Object3D();
  private proxy = new THREE.Object3D();
  private ctl: TransformControls;
  private dragging = false;
  private lastKey = "";

  constructor(private host: Host) {
    this.group.renderOrder = 998;
    this.group.matrixAutoUpdate = false;
    this.frame.matrixAutoUpdate = false;
    this.frame.add(this.proxy);
    host.scene.add(this.group, this.frame);
    this.ctl = new TransformControls(host.camera(), host.canvas);
    this.ctl.setSize(0.8);
    this.ctl.addEventListener("dragging-changed", (e) => {
      this.dragging = !!e.value;
      host.setOrbit(!e.value);
      if (!e.value) this.apply(true);
    });
    this.ctl.addEventListener("objectChange", () => this.apply(false));
    host.scene.add(this.ctl.getHelper());
    this.ctl.getHelper().visible = false;
    this.ctl.enabled = false;
    host.canvas.parentElement!.addEventListener("pointerdown", this.onDown, { capture: true });
  }

  get active() {
    return !!this.id;
  }

  /** 렌더할 때 감출 것 */
  get overlays(): THREE.Object3D[] {
    return [this.group, this.ctl.getHelper()];
  }

  /** 손잡이 위에 있거나 끄는 중 (뷰포트가 클릭을 오브젝트 고르기로 쓰지 않게) */
  get busy() {
    return !!this.id && (this.dragging || !!this.ctl.axis);
  }

  set(id: string | null, mode: RigMode, bone: string | null, end: "head" | "tail") {
    this.id = id;
    this.mode = mode;
    this.bone = bone;
    this.end = end;
    this.lastKey = "";
    this.sync();
  }

  private rig(): Rig | null {
    return this.host.model.getRig(this.id);
  }

  /** 손잡이를 움직인 값을 모델에 */
  private apply(done: boolean) {
    if (!this.id || !this.bone) return;
    if (this.mode === "pose") {
      const r = this.proxy.rotation;
      this.host.model.setBonePose(this.id, this.bone, [r.x, r.y, r.z], done);
    } else {
      const p = this.proxy.position;
      this.host.model.moveJoint(this.id, this.bone, this.end, [p.x, p.y, p.z], done);
    }
  }

  /** 매 프레임: 뼈 그림과 손잡이 자리를 맞춘다 */
  update() {
    this.ctl.camera = this.host.camera();
    if (this.id) this.sync();
  }

  private sync() {
    const mesh = this.host.model.getMesh(this.id);
    const rig = this.rig();
    const show = !!mesh && !!rig && mesh.visible;
    this.group.visible = show;
    if (!show) {
      this.ctl.detach();
      this.ctl.enabled = false;
      this.ctl.getHelper().visible = false;
      return;
    }
    mesh.updateMatrixWorld();
    this.group.matrix.copy(mesh.matrixWorld);
    this.group.matrixWorldNeedsUpdate = true;
    const key = `${JSON.stringify(rig)}/${this.bone}/${this.mode}/${this.end}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.redraw(rig);
    }
    const bone = rig.bones.find((b) => b.id === this.bone);
    if (!bone) {
      this.ctl.detach();
      this.ctl.getHelper().visible = false;
      return;
    }
    if (!this.dragging) {
      if (this.mode === "pose") {
        const parent = bone.parent ? poseMatrices(rig).get(bone.parent) : undefined;
        this.frame.matrix.copy(mesh.matrixWorld);
        if (parent) this.frame.matrix.multiply(parent);
        const r = rig.pose[bone.id] ?? [0, 0, 0];
        this.proxy.position.set(...bone.head);
        this.proxy.rotation.set(r[0], r[1], r[2]);
        this.ctl.setMode("rotate");
      } else {
        this.frame.matrix.copy(mesh.matrixWorld);
        this.proxy.position.set(...bone[this.end]);
        this.proxy.rotation.set(0, 0, 0);
        this.ctl.setMode("translate");
      }
      this.frame.matrixWorldNeedsUpdate = true;
      this.frame.updateMatrixWorld(true);
    }
    if (this.ctl.object !== this.proxy) this.ctl.attach(this.proxy);
    this.ctl.enabled = true;
    this.ctl.getHelper().visible = true;
  }

  /** 뼈: 머리에서 끝으로 가는 가는 마름모 + 관절 구슬 */
  private redraw(rig: Rig) {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      (c as THREE.Mesh).geometry?.dispose();
      ((c as THREE.Mesh).material as THREE.Material | undefined)?.dispose();
    }
    const joints = this.mode === "pose" ? posedJoints(rig) : new Map(rig.bones.map((b) => [b.id, { head: new THREE.Vector3(...b.head), tail: new THREE.Vector3(...b.tail) }]));
    const size = Math.max(0.02, ...rig.bones.map((b) => joints.get(b.id)!.head.distanceTo(joints.get(b.id)!.tail))) * 0.08;
    for (const b of rig.bones) {
      const { head, tail } = joints.get(b.id)!;
      const active = b.id === this.bone;
      const color = active ? ACTIVE : BONE;
      const len = head.distanceTo(tail);
      if (len > 1e-6) {
        const geo = new THREE.OctahedronGeometry(1, 0);
        geo.translate(0, 1, 0);
        geo.scale(Math.min(size, len * 0.15), len / 2, Math.min(size, len * 0.15));
        const body = new THREE.Mesh(
          geo,
          new THREE.MeshBasicMaterial({ color, wireframe: !active, transparent: true, opacity: active ? 0.55 : 0.9, depthTest: false }),
        );
        body.position.copy(head);
        body.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tail.clone().sub(head).normalize());
        body.renderOrder = 998;
        body.userData.bone = b.id;
        this.group.add(body);
      }
      for (const [end, p] of [["head", head], ["tail", tail]] as const) {
        const on = active && this.mode === "joint" && end === this.end;
        const ball = new THREE.Mesh(new THREE.SphereGeometry(size * (on ? 0.9 : 0.6), 10, 8), new THREE.MeshBasicMaterial({ color: on ? 0xffffff : color, depthTest: false }));
        ball.position.copy(p);
        ball.renderOrder = 999;
        this.group.add(ball);
      }
    }
  }

  /** 화면에서 가장 가까운 뼈 (선분까지 픽셀 거리) */
  private pick(e: PointerEvent): { bone: string; end: "head" | "tail" } | null {
    const mesh = this.host.model.getMesh(this.id);
    const rig = this.rig();
    if (!mesh || !rig) return null;
    const rect = this.host.canvas.getBoundingClientRect();
    const cam = this.host.camera();
    const toScreen = (v: THREE.Vector3) => {
      const p = v.clone().applyMatrix4(mesh.matrixWorld).project(cam);
      return new THREE.Vector2(((p.x + 1) / 2) * rect.width + rect.left, ((1 - p.y) / 2) * rect.height + rect.top);
    };
    const joints = this.mode === "pose" ? posedJoints(rig) : new Map(rig.bones.map((b) => [b.id, { head: new THREE.Vector3(...b.head), tail: new THREE.Vector3(...b.tail) }]));
    const m = new THREE.Vector2(e.clientX, e.clientY);
    let best: { bone: string; end: "head" | "tail"; d: number } | null = null;
    for (const b of rig.bones) {
      const j = joints.get(b.id)!;
      const a = toScreen(j.head);
      const c = toScreen(j.tail);
      const ab = c.clone().sub(a);
      const t = Math.max(0, Math.min(1, m.clone().sub(a).dot(ab) / Math.max(1e-6, ab.lengthSq())));
      let d = a.clone().addScaledVector(ab, t).distanceTo(m);
      // 관절 위치 모드에서는 구슬을 더 잘 잡게
      const end = m.distanceTo(a) < m.distanceTo(c) ? "head" : "tail";
      if (this.mode === "joint") d = Math.min(d + 4, Math.min(m.distanceTo(a), m.distanceTo(c)));
      if (d < 12 && (!best || d < best.d)) best = { bone: b.id, end, d };
    }
    return best;
  }

  private onDown = (e: PointerEvent) => {
    if (!this.id || e.button !== 0 || e.altKey) return;
    // 손잡이 위면 손잡이가 받는다
    if (this.ctl.enabled && this.ctl.axis) return;
    const hit = this.pick(e);
    if (!hit) return;
    e.stopPropagation();
    this.host.onSelect(hit.bone, hit.end);
  };

  dispose() {
    this.host.canvas.parentElement?.removeEventListener("pointerdown", this.onDown, { capture: true });
    this.ctl.detach();
    this.ctl.dispose();
    this.host.scene.remove(this.group, this.frame, this.ctl.getHelper());
  }
}

