import { fileUrl, newId, type MediaItem, type MediaKind } from "./model";

export const MEDIA_EXTENSIONS = {
  video: ["mp4", "webm", "mov", "mkv", "m4v"],
  image: ["png", "jpg", "jpeg", "gif", "webp", "bmp"],
  audio: ["mp3", "wav", "ogg", "m4a", "aac", "flac", "opus"],
};

export const MEDIA_FILTER = { name: "영상, 사진, 소리", extensions: Object.values(MEDIA_EXTENSIONS).flat() };

export function kindOf(path: string): MediaKind | null {
  const ext = path.split(".").pop()!.toLowerCase();
  for (const [kind, list] of Object.entries(MEDIA_EXTENSIONS)) if (list.includes(ext)) return kind as MediaKind;
  return null;
}

const baseName = (path: string) => path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");

/** 파일을 열어 길이, 크기를 읽는다. 못 열면 오류. */
export async function probeMedia(path: string): Promise<MediaItem> {
  const kind = kindOf(path);
  if (!kind) throw new Error("지원하지 않는 파일이에요");
  const url = fileUrl(path);
  const base = { id: newId(), kind, name: baseName(path), path, hasAudio: kind !== "image" };
  if (kind === "image") {
    const img = await loadImage(url);
    return { ...base, duration: 0, width: img.naturalWidth, height: img.naturalHeight };
  }
  const el = document.createElement(kind === "video" ? "video" : "audio");
  el.preload = "metadata";
  el.src = url;
  await new Promise<void>((resolve, reject) => {
    el.onloadedmetadata = () => resolve();
    el.onerror = () => reject(new Error("파일을 읽을 수 없어요"));
  });
  const v = el as HTMLVideoElement;
  return {
    ...base,
    duration: Number.isFinite(el.duration) ? el.duration : 10,
    width: kind === "video" ? v.videoWidth : 0,
    height: kind === "video" ? v.videoHeight : 0,
  };
}

export function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("사진을 읽을 수 없어요"));
    img.src = url;
  });
}

const thumbs = new Map<string, Promise<string | null>>();

/** 작은 미리보기 그림 (data: 주소). 소리는 null. */
export function thumbnail(m: MediaItem): Promise<string | null> {
  if (!thumbs.has(m.id)) thumbs.set(m.id, makeThumb(m).catch(() => null));
  return thumbs.get(m.id)!;
}

async function makeThumb(m: MediaItem): Promise<string | null> {
  if (m.kind === "audio") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 90;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 160, 90);
  let source: CanvasImageSource;
  let w: number;
  let h: number;
  if (m.kind === "image") {
    const img = await loadImage(fileUrl(m.path));
    source = img;
    w = img.naturalWidth;
    h = img.naturalHeight;
  } else {
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    v.src = fileUrl(m.path);
    await new Promise<void>((resolve, reject) => {
      v.onloadeddata = () => resolve();
      v.onerror = () => reject(new Error("thumb"));
    });
    v.currentTime = Math.min(1, m.duration / 3);
    await new Promise<void>((resolve) => (v.onseeked = () => resolve()));
    source = v;
    w = v.videoWidth;
    h = v.videoHeight;
  }
  const s = Math.max(160 / w, 90 / h);
  ctx.drawImage(source, (160 - w * s) / 2, (90 - h * s) / 2, w * s, h * s);
  return canvas.toDataURL("image/jpeg", 0.7);
}

const PEAKS_PER_SECOND = 50;
const peaks = new Map<string, Promise<Float32Array | null>>();

/** 소리 파형 (1초에 50칸, 0~1). 너무 큰 파일이나 소리가 없으면 null. */
export function waveform(m: MediaItem): Promise<Float32Array | null> {
  if (!peaks.has(m.id)) peaks.set(m.id, makePeaks(m).catch(() => null));
  return peaks.get(m.id)!;
}

async function makePeaks(m: MediaItem): Promise<Float32Array | null> {
  if (!m.hasAudio || !window.suite) return null;
  const bytes = await window.suite.files.read(m.path);
  if (!bytes || bytes.byteLength > 400 * 1024 * 1024) return null;
  const ac = new OfflineAudioContext(1, 1, 44100);
  const buffer = await ac.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const data = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(buffer.sampleRate / PEAKS_PER_SECOND));
  const out = new Float32Array(Math.ceil(data.length / step));
  let max = 0;
  for (let i = 0; i < out.length; i++) {
    let peak = 0;
    for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j++) peak = Math.max(peak, Math.abs(data[j]));
    out[i] = peak;
    max = Math.max(max, peak);
  }
  if (max > 0) for (let i = 0; i < out.length; i++) out[i] /= max;
  return out;
}

export { PEAKS_PER_SECOND };
