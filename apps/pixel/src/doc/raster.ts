// 픽셀 그리기 계산. 화면과 상관없는 순수한 함수들이라 AI 그림, 예제, 도구가 함께 쓴다.
import type { RGBA } from "./color";

export interface Raster {
  width: number;
  height: number;
  /** 왼쪽 위부터 한 줄씩, 픽셀마다 r, g, b, a 네 칸 */
  data: Uint8ClampedArray<ArrayBuffer>;
}

export const createRaster = (width: number, height: number): Raster => ({
  width,
  height,
  data: new Uint8ClampedArray(width * height * 4),
});

export const inBounds = (r: Raster, x: number, y: number) => x >= 0 && y >= 0 && x < r.width && y < r.height;

export function getPixel(r: Raster, x: number, y: number): RGBA {
  const i = (y * r.width + x) * 4;
  return [r.data[i], r.data[i + 1], r.data[i + 2], r.data[i + 3]];
}

export function setPixel(r: Raster, x: number, y: number, c: RGBA) {
  if (!inBounds(r, x, y)) return;
  const i = (y * r.width + x) * 4;
  r.data[i] = c[0];
  r.data[i + 1] = c[1];
  r.data[i + 2] = c[2];
  r.data[i + 3] = c[3];
}

const same = (a: RGBA, b: RGBA) => (a[3] === 0 && b[3] === 0) || (a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]);

/** 붓 크기만큼 네모로 찍는다. 크기 2 는 오른쪽 아래로 한 칸 더 칠한다. */
export function stamp(r: Raster, x: number, y: number, size: number, c: RGBA) {
  const start = -Math.floor((size - 1) / 2);
  for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) setPixel(r, x + start + dx, y + start + dy, c);
}

/** 두 점 사이의 칸들 (브레즌햄 직선) */
export function linePoints(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const points: [number, number][] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    points.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  return points;
}

export function rectPoints(x0: number, y0: number, x1: number, y1: number, filled: boolean): [number, number][] {
  const [left, right] = [Math.min(x0, x1), Math.max(x0, x1)];
  const [top, bottom] = [Math.min(y0, y1), Math.max(y0, y1)];
  const points: [number, number][] = [];
  for (let y = top; y <= bottom; y++)
    for (let x = left; x <= right; x++)
      if (filled || x === left || x === right || y === top || y === bottom) points.push([x, y]);
  return points;
}

