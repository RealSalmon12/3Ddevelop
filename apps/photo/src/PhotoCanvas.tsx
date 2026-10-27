import { useEffect, useRef } from "react";
import { hitLayer, layerSize, renderDoc, type Layer, type PhotoDoc } from "./doc";

export type ToolId = "move" | "text" | "crop";

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  doc: PhotoDoc;
  tool: ToolId;
  selectedId: number | null;
  crop: CropRect | null;
  onSelect: (id: number | null) => void;
  /** 끄는 동안 바뀐 레이어 (기록 없이) */
  onDrag: (layer: Layer) => void;
  onDragEnd: () => void;
  onAddText: (x: number, y: number) => void;
  onCrop: (rect: CropRect | null) => void;
}

const HANDLE = 9;

/** 그림을 화면 가운데에 맞춰 보여 주고, 레이어를 끌어 옮기거나 키우게 한다. */
export function PhotoCanvas(props: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const redrawRef = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    let frame = 0;
    let space = false;
    let pan = { x: 0, y: 0 };
    let zoom = 1;
    type Drag =
      | { kind: "move"; layer: Layer; sx: number; sy: number }
      | { kind: "scale"; layer: Layer; dist: number }
      | { kind: "crop"; sx: number; sy: number }
      | { kind: "pan"; sx: number; sy: number; px: number; py: number };
    let drag: Drag | null = null;

    /** 그림을 화면에 맞추는 배율과 위치 */
    const view = () => {
      const { doc } = latest.current;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const fit = Math.min((w - 80) / doc.width, (h - 100) / doc.height);
      const s = fit * zoom;
      return { s, ox: (w - doc.width * s) / 2 + pan.x, oy: (h - doc.height * s) / 2 + pan.y + 14 };
    };

    const toDoc = (e: { clientX: number; clientY: number }) => {
      const rect = canvas.getBoundingClientRect();
      const { s, ox, oy } = view();
      return { x: (e.clientX - rect.left - ox) / s, y: (e.clientY - rect.top - oy) / s };
    };

    const corners = (layer: Layer) => {
      const { w, h } = layerSize(layer);
      const r = (layer.rotation * Math.PI) / 180;
      return [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([cx, cy]) => {
        const lx = (cx * w * layer.scale) / 2;
        const ly = (cy * h * layer.scale) / 2;
        return { x: layer.x + lx * Math.cos(r) - ly * Math.sin(r), y: layer.y + lx * Math.sin(r) + ly * Math.cos(r) };
      });
    };

    const draw = () => {
      frame = 0;
      const { doc, selectedId, crop, tool } = latest.current;
      const dpr = window.devicePixelRatio || 1;
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      if (canvas.width !== Math.round(cw * dpr)) canvas.width = Math.round(cw * dpr);
      if (canvas.height !== Math.round(ch * dpr)) canvas.height = Math.round(ch * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      const { s, ox, oy } = view();
      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(s, s);
      // 투명 배경은 바둑판
      if (!doc.background) {
        const cell = 12 / s;
        ctx.fillStyle = "#cfd3dd";
        ctx.fillRect(0, 0, doc.width, doc.height);
        ctx.fillStyle = "#eef0f5";
        for (let y = 0; y < doc.height; y += cell)
          for (let x = ((y / cell) % 2) * cell; x < doc.width; x += cell * 2)
            ctx.fillRect(x, y, Math.min(cell, doc.width - x), Math.min(cell, doc.height - y));
      }
      ctx.beginPath();
      ctx.rect(0, 0, doc.width, doc.height);
      ctx.save();
      ctx.clip();
      renderDoc(ctx, doc, redraw);
      ctx.restore();
      ctx.restore();

      // 그림 밖으로 나간 부분은 흐리게 보여 준다 (레이어를 옮길 때 감 잡기 좋게)
      const selected = doc.layers.find((l) => l.id === selectedId);
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1;
      ctx.strokeRect(ox - 0.5, oy - 0.5, doc.width * s + 1, doc.height * s + 1);

      if (selected && tool !== "crop") {
        const pts = corners(selected).map((p) => ({ x: ox + p.x * s, y: oy + p.y * s }));
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
        ctx.strokeStyle = "#ffc83d";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        for (const p of pts) {
          ctx.fillStyle = "#ffc83d";
          ctx.fillRect(p.x - HANDLE / 2, p.y - HANDLE / 2, HANDLE, HANDLE);
        }
      }

      if (tool === "crop" && crop) {
        const x = ox + crop.x * s;
        const y = oy + crop.y * s;
        const w = crop.w * s;
        const h = crop.h * s;
        ctx.fillStyle = "rgba(8,10,18,0.55)";
        ctx.beginPath();
        ctx.rect(ox, oy, doc.width * s, doc.height * s);
        ctx.rect(x, y, w, h);
        ctx.fill("evenodd");
        ctx.strokeStyle = "#ffc83d";
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);
        ctx.strokeStyle = "rgba(255,200,61,0.4)";
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
    };
    const redraw = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    redrawRef.current = redraw;

    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const p = latest.current;
      if (e.button === 1 || space || e.button === 2) {
        drag = { kind: "pan", sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
        return;
      }
      const pt = toDoc(e);
      if (p.tool === "crop") {
        drag = { kind: "crop", sx: pt.x, sy: pt.y };
        return;
      }
      if (p.tool === "text") {
        p.onAddText(pt.x, pt.y);
        return;
      }
      const selected = p.doc.layers.find((l) => l.id === p.selectedId);
      if (selected) {
        const { s } = view();
        const near = corners(selected).some((c) => Math.hypot(c.x - pt.x, c.y - pt.y) * s < HANDLE + 4);
        if (near) {
          drag = { kind: "scale", layer: selected, dist: Math.hypot(pt.x - selected.x, pt.y - selected.y) || 1 };
          return;
        }
      }
      const hit = [...p.doc.layers].reverse().find((l) => l.visible && hitLayer(l, pt.x, pt.y));
      p.onSelect(hit?.id ?? null);
      if (hit) drag = { kind: "move", layer: hit, sx: pt.x, sy: pt.y };
    };

    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const p = latest.current;
      if (drag.kind === "pan") {
        pan = { x: drag.px + e.clientX - drag.sx, y: drag.py + e.clientY - drag.sy };
        return redraw();
      }
      const pt = toDoc(e);
      if (drag.kind === "move") {
        p.onDrag({ ...drag.layer, x: drag.layer.x + pt.x - drag.sx, y: drag.layer.y + pt.y - drag.sy });
      } else if (drag.kind === "scale") {
        const ratio = Math.hypot(pt.x - drag.layer.x, pt.y - drag.layer.y) / drag.dist;
        p.onDrag({ ...drag.layer, scale: Math.max(0.02, drag.layer.scale * ratio) });
      } else if (drag.kind === "crop") {
        const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
        const x0 = clamp(Math.min(drag.sx, pt.x), p.doc.width);
        const y0 = clamp(Math.min(drag.sy, pt.y), p.doc.height);
        const x1 = clamp(Math.max(drag.sx, pt.x), p.doc.width);
        const y1 = clamp(Math.max(drag.sy, pt.y), p.doc.height);
        p.onCrop(x1 - x0 > 4 && y1 - y0 > 4 ? { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) } : null);
      }
    };

    const onUp = () => {
      if (drag && (drag.kind === "move" || drag.kind === "scale")) latest.current.onDragEnd();
      drag = null;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom = Math.max(0.2, Math.min(8, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      redraw();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      space = e.type === "keydown";
    };
    const onFit = () => {
      zoom = 1;
      pan = { x: 0, y: 0 };
      redraw();
    };

    const resize = new ResizeObserver(redraw);
    resize.observe(canvas);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("photo-fit", onFit);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("photo-fit", onFit);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, []);

  useEffect(() => redrawRef.current());

  return <canvas ref={ref} className="photo-canvas" data-tool={props.tool} />;
}

/** 화면 맞추기 (밖에서 부른다) */
export const fitPhotoView = () => document.querySelector(".photo-canvas")?.dispatchEvent(new Event("photo-fit"));
