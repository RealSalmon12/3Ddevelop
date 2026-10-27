/**
 * 편집할 수 있는 다각형 메시. 블렌더처럼 삼각형이 아니라 사각형, 다각형 면을 그대로 들고 있어서
 * 점, 선, 면 단위로 고르고 돌출할 수 있다.
 *
 * - vertices: 점 위치 [x, y, z] 목록 (오브젝트 기준 좌표)
 * - faces: 면마다 점 번호를 바깥에서 봤을 때 반시계 방향으로 나열
 */
export type Vec3 = [number, number, number];

export interface PolyMesh {
  vertices: Vec3[];
  faces: number[][];
}

export const edgeKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

export function cloneMesh(mesh: PolyMesh): PolyMesh {
  return { vertices: mesh.vertices.map((v) => [...v] as Vec3), faces: mesh.faces.map((f) => [...f]) };
}

/** 모든 선(모서리)을 중복 없이 [a, b] 로 */
export function meshEdges(mesh: PolyMesh): [number, number][] {
  const seen = new Map<string, [number, number]>();
  for (const face of mesh.faces) {
    face.forEach((a, i) => {
      const b = face[(i + 1) % face.length];
      const key = edgeKey(a, b);
      if (!seen.has(key)) seen.set(key, a < b ? [a, b] : [b, a]);
    });
  }
  return [...seen.values()];
}

// ---------- 벡터 계산 ----------

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => add(a, scale(sub(b, a), t));
export function normalize(a: Vec3): Vec3 {
  const len = Math.hypot(...a);
  return len > 1e-12 ? scale(a, 1 / len) : [0, 0, 0];
}

export function centroid(points: Vec3[]): Vec3 {
  const sum = points.reduce(add, [0, 0, 0]);
  return scale(sum, 1 / Math.max(points.length, 1));
}

/** 면의 바깥 방향 (뉴웰 방법이라 다각형이 조금 휘어 있어도 안정적이다) */
export function faceNormal(mesh: PolyMesh, face: number[]): Vec3 {
  const n: Vec3 = [0, 0, 0];
  face.forEach((ia, i) => {
    const a = mesh.vertices[ia];
    const b = mesh.vertices[face[(i + 1) % face.length]];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  });
  return normalize(n);
}

export const faceCenter = (mesh: PolyMesh, face: number[]) => centroid(face.map((i) => mesh.vertices[i]));

/** 쓰이지 않는 점을 지우고 번호를 다시 매긴다. */
export function removeUnusedVertices(mesh: PolyMesh): PolyMesh {
  const remap = new Map<number, number>();
  const vertices: Vec3[] = [];
  const faces = mesh.faces.map((face) =>
    face.map((i) => {
      if (!remap.has(i)) {
        remap.set(i, vertices.length);
        vertices.push(mesh.vertices[i]);
      }
      return remap.get(i)!;
    }),
  );
  return { vertices, faces };
}