/** 두 점을 모서리로 하는 네모 안에 꼭 맞는 동그라미 */
export function ellipsePoints(x0: number, y0: number, x1: number, y1: number, filled: boolean): [number, number][] {
  const [left, right] = [Math.min(x0, x1), Math.max(x0, x1)];
  const [top, bottom] = [Math.min(y0, y1), Math.max(y0, y1)];
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const rx = (right - left + 1) / 2;
  const ry = (bottom - top + 1) / 2;
  const inside = (x: number, y: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  const points: [number, number][] = [];
  for (let y = top; y <= bottom; y++)
    for (let x = left; x <= right; x++) {
      if (!inside(x, y)) continue;
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      if (filled || edge) points.push([x, y]);
    }
  return points;
}

/** 같은 색으로 이어진 칸을 모두 칠한다 (위아래양옆으로만 이어진 것). 칠한 칸이 있으면 true. */
export function floodFill(r: Raster, x: number, y: number, c: RGBA): boolean {
  if (!inBounds(r, x, y)) return false;
  const target = getPixel(r, x, y);
  if (same(target, c)) return false;
  const stack: number[] = [x, y];
  const seen = new Uint8Array(r.width * r.height);
  while (stack.length) {
    const py = stack.pop()!;
    const px = stack.pop()!;
    if (!inBounds(r, px, py) || seen[py * r.width + px]) continue;
    seen[py * r.width + px] = 1;
    if (!same(getPixel(r, px, py), target)) continue;
    setPixel(r, px, py, c);
    stack.push(px + 1, py, px - 1, py, px, py + 1, px, py - 1);
  }
  return true;
}

/** 위에 있는 그림을 아래 그림 위에 겹친다 (반투명, 레이어 불투명도 고려). */
export function blendOnto(dst: Uint8ClampedArray, src: Uint8ClampedArray, opacity = 1) {
  for (let i = 0; i < dst.length; i += 4) {
    const sa = (src[i + 3] / 255) * opacity;
    if (sa === 0) continue;
    if (sa === 1) {
      dst[i] = src[i];
      dst[i + 1] = src[i + 1];
      dst[i + 2] = src[i + 2];
      dst[i + 3] = 255;
      continue;
    }
    const da = dst[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    for (let k = 0; k < 3; k++) dst[i + k] = (src[i + k] * sa + dst[i + k] * da * (1 - sa)) / oa;
    dst[i + 3] = oa * 255;
  }
}

/** 칸을 글자로 적은 그림 (AI 와 예제가 쓰는 모양). '.' 은 빈칸, 나머지 글자는 팔레트 번호. */
export interface PixelRows {
  palette: string[];
  rows: string[];
}

export const ROW_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/* ---------- 고르기 ---------- */

export function rectMask(w: number, h: number, x0: number, y0: number, x1: number, y1: number) {
  const m = new Uint8Array(w * h);
  const [l, r] = [Math.max(0, Math.min(x0, x1)), Math.min(w - 1, Math.max(x0, x1))];
  const [t, b] = [Math.max(0, Math.min(y0, y1)), Math.min(h - 1, Math.max(y0, y1))];
  for (let y = t; y <= b; y++) m.fill(1, y * w + l, y * w + r + 1);
  return m;
}

/** 자동 선택: 같은 색으로 이어진 칸 (contiguous 가 false 면 그림 전체에서 같은 색) */
export function wandMask(r: Raster, x: number, y: number, contiguous: boolean) {
  const m = new Uint8Array(r.width * r.height);
  if (!inBounds(r, x, y)) return m;
  const target = getPixel(r, x, y);
  if (!contiguous) {
    for (let py = 0; py < r.height; py++) for (let px = 0; px < r.width; px++) if (same(getPixel(r, px, py), target)) m[py * r.width + px] = 1;
    return m;
  }
  const stack = [x, y];
  while (stack.length) {
    const py = stack.pop()!;
    const px = stack.pop()!;
    if (!inBounds(r, px, py) || m[py * r.width + px]) continue;
    if (!same(getPixel(r, px, py), target)) continue;
    m[py * r.width + px] = 1;
    stack.push(px + 1, py, px - 1, py, px, py + 1, px, py - 1);
  }
  return m;
}

export function combineMask(a: Uint8Array | null, b: Uint8Array, mode: "replace" | "add" | "subtract") {
  if (mode === "replace" || !a) return mode === "subtract" ? null : b;
  return a.map((v, i) => (mode === "add" ? v | b[i] : v & (b[i] ^ 1)));
}

/** 고른 칸만 남긴 사본 */
export function cutOut(r: Raster, mask: Uint8Array | null): Raster {
  const out = createRaster(r.width, r.height);
  for (let i = 0; i < r.width * r.height; i++) if (!mask || mask[i]) out.data.set(r.data.subarray(i * 4, i * 4 + 4), i * 4);
  return out;
}

export function clearMasked(r: Raster, mask: Uint8Array | null) {
  if (!mask) return void r.data.fill(0);
  for (let i = 0; i < mask.length; i++) if (mask[i]) r.data.fill(0, i * 4, i * 4 + 4);
}

/** src 를 (dx, dy) 만큼 옮겨서 dst 위에 덮는다 (투명한 칸은 건너뜀) */
export function stampRaster(dst: Raster, src: Raster, dx: number, dy: number) {
  for (let y = 0; y < src.height; y++)
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4;
      if (!src.data[i + 3]) continue;
      const tx = x + dx;
      const ty = y + dy;
      if (!inBounds(dst, tx, ty)) continue;
      dst.data.set(src.data.subarray(i, i + 4), (ty * dst.width + tx) * 4);
    }
}

export function shiftMask(m: Uint8Array, w: number, h: number, dx: number, dy: number) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      const tx = x + dx;
      const ty = y + dy;
      if (tx >= 0 && ty >= 0 && tx < w && ty < h) out[ty * w + tx] = 1;
    }
  return out;
}

/* ---------- 변형 ---------- */

/** 고른 영역(없으면 전체) 안에서 뒤집기 */
export function flipRaster(r: Raster, horizontal: boolean, box?: { x: number; y: number; w: number; h: number } | null, mask?: Uint8Array | null) {
  const b = box ?? { x: 0, y: 0, w: r.width, h: r.height };
  const src = r.data.slice();
  for (let y = b.y; y < b.y + b.h; y++)
    for (let x = b.x; x < b.x + b.w; x++) {
      const sx = horizontal ? b.x + b.w - 1 - (x - b.x) : x;
      const sy = horizontal ? y : b.y + b.h - 1 - (y - b.y);
      if (mask && (!mask[y * r.width + x] || !mask[sy * r.width + sx])) continue;
      const from = (sy * r.width + sx) * 4;
      r.data.set(src.subarray(from, from + 4), (y * r.width + x) * 4);
    }
}

