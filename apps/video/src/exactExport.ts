/**
 * 정확 내보내기: 화면을 녹화하지 않고 프레임마다 그려서 바로 인코딩한다 (프리미어의 내보내기처럼).
 * 빠지는 프레임이 없고, 컴퓨터가 빠르면 영상 길이보다 빨리 끝난다.
 * 영상: H.264(MP4) 또는 VP9(WebM), 소리: Opus. 소리는 OfflineAudioContext 로 따로 섞는다.
 */
import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from "mp4-muxer";
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from "webm-muxer";
import type { Engine } from "./engine";
import type { Project } from "./model";

export type ExactFormat = "mp4" | "webm";

export const canExportExact = () => typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined";

const SAMPLE_RATE = 48000;

/** 크기, fps 에 맞는 H.264 수준 (4.0 은 1080p30 까지, 5.1 은 4K 까지) */
async function pickVideoCodec(format: ExactFormat, width: number, height: number, fps: number, bitrate: number) {
  const list =
    format === "mp4"
      ? width * height * fps <= 1920 * 1088 * 30
        ? ["avc1.640028", "avc1.640033"]
        : ["avc1.640033", "avc1.640034"]
      : ["vp09.00.40.08", "vp09.00.10.08", "vp8"];
  for (const codec of list) {
    const config: VideoEncoderConfig = { codec, width, height, bitrate, framerate: fps, ...(codec.startsWith("avc") ? { avc: { format: "avc" as const } } : {}) };
    if ((await VideoEncoder.isConfigSupported(config)).supported) return config;
  }
  return null;
}

export async function exportExact(
  engine: Engine,
  project: Project,
  opts: { format: ExactFormat; from: number; to: number; scale: number; videoBitsPerSecond: number },
  onProgress: (ratio: number) => void,
  signal: { cancel: boolean },
): Promise<Uint8Array | null> {
  const fps = project.sequence.fps;
  const width = Math.round(project.sequence.width * opts.scale) & ~1;
  const height = Math.round(project.sequence.height * opts.scale) & ~1;
  const config = await pickVideoCodec(opts.format, width, height, fps, opts.videoBitsPerSecond);
  if (!config) throw new Error(`이 컴퓨터에서는 ${opts.format.toUpperCase()} 영상을 만들 수 없어요. 다른 형식을 골라 주세요.`);

  // 1. 소리를 먼저 섞는다 (진행률 앞 10%)
  onProgress(0);
  const audio = await engine.mixAudio(opts.from, opts.to, SAMPLE_RATE);
  if (signal.cancel) return null;
  const hasSound = [0, 1].some((ch) => audio.getChannelData(ch).some((v) => v !== 0));
  onProgress(0.1);

  const muxer =
    opts.format === "mp4"
      ? new Mp4Muxer({
          target: new Mp4Target(),
          video: { codec: "avc", width, height, frameRate: fps },
          ...(hasSound ? { audio: { codec: "opus" as const, numberOfChannels: 2, sampleRate: SAMPLE_RATE } } : {}),
          fastStart: "in-memory",
          firstTimestampBehavior: "offset",
        })
      : new WebmMuxer({
          target: new WebmTarget(),
          video: { codec: config.codec.startsWith("vp8") ? "V_VP8" : "V_VP9", width, height, frameRate: fps },
          ...(hasSound ? { audio: { codec: "A_OPUS", numberOfChannels: 2, sampleRate: SAMPLE_RATE } } : {}),
          firstTimestampBehavior: "offset",
        });

  let failure: unknown = null;
  const videoEnc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => (failure = e) });
  videoEnc.configure(config);

  // 2. 소리 인코딩 (영상보다 훨씬 빨라서 먼저 다 넣는다)
  if (hasSound) {
    const audioEnc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => (failure = e) });
    audioEnc.configure({ codec: "opus", sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: 192_000 });
    const L = audio.getChannelData(0);
    const R = audio.getChannelData(1);
    const block = SAMPLE_RATE / 10;
    for (let at = 0; at < audio.length; at += block) {
      const n = Math.min(block, audio.length - at);
      const data = new Float32Array(n * 2);
      data.set(L.subarray(at, at + n), 0);
      data.set(R.subarray(at, at + n), n);
      const ad = new AudioData({ format: "f32-planar", sampleRate: SAMPLE_RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((at / SAMPLE_RATE) * 1e6), data });
      audioEnc.encode(ad);
      ad.close();
    }
    await audioEnc.flush();
    audioEnc.close();
  }

  // 3. 프레임마다 그려서 인코딩
  await engine.preloadStills(opts.from, opts.to);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const frames = Math.max(1, Math.round((opts.to - opts.from) * fps));
  const frameUs = 1e6 / fps;
  const keyEvery = Math.round(fps * 2);
  for (let i = 0; i < frames; i++) {
    if (signal.cancel || failure) break;
    await engine.renderAt(opts.from + (i + 0.0001) / fps, canvas, opts.scale);
    while (videoEnc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 1));
    const frame = new VideoFrame(canvas, { timestamp: Math.round(i * frameUs), duration: Math.round(frameUs) });
    videoEnc.encode(frame, { keyFrame: i % keyEvery === 0 });
    frame.close();
    onProgress(0.1 + (0.9 * (i + 1)) / frames);
  }
  if (failure) throw failure;
  if (signal.cancel) {
    videoEnc.close();
    return null;
  }
  await videoEnc.flush();
  videoEnc.close();
  muxer.finalize();
  return new Uint8Array(muxer.target.buffer);
}
