/**
 * 프레임을 하나씩 받아 WebM 영상(VP9, 안 되면 VP8)으로 만든다.
 * 화면 녹화(MediaRecorder)와 달리 프레임마다 정확한 시간을 붙여서, 느린 PC 에서도 빠지는 프레임 없이 제 속도로 나온다.
 *
 *   const enc = await createWebmEncoder({ width, height, fps });
 *   for (...) await enc.add(canvas);
 *   const bytes = await enc.finish();
 */

export interface WebmOptions {
  width: number;
  height: number;
  fps: number;
  /** 비트/초 (없으면 크기와 fps 로 정한다) */
  bitrate?: number;
}

export interface WebmEncoder {
  /** 다음 프레임 */
  add(source: CanvasImageSource): Promise<void>;
  finish(): Promise<Uint8Array>;
  readonly codec: string;
}

const CODECS: { config: string; id: string }[] = [
  { config: "vp09.00.10.08", id: "V_VP9" },
  { config: "vp8", id: "V_VP8" },
];

export const canEncodeWebm = () => typeof VideoEncoder !== "undefined";

export async function createWebmEncoder(opts: WebmOptions): Promise<WebmEncoder> {
  if (!canEncodeWebm()) throw new Error("이 컴퓨터에서는 영상을 만들 수 없어요 (VideoEncoder 없음).");
  const width = opts.width & ~1;
  const height = opts.height & ~1;
  const bitrate = opts.bitrate ?? Math.round(Math.min(40_000_000, width * height * opts.fps * 0.2));
  let chosen: (typeof CODECS)[number] | null = null;
  for (const c of CODECS) {
    const s = await VideoEncoder.isConfigSupported({ codec: c.config, width, height, bitrate, framerate: opts.fps });
    if (s.supported) {
      chosen = c;
      break;
    }
  }
  if (!chosen) throw new Error("이 컴퓨터에서는 VP9/VP8 영상을 만들 수 없어요.");

  const chunks: { data: Uint8Array; ms: number; key: boolean }[] = [];
  let failure: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push({ data, ms: Math.round(chunk.timestamp / 1000), key: chunk.type === "key" });
    },
    error: (e) => (failure = e),
  });
  encoder.configure({ codec: chosen.config, width, height, bitrate, framerate: opts.fps });
  const frameUs = 1_000_000 / opts.fps;
  let index = 0;

  return {
    codec: chosen.id,
    async add(source) {
      if (failure) throw failure;
      // 인코더가 밀리면 잠깐 기다린다 (메모리가 끝없이 늘지 않게)
      while (encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 1));
      const frame = new VideoFrame(source, { timestamp: Math.round(index * frameUs), duration: Math.round(frameUs) });
      // 2초마다 키 프레임 (앞뒤로 옮겨 보기 좋게)
      encoder.encode(frame, { keyFrame: index % Math.max(1, Math.round(opts.fps * 2)) === 0 });
      frame.close();
      index++;
    },
    async finish() {
      await encoder.flush();
      encoder.close();
      if (failure) throw failure;
      return muxWebm(chunks, { width, height, codecId: chosen!.id, durationMs: (index * 1000) / opts.fps });
    },
  };
}

/* ───────── WebM (Matroska) 묶기 ───────── */

type El = Uint8Array;

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

const idBytes = (id: number) => {
  const b: number[] = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) b.unshift(v & 255);
  return new Uint8Array(b);
};

/** 크기: 늘 8바이트로 (계산이 단순하다) */
const sizeBytes = (n: number) => {
  const b = new Uint8Array(8);
  b[0] = 0x01;
  for (let i = 7, v = n; i >= 1; i--, v = Math.floor(v / 256)) b[i] = v & 255;
  return b;
};

const el = (id: number, ...children: Uint8Array[]): El => {
  const body = concat(children);
  return concat([idBytes(id), sizeBytes(body.length), body]);
};

const uint = (id: number, v: number) => {
  const b: number[] = [];
  for (let x = v; x > 0 || !b.length; x = Math.floor(x / 256)) b.unshift(x & 255);
  return el(id, new Uint8Array(b));
};

const str = (id: number, s: string) => el(id, new TextEncoder().encode(s));

const float = (id: number, v: number) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, v);
  return el(id, b);
};

function muxWebm(
  frames: { data: Uint8Array; ms: number; key: boolean }[],
  o: { width: number; height: number; codecId: string; durationMs: number },
): Uint8Array {
  frames.sort((a, b) => a.ms - b.ms);
  const header = el(
    0x1a45dfa3,
    uint(0x4286, 1),
    uint(0x42f7, 1),
    uint(0x42f2, 4),
    uint(0x42f3, 8),
    str(0x4282, "webm"),
    uint(0x4287, 4),
    uint(0x4285, 2),
  );
  const info = el(0x1549a966, uint(0x2ad7b1, 1_000_000), str(0x4d80, "Baco Studio"), str(0x5741, "Baco Studio"), float(0x4489, o.durationMs));
  const tracks = el(
    0x1654ae6b,
    el(0xae, uint(0xd7, 1), uint(0x73c5, 1), uint(0x83, 1), str(0x86, o.codecId), uint(0x9c, 0), el(0xe0, uint(0xb0, o.width), uint(0xba, o.height))),
  );
  // 키 프레임마다 새 묶음(클러스터)을 시작한다. 묶음 안 시간은 16비트라 30초를 넘기지 않게.
  const clusters: { ms: number; blocks: Uint8Array[] }[] = [];
  for (const f of frames) {
    const cur = clusters[clusters.length - 1];
    if (!cur || f.key || f.ms - cur.ms > 30000) clusters.push({ ms: f.ms, blocks: [] });
    const c = clusters[clusters.length - 1];
    const head = new Uint8Array(4);
    head[0] = 0x81; // 트랙 1
    new DataView(head.buffer).setInt16(1, f.ms - c.ms);
    head[3] = f.key ? 0x80 : 0;
    c.blocks.push(el(0xa3, head, f.data));
  }
  const clusterEls = clusters.map((c) => el(0x1f43b675, uint(0xe7, c.ms), ...c.blocks));
  // 찾아가기 표 (Cues): 클러스터 위치는 Segment 내용 처음부터 센다
  let pos = info.length + tracks.length;
  const cuePoints = clusterEls.map((c, i) => {
    const p = el(0xbb, uint(0xb3, clusters[i].ms), el(0xb7, uint(0xf7, 1), uint(0xf1, pos)));
    pos += c.length;
    return p;
  });
  const cues = el(0x1c53bb6b, ...cuePoints);
  const segment = el(0x18538067, info, tracks, ...clusterEls, cues);
  return concat([header, segment]);
}
