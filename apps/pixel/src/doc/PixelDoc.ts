import { hexToRgba } from "./color";
import { DEFAULT_PALETTE } from "./color";
import { blendOnto, createRaster, ROW_ALPHABET, setPixel, type PixelRows, type Raster } from "./raster";
import { cloneMap, sanitizeMap, type Tilemap } from "./tilemap";

/**
 * 레이어 한 장. 프레임마다 그림(셀)이 하나씩 있다.
 * 에이스프라이트처럼 레이어 × 프레임 표로 생각하면 된다.
 */
export interface Layer {
  id: number;
  name: string;
  visible: boolean;
  /** 0~100 */
  opacity: number;
  /** 잠그면 칠해지지 않는다 */
  locked: boolean;
  cels: Raster[];
}

export interface Frame {
  /** 이 프레임을 보여 줄 시간 (ms) */
  duration: number;
}

export type TagDirection = "forward" | "reverse" | "pingpong";

/** 에이스프라이트의 태그: 프레임 몇 장에 이름을 붙여 ‘걷기’, ‘점프’ 같은 동작을 나눈다 */
export interface Tag {
  name: string;
  /** 첫 프레임과 끝 프레임 (둘 다 포함, 0부터) */
  from: number;
  to: number;
  color: string;
  direction: TagDirection;
}

export const TAG_COLORS = ["#ff6b6b", "#ffc83d", "#7fe0a8", "#4fb3ff", "#c792ea", "#ff8a65", "#5ce1e6", "#a5d65a"];

export interface LayerInfo {
  id: number;
  name: string;
  visible: boolean;
  opacity: number;
  locked: boolean;
}

export interface DocSnapshot {
  width: number;
  height: number;
  layers: LayerInfo[];
  frames: Frame[];
  tags: Tag[];
  /** 지금 그리는 레이어의 순서 번호 (0 이 맨 아래) */
  active: number;
  frame: number;
  palette: string[];
  /** 고른 영역이 있으면 그 테두리 네모 */
  selection: { x: number; y: number; w: number; h: number } | null;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  /** 칸 하나라도 바뀌면 늘어나는 번호. 화면을 다시 그릴 때 쓴다. */
  version: number;
}

interface HistoryEntry {
  width: number;
  height: number;
  active: number;
  frame: number;
  revision: number;
  frames: Frame[];
  tags: Tag[];
  palette: string[];
  tilemap: Tilemap | null;
  layers: { id: number; name: string; visible: boolean; opacity: number; locked: boolean; cels: Uint8ClampedArray<ArrayBuffer>[] }[];
  bytes: number;
}

interface SavedFileV1 {
  format: "npixel";
  version: 1;
  width: number;
  height: number;
  active: number;
  layers: { name: string; visible: boolean; data: string }[];
}

interface SavedFileV2 {
  format: "npixel";
  version: 2;
  width: number;
  height: number;
  active: number;
  frame: number;
  palette: string[];
  frames: Frame[];
  tags?: Tag[];
  tilemap?: Tilemap;
  layers: { name: string; visible: boolean; opacity: number; locked: boolean; cels: string[] }[];
}

const HISTORY_LIMIT = 150;
/** 실행 취소 기록이 이만큼(바이트)을 넘으면 오래된 것부터 버린다 */
const HISTORY_BYTES = 256 * 1024 * 1024;
export const MAX_LAYERS = 32;
export const MAX_FRAMES = 256;
export const DEFAULT_DURATION = 100;

function toBase64(bytes: Uint8ClampedArray) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(text: string, length: number) {
  const s = atob(text);
  const out = new Uint8ClampedArray(length);
  for (let i = 0; i < Math.min(s.length, length); i++) out[i] = s.charCodeAt(i);
  return out;
}

const isEmpty = (r: Raster) => {
  for (let i = 3; i < r.data.length; i += 4) if (r.data[i]) return false;
  return true;
};

/**
 * 그림 한 장 (애니메이션이면 여러 프레임). 레이어 여러 장이 겹쳐 있고, 바꿀 때마다 실행 취소용 사본을 남긴다.
 * React 는 subscribe / getSnapshot 으로 바뀐 것을 알아챈다.
 */
