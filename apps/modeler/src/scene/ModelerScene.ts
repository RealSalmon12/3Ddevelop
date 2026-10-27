import { applySurface, type Surface } from "./materials";
import * as THREE from "three";
import { AUTO_SMOOTH_DEGREES, buildGeometry } from "../mesh/geometry";
import { edgeLoop, edgeRing, loopCut } from "../mesh/loops";
import { MAX_SUBDIVISION } from "../mesh/subdivision";
import { AXES, applyModifiers, hasModifiers, type ArrayModifier, type Axis, type Modifiers } from "../mesh/modifiers";
import * as ops from "../mesh/operations";
import { add, centroid, cloneMesh, edgeKey, faceNormal, sub, type PolyMesh, type Vec3 } from "../mesh/PolyMesh";
import {
  convertSelection,
  emptySelection,
  selectAll,
  selectedFaces,
  selectedVertices,
  selectionFromFaces,
  type EditSelection,
  type SelectMode,
} from "../mesh/selection";
import { EFFECTS, ParticleSystem, type EffectSettings, type EffectType } from "../effects/particles";
import { createShape, SHAPES, type ShapeKind } from "./shapes";



/** 오브젝트 하나를 파일에 저장하는 모양 */
export interface ObjectData {
  id: string;
  name: string;
  kind: ShapeKind;
  position: Vec3;
  /** 라디안 */
  rotation: Vec3;
  scale: Vec3;
  /** "#rrggbb" */
  color: string;
  /** 스스로 빛나는 세기 (0 이면 빛나지 않음). 빛 번짐 효과와 함께 보인다. */
  glow?: number;
  /** 겉면 느낌 (없으면 플라스틱) */
  surface?: Surface;
  /** 이펙트 오브젝트일 때만 */
  effect?: EffectSettings;
  /** 화면에서 숨겼는지 (H). 숨겨도 저장, 내보내기에는 들어간다. */
  hidden?: boolean;
  /**
   * 매끈하게 (블렌더의 서브디비전 표면 모디파이어). 0~3. 원래 모양(점, 선, 면)은 그대로 두고
   * 보이는 모양과 내보내는 모양만 둥글게 나눈다. 편집 모드에서는 원래 모양의 점을 움직여 다듬는다.
   */
  subdivision?: number;
  /** 대칭 모디파이어: 이 축들로 비춰 반대쪽을 만든다 (오브젝트 원점 기준) */
  mirror?: Axis[];
  /** 배열 모디파이어: 같은 모양을 늘어놓는다 */
  array?: ArrayModifier;
  /** 면 이어 보이기: auto 는 완만한 곳만 부드럽게, smooth 는 모두 부드럽게, flat 은 모두 각지게 */
  smooth?: SmoothMode;
  /** 모양 (오브젝트 기준 좌표). 처음 버전 파일에는 없어서 kind 로 다시 만든다. */
  mesh?: PolyMesh;
}

export type SmoothMode = "auto" | "smooth" | "flat";

/** 화면 목록과 속성 패널에 보여줄 정보 (모양 데이터는 크기가 커서 뺀다) */
export type ObjectInfo = Omit<ObjectData, "mesh">;

/** 프로젝트 파일(.nmodel) 내용 */
export interface SceneDocument {
  app: "modeler";
  version: 1 | 2;
  objects: ObjectData[];
}

export interface EditState {
  id: string;
  mode: SelectMode;
  /** 고른 점 개수 */
  selectedVertexCount: number;
  /** 고른 점들의 가운데 (오브젝트 기준 좌표) */
  center: Vec3 | null;
  /** 모양이나 선택이 바뀔 때마다 1씩 늘어난다. 뷰포트가 다시 그릴 때를 안다. */
  version: number;
}

export interface SceneSnapshot {
  items: ObjectInfo[];
  selectedId: string | null;
  /** 편집 모드일 때만 있다. */
  edit: EditState | null;
  canUndo: boolean;
  canRedo: boolean;
  /** 마지막 저장 뒤 바뀐 것이 있는지 */
  dirty: boolean;
}

const DEFAULT_COLOR = "#b8bcc4";
const HISTORY_LIMIT = 100;

const round = (n: number) => Math.round(n * 1e5) / 1e5;
const vec = (v: THREE.Vector3 | THREE.Euler): Vec3 => [round(v.x), round(v.y), round(v.z)];

