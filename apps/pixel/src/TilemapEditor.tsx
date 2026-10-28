import { useEffect, useMemo, useRef, useState } from "react";
import type { PixelDoc } from "./doc/PixelDoc";
import {
  cloneMap,
  drawTile,
  flipsOf,
  floodCells,
  makeGid,
  newTilemap,
  renderMap,
  resizeMap,
  tileId,
  tilesetGrid,
  toCsv,
  toTiledJson,
  type Tilemap,
} from "./doc/tilemap";

type Tool = "brush" | "erase" | "fill" | "rect" | "pick";

const TOOLS: { id: Tool; icon: string; label: string; key: string }[] = [
  { id: "brush", icon: "✏", label: "타일 찍기", key: "B" },
  { id: "erase", icon: "◻", label: "지우개", key: "E" },
  { id: "fill", icon: "🪣", label: "채우기", key: "G" },
  { id: "rect", icon: "▭", label: "네모 채우기", key: "U" },
  { id: "pick", icon: "💧", label: "타일 집기 (Alt+클릭)", key: "I" },
];
const TILE_SIZES = [8, 12, 16, 24, 32, 48, 64];

interface Props {
  doc: PixelDoc;
  name: string;
  onClose: () => void;
  notify: (m: string) => void;
}

/** 타일셋에서 고른 네모 (타일 칸 좌표, 끝 포함) */
interface Pick {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function savePng(c: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => c.toBlob(async (b) => (b ? resolve(new Uint8Array(await b.arrayBuffer())) : reject(new Error("PNG 실패"))), "image/png"));
}

