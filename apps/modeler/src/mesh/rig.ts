/**
 * 뼈대 (블렌더의 아마추어, 리깅): 모양 안에 뼈를 넣고, 점마다 어느 뼈를 얼마나 따라갈지(가중치)를 정해 두면
 * 뼈를 돌리는 것만으로 팔다리가 자연스럽게 구부러진다. 포즈를 키프레임으로 남기면 캐릭터 애니메이션이 되고,
 * GLB 로 내보내면 뼈대가 있는 모델(스킨드 메시)이라 로블록스, 유니티, 블렌더에서 그대로 움직인다.
 *
 * 좌표는 모두 오브젝트 기준. 뼈 b 의 포즈 행렬은 M_b = M_부모 · T(머리) · R(회전) · T(-머리) 이다.
 * 즉 뼈는 자기 머리(관절)를 중심으로, 부모가 움직인 자리에서 돈다.
 */
import * as THREE from "three";
import type { PolyMesh, Vec3 } from "./PolyMesh";

export interface Bone {
  id: string;
  name: string;
  parent: string | null;
  /** 쉬는 자세(레스트)의 관절 위치 */
  head: Vec3;
  /** 뼈 끝. 이어진 자식 뼈의 머리와 같다 */
  tail: Vec3;
}

export interface Rig {
  bones: Bone[];
  /** 지금 포즈: 뼈마다 회전 (오일러 XYZ, 라디안). 없으면 0 */
  pose: Record<string, Vec3>;
}

export const MAX_INFLUENCES = 4;

const v3 = (a: Vec3) => new THREE.Vector3(a[0], a[1], a[2]);
const id = () => Math.random().toString(36).slice(2, 10);

export const cloneRig = (r: Rig): Rig => ({
  bones: r.bones.map((b) => ({ ...b, head: [...b.head] as Vec3, tail: [...b.tail] as Vec3 })),
  pose: Object.fromEntries(Object.entries(r.pose).map(([k, v]) => [k, [...v] as Vec3])),
});

export const isRestPose = (pose: Record<string, Vec3>) => Object.values(pose).every((r) => Math.abs(r[0]) + Math.abs(r[1]) + Math.abs(r[2]) < 1e-6);

/** 부모가 먼저 오게 정렬 */
export function sortBones(bones: Bone[]): Bone[] {
  const out: Bone[] = [];
  const done = new Set<string>();
  const byId = new Map(bones.map((b) => [b.id, b]));
  const visit = (b: Bone) => {
    if (done.has(b.id)) return;
    if (b.parent && byId.has(b.parent)) visit(byId.get(b.parent)!);
    done.add(b.id);
    out.push(b);
  };
  bones.forEach(visit);
  return out;
}

/** 뼈마다 포즈 행렬 (오브젝트 기준) */
export function poseMatrices(rig: Rig, pose: Record<string, Vec3> = rig.pose): Map<string, THREE.Matrix4> {
  const out = new Map<string, THREE.Matrix4>();
  const e = new THREE.Euler();
  const r = new THREE.Matrix4();
  const t = new THREE.Matrix4();
  for (const b of sortBones(rig.bones)) {
    const m = b.parent && out.has(b.parent) ? out.get(b.parent)!.clone() : new THREE.Matrix4();
    const rot = pose[b.id] ?? [0, 0, 0];
    m.multiply(t.makeTranslation(b.head[0], b.head[1], b.head[2]));
    m.multiply(r.makeRotationFromEuler(e.set(rot[0], rot[1], rot[2])));
    m.multiply(t.makeTranslation(-b.head[0], -b.head[1], -b.head[2]));
    out.set(b.id, m);
  }
  return out;
}

/** 점에서 선분까지 거리 */
function segDist(p: Vec3, a: Vec3, b: Vec3) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
  const len2 = abx * abx + aby * aby + abz * abz || 1e-12;
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / len2));
  const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export interface Weights {
  /** 점마다 MAX_INFLUENCES 개의 뼈 번호 (rig.bones 순서) */
  index: Uint16Array;
  weight: Float32Array;
}

/**
 * 자동 가중치 (블렌더의 "자동 가중치로"): 가까운 뼈일수록 크게 따라간다. 거리의 네제곱에 반비례로 정하고,
 * 이웃 점끼리 두 번 고르게 섞어서 관절 둘레가 부드럽게 접히게 한다.
 */
