// 픽셀을 바꾸는 도구들: 붓, 지우개, 도장, 페인트 통, 그레이디언트, 필터.
// 모두 원래 캔버스는 두고 새 캔버스를 만든다 (실행 취소를 위해).
import { createCanvas, ctx2d, cloneCanvas } from "./pixels";
import { floodRegion } from "./selection";

export interface Brush {
  /** 지름 (그림 px) */
  size: number;
  /** 0~100: 가장자리 단단함 */
  hardness: number;
  /** 0~100 */
  opacity: number;
}

export type StrokeMode = "paint" | "erase" | "clone";

/** 선택 영역(그림 좌표)을 레이어 픽셀 공간으로 옮긴 알파 그림 */
export function localSelection(sel: HTMLCanvasElement | null, toDoc: DOMMatrix, width: number, height: number) {
  if (!sel) return null;
  const c = createCanvas(width, height);
  const g = ctx2d(c);
  g.setTransform(toDoc.inverse());
  g.drawImage(sel, 0, 0);
  return c;
}

/** 처리한 그림을 선택 영역 안에만 적용 */
export function throughSelection(base: HTMLCanvasElement, processed: HTMLCanvasElement, sel: HTMLCanvasElement | null) {
  if (!sel) return processed;
  const out = cloneCanvas(base);
  const g = ctx2d(out);
  g.globalCompositeOperation = "destination-out";
  g.drawImage(sel, 0, 0);
  const masked = cloneCanvas(processed);
  const m = ctx2d(masked);
  m.globalCompositeOperation = "destination-in";
  m.drawImage(sel, 0, 0);
  g.globalCompositeOperation = "source-over";
  g.drawImage(masked, 0, 0);
  return out;
}

