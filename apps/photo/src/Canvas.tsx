import { useEffect, useRef } from "react";
import type { Layer, PhotoDoc, ShapeKind } from "./model";
import { Stroke, bucketFill, drawGradient, localSelection, type Brush, type GradientKind } from "./paint";
import { ctx2d, pixels, putCanvas, createCanvas } from "./pixels";
import { pixelTarget, replaceLayer, replaceTarget, type PixelTarget } from "./ops";
import { flatten, hitLayer, layerCorners, renderDoc, toLayer, type LiveOverrides } from "./render";
import { floodRegion, selectFromAlpha, selectPolygon, selectShape, type SelectMode, type Selection } from "./selection";

export type ToolId = "move" | "marquee" | "lasso" | "wand" | "crop" | "eyedropper" | "brush" | "eraser" | "clone" | "bucket" | "gradient" | "text" | "shape" | "hand" | "zoom";

export interface ToolOptions {
  brush: Brush;
  eraser: Brush;
  clone: Brush;
  marquee: "rect" | "ellipse";
  feather: number;
  wandTolerance: number;
  wandContiguous: boolean;
  wandAllLayers: boolean;
  bucketTolerance: number;
  bucketContiguous: boolean;
  gradient: GradientKind;
  gradientToTransparent: boolean;
  shape: ShapeKind;
  autoSelect: boolean;
}

export const DEFAULT_OPTIONS: ToolOptions = {
  brush: { size: 30, hardness: 80, opacity: 100 },
  eraser: { size: 40, hardness: 60, opacity: 100 },
  clone: { size: 40, hardness: 50, opacity: 100 },
  marquee: "rect",
  feather: 0,
  wandTolerance: 32,
  wandContiguous: true,
  wandAllLayers: true,
  bucketTolerance: 32,
  bucketContiguous: true,
  gradient: "linear",
  gradientToTransparent: false,
  shape: "rect",
  autoSelect: true,
};

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  doc: PhotoDoc;
  tool: ToolId;
  options: ToolOptions;
  selectedId: number | null;
  editMask: boolean;
  selection: Selection | null;
  fg: string;
  bg: string;
  crop: CropRect | null;
  cloneSource: { x: number; y: number } | null;
  editingTextId: number | null;
  onSelectLayer: (id: number | null) => void;
  onPreview: (doc: PhotoDoc) => void;
  onCommit: () => void;
  onSet: (fn: (doc: PhotoDoc) => PhotoDoc) => void;
  onSelection: (sel: Selection | null) => void;
  onPickColor: (hex: string) => void;
  onAddText: (x: number, y: number) => void;
  onAddShape: (r: CropRect) => void;
  onCrop: (r: CropRect | null) => void;
  onCloneSource: (p: { x: number; y: number }) => void;
  onNotify: (msg: string) => void;
  onNeedLayer: () => Layer | null;
  onStatus: (s: { x: number; y: number; zoom: number }) => void;
}

const HANDLE = 8;
const PAINT_TOOLS: ToolId[] = ["brush", "eraser", "clone"];

const luma = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
};

/**
 * 작업 화면. 그림을 합성해서 보여 주고, 도구에 따라 마우스를 받는다.
 * 확대/이동은 안에서 들고 있고, 밖에서는 photo-view 이벤트로 바꾼다.
 */