/** 90도 돌리기 (가로와 세로가 바뀐다) */
export function rotateRaster(r: Raster, clockwise: boolean): Raster {
  const out = createRaster(r.height, r.width);
  for (let y = 0; y < r.height; y++)
    for (let x = 0; x < r.width; x++) {
      const tx = clockwise ? r.height - 1 - y : y;
      const ty = clockwise ? x : r.width - 1 - x;
      out.data.set(r.data.subarray((y * r.width + x) * 4, (y * r.width + x) * 4 + 4), (ty * out.width + tx) * 4);
    }
  return out;
}

/** 칸 크기 그대로 캔버스만 늘리거나 줄인다. ax, ay 는 기준 (0 왼쪽/위, 0.5 가운데, 1 오른쪽/아래) */
export function resizeCanvas(r: Raster, w: number, h: number, ax: number, ay: number): Raster {
  const out = createRaster(w, h);
  const dx = Math.round((w - r.width) * ax);
  const dy = Math.round((h - r.height) * ay);
  for (let y = 0; y < r.height; y++)
    for (let x = 0; x < r.width; x++) {
      const tx = x + dx;
      const ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
      out.data.set(r.data.subarray((y * r.width + x) * 4, (y * r.width + x) * 4 + 4), (ty * w + tx) * 4);
    }
  return out;
}

/** 칸을 그대로 늘리거나 줄인다 (가장 가까운 칸) */
export function scaleNearest(r: Raster, w: number, h: number): Raster {
  const out = createRaster(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = Math.min(r.width - 1, Math.floor((x * r.width) / w));
      const sy = Math.min(r.height - 1, Math.floor((y * r.height) / h));
      out.data.set(r.data.subarray((sy * r.width + sx) * 4, (sy * r.width + sx) * 4 + 4), (y * w + x) * 4);
    }
  return out;
}

/* ---------- 효과 ---------- */

/** 칠한 칸 바깥쪽에 1칸 외곽선 (diagonal 이면 대각선 칸도) */
export function outline(r: Raster, c: RGBA, diagonal: boolean, mask?: Uint8Array | null) {
  const src = r.data.slice();
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < r.width && y < r.height && src[(y * r.width + x) * 4 + 3] > 0;
  const n = diagonal ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let y = 0; y < r.height; y++)
    for (let x = 0; x < r.width; x++) {
      if (solid(x, y) || (mask && !mask[y * r.width + x])) continue;
      if (n.some(([dx, dy]) => solid(x + dx, y + dy))) setPixel(r, x, y, c);
    }
}

/** 같은 색 칸을 모두 다른 색으로 */
export function replaceColor(r: Raster, from: RGBA, to: RGBA, mask?: Uint8Array | null) {
  let n = 0;
  for (let i = 0; i < r.width * r.height; i++) {
    if (mask && !mask[i]) continue;
    const p: RGBA = [r.data[i * 4], r.data[i * 4 + 1], r.data[i * 4 + 2], r.data[i * 4 + 3]];
    if (!same(p, from)) continue;
    r.data.set(to, i * 4);
    n++;
  }
  return n;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/** 색조(도), 채도·밝기(-100~100) */
export function adjustHsl(r: Raster, dh: number, ds: number, dl: number, mask?: Uint8Array | null) {
  for (let i = 0; i < r.width * r.height; i++) {
    if ((mask && !mask[i]) || !r.data[i * 4 + 3]) continue;
    const [h, s, l] = rgbToHsl(r.data[i * 4], r.data[i * 4 + 1], r.data[i * 4 + 2]);
    const [nr, ng, nb] = hslToRgb((h + dh + 360) % 360, Math.max(0, Math.min(1, s * (1 + ds / 100))), Math.max(0, Math.min(1, l + dl / 200)));
    r.data[i * 4] = nr;
    r.data[i * 4 + 1] = ng;
    r.data[i * 4 + 2] = nb;
  }
}

/** 팔레트에서 가장 가까운 색으로 바꾼다 (사진을 픽셀 아트로 만들 때) */
export function quantize(r: Raster, palette: RGBA[], mask?: Uint8Array | null) {
  if (!palette.length) return;
  const cache = new Map<number, RGBA>();
  for (let i = 0; i < r.width * r.height; i++) {
    if ((mask && !mask[i]) || !r.data[i * 4 + 3]) continue;
    const key = (r.data[i * 4] << 16) | (r.data[i * 4 + 1] << 8) | r.data[i * 4 + 2];
    let best = cache.get(key);
    if (!best) {
      let bd = Infinity;
      for (const p of palette) {
        // 사람 눈에 맞춘 가중치 (초록에 민감)
        const d = 0.3 * (p[0] - r.data[i * 4]) ** 2 + 0.59 * (p[1] - r.data[i * 4 + 1]) ** 2 + 0.11 * (p[2] - r.data[i * 4 + 2]) ** 2;
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      cache.set(key, best!);
    }
    r.data[i * 4] = best![0];
    r.data[i * 4 + 1] = best![1];
    r.data[i * 4 + 2] = best![2];
    r.data[i * 4 + 3] = 255;
  }
}

/** 그림에 쓰인 색 (많이 쓴 순서) */
export function usedColors(rasters: Raster[], limit = 256): string[] {
  const count = new Map<number, number>();
  for (const r of rasters)
    for (let i = 0; i < r.data.length; i += 4) {
      if (!r.data[i + 3]) continue;
      const key = (r.data[i] << 16) | (r.data[i + 1] << 8) | r.data[i + 2];
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k]) => `#${k.toString(16).padStart(6, "0")}`);
}