/**
 * 3D 장면의 상태를 들고 있는 곳. 화면(React)은 snapshot 을 구독해서 목록과 패널을 그리고,
 * 뷰포트(three.js)는 같은 객체의 root 를 그린다.
 *
 * 실행 취소는 바뀔 때마다 장면 전체를 JSON 으로 기록해 두는 방식이다. 장면이 작아서 충분히 빠르고,
 * 저장 파일과 같은 형식이라 따로 맞출 것이 없다.
 */
export class ModelerScene {
  readonly root = new THREE.Group();
  private meshes = new Map<string, THREE.Mesh>();
  private listeners = new Set<() => void>();
  private selectedId: string | null = null;
  private editingId: string | null = null;
  private editSelection: EditSelection = emptySelection();
  private editVersion = 0;

  private past: string[] = [];
  private future: string[] = [];
  private current: string;
  private saved: string;
  private snapshot!: SceneSnapshot;

  constructor() {
    this.current = this.saved = this.serialize();
    this.refresh();
  }

  // ---------- 구독 ----------

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  private refresh() {
    this.snapshot = {
      items: [...this.meshes.values()].map(toInfo),
      selectedId: this.selectedId,
      edit: this.editState(),
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
      dirty: this.current !== this.saved,
    };
    this.listeners.forEach((l) => l());
  }

  /** 기록 없이 화면만 새로 고친다. 기즈모로 끄는 중처럼 아직 끝나지 않은 변경에 쓴다. */
  touch() {
    this.refresh();
  }

  /** 바로 앞 기록을 지금 상태로 바꾼다. 돌출하고 바로 끌어 옮기는 것처럼 두 단계를 한 번의 실행 취소로 묶을 때 쓴다. */
  amendCommit() {
    this.current = this.serialize();
    this.future = [];
    this.refresh();
  }

  /** 지금 상태를 실행 취소 기록에 남긴다. 변경이 끝날 때마다 부른다. */
  commit() {
    const next = this.serialize();
    if (next !== this.current) {
      this.past.push(this.current);
      if (this.past.length > HISTORY_LIMIT) this.past.shift();
      this.current = next;
      this.future = [];
    }
    this.refresh();
  }

  undo() {
    const prev = this.past.pop();
    if (prev === undefined) return;
    this.future.push(this.current);
    this.current = prev;
    this.restore(prev);
  }

  redo() {
    const next = this.future.pop();
    if (next === undefined) return;
    this.past.push(this.current);
    this.current = next;
    this.restore(next);
  }

  // ---------- 오브젝트 ----------

  /** 연기, 반짝이 같은 이펙트를 바닥 위 빈자리에 놓는다. */
  addEffect(type: EffectType): string {
    const info = EFFECTS.find((e) => e.type === type)!;
    const spot = this.findFreeSpot();
    const id = this.createMesh({
      id: crypto.randomUUID(),
      name: this.uniqueName(info.label),
      kind: "effect",
      position: [spot.x, 0, spot.z],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      color: info.color,
      effect: { type, amount: 1, speed: 1 },
    });
    this.exitEditSilently();
    this.selectedId = id;
    this.commit();
    return id;
  }

  add(kind: Exclude<ShapeKind, "effect">): string {
    const label = SHAPES.find((s) => s.kind === kind)!.label;
    const mesh = createShape(kind);
    const minY = Math.min(...mesh.vertices.map((v) => v[1]));
    const spot = this.findFreeSpot();
    const id = this.createMesh({
      id: crypto.randomUUID(),
      name: this.uniqueName(label),
      kind,
      // 바닥 위에 올려놓는다.
      position: [spot.x, round(-minY), spot.z],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      color: DEFAULT_COLOR,
      mesh,
    });
    this.exitEditSilently();
    this.selectedId = id;
    this.commit();
    return id;
  }

  /** 복제. inPlace 면 같은 자리에 겹쳐 만든다 (Shift+D 로 만든 뒤 바로 끌어 옮길 때). */
  duplicateSelected(inPlace = false): boolean {
    const mesh = this.getMesh(this.selectedId);
    if (!mesh) return false;
    this.exitEditSilently();
    const data = toData(mesh);
    const id = this.createMesh({
      ...data,
      id: crypto.randomUUID(),
      name: this.uniqueName(data.name.replace(/ \d+$/, "")),
      position: inPlace ? data.position : [data.position[0] + 1, data.position[1], data.position[2] + 1],
      hidden: false,
    });
    this.selectedId = id;
    this.commit();
    return true;
  }

  // ---------- 숨기기 ----------

