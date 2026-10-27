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

/** 위에 있는 그림을 아래 그림 위에 겹친다 (반투명 고려). */
export function blendOnto(dst: Uint8ClampedArray, src: Uint8ClampedArray) {
  for (let i = 0; i < dst.length; i += 4) {
    const sa = src[i + 3] / 255;
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
