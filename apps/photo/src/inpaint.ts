// 내용 인식 채우기: 선택한 구멍을 주변에서 가장 비슷한 조각을 찾아 붙여 메운다 (포토샵 Shift+F5).
// 구멍 테두리부터 안쪽으로, 아는 픽셀이 많은 자리부터 조각(패치)을 찾는다.
// 조각 찾기는 무작위로 고른 후보 + 이웃이 쓴 자리 근처(전파)를 섞어서 빠르게 한다 (PatchMatch 방식).
import { cloneCanvas, ctx2d } from "./pixels";

const R = 4; // 조각 반지름 (9×9)

export function contentAwareFill(base: HTMLCanvasElement, mask: HTMLCanvasElement): HTMLCanvasElement {
  const out = cloneCanvas(base);
  const W = base.width;
  const H = base.height;
  const md = ctx2d(mask).getImageData(0, 0, W, H).data;
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (md[(y * W + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return out;
  // 가져올 곳: 구멍 둘레로 구멍 크기의 2배 (적어도 60px)
  const mx = Math.max(60, (x1 - x0) * 2);
  const my = Math.max(60, (y1 - y0) * 2);
  const ax = Math.max(0, x0 - mx);
  const ay = Math.max(0, y0 - my);
  const w = Math.min(W, x1 + mx + 1) - ax;
  const h = Math.min(H, y1 + my + 1) - ay;
  const g = ctx2d(out);
  const img = g.getImageData(ax, ay, w, h);
  const px = img.data;
  const n = w * h;
  const hole = new Uint8Array(n);
  const alpha = new Float32Array(n);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const a = md[((y + ay) * W + x + ax) * 4 + 3] / 255;
      alpha[y * w + x] = a;
      hole[y * w + x] = a > 0.03 ? 1 : 0;
    }
  const orig = new Uint8ClampedArray(px);

  // 조각이 통째로 구멍 밖에 있는지 빨리 알기 위한 누적 합
  const sum = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += hole[y * w + x];
      sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row;
    }
  }
  const validSource = (cx: number, cy: number) => {
    if (cx < R || cy < R || cx >= w - R || cy >= h - R) return false;
    const a = (cy - R) * (w + 1) + cx - R;
    const b = (cy + R + 1) * (w + 1) + cx + R + 1;
    return sum[b] - sum[(cy - R) * (w + 1) + cx + R + 1] - sum[(cy + R + 1) * (w + 1) + cx - R] + sum[a] === 0;
  };
  // 쓸 수 있는 후보 자리 목록 (무작위로 고를 때)
  const sources: number[] = [];
  for (let y = R; y < h - R; y++) for (let x = R; x < w - R; x++) if (validSource(x, y)) sources.push(y * w + x);
  if (!sources.length) return out;

  const known = new Uint8Array(n);
  for (let i = 0; i < n; i++) known[i] = hole[i] ? 0 : 1;
  /** 채운 픽셀이 어디서 왔는지 (전파에 쓴다), -1 은 원래 있던 픽셀 */
  const from = new Int32Array(n).fill(-1);

  const dist = (tx: number, ty: number, sx: number, sy: number, best: number) => {
    let d = 0;
    let c = 0;
    for (let dy = -R; dy <= R; dy++) {
      const ty2 = ty + dy;
      if (ty2 < 0 || ty2 >= h) continue;
      for (let dx = -R; dx <= R; dx++) {
        const tx2 = tx + dx;
        if (tx2 < 0 || tx2 >= w) continue;
        const ti = ty2 * w + tx2;
        if (!known[ti]) continue;
        const a = ti * 4;
        const b = ((sy + dy) * w + sx + dx) * 4;
        const r = px[a] - px[b];
        const gg = px[a + 1] - px[b + 1];
        const bb = px[a + 2] - px[b + 2];
        d += r * r + gg * gg + bb * bb;
        c++;
        if (d > best * 81) return Infinity;
      }
    }
    return c ? d / c : Infinity;
  };

  let remaining = hole.reduce((a, b) => a + b, 0);
  let guard = 0;
  while (remaining > 0 && guard++ < 100000) {
    // 테두리 픽셀: 아직 모르는데 이웃 중 아는 게 있는 곳. 조각 안에 아는 픽셀이 많은 순서로
    const front: { i: number; score: number }[] = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (known[i]) continue;
        if (!((x > 0 && known[i - 1]) || (x < w - 1 && known[i + 1]) || (y > 0 && known[i - w]) || (y < h - 1 && known[i + w]))) continue;
        let k = 0;
        for (let dy = -R; dy <= R; dy++)
          for (let dx = -R; dx <= R; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < w && yy < h && known[yy * w + xx]) k++;
          }
        front.push({ i, score: k });
      }
    if (!front.length) break;
    front.sort((a, b) => b.score - a.score);
    for (const { i } of front) {
      if (known[i]) continue;
      const tx = i % w;
      const ty = (i / w) | 0;
      let best = Infinity;
      let bx = -1;
      let by = -1;
      const tryAt = (sx: number, sy: number) => {
        if (!validSource(sx, sy)) return;
        const d = dist(tx, ty, sx, sy, best);
        if (d < best) {
          best = d;
          bx = sx;
          by = sy;
        }
      };
      // 이웃이 가져온 자리를 같은 방향으로 옮겨서 (결이 이어지게)
      for (let dy = -R; dy <= R; dy += 2)
        for (let dx = -R; dx <= R; dx += 2) {
          const xx = tx + dx;
          const yy = ty + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const f = from[yy * w + xx];
          if (f >= 0) tryAt((f % w) - dx, ((f / w) | 0) - dy);
        }
      for (let k = 0; k < 200; k++) {
        const s = sources[(Math.random() * sources.length) | 0];
        tryAt(s % w, (s / w) | 0);
      }
      // 가장 좋은 자리 근처를 좁혀 가며 다시 찾기
      for (let rad = Math.max(w, h) / 4; rad >= 1 && bx >= 0; rad /= 2)
        for (let k = 0; k < 4; k++) tryAt(Math.round(bx + (Math.random() * 2 - 1) * rad), Math.round(by + (Math.random() * 2 - 1) * rad));
      if (bx < 0) continue;
      // 조각 안의 모르는 픽셀을 모두 채운다
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          const xx = tx + dx;
          const yy = ty + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const ti = yy * w + xx;
          if (known[ti]) continue;
          const si = (by + dy) * w + bx + dx;
          for (let c = 0; c < 4; c++) px[ti * 4 + c] = px[si * 4 + c];
          known[ti] = 1;
          from[ti] = si;
          remaining--;
        }
    }
  }
  // 선택의 흐린 가장자리만큼 원래 그림과 섞는다 (잔무늬를 살리려고 따로 흐리게 하지 않는다)
  for (let i = 0; i < n; i++) {
    if (!hole[i]) continue;
    const a = alpha[i];
    for (let c = 0; c < 4; c++) px[i * 4 + c] = orig[i * 4 + c] * (1 - a) + px[i * 4 + c] * a;
  }
  g.putImageData(img, ax, ay);
  return out;
}
