import { cloneMesh, edgeKey, lerp, type PolyMesh } from "./PolyMesh";

/** 선마다 그 선을 쓰는 면 목록 */
function edgeFaceMap(mesh: PolyMesh) {
  const map = new Map<string, number[]>();
  mesh.faces.forEach((face, f) =>
    face.forEach((a, i) => {
      const key = edgeKey(a, face[(i + 1) % face.length]);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(f);
    }),
  );
  return map;
}

const keyToPair = (key: string) => key.split("-").map(Number) as [number, number];

/** 사각형 면에서 이 선의 맞은편 선 */
function oppositeEdge(face: number[], key: string): string | null {
  if (face.length !== 4) return null;
  for (let i = 0; i < 4; i++) {
    if (edgeKey(face[i], face[(i + 1) % 4]) === key) return edgeKey(face[(i + 2) % 4], face[(i + 3) % 4]);
  }
  return null;
}

/**
 * 선 고리 (edge ring): 사각형 면들을 가로질러 서로 마주 보는 선들. 루프 컷이 이 선들을 자른다.
 * 사각형이 아닌 면이나 가장자리를 만나면 멈춘다. faces 는 지나간 사각형 면들 (면 루프).
 */
export function edgeRing(mesh: PolyMesh, start: string): { edges: string[]; faces: number[] } {
  const edgeFaces = edgeFaceMap(mesh);
  const edges = new Set([start]);
  const faces = new Set<number>();
  const walk = (firstFace: number) => {
    let key = start;
    let f: number | undefined = firstFace;
    while (f !== undefined && !faces.has(f)) {
      const next = oppositeEdge(mesh.faces[f], key);
      if (!next) break;
      faces.add(f);
      edges.add(next);
      const from: number = f;
      f = edgeFaces.get(next)?.find((g) => g !== from);
      key = next;
    }
  };
  for (const f of edgeFaces.get(start) ?? []) walk(f);
  return { edges: [...edges], faces: [...faces] };
}

/**
 * 루프 컷 (Ctrl+R): 고리 모양으로 이어진 사각형 면들을 가운데로 한 줄 자른다.
 * 팔꿈치나 무릎처럼 구부릴 곳, 더 다듬을 곳에 선을 하나 더 넣을 때 쓴다.
 * 돌려주는 edges 는 새로 생긴 선들이라 바로 고르고 G 로 옮길 수 있다.
 */
export function loopCut(source: PolyMesh, start: string): { mesh: PolyMesh; edges: string[] } | null {
  const ring = edgeRing(source, start);
  if (ring.faces.length === 0) return null;
  const mesh = cloneMesh(source);

  const mid = new Map<string, number>();
  for (const key of ring.edges) {
    const [a, b] = keyToPair(key);
    mid.set(key, mesh.vertices.push(lerp(mesh.vertices[a], mesh.vertices[b], 0.5)) - 1);
  }

  const cutFaces = new Set(ring.faces);
  const newEdges: string[] = [];
  const faces: number[][] = [];
  mesh.faces.forEach((face, f) => {
    if (cutFaces.has(f)) {
      // 고리 선이 (p0,p1) 과 (p2,p3) 이 되도록 돌려 놓고 둘로 나눈다.
      for (let r = 0; r < 4; r++) {
        const p = [0, 1, 2, 3].map((i) => face[(i + r) % 4]);
        const m01 = mid.get(edgeKey(p[0], p[1]));
        const m23 = mid.get(edgeKey(p[2], p[3]));
        if (m01 === undefined || m23 === undefined) continue;
        faces.push([p[0], m01, m23, p[3]], [m01, p[1], p[2], m23]);
        newEdges.push(edgeKey(m01, m23));
        return;
      }
    }
    // 고리 끝에 붙은 다른 면에는 가운데 점만 끼워서 틈이 생기지 않게 한다.
    faces.push(
      face.flatMap((a, i) => {
        const m = mid.get(edgeKey(a, face[(i + 1) % face.length]));
        return m === undefined ? [a] : [a, m];
      }),
    );
  });
  return { mesh: { vertices: mesh.vertices, faces }, edges: newEdges };
}

/**
 * 선 루프 (Alt+클릭): 점 하나에 선이 4개씩 모이는 곳을 따라 곧게 이어지는 선들.
 * 도넛의 둘레나 원기둥의 한 바퀴처럼 한 줄을 통째로 고를 때 쓴다.
 */
export function edgeLoop(mesh: PolyMesh, start: string): string[] {
  const edgeFaces = edgeFaceMap(mesh);
  const vertexEdges = new Map<number, string[]>();
  for (const key of edgeFaces.keys()) {
    for (const v of keyToPair(key)) {
      if (!vertexEdges.has(v)) vertexEdges.set(v, []);
      vertexEdges.get(v)!.push(key);
    }
  }
  const loop = new Set([start]);
  const walk = (from: number, at: number) => {
    let key = edgeKey(from, at);
    while (true) {
      const around = vertexEdges.get(at) ?? [];
      const touching = new Set(edgeFaces.get(key));
      let next: string | undefined;
      if (around.length === 4) {
        // 지금 선과 면을 함께 쓰지 않는 선이 맞은편으로 곧게 이어지는 선이다.
        next = around.find((k) => k !== key && !edgeFaces.get(k)!.some((f) => touching.has(f)));
      } else if (touching.size === 1) {
        // 구멍 가장자리: 가장자리 선을 따라간다.
        next = around.find((k) => k !== key && edgeFaces.get(k)!.length === 1);
      } else {
        // 원기둥 뚜껑 같은 다각형 면의 둘레: 그 면의 테두리를 따라간다.
        const ngons = [...touching].filter((f) => mesh.faces[f].length > 4);
        next = around.find((k) => k !== key && edgeFaces.get(k)!.some((f) => ngons.includes(f)));
      }
      if (!next || loop.has(next)) return;
      loop.add(next);
      const [a, b] = keyToPair(next);
      const other = a === at ? b : a;
      key = next;
      at = other;
    }
  };
  const [a, b] = keyToPair(start);
  walk(a, b);
  walk(b, a);
  return [...loop];
}
