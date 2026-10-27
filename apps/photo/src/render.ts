// 문서를 그림 한 장으로 합성한다 (화면, 내보내기, AI 가 보는 그림 모두 여기서).
import { applyAdjustment } from "./adjustments";
import type { Layer, PhotoDoc, QuickAdjust, RasterLayer, ShapeLayer, TextLayer } from "./model";
import { createCanvas, ctx2d, pixels } from "./pixels";

/** 붓질 중처럼 아직 저장소에 넣지 않은 픽셀: "레이어id" 또는 "레이어id:mask" → 캔버스 */
export type LiveOverrides = Map<string, HTMLCanvasElement>;

export interface RenderOptions {
  onLoad?: () => void;
  live?: LiveOverrides;
  /** 이 레이어는 빼고 그린다 (글자 고치는 중) */
  skip?: number;
}

const fontOf = (t: TextLayer) => `${t.bold ? 800 : 500} ${t.size}px "${t.font}", "Pretendard Variable", "Malgun Gothic", sans-serif`;

let measureCtx: CanvasRenderingContext2D | null = null;
/** 레이어의 픽셀 공간 크기 (scale 전). 보정 레이어는 그림 전체 */
export function layerSize(layer: Layer, doc: PhotoDoc): { w: number; h: number } {
  if (layer.kind === "raster" || layer.kind === "shape") return { w: layer.width, h: layer.height };
  if (layer.kind === "adjust") return { w: doc.width, h: doc.height };
  measureCtx ??= document.createElement("canvas").getContext("2d")!;
  measureCtx.font = fontOf(layer);
  const lines = layer.text.split("\n");
  const w = Math.max(...lines.map((l) => measureCtx!.measureText(l).width), layer.size * 0.5);
  const pad = layer.strokeWidth * 2 + (layer.shadow ? layer.size * 0.2 : 0);
  return { w: Math.ceil(w + pad), h: Math.ceil(lines.length * layer.size * 1.25 + pad) };
}

/** 레이어 픽셀 공간 → 그림 좌표 행렬 */
export function layerMatrix(layer: Layer, doc: PhotoDoc) {
  const { w, h } = layerSize(layer, doc);
  if (layer.kind === "adjust") return new DOMMatrix();
  return new DOMMatrix()
    .translate(layer.x, layer.y)
    .rotate(layer.rotation)
    .scale(layer.scale * (layer.flipX ? -1 : 1), layer.scale * (layer.flipY ? -1 : 1))
    .translate(-w / 2, -h / 2);
}

/** 그림 좌표 → 레이어 픽셀 좌표 */
export function toLayer(layer: Layer, doc: PhotoDoc, x: number, y: number) {
  const p = layerMatrix(layer, doc).inverse().transformPoint(new DOMPoint(x, y));
  return { x: p.x, y: p.y };
}

/** 레이어 네 모서리 (그림 좌표) */
export function layerCorners(layer: Layer, doc: PhotoDoc) {
  const { w, h } = layerSize(layer, doc);
  const m = layerMatrix(layer, doc);
  return [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ].map(([x, y]) => {
    const p = m.transformPoint(new DOMPoint(x, y));
    return { x: p.x, y: p.y };
  });
}

/** 점에 레이어가 있는지. 사진 레이어는 투명한 곳을 눌러도 아래로 지나간다. */
export function hitLayer(layer: Layer, doc: PhotoDoc, x: number, y: number) {
  if (!layer.visible || layer.kind === "adjust") return false;
  const { w, h } = layerSize(layer, doc);
  const p = toLayer(layer, doc, x, y);
  if (p.x < 0 || p.y < 0 || p.x >= w || p.y >= h) return false;
  if (layer.kind !== "raster") return true;
  const c = pixels(layer.src);
  if (!c) return true;
  return ctx2d(c).getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data[3] > 10;
}

function filterOf(a: QuickAdjust) {
  const parts = [`brightness(${a.brightness}%)`, `contrast(${a.contrast}%)`, `saturate(${a.saturation}%)`];
  if (a.grayscale) parts.push("grayscale(100%)");
  if (a.blur > 0) parts.push(`blur(${a.blur}px)`);
  return parts.join(" ");
}

const isNeutral = (a: QuickAdjust) => a.brightness === 100 && a.contrast === 100 && a.saturation === 100 && a.warmth === 0 && a.blur === 0 && !a.grayscale;

