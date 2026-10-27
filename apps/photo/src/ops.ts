// 문서를 바꾸는 작업들 (메뉴, 도구가 함께 쓴다). 모두 새 문서를 돌려준다.
import { newId, newRasterLayer, type Layer, type PhotoDoc, type RasterLayer } from "./model";
import { cloneCanvas, createCanvas, ctx2d, pixelsAsync, putBlank, putCanvas } from "./pixels";
import { flatten, layerMatrix, layerSize, layerToDocCanvas } from "./render";
import type { Selection } from "./selection";

export type TargetKind = "pixels" | "mask";

/** 칠할 대상: 고른 레이어의 픽셀이나 마스크 */
export interface PixelTarget {
  layer: Layer;
  kind: TargetKind;
  src: string;
  width: number;
  height: number;
  /** 대상 픽셀 공간 → 그림 좌표 */
  matrix: DOMMatrix;
}

export function pixelTarget(doc: PhotoDoc, layer: Layer | null, editMask: boolean): PixelTarget | string {
  if (!layer) return "칠할 레이어를 먼저 골라 주세요.";
  if (layer.locked) return "잠긴 레이어예요. 레이어 칸에서 🔒 를 풀어 주세요.";
  if (!layer.visible) return "숨긴 레이어에는 칠할 수 없어요.";
  const { w, h } = layerSize(layer, doc);
  if ((editMask || layer.kind === "adjust") && layer.mask) return { layer, kind: "mask", src: layer.mask.src, width: w, height: h, matrix: layerMatrix(layer, doc) };
  if (layer.kind === "raster") return { layer, kind: "pixels", src: layer.src, width: layer.width, height: layer.height, matrix: layerMatrix(layer, doc) };
  if (layer.kind === "adjust") return "보정 레이어예요. 마스크를 더해서 칠해 주세요.";
  return `${layer.kind === "text" ? "글자" : "도형"} 레이어에는 바로 칠할 수 없어요. ‘레이어 → 래스터화’를 하거나 새 레이어(Ctrl+Shift+N)에 칠해 주세요.`;
}

export function replaceTarget(doc: PhotoDoc, layerId: number, kind: TargetKind, src: string): PhotoDoc {
  return {
    ...doc,
    layers: doc.layers.map((l) => {
      if (l.id !== layerId) return l;
      if (kind === "mask" && l.mask) return { ...l, mask: { ...l.mask, src } };
      if (kind === "pixels" && l.kind === "raster") return { ...l, src };
      return l;
    }),
  };
}

export function replaceLayer(doc: PhotoDoc, layer: Layer): PhotoDoc {
  return { ...doc, layers: doc.layers.map((l) => (l.id === layer.id ? layer : l)) };
}

export function insertAbove(doc: PhotoDoc, layer: Layer, aboveId: number | null): PhotoDoc {
  const i = aboveId === null ? -1 : doc.layers.findIndex((l) => l.id === aboveId);
  const layers = [...doc.layers];
  layers.splice(i < 0 ? layers.length : i + 1, 0, layer);
  return { ...doc, layers };
}

/** 그림 크기의 빈 레이어 */
export function blankLayer(doc: PhotoDoc, name = "레이어"): RasterLayer {
  return newRasterLayer(doc, putBlank(doc.width, doc.height), doc.width, doc.height, name);
}

/** 대상의 픽셀을 바꾸는 함수에 선택 영역(대상 공간)을 함께 넘겨 준다 */
export async function editTarget(
  t: PixelTarget,
  selection: Selection | null,
  fn: (base: HTMLCanvasElement, sel: HTMLCanvasElement | null) => HTMLCanvasElement,
): Promise<string | null> {
  const base = await pixelsAsync(t.src);
  if (!base) return null;
  let sel: HTMLCanvasElement | null = null;
  if (selection) {
    sel = createCanvas(base.width, base.height);
    const g = ctx2d(sel);
    g.setTransform(t.matrix.inverse());
    g.drawImage(selection.canvas, 0, 0);
  }
  return putCanvas(fn(base, sel));
}

