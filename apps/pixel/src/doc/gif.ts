// 움직이는 GIF 만들기. 픽셀 아트는 색이 적어서 팔레트 하나(최대 255색 + 투명)로 충분하다.
// 255색이 넘으면 6×7×6 단계로 줄인다.

interface GifFrame {
  data: Uint8ClampedArray;
  /** ms */
  delay: number;
}

class Bytes {
  private buf = new Uint8Array(1 << 16);
  length = 0;
  byte(b: number) {
    if (this.length >= this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.length++] = b;
  }
  word(w: number) {
    this.byte(w & 255);
    this.byte((w >> 8) & 255);
  }
  str(s: string) {
    for (const c of s) this.byte(c.charCodeAt(0));
  }
  bytes(b: ArrayLike<number>) {
    for (let i = 0; i < b.length; i++) this.byte(b[i]);
  }
  result() {
    return this.buf.slice(0, this.length);
  }
}

function lzw(indices: Uint8Array, minCode: number, out: Bytes) {
  out.byte(minCode);
  const clear = 1 << minCode;
  const eoi = clear + 1;
  let codeSize = minCode + 1;
  let next = eoi + 1;
  let dict = new Map<number, number>();
  let cur = 0;
  let bits = 0;
  const block: number[] = [];
  const emit = (code: number) => {
    cur |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      block.push(cur & 255);
      cur >>>= 8;
      bits -= 8;
      if (block.length === 255) {
        out.byte(255);
        out.bytes(block);
        block.length = 0;
      }
    }
  };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const hit = dict.get(key);
    if (hit !== undefined) {
      prefix = hit;
      continue;
    }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > 1 << codeSize && codeSize < 12) codeSize++;
    } else {
      emit(clear);
      dict = new Map();
      codeSize = minCode + 1;
      next = eoi + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) block.push(cur & 255);
  if (block.length) {
    out.byte(block.length);
    out.bytes(block);
  }
  out.byte(0);
}

export function encodeGif(width: number, height: number, frames: GifFrame[]): Uint8Array {
  const colors = new Map<number, number>();
  for (const f of frames)
    for (let i = 0; i < f.data.length; i += 4) if (f.data[i + 3] >= 128) colors.set((f.data[i] << 16) | (f.data[i + 1] << 8) | f.data[i + 2], 0);
  const reduce = colors.size > 255;
  const keyOf = (r: number, g: number, b: number) =>
    reduce ? (Math.round((r / 255) * 5) * 7 + Math.round((g / 255) * 6)) * 6 + Math.round((b / 255) * 5) : (r << 16) | (g << 8) | b;
  const table: number[] = [0, 0, 0];
  const index = new Map<number, number>();
  if (reduce) {
    for (let r = 0; r < 6; r++)
      for (let g = 0; g < 7; g++)
        for (let b = 0; b < 6; b++) {
          index.set((r * 7 + g) * 6 + b, table.length / 3);
          table.push(Math.round((r / 5) * 255), Math.round((g / 6) * 255), Math.round((b / 5) * 255));
        }
  } else
    for (const k of colors.keys()) {
      index.set(k, table.length / 3);
      table.push((k >> 16) & 255, (k >> 8) & 255, k & 255);
    }
  let bitsPer = 1;
  while (1 << bitsPer < table.length / 3) bitsPer++;
  while (table.length < (1 << bitsPer) * 3) table.push(0);

  const out = new Bytes();
  out.str("GIF89a");
  out.word(width);
  out.word(height);
  out.byte(0x80 | ((bitsPer - 1) << 4) | (bitsPer - 1));
  out.byte(0);
  out.byte(0);
  out.bytes(table);
  // 무한 반복
  out.bytes([0x21, 0xff, 0x0b]);
  out.str("NETSCAPE2.0");
  out.bytes([3, 1, 0, 0, 0]);
  for (const f of frames) {
    out.bytes([0x21, 0xf9, 4, (2 << 2) | 1]);
    out.word(Math.max(2, Math.round(f.delay / 10)));
    out.byte(0);
    out.byte(0);
    out.byte(0x2c);
    out.word(0);
    out.word(0);
    out.word(width);
    out.word(height);
    out.byte(0);
    const px = new Uint8Array(width * height);
    for (let i = 0; i < px.length; i++) {
      const o = i * 4;
      px[i] = f.data[o + 3] < 128 ? 0 : index.get(keyOf(f.data[o], f.data[o + 1], f.data[o + 2]))!;
    }
    lzw(px, Math.max(2, bitsPer), out);
  }
  out.byte(0x3b);
  return out.result();
}
