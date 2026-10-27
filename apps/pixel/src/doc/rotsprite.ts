// RotSprite (에이스프라이트의 회전): 픽셀 아트를 계단이 뭉개지지 않게 아무 각도로나 돌린다.
// Scale2x 로 8배 키워 모서리를 매끈하게 만든 다음, 돌리면서 가장 가까운 칸을 가져와 원래 크기로 줄인다.
import type { Raster } from "./raster";

/** Scale2x: 픽셀 아트 모서리를 살리며 2배로 키운다 (색은 원래 있는 색만 쓴다) */
function scale2x(src: Uint32Array, w: number, h: number): Uint32Array {
  const out = new Uint32Array(w * h * 4);
  const W = w * 2;
  const at = (x: number, y: number) => src[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const E = src[y * w + x];
      const B = at(x, y - 1);
      const D = at(x - 1, y);
      const F = at(x + 1, y);
      const H = at(x, y + 1);
      let e0 = E;
      let e1 = E;
      let e2 = E;
      let e3 = E;
      if (B !== H && D !== F) {
        if (D === B) e0 = D;
        if (B === F) e1 = F;
        if (D === H) e2 = D;
        if (H === F) e3 = F;
      }
      const o = y * 2 * W + x * 2;
      out[o] = e0;
      out[o + 1] = e1;
      out[o + W] = e2;
      out[o + W + 1] = e3;
    }
  return out;
}

/**
 * r 을 degrees 만큼 시계 방향으로 돌린다 (제자리에서 바꾼다).
 * mask 가 있으면 고른 칸만 떼어 그 가운데를 축으로 돌리고, 나머지는 그대로 둔다.
 */
export function rotSprite(r: Raster, degrees: number, mask?: Uint8Array | null) {
  const { width: w, height: h } = r;
  const px = new Uint32Array(r.data.buffer.slice(r.data.byteOffset, r.data.byteOffset + r.data.byteLength));
  const src = new Uint32Array(w * h);
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let i = 0; i < w * h; i++) {
    if (mask && !mask[i]) continue;
    src[i] = px[i];
    if (!mask && (px[i] >>> 24) === 0) continue;
    const x = i % w;
    const y = (i / w) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < 0) return false;
  // 돌리는 축: 고른 부분(없으면 그려진 부분)의 가운데
  const cx = (x0 + x1 + 1) / 2;
  const cy = (y0 + y1 + 1) / 2;
  let big: Uint32Array = src;
  let bw = w;
  let bh = h;
  for (let k = 0; k < 3; k++) {
    big = scale2x(big, bw, bh);
    bw *= 2;
    bh *= 2;
  }
  const a = (-degrees * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const out = new Uint32Array(px);
  // 고른 부분은 비우고 돌린 것을 올린다
  for (let i = 0; i < w * h; i++) if (!mask || mask[i]) out[i] = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const sx = cx + dx * cos - dy * sin;
      const sy = cy + dx * sin + dy * cos;
      const bx = Math.floor(sx * 8);
      const by = Math.floor(sy * 8);
      if (bx < 0 || by < 0 || bx >= bw || by >= bh) continue;
      const c = big[by * bw + bx];
      if (c >>> 24 === 0) continue;
      out[y * w + x] = c;
    }
  r.data.set(new Uint8ClampedArray(out.buffer));
  return true;
}