  setHidden(id: string, hidden: boolean) {
    const mesh = this.meshes.get(id);
    if (!mesh || mesh.visible === !hidden) return;
    if (hidden && this.editingId === id) this.exitEditSilently();
    mesh.visible = !hidden;
    if (hidden && this.selectedId === id) this.selectedId = null;
    this.commit();
  }

  /** H: 고른 것을 숨긴다. Shift+H: 고른 것만 남기고 숨긴다. */
  hideSelected(others = false): boolean {
    if (!this.selectedId) return false;
    this.exitEditSilently();
    for (const [id, mesh] of this.meshes) {
      if (others ? id !== this.selectedId : id === this.selectedId) mesh.visible = false;
    }
    if (!others) this.selectedId = null;
    this.commit();
    return true;
  }

  /** Alt+H: 숨긴 것을 모두 다시 보인다. */
  unhideAll() {
    this.meshes.forEach((m) => (m.visible = true));
    this.commit();
  }

  /**
   * 좌우 대칭 복제: 가운데 선(X=0)을 거울 삼아 반대편에 뒤집힌 복사본을 만든다. 팔, 다리, 눈처럼 짝이 있는 것에 쓴다.
   * 크기를 음수로 만들지 않고 모양 자체를 뒤집어서, 내보낸 파일에서도 면 방향이 그대로다.
   */
  mirrorSelected(): boolean {
    const mesh = this.getMesh(this.selectedId);
    if (!mesh) return false;
    this.exitEditSilently();
    const data = toData(mesh);
    const poly = data.mesh ?? createShape(data.kind);
    const flipped: PolyMesh = {
      vertices: poly.vertices.map(([x, y, z]) => [-x, y, z] as Vec3),
      faces: poly.faces.map((f) => [...f].reverse()),
    };
    const [x, y, z] = data.position;
    const [rx, ry, rz] = data.rotation;
    const name = /왼/.test(data.name) ? data.name.replace(/왼/g, "오른") : /오른/.test(data.name) ? data.name.replace(/오른/g, "왼") : `${data.name} 반대쪽`;
    this.selectedId = this.createMesh({
      ...data,
      id: crypto.randomUUID(),
      name: this.uniqueName(name),
      position: [-x, y, z],
      rotation: [rx, -ry, -rz],
      mesh: flipped,
    });
    this.commit();
    return true;
  }

  remove(id: string) {
    if (!this.meshes.has(id)) return;
    if (this.editingId === id) this.exitEditSilently();
    this.disposeMesh(id);
    if (this.selectedId === id) this.selectedId = null;
    this.commit();
  }

  /**
   * 여러 도형을 한 번에 바꾼다 (AI 가 쓴다). 같은 이름이 있으면 바꾸고, 없으면 새로 만든다.
   * 편집한 모양은 그대로 두고 위치, 회전, 크기, 색만 바꾼다. 전체가 한 번의 실행 취소로 묶인다.
   */
  applyChanges(changes: {
    remove: string[];
    upsert: {
      name: string;
      kind: ShapeKind;
      position: Vec3;
      rotation: Vec3;
      scale: Vec3;
      color?: string;
      glow?: number;
      surface?: Surface;
      subdivision?: number;
      effect?: EffectSettings;
    }[];
  }) {
    this.exitEditSilently();
    const byName = new Map([...this.meshes.values()].map((m) => [m.name, m]));
    for (const name of changes.remove) {
      const mesh = byName.get(name);
      if (mesh) this.disposeMesh(mesh.userData.id);
      byName.delete(name);
    }
    let lastId: string | null = null;
    for (const o of changes.upsert) {
      const existing = byName.get(o.name);
      if (existing && existing.userData.kind === o.kind) {
        const info = toInfo(existing);
        applyData(existing, { ...info, ...o, color: o.color ?? info.color, effect: o.effect ? { ...info.effect, ...o.effect } : info.effect });
        lastId = existing.userData.id;
      } else {
        if (existing) this.disposeMesh(existing.userData.id);
        const fallback = o.effect ? EFFECTS.find((e) => e.type === o.effect!.type)!.color : DEFAULT_COLOR;
        lastId = this.createMesh({ id: crypto.randomUUID(), ...o, color: o.color ?? fallback });
        byName.set(o.name, this.meshes.get(lastId)!);
      }
    }
    if (this.selectedId && !this.meshes.has(this.selectedId)) this.selectedId = null;
    if (lastId && !this.selectedId) this.selectedId = lastId;
    this.commit();
  }

  removeSelected() {
    if (this.editingId) this.deleteEditSelection();
    else if (this.selectedId) this.remove(this.selectedId);
  }