export class PixelDoc {
  width = 32;
  height = 32;
  layers: Layer[] = [];
  frames: Frame[] = [];
  tags: Tag[] = [];
  active = 0;
  frame = 0;
  palette: string[] = [...DEFAULT_PALETTE];
  /** 이 그림을 타일셋으로 쓰는 맵 (없으면 null) */
  tilemap: Tilemap | null = null;
  /** 고른 칸 (1 이면 골라짐). 없으면 전체. */
  selection: Uint8Array | null = null;
  private nextId = 1;
  private version = 0;
  private revision = 0;
  private nextRevision = 1;
  private savedRevision = 0;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private listeners = new Set<() => void>();
  private snapshot: DocSnapshot;

  constructor(width = 32, height = 32) {
    this.reset(width, height);
    this.snapshot = this.makeSnapshot();
  }

  // ---------- React 연결 ----------
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.snapshot;

  private makeSnapshot(): DocSnapshot {
    return {
      width: this.width,
      height: this.height,
      layers: this.layers.map(({ id, name, visible, opacity, locked }) => ({ id, name, visible, opacity, locked })),
      frames: this.frames.map((f) => ({ ...f })),
      tags: this.tags.map((t) => ({ ...t })),
      active: this.active,
      frame: this.frame,
      palette: this.palette,
      selection: this.selectionBounds(),
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      dirty: this.revision !== this.savedRevision,
      version: this.version,
    };
  }

  private emit() {
    this.version++;
    this.snapshot = this.makeSnapshot();
    for (const l of this.listeners) l();
  }

  // ---------- 실행 취소 ----------
  private capture(): HistoryEntry {
    let bytes = 0;
    const layers = this.layers.map((l) => {
      const cels = l.cels.map((c) => c.data.slice());
      bytes += cels.reduce((s, c) => s + c.length, 0);
      return { id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, locked: l.locked, cels };
    });
    return {
      width: this.width,
      height: this.height,
      active: this.active,
      frame: this.frame,
      revision: this.revision,
      frames: this.frames.map((f) => ({ ...f })),
      tags: this.tags.map((t) => ({ ...t })),
      palette: this.palette,
      tilemap: this.tilemap ? cloneMap(this.tilemap) : null,
      layers,
      bytes,
    };
  }

  private restore(entry: HistoryEntry) {
    const sizeChanged = entry.width !== this.width || entry.height !== this.height;
    this.width = entry.width;
    this.height = entry.height;
    this.active = entry.active;
    this.frame = entry.frame;
    this.revision = entry.revision;
    this.frames = entry.frames.map((f) => ({ ...f }));
    this.tags = entry.tags.map((t) => ({ ...t }));
    this.palette = entry.palette;
    this.tilemap = entry.tilemap ? cloneMap(entry.tilemap) : null;
    this.layers = entry.layers.map((l) => ({
      id: l.id,
      name: l.name,
      visible: l.visible,
      opacity: l.opacity,
      locked: l.locked,
      cels: l.cels.map((data) => ({ width: entry.width, height: entry.height, data: data.slice() })),
    }));
    if (sizeChanged) this.selection = null;
  }

  private trimHistory() {
    let total = this.undoStack.reduce((s, e) => s + e.bytes, 0);
    while (this.undoStack.length > 1 && (this.undoStack.length > HISTORY_LIMIT || total > HISTORY_BYTES)) total -= this.undoStack.shift()!.bytes;
  }

  /** 바꾸기 직전에 부른다. 지금 모습을 실행 취소 목록에 넣는다. */
  begin() {
    this.undoStack.push(this.capture());
    this.trimHistory();
    this.redoStack = [];
  }

  /** 바꾸기를 마쳤을 때 부른다. */
  commit() {
    this.revision = this.nextRevision++;
    this.emit();
  }

  /** begin 과 commit 을 한 번에. fn 이 false 를 돌려주면 아무것도 바뀌지 않은 것으로 친다. */
  change(fn: () => boolean | void): boolean {
    this.begin();
    if (fn() === false) {
      this.undoStack.pop();
      return false;
    }
    this.commit();
    return true;
  }

  /** 붓질 하나가 끝나기 전, 그리는 중인 모습만 화면에 보여 준다. */
  preview() {
    this.emit();
  }

