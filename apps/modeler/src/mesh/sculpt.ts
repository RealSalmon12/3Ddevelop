/**
 * 조각 (스컬프트): 붓으로 점들을 밀고 당기고 부드럽게 해서 찰흙처럼 모양을 빚는다 (블렌더의 스컬프트 모드).
 * 점이 많을수록 곱게 빚어진다. 모든 계산은 오브젝트 기준 좌표.
 */
import type { PolyMesh, Vec3 } from "./PolyMesh";

export type SculptBrush = "draw" | "clay" | "smooth" | "grab" | "inflate" | "flatten" | "pinch" | "crease";

export const SCULPT_BRUSHES: { id: SculptBrush; label: string; icon: string; key: string; hint: string }[] = [
  { id: "draw", label: "그리기", icon: "✎", key: "X", hint: "표면을 바깥으로 부풀려요. Ctrl 을 누르고 칠하면 안으로 파여요" },
  { id: "clay", label: "찰흙", icon: "▤", key: "C", hint: "찰흙을 한 겹씩 덧바르듯 평평하게 쌓아요 (근육, 옷 주름)" },
  { id: "smooth", label: "부드럽게", icon: "◌", key: "S", hint: "울퉁불퉁한 곳을 매끈하게. 다른 붓을 쓰다가 Shift 를 누르고 칠해도 돼요" },
  { id: "grab", label: "잡아끌기", icon: "✋", key: "G", hint: "닿은 부분을 통째로 잡아 끌어요 (코, 귀, 뿔 늘이기)" },
  { id: "inflate", label: "부풀리기", icon: "◍", key: "I", hint: "풍선처럼 사방으로 부풀려요. Ctrl: 오므리기" },
  { id: "flatten", label: "평평하게", icon: "▭", key: "T", hint: "칠한 곳을 평평한 면으로 깎아요" },
  { id: "pinch", label: "모으기", icon: "⊹", key: "P", hint: "점들을 붓 가운데로 모아 날카로운 선을 만들어요" },
  { id: "crease", label: "주름", icon: "⌇", key: "Shift+C", hint: "가늘고 깊은 홈을 파요 (주름, 이음매). Ctrl: 솟은 선" },
];

export interface SculptSettings {
  brush: SculptBrush;
  /** 화면에서 붓 반지름 (픽셀) */
  radius: number;
  /** 0 ~ 1 */
  strength: number;
  /** X 축 대칭 (오브젝트 기준) */
  symmetry: boolean;
}

export const DEFAULT_SCULPT: SculptSettings = { brush: "draw", radius: 60, strength: 0.5, symmetry: true };

/** 붓 가장자리로 갈수록 부드럽게 약해지는 정도 (0~1) */
const falloff = (t: number) => {
  const u = 1 - t * t;
  return u * u;
};

export class SculptSession {
  readonly poly: PolyMesh;
  private neighbors: number[][];
  private normals: Float32Array;
  private grabbed: { v: number; w: number }[] | null = null;

  constructor(poly: PolyMesh) {
    this.poly = poly;
    const n = poly.vertices.length;
    const sets = Array.from({ length: n }, () => new Set<number>());
    for (const f of poly.faces)
      f.forEach((a, i) => {
        const b = f[(i + 1) % f.length];
        sets[a].add(b);
        sets[b].add(a);
      });
    this.neighbors = sets.map((s) => [...s]);
    this.normals = new Float32Array(n * 3);
    this.updateNormals();
  }

  /** 점마다 둘레 면의 방향 평균 */
  updateNormals() {
    const nm = this.normals;
    nm.fill(0);
    const vs = this.poly.vertices;
    for (const f of this.poly.faces) {
      // 뉴웰 방법 (넓은 면일수록 크게 더해진다)
      let x = 0;
      let y = 0;
      let z = 0;
      for (let i = 0; i < f.length; i++) {
        const a = vs[f[i]];
        const b = vs[f[(i + 1) % f.length]];
        x += (a[1] - b[1]) * (a[2] + b[2]);
        y += (a[2] - b[2]) * (a[0] + b[0]);
        z += (a[0] - b[0]) * (a[1] + b[1]);
      }
      for (const v of f) {
        nm[v * 3] += x;
        nm[v * 3 + 1] += y;
        nm[v * 3 + 2] += z;
      }
    }
    for (let v = 0; v < vs.length; v++) {
      const l = Math.hypot(nm[v * 3], nm[v * 3 + 1], nm[v * 3 + 2]) || 1;
      nm[v * 3] /= l;
      nm[v * 3 + 1] /= l;
      nm[v * 3 + 2] /= l;
    }
  }

  /** center 둘레 radius 안의 점과 무게 */
  private within(center: Vec3, radius: number) {
    const out: { v: number; w: number }[] = [];
    const r2 = radius * radius;
    const vs = this.poly.vertices;
    for (let v = 0; v < vs.length; v++) {
      const p = vs[v];
      const dx = p[0] - center[0];
      const dy = p[1] - center[1];
      const dz = p[2] - center[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < r2) out.push({ v, w: falloff(Math.sqrt(d2) / radius) });
    }
    return out;
  }