/** 마스크 추가: 모두 보이게, 또는 선택 영역만 보이게 */
export function addMask(doc: PhotoDoc, layer: Layer, selection: Selection | null, hideAll = false): PhotoDoc {
  const { w, h } = layerSize(layer, doc);
  const c = createCanvas(w, h);
  const g = ctx2d(c);
  if (selection && !hideAll) {
    g.setTransform(layerMatrix(layer, doc).inverse());
    g.drawImage(selection.canvas, 0, 0);
  } else if (!hideAll) {
    g.fillStyle = "#fff";
    g.fillRect(0, 0, w, h);
  }
  return replaceLayer(doc, { ...layer, mask: { src: putCanvas(c), enabled: true } });
}

/** 마스크를 픽셀에 적용하고 없앤다 */
export async function applyMask(doc: PhotoDoc, layer: RasterLayer): Promise<PhotoDoc> {
  if (!layer.mask) return doc;
  const [base, mask] = await Promise.all([pixelsAsync(layer.src), pixelsAsync(layer.mask.src)]);
  if (!base || !mask) return doc;
  const out = cloneCanvas(base);
  const g = ctx2d(out);
  g.globalCompositeOperation = "destination-in";
  g.drawImage(mask, 0, 0, out.width, out.height);
  return replaceLayer(doc, { ...layer, src: putCanvas(out), mask: null });
}

/** 글자, 도형, 효과, 마스크를 픽셀로 굳힌다 (그림 크기 레이어가 된다) */
export function rasterize(doc: PhotoDoc, layer: Layer): PhotoDoc {
  if (layer.kind === "adjust") return doc;
  const c = layerToDocCanvas({ ...layer, opacity: 1, blend: "source-over" }, doc);
  const next: RasterLayer = {
    ...newRasterLayer(doc, putCanvas(c), doc.width, doc.height, layer.name),
    id: layer.id,
    opacity: layer.opacity,
    blend: layer.blend,
    visible: layer.visible,
  };
  return replaceLayer(doc, next);
}

/** 아래 레이어와 합치기 */
export function mergeDown(doc: PhotoDoc, layerId: number): PhotoDoc | string {
  const i = doc.layers.findIndex((l) => l.id === layerId);
  if (i <= 0) return "아래에 합칠 레이어가 없어요.";
  const top = doc.layers[i];
  const below = doc.layers[i - 1];
  if (below.kind === "adjust") return "보정 레이어 위에는 합칠 수 없어요.";
  const c = layerToDocCanvas({ ...below, opacity: 1, blend: "source-over" }, doc);
  const g = ctx2d(c);
  if (top.kind === "adjust") {
    const sub: PhotoDoc = { ...doc, background: null, layers: [{ ...below, opacity: 1, blend: "source-over" }, top] };
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(flatten(sub), 0, 0);
    // 보정은 아래 레이어 모양 안에서만
    g.globalCompositeOperation = "destination-in";
    g.drawImage(layerToDocCanvas({ ...below, opacity: 1 }, doc), 0, 0);
  } else {
    const t = layerToDocCanvas(top, doc);
    g.globalCompositeOperation = top.blend;
    g.drawImage(t, 0, 0);
  }
  const merged: RasterLayer = { ...newRasterLayer(doc, putCanvas(c), doc.width, doc.height, below.name), id: below.id, opacity: below.opacity, blend: below.blend };
  const layers = [...doc.layers];
  layers.splice(i - 1, 2, merged);
  return { ...doc, layers };
}

/** 보이는 레이어 모두 합치기 (배경 포함 여부) */
export function mergeVisible(doc: PhotoDoc, withBackground: boolean): PhotoDoc {
  const visible = doc.layers.filter((l) => l.visible);
  if (!visible.length) return doc;
  const c = flatten({ ...doc, background: withBackground ? doc.background : null, layers: visible });
  const layer = newRasterLayer(doc, putCanvas(c), doc.width, doc.height, withBackground ? "배경" : "합친 레이어");
  if (withBackground) return { ...doc, layers: [layer] };
  const top = doc.layers.indexOf(visible[visible.length - 1]);
  const layers = doc.layers.filter((l, i) => !l.visible || i === top).map((l) => (l === visible[visible.length - 1] ? layer : l));
  return { ...doc, layers };
}

