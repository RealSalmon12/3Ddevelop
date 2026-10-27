// 블렌더식 모디파이어: 원래 모양은 그대로 두고, 보이는 모양과 내보내는 모양만 바꾼다.
// 순서는 블렌더 기본 쌓기와 같다: 대칭(Mirror) → 배열(Array) → 두께(Solidify) → 매끈하게(Subdivision).
import { add, faceNormal, normalize, scale, type PolyMesh, type Vec3 } from "./PolyMesh";
import { subdivide } from "./subdivision";

export type Axis = "x" | "y" | "z";
export const AXES: Axis[] = ["x", "y", "z"];

export interface ArrayModifier {
  /** 모두 몇 개 (원래 것 포함) */
  count: number;
  /** 하나 옮길 때마다 모양 크기의 몇 배만큼 (블렌더의 Relative Offset) */
  offset: Vec3;
}

export interface Modifiers {
  mirror?: Axis[];
  array?: ArrayModifier;
  /** 두께 (0 이면 끔). 면 안쪽으로 이만큼 두껍게 만든다 */
  solidify?: number;
  subdivision?: number;
}

/** 이만큼 가까우면 대칭면 위의 점으로 보고 반쪽과 붙인다 (블렌더의 Clipping/Merge) */
const MERGE = 1e-4;

/** 오브젝트 원점을 지나는 면에 비춰 반대쪽을 만든다. 대칭면 위의 점은 함께 쓴다. */
export function mirrorMesh(poly: PolyMesh, axis: Axis): PolyMesh {
  const a = "xyz".indexOf(axis);
  const vertices = poly.vertices.map((v) => [...v] as Vec3);
  const map = poly.vertices.map((v, i) => {
    if (Math.abs(v[a]) <= MERGE) return i;
    const m = [...v] as Vec3;
    m[a] = -m[a];
    vertices.push(m);
    return vertices.length - 1;
  });
  const faces = poly.faces.map((f) => [...f]);
  for (const f of poly.faces) {
    // 대칭면 위에 누운 면은 짝이 없다
    if (f.every((i) => map[i] === i)) continue;
    faces.push(f.map((i) => map[i]).reverse());
  }
  return { vertices, faces };
}

function bounds(poly: PolyMesh) {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const v of poly.vertices)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], v[k]);
      max[k] = Math.max(max[k], v[k]);
    }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] as Vec3 };
}

/** 같은 모양을 여러 개 늘어놓는다 (계단, 울타리, 사슬) */
export function arrayMesh(poly: PolyMesh, mod: ArrayModifier): PolyMesh {
  const count = Math.max(1, Math.min(64, Math.round(mod.count)));
  if (count === 1 || !poly.vertices.length) return poly;
  const { size } = bounds(poly);
  const step: Vec3 = [size[0] * mod.offset[0], size[1] * mod.offset[1], size[2] * mod.offset[2]];
  const n = poly.vertices.length;
  const vertices: Vec3[] = [];
  const faces: number[][] = [];
  for (let c = 0; c < count; c++) {
    for (const v of poly.vertices) vertices.push([v[0] + step[0] * c, v[1] + step[1] * c, v[2] + step[2] * c]);
    for (const f of poly.faces) faces.push(f.map((i) => i + c * n));
  }
  return { vertices, faces };
}

/**
 * 두께 주기 (블렌더의 Solidify): 얇은 판, 컵, 옷, 머리카락 카드에 두께를 준다.
 * 점마다 둘레 면들의 바깥 방향을 평균내 안쪽으로 밀어 안쪽 껍데기를 만들고, 열린 가장자리는 띠로 막는다.
 * 닫힌 모양은 속이 빈 껍데기가 된다 (3D 프린트용 속 비우기).
 */
export function solidifyMesh(poly: PolyMesh, thickness: number): PolyMesh {
  const n = poly.vertices.length;
  if (!n || !thickness) return poly;
  const normals: Vec3[] = poly.vertices.map(() => [0, 0, 0]);
  for (const f of poly.faces) {
    const fn = faceNormal(poly, f);
    for (const i of f) normals[i] = add(normals[i], fn);
  }
  const vertices = poly.vertices.map((v) => [...v] as Vec3);
  for (let i = 0; i < n; i++) vertices.push(add(poly.vertices[i], scale(normalize(normals[i]), -thickness)));
  const faces = poly.faces.map((f) => [...f]);
  // 안쪽 껍데기는 뒤집어서 (안에서 바깥을 보게)
  for (const f of poly.faces) faces.push(f.map((i) => i + n).reverse());
  // 한 면만 쓰는 선 = 열린 가장자리. 바깥 면이 a→b 로 지나가면 띠는 b→a 로 붙인다.
  const uses = new Map<string, number>();
  const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  for (const f of poly.faces) f.forEach((a, k) => uses.set(key(a, f[(k + 1) % f.length]), (uses.get(key(a, f[(k + 1) % f.length])) ?? 0) + 1));
  for (const f of poly.faces)
    f.forEach((a, k) => {
      const b = f[(k + 1) % f.length];
      if (uses.get(key(a, b)) === 1) faces.push([b, a, a + n, b + n]);
    });
  return { vertices, faces };
}

export const hasModifiers = (m: Modifiers) => !!(m.mirror?.length || (m.array && m.array.count > 1) || m.solidify || m.subdivision);

/** 모디파이어를 차례대로 걸어서 보일 모양을 만든다. */
export function applyModifiers(poly: PolyMesh, m: Modifiers): PolyMesh {
  let out = poly;
  for (const axis of m.mirror ?? []) out = mirrorMesh(out, axis);
  if (m.array && m.array.count > 1) out = arrayMesh(out, m.array);
  if (m.solidify) out = solidifyMesh(out, m.solidify);
  if (m.subdivision) out = subdivide(out, m.subdivision);
  return out;
}
