// 포토샵 PSD 읽기, 쓰기 (8비트 RGB). 레이어마다 픽셀, 위치, 불투명도, 혼합 모드, 숨김, 클리핑, 한글 이름을 주고받는다.
// 글자, 도형, 효과, 마스크는 픽셀로 구워서 쓰고, 보정 레이어는 합친 그림에만 들어간다.
import { newRasterLayer, type BlendMode, type PhotoDoc, type RasterLayer } from "./model";
import { createCanvas, ctx2d, pixelsAsync, putCanvas } from "./pixels";
import { flatten, layerToDocCanvas } from "./render";

const BLEND_KEYS: Record<BlendMode, string> = {
  "source-over": "norm",
  multiply: "mul ",
  screen: "scrn",
  overlay: "over",
  darken: "dark",
  lighten: "lite",
  "color-dodge": "div ",
  "color-burn": "idiv",
  "hard-light": "hLit",
  "soft-light": "sLit",
  difference: "diff",
  exclusion: "smud",
  hue: "hue ",
  saturation: "sat ",
  color: "colr",
  luminosity: "lum ",
};
const BLEND_FROM_KEY = new Map(Object.entries(BLEND_KEYS).map(([mode, key]) => [key, mode as BlendMode]));

// ───────────── 쓰기 ─────────────

class Writer {
  private buf = new Uint8Array(1 << 16);
  private view = new DataView(this.buf.buffer);
  length = 0;
  private ensure(n: number) {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  u8(v: number) {
    this.ensure(1);
    this.buf[this.length++] = v;
  }
  u16(v: number) {
    this.ensure(2);
    this.view.setUint16(this.length, v);
    this.length += 2;
  }
  i16(v: number) {
    this.ensure(2);
    this.view.setInt16(this.length, v);
    this.length += 2;
  }
  u32(v: number) {
    this.ensure(4);
    this.view.setUint32(this.length, v);
    this.length += 4;
  }
  i32(v: number) {
    this.ensure(4);
    this.view.setInt32(this.length, v);
    this.length += 4;
  }
  ascii(s: string) {
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i) & 0x7f);
  }
  bytes(b: Uint8Array) {
    this.ensure(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
  }
  /** 길이(4바이트)를 나중에 채울 자리 */
  mark() {
    const at = this.length;
    this.u32(0);
    return at;
  }
  fill(at: number, pad = 1) {
    while ((this.length - at - 4) % pad) this.u8(0);
    this.view.setUint32(at, this.length - at - 4);
  }
  result() {
    return this.buf.slice(0, this.length);
  }
}

/** PackBits 로 한 줄 압축 */
function packBits(row: Uint8Array, out: number[]) {
  const n = row.length;
  let i = 0;
  while (i < n) {
    let run = 1;
    while (i + run < n && run < 128 && row[i + run] === row[i]) run++;
    if (run >= 3) {
      out.push(257 - run, row[i]);
      i += run;
      continue;
    }
    let lit = 0;
    while (i + lit < n && lit < 128) {
      if (i + lit + 2 < n && row[i + lit] === row[i + lit + 1] && row[i + lit] === row[i + lit + 2]) break;
      lit++;
    }
    out.push(lit - 1);
    for (let k = 0; k < lit; k++) out.push(row[i + k]);
    i += lit;
  }
}

/** 채널 하나 (RLE): 줄마다 길이 표, 그다음 압축한 줄들 */
function encodePlane(data: Uint8ClampedArray, w: number, h: number, offset: number, stride: number) {
  const counts: number[] = [];
  const body: number[] = [];
  const row = new Uint8Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) row[x] = data[(y * stride + x) * 4 + offset];
    const before = body.length;
    packBits(row, body);
    counts.push(body.length - before);
  }
  return { counts, body: Uint8Array.from(body) };
}

