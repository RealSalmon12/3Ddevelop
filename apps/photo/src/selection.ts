// 선택 영역: 그림 크기의 알파 그림 (불투명한 곳이 골라진 곳). 점선(행진하는 개미)은 경계에서 만든다.
import { createCanvas, ctx2d } from "./pixels";

export type SelectMode = "replace" | "add" | "subtract" | "intersect";

export interface Selection {
  canvas: HTMLCanvasElement;
  /** 경계선 (그림 좌표) */
  outline: Path2D;
  bounds: { x: number; y: number; w: number; h: number };
}

/** 모양 하나를 그려 넣는 함수로 새 선택을 만든다 */
function combine(prev: Selection | null, width: number, height: number, mode: SelectMode, paint: (g: CanvasRenderingContext2D) => void): Selection | null {
  const c = createCanvas(width, height);
  const g = ctx2d(c);
  if (prev && mode !== "replace") g.drawImage(prev.canvas, 0, 0);
  g.globalCompositeOperation = mode === "subtract" ? "destination-out" : mode === "intersect" ? "destination-in" : "source-over";
  g.fillStyle = "#000";
  paint(g);
  return finish(c);
}

export function selectShape(
  prev: Selection | null,
  width: number,
  height: number,
  mode: SelectMode,
  shape: "rect" | "ellipse",
  r: { x: number; y: number; w: number; h: number },
  feather = 0,
) {
  return combine(prev, width, height, mode, (g) => {
    if (feather > 0) g.filter = `blur(${feather}px)`;
    g.beginPath();
    if (shape === "rect") g.rect(r.x, r.y, r.w, r.h);
    else g.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
    g.fill();
  });
}

export function selectPolygon(prev: Selection | null, width: number, height: number, mode: SelectMode, pts: { x: number; y: number }[], feather = 0) {
  if (pts.length < 3) return prev;
  return combine(prev, width, height, mode, (g) => {
    if (feather > 0) g.filter = `blur(${feather}px)`;
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.closePath();
    g.fill();
  });
}

/** 알파 그림(예: 자동 선택 결과, 레이어 픽셀)으로 고르기 */
export function selectFromAlpha(prev: Selection | null, width: number, height: number, mode: SelectMode, alpha: CanvasImageSource) {
  return combine(prev, width, height, mode, (g) => g.drawImage(alpha, 0, 0, width, height));
}

export function selectAll(width: number, height: number) {
  return selectShape(null, width, height, "replace", "rect", { x: 0, y: 0, w: width, h: height });
}

export function invertSelection(sel: Selection | null, width: number, height: number) {
  const c = createCanvas(width, height);
  const g = ctx2d(c);
  g.fillStyle = "#000";
  g.fillRect(0, 0, width, height);
  if (sel) {
    g.globalCompositeOperation = "destination-out";
    g.drawImage(sel.canvas, 0, 0);
  }
  return finish(c);
}

/** 경계 흐리게 (페더) */
export function featherSelection(sel: Selection, radius: number) {
  const c = createCanvas(sel.canvas.width, sel.canvas.height);
  const g = ctx2d(c);
  g.filter = `blur(${radius}px)`;
  g.drawImage(sel.canvas, 0, 0);
  return finish(c);
}

/** 넓히기(+)/좁히기(-) */
export function growSelection(sel: Selection, px: number): Selection | null {
  const c = createCanvas(sel.canvas.width, sel.canvas.height);
  const g = ctx2d(c);
  if (px > 0) {
    const steps = Math.max(12, Math.ceil(px * 2));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      g.drawImage(sel.canvas, Math.cos(a) * px, Math.sin(a) * px);
    }
    g.drawImage(sel.canvas, 0, 0);
  } else {
    // 좁히기 = 반대쪽을 넓힌 뒤 다시 뒤집기
    const inv = invertSelection(sel, c.width, c.height);
    if (!inv) return null;
    const grown: Selection | null = growSelection(inv, -px);
    return grown ? invertSelection(grown, c.width, c.height) : null;
  }
  return finish(c);
}

/** 경계와 범위를 계산한다. 아무것도 안 골랐으면 null */
function finish(c: HTMLCanvasElement): Selection | null {
  const w = c.width;
  const h = c.height;
  const data = ctx2d(c).getImageData(0, 0, w, h).data;
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] >= 128;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  const path = new Path2D();
  for (let y = 0; y <= h; y++) {
    // 가로 경계 (y 줄 위쪽 모서리): 위 칸과 아래 칸이 다르면
    let run = -1;
    for (let x = 0; x <= w; x++) {
      const edge = x < w && on(x, y) !== on(x, y - 1);
      if (edge && run < 0) run = x;
      if (!edge && run >= 0) {
        path.moveTo(run, y);
        path.lineTo(x, y);
        run = -1;
      }
      if (y < h && x < w && on(x, y)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  for (let x = 0; x <= w; x++) {
    let run = -1;
    for (let y = 0; y <= h; y++) {
      const edge = y < h && on(x, y) !== on(x - 1, y);
      if (edge && run < 0) run = y;
      if (!edge && run >= 0) {
        path.moveTo(x, run);
        path.lineTo(x, y);
        run = -1;
      }
    }
  }
  return { canvas: c, outline: path, bounds: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } };
}

/**
 * 자동 선택 (마술봉) / 페인트 통: (x, y) 와 비슷한 색인 곳을 알파 그림으로 돌려준다.
 * contiguous 면 이어진 곳만.
 */
export function floodRegion(source: ImageData, x: number, y: number, tolerance: number, contiguous: boolean): HTMLCanvasElement {
  const { width: w, height: h, data } = source;
  const out = new ImageData(w, h);
  const o = out.data;
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= w || y >= h) return toCanvas(out);
  const i0 = (y * w + x) * 4;
  const r0 = data[i0];
  const g0 = data[i0 + 1];
  const b0 = data[i0 + 2];
  const a0 = data[i0 + 3];
  const tol = tolerance * 2.55;
  const near = (i: number) =>
    Math.abs(data[i] - r0) <= tol && Math.abs(data[i + 1] - g0) <= tol && Math.abs(data[i + 2] - b0) <= tol && Math.abs(data[i + 3] - a0) <= tol;
  if (!contiguous) {
    for (let i = 0; i < data.length; i += 4) if (near(i)) o[i + 3] = 255;
    return toCanvas(out);
  }
  const seen = new Uint8Array(w * h);
  const stack = [x, y];
  while (stack.length) {
    const sy = stack.pop()!;
    let sx = stack.pop()!;
    while (sx >= 0 && !seen[sy * w + sx] && near((sy * w + sx) * 4)) sx--;
    sx++;
    let up = false;
    let down = false;
    while (sx < w && !seen[sy * w + sx] && near((sy * w + sx) * 4)) {
      const k = sy * w + sx;
      seen[k] = 1;
      o[k * 4 + 3] = 255;
      if (sy > 0) {
        const n = near(((sy - 1) * w + sx) * 4) && !seen[(sy - 1) * w + sx];
        if (n && !up) stack.push(sx, sy - 1);
        up = n;
      }
      if (sy < h - 1) {
        const n = near(((sy + 1) * w + sx) * 4) && !seen[(sy + 1) * w + sx];
        if (n && !down) stack.push(sx, sy + 1);
        down = n;
      }
      sx++;
    }
  }
  return toCanvas(out);
}

function toCanvas(data: ImageData) {
  const c = createCanvas(data.width, data.height);
  ctx2d(c).putImageData(data, 0, 0);
  return c;
}
