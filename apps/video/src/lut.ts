/* LUT (룩업 테이블): 색 하나하나를 정해진 색으로 바꿔서 영화 같은 색감을 입힌다 (프리미어 루메트리의 ‘크리에이티브 룩’). */

/** 프로젝트에 넣어 둔 .cube 파일. data 는 0~65535 로 줄인 RGB 값을 base64 로 (빨강이 가장 빨리 바뀌는 순서) */
export interface LutAsset {
  id: string;
  name: string;
  size: number;
  data: string;
}

export interface LutTable {
  size: number;
  /** size³ × 3, 0~1 */
  table: Float32Array;
}

type Rgb = [number, number, number];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
/** 부드러운 S 곡선 (대비) */
const sCurve = (v: number, k: number) => {
  const s = v - 0.5;
  return clamp01(0.5 + s * (1 + k) - 4 * k * s * s * s);
};
const saturate = ([r, g, b]: Rgb, k: number): Rgb => {
  const y = luma(r, g, b);
  return [y + (r - y) * k, y + (g - y) * k, y + (b - y) * k];
};

/** 기본으로 들어 있는 룩. 색 하나를 받아 바뀐 색을 돌려준다 (0~1). */
const BUILTIN: { id: string; label: string; hint: string; fn: (c: Rgb) => Rgb }[] = [
  {
    id: "teal-orange",
    label: "틸 앤 오렌지",
    hint: "어두운 곳은 청록, 피부와 밝은 곳은 주황. 할리우드 블록버스터 색감",
    fn: (c) => {
      const y = luma(...c);
      const [r, g, b] = saturate(c, 1.15);
      const sh = 1 - y;
      return [sCurve(r + 0.1 * y - 0.06 * sh, 0.15), sCurve(g + 0.02 * y + 0.02 * sh, 0.15), sCurve(b - 0.1 * y + 0.08 * sh, 0.15)];
    },
  },
  {
    id: "bleach",
    label: "블리치 바이패스",
    hint: "채도를 빼고 대비를 세게. 전쟁 영화, 거친 느낌",
    fn: (c) => {
      const [r, g, b] = saturate(c, 0.45);
      return [sCurve(r, 0.45), sCurve(g, 0.45), sCurve(b, 0.45)];
    },
  },
  {
    id: "film-warm",
    label: "필름 (따뜻하게)",
    hint: "검은색을 살짝 띄우고 따뜻한 필름 색",
    fn: ([r, g, b]) => [mix(0.06, 0.98, sCurve(r, 0.1)), mix(0.05, 0.94, sCurve(g, 0.1)), mix(0.07, 0.86, sCurve(b, 0.1))],
  },
  {
    id: "film-cool",
    label: "필름 (차갑게)",
    hint: "푸른 그림자, 차분한 필름 색",
    fn: ([r, g, b]) => [mix(0.04, 0.92, sCurve(r, 0.12)), mix(0.06, 0.95, sCurve(g, 0.12)), mix(0.1, 1, sCurve(b, 0.12))],
  },
  {
    id: "sunset",
    label: "노을",
    hint: "주황과 분홍 하이라이트, 해 질 녘",
    fn: (c) => {
      const y = luma(...c);
      const [r, g, b] = saturate(c, 1.2);
      return [clamp01(r * 1.08 + 0.05 * y), clamp01(g * 0.95 + 0.01), clamp01(b * 0.85 + 0.08 * y * y)];
    },
  },
  {
    id: "night",
    label: "낮을 밤으로",
    hint: "어둡고 푸르게. 낮에 찍은 장면을 밤처럼 (데이 포 나이트)",
    fn: (c) => {
      const [r, g, b] = saturate(c, 0.5);
      return [clamp01(r * 0.45), clamp01(g * 0.55 + 0.01), clamp01(b * 0.8 + 0.05)];
    },
  },
  {
    id: "noir",
    label: "흑백 필름",
    hint: "깊은 검정과 부드러운 흰색의 흑백",
    fn: ([r, g, b]) => {
      const y = mix(0.03, 0.97, sCurve(0.3 * r + 0.59 * g + 0.11 * b, 0.35));
      return [y, y, y];
    },
  },
  {
    id: "cross",
    label: "크로스 프로세스",
    hint: "노랑과 초록이 도는 실험적인 색 (뮤직비디오)",
    fn: ([r, g, b]) => [sCurve(r, 0.3), clamp01(sCurve(g, 0.15) * 1.05), clamp01(mix(0.12, 0.8, b))],
  },
  {
    id: "matte",
    label: "페이드 매트",
    hint: "검은색을 회색으로 띄워 부드럽고 흐린 SNS 감성",
    fn: (c) => {
      const [r, g, b] = saturate(c, 0.85);
      return [mix(0.12, 0.95, r), mix(0.12, 0.94, g), mix(0.14, 0.93, b)];
    },
  },
];

export const BUILTIN_LUTS = BUILTIN.map(({ id, label, hint }) => ({ id: `builtin:${id}`, label, hint }));

