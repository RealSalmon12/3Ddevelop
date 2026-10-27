import { add, edgeKey, faceCenter, lerp, scale, type PolyMesh, type Vec3 } from "./PolyMesh";

/** 매끈하게 만들기를 몇 번까지 겹칠 수 있는지. 한 번 할 때마다 면이 4배쯤 늘어난다. */
export const MAX_SUBDIVISION = 3;

/**
 * 캐트멀-클라크 세분화 한 번. 블렌더의 ‘서브디비전 표면’ 모디파이어와 같은 방법이다.
 * 모든 면을 사각형으로 나누면서 점들을 이웃의 평균 쪽으로 당겨서, 각진 상자가 둥근 모양이 된다.
 * 구멍(가장자리)이 있는 메시는 가장자리 선을 따라서만 부드럽게 해서 모양이 줄어들지 않게 한다.
 */
export function catmullClark(mesh: PolyMesh): PolyMesh {
  const facePoints = mesh.faces.map((face) => faceCenter(mesh, face));

  // 선마다 붙어 있는 면
  const edgeFaces = new Map<string, number[]>();
  const edgeEnds = new Map<string, [number, number]>();
  mesh.faces.forEach((face, f) => {
    face.forEach((a, i) => {
      const b = face[(i + 1) % face.length];
      const key = edgeKey(a, b);
      if (!edgeFaces.has(key)) {
        edgeFaces.set(key, []);
        edgeEnds.set(key, [a, b]);
      }
      edgeFaces.get(key)!.push(f);
    });
  });

  const vertices: Vec3[] = [];
  const facePointIndex = facePoints.map((p) => vertices.push(p) - 1);

  const edgePointIndex = new Map<string, number>();
  for (const [key, faces] of edgeFaces) {
    const [a, b] = edgeEnds.get(key)!;
    const mid = lerp(mesh.vertices[a], mesh.vertices[b], 0.5);
    const point =
      faces.length === 2
        ? scale(add(add(mesh.vertices[a], mesh.vertices[b]), add(facePoints[faces[0]], facePoints[faces[1]])), 0.25)
        : mid;
    edgePointIndex.set(key, vertices.push(point) - 1);
  }

  // 점마다 이웃 면과 이웃 선
  const vertexFaces: number[][] = mesh.vertices.map(() => []);
  mesh.faces.forEach((face, f) => face.forEach((v) => vertexFaces[v].push(f)));
  const vertexEdges: string[][] = mesh.vertices.map(() => []);
  for (const [key, [a, b]] of edgeEnds) {
    vertexEdges[a].push(key);
    vertexEdges[b].push(key);
  }

  const vertexPointIndex = mesh.vertices.map((p, v) => {
    const edges = vertexEdges[v];
    const boundary = edges.filter((k) => edgeFaces.get(k)!.length !== 2);
    let point: Vec3 = p;
    if (boundary.length === 2) {
      // 가장자리 점: 가장자리 선 두 개의 가운데와 섞는다.
      const mids = boundary.map((k) => {
        const [a, b] = edgeEnds.get(k)!;
        return lerp(mesh.vertices[a], mesh.vertices[b], 0.5);
      });
      point = add(scale(p, 0.5), scale(add(mids[0], mids[1]), 0.25));
    } else if (boundary.length === 0 && vertexFaces[v].length >= 3) {
      const n = vertexFaces[v].length;
      const F = scale(vertexFaces[v].map((f) => facePoints[f]).reduce(add, [0, 0, 0] as Vec3), 1 / n);
      const R = scale(
        edges
          .map((k) => {
            const [a, b] = edgeEnds.get(k)!;
            return lerp(mesh.vertices[a], mesh.vertices[b], 0.5);
          })
          .reduce(add, [0, 0, 0] as Vec3),
        1 / edges.length,
      );
      point = scale(add(add(F, scale(R, 2)), scale(p, n - 3)), 1 / n);
    }
    // 그 밖(가장자리가 여러 갈래로 갈라지는 점, 외톨이 점)은 그대로 둔다.
    return vertices.push(point) - 1;
  });

  const faces: number[][] = [];
  mesh.faces.forEach((face, f) => {
    const n = face.length;
    face.forEach((v, i) => {
      const next = edgePointIndex.get(edgeKey(v, face[(i + 1) % n]))!;
      const prev = edgePointIndex.get(edgeKey(face[(i - 1 + n) % n], v))!;
      faces.push([vertexPointIndex[v], next, facePointIndex[f], prev]);
    });
  });
  return { vertices, faces };
}

export function subdivide(mesh: PolyMesh, levels: number): PolyMesh {
  let out = mesh;
  for (let i = 0; i < Math.min(levels, MAX_SUBDIVISION); i++) out = catmullClark(out);
  return out;
}