/** 선택 영역을 새 레이어로 복사 (Ctrl+J) */
export async function copySelectionToLayer(doc: PhotoDoc, t: PixelTarget, selection: Selection, cut: boolean): Promise<{ doc: PhotoDoc; layer: RasterLayer } | null> {
  const base = await pixelsAsync(t.src);
  if (!base) return null;
  const c = createCanvas(doc.width, doc.height);
  const g = ctx2d(c);
  g.setTransform(t.matrix);
  g.drawImage(base, 0, 0);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = "destination-in";
  g.drawImage(selection.canvas, 0, 0);
  const layer = { ...newRasterLayer(doc, putCanvas(c), doc.width, doc.height, `${t.layer.name} 복사`) };
  let next = doc;
  if (cut && t.kind === "pixels") {
    const id = await editTarget(t, selection, (b, sel) => {
      const out = cloneCanvas(b);
      const o = ctx2d(out);
      o.globalCompositeOperation = "destination-out";
      if (sel) o.drawImage(sel, 0, 0);
      return out;
    });
    if (id) next = replaceTarget(next, t.layer.id, "pixels", id);
  }
  return { doc: insertAbove(next, layer, t.layer.id), layer };
}

/** 그림 크기 바꾸기 (모든 레이어를 같이 늘리거나 줄인다) */
export function resampleDoc(doc: PhotoDoc, width: number, height: number): PhotoDoc {
  const sx = width / doc.width;
  const sy = height / doc.height;
  const s = Math.sqrt(sx * sy);
  return {
    ...doc,
    width,
    height,
    layers: doc.layers.map((l) => {
      if (l.kind === "adjust") return l;
      const scaled = { ...l, x: l.x * sx, y: l.y * sy, scale: l.scale * s };
      if (l.kind === "text") return { ...scaled, scale: l.scale, size: Math.max(1, Math.round(l.size * s)), strokeWidth: l.strokeWidth * s };
      return scaled;
    }),
  };
}

/** 캔버스 크기 (레이어는 그대로, 기준점에 맞춰 늘리거나 자르기) */
export function canvasSize(doc: PhotoDoc, width: number, height: number, ax: number, ay: number): PhotoDoc {
  const dx = (width - doc.width) * ax;
  const dy = (height - doc.height) * ay;
  return { ...doc, width, height, layers: doc.layers.map((l) => (l.kind === "adjust" ? l : { ...l, x: l.x + dx, y: l.y + dy })) };
}

export function cropDoc(doc: PhotoDoc, r: { x: number; y: number; w: number; h: number }): PhotoDoc {
  return { ...doc, width: Math.round(r.w), height: Math.round(r.h), layers: doc.layers.map((l) => (l.kind === "adjust" ? l : { ...l, x: l.x - r.x, y: l.y - r.y })) };
}

/** 캔버스 돌리기 (90도 단위) / 뒤집기 */
export function rotateDoc(doc: PhotoDoc, dir: 1 | -1): PhotoDoc {
  const { width: w, height: h } = doc;
  return {
    ...doc,
    width: h,
    height: w,
    layers: doc.layers.map((l) => {
      if (l.kind === "adjust") return l;
      const x = dir === 1 ? h - l.y : l.y;
      const y = dir === 1 ? l.x : w - l.x;
      return { ...l, x, y, rotation: l.rotation + 90 * dir };
    }),
  };
}

export function flipDoc(doc: PhotoDoc, horizontal: boolean): PhotoDoc {
  return {
    ...doc,
    layers: doc.layers.map((l) =>
      l.kind === "adjust"
        ? l
        : horizontal
          ? { ...l, x: doc.width - l.x, flipX: !l.flipX, rotation: -l.rotation }
          : { ...l, y: doc.height - l.y, flipY: !l.flipY, rotation: -l.rotation },
    ),
  };
}

export const duplicate = (doc: PhotoDoc, layer: Layer): { doc: PhotoDoc; layer: Layer } => {
  const copy = { ...layer, id: newId(), name: `${layer.name} 복사` } as Layer;
  return { doc: insertAbove(doc, copy, layer.id), layer: copy };
};
