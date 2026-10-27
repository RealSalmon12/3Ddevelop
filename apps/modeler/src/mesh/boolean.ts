/* 불리언: 두 모양을 합치거나, 하나로 다른 하나를 파내거나, 겹친 곳만 남긴다 (블렌더 Boolean, 로블록스 Union/Negate) */
import * as THREE from "three";
import { ADDITION, Brush, Evaluator, INTERSECTION, SUBTRACTION } from "three-bvh-csg";
import { buildGeometry } from "./geometry";
import { cross, dot, faceNormal, normalize, sub, type PolyMesh, type Vec3 } from "./PolyMesh";

export type BooleanOp = "union" | "difference" | "intersect";

export const BOOLEAN_OPS: { op: BooleanOp; label: string; icon: string; hint: string }[] = [
  { op: "union", label: "합치기", icon: "⊕", hint: "두 모양을 하나로 붙여요 (로블록스의 Union)" },
  { op: "difference", label: "빼기", icon: "⊖", hint: "고른 대상 모양만큼 파내요. 구멍, 홈, 창문 만들 때 (로블록스의 Negate)" },
  { op: "intersect", label: "겹친 곳만", icon: "⊗", hint: "두 모양이 겹친 부분만 남겨요" },
];

const OPS = { union: ADDITION, difference: SUBTRACTION, intersect: INTERSECTION };

function brushOf(poly: PolyMesh, matrix: THREE.Matrix4) {
  const g = buildGeometry(poly, 0);
  for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal") g.deleteAttribute(name);
  const brush = new Brush(g);
  brush.applyMatrix4(matrix);
  brush.updateMatrixWorld(true);
  return brush;
}

/**
 * a 와 b 를 장면 좌표에 놓고 계산한다. 결과는 a 의 오브젝트 좌표 (계산기가 a 기준으로 돌려준다).
 * 결과가 비면 null (예: 겹치지 않는데 ‘겹친 곳만’).
 */
export function booleanPoly(a: PolyMesh, aMatrix: THREE.Matrix4, b: PolyMesh, bMatrix: THREE.Matrix4, op: BooleanOp): PolyMesh | null {
  const evaluator = new Evaluator();
  evaluator.attributes = ["position", "normal"];
  evaluator.useGroups = false;
  const result = evaluator.evaluate(brushOf(a, aMatrix), brushOf(b, bMatrix), OPS[op]);
  const pos = result.geometry.getAttribute("position");
  if (!pos || pos.count < 3) return null;
  const index = result.geometry.getIndex();
  const v = new THREE.Vector3();
  // 같은 자리의 점은 하나로 (편집 모드에서 이어진 모양으로 다룰 수 있게)
  const vertices: Vec3[] = [];
  const lookup = new Map<string, number>();
  const pointAt = (i: number) => {
    v.fromBufferAttribute(pos, i);
    const key = `${Math.round(v.x * 1e4)},${Math.round(v.y * 1e4)},${Math.round(v.z * 1e4)}`;
    let n = lookup.get(key);
    if (n === undefined) {
      n = vertices.length;
      vertices.push([v.x, v.y, v.z]);
      lookup.set(key, n);
    }
    return n;
  };
  const faces: number[][] = [];
  const count = index ? index.count : pos.count;
  for (let t = 0; t + 2 < count; t += 3) {
    const tri = [0, 1, 2].map((k) => pointAt(index ? index.getX(t + k) : t + k));
    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue;
    // 넓이가 거의 없는 삼각형은 버린다
    const [p, q, r] = tri.map((i) => vertices[i]);
    const c = cross(sub(q, p), sub(r, p));
    if (Math.hypot(c[0], c[1], c[2]) < 1e-9) continue;
    faces.push(tri);
  }
  result.geometry.dispose();
  if (!faces.length) return null;
  return trisToQuads({ vertices, faces });
}

/** 같은 평면에서 이웃한 삼각형 두 개가 볼록한 네모가 되면 하나로 (블렌더 Alt+J) */
export function trisToQuads(mesh: PolyMesh): PolyMesh {
  const normals = mesh.faces.map((f) => normalize(faceNormal(mesh, f)));
  const edgeFaces = new Map<string, number[]>();
  mesh.faces.forEach((f, i) =>
    f.forEach((a, k) => {
      const b = f[(k + 1) % f.length];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      edgeFaces.set(key, [...(edgeFaces.get(key) ?? []), i]);
    }),
  );
  const used = new Set<number>();
  const out: number[][] = [];
  const convex = (quad: number[], n: Vec3) =>
    quad.every((_, k) => {
      const [p, q, r] = [quad[k], quad[(k + 1) % 4], quad[(k + 2) % 4]].map((i) => mesh.vertices[i]);
      return dot(cross(sub(q, p), sub(r, q)), n) > 1e-9;
    });
  mesh.faces.forEach((f, i) => {
    if (used.has(i)) return;
    if (f.length === 3) {
      // 가장 긴 변부터 이웃을 찾는다 (네모의 대각선일 가능성이 크다)
      const edges = [0, 1, 2].sort((x, y) => {
        const len = (k: number) => {
          const d = sub(mesh.vertices[f[k]], mesh.vertices[f[(k + 1) % 3]]);
          return dot(d, d);
        };
        return len(y) - len(x);
      });
      for (const k of edges) {
        const a = f[k];
        const b = f[(k + 1) % 3];
        const other = (edgeFaces.get(a < b ? `${a}-${b}` : `${b}-${a}`) ?? []).find((j) => j !== i && !used.has(j) && mesh.faces[j].length === 3);
        if (other === undefined || dot(normals[i], normals[other]) < 0.9999) continue;
        const g = mesh.faces[other];
        const far = g.find((x) => x !== a && x !== b)!;
        const quad = [f[(k + 2) % 3], a, far, b];
        if (!convex(quad, normals[i])) continue;
        used.add(i);
        used.add(other);
        out.push(quad);
        return;
      }
    }
    used.add(i);
    out.push(f);
  });
  return { vertices: mesh.vertices, faces: out };
}
