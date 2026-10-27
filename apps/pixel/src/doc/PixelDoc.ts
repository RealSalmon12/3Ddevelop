import { hexToRgba } from "./color";
import { blendOnto, createRaster, ROW_ALPHABET, setPixel, type PixelRows, type Raster } from "./raster";

export interface Layer {
  id: number;
  name: string;
  visible: boolean;
  raster: Raster;
}

export interface DocSnapshot {
  width: number;
  height: number;
  layers: { id: number; name: string; visible: boolean }[];
  /** 지금 그리는 레이어의 순서 번호 (0 이 맨 아래) */
  active: number;
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
  revision: number;
  layers: { id: number; name: string; visible: boolean; data: Uint8ClampedArray<ArrayBuffer> }[];
}

interface SavedFile {
  format: "npixel";
  version: 1;
  width: number;
  height: number;
  active: number;
  layers: { name: string; visible: boolean; data: string }[];
}

const HISTORY_LIMIT = 100;
export const MAX_LAYERS = 12;

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

/**
 * 그림 한 장. 레이어 여러 장이 겹쳐 있고, 바꿀 때마다 실행 취소용 사본을 남긴다.
 * React 는 subscribe / getSnapshot 으로 바뀐 것을 알아챈다.
 */
export class PixelDoc {
  width = 32;
  height = 32;
  layers: Layer[] = [];
  active = 0;
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
      layers: this.layers.map(({ id, name, visible }) => ({ id, name, visible })),
      active: this.active,
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
    return {
      width: this.width,
      height: this.height,
      active: this.active,
      revision: this.revision,
      layers: this.layers.map((l) => ({ id: l.id, name: l.name, visible: l.visible, data: l.raster.data.slice() })),
    };
  }

  private restore(entry: HistoryEntry) {
    this.width = entry.width;
    this.height = entry.height;
    this.active = entry.active;
    this.revision = entry.revision;
    this.layers = entry.layers.map((l) => ({
      id: l.id,
      name: l.name,
      visible: l.visible,
      raster: { width: entry.width, height: entry.height, data: l.data.slice() },
    }));
  }

  /** 바꾸기 직전에 부른다. 지금 모습을 실행 취소 목록에 넣는다. */
  begin() {
    this.undoStack.push(this.capture());
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
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

  private makeLayer(name: string): Layer {
    return { id: this.nextId++, name, visible: true, raster: createRaster(this.width, this.height) };
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
      copy.raster.data.set(src.raster.data);
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

  /** 지금 레이어를 바로 아래 레이어와 합친다. */
  mergeDown(index = this.active) {
    if (index === 0) return false;
    return this.change(() => {
      const below = this.layers[index - 1];
      blendOnto(below.raster.data, this.layers[index].raster.data);
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

  renameLayer(index: number, name: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed === this.layers[index].name) return;
    this.change(() => {
      this.layers[index].name = trimmed;
    });
  }

  clearLayer(index = this.active) {
    const data = this.layers[index].raster.data;
    if (!data.some((v, i) => i % 4 === 3 && v > 0)) return false;
    return this.change(() => void data.fill(0));
  }

  // ---------- 그림 전체 ----------
  /** 보이는 레이어를 모두 겹친 그림 */
  composite(): Uint8ClampedArray<ArrayBuffer> {
    const out = new Uint8ClampedArray(this.width * this.height * 4);
    for (const layer of this.layers) if (layer.visible) blendOnto(out, layer.raster.data);
    return out;
  }

  /** 좌우나 위아래로 뒤집기. 모든 레이어가 함께 뒤집힌다. */
  flip(horizontal: boolean) {
    this.change(() => {
      for (const layer of this.layers) {
        const src = layer.raster.data.slice();
        const { width: w, height: h } = this;
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const from = horizontal ? (y * w + (w - 1 - x)) * 4 : ((h - 1 - y) * w + x) * 4;
            layer.raster.data.set(src.subarray(from, from + 4), (y * w + x) * 4);
          }
      }
    });
  }

  /** 빈 그림으로 새로 시작한다. 실행 취소 기록도 지운다. */
  reset(width = this.width, height = this.height) {
    this.width = width;
    this.height = height;
    this.nextId = 1;
    this.layers = [this.makeLayer("레이어 1")];
    this.active = 0;
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
    const file: SavedFile = {
      format: "npixel",
      version: 1,
      width: this.width,
      height: this.height,
      active: this.active,
      layers: this.layers.map((l) => ({ name: l.name, visible: l.visible, data: toBase64(l.raster.data) })),
    };
    return JSON.stringify(file);
  }

  load(text: string) {
    let file: SavedFile;
    try {
      file = JSON.parse(text);
    } catch {
      throw new Error("도트 아틀리에 파일이 아니에요.");
    }
    if (file.format !== "npixel" || !Array.isArray(file.layers) || !file.layers.length)
      throw new Error("도트 아틀리에 파일이 아니에요.");
    const { width, height } = file;
    if (!(width > 0 && height > 0 && width <= 512 && height <= 512)) throw new Error("그림 크기가 이상해서 열 수 없어요.");
    this.reset(width, height);
    this.layers = file.layers.map((l) => {
      const layer = this.makeLayer(l.name);
      layer.visible = l.visible !== false;
      layer.raster.data.set(fromBase64(l.data, width * height * 4));
      return layer;
    });
    this.active = Math.min(Math.max(0, file.active | 0), this.layers.length - 1);
    this.emit();
  }

  /** 자동 저장본에서 되살린다. 아직 파일로 저장하지 않은 상태로 둔다. */
  recover(text: string) {
    this.load(text);
    this.revision = this.nextRevision++;
    this.emit();
  }

  // ---------- 글자로 적은 그림 (AI, 예제) ----------
  /**
   * 글자 그림을 지금 레이어에 그린다. 그림이 캔버스보다 작으면 칸을 키워서 가운데에 놓는다.
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
      const raster = this.layers[layerIndex].raster;
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
      layer.raster.data.set(data.subarray(0, layer.raster.data.length));
      this.layers.splice(this.active + 1, 0, layer);
      this.active++;
    });
  }
}
