// 블렌더식 모디파이어: 원래 모양은 그대로 두고, 보이는 모양과 내보내는 모양만 바꾼다.
// 순서는 블렌더 기본 쌓기와 같다: 대칭(Mirror) → 배열(Array) → 매끈하게(Subdivision).
import type { PolyMesh, Vec3 } from "./PolyMesh";
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

export const hasModifiers = (m: Modifiers) => !!(m.mirror?.length || (m.array && m.array.count > 1) || m.subdivision);

/** 모디파이어를 차례대로 걸어서 보일 모양을 만든다. */
export function applyModifiers(poly: PolyMesh, m: Modifiers): PolyMesh {
  let out = poly;
  for (const axis of m.mirror ?? []) out = mirrorMesh(out, axis);
  if (m.array && m.array.count > 1) out = arrayMesh(out, m.array);
  if (m.subdivision) out = subdivide(out, m.subdivision);
  return out;
}