export function autoWeights(poly: PolyMesh, bones: Bone[]): Weights {
  const n = poly.vertices.length;
  const nb = bones.length;
  const full = new Float32Array(n * nb);
  // 뼈 길이에 견줘 거리를 잰다 (큰 모델이든 작은 모델이든 같게)
  const scale = Math.max(1e-6, bones.reduce((a, b) => a + v3(b.head).distanceTo(v3(b.tail)), 0) / Math.max(1, nb));
  for (let i = 0; i < n; i++) {
    const p = poly.vertices[i];
    let sum = 0;
    for (let k = 0; k < nb; k++) {
      const d = segDist(p, bones[k].head, bones[k].tail) / scale;
      const w = 1 / (d * d * d * d + 1e-4);
      full[i * nb + k] = w;
      sum += w;
    }
    for (let k = 0; k < nb; k++) full[i * nb + k] /= sum;
  }
  // 이웃 점끼리 고르게
  const nbrs: number[][] = poly.vertices.map(() => []);
  for (const f of poly.faces)
    f.forEach((a, i) => {
      const b = f[(i + 1) % f.length];
      nbrs[a].push(b);
      nbrs[b].push(a);
    });
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(full.length);
    for (let i = 0; i < n; i++) {
      const list = nbrs[i];
      for (let k = 0; k < nb; k++) {
        let s = full[i * nb + k];
        for (const j of list) s += full[j * nb + k];
        next[i * nb + k] = s / (list.length + 1);
      }
    }
    full.set(next);
  }
  // 큰 것 넷만 남긴다
  const index = new Uint16Array(n * MAX_INFLUENCES);
  const weight = new Float32Array(n * MAX_INFLUENCES);
  const order = [...Array(nb).keys()];
  for (let i = 0; i < n; i++) {
    order.sort((a, b) => full[i * nb + b] - full[i * nb + a]);
    let sum = 0;
    for (let k = 0; k < Math.min(MAX_INFLUENCES, nb); k++) sum += full[i * nb + order[k]];
    for (let k = 0; k < Math.min(MAX_INFLUENCES, nb); k++) {
      index[i * MAX_INFLUENCES + k] = order[k];
      weight[i * MAX_INFLUENCES + k] = full[i * nb + order[k]] / (sum || 1);
    }
  }
  return { index, weight };
}

/** 점들을 포즈대로 움직인다 (선형 블렌드 스키닝) */
export function deform(poly: PolyMesh, rig: Rig, w: Weights, pose: Record<string, Vec3> = rig.pose): PolyMesh {
  const mats = poseMatrices(rig, pose);
  const list = rig.bones.map((b) => mats.get(b.id)!.elements);
  const vertices = poly.vertices.map((p, i) => {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < MAX_INFLUENCES; k++) {
      const wt = w.weight[i * MAX_INFLUENCES + k];
      if (!wt) continue;
      const e = list[w.index[i * MAX_INFLUENCES + k]];
      x += wt * (e[0] * p[0] + e[4] * p[1] + e[8] * p[2] + e[12]);
      y += wt * (e[1] * p[0] + e[5] * p[1] + e[9] * p[2] + e[13]);
      z += wt * (e[2] * p[0] + e[6] * p[1] + e[10] * p[2] + e[14]);
    }
    return [x, y, z] as Vec3;
  });
  return { vertices, faces: poly.faces };
}

/** 포즈를 적용한 관절 위치 (화면에 뼈를 그릴 때) */
export function posedJoints(rig: Rig): Map<string, { head: THREE.Vector3; tail: THREE.Vector3 }> {
  const mats = poseMatrices(rig);
  const out = new Map<string, { head: THREE.Vector3; tail: THREE.Vector3 }>();
  for (const b of rig.bones) {
    const m = mats.get(b.id)!;
    out.set(b.id, { head: v3(b.head).applyMatrix4(m), tail: v3(b.tail).applyMatrix4(m) });
  }
  return out;
}

// ---------- 뼈대 틀 ----------

function bounds(poly: PolyMesh) {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const v of poly.vertices)
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], v[a]);
      max[a] = Math.max(max[a], v[a]);
    }
  return { min, max };
}

/** 높이 y 둘레 띠에서 가운데로부터 가장 먼 x */
function reachAt(poly: PolyMesh, y: number, band: number, cx: number) {
  let r = 0;
  for (const v of poly.vertices) if (Math.abs(v[1] - y) < band) r = Math.max(r, Math.abs(v[0] - cx));
  return r;
}

/**
 * 사람 뼈대 (블렌더의 Human Meta-Rig 를 줄인 것): 모양 크기를 재서 엉덩이, 허리, 가슴, 목, 머리, 양팔, 양다리를
 * 맞춰 넣는다. 캐릭터는 앞(+Z)을 보고 팔을 옆으로 벌린(T, A 자세) 모양이면 잘 맞는다.
 */