export function PhotoCanvas(props: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const redrawRef = useRef<(full?: boolean) => void>(() => {});

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    let frame = 0;
    let space = false;
    let alt = false;
    let pan = { x: 0, y: 0 };
    let zoom = 1;
    let mouse: { x: number; y: number } | null = null;
    let composite: HTMLCanvasElement | null = null;
    let compositeFor: PhotoDoc | null = null;
    let compositeDirty = true;
    const live: LiveOverrides = new Map();
    let antsOffset = 0;
    let cloneOffset: { dx: number; dy: number } | null = null;
    let cloneFor: { x: number; y: number } | null = null;
    let lastPaint: { x: number; y: number } | null = null;

    type Drag =
      | { kind: "pan"; sx: number; sy: number; px: number; py: number }
      | { kind: "move"; layer: Layer; sx: number; sy: number; moved: boolean }
      | { kind: "scale"; layer: Layer; dist: number }
      | { kind: "rotate"; layer: Layer; a0: number }
      | { kind: "crop"; sx: number; sy: number }
      | { kind: "marquee"; sx: number; sy: number; ex: number; ey: number; mode: SelectMode }
      | { kind: "lasso"; pts: { x: number; y: number }[]; mode: SelectMode }
      | { kind: "paint"; stroke: Stroke; target: PixelTarget; key: string }
      | { kind: "gradient"; sx: number; sy: number; ex: number; ey: number }
      | { kind: "shape"; sx: number; sy: number; ex: number; ey: number };
    let drag: Drag | null = null;

    const view = () => {
      const { doc } = latest.current;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const fit = Math.min((w - 120) / doc.width, (h - 80) / doc.height, 1);
      const s = fit * zoom;
      return { s, ox: Math.round((w - doc.width * s) / 2 + pan.x + 30), oy: Math.round((h - doc.height * s) / 2 + pan.y) };
    };
    const toDoc = (e: { clientX: number; clientY: number }) => {
      const rect = canvas.getBoundingClientRect();
      const { s, ox, oy } = view();
      return { x: (e.clientX - rect.left - ox) / s, y: (e.clientY - rect.top - oy) / s };
    };
    const selectedLayer = () => latest.current.doc.layers.find((l) => l.id === latest.current.selectedId) ?? null;

    const getComposite = () => {
      const { doc, editingTextId } = latest.current;
      if (!composite || compositeDirty || compositeFor !== doc) {
        composite = flatten({ ...doc, background: doc.background }, 1, { onLoad: () => redraw(true), live, skip: editingTextId ?? undefined });
        compositeFor = doc;
        compositeDirty = false;
      }
      return composite;
    };

    const draw = () => {
      frame = 0;
      const p = latest.current;
      const { doc } = p;
      const dpr = window.devicePixelRatio || 1;
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      if (canvas.width !== Math.round(cw * dpr)) canvas.width = Math.round(cw * dpr);
      if (canvas.height !== Math.round(ch * dpr)) canvas.height = Math.round(ch * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      const { s, ox, oy } = view();
      const dw = doc.width * s;
      const dh = doc.height * s;
      // 바둑판 (투명)
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 18;
      ctx.fillStyle = "#fff";
      ctx.fillRect(ox, oy, dw, dh);
      ctx.restore();
      if (!doc.background) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(ox, oy, dw, dh);
        ctx.clip();
        ctx.fillStyle = "#cfd3dd";
        const cell = 8;
        for (let y = 0; y < dh; y += cell) for (let x = ((y / cell) % 2) * cell; x < dw; x += cell * 2) ctx.fillRect(ox + x, oy + y, cell, cell);
        ctx.restore();
      }
      const img = getComposite();
      ctx.imageSmoothingEnabled = s < 2;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, ox, oy, dw, dh);

      const sel = selectedLayer();
      // 선택 영역 (행진하는 개미)
      if (p.selection) {
        ctx.save();
        ctx.translate(ox, oy);
        ctx.scale(s, s);
        ctx.lineWidth = 1 / s;
        ctx.strokeStyle = "#000";
        ctx.setLineDash([4 / s, 4 / s]);
        ctx.lineDashOffset = antsOffset / s;
        ctx.stroke(p.selection.outline);
        ctx.strokeStyle = "#fff";
        ctx.lineDashOffset = (antsOffset + 4) / s;
        ctx.stroke(p.selection.outline);
        ctx.restore();
      }

      // 고른 레이어의 변형 상자
      if (sel && p.tool === "move" && sel.kind !== "adjust") {
        const pts = layerCorners(sel, doc).map((c) => ({ x: ox + c.x * s, y: oy + c.y * s }));
        ctx.beginPath();
        pts.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)));
        ctx.closePath();
        ctx.strokeStyle = "#4da3ff";
        ctx.lineWidth = 1;
        ctx.stroke();
        for (const c of pts) {
          ctx.fillStyle = "#fff";
          ctx.strokeStyle = "#4da3ff";
          ctx.fillRect(c.x - HANDLE / 2, c.y - HANDLE / 2, HANDLE, HANDLE);
          ctx.strokeRect(c.x - HANDLE / 2, c.y - HANDLE / 2, HANDLE, HANDLE);
        }
        const knob = rotateKnob(pts);
        ctx.beginPath();
        ctx.moveTo((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
        ctx.lineTo(knob.x, knob.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(knob.x, knob.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = "#4da3ff";
        ctx.fill();
      }

      // 끄는 중인 모양
      ctx.save();
      ctx.lineWidth = 1;
      if (drag?.kind === "marquee" || drag?.kind === "shape") {
        const r = normRect(drag.sx, drag.sy, drag.ex, drag.ey);
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "#fff";
        ctx.beginPath();
        const ellipse = drag.kind === "marquee" ? p.options.marquee === "ellipse" : p.options.shape === "ellipse";
        if (ellipse) ctx.ellipse(ox + (r.x + r.w / 2) * s, oy + (r.y + r.h / 2) * s, (r.w / 2) * s, (r.h / 2) * s, 0, 0, Math.PI * 2);
        else ctx.rect(ox + r.x * s, oy + r.y * s, r.w * s, r.h * s);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (drag?.kind === "lasso") {
        ctx.strokeStyle = "#fff";
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        drag.pts.forEach((q, i) => (i ? ctx.lineTo(ox + q.x * s, oy + q.y * s) : ctx.moveTo(ox + q.x * s, oy + q.y * s)));
        ctx.stroke();
      }
      if (drag?.kind === "gradient") {
        ctx.strokeStyle = "#fff";
        ctx.beginPath();
        ctx.moveTo(ox + drag.sx * s, oy + drag.sy * s);
        ctx.lineTo(ox + drag.ex * s, oy + drag.ey * s);
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.fillRect(ox + drag.sx * s - 3, oy + drag.sy * s - 3, 6, 6);
      }
      ctx.restore();

      // 자르기
      if (p.tool === "crop" && p.crop) {
        const c = p.crop;
        const x = ox + c.x * s;
        const y = oy + c.y * s;
        const w = c.w * s;
        const h = c.h * s;
        ctx.fillStyle = "rgba(8,10,18,0.6)";
        ctx.beginPath();
        ctx.rect(ox, oy, dw, dh);
        ctx.rect(x, y, w, h);
        ctx.fill("evenodd");
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, w, h);
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const t of [1 / 3, 2 / 3]) {
          ctx.moveTo(x + w * t, y);
          ctx.lineTo(x + w * t, y + h);
          ctx.moveTo(x, y + h * t);
          ctx.lineTo(x + w, y + h * t);
        }
        ctx.stroke();
      }

      // 도장 원본 위치
      if (p.tool === "clone" && p.cloneSource) {
        const src = drag?.kind === "paint" && cloneOffset && mouse ? { x: mouse.x + cloneOffset.dx, y: mouse.y + cloneOffset.dy } : p.cloneSource;
        const cx = ox + src.x * s;
        const cy = oy + src.y * s;
        ctx.strokeStyle = "#fff";
        ctx.beginPath();
        ctx.moveTo(cx - 8, cy);
        ctx.lineTo(cx + 8, cy);
        ctx.moveTo(cx, cy - 8);
        ctx.lineTo(cx, cy + 8);
        ctx.stroke();
      }

      // 붓 크기 동그라미
      if (mouse && PAINT_TOOLS.includes(p.tool) && !space) {
        const b = p.tool === "brush" ? p.options.brush : p.tool === "eraser" ? p.options.eraser : p.options.clone;
        const r = Math.max(1, (b.size / 2) * s);
        ctx.beginPath();
        ctx.arc(ox + mouse.x * s, oy + mouse.y * s, r, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    };

    const redraw = (full = false) => {
      if (full) compositeDirty = true;
      if (!frame) frame = requestAnimationFrame(draw);
    };
    redrawRef.current = redraw;

    const status = () => {
      const { s } = view();
      latest.current.onStatus({ x: mouse ? Math.floor(mouse.x) : -1, y: mouse ? Math.floor(mouse.y) : -1, zoom: Math.round(s * 100) });
    };

    const modeOf = (e: { shiftKey: boolean; altKey: boolean }): SelectMode =>
      e.shiftKey && e.altKey ? "intersect" : e.shiftKey ? "add" : e.altKey ? "subtract" : "replace";

    const sampleColor = (x: number, y: number) => {
      const c = getComposite();
      if (x < 0 || y < 0 || x >= c.width || y >= c.height) return null;
      const d = ctx2d(c).getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
      return `#${[d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    };

    const target = (): PixelTarget | null => {
      const p = latest.current;
      let layer = selectedLayer();
      if (!layer) layer = p.onNeedLayer();
      const t = pixelTarget(latest.current.doc, layer, p.editMask);
      if (typeof t === "string") {
        p.onNotify(t);
        return null;
      }
      return t;
    };

    const onDown = (e: PointerEvent) => {
      const p = latest.current;
      canvas.setPointerCapture(e.pointerId);
      canvas.focus();
      if (e.button === 1 || e.button === 2 || space || p.tool === "hand") {
        drag = { kind: "pan", sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
        return;
      }
      const pt = toDoc(e);
      const { s } = view();
      switch (p.tool) {
        case "zoom":
          zoomAt(e.altKey ? 1 / 1.5 : 1.5, e.clientX, e.clientY);
          return;
        case "eyedropper": {
          const c = sampleColor(pt.x, pt.y);
          if (c) p.onPickColor(c);
          return;
        }
        case "crop":
          drag = { kind: "crop", sx: pt.x, sy: pt.y };
          return;
        case "marquee":
          drag = { kind: "marquee", sx: pt.x, sy: pt.y, ex: pt.x, ey: pt.y, mode: modeOf(e) };
          return;
        case "lasso":
          drag = { kind: "lasso", pts: [pt], mode: modeOf(e) };
          return;
        case "wand": {
          const src = p.options.wandAllLayers ? getComposite() : (() => {
            const l = selectedLayer();
            return l ? flatten({ ...p.doc, background: null, layers: [l] }) : getComposite();
          })();
          const data = ctx2d(src).getImageData(0, 0, src.width, src.height);
          const region = floodRegion(data, pt.x, pt.y, p.options.wandTolerance, p.options.wandContiguous);
          p.onSelection(selectFromAlpha(p.selection, p.doc.width, p.doc.height, modeOf(e), region));
          return;
        }
        case "text": {
          const hit = [...p.doc.layers].reverse().find((l) => l.kind === "text" && hitLayer(l, p.doc, pt.x, pt.y));
          if (hit) p.onSelectLayer(hit.id);
          else p.onAddText(pt.x, pt.y);
          return;
        }
        case "shape":
          drag = { kind: "shape", sx: pt.x, sy: pt.y, ex: pt.x, ey: pt.y };
          return;
        case "gradient":
          drag = { kind: "gradient", sx: pt.x, sy: pt.y, ex: pt.x, ey: pt.y };
          return;
        case "bucket": {
          const t = target();
          if (!t) return;
          const base = pixels(t.src);
          if (!base) return;
          const local = t.matrix.inverse().transformPoint(new DOMPoint(pt.x, pt.y));
          const sel = localSelection(p.selection?.canvas ?? null, t.matrix, base.width, base.height);
          const hide = t.kind === "mask" && luma(p.fg) < 128;
          const out = bucketFill(base, local.x, local.y, t.kind === "mask" ? "#ffffff" : p.fg, p.options.bucketTolerance, p.options.bucketContiguous, 100, sel, hide);
          const id = putCanvas(out);
          p.onSet((d) => replaceTarget(d, t.layer.id, t.kind, id));
          return;
        }
        case "brush":
        case "eraser":
        case "clone": {
          if (p.tool === "clone" && e.altKey) {
            p.onCloneSource(pt);
            return;
          }
          if (p.tool === "brush" && e.altKey) {
            const c = sampleColor(pt.x, pt.y);
            if (c) p.onPickColor(c);
            return;
          }
          if (p.tool === "clone" && !p.cloneSource) {
            p.onNotify("먼저 Alt 를 누른 채 복사해 올 곳을 클릭하세요.");
            return;
          }
          const t = target();
          if (!t) return;
          const base = pixels(t.src);
          if (!base) return;
          const m = t.matrix;
          const localPerDoc = 1 / Math.hypot(m.a, m.b);
          const sel = localSelection(p.selection?.canvas ?? null, m, base.width, base.height);
          let mode: "paint" | "erase" | "clone" = p.tool === "brush" ? "paint" : p.tool === "eraser" ? "erase" : "clone";
          let color = p.fg;
          if (t.kind === "mask" && mode !== "clone") {
            // 마스크: 검정으로 칠하면 숨기고, 흰색이면 보이게. 지우개는 배경색으로 칠한다.
            const c = mode === "erase" ? p.bg : p.fg;
            mode = luma(c) < 128 ? "erase" : "paint";
            color = "#ffffff";
          }
          let offset: { dx: number; dy: number } | null = null;
          if (p.tool === "clone" && p.cloneSource) {
            if (cloneFor !== p.cloneSource || !cloneOffset) {
              cloneFor = p.cloneSource;
              cloneOffset = { dx: p.cloneSource.x - pt.x, dy: p.cloneSource.y - pt.y };
            }
            const a = m.inverse().transformPoint(new DOMPoint(pt.x + cloneOffset.dx, pt.y + cloneOffset.dy));
            const b = m.inverse().transformPoint(new DOMPoint(pt.x, pt.y));
            offset = { dx: a.x - b.x, dy: a.y - b.y };
          }
          const brush = p.tool === "brush" ? p.options.brush : p.tool === "eraser" ? p.options.eraser : p.options.clone;
          const stroke = new Stroke(base, mode, color, brush, localPerDoc, sel, offset);
          // Shift+클릭: 지난 붓질 끝에서 여기까지 직선
          if (e.shiftKey && lastPaint) {
            const from = m.inverse().transformPoint(new DOMPoint(lastPaint.x, lastPaint.y));
            stroke.add(from.x, from.y);
          }
          const local = m.inverse().transformPoint(new DOMPoint(pt.x, pt.y));
          stroke.add(local.x, local.y);
          const key = t.kind === "mask" ? `${t.layer.id}:mask` : String(t.layer.id);
          live.set(key, stroke.result());
          drag = { kind: "paint", stroke, target: t, key };
          redraw(true);
          return;
        }
        case "move": {
          const sel = selectedLayer();
          if (sel && sel.kind !== "adjust" && !sel.locked) {
            const pts = layerCorners(sel, p.doc).map((c) => ({ x: c.x * s, y: c.y * s }));
            const knob = rotateKnob(pts);
            const m = { x: pt.x * s, y: pt.y * s };
            if (Math.hypot(knob.x - m.x, knob.y - m.y) < 10) {
              drag = { kind: "rotate", layer: sel, a0: Math.atan2(pt.y - sel.y, pt.x - sel.x) };
              return;
            }
            if (pts.some((c) => Math.hypot(c.x - m.x, c.y - m.y) < HANDLE + 3)) {
              drag = { kind: "scale", layer: sel, dist: Math.hypot(pt.x - sel.x, pt.y - sel.y) || 1 };
              return;
            }
          }
          let hit: Layer | null = sel && sel.kind !== "adjust" && hitLayer(sel, p.doc, pt.x, pt.y) ? sel : null;
          if (!hit && (p.options.autoSelect || e.ctrlKey)) hit = [...p.doc.layers].reverse().find((l) => hitLayer(l, p.doc, pt.x, pt.y)) ?? null;
          if (!hit && sel && sel.kind !== "adjust") hit = sel;
          if (hit && hit.id !== p.selectedId) p.onSelectLayer(hit.id);
          if (hit && hit.locked) return p.onNotify("잠긴 레이어예요.");
          if (hit) drag = { kind: "move", layer: hit, sx: pt.x, sy: pt.y, moved: false };
          return;
        }
      }
    };

    const onMove = (e: PointerEvent) => {
      const p = latest.current;
      const pt = toDoc(e);
      mouse = pt;
      status();
      if (!drag) {
        if (PAINT_TOOLS.includes(p.tool)) redraw();
        return;
      }
      switch (drag.kind) {
        case "pan":
          pan = { x: drag.px + e.clientX - drag.sx, y: drag.py + e.clientY - drag.sy };
          break;
        case "move": {
          let dx = pt.x - drag.sx;
          let dy = pt.y - drag.sy;
          if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
          drag.moved = true;
          p.onPreview(replaceLayer(p.doc, { ...drag.layer, x: drag.layer.x + dx, y: drag.layer.y + dy }));
          break;
        }
        case "scale": {
          const ratio = Math.hypot(pt.x - drag.layer.x, pt.y - drag.layer.y) / drag.dist;
          p.onPreview(replaceLayer(p.doc, { ...drag.layer, scale: Math.max(0.01, drag.layer.scale * ratio) }));
          break;
        }
        case "rotate": {
          let deg = drag.layer.rotation + ((Math.atan2(pt.y - drag.layer.y, pt.x - drag.layer.x) - drag.a0) * 180) / Math.PI;
          if (e.shiftKey) deg = Math.round(deg / 15) * 15;
          p.onPreview(replaceLayer(p.doc, { ...drag.layer, rotation: Math.round(deg * 10) / 10 }));
          break;
        }
        case "crop": {
          const r = normRect(drag.sx, drag.sy, pt.x, pt.y, e.shiftKey);
          const x0 = Math.max(0, r.x);
          const y0 = Math.max(0, r.y);
          const x1 = Math.min(p.doc.width, r.x + r.w);
          const y1 = Math.min(p.doc.height, r.y + r.h);
          p.onCrop(x1 - x0 > 4 && y1 - y0 > 4 ? { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) } : null);
          break;
        }
        case "marquee":
        case "shape":
        case "gradient":
          drag.ex = pt.x;
          drag.ey = pt.y;
          if (e.shiftKey && drag.kind !== "gradient") {
            const d = Math.max(Math.abs(pt.x - drag.sx), Math.abs(pt.y - drag.sy));
            drag.ex = drag.sx + Math.sign(pt.x - drag.sx || 1) * d;
            drag.ey = drag.sy + Math.sign(pt.y - drag.sy || 1) * d;
          }
          break;
        case "lasso":
          drag.pts.push(pt);
          break;
        case "paint": {
          const events = e.getCoalescedEvents?.() ?? [e];
          const inv = drag.target.matrix.inverse();
          for (const ev of events.length ? events : [e]) {
            const d = toDoc(ev);
            const l = inv.transformPoint(new DOMPoint(d.x, d.y));
            drag.stroke.add(l.x, l.y);
          }
          live.set(drag.key, drag.stroke.result());
          redraw(true);
          return;
        }
      }
      redraw();
    };

    const onUp = (e: PointerEvent) => {
      const p = latest.current;
      const d = drag;
      drag = null;
      if (!d) return;
      switch (d.kind) {
        case "move":
          if (d.moved) p.onCommit();
          break;
        case "scale":
        case "rotate":
          p.onCommit();
          break;
        case "marquee": {
          const r = normRect(d.sx, d.sy, d.ex, d.ey);
          if (r.w < 2 || r.h < 2) {
            if (d.mode === "replace") p.onSelection(null);
          } else p.onSelection(selectShape(p.selection, p.doc.width, p.doc.height, d.mode, p.options.marquee, r, p.options.feather));
          break;
        }
        case "lasso":
          if (d.pts.length > 2) p.onSelection(selectPolygon(p.selection, p.doc.width, p.doc.height, d.mode, d.pts, p.options.feather));
          else if (d.mode === "replace") p.onSelection(null);
          break;
        case "shape": {
          const r = normRect(d.sx, d.sy, d.ex, d.ey);
          if (r.w > 3 && r.h > 3) p.onAddShape(r);
          break;
        }
        case "gradient": {
          if (Math.hypot(d.ex - d.sx, d.ey - d.sy) < 2) break;
          const t = target();
          if (!t) break;
          const base = pixels(t.src);
          if (!base) break;
          const inv = t.matrix.inverse();
          const a = inv.transformPoint(new DOMPoint(d.sx, d.sy));
          const b = inv.transformPoint(new DOMPoint(d.ex, d.ey));
          const sel = localSelection(p.selection?.canvas ?? null, t.matrix, base.width, base.height);
          const [from, to] = t.kind === "mask" ? ["#ffffff", "#000000"] : [p.fg, p.options.gradientToTransparent ? null : p.bg];
          let out: HTMLCanvasElement;
          if (t.kind === "mask") {
            // 마스크 그레이디언트: 흰색 → 투명으로 만든 알파를 그대로 마스크로
            const g = createCanvas(base.width, base.height);
            out = drawGradient(g, a, b, "#ffffff", null, p.options.gradient, 100, null);
            if (sel) out = maskThrough(base, out, sel);
          } else out = drawGradient(base, a, b, from, to, p.options.gradient, 100, sel);
          const id = putCanvas(out);
          p.onSet((d) => replaceTarget(d, t.layer.id, t.kind, id));
          break;
        }
        case "paint": {
          lastPaint = mouse;
          const result = d.stroke.result();
          live.delete(d.key);
          const id = putCanvas(result);
          p.onSet((doc) => replaceTarget(doc, d.target.layer.id, d.target.kind, id));
          break;
        }
      }
      void e;
      redraw(true);
    };

    const zoomAt = (factor: number, cx: number, cy: number) => {
      const rect = canvas.getBoundingClientRect();
      const before = toDoc({ clientX: cx, clientY: cy });
      zoom = Math.max(0.05, Math.min(64, zoom * factor));
      const { s, ox, oy } = view();
      pan.x += cx - rect.left - (ox + before.x * s);
      pan.y += cy - rect.top - (oy + before.y * s);
      status();
      redraw();
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.altKey || !e.shiftKey) zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
      else {
        pan.x -= e.deltaY;
        redraw();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.code === "Space") {
        space = e.type === "keydown";
        canvas.dataset.pan = space ? "1" : "";
      }
      alt = e.altKey;
      canvas.dataset.alt = alt ? "1" : "";
    };
    const onView = (e: Event) => {
      const cmd = (e as CustomEvent<string>).detail;
      const { doc } = latest.current;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const fit = Math.min((w - 120) / doc.width, (h - 80) / doc.height, 1);
      if (cmd === "fit") {
        zoom = Math.min((w - 120) / doc.width, (h - 80) / doc.height) / fit;
        pan = { x: 0, y: 0 };
      } else if (cmd === "actual") {
        zoom = 1 / fit;
        pan = { x: 0, y: 0 };
      } else if (cmd === "in" || cmd === "out") {
        const r = canvas.getBoundingClientRect();
        zoomAt(cmd === "in" ? 1.25 : 0.8, r.left + w / 2, r.top + h / 2);
        return;
      }
      status();
      redraw(true);
    };
    const onLeave = () => {
      mouse = null;
      redraw();
    };

    const ants = setInterval(() => {
      if (!latest.current.selection) return;
      antsOffset = (antsOffset + 1) % 8;
      redraw();
    }, 90);

    const resize = new ResizeObserver(() => redraw());
    resize.observe(canvas);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("photo-view", onView);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(ants);
      resize.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("photo-view", onView);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, []);

  useEffect(() => redrawRef.current(true), [props.doc, props.editingTextId]);
  useEffect(() => redrawRef.current());

  return <canvas ref={ref} className="photo-canvas" data-tool={props.tool} tabIndex={-1} />;
}

function rotateKnob(pts: { x: number; y: number }[]) {
  const mx = (pts[0].x + pts[1].x) / 2;
  const my = (pts[0].y + pts[1].y) / 2;
  const cx = (pts[0].x + pts[2].x) / 2;
  const cy = (pts[0].y + pts[2].y) / 2;
  const len = Math.hypot(mx - cx, my - cy) || 1;
  return { x: mx + ((mx - cx) / len) * 26, y: my + ((my - cy) / len) * 26 };
}

function normRect(x0: number, y0: number, x1: number, y1: number, square = false): CropRect {
  if (square) {
    const d = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    x1 = x0 + Math.sign(x1 - x0 || 1) * d;
    y1 = y0 + Math.sign(y1 - y0 || 1) * d;
  }
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

/** 선택 영역 안만 새 마스크로 바꾸기 */
function maskThrough(base: HTMLCanvasElement, next: HTMLCanvasElement, sel: HTMLCanvasElement) {
  const out = createCanvas(base.width, base.height);
  const g = ctx2d(out);
  g.drawImage(base, 0, 0);
  g.globalCompositeOperation = "destination-out";
  g.drawImage(sel, 0, 0);
  const n = createCanvas(base.width, base.height);
  const ng = ctx2d(n);
  ng.drawImage(next, 0, 0);
  ng.globalCompositeOperation = "destination-in";
  ng.drawImage(sel, 0, 0);
  g.globalCompositeOperation = "source-over";
  g.drawImage(n, 0, 0);
  return out;
}

/** 밖에서 화면 맞추기, 실제 크기, 확대, 축소 */
export const photoView = (cmd: "fit" | "actual" | "in" | "out") => window.dispatchEvent(new CustomEvent("photo-view", { detail: cmd }));

export { renderDoc, toLayer };