  /** 속성 패널에서 값을 바꿀 때 */
  update(id: string, patch: Partial<Omit<ObjectData, "id" | "kind">>) {
    const mesh = this.meshes.get(id);
    if (!mesh) return;
    applyData(mesh, { ...toInfo(mesh), ...patch });
    this.commit();
  }

  select(id: string | null) {
    if (this.selectedId === id) return;
    this.exitEditSilently();
    this.selectedId = id;
    this.refresh();
  }

  getMesh(id: string | null) {
    return id ? this.meshes.get(id) ?? null : null;
  }

  allMeshes() {
    return [...this.meshes.values()];
  }

  // ---------- 파일 ----------

  serialize(): string {
    const doc: SceneDocument = { app: "modeler", version: 2, objects: [...this.meshes.values()].map(toData) };
    return JSON.stringify(doc);
  }

  /** 자동 저장본을 불러온다. 아직 파일로 저장한 적 없는 작업이므로 '저장 안 됨' 상태로 둔다. */
  recover(text: string) {
    this.load(text);
    this.saved = "";
    this.refresh();
  }

  /** 파일 내용을 불러와 새 장면으로 바꾼다. 실행 취소 기록은 비운다. */
  load(text: string) {
    const doc = JSON.parse(text) as SceneDocument;
    if (doc.app !== "modeler" || !Array.isArray(doc.objects)) {
      throw new Error("바코 빙산 프로젝트 파일이 아니에요.");
    }
    this.selectedId = null;
    this.exitEditSilently();
    this.restore(JSON.stringify(doc), false);
    this.current = this.saved = this.serialize();
    this.past = [];
    this.future = [];
    this.refresh();
  }

  /** 빈 장면으로 새로 시작 */
  reset() {
    this.load(JSON.stringify({ app: "modeler", version: 2, objects: [] } satisfies SceneDocument));
  }

  markSaved() {
    this.saved = this.current;
    this.refresh();
  }

  // ---------- 편집 모드 ----------

  /** Tab: 선택한 오브젝트의 점, 선, 면을 고치는 모드로 들어가거나 나온다. */
  toggleEdit() {
    if (!this.editingId) return this.enterEdit();
    this.exitEdit();
    return "ok";
  }

  /**
   * 편집 모드로 들어간다. 못 들어가면 그 이유를 돌려준다.
   * 아무것도 안 골랐는데 고칠 수 있는 오브젝트가 하나뿐이면 그것을 골라서 들어간다.
   */
  enterEdit(): "ok" | "nothing-selected" | "effect" {
    if (this.editingId) return "ok";
    if (!this.selectedId) {
      const editable = [...this.meshes.values()].filter((m) => m.userData.kind !== "effect");
      if (editable.length !== 1) return "nothing-selected";
      this.selectedId = editable[0].userData.id;
    }
    // 이펙트는 모양을 고칠 것이 없다.
    if (this.meshes.get(this.selectedId!)?.userData.kind === "effect") return "effect";
    this.editingId = this.selectedId;
    this.editSelection = emptySelection(this.editSelection.mode);
    this.editVersion++;
    this.refresh();
    return "ok";
  }

  exitEdit() {
    if (!this.editingId) return;
    this.exitEditSilently();
    this.refresh();
  }

  private exitEditSilently() {
    if (!this.editingId) return;
    this.editingId = null;
    this.editSelection = emptySelection(this.editSelection.mode);
    this.editVersion++;
  }

  getEditSelection() {
    return this.editSelection;
  }

  setSelectMode(mode: SelectMode) {
    const poly = this.editingPoly();
    if (!poly) return;
    this.editSelection = convertSelection(poly, this.editSelection, mode);
    this.editVersion++;
    this.refresh();
  }

  setEditSelection(selection: EditSelection) {
    this.editSelection = selection;
    this.editVersion++;
    this.refresh();
  }

  /** A: 모두 고르기, 이미 뭔가 골랐으면 모두 풀기 */
  toggleSelectAll() {
    const poly = this.editingPoly();
    if (!poly) return;
    const any = selectedVertices(poly, this.editSelection).size > 0;
    this.setEditSelection(any ? emptySelection(this.editSelection.mode) : selectAll(poly, this.editSelection.mode));
  }

  editingPoly(): PolyMesh | null {
    return this.editingId ? (this.meshes.get(this.editingId)?.userData.poly as PolyMesh) : null;
  }

  editingMesh() {
    return this.getMesh(this.editingId);
  }

