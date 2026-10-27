import { useEffect, useRef } from "react";
import { hexToRgba, rgbaToHex, TRANSPARENT, type RGBA } from "../doc/color";
import type { PixelDoc } from "../doc/PixelDoc";
import { ellipsePoints, floodFill, getPixel, linePoints, rectPoints, stamp } from "../doc/raster";
import { isTyping, type ToolOptions } from "./tools";

export interface CanvasController {
  /** 그림이 화면에 꽉 차게 */
  fit(): void;
  zoomBy(factor: number): void;
}

interface Props {
  doc: PixelDoc;
  options: ToolOptions;
  onPickColor: (hex: string) => void;
  /** 칠하기를 마치면 그 색을 ‘최근 쓴 색’ 에 넣는다. */
  onUsedColor: (hex: string) => void;
  onHover: (point: { x: number; y: number } | null) => void;
  onZoom: (zoom: number) => void;
  onReady: (controller: CanvasController) => void;
  notify: (message: string) => void;
}

type Drag =
  | { kind: "pan"; startX: number; startY: number; panX: number; panY: number }
  | { kind: "paint"; color: RGBA; last: [number, number]; changed: boolean }
  | { kind: "shape"; start: [number, number]; base: Uint8ClampedArray }
  | { kind: "move"; start: [number, number]; base: Uint8ClampedArray; moved: boolean };

const MIN_ZOOM = 1;
const MAX_ZOOM = 64;