  /** 붓질을 시작했지만 아무것도 바꾸지 않았을 때 begin 을 되돌린다. */
  cancel() {
    const entry = this.undoStack.pop();
    if (entry) this.restore(entry);
    this.emit();
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.redoStack.push(this.capture());
    this.restore(entry);
    this.emit();
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.undoStack.push(this.capture());
    this.restore(entry);
    this.emit();
  }

  // ---------- 레이어 ----------
  get activeLayer() {
    return this.layers[this.active];
  }

  /** 지금 레이어, 지금 프레임의 그림 */
  get cel(): Raster {
    return this.layers[this.active].cels[this.frame];
  }

  celAt(layer: number, frame: number): Raster | undefined {
    return this.layers[layer]?.cels[frame];
  }

  celEmpty(layer: number, frame: number) {
    const c = this.celAt(layer, frame);
    return !c || isEmpty(c);
  }

  private makeLayer(name: string): Layer {
    return {
      id: this.nextId++,
      name,
      visible: true,
      opacity: 100,
      locked: false,
      cels: this.frames.map(() => createRaster(this.width, this.height)),
    };
  }

  addLayer(name = `레이어 ${this.layers.length + 1}`) {
    if (this.layers.length >= MAX_LAYERS) return false;
    return this.change(() => {
      this.layers.splice(this.active + 1, 0, this.makeLayer(name));
      this.active++;
    });
  }

  removeLayer(index = this.active) {
    if (this.layers.length <= 1) return false;
    return this.change(() => {
      this.layers.splice(index, 1);
      this.active = Math.min(this.active, this.layers.length - 1);
    });
  }

  duplicateLayer(index = this.active) {
    if (this.layers.length >= MAX_LAYERS) return false;
    return this.change(() => {
      const src = this.layers[index];
      const copy = this.makeLayer(`${src.name} 복사`);
      copy.opacity = src.opacity;
      copy.cels.forEach((c, f) => c.data.set(src.cels[f].data));
      this.layers.splice(index + 1, 0, copy);
      this.active = index + 1;
    });
  }

  /** 레이어를 위(+1) 나 아래(-1) 로 옮긴다. */
  moveLayer(index: number, direction: 1 | -1) {
    const to = index + direction;
    if (to < 0 || to >= this.layers.length) return false;
    return this.change(() => {
      [this.layers[index], this.layers[to]] = [this.layers[to], this.layers[index]];
      if (this.active === index) this.active = to;
      else if (this.active === to) this.active = index;
    });
  }

  /** 지금 레이어를 바로 아래 레이어와 합친다 (모든 프레임). */
  mergeDown(index = this.active) {
    if (index === 0) return false;
    return this.change(() => {
      const top = this.layers[index];
      const below = this.layers[index - 1];
      below.cels.forEach((c, f) => blendOnto(c.data, top.cels[f].data, top.visible ? top.opacity / 100 : 0));
      this.layers.splice(index, 1);
      this.active = index - 1;
    });
  }

  setActive(index: number) {
    if (index === this.active || !this.layers[index]) return;
    this.active = index;
    this.emit();
  }

  toggleVisible(index: number) {
    this.change(() => {
      this.layers[index].visible = !this.layers[index].visible;
    });
  }

  toggleLocked(index: number) {
    this.change(() => {
      this.layers[index].locked = !this.layers[index].locked;
    });
  }

  /** 불투명도. 끄는 중에는 preview=true 로 기록 없이 바꾸고, 놓을 때 한 번 기록한다. */
  setOpacity(index: number, opacity: number, preview = false) {
    const v = Math.max(0, Math.min(100, Math.round(opacity)));
    if (preview) {
      this.layers[index].opacity = v;
      return this.emit();
    }
    this.change(() => {
      this.layers[index].opacity = v;
    });
  }