  /** 끄는 중에 점 위치만 바꾼다. 다 끌면 commit() 을 부른다. */
  setEditingPoly(poly: PolyMesh) {
    const mesh = this.editingMesh();
    if (!mesh) return;
    mesh.userData.poly = poly;
    rebuildGeometry(mesh);
    this.editVersion++;
  }

  /** 속성 패널에서 고른 점들의 가운데 위치를 숫자로 바꿀 때 */
  moveEditSelectionTo(center: Vec3) {
    const poly = this.editingPoly();
    const current = this.editState()?.center;
    if (!poly || !current) return;
    const delta = sub(center, current);
    const next = cloneMesh(poly);
    selectedVertices(poly, this.editSelection).forEach((v) => (next.vertices[v] = add(next.vertices[v], delta)));
    this.setEditingPoly(next);
    this.commit();
  }

  /** 면 도구들이 공통으로 쓰는 틀. 고른 면이 없으면 false. */
  private applyFaceOperation(run: (poly: PolyMesh, faces: number[]) => ops.FaceResult): boolean {
    const poly = this.editingPoly();
    if (!poly) return false;
    const faces = selectedFaces(poly, this.editSelection);
    if (faces.length === 0) return false;
    const result = run(poly, faces);
    this.setEditingPoly(result.mesh);
    this.editSelection = selectionFromFaces(result.mesh, result.faces, this.editSelection.mode);
    this.commit();
    return true;
  }

  /**
   * 돌출: 고른 면을 바깥으로 밀어내고 벽을 세운다. 크기와 상관없이 같은 거리로 보이도록 오브젝트 크기로 나눈다.
   * distance 를 0 으로 주면 벽만 세우고, 뒤이어 마우스로 끌어서 높이를 정한다 (E 키).
   */
  extrude(distance = 0.3) {
    const mesh = this.editingMesh();
    const local = mesh ? distance / Math.max(Math.abs(mesh.scale.x), Math.abs(mesh.scale.y), Math.abs(mesh.scale.z), 1e-3) : distance;
    return this.applyFaceOperation((poly, faces) => ops.extrudeFaces(poly, faces, local));
  }

  /** 고른 면들이 바라보는 방향 (월드). 고른 면이 없으면 null. */
  selectedFaceNormal(): THREE.Vector3 | null {
    const mesh = this.editingMesh();
    const poly = this.editingPoly();
    if (!mesh || !poly) return null;
    const faces = selectedFaces(poly, this.editSelection);
    if (faces.length === 0) return null;
    const n = faces.map((f) => faceNormal(poly, poly.faces[f])).reduce(add, [0, 0, 0] as Vec3);
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    const world = new THREE.Vector3(...n).applyMatrix3(normalMatrix).normalize();
    return world.lengthSq() > 0 ? world : null;
  }

  inset() {
    return this.applyFaceOperation((poly, faces) => ops.insetFaces(poly, faces));
  }

  subdivide() {
    return this.applyFaceOperation((poly, faces) => ops.subdivideFaces(poly, faces));
  }

  /** 모서리 깎기: 고른 것과 상관없이 오브젝트 전체 모서리를 깎는다. 열린 메시면 false. */
  bevel() {
    const poly = this.editingPoly();
    if (!poly) return false;
    const next = ops.bevelAll(poly);
    if (!next) return false;
    this.setEditingPoly(next);
    this.editSelection = emptySelection(this.editSelection.mode);
    this.commit();
    return true;
  }

  /**
   * 루프 컷 (Ctrl+R): 고른 선(없으면 고른 점 둘이 이루는 선)을 가로지르는 고리 모양의 면들을 한 줄 자른다.
   * 새로 생긴 선들을 골라 두므로 바로 G 로 옮길 수 있다.
   */
  loopCut(): boolean {
    const poly = this.editingPoly();
    if (!poly) return false;
    const start = this.pickRingEdge(poly);
    if (!start) return false;
    const result = loopCut(poly, start);
    if (!result) return false;
    this.setEditingPoly(result.mesh);
    const sel = emptySelection("edge");
    result.edges.forEach((e) => sel.edges.add(e));
    this.editSelection = convertSelection(result.mesh, sel, this.editSelection.mode === "face" ? "edge" : this.editSelection.mode);
    this.commit();
    return true;
  }

  private pickRingEdge(poly: PolyMesh): string | null {
    const sel = this.editSelection;
    if (sel.mode === "edge" && sel.edges.size > 0) return [...sel.edges][0];
    const verts = [...selectedVertices(poly, sel)];
    for (const face of poly.faces) {
      for (let i = 0; i < face.length; i++) {
        const a = face[i];
        const b = face[(i + 1) % face.length];
        if (verts.includes(a) && verts.includes(b)) return edgeKey(a, b);
      }
    }
    return null;
  }