/* ───────── 그라디언트, 글자 ───────── */

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export type GradientShape = "linear" | "radial";

/**
 * (x0,y0) 에서 (x1,y1) 쪽으로 c0 → c1 그라디언트. dither 면 4×4 바이어 무늬로 두 색만 써서 픽셀 아트답게,
 * 아니면 사이 색을 섞는다. 반투명 색은 원래 그림 위에 겹친다. mask 가 있으면 고른 칸에만.
 */
export function gradientFill(r: Raster, mask: Uint8Array | null, x0: number, y0: number, x1: number, y1: number, c0: RGBA, c1: RGBA, shape: GradientShape, dither: boolean) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = Math.max(1e-6, dx * dx + dy * dy);
  const out = [0, 0, 0, 0];
  for (let y = 0; y < r.height; y++)
    for (let x = 0; x < r.width; x++) {
      if (mask && !mask[y * r.width + x]) continue;
      let t = shape === "linear" ? ((x - x0) * dx + (y - y0) * dy) / len2 : Math.sqrt(((x - x0) ** 2 + (y - y0) ** 2) / len2);
      t = Math.max(0, Math.min(1, t));
      if (dither) {
        const c = t > (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 ? c1 : c0;
        out[0] = c[0];
        out[1] = c[1];
        out[2] = c[2];
        out[3] = c[3];
      } else for (let k = 0; k < 4; k++) out[k] = Math.round(c0[k] + (c1[k] - c0[k]) * t);
      const i = (y * r.width + x) * 4;
      const sa = out[3] / 255;
      if (sa === 0) continue;
      const da = r.data[i + 3] / 255;
      const oa = sa + da * (1 - sa);
      for (let k = 0; k < 3; k++) r.data[i + k] = (out[k] * sa + r.data[i + k] * da * (1 - sa)) / oa;
      r.data[i + 3] = oa * 255;
    }
}

export interface TextStamp {
  width: number;
  height: number;
  /** 1 이면 칠할 칸 */
  mask: Uint8Array;
}

/** 글자를 칸으로 바꾼다. 흐린 가장자리는 반 넘게 찬 칸만 남겨서 또렷하게 */
export function textStamp(text: string, size: number, bold: boolean): TextStamp {
  const c = document.createElement("canvas");
  const g = c.getContext("2d", { willReadFrequently: true })!;
  const font = `${bold ? "bold " : ""}${size}px "Malgun Gothic", "Segoe UI", "Noto Sans KR", sans-serif`;
  g.font = font;
  const lines = text.split("\n");
  const lineH = Math.ceil(size * 1.25);
  const width = Math.max(1, Math.ceil(Math.max(...lines.map((l) => g.measureText(l).width))));
  const height = Math.max(1, lineH * lines.length);
  c.width = width;
  c.height = height;
  g.font = font;
  g.textBaseline = "top";
  g.fillStyle = "#000";
  lines.forEach((l, i) => g.fillText(l, 0, i * lineH));
  const data = g.getImageData(0, 0, width, height).data;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] >= 100 ? 1 : 0;
  return { width, height, mask };
}
