// 에이스프라이트 (.aseprite, .ase) 읽기, 쓰기.
// 레이어, 프레임(시간), 셀(위치·불투명도·연결), 태그, 팔레트를 주고받는다. 그룹은 풀어서 안의 레이어만 가져온다.
// 형식: https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md
import { MAX_FRAMES, MAX_LAYERS, type PixelDoc, type TagDirection } from "./PixelDoc";

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

// ───────────── 읽기 ─────────────

interface AseLayer {
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  group: boolean;
  /** 배경 레이어는 투명 색 번호도 그대로 칠한다 */
  background: boolean;
  level: number;
}

/** .aseprite 파일을 바코 눈꽃 저장 형식(JSON 글)으로 바꾼다. 그대로 doc.load() 에 넘기면 된다. */
export async function readAseprite(bytes: Uint8Array): Promise<{ json: string; notes: string[] }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 128 || view.getUint16(4, true) !== 0xa5e0) throw new Error("에이스프라이트 파일이 아니에요.");
  const frameCount = view.getUint16(6, true);
  const W = view.getUint16(8, true);
  const H = view.getUint16(10, true);
  const depth = view.getUint16(12, true);
  const flags = view.getUint32(14, true);
  const transparentIndex = bytes[28];
  if (W > 1024 || H > 1024) throw new Error("그림이 너무 커요 (1024×1024 까지 열 수 있어요).");
  if (depth !== 32 && depth !== 16 && depth !== 8) throw new Error("이 색 형식은 열 수 없어요.");
  const notes: string[] = [];

  const layers: AseLayer[] = [];
  let palette: number[][] = [];
  const frames: { duration: number }[] = [];
  const tags: { name: string; from: number; to: number; color: string; direction: TagDirection }[] = [];
  /** cels[frame][layer] = RGBA (그림 크기) */
  const cels: (Uint8ClampedArray | undefined)[][] = [];
  const pending: { frame: number; layer: number; link?: number; x: number; y: number; w: number; h: number; opacity: number; data?: Uint8Array; compressed: boolean }[] = [];

  let pos = 128;
  for (let f = 0; f < frameCount && pos + 16 <= bytes.length; f++) {
    const frameBytes = view.getUint32(pos, true);
    const oldChunks = view.getUint16(pos + 6, true);
    const duration = view.getUint16(pos + 8, true);
    const newChunks = view.getUint32(pos + 12, true);
    const chunkCount = newChunks || oldChunks;
    frames.push({ duration: duration || 100 });
    cels.push([]);
    let p = pos + 16;
    for (let c = 0; c < chunkCount && p + 6 <= pos + frameBytes; c++) {
      const size = view.getUint32(p, true);
      const type = view.getUint16(p + 4, true);
      const d = p + 6;
      const str = (at: number) => {
        const len = view.getUint16(at, true);
        return { text: new TextDecoder().decode(bytes.subarray(at + 2, at + 2 + len)), end: at + 2 + len };
      };
      if (type === 0x2004) {
        const lf = view.getUint16(d, true);
        const ltype = view.getUint16(d + 2, true);
        const level = view.getUint16(d + 4, true);
        const opacity = bytes[d + 12];
        layers.push({ name: str(d + 16).text, visible: (lf & 1) !== 0, locked: (lf & 2) === 0, opacity: flags & 1 ? opacity : 255, group: ltype === 1, background: (lf & 8) !== 0, level });
        if (ltype === 2) notes.push("타일맵 레이어는 빈 레이어로 열려요");
      } else if (type === 0x2005) {
        const layer = view.getUint16(d, true);
        const x = view.getInt16(d + 2, true);
        const y = view.getInt16(d + 4, true);
        const opacity = bytes[d + 6];
        const ctype = view.getUint16(d + 7, true);
        const body = d + 16;
        if (ctype === 1) pending.push({ frame: f, layer, link: view.getUint16(body, true), x, y, w: 0, h: 0, opacity, compressed: false });
        else if (ctype === 0 || ctype === 2) {
          const w = view.getUint16(body, true);
          const h = view.getUint16(body + 2, true);
          pending.push({ frame: f, layer, x, y, w, h, opacity, data: bytes.subarray(body + 4, p + size), compressed: ctype === 2 });
        }
      } else if (type === 0x2018) {
        const n = view.getUint16(d, true);
        let t = d + 10;
        for (let i = 0; i < n; i++) {
          const from = view.getUint16(t, true);
          const to = view.getUint16(t + 2, true);
          const dir = bytes[t + 4];
          const color = hex(bytes[t + 13], bytes[t + 14], bytes[t + 15]);
          const name = str(t + 17);
          tags.push({ name: name.text, from, to, color, direction: dir === 1 ? "reverse" : dir >= 2 ? "pingpong" : "forward" });
          t = name.end;
        }
      } else if (type === 0x2019) {
        const total = view.getUint32(d, true);
        const first = view.getUint32(d + 4, true);
        const last = view.getUint32(d + 8, true);
        if (palette.length < total) palette = [...palette, ...Array.from({ length: total - palette.length }, () => [0, 0, 0, 255])];
        let e = d + 20;
        for (let i = first; i <= last; i++) {
          const ef = view.getUint16(e, true);
          palette[i] = [bytes[e + 2], bytes[e + 3], bytes[e + 4], bytes[e + 5]];
          e += 6;
          if (ef & 1) e = str(e).end;
        }
      } else if (type === 0x0004 && !palette.length) {
        // 옛 팔레트 (예전 파일)
        const packets = view.getUint16(d, true);
        let e = d + 2;
        let idx = 0;
        for (let k = 0; k < packets; k++) {
          idx += bytes[e];
          let n = bytes[e + 1] || 256;
          e += 2;
          while (n--) {
            palette[idx++] = [bytes[e], bytes[e + 1], bytes[e + 2], 255];
            e += 3;
          }
        }
      }
      p += size;
    }
    pos += frameBytes;
  }

  // 셀 그림 풀기
  const bpp = depth / 8;
  for (const cel of pending) {
    if (cel.link !== undefined || !cel.data) continue;
    const raw = cel.compressed ? await inflate(cel.data) : cel.data;
    const out = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < cel.h; y++) {
      const ty = cel.y + y;
      if (ty < 0 || ty >= H) continue;
      for (let x = 0; x < cel.w; x++) {
        const tx = cel.x + x;
        if (tx < 0 || tx >= W) continue;
        const s = (y * cel.w + x) * bpp;
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        if (depth === 32) [r, g, b, a] = [raw[s], raw[s + 1], raw[s + 2], raw[s + 3]];
        else if (depth === 16) [r, g, b, a] = [raw[s], raw[s], raw[s], raw[s + 1]];
        else if (raw[s] !== transparentIndex || layers[cel.layer]?.background) {
          const c = palette[raw[s]] ?? [0, 0, 0, 0];
          [r, g, b, a] = c;
        }
        const o = (ty * W + tx) * 4;
        out[o] = r;
        out[o + 1] = g;
        out[o + 2] = b;
        out[o + 3] = (a * cel.opacity) / 255;
      }
    }
    (cels[cel.frame] ??= [])[cel.layer] = out;
  }
  for (const cel of pending) if (cel.link !== undefined) (cels[cel.frame] ??= [])[cel.layer] = cels[cel.link]?.[cel.layer];

  // 그룹을 풀고, 숨긴 그룹 안의 레이어는 숨긴 채로
  const hiddenAt: boolean[] = [];
  const kept: { index: number; layer: AseLayer }[] = [];
  layers.forEach((l, i) => {
    hiddenAt.length = l.level;
    const parentHidden = hiddenAt.some(Boolean);
    if (l.group) {
      hiddenAt[l.level] = !l.visible;
      return;
    }
    kept.push({ index: i, layer: { ...l, visible: l.visible && !parentHidden } });
  });
  if (!kept.length) throw new Error("그릴 수 있는 레이어가 없는 파일이에요.");
  if (kept.length > MAX_LAYERS) notes.push(`레이어가 많아서 ${MAX_LAYERS}개만 가져왔어요`);
  if (frames.length > MAX_FRAMES) notes.push(`프레임이 많아서 ${MAX_FRAMES}장만 가져왔어요`);
  const layersOut = kept.slice(0, MAX_LAYERS);
  const framesOut = frames.slice(0, MAX_FRAMES);
  const b64 = (d: Uint8ClampedArray | undefined) => {
    if (!d) return "";
    let s = "";
    for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const pal = palette.filter((c, i) => c && !(depth === 8 && i === transparentIndex && c[3] === 0)).map(([r, g, b]) => hex(r, g, b));
  const json = JSON.stringify({
    format: "npixel",
    version: 2,
    width: W,
    height: H,
    active: layersOut.length - 1,
    frame: 0,
    palette: pal.length ? [...new Set(pal)].slice(0, 256) : undefined,
    frames: framesOut,
    tags: tags.filter((t) => t.from < framesOut.length),
    layers: layersOut.map(({ index, layer }) => ({
      name: layer.name,
      visible: layer.visible,
      opacity: Math.round((layer.opacity / 255) * 100),
      locked: layer.locked,
      cels: framesOut.map((_, f) => b64(cels[f]?.[index])),
    })),
  });
  return { json, notes };
}