/** 타일맵 편집기 (에이스프라이트 타일맵 + Tiled): 지금 그림을 타일셋으로 잘라 큰 맵을 칠한다 */
export function TilemapEditor({ doc, name, onClose, notify }: Props) {
  const [map, setMapRaw] = useState<Tilemap>(() => (doc.tilemap ? cloneMap(doc.tilemap) : newTilemap(Math.min(16, doc.width), Math.min(16, doc.height), 24, 14, doc.frame)));
  const undo = useRef<Tilemap[]>([]);
  const redo = useRef<Tilemap[]>([]);
  const dirty = useRef(false);
  const [tool, setTool] = useState<Tool>("brush");
  const [layer, setLayer] = useState(0);
  const [pick, setPick] = useState<Pick>({ x0: 0, y0: 0, x1: 0, y1: 0 });
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [random, setRandom] = useState(false);
  const [grid, setGrid] = useState(true);
  const [scale, setScale] = useState(2);
  const view = useRef({ zoom: 3, panX: 20, panY: 20 });
  const mapCanvas = useRef<HTMLCanvasElement>(null);
  const setCanvas = useRef<HTMLCanvasElement>(null);
  const hover = useRef<{ x: number; y: number } | null>(null);
  const drag = useRef<{ kind: "paint"; erase: boolean } | { kind: "rect"; x: number; y: number; erase: boolean } | { kind: "pan"; sx: number; sy: number; px: number; py: number } | { kind: "pickset"; x: number; y: number } | null>(null);
  const space = useRef(false);
  /** 끄는 동안 다시 그리기 전에도 최신 맵을 쓰도록 */
  const mapRef = useRef(map);
  mapRef.current = map;

  /** 고치기 전 모습을 남기고 바꾼다 */
  const setMap = (next: Tilemap, record = true) => {
    if (record) {
      undo.current.push(mapRef.current);
      if (undo.current.length > 100) undo.current.shift();
      redo.current = [];
    }
    dirty.current = true;
    mapRef.current = next;
    setMapRaw(next);
  };

  // 타일셋: 고른 프레임의 보이는 레이어를 합친 그림
  const tileset = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = doc.width;
    c.height = doc.height;
    c.getContext("2d")!.putImageData(new ImageData(doc.composite(Math.min(map.frame, doc.frames.length - 1)), doc.width, doc.height), 0, 0);
    return c;
  }, [doc, map.frame]);
  const ts = tilesetGrid(doc.width, doc.height, map.tileW, map.tileH);
  const L = map.layers[Math.min(layer, map.layers.length - 1)];

  /** 찍을 무늬 (뒤집기 반영) */
  const stamp = useMemo(() => {
    const w = pick.x1 - pick.x0 + 1;
    const h = pick.y1 - pick.y0 + 1;
    const rows: number[][] = [];
    for (let y = 0; y < h; y++) {
      const row: number[] = [];
      for (let x = 0; x < w; x++) {
        const sx = flipH ? pick.x1 - x : pick.x0 + x;
        const sy = flipV ? pick.y1 - y : pick.y0 + y;
        row.push(makeGid(sy * ts.cols + sx + 1, flipH, flipV));
      }
      rows.push(row);
    }
    return rows;
  }, [pick, flipH, flipV, ts.cols]);
  const stampAt = (ox: number, oy: number, x: number, y: number) => {
    if (random) {
      const all = stamp.flat();
      return all[Math.floor(Math.random() * all.length)];
    }
    const h = stamp.length;
    const w = stamp[0].length;
    return stamp[(((y - oy) % h) + h) % h][(((x - ox) % w) + w) % w];
  };

  const editCells = (fn: (cells: number[]) => boolean, record: boolean) => {
    const cur = mapRef.current;
    const li = Math.min(layer, cur.layers.length - 1);
    const cells = cur.layers[li].cells.slice();
    if (!fn(cells)) return;
    setMap({ ...cur, layers: cur.layers.map((l, i) => (i === li ? { ...l, cells } : l)) }, record);
  };

  // ---------- 그리기 ----------
  useEffect(() => {
    const c = mapCanvas.current;
    if (!c) return;
    const parent = c.parentElement!;
    let raf = 0;
    const draw = () => {
      raf = 0;
      const dpr = window.devicePixelRatio || 1;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (c.width !== w * dpr || c.height !== h * dpr) {
        c.width = w * dpr;
        c.height = h * dpr;
        c.style.width = `${w}px`;
        c.style.height = `${h}px`;
      }
      const g = c.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, w, h);
      const { zoom, panX, panY } = view.current;
      const tw = map.tileW * zoom;
      const th = map.tileH * zoom;
      g.fillStyle = "#1a1d26";
      g.fillRect(panX, panY, map.cols * tw, map.rows * th);
      for (const l of map.layers) {
        if (!l.visible) continue;
        g.globalAlpha = l === L ? 1 : 0.85;
        for (let i = 0; i < l.cells.length; i++) {
          const gid = l.cells[i];
          if (!gid) continue;
          const x = i % map.cols;
          const y = (i - x) / map.cols;
          drawTile(g, tileset, ts.cols, map, gid, panX + x * tw, panY + y * th, tw, th);
        }
      }
      g.globalAlpha = 1;
      if (grid) {
        g.strokeStyle = "rgba(255,255,255,0.09)";
        g.lineWidth = 1;
        g.beginPath();
        for (let x = 0; x <= map.cols; x++) {
          g.moveTo(Math.round(panX + x * tw) + 0.5, panY);
          g.lineTo(Math.round(panX + x * tw) + 0.5, panY + map.rows * th);
        }
        for (let y = 0; y <= map.rows; y++) {
          g.moveTo(panX, Math.round(panY + y * th) + 0.5);
          g.lineTo(panX + map.cols * tw, Math.round(panY + y * th) + 0.5);
        }
        g.stroke();
      }
      g.strokeStyle = "#4fb3ff";
      g.strokeRect(panX - 0.5, panY - 0.5, map.cols * tw + 1, map.rows * th + 1);
      // 찍을 자리 미리 보기
      const hv = hover.current;
      const d = drag.current;
      if (hv) {
        let x0 = hv.x;
        let y0 = hv.y;
        let w2 = tool === "brush" && !random ? stamp[0].length : 1;
        let h2 = tool === "brush" && !random ? stamp.length : 1;
        if (d?.kind === "rect") {
          x0 = Math.min(d.x, hv.x);
          y0 = Math.min(d.y, hv.y);
          w2 = Math.abs(hv.x - d.x) + 1;
          h2 = Math.abs(hv.y - d.y) + 1;
        }
        if (tool === "brush" && !random && !d) {
          g.globalAlpha = 0.6;
          stamp.forEach((row, sy) => row.forEach((gid, sx) => drawTile(g, tileset, ts.cols, map, gid, panX + (hv.x + sx) * tw, panY + (hv.y + sy) * th, tw, th)));
          g.globalAlpha = 1;
        }
        g.strokeStyle = tool === "erase" || (d && "erase" in d && d.erase) ? "#ff6b6b" : "#ffc83d";
        g.lineWidth = 2;
        g.strokeRect(panX + x0 * tw, panY + y0 * th, w2 * tw, h2 * th);
      }
    };
    const request = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    request();
    const ro = new ResizeObserver(request);
    ro.observe(parent);
    (c as HTMLCanvasElement & { request?: () => void }).request = request;
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  });
  const redraw = () => (mapCanvas.current as (HTMLCanvasElement & { request?: () => void }) | null)?.request?.();

  // 타일셋 그림
  const setZoom = Math.max(1, Math.min(8, Math.floor(260 / Math.max(1, doc.width))));
  useEffect(() => {
    const c = setCanvas.current;
    if (!c) return;
    c.width = doc.width * setZoom;
    c.height = doc.height * setZoom;
    const g = c.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(tileset, 0, 0, c.width, c.height);
    g.strokeStyle = "rgba(255,255,255,0.18)";
    g.beginPath();
    for (let x = 0; x <= ts.cols; x++) {
      g.moveTo(x * map.tileW * setZoom + 0.5, 0);
      g.lineTo(x * map.tileW * setZoom + 0.5, ts.rows * map.tileH * setZoom);
    }
    for (let y = 0; y <= ts.rows; y++) {
      g.moveTo(0, y * map.tileH * setZoom + 0.5);
      g.lineTo(ts.cols * map.tileW * setZoom, y * map.tileH * setZoom + 0.5);
    }
    g.stroke();
    g.strokeStyle = "#ffc83d";
    g.lineWidth = 2;
    g.strokeRect(pick.x0 * map.tileW * setZoom + 1, pick.y0 * map.tileH * setZoom + 1, (pick.x1 - pick.x0 + 1) * map.tileW * setZoom - 2, (pick.y1 - pick.y0 + 1) * map.tileH * setZoom - 2);
  }, [tileset, doc.width, doc.height, setZoom, ts.cols, ts.rows, map.tileW, map.tileH, pick]);

  // ---------- 마우스 ----------
  const cellOf = (e: { clientX: number; clientY: number }) => {
    const r = mapCanvas.current!.getBoundingClientRect();
    const { zoom, panX, panY } = view.current;
    return { x: Math.floor((e.clientX - r.left - panX) / (map.tileW * zoom)), y: Math.floor((e.clientY - r.top - panY) / (map.tileH * zoom)) };
  };
  const inside = (p: { x: number; y: number }) => p.x >= 0 && p.y >= 0 && p.x < map.cols && p.y < map.rows;

  const paintAt = (p: { x: number; y: number }, erase: boolean, record: boolean) => {
    editCells((cells) => {
      let changed = false;
      const put = (x: number, y: number, v: number) => {
        if (x < 0 || y < 0 || x >= map.cols || y >= map.rows) return;
        const i = y * map.cols + x;
        if (cells[i] !== v) {
          cells[i] = v;
          changed = true;
        }
      };
      if (erase) put(p.x, p.y, 0);
      else if (random) put(p.x, p.y, stampAt(p.x, p.y, p.x, p.y));
      else stamp.forEach((row, sy) => row.forEach((gid, sx) => put(p.x + sx, p.y + sy, gid)));
      return changed;
    }, record);
  };

  const onDown = (e: React.PointerEvent) => {
    const c = mapCanvas.current!;
    c.setPointerCapture(e.pointerId);
    if (e.button === 1 || space.current) {
      drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, px: view.current.panX, py: view.current.panY };
      return;
    }
    const p = cellOf(e);
    if (!inside(p)) return;
    const erase = tool === "erase" || e.button === 2;
    if (tool === "pick" || e.altKey) {
      const gid = L.cells[p.y * map.cols + p.x];
      const id = tileId(gid);
      if (!id) return notify("빈칸이에요.");
      const t = id - 1;
      const f = flipsOf(gid);
      setPick({ x0: t % ts.cols, y0: Math.floor(t / ts.cols), x1: t % ts.cols, y1: Math.floor(t / ts.cols) });
      setFlipH(f.h);
      setFlipV(f.v);
      if (tool === "pick") setTool("brush");
      return;
    }
    if (tool === "fill") {
      editCells((cells) => {
        const region = floodCells(cells, map.cols, map.rows, p.x, p.y);
        let changed = false;
        for (const i of region) {
          const x = i % map.cols;
          const v = erase ? 0 : stampAt(p.x, p.y, x, (i - x) / map.cols);
          if (cells[i] !== v) {
            cells[i] = v;
            changed = true;
          }
        }
        return changed;
      }, true);
      return;
    }
    if (tool === "rect") {
      drag.current = { kind: "rect", x: p.x, y: p.y, erase };
      redraw();
      return;
    }
    // 붓: 첫 칸에서 기록을 남기고, 끄는 동안은 같은 기록에 이어서
    undo.current.push(mapRef.current);
    redo.current = [];
    drag.current = { kind: "paint", erase };
    paintAt(p, erase, false);
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d?.kind === "pan") {
      view.current.panX = d.px + e.clientX - d.sx;
      view.current.panY = d.py + e.clientY - d.sy;
      redraw();
      return;
    }
    const p = cellOf(e);
    const prev = hover.current;
    hover.current = inside(p) ? p : null;
    if (d?.kind === "paint" && inside(p) && (!prev || prev.x !== p.x || prev.y !== p.y)) paintAt(p, d.erase, false);
    if (!prev || !hover.current || prev.x !== p.x || prev.y !== p.y) redraw();
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === "rect" && hover.current) {
      const hv = hover.current;
      const x0 = Math.min(d.x, hv.x);
      const y0 = Math.min(d.y, hv.y);
      const x1 = Math.max(d.x, hv.x);
      const y1 = Math.max(d.y, hv.y);
      editCells((cells) => {
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells[y * map.cols + x] = d.erase ? 0 : stampAt(x0, y0, x, y);
        return true;
      }, true);
    }
    if (d?.kind === "paint" && undo.current[undo.current.length - 1] === mapRef.current) undo.current.pop();
    redraw();
  };

  const onWheel = (e: React.WheelEvent) => {
    const r = mapCanvas.current!.getBoundingClientRect();
    const v = view.current;
    const old = v.zoom;
    const next = Math.max(0.25, Math.min(16, old * (e.deltaY < 0 ? 1.25 : 0.8)));
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    v.panX = mx - ((mx - v.panX) * next) / old;
    v.panY = my - ((my - v.panY) * next) / old;
    v.zoom = next;
    redraw();
  };

  const fitView = () => {
    const c = mapCanvas.current?.parentElement;
    if (!c) return;
    const z = Math.max(0.25, Math.min(16, Math.min((c.clientWidth - 40) / (map.cols * map.tileW), (c.clientHeight - 40) / (map.rows * map.tileH))));
    view.current = { zoom: z, panX: (c.clientWidth - map.cols * map.tileW * z) / 2, panY: (c.clientHeight - map.rows * map.tileH * z) / 2 };
    redraw();
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => fitView(), [map.cols, map.rows, map.tileW, map.tileH]);

  // 타일셋에서 고르기 (끌면 여러 칸 무늬)
  const setCell = (e: React.PointerEvent) => {
    const r = setCanvas.current!.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / (map.tileW * setZoom));
    const y = Math.floor((e.clientY - r.top) / (map.tileH * setZoom));
    return { x: Math.max(0, Math.min(ts.cols - 1, x)), y: Math.max(0, Math.min(ts.rows - 1, y)) };
  };

  // ---------- 단축키 ----------
  const doUndo = () => {
    const prev = undo.current.pop();
    if (!prev) return;
    redo.current.push(mapRef.current);
    mapRef.current = prev;
    dirty.current = true;
    setMapRaw(prev);
  };
  const doRedo = () => {
    const next = redo.current.pop();
    if (!next) return;
    undo.current.push(mapRef.current);
    mapRef.current = next;
    dirty.current = true;
    setMapRaw(next);
  };
  const finish = (apply: boolean) => {
    if (apply && dirty.current) {
      doc.setTilemap(map);
      notify("타일맵을 그림 파일에 저장했어요. 파일을 저장하면 함께 남아요.");
    }
    onClose();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const k = e.key.toLowerCase();
      e.stopPropagation();
      if (e.key === " ") {
        space.current = e.type === "keydown";
        e.preventDefault();
        return;
      }
      if (e.type !== "keydown") return;
      if ((e.ctrlKey || e.metaKey) && k === "z") return e.shiftKey ? doRedo() : doUndo();
      if ((e.ctrlKey || e.metaKey) && k === "y") return doRedo();
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (k === "escape") return finish(true);
      const t = TOOLS.find((x) => x.key.toLowerCase() === k);
      if (t) return setTool(t.id);
      if (k === "x") return setFlipH((v) => !v);
      if (k === "y") return setFlipV((v) => !v);
      if (k === "r") return setRandom((v) => !v);
      if (k === "h") return setGrid((v) => !v);
      if (k === "0") return fitView();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
    };
  });

  // ---------- 설정 ----------
  const used = map.layers.some((l) => l.cells.some((v) => v));
  const setTileSize = (w: number, h: number) => {
    if (used && !window.confirm("타일 크기를 바꾸면 맵의 타일 번호가 어긋나요. 맵을 비우고 바꿀까요?")) return;
    setMap(newTilemap(w, h, map.cols, map.rows, map.frame));
    setPick({ x0: 0, y0: 0, x1: 0, y1: 0 });
    setLayer(0);
  };

  // ---------- 내보내기 ----------
  const exportPng = async () => {
    const r = await window.suite?.files.save({ defaultName: `${name}-맵.png`, filters: [{ name: "PNG", extensions: ["png"] }], data: await savePng(renderMap(map, tileset, scale)) });
    if (r?.ok) notify(`맵을 PNG 로 저장했어요 (${map.cols * map.tileW * scale}×${map.rows * map.tileH * scale}).`);
  };
  const exportTiled = async () => {
    if (!window.suite) return;
    const r = await window.suite.files.save({ defaultName: `${name}.tmj`, filters: [{ name: "Tiled 맵 (JSON)", extensions: ["tmj", "json"] }], data: "{}" });
    if (!r.ok) return;
    const base = r.path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");
    const image = `${base}-tiles.png`;
    const dir = r.path.slice(0, r.path.length - r.path.split(/[\\/]/).pop()!.length);
    // 타일셋은 타일 칸에 딱 맞게 자른다
    const tc = document.createElement("canvas");
    tc.width = ts.cols * map.tileW;
    tc.height = ts.rows * map.tileH;
    tc.getContext("2d")!.drawImage(tileset, 0, 0);
    await window.suite.files.save({ path: r.path, defaultName: "", filters: [], data: toTiledJson(map, { width: tc.width, height: tc.height, image, name: base }) });
    const p = await window.suite.files.save({ path: `${dir}${image}`, defaultName: image, filters: [], data: await savePng(tc) });
    notify(p.ok ? `Tiled 맵과 타일셋(${image})을 같은 폴더에 저장했어요. Tiled, Godot, Unity(SuperTiled2Unity) 에서 열 수 있어요.` : "타일셋 그림을 저장하지 못했어요.");
  };
  const exportCsv = async () => {
    const r = await window.suite?.files.save({ defaultName: `${name}-${L.name}.csv`, filters: [{ name: "CSV", extensions: ["csv"] }], data: toCsv(map, map.layers.indexOf(L)) });
    if (r?.ok) notify("칸 번호를 CSV 로 저장했어요 (0 은 빈칸, 1 부터 타일 번호).");
  };

  const pickW = pick.x1 - pick.x0 + 1;
  const pickH = pick.y1 - pick.y0 + 1;
  const firstTile = pick.y0 * ts.cols + pick.x0;

  return (
    <div className="tilemap-editor" role="dialog" aria-label="타일맵">
      <aside className="tm-side">
        <div className="tm-title">
          <b>타일맵</b>
          <span>지금 그림을 타일셋으로</span>
        </div>
        <div className="tm-row">
          <span>타일 크기</span>
          <select value={map.tileW} onChange={(e) => setTileSize(Number(e.target.value), Number(e.target.value))}>
            {TILE_SIZES.filter((s) => s <= Math.max(doc.width, doc.height)).map((s) => (
              <option key={s} value={s}>
                {s}×{s}
              </option>
            ))}
          </select>
        </div>
        {doc.frames.length > 1 && (
          <div className="tm-row">
            <span>타일셋 프레임</span>
            <select value={map.frame} onChange={(e) => setMap({ ...map, frame: Number(e.target.value) })}>
              {doc.frames.map((_, i) => (
                <option key={i} value={i}>
                  {i + 1}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="tm-tileset-wrap">
          {ts.count === 0 ? (
            <p className="tm-note">그림이 타일보다 작아요. 타일 크기를 줄이거나 그림을 키워 주세요.</p>
          ) : (
            <canvas
              ref={setCanvas}
              className="tm-tileset"
              onPointerDown={(e) => {
                (e.target as Element).setPointerCapture(e.pointerId);
                const p = setCell(e);
                drag.current = { kind: "pickset", x: p.x, y: p.y };
                setPick({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
                if (tool === "erase" || tool === "pick") setTool("brush");
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (d?.kind !== "pickset") return;
                const p = setCell(e);
                setPick({ x0: Math.min(d.x, p.x), y0: Math.min(d.y, p.y), x1: Math.max(d.x, p.x), y1: Math.max(d.y, p.y) });
              }}
              onPointerUp={() => (drag.current = null)}
            />
          )}
        </div>
        <p className="tm-note">
          {pickW * pickH > 1 ? `무늬 ${pickW}×${pickH} (타일 #${firstTile + 1}부터)` : `타일 #${firstTile + 1}`} · 타일셋 {ts.cols}×{ts.rows} = {ts.count}개. 끌어서 여러 칸을 고르면 무늬로 찍혀요.
        </p>
        <div className="tm-tools">
          {TOOLS.map((t) => (
            <button key={t.id} aria-pressed={tool === t.id} title={`${t.label} (${t.key})`} onClick={() => setTool(t.id)}>
              {t.icon}
            </button>
          ))}
          <button aria-pressed={flipH} title="좌우 뒤집어 찍기 (X)" onClick={() => setFlipH((v) => !v)}>
            ⇋
          </button>
          <button aria-pressed={flipV} title="위아래 뒤집어 찍기 (Y)" onClick={() => setFlipV((v) => !v)}>
            ⇵
          </button>
          <button aria-pressed={random} title="무작위: 고른 타일 중 하나를 골라 찍어요 (풀밭, 돌길 변화) (R)" onClick={() => setRandom((v) => !v)}>
            🎲
          </button>
          <button aria-pressed={grid} title="격자 (H)" onClick={() => setGrid((v) => !v)}>
            #
          </button>
        </div>
        <div className="tm-head">
          <b>레이어</b>
          <button
            title="레이어 더하기 (나무, 장식처럼 바닥 위에)"
            disabled={map.layers.length >= 16}
            onClick={() => {
              setMap({ ...map, layers: [...map.layers, { name: `레이어 ${map.layers.length + 1}`, visible: true, cells: new Array(map.cols * map.rows).fill(0) }] });
              setLayer(map.layers.length);
            }}
          >
            ＋
          </button>
          <button
            title="고른 레이어 지우기"
            disabled={map.layers.length <= 1}
            onClick={() => {
              setMap({ ...map, layers: map.layers.filter((l) => l !== L) });
              setLayer(Math.max(0, layer - 1));
            }}
          >
            ✕
          </button>
        </div>
        <ul className="tm-layers">
          {[...map.layers].reverse().map((l) => {
            const i = map.layers.indexOf(l);
            return (
              <li key={i} className={l === L ? "on" : ""}>
                <button title="보이기/숨기기" onClick={() => setMap({ ...map, layers: map.layers.map((x) => (x === l ? { ...x, visible: !x.visible } : x)) }, false)}>
                  {l.visible ? "👁" : "—"}
                </button>
                <span
                  onClick={() => setLayer(i)}
                  onDoubleClick={() => {
                    const n = window.prompt("레이어 이름", l.name);
                    if (n?.trim()) setMap({ ...map, layers: map.layers.map((x) => (x === l ? { ...x, name: n.trim() } : x)) });
                  }}
                >
                  {l.name}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="tm-row">
          <span>맵 크기 (칸)</span>
          <input type="number" min={1} max={512} value={map.cols} onChange={(e) => setMap(resizeMap(map, Math.max(1, Math.min(512, Number(e.target.value) || 1)), map.rows))} />
          ×
          <input type="number" min={1} max={512} value={map.rows} onChange={(e) => setMap(resizeMap(map, map.cols, Math.max(1, Math.min(512, Number(e.target.value) || 1))))} />
        </div>
        <div className="tm-head">
          <b>내보내기</b>
        </div>
        <div className="tm-row">
          <select value={scale} onChange={(e) => setScale(Number(e.target.value))} title="PNG 확대">
            {[1, 2, 4, 8].map((s) => (
              <option key={s} value={s}>
                {s}배
              </option>
            ))}
          </select>
          <button className="tm-btn" onClick={() => void exportPng()}>
            PNG
          </button>
          <button className="tm-btn" title="Tiled 맵 파일 + 타일셋 그림 (게임 엔진용)" onClick={() => void exportTiled()}>
            Tiled (.tmj)
          </button>
          <button className="tm-btn" title="고른 레이어의 칸 번호" onClick={() => void exportCsv()}>
            CSV
          </button>
        </div>
        <div className="tm-actions">
          <button
            className="tm-btn"
            title="맵을 그림 파일에서 없애요"
            onClick={() => {
              if (!doc.tilemap) return onClose();
              if (!window.confirm("이 그림의 타일맵을 지울까요? (Ctrl+Z 로 되돌릴 수 있어요)")) return;
              doc.setTilemap(null);
              onClose();
            }}
          >
            맵 지우기
          </button>
          <span />
          <button className="tm-btn" onClick={() => finish(false)}>
            취소
          </button>
          <button className="suite-button" onClick={() => finish(true)}>
            완료
          </button>
        </div>
      </aside>
      <div className="tm-stage" onContextMenu={(e) => e.preventDefault()}>
        <canvas
          ref={mapCanvas}
          className={`tm-map${space.current ? " pan" : ""}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={() => {
            hover.current = null;
            redraw();
          }}
          onWheel={onWheel}
        />
        <div className="tm-hint">
          클릭·끌기: 찍기 · 오른쪽 버튼: 지우기 · Alt+클릭: 타일 집기 · X/Y: 뒤집기 · R: 무작위 · 휠: 확대 · Space/가운데 버튼: 화면 옮기기 · 0: 맞추기 · Ctrl+Z · Esc: 완료
        </div>
        <span className="tm-flags">
          {flipH ? "⇋ " : ""}
          {flipV ? "⇵ " : ""}
          {random ? "🎲" : ""}
        </span>
      </div>
    </div>
  );
}