const adjustCache = new Map<string, HTMLCanvasElement>();
function quickAdjusted(src: HTMLCanvasElement, key: string, a: QuickAdjust) {
  const hit = adjustCache.get(key);
  if (hit) return hit;
  const c = createCanvas(src.width, src.height);
  const g = ctx2d(c);
  g.filter = filterOf(a);
  g.drawImage(src, 0, 0);
  g.filter = "none";
  if (a.warmth !== 0) {
    g.globalCompositeOperation = "soft-light";
    g.globalAlpha = Math.min(1, Math.abs(a.warmth) / 100);
    g.fillStyle = a.warmth > 0 ? "#ff8a00" : "#0077ff";
    g.fillRect(0, 0, c.width, c.height);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "destination-in";
    g.drawImage(src, 0, 0);
  }
  adjustCache.set(key, c);
  if (adjustCache.size > 6) adjustCache.delete(adjustCache.keys().next().value!);
  return c;
}

function drawText(g: CanvasRenderingContext2D, t: TextLayer, w: number, h: number) {
  g.font = fontOf(t);
  g.textAlign = t.align;
  g.textBaseline = "middle";
  g.lineJoin = "round";
  const lines = t.text.split("\n");
  const lh = t.size * 1.25;
  const pad = t.strokeWidth + (t.shadow ? t.size * 0.1 : 0);
  const x = t.align === "left" ? pad : t.align === "right" ? w - pad : w / 2;
  lines.forEach((line, i) => {
    const y = h / 2 + (i - (lines.length - 1) / 2) * lh;
    if (t.shadow) {
      g.save();
      g.shadowColor = "rgba(0,0,0,0.55)";
      g.shadowBlur = t.size * 0.12;
      g.shadowOffsetY = t.size * 0.06;
      g.fillStyle = t.strokeWidth > 0 ? t.strokeColor : t.color;
      if (t.strokeWidth > 0) {
        g.strokeStyle = t.strokeColor;
        g.lineWidth = t.strokeWidth * 2;
        g.strokeText(line, x, y);
      } else g.fillText(line, x, y);
      g.restore();
    }
    if (t.strokeWidth > 0) {
      g.strokeStyle = t.strokeColor;
      g.lineWidth = t.strokeWidth * 2;
      g.strokeText(line, x, y);
    }
    g.fillStyle = t.color;
    g.fillText(line, x, y);
  });
}

function drawShape(g: CanvasRenderingContext2D, s: ShapeLayer) {
  const inset = s.stroke ? s.strokeWidth / 2 : 0;
  const w = s.width - inset * 2;
  const h = s.height - inset * 2;
  g.beginPath();
  if (s.shape === "ellipse") g.ellipse(s.width / 2, s.height / 2, Math.max(0, w / 2), Math.max(0, h / 2), 0, 0, Math.PI * 2);
  else g.roundRect(inset, inset, Math.max(0, w), Math.max(0, h), s.shape === "round" ? Math.min(s.radius, w / 2, h / 2) : 0);
  if (s.fill) {
    g.fillStyle = s.fill;
    g.fill();
  }
  if (s.stroke && s.strokeWidth > 0) {
    g.strokeStyle = s.stroke;
    g.lineWidth = s.strokeWidth;
    g.stroke();
  }
}

const vectorCache = new Map<string, HTMLCanvasElement>();
/** 레이어 내용 (픽셀 공간, 마스크와 효과 전) */
export function layerContent(layer: Layer, doc: PhotoDoc, opts: RenderOptions = {}): HTMLCanvasElement | null {
  if (layer.kind === "raster") {
    const live = opts.live?.get(String(layer.id));
    const src = live ?? pixels(layer.src, opts.onLoad);
    if (!src) return null;
    if (isNeutral(layer.adjust) || live) return src;
    return quickAdjusted(src, `${layer.src}|${JSON.stringify(layer.adjust)}`, layer.adjust);
  }
  if (layer.kind === "adjust") return null;
  const { w, h } = layerSize(layer, doc);
  const key = JSON.stringify({ ...layer, id: 0, x: 0, y: 0, rotation: 0, scale: 0, opacity: 0, blend: 0, visible: 0, name: 0, effects: 0, mask: 0, flipX: 0, flipY: 0, locked: 0 });
  const hit = vectorCache.get(key);
  if (hit) return hit;
  const c = createCanvas(w, h);
  const g = ctx2d(c);
  if (layer.kind === "text") drawText(g, layer, c.width, c.height);
  else drawShape(g, layer);
  vectorCache.set(key, c);
  if (vectorCache.size > 40) vectorCache.delete(vectorCache.keys().next().value!);
  return c;
}

