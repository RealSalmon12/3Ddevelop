import {
  add,
  centroid,
  cloneMesh,
  edgeKey,
  faceCenter,
  faceNormal,
  lerp,
  normalize,
  removeUnusedVertices,
  scale,
  type PolyMesh,
  type Vec3,
} from "./PolyMesh";

/** 결과 메시와, 작업이 끝난 뒤 고를 면 번호 */
export interface FaceResult {
  mesh: PolyMesh;
  faces: number[];
}

/**
 * 돌출: 고른 면들을 한 덩어리로 바깥쪽으로 밀어내고, 옆에 벽을 세운다.
 * 덩어리의 가장자리 선마다 사각형 벽이 하나씩 생긴다.
 */
export function extrudeFaces(source: PolyMesh, faceIds: number[], distance: number): FaceResult {
  const mesh = cloneMesh(source);
  const selected = new Set(faceIds);

  // 고른 면들 안에서 몇 번 쓰였는지 세면, 한 번만 쓰인 선이 가장자리다.
  const edgeUse = new Map<string, number>();
  for (const f of selected) {
    const face = mesh.faces[f];
    face.forEach((a, i) => {
      const key = edgeKey(a, face[(i + 1) % face.length]);
      edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1);
    });
  }

  const normal = normalize(faceIds.map((f) => faceNormal(mesh, mesh.faces[f])).reduce(add, [0, 0, 0]));
  const offset = scale(normal, distance);

  // 고른 면의 점마다 새 점을 하나씩 만든다.
  const copy = new Map<number, number>();
  for (const f of selected) {
    for (const v of mesh.faces[f]) {
      if (!copy.has(v)) {
        copy.set(v, mesh.vertices.length);
        mesh.vertices.push(add(mesh.vertices[v], offset));
      }
    }
  }

  const walls: number[][] = [];
  for (const f of selected) {
    const face = mesh.faces[f];
    face.forEach((a, i) => {
      const b = face[(i + 1) % face.length];
      if (edgeUse.get(edgeKey(a, b)) === 1) walls.push([a, b, copy.get(b)!, copy.get(a)!]);
    });
    mesh.faces[f] = face.map((v) => copy.get(v)!);
  }
  mesh.faces.push(...walls);

  // 덩어리 안쪽에만 있던 옛 점은 이제 쓰이지 않는다.
  return { mesh: removeUnusedVertices(mesh), faces: faceIds };
}

/** 안쪽 면: 고른 면마다 테두리를 남기고 안쪽에 작은 면을 만든다. */
export function insetFaces(source: PolyMesh, faceIds: number[], amount = 0.2): FaceResult {
  const mesh = cloneMesh(source);
  for (const f of faceIds) {
    const face = mesh.faces[f];
    const center = faceCenter(mesh, face);
    const inner = face.map((v) => {
      mesh.vertices.push(lerp(mesh.vertices[v], center, amount));
      return mesh.vertices.length - 1;
    });
    face.forEach((a, i) => {
      const j = (i + 1) % face.length;
      mesh.faces.push([a, face[j], inner[j], inner[i]]);
    });
    mesh.faces[f] = inner;
  }
  return { mesh, faces: faceIds };
}

/**
 * 세분화: 고른 면을 더 작은 사각형들로 나눈다.
 * 나뉜 선에 붙어 있는 이웃 면에도 가운데 점을 끼워 넣어서 나중에 점을 움직여도 틈이 생기지 않는다.
 */
export function subdivideFaces(source: PolyMesh, faceIds: number[]): FaceResult {
  const mesh = cloneMesh(source);
  const selected = new Set(faceIds);

  const mids = new Map<string, number>();
  for (const f of selected) {
    const face = mesh.faces[f];
    face.forEach((a, i) => {
      const b = face[(i + 1) % face.length];
      const key = edgeKey(a, b);
      if (!mids.has(key)) {
        mids.set(key, mesh.vertices.length);
        mesh.vertices.push(lerp(mesh.vertices[a], mesh.vertices[b], 0.5));
      }
    });
  }

  const newFaces: number[][] = [];
  const newSelected: number[] = [];
  mesh.faces.forEach((face, f) => {
    if (!selected.has(f)) {
      // 이웃 면: 나뉜 선 사이에 가운데 점만 끼운다.
      newFaces.push(
        face.flatMap((a, i) => {
          const mid = mids.get(edgeKey(a, face[(i + 1) % face.length]));
          return mid === undefined ? [a] : [a, mid];
        }),
      );
      return;
    }
    mesh.vertices.push(faceCenter(mesh, face));
    const center = mesh.vertices.length - 1;
    face.forEach((corner, i) => {
      const n = face.length;
      const next = mids.get(edgeKey(corner, face[(i + 1) % n]))!;
      const prev = mids.get(edgeKey(face[(i - 1 + n) % n], corner))!;
      newSelected.push(newFaces.length);
      newFaces.push([corner, next, center, prev]);
    });
  });

  return { mesh: { vertices: mesh.vertices, faces: newFaces }, faces: newSelected };
}

/** 고른 면의 앞뒤 방향을 뒤집는다. */
export function flipFaces(source: PolyMesh, faceIds: number[]): FaceResult {
  const mesh = cloneMesh(source);
  for (const f of faceIds) mesh.faces[f].reverse();
  return { mesh, faces: faceIds };
}

/** 지우기. 점이나 선을 지우면 그것을 쓰던 면도 같이 사라진다. */
export function deleteElements(
  source: PolyMesh,
  target: { vertices?: Set<number>; edges?: Set<string>; faces?: Set<number> },
): PolyMesh {
  const faces = source.faces.filter((face, f) => {
    if (target.faces?.has(f)) return false;
    if (target.vertices && face.some((v) => target.vertices!.has(v))) return false;
    if (target.edges && face.some((a, i) => target.edges!.has(edgeKey(a, face[(i + 1) % face.length])))) {
      return false;
    }
    return true;
  });
  return removeUnusedVertices({ vertices: source.vertices, faces });
}

/** 고른 점들을 가운데 한 점으로 합친다. */
export function mergeVertices(source: PolyMesh, vertexIds: Set<number>): { mesh: PolyMesh; vertex: number } {
  const mesh = cloneMesh(source);
  const center: Vec3 = centroid([...vertexIds].map((v) => mesh.vertices[v]));
  const merged = mesh.vertices.length;
  mesh.vertices.push(center);

  mesh.faces = mesh.faces
    .map((face) => {
      const replaced = face.map((v) => (vertexIds.has(v) ? merged : v));
      // 붙어 있는 같은 점은 하나로
      return replaced.filter((v, i) => v !== replaced[(i + 1) % replaced.length]);
    })
    .filter((face) => new Set(face).size >= 3);

  const result = removeUnusedVertices(mesh);
  const vertex = result.vertices.findIndex((v) => v === center);
  return { mesh: result, vertex };
}