  /**
   * Alt+클릭: 선 하나로 이어진 한 줄을 통째로 고른다. 면 모드에서는 그 선을 가로지르는 면 한 바퀴를 고른다.
   * add 면 지금 고른 것에 더한다.
   */
  selectLoop(edge: string, add: boolean) {
    const poly = this.editingPoly();
    if (!poly) return;
    const mode = this.editSelection.mode;
    const base = add ? this.editSelection : emptySelection(mode);
    const next: EditSelection = { mode, vertices: new Set(base.vertices), edges: new Set(base.edges), faces: new Set(base.faces) };
    if (mode === "face") {
      edgeRing(poly, edge).faces.forEach((f) => next.faces.add(f));
    } else {
      const loop = edgeLoop(poly, edge);
      if (mode === "edge") loop.forEach((e) => next.edges.add(e));
      else loop.forEach((e) => e.split("-").forEach((v) => next.vertices.add(Number(v))));
    }
    this.setEditSelection(next);
  }

  /** 모디파이어(대칭, 배열, 매끈하게)를 모양에 굳힌다 (블렌더의 Apply). 그 뒤로는 생긴 점들을 하나하나 고칠 수 있다. */
  applySubdivision(): boolean {
    const mesh = this.getMesh(this.editingId ?? this.selectedId);
    if (!mesh) return false;
    const mods = modifiersOf(mesh);
    if (!hasModifiers(mods)) return false;
    mesh.userData.poly = applyModifiers(mesh.userData.poly as PolyMesh, mods);
    mesh.userData.subdivision = undefined;
    mesh.userData.mirror = undefined;
    mesh.userData.array = undefined;
    rebuildGeometry(mesh);
    if (this.editingId) this.editSelection = emptySelection(this.editSelection.mode);
    this.editVersion++;
    this.commit();
    return true;
  }

  /** Ctrl+0~3: 고른 오브젝트를 매끈하게 하는 단계 */
  setSubdivision(level: number): boolean {
    const id = this.editingId ?? this.selectedId;
    const mesh = this.getMesh(id);
    if (!id || !mesh || mesh.userData.kind === "effect") return false;
    this.update(id, { subdivision: level });
    this.editVersion++;
    this.refresh();
    return true;
  }

  flip() {
    return this.applyFaceOperation((poly, faces) => ops.flipFaces(poly, faces));
  }

  /** 고른 점들을 한 점으로. 두 점 이상 골라야 한다. */
  merge() {
    const poly = this.editingPoly();
    if (!poly) return false;
    const verts = selectedVertices(poly, this.editSelection);
    if (verts.size < 2) return false;
    const result = ops.mergeVertices(poly, verts);
    this.setEditingPoly(result.mesh);
    const sel = emptySelection("vertex");
    if (result.vertex >= 0) sel.vertices.add(result.vertex);
    this.editSelection = convertSelection(result.mesh, sel, this.editSelection.mode);
    this.commit();
    return true;
  }

  deleteEditSelection() {
    const poly = this.editingPoly();
    if (!poly) return false;
    const sel = this.editSelection;
    const target =
      sel.mode === "vertex" ? { vertices: sel.vertices } : sel.mode === "edge" ? { edges: sel.edges } : { faces: sel.faces };
    if (selectedVertices(poly, sel).size === 0) return false;
    this.setEditingPoly(ops.deleteElements(poly, target));
    this.editSelection = emptySelection(sel.mode);
    this.commit();
    return true;
  }

  private editState(): EditState | null {
    const poly = this.editingPoly();
    if (!this.editingId || !poly) return null;
    const verts = [...selectedVertices(poly, this.editSelection)];
    const center = verts.length ? centroid(verts.map((v) => poly.vertices[v])) : null;
    return {
      id: this.editingId,
      mode: this.editSelection.mode,
      selectedVertexCount: verts.length,
      center: center && (center.map(round) as Vec3),
      version: this.editVersion,
    };
  }

  // ---------- 내부 ----------