// ───────────── 쓰기 ─────────────

class Out {
  private parts: Uint8Array[] = [];
  length = 0;
  push(b: Uint8Array) {
    this.parts.push(b);
    this.length += b.length;
  }
  result() {
    const out = new Uint8Array(this.length);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}

class Buf {
  bytes: number[] = [];
  u8(v: number) {
    this.bytes.push(v & 255);
  }
  u16(v: number) {
    this.u8(v);
    this.u8(v >> 8);
  }
  i16(v: number) {
    this.u16(v & 0xffff);
  }
  u32(v: number) {
    this.u16(v & 0xffff);
    this.u16((v >>> 16) & 0xffff);
  }
  zeros(n: number) {
    for (let i = 0; i < n; i++) this.u8(0);
  }
  str(s: string) {
    const b = new TextEncoder().encode(s);
    this.u16(b.length);
    for (const x of b) this.u8(x);
  }
  done() {
    return Uint8Array.from(this.bytes);
  }
}

const chunk = (type: number, body: Uint8Array) => {
  const head = new Buf();
  head.u32(body.length + 6);
  head.u16(type);
  const h = head.done();
  const out = new Uint8Array(h.length + body.length);
  out.set(h);
  out.set(body, h.length);
  return out;
};

export async function writeAseprite(doc: PixelDoc): Promise<Uint8Array> {
  const W = doc.width;
  const H = doc.height;
  const frames: Uint8Array[] = [];
  for (let f = 0; f < doc.frames.length; f++) {
    const chunks: Uint8Array[] = [];
    if (f === 0) {
      // 팔레트
      const pal = new Buf();
      const colors = doc.palette.length ? doc.palette : ["#000000"];
      pal.u32(colors.length);
      pal.u32(0);
      pal.u32(colors.length - 1);
      pal.zeros(8);
      for (const c of colors) {
        pal.u16(0);
        pal.u8(parseInt(c.slice(1, 3), 16));
        pal.u8(parseInt(c.slice(3, 5), 16));
        pal.u8(parseInt(c.slice(5, 7), 16));
        pal.u8(255);
      }
      chunks.push(chunk(0x2019, pal.done()));
      for (const l of doc.layers) {
        const b = new Buf();
        b.u16((l.visible ? 1 : 0) | (l.locked ? 0 : 2));
        b.u16(0);
        b.u16(0);
        b.u16(0);
        b.u16(0);
        b.u16(0);
        b.u8(Math.round((l.opacity / 100) * 255));
        b.zeros(3);
        b.str(l.name);
        chunks.push(chunk(0x2004, b.done()));
      }
      if (doc.tags.length) {
        const b = new Buf();
        b.u16(doc.tags.length);
        b.zeros(8);
        for (const t of doc.tags) {
          b.u16(t.from);
          b.u16(t.to);
          b.u8(t.direction === "reverse" ? 1 : t.direction === "pingpong" ? 2 : 0);
          b.u16(0);
          b.zeros(6);
          b.u8(parseInt(t.color.slice(1, 3), 16));
          b.u8(parseInt(t.color.slice(3, 5), 16));
          b.u8(parseInt(t.color.slice(5, 7), 16));
          b.u8(0);
          b.str(t.name);
        }
        chunks.push(chunk(0x2018, b.done()));
      }
    }
    for (let li = 0; li < doc.layers.length; li++) {
      const d = doc.layers[li].cels[f].data;
      // 투명하지 않은 곳만 잘라서
      let x0 = W;
      let y0 = H;
      let x1 = -1;
      let y1 = -1;
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++)
          if (d[(y * W + x) * 4 + 3]) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
      if (x1 < 0) continue;
      const w = x1 - x0 + 1;
      const h = y1 - y0 + 1;
      const px = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) px.set(d.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x0 + w) * 4), y * w * 4);
      const z = await deflate(px);
      const b = new Buf();
      b.u16(li);
      b.i16(x0);
      b.i16(y0);
      b.u8(255);
      b.u16(2);
      b.i16(0);
      b.zeros(5);
      b.u16(w);
      b.u16(h);
      const head = b.done();
      const body = new Uint8Array(head.length + z.length);
      body.set(head);
      body.set(z, head.length);
      chunks.push(chunk(0x2005, body));
    }
    const size = chunks.reduce((n, c) => n + c.length, 16);
    const fh = new Buf();
    fh.u32(size);
    fh.u16(0xf1fa);
    fh.u16(Math.min(0xffff, chunks.length));
    fh.u16(doc.frames[f].duration);
    fh.zeros(2);
    fh.u32(chunks.length);
    const out = new Out();
    out.push(fh.done());
    chunks.forEach((c) => out.push(c));
    frames.push(out.result());
  }
  const total = frames.reduce((n, f) => n + f.length, 128);
  const h = new Buf();
  h.u32(total);
  h.u16(0xa5e0);
  h.u16(doc.frames.length);
  h.u16(W);
  h.u16(H);
  h.u16(32);
  h.u32(1);
  h.u16(100);
  h.u32(0);
  h.u32(0);
  h.u8(0);
  h.zeros(3);
  h.u16(doc.palette.length);
  h.u8(1);
  h.u8(1);
  h.i16(0);
  h.i16(0);
  h.u16(16);
  h.u16(16);
  h.zeros(84);
  const out = new Out();
  out.push(h.done());
  frames.forEach((f) => out.push(f));
  return out.result();
}
