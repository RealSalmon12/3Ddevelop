import * as THREE from "three";
import { buildGeometry } from "../mesh/geometry";
import * as ops from "../mesh/operations";
import { add, centroid, cloneMesh, sub, type PolyMesh, type Vec3 } from "../mesh/PolyMesh";
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
  /** 모양 (오브젝트 기준 좌표). 처음 버전 파일에는 없어서 kind 로 다시 만든다. */
  mesh?: PolyMesh;
}

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

  add(kind: ShapeKind): string {
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

  duplicateSelected() {
    const mesh = this.getMesh(this.selectedId);
    if (!mesh) return;
    this.exitEditSilently();
    const data = toData(mesh);
    const id = this.createMesh({
      ...data,
      id: crypto.randomUUID(),
      name: this.uniqueName(data.name.replace(/ \d+$/, "")),
      position: [data.position[0] + 1, data.position[1], data.position[2] + 1],
    });
    this.selectedId = id;
    this.commit();
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
    upsert: { name: string; kind: ShapeKind; position: Vec3; rotation: Vec3; scale: Vec3; color?: string }[];
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
        applyData(existing, { ...toInfo(existing), ...o, color: o.color ?? toInfo(existing).color });
        lastId = existing.userData.id;
      } else {
        if (existing) this.disposeMesh(existing.userData.id);
        lastId = this.createMesh({ id: crypto.randomUUID(), ...o, color: o.color ?? DEFAULT_COLOR });
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

  /** 파일 내용을 불러와 새 장면으로 바꾼다. 실행 취소 기록은 비운다. */
  load(text: string) {
    const doc = JSON.parse(text) as SceneDocument;
    if (doc.app !== "modeler" || !Array.isArray(doc.objects)) {
      throw new Error("3D 모델러 프로젝트 파일이 아니에요.");
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
    if (this.editingId) this.exitEdit();
    else this.enterEdit();
  }

  enterEdit() {
    if (!this.selectedId || this.editingId) return;
    this.editingId = this.selectedId;
    this.editSelection = emptySelection(this.editSelection.mode);
    this.editVersion++;
    this.refresh();
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
    mesh.geometry.dispose();
    mesh.geometry = buildGeometry(poly);
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

  /** 돌출: 고른 면을 바깥으로 밀어내고 벽을 세운다. 크기와 상관없이 같은 거리로 보이도록 오브젝트 크기로 나눈다. */
  extrude() {
    const mesh = this.editingMesh();
    const distance = mesh ? 0.3 / Math.max(Math.abs(mesh.scale.x), Math.abs(mesh.scale.y), Math.abs(mesh.scale.z), 1e-3) : 0.3;
    return this.applyFaceOperation((poly, faces) => ops.extrudeFaces(poly, faces, distance));
  }

  inset() {
    return this.applyFaceOperation((poly, faces) => ops.insetFaces(poly, faces));
  }

  subdivide() {
    return this.applyFaceOperation((poly, faces) => ops.subdivideFaces(poly, faces));
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
    const mesh = new THREE.Mesh(
      buildGeometry(poly),
      new THREE.MeshStandardMaterial({
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
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    applyData(mesh, data);
    this.root.add(mesh);
    this.meshes.set(data.id, mesh);
    return data.id;
  }

  private disposeMesh(id: string) {
    const mesh = this.meshes.get(id)!;
    this.root.remove(mesh);
    mesh.geometry.dispose();
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
  };
}

function applyData(mesh: THREE.Mesh, data: ObjectInfo) {
  mesh.name = data.name;
  mesh.position.fromArray(data.position);
  mesh.rotation.set(...data.rotation);
  mesh.scale.fromArray(data.scale);
  (mesh.material as THREE.MeshStandardMaterial).color.set(data.color);
}