  /** 붓 아래 면들의 평균 방향과 평균 위치 */
  private area(hits: { v: number; w: number }[]) {
    const n: Vec3 = [0, 0, 0];
    const c: Vec3 = [0, 0, 0];
    let sw = 0;
    for (const { v, w } of hits) {
      for (let k = 0; k < 3; k++) {
        n[k] += this.normals[v * 3 + k] * w;
        c[k] += this.poly.vertices[v][k] * w;
      }
      sw += w;
    }
    const l = Math.hypot(...n) || 1;
    return { normal: n.map((x) => x / l) as Vec3, center: c.map((x) => x / (sw || 1)) as Vec3 };
  }

  /**
   * 붓 한 번 찍기. 바뀐 점이 있으면 true.
   * invert: Ctrl (반대로), center/radius: 오브젝트 기준 좌표
   */
  dab(brush: SculptBrush, center: Vec3, radius: number, strength: number, invert: boolean, symmetry: boolean): boolean {
    const centers: Vec3[] = [center];
    if (symmetry && Math.abs(center[0]) > radius * 0.05) centers.push([-center[0], center[1], center[2]]);
    let changed = false;
    for (const c of centers) changed = this.dabOne(brush, c, radius, strength, invert) || changed;
    return changed;
  }

  private dabOne(brush: SculptBrush, center: Vec3, radius: number, strength: number, invert: boolean) {
    const hits = this.within(center, radius);
    if (!hits.length) return false;
    const vs = this.poly.vertices;
    const nm = this.normals;
    const sign = invert ? -1 : 1;
    const { normal, center: mid } = this.area(hits);
    const push = radius * 0.12 * strength;
    switch (brush) {
      case "draw":
        for (const { v, w } of hits) for (let k = 0; k < 3; k++) vs[v][k] += normal[k] * push * w * sign;
        break;
      case "inflate":
        for (const { v, w } of hits) for (let k = 0; k < 3; k++) vs[v][k] += nm[v * 3 + k] * push * w * sign;
        break;
      case "clay": {
        // 붓 아래 평면보다 조금 위까지 채운다 (이미 높은 곳은 그대로)
        const plane = mid.map((x, k) => x + normal[k] * push * 1.5 * sign) as Vec3;
        for (const { v, w } of hits) {
          const p = vs[v];
          const d = (p[0] - plane[0]) * normal[0] + (p[1] - plane[1]) * normal[1] + (p[2] - plane[2]) * normal[2];
          if (d * sign >= 0) continue;
          for (let k = 0; k < 3; k++) p[k] -= normal[k] * d * w * Math.min(1, strength * 0.8);
        }
        break;
      }
      case "flatten":
        for (const { v, w } of hits) {
          const p = vs[v];
          const d = (p[0] - mid[0]) * normal[0] + (p[1] - mid[1]) * normal[1] + (p[2] - mid[2]) * normal[2];
          for (let k = 0; k < 3; k++) p[k] -= normal[k] * d * w * Math.min(1, strength * 0.6);
        }
        break;
      case "smooth":
        this.smooth(hits, strength);
        break;
      case "pinch":
        for (const { v, w } of hits) for (let k = 0; k < 3; k++) vs[v][k] += (center[k] - vs[v][k]) * w * strength * 0.25 * sign;
        break;
      case "crease":
        for (const { v, w } of hits) {
          for (let k = 0; k < 3; k++) vs[v][k] += (center[k] - vs[v][k]) * w * strength * 0.2 - normal[k] * push * 0.7 * w * w * sign;
        }
        break;
      case "grab":
        return false;
    }
    return true;
  }

  /** 이웃 평균 쪽으로 당긴다 (라플라시안) */
  private smooth(hits: { v: number; w: number }[], strength: number) {
    const vs = this.poly.vertices;
    const next = hits.map(({ v }) => {
      const nb = this.neighbors[v];
      if (!nb.length) return vs[v];
      const avg: Vec3 = [0, 0, 0];
      for (const u of nb) for (let k = 0; k < 3; k++) avg[k] += vs[u][k] / nb.length;
      return avg;
    });
    hits.forEach(({ v, w }, i) => {
      const t = Math.min(1, w * strength * 1.2);
      for (let k = 0; k < 3; k++) vs[v][k] += (next[i][k] - vs[v][k]) * t;
    });
  }

  /** 잡아끌기: 누른 순간의 점과 무게를 기억한다 */
  beginGrab(center: Vec3, radius: number, symmetry: boolean) {
    this.grabbed = this.within(center, radius);
    if (symmetry && Math.abs(center[0]) > radius * 0.05) {
      const mirrored = this.within([-center[0], center[1], center[2]], radius).map((h) => ({ ...h, w: -h.w }));
      this.grabbed.push(...mirrored);
    }
  }

  /** 잡은 점들을 delta 만큼 (대칭 쪽은 x 를 뒤집어서) 옮긴다 */
  dragGrab(delta: Vec3, strength: number) {
    if (!this.grabbed) return false;
    const s = 0.4 + strength * 0.6;
    for (const { v, w } of this.grabbed) {
      const p = this.poly.vertices[v];
      const a = Math.abs(w) * s;
      p[0] += delta[0] * a * Math.sign(w);
      p[1] += delta[1] * a;
      p[2] += delta[2] * a;
    }
    return this.grabbed.length > 0;
  }

  endGrab() {
    this.grabbed = null;
  }
}
