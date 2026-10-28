/**
 * UV 펼치기 (블렌더의 Smart UV Project): 3D 모양의 겉면을 종이처럼 잘라 펼쳐서 네모난 그림(텍스처) 위에 늘어놓는다.
 * 그래야 그림을 칠하거나 사진을 입힐 수 있다.
 *
 * 방법: 이웃한 면끼리 방향이 비슷하면(각도 제한 안) 한 조각(섬)으로 묶고, 조각마다 그 방향에서 내려다본 모양으로
 * 납작하게 편다. 모든 조각을 같은 비율로 펴서 어디를 칠해도 붓 크기가 같고, 작은 틈을 두고 선반처럼 쌓아 넣는다.
 */
import { add, cross, dot, faceNormal, normalize, sub, type PolyMesh, type Vec3 } from "./PolyMesh";

export type UV = [number, number];

/** 면마다, 면의 점 순서대로 UV (0~1) */
export type FaceUVs = UV[][];

/** 면 개수와 점 개수가 같으면 같은 UV 를 쓸 수 있다 */
export const uvFits = (poly: PolyMesh, uvs: FaceUVs | undefined): uvs is FaceUVs =>
  !!uvs && uvs.length === poly.faces.length && poly.faces.every((f, i) => uvs[i]?.length === f.length);

interface Chart {
  faces: number[];
  /** 면 점마다 펴진 2D 위치 (장면 길이 단위) */
  pts: Map<number, UV[]>;
  minX: number;
  minY: number;
  w: number;
  h: number;
  x: number;
  y: number;
}

function faceArea(poly: PolyMesh, face: number[]) {
  let n: Vec3 = [0, 0, 0];
  const a = poly.vertices[face[0]];
  for (let i = 1; i < face.length - 1; i++) n = add(n, cross(sub(poly.vertices[face[i]], a), sub(poly.vertices[face[i + 1]], a)));
  return Math.hypot(...n) / 2;
}

/**
 * angleDeg: 이웃 면과 이 각도보다 덜 꺾였으면 같은 조각 (블렌더 기본 66°)
 * margin: 조각 사이 틈 (텍스처 너비에 대한 비율). 붓이 옆 조각으로 번지지 않게.
 */
