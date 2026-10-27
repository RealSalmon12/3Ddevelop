import { edgeKey, meshEdges, type PolyMesh } from "./PolyMesh";

export type SelectMode = "vertex" | "edge" | "face";

/** 편집 모드에서 고른 것. 고르는 방식(점/선/면)마다 따로 기억한다. */
export interface EditSelection {
  mode: SelectMode;
  vertices: Set<number>;
  /** edgeKey(a, b) */
  edges: Set<string>;
  faces: Set<number>;
}

export const emptySelection = (mode: SelectMode = "vertex"): EditSelection => ({
  mode,
  vertices: new Set(),
  edges: new Set(),
  faces: new Set(),
});

export function isEmpty(sel: EditSelection) {
  return selectedVertices(null, sel).size === 0;
}

/** 지금 고른 것에 들어 있는 모든 점 (움직일 때 쓴다) */
export function selectedVertices(mesh: PolyMesh | null, sel: EditSelection): Set<number> {
  if (sel.mode === "vertex") return new Set(sel.vertices);
  const out = new Set<number>();
  if (sel.mode === "edge") {
    sel.edges.forEach((key) => key.split("-").forEach((i) => out.add(Number(i))));
  } else if (mesh) {
    sel.faces.forEach((f) => mesh.faces[f]?.forEach((i) => out.add(i)));
  } else {
    // 면 개수만 필요할 때 (isEmpty)
    sel.faces.forEach((f) => out.add(f));
  }
  return out;
}

/** 지금 고른 것으로 완전히 둘러싸인 면 (돌출 같은 면 도구에 쓴다) */
export function selectedFaces(mesh: PolyMesh, sel: EditSelection): number[] {
  if (sel.mode === "face") return [...sel.faces].filter((f) => f < mesh.faces.length);
  const verts = selectedVertices(mesh, sel);
  const edges = sel.mode === "edge" ? sel.edges : null;
  return mesh.faces.flatMap((face, f) => {
    const allVerts = face.every((i) => verts.has(i));
    const allEdges = !edges || face.every((a, i) => edges.has(edgeKey(a, face[(i + 1) % face.length])));
    return allVerts && allEdges ? [f] : [];
  });
}

/** 고르는 방식을 바꿀 때 지금 고른 것을 최대한 이어서 고른다. */
export function convertSelection(mesh: PolyMesh, sel: EditSelection, mode: SelectMode): EditSelection {
  if (sel.mode === mode) return sel;
  const verts = selectedVertices(mesh, sel);
  const next = emptySelection(mode);
  if (mode === "vertex") verts.forEach((v) => next.vertices.add(v));
  if (mode === "edge") {
    for (const [a, b] of meshEdges(mesh)) if (verts.has(a) && verts.has(b)) next.edges.add(edgeKey(a, b));
  }
  if (mode === "face") selectedFaces(mesh, { ...sel }).forEach((f) => next.faces.add(f));
  return next;
}

export function selectAll(mesh: PolyMesh, mode: SelectMode): EditSelection {
  const sel = emptySelection(mode);
  if (mode === "vertex") mesh.vertices.forEach((_, i) => sel.vertices.add(i));
  if (mode === "edge") meshEdges(mesh).forEach(([a, b]) => sel.edges.add(edgeKey(a, b)));
  if (mode === "face") mesh.faces.forEach((_, i) => sel.faces.add(i));
  return sel;
}

/** 면 번호들을 지금 고르는 방식에 맞는 선택으로 */
export function selectionFromFaces(mesh: PolyMesh, faces: number[], mode: SelectMode): EditSelection {
  const sel = emptySelection("face");
  faces.forEach((f) => sel.faces.add(f));
  return convertSelection(mesh, sel, mode);
}