function opaqueRect(c: HTMLCanvasElement) {
  const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width;
  let y0 = c.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++)
      if (d[(y * c.width + x) * 4 + 3]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export interface PsdWriteResult {
  data: Uint8Array;
  /** PSD 에 레이어로 못 넣고 합친 그림에만 들어간 보정 레이어 수 */
  skippedAdjust: number;
}

export async function writePsd(doc: PhotoDoc): Promise<PsdWriteResult> {
  // 그리기 전에 픽셀을 모두 읽어 둔다
  await Promise.all(doc.layers.flatMap((l) => [l.kind === "raster" ? pixelsAsync(l.src) : null, l.mask ? pixelsAsync(l.mask.src) : null]));
  const { width: W, height: H } = doc;
  const layers = doc.layers.filter((l) => l.kind !== "adjust");
  const skippedAdjust = doc.layers.length - layers.length;
  // 배경색은 맨 아래 레이어로
  const records: { name: string; canvas: HTMLCanvasElement; opacity: number; blend: BlendMode; hidden: boolean; clip: boolean }[] = [];
  if (doc.background) {
    const bg = createCanvas(W, H);
    const g = ctx2d(bg);
    g.fillStyle = doc.background;
    g.fillRect(0, 0, W, H);
    records.push({ name: "배경", canvas: bg, opacity: 1, blend: "source-over", hidden: false, clip: false });
  }
  for (const l of layers) {
    records.push({
      name: l.name,
      canvas: layerToDocCanvas({ ...l, opacity: 1, blend: "source-over" }, doc),
      opacity: l.opacity,
      blend: l.blend,
      hidden: !l.visible,
      clip: !!l.clip,
    });
  }

  const w = new Writer();
  // 머리
  w.ascii("8BPS");
  w.u16(1);
  for (let i = 0; i < 6; i++) w.u8(0);
  w.u16(4);
  w.u32(H);
  w.u32(W);
  w.u16(8);
  w.u16(3);
  w.u32(0); // 색 모드 데이터
  w.u32(0); // 이미지 리소스

  // 레이어
  const section = w.mark();
  const info = w.mark();
  w.i16(records.length);
  const planes: { counts: number[]; body: Uint8Array }[][] = [];
  for (const r of records) {
    const rect = opaqueRect(r.canvas);
    const chans: { counts: number[]; body: Uint8Array }[] = [];
    if (rect) {
      const d = ctx2d(r.canvas).getImageData(rect.x, rect.y, rect.w, rect.h).data;
      for (const off of [3, 0, 1, 2]) chans.push(encodePlane(d, rect.w, rect.h, off, rect.w));
    } else for (let k = 0; k < 4; k++) chans.push({ counts: [], body: new Uint8Array(0) });
    planes.push(chans);
    w.i32(rect?.y ?? 0);
    w.i32(rect?.x ?? 0);
    w.i32(rect ? rect.y + rect.h : 0);
    w.i32(rect ? rect.x + rect.w : 0);
    w.u16(4);
    [-1, 0, 1, 2].forEach((id, k) => {
      w.i16(id);
      w.u32(2 + chans[k].counts.length * 2 + chans[k].body.length);
    });
    w.ascii("8BIM");
    w.ascii(BLEND_KEYS[r.blend] ?? "norm");
    w.u8(Math.round(r.opacity * 255));
    w.u8(r.clip ? 1 : 0);
    w.u8(r.hidden ? 2 : 0);
    w.u8(0);
    const extra = w.mark();
    w.u32(0); // 마스크
    w.u32(0); // 혼합 범위
    // 파스칼 이름 (영문만, 4바이트 단위) + 유니코드 이름
    const ascii = r.name.replace(/[^\x20-\x7e]/g, "_").slice(0, 255);
    const start = w.length;
    w.u8(ascii.length);
    w.ascii(ascii);
    while ((w.length - start) % 4) w.u8(0);
    w.ascii("8BIMluni");
    const luni = w.mark();
    w.u32(r.name.length);
    for (let i = 0; i < r.name.length; i++) w.u16(r.name.charCodeAt(i));
    w.fill(luni, 4);
    w.fill(extra);
  }
  for (const chans of planes)
    for (const c of chans) {
      w.u16(1);
      for (const n of c.counts) w.u16(n);
      w.bytes(c.body);
    }
  w.fill(info, 4);
  w.u32(0); // 전체 마스크
  w.fill(section);

  // 합친 그림 (보정 레이어까지 들어간 화면 그대로)
  const merged = ctx2d(flatten(doc)).getImageData(0, 0, W, H).data;
  const mp = [0, 1, 2, 3].map((off) => encodePlane(merged, W, H, off, W));
  w.u16(1);
  for (const p of mp) for (const n of p.counts) w.u16(n);
  for (const p of mp) w.bytes(p.body);
  return { data: w.result(), skippedAdjust };
}

// ───────────── 읽기 ─────────────

class Reader {
  private view: DataView;
  pos = 0;
  constructor(private bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  u8() {
    return this.bytes[this.pos++];
  }
  u16() {
    const v = this.view.getUint16(this.pos);
    this.pos += 2;
    return v;
  }
  i16() {
    const v = this.view.getInt16(this.pos);
    this.pos += 2;
    return v;
  }
  u32() {
    const v = this.view.getUint32(this.pos);
    this.pos += 4;
    return v;
  }
  i32() {
    const v = this.view.getInt32(this.pos);
    this.pos += 4;
    return v;
  }
  ascii(n: number) {
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.bytes[this.pos++]);
    return s;
  }
  skip(n: number) {
    this.pos += n;
  }
  slice(n: number) {
    const s = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return s;
  }
}

function unpackBits(src: Uint8Array, out: Uint8Array) {
  let i = 0;
  let o = 0;
  while (i < src.length && o < out.length) {
    const n = src[i++];
    if (n < 128) {
      for (let k = 0; k <= n && o < out.length; k++) out[o++] = src[i++];
    } else if (n > 128) {
      const v = src[i++];
      for (let k = 0; k < 257 - n && o < out.length; k++) out[o++] = v;
    }
  }
}

/** 채널 하나를 풀어서 w×h 바이트로 */
function decodeChannel(r: Reader, w: number, h: number, compression: number) {
  const out = new Uint8Array(w * h);
  if (!w || !h) return out;
  if (compression === 0) out.set(r.slice(w * h));
  else if (compression === 1) {
    const counts: number[] = [];
    for (let y = 0; y < h; y++) counts.push(r.u16());
    for (let y = 0; y < h; y++) unpackBits(r.slice(counts[y]), out.subarray(y * w, (y + 1) * w));
  } else throw new Error("ZIP 으로 압축된 PSD 는 아직 열 수 없어요. 포토샵에서 ‘최대 호환성’으로 다시 저장해 주세요.");
  return out;
}

export function readPsd(bytes: Uint8Array): PhotoDoc {
  const r = new Reader(bytes);
  if (r.ascii(4) !== "8BPS") throw new Error("PSD 파일이 아니에요.");
  const version = r.u16();
  if (version !== 1) throw new Error("큰 문서 형식(PSB)은 아직 열 수 없어요.");
  r.pos += 6;
  const channels = r.u16();
  const H = r.u32();
  const W = r.u32();
  const depth = r.u16();
  const mode = r.u16();
  if (depth !== 8) throw new Error(`${depth}비트 PSD 예요. 포토샵에서 ‘이미지 → 모드 → 8비트/채널’로 바꿔 저장해 주세요.`);
  if (mode !== 3) throw new Error("RGB 색상 PSD 만 열 수 있어요. 포토샵에서 ‘이미지 → 모드 → RGB 색상’으로 바꿔 저장해 주세요.");
  r.skip(r.u32()); // 색 모드 데이터
  r.skip(r.u32()); // 이미지 리소스
  const sectionLen = r.u32();
  const sectionEnd = r.pos + sectionLen;
  const doc: PhotoDoc = { width: W, height: H, background: null, layers: [] };

  if (sectionLen > 0) {
    const infoLen = r.u32();
    const infoEnd = r.pos + infoLen;
    if (infoLen > 0) {
      const count = Math.abs(r.i16());
      type Rec = { top: number; left: number; bottom: number; right: number; chans: { id: number; len: number }[]; blend: string; opacity: number; clip: boolean; hidden: boolean; name: string; divider: boolean };
      const recs: Rec[] = [];
      for (let i = 0; i < count; i++) {
        const top = r.i32();
        const left = r.i32();
        const bottom = r.i32();
        const right = r.i32();
        const n = r.u16();
        const chans = Array.from({ length: n }, () => ({ id: r.i16(), len: r.u32() }));
        r.pos += 4; // 8BIM
        const blend = r.ascii(4);
        const opacity = r.u8();
        const clip = r.u8() === 1;
        const flags = r.u8();
        r.pos += 1;
        const extraLen = r.u32();
        const extraEnd = r.pos + extraLen;
        r.skip(r.u32()); // 마스크
        r.skip(r.u32()); // 혼합 범위
        const nameLen = r.u8();
        let name = r.ascii(nameLen);
        r.pos += (4 - ((nameLen + 1) % 4)) % 4;
        let divider = false;
        while (r.pos + 12 <= extraEnd) {
          const sig = r.ascii(4);
          if (sig !== "8BIM" && sig !== "8B64") break;
          const key = r.ascii(4);
          const len = r.u32();
          const end = r.pos + len;
          if (key === "luni") {
            const chars = r.u32();
            let s = "";
            for (let k = 0; k < chars; k++) s += String.fromCharCode(r.u16());
            name = s.replace(/\0+$/, "");
          } else if (key === "lsct" || key === "lsdk") {
            // 그룹 시작·끝 표시 (그룹은 풀어서 레이어만 가져온다)
            if (r.u32() !== 0) divider = true;
          }
          r.pos = end + (len % 2);
        }
        r.pos = extraEnd;
        recs.push({ top, left, bottom, right, chans, blend, opacity, clip, hidden: (flags & 2) !== 0, name, divider });
      }
      for (const rec of recs) {
        const w = Math.max(0, rec.right - rec.left);
        const h = Math.max(0, rec.bottom - rec.top);
        const planes = new Map<number, Uint8Array>();
        for (const ch of rec.chans) {
          const end = r.pos + ch.len;
          const compression = r.u16();
          // 사용자 마스크(-2, -3)는 크기가 달라서 건너뛴다
          if (ch.id >= -1) planes.set(ch.id, decodeChannel(r, w, h, compression));
          r.pos = end;
        }
        if (rec.divider || !w || !h) continue;
        const c = createCanvas(w, h);
        const g = ctx2d(c);
        const img = g.createImageData(w, h);
        const d = img.data;
        const [R, G, B, A] = [planes.get(0), planes.get(1), planes.get(2), planes.get(-1)];
        for (let i = 0; i < w * h; i++) {
          d[i * 4] = R ? R[i] : 0;
          d[i * 4 + 1] = G ? G[i] : 0;
          d[i * 4 + 2] = B ? B[i] : 0;
          d[i * 4 + 3] = A ? A[i] : 255;
        }
        g.putImageData(img, 0, 0);
        const layer: RasterLayer = {
          ...newRasterLayer(doc, putCanvas(c), w, h, rec.name || "레이어"),
          x: rec.left + w / 2,
          y: rec.top + h / 2,
          opacity: rec.opacity / 255,
          blend: BLEND_FROM_KEY.get(rec.blend) ?? "source-over",
          visible: !rec.hidden,
          clip: rec.clip || undefined,
        };
        doc.layers.push(layer);
      }
    }
    r.pos = Math.max(r.pos, infoEnd);
  }
  if (doc.layers.length) return doc;

  // 레이어가 없으면 합친 그림을 한 장으로
  r.pos = sectionEnd;
  const compression = r.u16();
  const planes: Uint8Array[] = [];
  if (compression === 1) {
    const counts: number[] = [];
    for (let i = 0; i < channels * H; i++) counts.push(r.u16());
    for (let ch = 0; ch < channels; ch++) {
      const out = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) unpackBits(r.slice(counts[ch * H + y]), out.subarray(y * W, (y + 1) * W));
      planes.push(out);
    }
  } else if (compression === 0) for (let ch = 0; ch < channels; ch++) planes.push(r.slice(W * H));
  else throw new Error("ZIP 으로 압축된 PSD 는 아직 열 수 없어요.");
  const c = createCanvas(W, H);
  const g = ctx2d(c);
  const img = g.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    img.data[i * 4] = planes[0][i];
    img.data[i * 4 + 1] = planes[1]?.[i] ?? planes[0][i];
    img.data[i * 4 + 2] = planes[2]?.[i] ?? planes[0][i];
    img.data[i * 4 + 3] = channels >= 4 ? planes[3][i] : 255;
  }
  g.putImageData(img, 0, 0);
  doc.layers.push(newRasterLayer(doc, putCanvas(c), W, H, "배경"));
  return doc;
}