  private restore(text: string, notify = true) {
    for (const id of [...this.meshes.keys()]) this.disposeMesh(id);
    const doc = JSON.parse(text) as SceneDocument;
    doc.objects.forEach((data) => this.createMesh(data));
    if (this.selectedId && !this.meshes.has(this.selectedId)) this.selectedId = null;
    if (this.editingId) {
      // 되돌린 뒤에는 점 번호가 달라졌을 수 있어서 고른 것을 비운다.
      if (this.meshes.has(this.editingId)) this.editSelection = emptySelection(this.editSelection.mode);
      else this.editingId = null;
      this.editVersion++;
    }
    if (notify) this.refresh();
  }

  private createMesh(data: ObjectData): string {
    const poly = data.mesh ? cloneMesh(data.mesh) : createShape(data.kind);
    const isEffect = data.kind === "effect";
    const mesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({
        // 이펙트 표시는 뼈대만 보이는 작은 다이아몬드
        wireframe: isEffect,
        roughness: 0.55,
        metalness: 0.05,
        // 면을 지워 속이 보여도 뒷면이 투명해지지 않게
        side: THREE.DoubleSide,
        // 편집 모드의 점과 선이 면에 묻히지 않도록 면을 살짝 뒤로 민다.
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
    );
    mesh.userData.poly = poly;
    mesh.userData.id = data.id;
    mesh.userData.kind = data.kind;
    mesh.userData.geometryKey = null;
    mesh.castShadow = !isEffect;
    mesh.receiveShadow = !isEffect;
    applyData(mesh, data);
    this.root.add(mesh);
    this.meshes.set(data.id, mesh);
    return data.id;
  }

  private disposeMesh(id: string) {
    const mesh = this.meshes.get(id)!;
    (mesh.userData.particles as ParticleSystem | undefined)?.dispose();
    const wire = mesh.userData.wire as THREE.LineSegments | undefined;
    wire?.geometry.dispose();
    (wire?.material as THREE.Material | undefined)?.dispose();
    this.root.remove(mesh);
    mesh.geometry.dispose();
    (mesh.userData.cage as THREE.BufferGeometry | undefined)?.dispose();
    (mesh.material as THREE.Material).dispose();
    this.meshes.delete(id);
  }

  private uniqueName(base: string) {
    const names = new Set([...this.meshes.values()].map((m) => m.name));
    if (!names.has(base)) return base;
    let n = 2;
    while (names.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  }

  /** 새 도형이 기존 도형 안에 숨지 않도록 가운데에서 가까운 빈자리를 찾는다. */
  private findFreeSpot(): { x: number; z: number } {
    const step = 1.5;
    const taken = (x: number, z: number) =>
      [...this.meshes.values()].some((m) => Math.hypot(m.position.x - x, m.position.z - z) < step * 0.9);
    for (let ring = 0; ring < 20; ring++) {
      for (let i = -ring; i <= ring; i++) {
        for (const [x, z] of [[i, -ring], [i, ring], [-ring, i], [ring, i]]) {
          if (!taken(x * step, z * step)) return { x: x * step, z: z * step };
        }
      }
    }
    return { x: 0, z: 0 };
  }
}

function toData(mesh: THREE.Mesh): ObjectData {
  const poly = mesh.userData.poly as PolyMesh;
  return {
    ...toInfo(mesh),
    mesh: { vertices: poly.vertices.map((v) => v.map(round) as Vec3), faces: poly.faces },
  };
}

function toInfo(mesh: THREE.Mesh): ObjectInfo {
  return {
    id: mesh.userData.id,
    name: mesh.name,
    kind: mesh.userData.kind,
    position: vec(mesh.position),
    rotation: vec(mesh.rotation),
    scale: vec(mesh.scale),
    color: `#${(mesh.material as THREE.MeshStandardMaterial).color.getHexString()}`,
    ...(mesh.userData.glow ? { glow: mesh.userData.glow as number } : {}),
    ...(mesh.userData.surface ? { surface: mesh.userData.surface as Surface } : {}),
    ...(mesh.userData.effect ? { effect: { ...(mesh.userData.effect as EffectSettings) } } : {}),
    ...(mesh.visible ? {} : { hidden: true }),
    ...(mesh.userData.subdivision ? { subdivision: mesh.userData.subdivision as number } : {}),
    ...(mesh.userData.mirror ? { mirror: [...(mesh.userData.mirror as Axis[])] } : {}),
    ...(mesh.userData.array ? { array: { ...(mesh.userData.array as ArrayModifier) } } : {}),
    ...(mesh.userData.smooth && mesh.userData.smooth !== "auto" ? { smooth: mesh.userData.smooth as SmoothMode } : {}),
  };
}

/**
 * 원래 모양(poly)에서 화면에 그릴 모양을 만든다. 매끈하게를 켰으면 잘게 나눈 모양을 그리고,
 * 편집 모드에서 점, 선, 면을 클릭으로 찾을 수 있도록 원래 모양 그대로의 것(cage)도 따로 둔다.
 */
function modifiersOf(mesh: THREE.Mesh): Modifiers {
  return {
    mirror: mesh.userData.mirror as Axis[] | undefined,
    array: mesh.userData.array as ArrayModifier | undefined,
    subdivision: mesh.userData.subdivision as number | undefined,
  };
}

const modifierKey = (mesh: THREE.Mesh) =>
  `${mesh.userData.subdivision ?? 0}/${mesh.userData.smooth ?? "auto"}/${(mesh.userData.mirror as Axis[] | undefined)?.join("") ?? ""}/${JSON.stringify(mesh.userData.array ?? null)}`;

function rebuildGeometry(mesh: THREE.Mesh) {
  const poly = mesh.userData.poly as PolyMesh;
  const mods = modifiersOf(mesh);
  const level = mods.subdivision ?? 0;
  const smooth = (mesh.userData.smooth as SmoothMode | undefined) ?? "auto";
  // 매끈하게 켠 모양은 기본으로 모두 부드럽게 이어 보인다 (블렌더에서 Shade Smooth 와 같이 쓰는 것처럼).
  const degrees = smooth === "flat" ? 0 : smooth === "smooth" || level > 0 ? 180 : AUTO_SMOOTH_DEGREES;
  const modified = hasModifiers(mods);
  const display = modified ? applyModifiers(poly, mods) : poly;

  mesh.geometry.dispose();
  (mesh.userData.cage as THREE.BufferGeometry | undefined)?.dispose();
  mesh.geometry = buildGeometry(display, degrees);
  mesh.userData.displayPoly = modified ? display : undefined;
  mesh.userData.cage = modified ? buildGeometry(poly) : undefined;
  mesh.userData.geometryKey = modifierKey(mesh);
}

/** 편집 모드에서 클릭한 면을 찾을 모양 (원래 모양 그대로) */
export function pickGeometry(mesh: THREE.Mesh): THREE.BufferGeometry {
  return (mesh.userData.cage as THREE.BufferGeometry | undefined) ?? mesh.geometry;
}

function applyData(mesh: THREE.Mesh, data: ObjectInfo) {
  mesh.name = data.name;
  mesh.visible = !data.hidden;
  if (data.kind !== "effect") {
    mesh.userData.subdivision = Math.max(0, Math.min(MAX_SUBDIVISION, Math.round(data.subdivision ?? 0))) || undefined;
    mesh.userData.smooth = data.smooth && data.smooth !== "auto" ? data.smooth : undefined;
    const mirror = (data.mirror ?? []).filter((a) => AXES.includes(a));
    mesh.userData.mirror = mirror.length ? AXES.filter((a) => mirror.includes(a)) : undefined;
    mesh.userData.array =
      data.array && data.array.count > 1
        ? { count: Math.max(2, Math.min(64, Math.round(data.array.count))), offset: data.array.offset.map((v) => Number(v) || 0) as Vec3 }
        : undefined;
  }
  // 매끈하게 단계나 면 이어 보이기가 바뀌었을 때만 다시 만든다.
  if (mesh.userData.geometryKey !== modifierKey(mesh)) rebuildGeometry(mesh);
  mesh.position.fromArray(data.position);
  mesh.rotation.set(...data.rotation);
  mesh.scale.fromArray(data.scale);
  const material = mesh.material as THREE.MeshStandardMaterial;
  material.color.set(data.color);
  // 빛나기: 자기 색으로 스스로 빛난다. 1 을 넘으면 빛 번짐이 생긴다.
  const glow = Math.max(0, data.glow ?? 0);
  mesh.userData.glow = glow || undefined;
  material.emissive.set(data.color);
  material.emissiveIntensity = glow * 0.6;
  if (data.kind !== "effect") {
    mesh.userData.surface = data.surface && data.surface !== "plastic" ? data.surface : undefined;
    applySurface(material, data.surface);
  }

  if (data.effect) {
    let particles = mesh.userData.particles as ParticleSystem | undefined;
    if (!particles || particles.settings.type !== data.effect.type) {
      particles?.dispose();
      particles = new ParticleSystem({ ...data.effect }, data.color);
      mesh.userData.particles = particles;
      mesh.add(particles.points);
    }
    particles.settings = { ...data.effect };
    particles.setColor(data.color);
    mesh.userData.effect = { ...data.effect };
  }
}
