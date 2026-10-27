import { useEffect, useRef } from "react";
import { hexToRgba, rgbaToHex, TRANSPARENT, type RGBA } from "../doc/color";
import type { PixelDoc } from "../doc/PixelDoc";
import {
  clearMasked,
  combineMask,
  cutOut,
  ellipsePoints,
  getPixel,
  linePoints,
  rectMask,
  rectPoints,
  shiftMask,
  stampRaster,
  wandMask,
  type Raster,
} from "../doc/raster";
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

type Point = [number, number];
type SelectMode = "replace" | "add" | "subtract";

type Drag =
  | { kind: "pan"; startX: number; startY: number; panX: number; panY: number }
  | { kind: "paint"; color: RGBA; last: Point; trail: Point[]; base: Uint8ClampedArray; done: Set<number> }
  | { kind: "shade"; dir: 1 | -1; last: Point; done: Set<number> }
  | { kind: "shape"; start: Point; base: Uint8ClampedArray; erase: boolean; to: Point }
  | { kind: "select"; start: Point; to: Point; mode: SelectMode }
  | { kind: "move"; start: Point; base: Uint8ClampedArray; float: Raster | null; mask: Uint8Array | null; moved: boolean };

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
    const onionPrev = document.createElement("canvas");
    const onionNext = document.createElement("canvas");
    const checker = document.createElement("canvas");

    let zoom = 16;
    let panX = 0;
    let panY = 0;
    let hover: Point | null = null;
    let drag: Drag | null = null;
    let space = false;
    let frame = 0;
    let imageVersion = -1;
    let lastPaint: Point | null = null;
    let ants = 0;

    /** 앞뒤 프레임을 색을 입혀 흐리게 */
    const paintOnion = (target: HTMLCanvasElement, f: number, tint: string) => {
      target.width = doc.width;
      target.height = doc.height;
      const g = target.getContext("2d")!;
      g.putImageData(new ImageData(doc.composite(f), doc.width, doc.height), 0, 0);
      g.globalCompositeOperation = "source-atop";
      g.fillStyle = tint;
      g.fillRect(0, 0, doc.width, doc.height);
      g.globalCompositeOperation = "source-over";
    };

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
      const o = opts.current;
      if (imageVersion !== snap.version || image.width !== doc.width || image.height !== doc.height) {
        image.width = doc.width;
        image.height = doc.height;
        imageCtx.putImageData(new ImageData(doc.composite(), doc.width, doc.height), 0, 0);
        if (o.onion) {
          if (doc.frame > 0) paintOnion(onionPrev, doc.frame - 1, "rgba(255,80,90,0.55)");
          if (doc.frame < doc.frames.length - 1) paintOnion(onionNext, doc.frame + 1, "rgba(80,160,255,0.55)");
        }
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

      // 타일 모드: 둘레 8칸에 같은 그림을 흐리게
      if (o.tile) {
        ctx.globalAlpha = 0.45;
        for (let ty = -1; ty <= 1; ty++)
          for (let tx = -1; tx <= 1; tx++) {
            if (!tx && !ty) continue;
            ctx.drawImage(image, panX + tx * dw, panY + ty * dh, dw, dh);
          }
        ctx.globalAlpha = 1;
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(panX, panY, dw, dh);
      ctx.clip();
      ctx.drawImage(checker, panX, panY, (cw / perCell) * zoom, (ch / perCell) * zoom);
      ctx.restore();
      if (o.onion) {
        ctx.globalAlpha = 0.35;
        if (doc.frame > 0) ctx.drawImage(onionPrev, panX, panY, dw, dh);
        if (doc.frame < doc.frames.length - 1) ctx.drawImage(onionNext, panX, panY, dw, dh);
        ctx.globalAlpha = 1;
      }
      ctx.drawImage(image, panX, panY, dw, dh);

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

      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = "#b39dff";
      ctx.lineWidth = 1.5;
      if (o.symmetry === "x" || o.symmetry === "both") {
        const cx = Math.round(panX + dw / 2) + 0.5;
        ctx.beginPath();
        ctx.moveTo(cx, panY - 12);
        ctx.lineTo(cx, panY + dh + 12);
        ctx.stroke();
      }
      if (o.symmetry === "y" || o.symmetry === "both") {
        const cy = Math.round(panY + dh / 2) + 0.5;
        ctx.beginPath();
        ctx.moveTo(panX - 12, cy);
        ctx.lineTo(panX + dw + 12, cy);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      ctx.strokeStyle = "#323a52";
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(panX) - 0.5, Math.round(panY) - 0.5, dw + 1, dh + 1);

      // 고른 영역: 개미 행렬
      const mask = drag?.kind === "move" && drag.mask ? drag.mask : doc.selection;
      if (mask) drawAnts(mask);
      if (drag?.kind === "select") {
        const [x0, y0] = drag.start;
        const [x1, y1] = drag.to;
        ctx.setLineDash([4, 4]);
        ctx.lineDashOffset = -ants;
        ctx.strokeStyle = "#fff";
        ctx.strokeRect(panX + Math.min(x0, x1) * zoom + 0.5, panY + Math.min(y0, y1) * zoom + 0.5, (Math.abs(x1 - x0) + 1) * zoom - 1, (Math.abs(y1 - y0) + 1) * zoom - 1);
        ctx.setLineDash([]);
      }

      // 마우스가 있는 칸 (붓 크기만큼)
      if (hover && !drag && ["pencil", "eraser", "line", "rect", "ellipse", "shade"].includes(o.tool)) {
        const size = o.tool === "rect" || o.tool === "ellipse" || o.tool === "shade" ? 1 : o.size;
        const start = -Math.floor((size - 1) / 2);
        for (const [mx, my] of symmetric([hover])) {
          const x = panX + (mx + start) * zoom;
          const y = panY + (my + start) * zoom;
          if (o.tool === "pencil" || o.tool === "line" || o.tool === "rect" || o.tool === "ellipse") {
            ctx.fillStyle = o.color + "99";
            ctx.fillRect(x, y, size * zoom, size * zoom);
          }
          ctx.strokeStyle = "#ffc83d";
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x, y, size * zoom, size * zoom);
        }
      }
    };

    /** 고른 칸의 테두리만 점선으로 */
    const drawAnts = (mask: Uint8Array) => {
      const W = doc.width;
      const H = doc.height;
      const at = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x] === 1;
      ctx.beginPath();
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          if (!at(x, y)) continue;
          const px = Math.round(panX + x * zoom) + 0.5;
          const py = Math.round(panY + y * zoom) + 0.5;
          const px2 = Math.round(panX + (x + 1) * zoom) + 0.5;
          const py2 = Math.round(panY + (y + 1) * zoom) + 0.5;
          if (!at(x, y - 1)) (ctx.moveTo(px, py), ctx.lineTo(px2, py));
          if (!at(x, y + 1)) (ctx.moveTo(px, py2), ctx.lineTo(px2, py2));
          if (!at(x - 1, y)) (ctx.moveTo(px, py), ctx.lineTo(px, py2));
          if (!at(x + 1, y)) (ctx.moveTo(px2, py), ctx.lineTo(px2, py2));
        }
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.strokeStyle = "#000";
      ctx.stroke();
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = -ants;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
      ctx.setLineDash([]);
    };

    const redraw = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    // 개미 행렬 움직이기
    const antsTimer = window.setInterval(() => {
      if (!doc.selection && drag?.kind !== "select") return;
      ants = (ants + 1) % 8;
      redraw();
    }, 120);

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

    const cellAt = (e: PointerEvent | WheelEvent): Point => {
      const rect = canvas.getBoundingClientRect();
      return [Math.floor((e.clientX - rect.left - panX) / zoom), Math.floor((e.clientY - rect.top - panY) / zoom)];
    };

    /** 대칭이 켜져 있으면 반대편 칸도 함께 */
    const symmetric = (points: Point[]): Point[] => {
      const s = opts.current.symmetry;
      const out = [...points];
      if (s === "x" || s === "both") out.push(...points.map(([x, y]) => [doc.width - 1 - x, y] as Point));
      if (s === "y" || s === "both") out.push(...out.map(([x, y]) => [x, doc.height - 1 - y] as Point));
      return out;
    };

    /** 칸 하나 칠하기: 타일 모드면 감싸고, 고른 영역 밖이나 디더링 빈칸은 건너뛴다 */
    const put = (r: Raster, x: number, y: number, c: RGBA) => {
      const o = opts.current;
      if (o.tile) {
        x = ((x % r.width) + r.width) % r.width;
        y = ((y % r.height) + r.height) % r.height;
      }
      if (x < 0 || y < 0 || x >= r.width || y >= r.height) return;
      if (doc.selection && !doc.selection[y * r.width + x]) return;
      if (o.dither && (x + y) % 2) return;
      r.data.set(c, (y * r.width + x) * 4);
    };

    const stampAt = (r: Raster, x: number, y: number, size: number, c: RGBA) => {
      const start = -Math.floor((size - 1) / 2);
      for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) put(r, x + start + dx, y + start + dy, c);
    };

    const paintPoints = (points: Point[], color: RGBA, size = opts.current.size) => {
      const raster = doc.cel;
      for (const [x, y] of symmetric(points)) stampAt(raster, x, y, size, color);
    };

    const pickAt = ([x, y]: Point) => {
      if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return;
      const data = doc.composite();
      const i = (y * doc.width + x) * 4;
      if (data[i + 3] === 0) return callbacks.current.notify("투명한 칸이라 고를 색이 없어요.");
      callbacks.current.onPickColor(rgbaToHex([data[i], data[i + 1], data[i + 2], 255]));
    };

    const cantPaint = () => {
      if (doc.activeLayer.locked) {
        callbacks.current.notify("지금 레이어가 잠겨 있어요. 타임라인에서 🔒 를 눌러 풀어 주세요.");
        return true;
      }
      if (doc.activeLayer.visible) return false;
      callbacks.current.notify("지금 레이어가 숨겨져 있어요. 타임라인에서 눈 모양을 눌러 보이게 해 주세요.");
      return true;
    };

    /** Shift 를 누르면 45도 단위 직선, 정사각형, 정원 */
    const constrain = (start: Point, to: Point, shift: boolean, tool: string): Point => {
      if (!shift) return to;
      const dx = to[0] - start[0];
      const dy = to[1] - start[1];
      if (tool === "line") {
        const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.max(Math.abs(dx), Math.abs(dy));
        return [start[0] + Math.round(Math.cos(ang) * len), start[1] + Math.round(Math.sin(ang) * len)];
      }
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      return [start[0] + Math.sign(dx || 1) * m, start[1] + Math.sign(dy || 1) * m];
    };

    /** 연필 픽셀 퍼펙트: ㄱ자로 꺾인 가운데 칸을 되돌린다 */
    const perfect = (d: Extract<Drag, { kind: "paint" }>) => {
      const t = d.trail;
      while (t.length >= 3) {
        const [a, b, c] = t.slice(-3);
        const corner = Math.abs(a[0] - c[0]) === 1 && Math.abs(a[1] - c[1]) === 1 && (b[0] === a[0] || b[1] === a[1]);
        if (!corner) break;
        // 대칭 칸까지 되돌린다
        const raster = doc.cel;
        for (const [x, y] of symmetric([b])) {
          if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) continue;
          const i = (y * raster.width + x) * 4;
          raster.data.set(d.base.subarray(i, i + 4), i);
        }
        t.splice(t.length - 2, 1);
      }
    };

    const shadeAt = (d: Extract<Drag, { kind: "shade" }>, pts: Point[]) => {
      const raster = doc.cel;
      const pal = doc.palette;
      for (const [x, y] of symmetric(pts)) {
        if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) continue;
        const key = y * raster.width + x;
        if (d.done.has(key)) continue;
        d.done.add(key);
        const p = getPixel(raster, x, y);
        if (!p[3]) continue;
        const idx = pal.indexOf(rgbaToHex(p));
        const next = pal[idx + d.dir];
        if (idx < 0 || !next) continue;
        put(raster, x, y, hexToRgba(next));
      }
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
      if (o.tool === "picker" || (e.button === 0 && e.altKey && o.tool !== "select" && o.tool !== "wand")) return pickAt(cell);

      if (o.tool === "select") {
        const mode: SelectMode = e.shiftKey ? "add" : e.altKey ? "subtract" : "replace";
        drag = { kind: "select", start: cell, to: cell, mode };
        redraw();
        return;
      }
      if (o.tool === "wand") {
        const mode: SelectMode = e.shiftKey ? "add" : e.altKey ? "subtract" : "replace";
        doc.setSelection(combineMask(doc.selection, wandMask(doc.cel, cell[0], cell[1], o.contiguous), mode));
        return;
      }
      if (cantPaint()) return;

      const erase = o.tool === "eraser" || (e.button === 2 && o.tool === "pencil");
      if (o.tool === "pencil" || o.tool === "eraser") {
        doc.begin();
        const color = erase ? TRANSPARENT : hexToRgba(o.color);
        const from: Point = e.shiftKey && lastPaint ? lastPaint : cell;
        drag = { kind: "paint", color, last: cell, trail: [cell], base: doc.cel.data.slice(), done: new Set() };
        paintPoints(linePoints(from[0], from[1], cell[0], cell[1]), color);
        lastPaint = cell;
        doc.preview();
      } else if (o.tool === "shade") {
        doc.begin();
        drag = { kind: "shade", dir: e.button === 2 ? -1 : 1, last: cell, done: new Set() };
        shadeAt(drag, [cell]);
        doc.preview();
      } else if (o.tool === "fill") {
        const color = e.button === 2 ? TRANSPARENT : hexToRgba(o.color);
        const raster = doc.cel;
        const changed = doc.change(() => {
          let any = false;
          for (const [x, y] of symmetric([cell])) {
            if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) continue;
            const region = wandMask(raster, x, y, o.contiguous);
            const before = raster.data.slice();
            region.forEach((v, i) => v && put(raster, i % raster.width, Math.floor(i / raster.width), color));
            any = any || raster.data.some((v, i) => v !== before[i]);
          }
          return any;
        });
        if (changed && e.button === 0) callbacks.current.onUsedColor(o.color);
      } else if (o.tool === "line" || o.tool === "rect" || o.tool === "ellipse") {
        doc.begin();
        drag = { kind: "shape", start: cell, base: doc.cel.data.slice(), erase: e.button === 2, to: cell };
        drawShape(cell, false);
      } else if (o.tool === "move") {
        doc.begin();
        const mask = doc.selection;
        let float: Raster | null = null;
        if (mask) {
          float = cutOut(doc.cel, mask);
          clearMasked(doc.cel, mask);
        }
        drag = { kind: "move", start: cell, base: doc.cel.data.slice(), float, mask, moved: false };
      }
    };

    const drawShape = (to: Point, shift: boolean) => {
      if (drag?.kind !== "shape") return;
      const o = opts.current;
      const raster = doc.cel;
      raster.data.set(drag.base);
      const color = drag.erase ? TRANSPARENT : hexToRgba(o.color);
      const end = constrain(drag.start, to, shift, o.tool);
      drag.to = end;
      const [x0, y0] = drag.start;
      const [x1, y1] = end;
      if (o.tool === "line") paintPoints(linePoints(x0, y0, x1, y1), color);
      else paintPoints(o.tool === "rect" ? rectPoints(x0, y0, x1, y1, o.filled) : ellipsePoints(x0, y0, x1, y1, o.filled), color, 1);
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
        const pts = linePoints(drag.last[0], drag.last[1], cell[0], cell[1]).slice(1);
        for (const p of pts) {
          paintPoints([p], drag.color);
          drag.trail.push(p);
          if (opts.current.pixelPerfect && opts.current.size === 1) perfect(drag);
        }
        drag.last = cell;
        lastPaint = cell;
        doc.preview();
      } else if (drag.kind === "shade") {
        if (cell[0] === drag.last[0] && cell[1] === drag.last[1]) return;
        shadeAt(drag, linePoints(drag.last[0], drag.last[1], cell[0], cell[1]));
        drag.last = cell;
        doc.preview();
      } else if (drag.kind === "shape") {
        drawShape(cell, e.shiftKey);
      } else if (drag.kind === "select") {
        drag.to = [Math.max(0, Math.min(doc.width - 1, cell[0])), Math.max(0, Math.min(doc.height - 1, cell[1]))];
        redraw();
      } else if (drag.kind === "move") {
        const dx = cell[0] - drag.start[0];
        const dy = cell[1] - drag.start[1];
        const data = doc.cel.data;
        if (drag.float) {
          data.set(drag.base);
          stampRaster(doc.cel, drag.float, dx, dy);
          if (drag.mask) doc.selection = shiftMask(drag.mask, doc.width, doc.height, dx, dy);
        } else {
          data.fill(0);
          const w = doc.width;
          for (let y = 0; y < doc.height; y++)
            for (let x = 0; x < w; x++) {
              let sx = x - dx;
              let sy = y - dy;
              if (opts.current.tile) {
                sx = ((sx % w) + w) % w;
                sy = ((sy % doc.height) + doc.height) % doc.height;
              }
              if (sx < 0 || sy < 0 || sx >= w || sy >= doc.height) continue;
              const from = (sy * w + sx) * 4;
              data.set(drag.base.subarray(from, from + 4), (y * w + x) * 4);
            }
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
      if (finished.kind === "select") {
        const [x0, y0] = finished.start;
        const [x1, y1] = finished.to;
        // 그냥 클릭하면 고르기 풀기
        if (x0 === x1 && y0 === y1 && finished.mode === "replace") return doc.setSelection(null);
        doc.setSelection(combineMask(doc.selection, rectMask(doc.width, doc.height, x0, y0, x1, y1), finished.mode));
        return;
      }
      if (finished.kind === "move" && !finished.moved) {
        const sel = finished.mask;
        doc.cancel();
        doc.selection = sel;
        return;
      }
      doc.commit();
      if (finished.kind === "move" && doc.selection) doc.setSelection(doc.selection);
      const usedColor = (finished.kind === "paint" && finished.color[3] > 0) || (finished.kind === "shape" && !finished.erase);
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
      clearInterval(antsTimer);
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

  // 격자, 대칭, 양파 껍질, 타일 같은 설정이 바뀌면 다시 그린다.
  useEffect(() => {
    doc.preview();
  }, [doc, options.grid, options.symmetry, options.onion, options.tile]);

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