  renameLayer(index: number, name: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed === this.layers[index].name) return;
    this.change(() => {
      this.layers[index].name = trimmed;
    });
  }

  clearLayer(index = this.active) {
    const data = this.layers[index].cels[this.frame].data;
    if (!data.some((v, i) => i % 4 === 3 && v > 0)) return false;
    return this.change(() => void data.fill(0));
  }

  // ---------- 프레임 ----------
  setFrame(index: number) {
    const f = Math.max(0, Math.min(this.frames.length - 1, index));
    if (f === this.frame) return;
    this.frame = f;
    this.emit();
  }

  /** 지금 프레임 뒤에 새 프레임. copy 면 지금 프레임을 복사한다. */
  addFrame(copy: boolean) {
    if (this.frames.length >= MAX_FRAMES) return false;
    return this.change(() => {
      const at = this.frame + 1;
      this.frames.splice(at, 0, { duration: this.frames[this.frame].duration });
      // 태그 안에서 늘리면 태그도 늘어나고, 뒤에 있는 태그는 한 칸씩 밀린다
      for (const t of this.tags) {
        if (t.from >= at) t.from++;
        if (t.to >= at - 1 && t.from <= at - 1) t.to++;
        else if (t.to >= at) t.to++;
      }
      for (const l of this.layers) {
        const r = createRaster(this.width, this.height);
        if (copy) r.data.set(l.cels[this.frame].data);
        l.cels.splice(at, 0, r);
      }
      this.frame = at;
    });
  }

  removeFrame(index = this.frame) {
    if (this.frames.length <= 1) return false;
    return this.change(() => {
      this.frames.splice(index, 1);
      for (const l of this.layers) l.cels.splice(index, 1);
      for (const t of this.tags) {
        if (t.from > index) t.from--;
        if (t.to >= index) t.to--;
      }
      this.tags = this.tags.filter((t) => t.to >= t.from);
      this.frame = Math.min(this.frame, this.frames.length - 1);
    });
  }

  moveFrame(from: number, to: number) {
    if (from === to || to < 0 || to >= this.frames.length) return false;
    return this.change(() => {
      const [f] = this.frames.splice(from, 1);
      this.frames.splice(to, 0, f);
      for (const l of this.layers) {
        const [c] = l.cels.splice(from, 1);
        l.cels.splice(to, 0, c);
      }
      this.frame = to;
    });
  }

  /** index 가 null 이면 모든 프레임 */
  setDuration(index: number | null, ms: number) {
    const d = Math.max(10, Math.min(10000, Math.round(ms)));
    this.change(() => {
      if (index === null) this.frames.forEach((f) => (f.duration = d));
      else this.frames[index].duration = d;
    });
  }

  // ---------- 태그 ----------
  addTag(from: number, to: number, name = `태그 ${this.tags.length + 1}`, color = TAG_COLORS[this.tags.length % TAG_COLORS.length], direction: TagDirection = "forward") {
    const last = this.frames.length - 1;
    const a = Math.max(0, Math.min(last, Math.min(from, to)));
    const b = Math.max(0, Math.min(last, Math.max(from, to)));
    this.change(() => {
      this.tags.push({ name, from: a, to: b, color, direction });
    });
    return this.tags.length - 1;
  }

  updateTag(index: number, patch: Partial<Tag>) {
    const t = this.tags[index];
    if (!t) return;
    const last = this.frames.length - 1;
    const next = { ...t, ...patch };
    next.from = Math.max(0, Math.min(last, next.from));
    next.to = Math.max(next.from, Math.min(last, next.to));
    this.change(() => {
      this.tags[index] = next;
    });
  }

  removeTag(index: number) {
    if (!this.tags[index]) return;
    this.change(() => {
      this.tags.splice(index, 1);
    });
  }

  /** 재생할 프레임 순서. tag 가 없으면 전체를 앞으로 */
  sequence(tag: number | null = null): number[] {
    const t = tag === null ? undefined : this.tags[tag];
    const from = t ? t.from : 0;
    const to = t ? Math.min(t.to, this.frames.length - 1) : this.frames.length - 1;
    const fwd = Array.from({ length: to - from + 1 }, (_, i) => from + i);
    if (!t || t.direction === "forward") return fwd;
    if (t.direction === "reverse") return fwd.reverse();
    // 왕복: 1 2 3 2 (끝을 두 번 보여 주지 않는다)
    return fwd.length > 2 ? [...fwd, ...fwd.slice(1, -1).reverse()] : fwd;
  }

  // ---------- 팔레트 ----------
  setPalette(palette: string[]) {
    this.change(() => {
      this.palette = palette.slice(0, 256);
    });
  }

  // ---------- 고르기 ----------
  selectionBounds() {
    const m = this.selection;
    if (!m) return null;
    let x0 = this.width;
    let y0 = this.height;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++)
        if (m[y * this.width + x]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  /** 고르기는 실행 취소 기록에 넣지 않는다 (에이스프라이트도 그림만 되돌린다) */
  setSelection(mask: Uint8Array | null) {
    this.selection = mask && mask.some((v) => v) ? mask : null;
    this.emit();
  }

  selectAll() {
    this.setSelection(new Uint8Array(this.width * this.height).fill(1));
  }

  // ---------- 그림 전체 ----------
  /** 보이는 레이어를 모두 겹친 그림 */
  composite(frame = this.frame): Uint8ClampedArray<ArrayBuffer> {
    const out = new Uint8ClampedArray(this.width * this.height * 4);
    for (const layer of this.layers) if (layer.visible && layer.opacity > 0) blendOnto(out, layer.cels[frame].data, layer.opacity / 100);
    return out;
  }

  /** 모든 프레임, 모든 레이어의 그림을 함께 바꾼다 (뒤집기, 크기 바꾸기 등) */
  transformAll(fn: (r: Raster) => Raster, width = this.width, height = this.height) {
    return this.change(() => {
      for (const l of this.layers) l.cels = l.cels.map(fn);
      this.width = width;
      this.height = height;
      this.selection = null;
    });
  }

  /** 지금 셀(또는 모든 프레임의 같은 레이어)만 바꾼다 */
  transformCel(fn: (r: Raster) => void, allFrames = false) {
    if (this.activeLayer.locked) return false;
    return this.change(() => {
      if (allFrames) this.activeLayer.cels.forEach(fn);
      else fn(this.cel);
    });
  }

  /** 빈 그림으로 새로 시작한다. 실행 취소 기록도 지운다. */
  reset(width = this.width, height = this.height) {
    this.width = width;
    this.height = height;
    this.nextId = 1;
    this.frames = [{ duration: DEFAULT_DURATION }];
    this.tags = [];
    this.tilemap = null;
    this.layers = [this.makeLayer("레이어 1")];
    this.active = 0;
    this.frame = 0;
    this.selection = null;
    this.undoStack = [];
    this.redoStack = [];
    this.revision = this.savedRevision = 0;
    this.emit();
  }

  markSaved() {
    this.savedRevision = this.revision;
    this.emit();
  }

  serialize(): string {
    const file: SavedFileV2 = {
      format: "npixel",
      version: 2,
      width: this.width,
      height: this.height,
      active: this.active,
      frame: this.frame,
      palette: this.palette,
      frames: this.frames,
      tags: this.tags,
      ...(this.tilemap ? { tilemap: this.tilemap } : {}),
      layers: this.layers.map((l) => ({ name: l.name, visible: l.visible, opacity: l.opacity, locked: l.locked, cels: l.cels.map((c) => toBase64(c.data)) })),
    };
    return JSON.stringify(file);
  }

  load(text: string) {
    let file: SavedFileV1 | SavedFileV2;
    try {
      file = JSON.parse(text);
    } catch {
      throw new Error("바코 눈꽃 파일이 아니에요.");
    }
    if (file.format !== "npixel" || !Array.isArray(file.layers) || !file.layers.length) throw new Error("바코 눈꽃 파일이 아니에요.");
    const { width, height } = file;
    if (!(width > 0 && height > 0 && width <= 1024 && height <= 1024)) throw new Error("그림 크기가 이상해서 열 수 없어요.");
    this.reset(width, height);
    const len = width * height * 4;
    if (file.version === 2) {
      this.frames = file.frames.length ? file.frames.map((f) => ({ duration: f.duration || DEFAULT_DURATION })) : [{ duration: DEFAULT_DURATION }];
      if (Array.isArray(file.palette) && file.palette.length) this.palette = file.palette.filter((c) => typeof c === "string");
      const last = this.frames.length - 1;
      this.tags = (Array.isArray(file.tags) ? file.tags : [])
        .filter((t) => t && typeof t.from === "number" && typeof t.to === "number" && t.from <= t.to && t.from <= last)
        .map((t, i) => ({
          name: String(t.name ?? `태그 ${i + 1}`),
          from: t.from,
          to: Math.min(t.to, last),
          color: typeof t.color === "string" ? t.color : TAG_COLORS[i % TAG_COLORS.length],
          direction: t.direction === "reverse" || t.direction === "pingpong" ? t.direction : "forward",
        }));
      this.layers = file.layers.map((l) => {
        const layer = this.makeLayer(l.name);
        layer.visible = l.visible !== false;
        layer.opacity = typeof l.opacity === "number" ? l.opacity : 100;
        layer.locked = !!l.locked;
        layer.cels.forEach((c, f) => l.cels[f] && c.data.set(fromBase64(l.cels[f], len)));
        return layer;
      });
      this.frame = Math.min(Math.max(0, file.frame | 0), this.frames.length - 1);
      this.tilemap = sanitizeMap(file.tilemap);
    } else {
      this.layers = file.layers.map((l) => {
        const layer = this.makeLayer(l.name);
        layer.visible = l.visible !== false;
        layer.cels[0].data.set(fromBase64(l.data, len));
        return layer;
      });
    }
    this.active = Math.min(Math.max(0, file.active | 0), this.layers.length - 1);
    this.emit();
  }

  /** 자동 저장본에서 되살린다. 아직 파일로 저장하지 않은 상태로 둔다. */
  recover(text: string) {
    this.load(text);
    this.revision = this.nextRevision++;
    this.emit();
  }

  /** 타일맵 편집기에서 고친 맵을 문서에 (실행 취소 한 번으로 되돌린다) */
  setTilemap(map: Tilemap | null) {
    this.change(() => {
      this.tilemap = map ? cloneMap(map) : null;
    });
  }

  // ---------- 글자로 적은 그림 (AI, 예제) ----------
  /**
   * 글자 그림을 지금 셀에 그린다. 그림이 캔버스보다 작으면 칸을 키워서 가운데에 놓는다.
   * 실행 취소 한 번으로 되돌릴 수 있다.
   */
  drawRows(art: PixelRows, layerIndex = this.active) {
    const rows = art.rows.filter((r) => typeof r === "string");
    const artH = rows.length;
    const artW = Math.max(0, ...rows.map((r) => r.length));
    if (!artW || !artH) return false;
    const scale = Math.max(1, Math.min(Math.floor(this.width / artW), Math.floor(this.height / artH)));
    const offX = Math.floor((this.width - artW * scale) / 2);
    const offY = Math.floor((this.height - artH * scale) / 2);
    const colors = art.palette.map(hexToRgba);
    return this.change(() => {
      const raster = this.layers[layerIndex].cels[this.frame];
      raster.data.fill(0);
      rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          const color = colors[ROW_ALPHABET.indexOf(row[x])];
          if (!color) continue;
          for (let sy = 0; sy < scale; sy++)
            for (let sx = 0; sx < scale; sx++) setPixel(raster, offX + x * scale + sx, offY + y * scale + sy, color);
        }
      });
    });
  }

  /** 그림 파일을 픽셀로 바꿔 새 레이어에 넣는다. data 는 캔버스 크기로 줄인 RGBA. */
  importPixels(data: Uint8ClampedArray, name: string) {
    if (this.layers.length >= MAX_LAYERS) return false;
    return this.change(() => {
      const layer = this.makeLayer(name);
      layer.cels[this.frame].data.set(data.subarray(0, layer.cels[this.frame].data.length));
      this.layers.splice(this.active + 1, 0, layer);
      this.active++;
    });
  }

  /** 가로로 이어진 스프라이트 시트를 프레임으로 나눠 새 레이어에 넣는다. */
  importFrames(frames: Uint8ClampedArray[], name: string) {
    if (this.layers.length >= MAX_LAYERS) return false;
    return this.change(() => {
      while (this.frames.length < frames.length && this.frames.length < MAX_FRAMES) {
        this.frames.push({ duration: this.frames[this.frames.length - 1].duration });
        for (const l of this.layers) l.cels.push(createRaster(this.width, this.height));
      }
      const layer = this.makeLayer(name);
      frames.forEach((d, f) => layer.cels[f]?.data.set(d.subarray(0, layer.cels[f].data.length)));
      this.layers.splice(this.active + 1, 0, layer);
      this.active++;
      this.frame = 0;
    });
  }
}