const bake = (fn: (c: Rgb) => Rgb, size = 33): LutTable => {
  const table = new Float32Array(size * size * size * 3);
  let i = 0;
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        const o = fn([r / (size - 1), g / (size - 1), b / (size - 1)]);
        table[i++] = clamp01(o[0]);
        table[i++] = clamp01(o[1]);
        table[i++] = clamp01(o[2]);
      }
  return { size, table };
};

/** .cube 글을 읽는다 (Resolve, 프리미어, 포토샵이 쓰는 형식). 틀리면 오류 */
export function parseCube(text: string): LutTable {
  let size = 0;
  let min: Rgb = [0, 0, 0];
  let max: Rgb = [1, 1, 1];
  const values: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    const head = parts[0].toUpperCase();
    if (head === "LUT_3D_SIZE") size = parseInt(parts[1], 10);
    else if (head === "LUT_1D_SIZE") throw new Error("1D LUT 은 아직 쓸 수 없어요. 3D LUT(.cube)을 골라 주세요.");
    else if (head === "DOMAIN_MIN") min = parts.slice(1, 4).map(Number) as Rgb;
    else if (head === "DOMAIN_MAX") max = parts.slice(1, 4).map(Number) as Rgb;
    else if (/^[-+.\d]/.test(head) && parts.length >= 3) values.push(Number(parts[0]), Number(parts[1]), Number(parts[2]));
  }
  if (size < 2 || size > 129) throw new Error("LUT_3D_SIZE 가 없거나 너무 커요.");
  if (values.length !== size * size * size * 3 || values.some((v) => !Number.isFinite(v))) throw new Error("색 값 개수가 LUT 크기와 맞지 않아요.");
  const table = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const c = i % 3;
    table[i] = clamp01((values[i] - min[c]) / (max[c] - min[c] || 1));
  }
  return { size, table };
}

export function encodeLut(t: LutTable): string {
  const u = new Uint16Array(t.table.length);
  for (let i = 0; i < u.length; i++) u[i] = Math.round(t.table[i] * 65535);
  const bytes = new Uint8Array(u.buffer);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function decodeLut(a: LutAsset): LutTable {
  const s = atob(a.data);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  const u = new Uint16Array(bytes.buffer);
  const table = new Float32Array(u.length);
  for (let i = 0; i < u.length; i++) table[i] = u[i] / 65535;
  return { size: a.size, table };
}

const cache = new Map<string, LutTable>();

/** id 로 LUT 표를 찾는다: builtin:… 또는 프로젝트에 넣은 파일 */
export function lutTable(id: string, assets: LutAsset[] | undefined): LutTable | null {
  const asset = id.startsWith("builtin:") ? null : assets?.find((a) => a.id === id);
  const key = asset ? `${asset.id}:${asset.data.length}` : id;
  let t = cache.get(key);
  if (!t) {
    if (asset) t = decodeLut(asset);
    else {
      const b = BUILTIN.find((x) => `builtin:${x.id}` === id);
      if (!b) return null;
      t = bake(b.fn);
    }
    cache.set(key, t);
  }
  return t;
}

/** RGBA 픽셀에 LUT 을 amount(0~1) 만큼 입힌다. 이웃한 8칸을 섞어서(삼선형) 계단이 생기지 않게. */
export function applyLut(d: Uint8ClampedArray, lut: LutTable, amount: number) {
  const n = lut.size;
  const tb = lut.table;
  const n1 = n - 1;
  // 0~255 마다 칸 번호와 남는 비율을 미리 셈해 둔다
  const idx = new Int32Array(256);
  const frac = new Float32Array(256);
  for (let v = 0; v < 256; v++) {
    const p = (v / 255) * n1;
    const i = Math.min(n1 - 1, Math.floor(p));
    idx[v] = i;
    frac[v] = p - i;
  }
  const sg = n * 3;
  const sb = n * n * 3;
  for (let p = 0; p < d.length; p += 4) {
    if (d[p + 3] === 0) continue;
    const r = d[p];
    const g = d[p + 1];
    const b = d[p + 2];
    const fr = frac[r];
    const fg = frac[g];
    const fb = frac[b];
    const o = idx[r] * 3 + idx[g] * sg + idx[b] * sb;
    for (let c = 0; c < 3; c++) {
      const o0 = o + c;
      const c00 = tb[o0] + (tb[o0 + 3] - tb[o0]) * fr;
      const c10 = tb[o0 + sg] + (tb[o0 + sg + 3] - tb[o0 + sg]) * fr;
      const c01 = tb[o0 + sb] + (tb[o0 + sb + 3] - tb[o0 + sb]) * fr;
      const c11 = tb[o0 + sb + sg] + (tb[o0 + sb + sg + 3] - tb[o0 + sb + sg]) * fr;
      const c0 = c00 + (c10 - c00) * fg;
      const c1 = c01 + (c11 - c01) * fg;
      const v = (c0 + (c1 - c0) * fb) * 255;
      const src = d[p + c];
      d[p + c] = src + (v - src) * amount;
    }
  }
}