function dabImage(diameter: number, hardness: number, color: string) {
  const d = Math.max(1, Math.ceil(diameter));
  const c = createCanvas(d, d);
  const g = ctx2d(c);
  const r = diameter / 2;
  const grad = g.createRadialGradient(d / 2, d / 2, 0, d / 2, d / 2, r);
  const h = Math.min(0.99, hardness / 100);
  grad.addColorStop(0, color);
  grad.addColorStop(h, color);
  grad.addColorStop(1, color.length === 7 ? `${color}00` : "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.beginPath();
  g.arc(d / 2, d / 2, r, 0, Math.PI * 2);
  g.fill();
  return c;
}

/**
 * 붓질 한 번. 점을 더할 때마다 작은 도장을 촘촘히 찍고, result() 는 원래 그림 + 붓질을 합친 그림.
 * 좌표는 모두 레이어 픽셀 공간.
 */
export class Stroke {
  private stroke: HTMLCanvasElement;
  private sg: CanvasRenderingContext2D;
  private working: HTMLCanvasElement;
  private dab: HTMLCanvasElement;
  private last: { x: number; y: number } | null = null;
  private dirty = true;
  private diameter: number;

  constructor(
    private base: HTMLCanvasElement,
    private mode: StrokeMode,
    color: string,
    private brush: Brush,
    /** 그림 1px 이 레이어 몇 px 인지 */
    localPerDoc: number,
    private sel: HTMLCanvasElement | null,
    /** 도장: 원본 위치 - 칠하는 위치 */
    private cloneOffset: { dx: number; dy: number } | null = null,
  ) {
    this.stroke = createCanvas(base.width, base.height);
    this.sg = ctx2d(this.stroke);
    this.working = createCanvas(base.width, base.height);
    this.diameter = Math.max(1, brush.size * localPerDoc);
    this.dab = dabImage(this.diameter, brush.hardness, mode === "paint" ? color : "#000000");
  }

  add(x: number, y: number) {
    this.dirty = true;
    if (!this.last) {
      this.stamp(x, y);
      this.last = { x, y };
      return;
    }
    const dx = x - this.last.x;
    const dy = y - this.last.y;
    const dist = Math.hypot(dx, dy);
    const spacing = Math.max(0.5, this.diameter * 0.12);
    const steps = Math.floor(dist / spacing);
    if (!steps) return;
    const ux = (dx / dist) * spacing;
    const uy = (dy / dist) * spacing;
    for (let i = 1; i <= steps; i++) this.stamp(this.last.x + ux * i, this.last.y + uy * i);
    this.last = { x: this.last.x + ux * steps, y: this.last.y + uy * steps };
  }

  private stamp(x: number, y: number) {
    const r = this.diameter / 2;
    if (this.mode === "clone" && this.cloneOffset) {
      const d = this.dab.width;
      const tmp = createCanvas(d, d);
      const tg = ctx2d(tmp);
      tg.drawImage(this.base, -(x - r + this.cloneOffset.dx), -(y - r + this.cloneOffset.dy));
      tg.globalCompositeOperation = "destination-in";
      tg.drawImage(this.dab, 0, 0);
      this.sg.drawImage(tmp, x - r, y - r);
      return;
    }
    this.sg.drawImage(this.dab, x - r, y - r);
  }

  result() {
    if (!this.dirty) return this.working;
    this.dirty = false;
    const g = ctx2d(this.working);
    g.globalCompositeOperation = "copy";
    g.drawImage(this.base, 0, 0);
    let s = this.stroke;
    if (this.sel) {
      s = cloneCanvas(this.stroke);
      const m = ctx2d(s);
      m.globalCompositeOperation = "destination-in";
      m.drawImage(this.sel, 0, 0);
    }
    g.globalAlpha = this.brush.opacity / 100;
    g.globalCompositeOperation = this.mode === "erase" ? "destination-out" : "source-over";
    g.drawImage(s, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    return this.working;
  }
}

/** 페인트 통: 비슷한 색인 곳을 칠한다 */
export function bucketFill(base: HTMLCanvasElement, x: number, y: number, color: string, tolerance: number, contiguous: boolean, opacity: number, sel: HTMLCanvasElement | null, erase = false) {
  const data = ctx2d(base).getImageData(0, 0, base.width, base.height);
  const region = floodRegion(data, x, y, tolerance, contiguous);
  const paint = createCanvas(base.width, base.height);
  const g = ctx2d(paint);
  g.drawImage(region, 0, 0);
  g.globalCompositeOperation = "source-in";
  g.fillStyle = color;
  g.fillRect(0, 0, paint.width, paint.height);
  if (sel) {
    g.globalCompositeOperation = "destination-in";
    g.drawImage(sel, 0, 0);
  }
  const out = cloneCanvas(base);
  const o = ctx2d(out);
  o.globalAlpha = opacity / 100;
  if (erase) o.globalCompositeOperation = "destination-out";
  o.drawImage(paint, 0, 0);
  return out;
}

/** 선택 영역(없으면 전체)을 한 색으로 채우기 */
export function fillAll(base: HTMLCanvasElement, color: string, sel: HTMLCanvasElement | null) {
  const paint = createCanvas(base.width, base.height);
  const g = ctx2d(paint);
  g.fillStyle = color;
  g.fillRect(0, 0, paint.width, paint.height);
  if (sel) {
    g.globalCompositeOperation = "destination-in";
    g.drawImage(sel, 0, 0);
  }
  const out = cloneCanvas(base);
  ctx2d(out).drawImage(paint, 0, 0);
  return out;
}

/** 선택 영역(없으면 전체)을 투명하게 */
export function clearPixels(base: HTMLCanvasElement, sel: HTMLCanvasElement | null) {
  const out = cloneCanvas(base);
  const g = ctx2d(out);
  if (!sel) g.clearRect(0, 0, out.width, out.height);
  else {
    g.globalCompositeOperation = "destination-out";
    g.drawImage(sel, 0, 0);
  }
  return out;
}

export type GradientKind = "linear" | "radial";

export function drawGradient(
  base: HTMLCanvasElement,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  from: string,
  to: string | null,
  kind: GradientKind,
  opacity: number,
  sel: HTMLCanvasElement | null,
) {
  const paint = createCanvas(base.width, base.height);
  const g = ctx2d(paint);
  const grad =
    kind === "linear" ? g.createLinearGradient(p0.x, p0.y, p1.x, p1.y) : g.createRadialGradient(p0.x, p0.y, 0, p0.x, p0.y, Math.max(1, Math.hypot(p1.x - p0.x, p1.y - p0.y)));
  grad.addColorStop(0, from);
  grad.addColorStop(1, to ?? `${from}00`);
  g.fillStyle = grad;
  g.fillRect(0, 0, paint.width, paint.height);
  if (sel) {
    g.globalCompositeOperation = "destination-in";
    g.drawImage(sel, 0, 0);
  }
  const out = cloneCanvas(base);
  const o = ctx2d(out);
  o.globalAlpha = opacity / 100;
  o.drawImage(paint, 0, 0);
  return out;
}

export type FilterKind = "blur" | "sharpen" | "noise" | "mosaic" | "motion" | "glow";

export const FILTERS: { kind: FilterKind; label: string; amountLabel: string; min: number; max: number; initial: number }[] = [
  { kind: "blur", label: "가우시안 흐림", amountLabel: "반경 (px)", min: 0.5, max: 60, initial: 4 },
  { kind: "motion", label: "동작 흐림", amountLabel: "거리 (px)", min: 2, max: 120, initial: 24 },
  { kind: "sharpen", label: "언샵 마스크 (선명하게)", amountLabel: "양 (%)", min: 10, max: 300, initial: 100 },
  { kind: "noise", label: "노이즈 추가", amountLabel: "양 (%)", min: 1, max: 60, initial: 10 },
  { kind: "mosaic", label: "모자이크", amountLabel: "칸 크기 (px)", min: 2, max: 100, initial: 16 },
  { kind: "glow", label: "부드러운 빛 (블룸)", amountLabel: "세기 (%)", min: 5, max: 100, initial: 40 },
];

/** 필터를 건 새 캔버스 (선택 영역 안에만) */
export function applyFilter(base: HTMLCanvasElement, kind: FilterKind, amount: number, sel: HTMLCanvasElement | null) {
  const w = base.width;
  const h = base.height;
  const out = createCanvas(w, h);
  const g = ctx2d(out);
  if (kind === "blur") {
    g.filter = `blur(${amount}px)`;
    g.drawImage(base, 0, 0);
  } else if (kind === "motion") {
    const n = Math.max(4, Math.min(48, Math.round(amount / 2)));
    for (let i = 0; i < n; i++) {
      g.globalAlpha = 1 / (i + 1);
      g.drawImage(base, -amount / 2 + (amount * i) / (n - 1), 0);
    }
  } else if (kind === "mosaic") {
    const small = createCanvas(Math.max(1, w / amount), Math.max(1, h / amount));
    ctx2d(small).drawImage(base, 0, 0, small.width, small.height);
    g.imageSmoothingEnabled = false;
    g.drawImage(small, 0, 0, w, h);
  } else if (kind === "glow") {
    g.drawImage(base, 0, 0);
    g.globalCompositeOperation = "screen";
    g.globalAlpha = amount / 100;
    g.filter = `blur(${Math.max(4, Math.min(w, h) / 60)}px) brightness(115%)`;
    g.drawImage(base, 0, 0);
  } else {
    g.drawImage(base, 0, 0);
    const data = g.getImageData(0, 0, w, h);
    const px = data.data;
    if (kind === "noise") {
      const k = (amount / 100) * 255;
      for (let i = 0; i < px.length; i += 4) {
        const n = (Math.random() - 0.5) * k;
        px[i] += n;
        px[i + 1] += n;
        px[i + 2] += n;
      }
    } else {
      // 언샵 마스크: 원본 + (원본 - 흐린 것) × 양
      const blurred = createCanvas(w, h);
      const bg = ctx2d(blurred);
      bg.filter = "blur(2px)";
      bg.drawImage(base, 0, 0);
      const b = bg.getImageData(0, 0, w, h).data;
      const k = amount / 100;
      for (let i = 0; i < px.length; i += 4) {
        px[i] += (px[i] - b[i]) * k;
        px[i + 1] += (px[i + 1] - b[i + 1]) * k;
        px[i + 2] += (px[i + 2] - b[i + 2]) * k;
      }
    }
    g.putImageData(data, 0, 0);
  }
  return throughSelection(base, out, sel);
}

/** 레이어 픽셀을 그림 크기로 바꾸지 않고, 내용이 있는 범위 */
export function opaqueBounds(c: HTMLCanvasElement) {
  const { data, width: w, height: h } = ctx2d(c).getImageData(0, 0, c.width, c.height);
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[(y * w + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}