function maskCanvas(layer: Layer, opts: RenderOptions) {
  if (!layer.mask || !layer.mask.enabled) return null;
  return opts.live?.get(`${layer.id}:mask`) ?? pixels(layer.mask.src, opts.onLoad);
}

/** 마스크, 획(테두리)을 적용한 레이어 그림과 여백 */
function processed(layer: Exclude<Layer, { kind: "adjust" }>, doc: PhotoDoc, opts: RenderOptions) {
  const content = layerContent(layer, doc, opts);
  if (!content) return null;
  const mask = maskCanvas(layer, opts);
  const stroke = layer.effects.stroke;
  if (!mask && !stroke.on) return { canvas: content, pad: 0 };
  const pad = stroke.on ? Math.ceil(stroke.size / Math.max(0.05, layer.scale)) + 2 : 0;
  const c = createCanvas(content.width + pad * 2, content.height + pad * 2);
  const g = ctx2d(c);
  g.drawImage(content, pad, pad);
  if (mask) {
    g.globalCompositeOperation = "destination-in";
    g.drawImage(mask, pad, pad, content.width, content.height);
    g.globalCompositeOperation = "source-over";
  }
  if (stroke.on) {
    // 테두리: 모양을 한 가지 색으로 만든 뒤 둘레로 여러 번 찍어 아래에 깐다.
    const sil = createCanvas(c.width, c.height);
    const sg = ctx2d(sil);
    sg.drawImage(c, 0, 0);
    sg.globalCompositeOperation = "source-in";
    sg.fillStyle = stroke.color;
    sg.fillRect(0, 0, sil.width, sil.height);
    const ring = createCanvas(c.width, c.height);
    const rg = ctx2d(ring);
    const r = pad - 2;
    const steps = Math.max(12, Math.ceil(r * 1.5));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      rg.drawImage(sil, Math.cos(a) * r, Math.sin(a) * r);
    }
    rg.drawImage(sil, 0, 0);
    rg.drawImage(c, 0, 0);
    return { canvas: ring, pad };
  }
  return { canvas: c, pad };
}

/** 레이어 하나를 그림 좌표의 대상에 그린다 */
export function drawLayer(target: CanvasRenderingContext2D, layer: Layer, doc: PhotoDoc, opts: RenderOptions = {}) {
  if (!layer.visible || layer.kind === "adjust") return;
  const p = processed(layer, doc, opts);
  if (!p) return;
  const m = layerMatrix(layer, doc);
  target.save();
  const base = target.getTransform();
  const docScale = Math.hypot(base.a, base.b);
  const local = base.multiply(m);
  target.setTransform(local);
  const draw = () => target.drawImage(p.canvas, -p.pad, -p.pad);
  const { shadow, glow } = layer.effects;
  // 그림자와 빛: 레이어 모양을 한 색으로 칠하고 흐리게 해서 아래에 깐다.
  const shadowOnly = (color: string, alpha: number, blur: number, dx: number, dy: number) => {
    const sil = createCanvas(p.canvas.width, p.canvas.height);
    const sg = ctx2d(sil);
    sg.drawImage(p.canvas, 0, 0);
    sg.globalCompositeOperation = "source-in";
    sg.fillStyle = color;
    sg.fillRect(0, 0, sil.width, sil.height);
    target.save();
    target.setTransform(base.translate(dx, dy).multiply(m));
    if (blur > 0) target.filter = `blur(${(blur / 2) * docScale}px)`;
    target.globalAlpha = alpha * layer.opacity;
    target.drawImage(sil, -p.pad, -p.pad);
    target.restore();
  };
  if (glow.on) shadowOnly(glow.color, glow.opacity, glow.size, 0, 0);
  if (shadow.on) {
    const a = (shadow.angle * Math.PI) / 180;
    shadowOnly(shadow.color, shadow.opacity, shadow.size, -Math.cos(a) * shadow.distance, Math.sin(a) * shadow.distance);
  }
  target.globalAlpha = layer.opacity;
  target.globalCompositeOperation = layer.blend;
  draw();
  target.restore();
}

