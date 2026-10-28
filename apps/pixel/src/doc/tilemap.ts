/**
 * 타일맵 (에이스프라이트의 타일맵 레이어, Tiled 맵 에디터): 그림을 같은 크기의 타일로 잘라 타일셋으로 쓰고,
 * 큰 맵에 타일 번호를 찍어 게임 지도를 만든다. 타일 그림을 고치면 맵의 같은 타일이 모두 바뀐다.
 *
 * 칸 값은 Tiled 와 같다: 0 은 빈칸, 1 부터 타일 번호 + 1. 맨 위 두 비트는 좌우·위아래 뒤집기.
 */
export const FLIP_H = 0x80000000;
export const FLIP_V = 0x40000000;
const ID_MASK = 0x0fffffff;

export interface TileLayer {
  name: string;
  visible: boolean;
  cells: number[];
}

export interface Tilemap {
  tileW: number;
  tileH: number;
  cols: number;
  rows: number;
  /** 타일셋으로 쓸 프레임 */
  frame: number;
  layers: TileLayer[];
}

export const tileId = (gid: number) => (gid >>> 0) & ID_MASK;
export const flipsOf = (gid: number) => ({ h: ((gid >>> 0) & FLIP_H) !== 0, v: ((gid >>> 0) & FLIP_V) !== 0 });
export const makeGid = (tile: number, h: boolean, v: boolean) => ((tile & ID_MASK) | (h ? FLIP_H : 0) | (v ? FLIP_V : 0)) >>> 0;

export function newTilemap(tileW: number, tileH: number, cols = 24, rows = 14, frame = 0): Tilemap {
  return { tileW, tileH, cols, rows, frame, layers: [{ name: "바닥", visible: true, cells: new Array(cols * rows).fill(0) }] };
}

export const cloneMap = (m: Tilemap): Tilemap => ({ ...m, layers: m.layers.map((l) => ({ ...l, cells: l.cells.slice() })) });

/** 맵 크기 바꾸기 (왼쪽 위 기준으로 남긴다) */
export function resizeMap(m: Tilemap, cols: number, rows: number): Tilemap {
  return {
    ...m,
    cols,
    rows,
    layers: m.layers.map((l) => {
      const cells = new Array(cols * rows).fill(0);
      for (let y = 0; y < Math.min(rows, m.rows); y++) for (let x = 0; x < Math.min(cols, m.cols); x++) cells[y * cols + x] = l.cells[y * m.cols + x];
      return { ...l, cells };
    }),
  };
}

/** 타일셋 칸 수 */
export function tilesetGrid(width: number, height: number, tileW: number, tileH: number) {
  const cols = Math.max(0, Math.floor(width / tileW));
  const rows = Math.max(0, Math.floor(height / tileH));
  return { cols, rows, count: cols * rows };
}

/** 같은 칸 값으로 이어진 곳 (채우기) */
export function floodCells(cells: number[], cols: number, rows: number, x: number, y: number): number[] {
  const target = cells[y * cols + x];
  const seen = new Uint8Array(cols * rows);
  const out: number[] = [];
  const stack = [y * cols + x];
  while (stack.length) {
    const i = stack.pop()!;
    if (seen[i] || cells[i] !== target) continue;
    seen[i] = 1;
    out.push(i);
    const cx = i % cols;
    const cy = (i - cx) / cols;
    if (cx > 0) stack.push(i - 1);
    if (cx < cols - 1) stack.push(i + 1);
    if (cy > 0) stack.push(i - cols);
    if (cy < rows - 1) stack.push(i + cols);
  }
  return out;
}

/** 타일 한 칸을 그린다 (뒤집기 포함) */
export function drawTile(g: CanvasRenderingContext2D, tileset: CanvasImageSource, tsCols: number, m: Pick<Tilemap, "tileW" | "tileH">, gid: number, dx: number, dy: number, dw = m.tileW, dh = m.tileH) {
  const id = tileId(gid);
  if (!id) return;
  const t = id - 1;
  const sx = (t % tsCols) * m.tileW;
  const sy = Math.floor(t / tsCols) * m.tileH;
  const { h, v } = flipsOf(gid);
  if (!h && !v) {
    g.drawImage(tileset, sx, sy, m.tileW, m.tileH, dx, dy, dw, dh);
    return;
  }
  g.save();
  g.translate(dx + (h ? dw : 0), dy + (v ? dh : 0));
  g.scale(h ? -1 : 1, v ? -1 : 1);
  g.drawImage(tileset, sx, sy, m.tileW, m.tileH, 0, 0, dw, dh);
  g.restore();
}