/** 픽셀 그림을 크게 보여 주고, 마우스로 칠하게 하는 작업 화면 */
export function PixelCanvas({ doc, options, onPickColor, onUsedColor, onHover, onZoom, onReady, notify }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // 이벤트 처리기 안에서 늘 최신 값을 쓰려고 ref 에 담아 둔다.
  const opts = useRef(options);
  opts.current = options;
  const callbacks = useRef({ onPickColor, onUsedColor, onHover, onZoom, notify });
  callbacks.current = { onPickColor, onUsedColor, onHover, onZoom, notify };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const image = document.createElement("canvas");
    const imageCtx = image.getContext("2d")!;
    const checker = document.createElement("canvas");

    let zoom = 16;
    let panX = 0;
    let panY = 0;
    let hover: [number, number] | null = null;
    let drag: Drag | null = null;
    let space = false;
    let frame = 0;
    let imageVersion = -1;

    const draw = () => {
      frame = 0;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const snap = doc.getSnapshot();
      if (imageVersion !== snap.version || image.width !== doc.width || image.height !== doc.height) {
        image.width = doc.width;
        image.height = doc.height;
        imageCtx.putImageData(new ImageData(doc.composite(), doc.width, doc.height), 0, 0);
        imageVersion = snap.version;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const dw = doc.width * zoom;
      const dh = doc.height * zoom;
      // 투명한 곳은 바둑판 무늬로 보여 준다. 크게 보면 칸마다 네모 네 개, 작게 보면 여러 칸에 네모 하나.
      const perCell = zoom >= 16 ? 2 : zoom >= 8 ? 1 : 1 / Math.ceil(8 / zoom);
      const cw = Math.ceil(doc.width * perCell);
      const ch = Math.ceil(doc.height * perCell);
      if (checker.width !== cw || checker.height !== ch) paintChecker(checker, cw, ch);
      ctx.imageSmoothingEnabled = false;
      ctx.save();
      ctx.beginPath();
      ctx.rect(panX, panY, dw, dh);
      ctx.clip();
      ctx.drawImage(checker, panX, panY, (cw / perCell) * zoom, (ch / perCell) * zoom);
      ctx.restore();
      ctx.drawImage(image, panX, panY, dw, dh);

      const o = opts.current;
      if (o.grid && zoom >= 6) {
        ctx.beginPath();
        for (let x = 1; x < doc.width; x++) {
          ctx.moveTo(Math.round(panX + x * zoom) + 0.5, panY);
          ctx.lineTo(Math.round(panX + x * zoom) + 0.5, panY + dh);
        }
        for (let y = 1; y < doc.height; y++) {
          ctx.moveTo(panX, Math.round(panY + y * zoom) + 0.5);
          ctx.lineTo(panX + dw, Math.round(panY + y * zoom) + 0.5);
        }
        ctx.strokeStyle = "rgba(255,255,255,0.07)";
        ctx.lineWidth = 1;
        ctx.stroke();
        // 8칸마다 조금 진한 선: 자리를 세기 쉽게
        ctx.beginPath();
        for (let x = 8; x < doc.width; x += 8) {
          ctx.moveTo(Math.round(panX + x * zoom) + 0.5, panY);
          ctx.lineTo(Math.round(panX + x * zoom) + 0.5, panY + dh);
        }
        for (let y = 8; y < doc.height; y += 8) {
          ctx.moveTo(panX, Math.round(panY + y * zoom) + 0.5);
          ctx.lineTo(panX + dw, Math.round(panY + y * zoom) + 0.5);
        }
        ctx.strokeStyle = "rgba(255,255,255,0.16)";
        ctx.stroke();
      }

      if (o.mirror) {
        const cx = Math.round(panX + dw / 2) + 0.5;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.moveTo(cx, panY - 12);
        ctx.lineTo(cx, panY + dh + 12);
        ctx.strokeStyle = "#b39dff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.strokeStyle = "#323a52";
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(panX) - 0.5, Math.round(panY) - 0.5, dw + 1, dh + 1);

      // 마우스가 있는 칸 (붓 크기만큼)
      if (hover && !drag && ["pencil", "eraser", "line", "rect", "ellipse"].includes(o.tool)) {
        const size = o.tool === "rect" || o.tool === "ellipse" ? 1 : o.size;
        const start = -Math.floor((size - 1) / 2);
        const marks = [hover[0]];
        if (o.mirror) marks.push(doc.width - 1 - hover[0]);
        for (const mx of marks) {
          const x = panX + (mx + start) * zoom;
          const y = panY + (hover[1] + start) * zoom;
          if (o.tool !== "eraser") {
            ctx.fillStyle = o.color + "99";
            ctx.fillRect(x, y, size * zoom, size * zoom);
          }
          ctx.strokeStyle = "#ffc83d";
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x, y, size * zoom, size * zoom);
        }
      }
    };

    const redraw = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };

    const fit = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.floor(Math.min((w * 0.8) / doc.width, (h * 0.8) / doc.height))));
      panX = Math.round((w - doc.width * zoom) / 2);
      panY = Math.round((h - doc.height * zoom) / 2);
      callbacks.current.onZoom(zoom);
      redraw();
    };

    const zoomAt = (factor: number, sx: number, sy: number) => {
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(zoom * factor) || 1));
      if (next === zoom) return;
      // 마우스 아래 칸이 그대로 있게 확대한다.
      panX = sx - ((sx - panX) / zoom) * next;
      panY = sy - ((sy - panY) / zoom) * next;
      zoom = next;
      callbacks.current.onZoom(zoom);
      redraw();
    };

    onReady({
      fit,
      zoomBy: (factor) => zoomAt(factor, canvas.clientWidth / 2, canvas.clientHeight / 2),
    });

    const cellAt = (e: PointerEvent | WheelEvent): [number, number] => {
      const rect = canvas.getBoundingClientRect();
      return [Math.floor((e.clientX - rect.left - panX) / zoom), Math.floor((e.clientY - rect.top - panY) / zoom)];
    };

    /** 좌우 대칭이 켜져 있으면 반대편 칸도 함께 */
    const withMirror = (points: [number, number][]) =>
      opts.current.mirror ? [...points, ...points.map(([x, y]) => [doc.width - 1 - x, y] as [number, number])] : points;

    const paintLine = (from: [number, number], to: [number, number], color: RGBA) => {
      const raster = doc.activeLayer.raster;
      for (const [x, y] of withMirror(linePoints(from[0], from[1], to[0], to[1]))) stamp(raster, x, y, opts.current.size, color);
    };

    const pickAt = ([x, y]: [number, number]) => {
      if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return;
      const data = doc.composite();
      const i = (y * doc.width + x) * 4;
      if (data[i + 3] === 0) return callbacks.current.notify("투명한 칸이라 고를 색이 없어요.");
      callbacks.current.onPickColor(rgbaToHex([data[i], data[i + 1], data[i + 2], 255]));
    };

    const layerHidden = () => {
      if (doc.activeLayer.visible) return false;
      callbacks.current.notify("지금 레이어가 숨겨져 있어요. 레이어 목록에서 눈 모양을 눌러 보이게 해 주세요.");
      return true;
    };

    const onPointerDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const o = opts.current;
      if (e.button === 1 || (e.button === 0 && space)) {
        drag = { kind: "pan", startX: e.clientX, startY: e.clientY, panX, panY };
        canvas.style.cursor = "grabbing";
        return;
      }
      if (e.button !== 0 && e.button !== 2) return;
      const cell = cellAt(e);
      if (o.tool === "picker" || (e.button === 0 && e.altKey)) return pickAt(cell);
      if (layerHidden()) return;

      const erase = o.tool === "eraser" || (e.button === 2 && o.tool === "pencil");
      if (o.tool === "pencil" || o.tool === "eraser") {
        doc.begin();
        drag = { kind: "paint", color: erase ? TRANSPARENT : hexToRgba(o.color), last: cell, changed: true };
        paintLine(cell, cell, drag.color);
        doc.preview();
      } else if (o.tool === "fill") {
        const color = e.button === 2 ? TRANSPARENT : hexToRgba(o.color);
        const raster = doc.activeLayer.raster;
        const changed = doc.change(() => {
          const targets = withMirror([cell]);
          // 대칭 칸을 칠하기 전에 원래 색을 기억해 둬야 양쪽이 똑같이 칠해진다.
          const before = targets.map(([x, y]) => x >= 0 && y >= 0 && x < doc.width && y < doc.height && getPixel(raster, x, y));
          let any = false;
          targets.forEach(([x, y], i) => {
            if (before[i]) any = floodFill(raster, x, y, color) || any;
          });
          return any;
        });
        if (changed && e.button === 0) callbacks.current.onUsedColor(o.color);
      } else if (o.tool === "line" || o.tool === "rect" || o.tool === "ellipse") {
        doc.begin();
        drag = { kind: "shape", start: cell, base: doc.activeLayer.raster.data.slice() };
        drawShape(cell, e.button === 2);
      } else if (o.tool === "move") {
        doc.begin();
        drag = { kind: "move", start: cell, base: doc.activeLayer.raster.data.slice(), moved: false };
      }
    };

    let shapeErase = false;
    const drawShape = (to: [number, number], erase = shapeErase) => {
      if (drag?.kind !== "shape") return;
      shapeErase = erase;
      const o = opts.current;
      const raster = doc.activeLayer.raster;
      raster.data.set(drag.base);
      const color = erase ? TRANSPARENT : hexToRgba(o.color);
      const [x0, y0] = drag.start;
      const [x1, y1] = to;
      if (o.tool === "line") paintLine(drag.start, to, color);
      else {
        const points = o.tool === "rect" ? rectPoints(x0, y0, x1, y1, o.filled) : ellipsePoints(x0, y0, x1, y1, o.filled);
        for (const [x, y] of withMirror(points)) stamp(raster, x, y, 1, color);
      }
      doc.preview();
    };

    const onPointerMove = (e: PointerEvent) => {
      const cell = cellAt(e);
      const inside = cell[0] >= 0 && cell[1] >= 0 && cell[0] < doc.width && cell[1] < doc.height;
      const prev = hover;
      hover = inside ? cell : null;
      if (prev?.[0] !== hover?.[0] || prev?.[1] !== hover?.[1]) {
        callbacks.current.onHover(hover && { x: hover[0], y: hover[1] });
        redraw();
      }
      if (!drag) return;
      if (drag.kind === "pan") {
        panX = drag.panX + e.clientX - drag.startX;
        panY = drag.panY + e.clientY - drag.startY;
        redraw();
      } else if (drag.kind === "paint") {
        if (cell[0] === drag.last[0] && cell[1] === drag.last[1]) return;
        paintLine(drag.last, cell, drag.color);
        drag.last = cell;
        doc.preview();
      } else if (drag.kind === "shape") {
        drawShape(cell);
      } else if (drag.kind === "move") {
        const dx = cell[0] - drag.start[0];
        const dy = cell[1] - drag.start[1];
        const data = doc.activeLayer.raster.data;
        data.fill(0);
        const w = doc.width;
        for (let y = 0; y < doc.height; y++)
          for (let x = 0; x < w; x++) {
            const sx = x - dx;
            const sy = y - dy;
            if (sx < 0 || sy < 0 || sx >= w || sy >= doc.height) continue;
            const from = (sy * w + sx) * 4;
            data.set(drag.base.subarray(from, from + 4), (y * w + x) * 4);
          }
        drag.moved = dx !== 0 || dy !== 0;
        doc.preview();
      }
    };

    const onPointerUp = () => {
      if (!drag) return;
      const finished = drag;
      drag = null;
      canvas.style.cursor = "";
      if (finished.kind === "pan") return;
      if (finished.kind === "move" && !finished.moved) return doc.cancel();
      doc.commit();
      const usedColor =
        (finished.kind === "paint" && finished.color[3] > 0) || (finished.kind === "shape" && !shapeErase);
      if (usedColor) callbacks.current.onUsedColor(opts.current.color);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.25 : 0.8, e.clientX - rect.left, e.clientY - rect.top);
    };

    const onLeave = () => {
      hover = null;
      callbacks.current.onHover(null);
      redraw();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || isTyping(e.target)) return;
      space = e.type === "keydown";
      canvas.style.cursor = space ? "grab" : "";
      if (space) e.preventDefault();
    };

    const resize = new ResizeObserver(() => redraw());
    resize.observe(canvas);
    const unsubscribe = doc.subscribe(redraw);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    requestAnimationFrame(fit);

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      unsubscribe();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, [doc, onReady]);

  // 격자, 대칭, 색 같은 설정이 바뀌면 다시 그린다.
  useEffect(() => {
    doc.preview();
  }, [doc, options.grid, options.mirror]);

  return <canvas ref={canvasRef} className="pixel-canvas" data-tool={options.tool} />;
}

function paintChecker(canvas: HTMLCanvasElement, width: number, height: number) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#5b6179";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#4a4f66";
  for (let y = 0; y < height; y++) for (let x = (y % 2); x < width; x += 2) ctx.fillRect(x, y, 1, 1);
}