export function humanRig(poly: PolyMesh): Bone[] {
  const { min, max } = bounds(poly);
  const H = max[1] - min[1] || 1;
  const cx = (min[0] + max[0]) / 2;
  const cz = (min[2] + max[2]) / 2;
  const Y = (t: number) => min[1] + H * t;
  const P = (x: number, t: number): Vec3 => [cx + x, Y(t), cz];
  const shoulderY = 0.8;
  const span = Math.max(reachAt(poly, Y(shoulderY), H * 0.06, cx), H * 0.18);
  const hipX = Math.max(reachAt(poly, Y(0.45), H * 0.04, cx) * 0.5, H * 0.05);
  const shoulderX = Math.min(span * 0.35, H * 0.12);
  const bones: Bone[] = [];
  const add = (name: string, parent: string | null, head: Vec3, tail: Vec3) => {
    const b: Bone = { id: id(), name, parent, head, tail };
    bones.push(b);
    return b.id;
  };
  const hips = add("엉덩이", null, P(0, 0.5), P(0, 0.58));
  const spine = add("허리", hips, P(0, 0.58), P(0, 0.7));
  const chest = add("가슴", spine, P(0, 0.7), P(0, 0.82));
  const neck = add("목", chest, P(0, 0.82), P(0, 0.87));
  add("머리", neck, P(0, 0.87), P(0, 1));
  for (const [side, s] of [["왼", 1], ["오른", -1]] as const) {
    const sh = add(`${side} 어깨`, chest, P(s * 0.02 * H, shoulderY), P(s * shoulderX, shoulderY));
    const elbow = shoulderX + (span - shoulderX) * 0.45;
    const wrist = shoulderX + (span - shoulderX) * 0.85;
    const up = add(`${side} 위팔`, sh, P(s * shoulderX, shoulderY), P(s * elbow, shoulderY));
    const lo = add(`${side} 아래팔`, up, P(s * elbow, shoulderY), P(s * wrist, shoulderY));
    add(`${side} 손`, lo, P(s * wrist, shoulderY), P(s * span, shoulderY));
    const th = add(`${side} 허벅지`, hips, P(s * hipX, 0.48), P(s * hipX, 0.26));
    const sn = add(`${side} 정강이`, th, P(s * hipX, 0.26), P(s * hipX, 0.05));
    const foot = add(`${side} 발`, sn, P(s * hipX, 0.05), [cx + s * hipX, Y(0.01), cz + H * 0.08]);
    void foot;
  }
  return bones;
}

/** 사슬 뼈대: 가장 긴 방향으로 n 마디 (꼬리, 줄, 촉수, 나무) */
export function chainRig(poly: PolyMesh, count: number): Bone[] {
  const { min, max } = bounds(poly);
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const axis = size.indexOf(Math.max(...size));
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const at = (t: number): Vec3 => {
    const p = [...center] as Vec3;
    p[axis] = min[axis] + size[axis] * t;
    return p;
  };
  const bones: Bone[] = [];
  let parent: string | null = null;
  for (let i = 0; i < count; i++) {
    const b: Bone = { id: id(), name: `마디 ${i + 1}`, parent, head: at(i / count), tail: at((i + 1) / count) };
    bones.push(b);
    parent = b.id;
  }
  return bones;
}

/** 고른 뼈 끝에 이어서 새 뼈 (블렌더의 E 돌출) */
export function extrudeBone(bones: Bone[], from: Bone): Bone {
  const dir = v3(from.tail).sub(v3(from.head));
  const tail = v3(from.tail).add(dir.multiplyScalar(0.8));
  let n = 2;
  const base = from.name.replace(/ \d+$/, "");
  while (bones.some((b) => b.name === `${base} ${n}`)) n++;
  return { id: id(), name: `${base} ${n}`, parent: from.id, head: [...from.tail] as Vec3, tail: [tail.x, tail.y, tail.z] };
}

/** 이름의 왼/오른을 바꾼 짝 뼈 (대칭 포즈용) */
export function mirrorName(name: string) {
  if (name.includes("왼")) return name.replace("왼", "오른");
  if (name.includes("오른")) return name.replace("오른", "왼");
  return null;
}

/** 쉬는 자세 기준 뼈 하나당 three.js Bone (GLB 내보내기용). 위치는 부모 머리 기준 */
export function buildSkeleton(rig: Rig): { root: THREE.Bone[]; bones: THREE.Bone[] } {
  const map = new Map<string, THREE.Bone>();
  const byId = new Map(rig.bones.map((b) => [b.id, b]));
  const roots: THREE.Bone[] = [];
  for (const b of sortBones(rig.bones)) {
    const node = new THREE.Bone();
    node.name = b.name;
    const parent = b.parent ? byId.get(b.parent) : undefined;
    const ph = parent ? parent.head : ([0, 0, 0] as Vec3);
    node.position.set(b.head[0] - ph[0], b.head[1] - ph[1], b.head[2] - ph[2]);
    if (parent) map.get(parent.id)!.add(node);
    else roots.push(node);
    map.set(b.id, node);
  }
  return { root: roots, bones: rig.bones.map((b) => map.get(b.id)!) };
}