export function smartUnwrap(poly: PolyMesh, angleDeg = 66, margin = 0.008): FaceUVs {
  const nf = poly.faces.length;
  if (!nf) return [];
  const normals = poly.faces.map((f) => faceNormal(poly, f));
  const areas = poly.faces.map((f) => faceArea(poly, f));

  // 선 하나를 함께 쓰는 면들
  const byEdge = new Map<string, number[]>();
  poly.faces.forEach((f, fi) =>
    f.forEach((a, i) => {
      const b = f[(i + 1) % f.length];
      const k = a < b ? `${a}-${b}` : `${b}-${a}`;
      const list = byEdge.get(k);
      if (list) list.push(fi);
      else byEdge.set(k, [fi]);
    }),
  );

  const charts: Chart[] = [];
  const build = (subset: number[], angle: number) => {
    const cosLimit = Math.cos((angle * Math.PI) / 180);
    const inSet = new Set(subset);
    const taken = new Set<number>();
    // 넓은 면부터 조각을 시작해야 조각이 크고 고르게 나온다
    const order = [...subset].sort((a, b) => areas[b] - areas[a]);
    for (const seed of order) {
      if (taken.has(seed)) continue;
      const faces: number[] = [];
      // 조각 방향은 첫 면 방향. 모든 면이 이 방향과 각도 제한 안이라 펴도 뒤집히지 않는다.
      const n = normals[seed];
      let dir: Vec3 = [0, 0, 0];
      const stack = [seed];
      taken.add(seed);
      while (stack.length) {
        const f = stack.pop()!;
        faces.push(f);
        dir = add(dir, normals[f].map((v) => v * (areas[f] + 1e-9)) as Vec3);
        const face = poly.faces[f];
        face.forEach((a, i) => {
          const b = face[(i + 1) % face.length];
          for (const g of byEdge.get(a < b ? `${a}-${b}` : `${b}-${a}`) ?? []) {
            if (taken.has(g) || !inSet.has(g)) continue;
            if (dot(normals[g], normals[f]) < cosLimit || dot(normals[g], n) < cosLimit) continue;
            taken.add(g);
            stack.push(g);
          }
        });
      }
      const chart = flatten(faces, normalize(dir), n);
      // 오목한 곳(도넛 안쪽 등)은 펴면 겹칠 수 있다. 겹치면 각도를 줄여 더 잘게 나눈다.
      if (faces.length > 1 && angle > 8 && overlaps(chart)) build(faces, angle * 0.6);
      else charts.push(chart);
    }
  };

  /** 면들을 dir 방향에서 내려다본 모양으로 편다. dir 이 뒤집힌 면이 있으면 seed 방향으로 */
  const flatten = (faces: number[], avg: Vec3, seedN: Vec3): Chart => {
    const n = faces.every((f) => dot(normals[f], avg) > 0.05) ? avg : seedN;
    // n 에 수직인 두 축
    const helper: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = normalize(cross(helper, n));
    const v = cross(n, u);
    const flat = new Map<number, UV[]>();
    const all: UV[] = [];
    for (const f of faces) {
      const list = poly.faces[f].map((vi) => {
        const p = poly.vertices[vi];
        const q: UV = [dot(p, u), dot(p, v)];
        all.push(q);
        return q;
      });
      flat.set(f, list);
    }
    // 네모 테두리가 가장 작아지게 돌린다 (긴 조각이 비스듬히 누워 자리를 낭비하지 않게)
    let best = { a: 0, area: Infinity };
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * (Math.PI / 2);
      const c = Math.cos(a);
      const s = Math.sin(a);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const [x, y] of all) {
        const rx = x * c - y * s;
        const ry = x * s + y * c;
        if (rx < x0) x0 = rx;
        if (rx > x1) x1 = rx;
        if (ry < y0) y0 = ry;
        if (ry > y1) y1 = ry;
      }
      const area = (x1 - x0) * (y1 - y0);
      if (area < best.area - 1e-12) best = { a, area };
    }
    const c = Math.cos(best.a);
    const s = Math.sin(best.a);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const list of flat.values())
      for (const q of list) {
        const rx = q[0] * c - q[1] * s;
        const ry = q[0] * s + q[1] * c;
        q[0] = rx;
        q[1] = ry;
        if (rx < x0) x0 = rx;
        if (rx > x1) x1 = rx;
        if (ry < y0) y0 = ry;
        if (ry > y1) y1 = ry;
      }
    // 키가 너비보다 크면 눕혀서 선반에 잘 들어가게
    if (y1 - y0 > x1 - x0) {
      for (const list of flat.values()) for (const q of list) [q[0], q[1]] = [q[1], -q[0]];
      [x0, x1, y0, y1] = [y0, y1, -x1, -x0];
    }
    return { faces, pts: flat, minX: x0, minY: y0, w: x1 - x0, h: y1 - y0, x: 0, y: 0 };
  };

  build([...poly.faces.keys()], angleDeg);

  // 선반 쌓기: 키 큰 조각부터 한 줄씩. 너비는 전체 넓이의 제곱근쯤으로 잡아 거의 정사각형이 되게.
  const total = charts.reduce((a, c) => a + c.w * c.h, 0);
  const side = Math.sqrt(total) || 1;
  const pad = side * margin * 2;
  const rowWidth = Math.max(side * 1.15, ...charts.map((c) => c.w + pad));
  const sorted = [...charts].sort((a, b) => b.h - a.h);
  let x = pad;
  let y = pad;
  let rowH = 0;
  let maxX = 0;
  for (const c of sorted) {
    if (x + c.w + pad > rowWidth && x > pad) {
      x = pad;
      y += rowH + pad;
      rowH = 0;
    }
    c.x = x;
    c.y = y;
    x += c.w + pad;
    rowH = Math.max(rowH, c.h);
    maxX = Math.max(maxX, x);
  }
  const extent = Math.max(maxX, y + rowH + pad) || 1;

  const out: FaceUVs = new Array(nf);
  for (const c of charts)
    for (const f of c.faces)
      out[f] = c.pts.get(f)!.map(([px, py]) => [round((px - c.minX + c.x) / extent), round((py - c.minY + c.y) / extent)] as UV);
  return out;
}

const round = (n: number) => Math.round(n * 1e5) / 1e5;

/** 펴진 조각 안에서 삼각형끼리 겹치는지 (작은 칸 그림에 칠해 보고 두 번 칠해지는 칸이 있는지) */
function overlaps(c: Chart): boolean {
  const N = 96;
  const k = N / Math.max(c.w, c.h, 1e-9);
  const grid = new Uint8Array(N * N);
  for (const list of c.pts.values()) {
    const mine = new Set<number>();
    for (let i = 1; i < list.length - 1; i++) {
      const [a, b, d] = [list[0], list[i], list[i + 1]].map((q) => [(q[0] - c.minX) * k, (q[1] - c.minY) * k]);
      const area = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
      if (area <= 0) {
        if (area < -1e-9) return true; // 뒤집힌 면
        continue;
      }
      const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], d[0])));
      const x1 = Math.min(N, Math.ceil(Math.max(a[0], b[0], d[0])));
      const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], d[1])));
      const y1 = Math.min(N, Math.ceil(Math.max(a[1], b[1], d[1])));
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const px = x + 0.5;
          const py = y + 0.5;
          const w0 = ((b[0] - px) * (d[1] - py) - (b[1] - py) * (d[0] - px)) / area;
          const w1 = ((d[0] - px) * (a[1] - py) - (d[1] - py) * (a[0] - px)) / area;
          // 선 위의 칸은 이웃 면과 함께 쓰니 세지 않는다
          if (w0 < 0.04 || w1 < 0.04 || 1 - w0 - w1 < 0.04) continue;
          const g = y * N + x;
          if (mine.has(g)) continue;
          mine.add(g);
          if (grid[g]) return true;
          grid[g] = 1;
        }
    }
  }
  return false;
}