/** 보정 레이어: 지금까지 그린 그림의 픽셀을 바꾼다 (픽셀 좌표 그대로) */
function applyAdjustLayer(target: CanvasRenderingContext2D, layer: Layer & { kind: "adjust" }, doc: PhotoDoc, opts: RenderOptions) {
  if (layer.opacity <= 0) return;
  const t = target.getTransform();
  const w = Math.round(doc.width * t.a);
  const h = Math.round(doc.height * t.d);
  if (w < 1 || h < 1) return;
  const ox = Math.round(t.e);
  const oy = Math.round(t.f);
  const data = target.getImageData(ox, oy, w, h);
  let mask: Uint8ClampedArray | null = null;
  const mc = maskCanvas(layer, opts);
  if (mc) {
    const tmp = createCanvas(w, h);
    ctx2d(tmp).drawImage(mc, 0, 0, w, h);
    mask = ctx2d(tmp).getImageData(0, 0, w, h).data;
  }
  applyAdjustment(data, layer, mask);
  target.putImageData(data, ox, oy);
}

/**
 * 클리핑 그룹: 바탕 레이어를 따로 그린 뒤, 위에 클리핑된 레이어들을 바탕 모양 안에만 겹치고,
 * 그 결과를 바탕의 불투명도와 혼합 모드로 합친다 (포토샵과 같은 방식).
 */
function drawClipGroup(target: CanvasRenderingContext2D, base: Layer, clipped: Layer[], doc: PhotoDoc, opts: RenderOptions) {
  const W = target.canvas.width;
  const H = target.canvas.height;
  const t = target.getTransform();
  const group = createCanvas(W, H);
  const gg = ctx2d(group);
  gg.setTransform(t);
  drawLayer(gg, { ...base, opacity: 1, blend: "source-over" }, doc, opts);
  const shape = createCanvas(W, H);
  ctx2d(shape).drawImage(group, 0, 0);
  for (const layer of clipped) {
    if (layer.id === opts.skip || !layer.visible) continue;
    if (layer.kind === "adjust") {
      applyAdjustLayer(gg, layer, doc, opts);
      continue;
    }
    const tmp = createCanvas(W, H);
    const tg = ctx2d(tmp);
    tg.setTransform(t);
    drawLayer(tg, { ...layer, blend: "source-over" }, doc, opts);
    tg.setTransform(1, 0, 0, 1, 0, 0);
    tg.globalCompositeOperation = "destination-in";
    tg.drawImage(shape, 0, 0);
    gg.save();
    gg.setTransform(1, 0, 0, 1, 0, 0);
    gg.globalCompositeOperation = layer.blend === "source-over" ? "source-atop" : layer.blend;
    gg.drawImage(tmp, 0, 0);
    gg.restore();
  }
  target.save();
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.globalAlpha = base.opacity;
  target.globalCompositeOperation = base.blend;
  target.drawImage(group, 0, 0);
  target.restore();
}

/** 문서 전체를 그림 크기 캔버스에 합성한다 */
export function renderDoc(target: CanvasRenderingContext2D, doc: PhotoDoc, opts: RenderOptions = {}) {
  target.save();
  if (doc.background) {
    target.fillStyle = doc.background;
    target.fillRect(0, 0, doc.width, doc.height);
  }
  const layers = doc.layers;
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    // 바로 위에 붙은 클리핑 레이어들
    let j = i + 1;
    while (j < layers.length && layers[j].clip) j++;
    const clipped = layer.kind === "adjust" ? [] : layers.slice(i + 1, j);
    if (clipped.length) {
      // 바탕이 숨으면 클리핑된 레이어도 함께 숨는다
      if (layer.id !== opts.skip && layer.visible) drawClipGroup(target, layer, clipped, doc, opts);
      i = j - 1;
      continue;
    }
    if (layer.id === opts.skip || !layer.visible) continue;
    if (layer.kind === "adjust") applyAdjustLayer(target, layer, doc, opts);
    else drawLayer(target, layer, doc, opts);
  }
  target.restore();
}

/** 문서를 새 캔버스 한 장으로 (scale 배) */
export function flatten(doc: PhotoDoc, scale = 1, opts: RenderOptions = {}) {
  const c = createCanvas(doc.width * scale, doc.height * scale);
  const g = ctx2d(c);
  g.scale(scale, scale);
  renderDoc(g, doc, opts);
  return c;
}

/** 레이어 한 장만 그림 크기로 (병합, 래스터화) */
export function layerToDocCanvas(layer: Layer, doc: PhotoDoc) {
  const c = createCanvas(doc.width, doc.height);
  drawLayer(ctx2d(c), { ...layer, visible: true }, doc);
  return c;
}

export type { RasterLayer };