/** 맵 전체를 한 장의 그림으로 */
export function renderMap(m: Tilemap, tileset: HTMLCanvasElement, scale = 1, onlyVisible = true): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = m.cols * m.tileW * scale;
  c.height = m.rows * m.tileH * scale;
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  const tsCols = Math.floor(tileset.width / m.tileW);
  for (const l of m.layers) {
    if (onlyVisible && !l.visible) continue;
    for (let i = 0; i < l.cells.length; i++) {
      const gid = l.cells[i];
      if (!gid) continue;
      const x = i % m.cols;
      const y = (i - x) / m.cols;
      drawTile(g, tileset, tsCols, m, gid, x * m.tileW * scale, y * m.tileH * scale, m.tileW * scale, m.tileH * scale);
    }
  }
  return c;
}

/** Tiled 맵 파일 (.tmj, JSON). 타일셋 그림은 image 이름으로 같은 폴더에 둔다 */
export function toTiledJson(m: Tilemap, tileset: { width: number; height: number; image: string; name: string }) {
  const { cols: tsCols, count } = tilesetGrid(tileset.width, tileset.height, m.tileW, m.tileH);
  return JSON.stringify(
    {
      compressionlevel: -1,
      width: m.cols,
      height: m.rows,
      infinite: false,
      orientation: "orthogonal",
      renderorder: "right-down",
      tiledversion: "1.10.2",
      version: "1.10",
      type: "map",
      tilewidth: m.tileW,
      tileheight: m.tileH,
      nextlayerid: m.layers.length + 1,
      nextobjectid: 1,
      layers: m.layers.map((l, i) => ({ id: i + 1, name: l.name, type: "tilelayer", visible: l.visible, opacity: 1, x: 0, y: 0, width: m.cols, height: m.rows, data: l.cells.map((v) => v >>> 0) })),
      tilesets: [
        {
          firstgid: 1,
          name: tileset.name,
          image: tileset.image,
          imagewidth: tileset.width,
          imageheight: tileset.height,
          tilewidth: m.tileW,
          tileheight: m.tileH,
          columns: tsCols,
          tilecount: count,
          margin: 0,
          spacing: 0,
        },
      ],
    },
    null,
    1,
  );
}

/** 칸 값을 쉼표로 (게임 코드에 바로 붙여 넣기) */
export function toCsv(m: Tilemap, layer: number) {
  const l = m.layers[layer];
  const lines: string[] = [];
  for (let y = 0; y < m.rows; y++) lines.push(l.cells.slice(y * m.cols, (y + 1) * m.cols).map((v) => v >>> 0).join(","));
  return lines.join("\n");
}

/** 저장 파일에서 읽은 값 다듬기 */
export function sanitizeMap(raw: unknown): Tilemap | null {
  const m = raw as Tilemap;
  if (!m || typeof m !== "object") return null;
  const ok = (v: unknown, max: number) => typeof v === "number" && v >= 1 && v <= max && Number.isInteger(v);
  if (!ok(m.tileW, 256) || !ok(m.tileH, 256) || !ok(m.cols, 512) || !ok(m.rows, 512) || !Array.isArray(m.layers) || !m.layers.length) return null;
  const n = m.cols * m.rows;
  return {
    tileW: m.tileW,
    tileH: m.tileH,
    cols: m.cols,
    rows: m.rows,
    frame: typeof m.frame === "number" && m.frame >= 0 ? m.frame | 0 : 0,
    layers: m.layers.slice(0, 16).map((l, i) => ({
      name: typeof l?.name === "string" ? l.name : `레이어 ${i + 1}`,
      visible: l?.visible !== false,
      cells: Array.from({ length: n }, (_, j) => (Array.isArray(l?.cells) && typeof l.cells[j] === "number" ? l.cells[j] >>> 0 : 0)),
    })),
  };
}
