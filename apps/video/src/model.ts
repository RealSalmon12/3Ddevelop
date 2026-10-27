// 바코 오로라 프로젝트 (프리미어 프로식 시퀀스)
// 미디어(영상, 사진, 소리)는 디스크의 파일을 가리키기만 하고, 타임라인의 클립이 그 일부를 어느 트랙 어느 시간에 놓을지 정한다.

export type MediaKind = "video" | "image" | "audio";

export interface MediaItem {
  id: string;
  kind: MediaKind;
  name: string;
  /** 디스크 경로 */
  path: string;
  /** 원래 길이 (초). 사진은 0 */
  duration: number;
  width: number;
  height: number;
  /** 영상에 소리가 있는지 (모르면 true) */
  hasAudio: boolean;
}

/** 시간에 따라 바꿀 수 있는 값. keys 가 있으면 키프레임 사이를 이어서 쓴다. t 는 클립 시작부터의 초. */
export interface Param {
  value: number;
  keys?: { t: number; v: number }[];
}

export type ParamName = "x" | "y" | "scale" | "rotation" | "opacity" | "volume";

export interface ColorSettings {
  /** 모두 0 이 기본. -100 ~ 100 */
  exposure: number;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
  /** 0 ~ 100 */
  vignette: number;
  /** 흐림 (px, 0 ~ 40) */
  blur: number;
}

export interface TextStyle {
  text: string;
  font: string;
  size: number;
  color: string;
  bold: boolean;
  /** 테두리 두께 (0 이면 없음) */
  stroke: number;
  strokeColor: string;
  /** 글자 뒤 띠 */
  box: boolean;
  boxColor: string;
  align: "left" | "center" | "right";
}

export type ClipKind = MediaKind | "text" | "color";

export interface Clip {
  id: string;
  kind: ClipKind;
  /** 영상, 사진, 소리 클립일 때 */
  mediaId?: string;
  name: string;
  track: string;
  /** 타임라인에서 시작하는 시간 (초) */
  start: number;
  /** 원본에서 쓸 부분 (초). 사진, 글자, 색은 in 0, out 이 보이는 길이 */
  in: number;
  out: number;
  /** 재생 속도 (1 = 그대로) */
  speed: number;
  params: Record<ParamName, Param>;
  color: ColorSettings;
  /** 페이드 (초): 검게/조용히 시작하고 끝나기 */
  fadeIn: number;
  fadeOut: number;
  text?: TextStyle;
  /** 색 매트일 때 색 */
  fill?: string;
}

export interface Track {
  id: string;
  kind: "video" | "audio";
  name: string;
  muted: boolean;
  solo: boolean;
  hidden: boolean;
  locked: boolean;
}

export interface Marker {
  id: string;
  t: number;
  label: string;
  color: string;
}

export interface Sequence {
  width: number;
  height: number;
  fps: number;
}

export interface Project {
  app: "video";
  version: 2;
  sequence: Sequence;
  media: MediaItem[];
  /** 위에서 아래 순서: 영상 트랙(위가 앞에 보인다) 다음 소리 트랙 */
  tracks: Track[];
  clips: Clip[];
  markers: Marker[];
  /** 내보내기 범위 (I, O) */
  inPoint: number | null;
  outPoint: number | null;
}

export const SEQUENCE_PRESETS: { label: string; sequence: Sequence }[] = [
  { label: "유튜브 1080p (1920×1080)", sequence: { width: 1920, height: 1080, fps: 30 } },
  { label: "유튜브 1080p 60fps", sequence: { width: 1920, height: 1080, fps: 60 } },
  { label: "4K UHD (3840×2160)", sequence: { width: 3840, height: 2160, fps: 30 } },
  { label: "쇼츠·릴스·틱톡 (1080×1920)", sequence: { width: 1080, height: 1920, fps: 30 } },
  { label: "정사각형 (1080×1080)", sequence: { width: 1080, height: 1080, fps: 30 } },
  { label: "720p (1280×720)", sequence: { width: 1280, height: 720, fps: 30 } },
];

export const newId = () => crypto.randomUUID().slice(0, 8);

export function emptyProject(sequence: Sequence = SEQUENCE_PRESETS[0].sequence): Project {
  const track = (kind: Track["kind"], name: string): Track => ({ id: newId(), kind, name, muted: false, solo: false, hidden: false, locked: false });
  return {
    app: "video",
    version: 2,
    sequence,
    media: [],
    tracks: [track("video", "V3"), track("video", "V2"), track("video", "V1"), track("audio", "A1"), track("audio", "A2"), track("audio", "A3")],
    clips: [],
    markers: [],
    inPoint: null,
    outPoint: null,
  };
}

export const NEUTRAL_COLOR: ColorSettings = { exposure: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, vignette: 0, blur: 0 };

export const defaultParams = (): Record<ParamName, Param> => ({
  x: { value: 0 },
  y: { value: 0 },
  scale: { value: 100 },
  rotation: { value: 0 },
  opacity: { value: 100 },
  volume: { value: 100 },
});

export const DEFAULT_TEXT: TextStyle = {
  text: "제목을 입력하세요",
  font: "Pretendard Variable",
  size: 110,
  color: "#ffffff",
  bold: true,
  stroke: 10,
  strokeColor: "#000000",
  box: false,
  boxColor: "#000000",
  align: "center",
};

/** 사진, 글자, 색 매트를 처음 놓을 때의 길이 */
export const STILL_SECONDS = 5;

/** 원본 길이에 끝이 없는 클립 (사진, 글자, 색 매트) */
export const isStill = (c: { kind: ClipKind }) => c.kind === "image" || c.kind === "text" || c.kind === "color";
export const isVisual = (c: { kind: ClipKind }) => c.kind !== "audio";

/** 타임라인에서 차지하는 길이 */
export const clipDuration = (c: Clip) => Math.max(1 / 120, (c.out - c.in) / c.speed);
export const clipEnd = (c: Clip) => c.start + clipDuration(c);

export const projectDuration = (p: Project) => p.clips.reduce((n, c) => Math.max(n, clipEnd(c)), 0);

/** 타임라인 시간 t 에서 원본의 몇 초를 보여야 하는지 */
export const sourceTime = (c: Clip, t: number) => c.in + (t - c.start) * c.speed;

/** 키프레임 사이를 부드럽게 (가속, 감속) 잇는다. */
export function evalParam(p: Param, local: number): number {
  const keys = p.keys;
  if (!keys || keys.length === 0) return p.value;
  if (local <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (local >= last.t) return last.v;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (local >= a.t && local <= b.t) {
      const u = (local - a.t) / Math.max(b.t - a.t, 1e-6);
      const eased = u * u * (3 - 2 * u);
      return a.v + (b.v - a.v) * eased;
    }
  }
  return last.v;
}

/** 값 바꾸기. 키프레임을 쓰는 값이면 그 시간에 키프레임을 넣거나 고친다. */
export function setParam(p: Param, local: number, v: number): Param {
  if (!p.keys) return { value: v };
  const keys = p.keys.filter((k) => Math.abs(k.t - local) > 1 / 240);
  keys.push({ t: local, v });
  keys.sort((a, b) => a.t - b.t);
  return { value: v, keys };
}

/** 스톱워치: 키프레임 쓰기를 켜면 지금 값으로 첫 키프레임을 만들고, 끄면 지금 값 하나로 돌아간다. */
export function toggleKeys(p: Param, local: number): Param {
  const now = evalParam(p, local);
  return p.keys ? { value: now } : { value: now, keys: [{ t: local, v: now }] };
}

/** 클립 시작 시간을 바꾸지 않고 앞부분을 잘라 내면 키프레임 시간도 그만큼 당긴다. */
export function shiftKeys(params: Record<ParamName, Param>, dt: number): Record<ParamName, Param> {
  const out = { ...params };
  for (const k of Object.keys(out) as ParamName[]) {
    const keys = out[k].keys;
    if (keys) out[k] = { ...out[k], keys: keys.map((key) => ({ ...key, t: key.t - dt })) };
  }
  return out;
}

/** 페이드를 반영한 0~1 배율 */
export function fadeFactor(c: Clip, t: number): number {
  const local = t - c.start;
  const dur = clipDuration(c);
  let f = 1;
  if (c.fadeIn > 0 && local < c.fadeIn) f = Math.min(f, local / c.fadeIn);
  if (c.fadeOut > 0 && local > dur - c.fadeOut) f = Math.min(f, (dur - local) / c.fadeOut);
  return Math.max(0, Math.min(1, f));
}

/** 시간 t 에 화면에 나와야 하는 클립들 (아래 트랙부터) */
export function activeClips(p: Project, t: number, kind: "visual" | "audible"): Clip[] {
  const order = new Map(p.tracks.map((tr, i) => [tr.id, i]));
  const tracks = new Map(p.tracks.map((tr) => [tr.id, tr]));
  const anySolo = p.tracks.some((tr) => tr.kind === "audio" && tr.solo);
  return p.clips
    .filter((c) => t >= c.start && t < clipEnd(c))
    .filter((c) => {
      const tr = tracks.get(c.track);
      if (!tr) return false;
      if (kind === "visual") return isVisual(c) && !tr.hidden;
      if (!(c.kind === "audio" || c.kind === "video")) return false;
      if (tr.kind === "audio") return !tr.muted && (!anySolo || tr.solo);
      return !tr.muted && !anySolo;
    })
    .sort((a, b) => order.get(b.track)! - order.get(a.track)!);
}

export function timecode(sec: number, fps: number) {
  const total = Math.max(0, Math.round(sec * fps));
  const f = total % fps;
  const s = Math.floor(total / fps);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(f)}`;
}

/** 디스크 경로를 <video src> 에 넣을 수 있는 주소로 */
export function fileUrl(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const withRoot = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return `file://${encodeURI(withRoot).replace(/#/g, "%23").replace(/\?/g, "%3F")}`;
}

/**
 * 덮어쓰기: 트랙의 [from, to) 를 비운다. 걸친 클립은 잘라 내고, 가운데가 비면 둘로 나눈다.
 * 프리미어처럼 클립을 다른 클립 위로 옮기면 밑에 있던 부분이 지워진다.
 */
export function clearRange(clips: Clip[], track: string, from: number, to: number, except?: Set<string>): Clip[] {
  const out: Clip[] = [];
  for (const c of clips) {
    if (c.track !== track || except?.has(c.id) || clipEnd(c) <= from + 1e-6 || c.start >= to - 1e-6) {
      out.push(c);
      continue;
    }
    if (c.start < from) out.push(trimEnd(c, from));
    if (clipEnd(c) > to) out.push({ ...trimStart(c, to), id: c.start < from ? newId() : c.id });
  }
  return out;
}

/** 클립 끝을 타임라인 시간 t 에서 자른다. */
export function trimEnd(c: Clip, t: number): Clip {
  return { ...c, out: c.in + (t - c.start) * c.speed, fadeOut: Math.min(c.fadeOut, t - c.start) };
}

/** 클립 앞을 타임라인 시간 t 에서 자른다. */
export function trimStart(c: Clip, t: number): Clip {
  const dt = t - c.start;
  return { ...c, start: t, in: c.in + dt * c.speed, params: shiftKeys(c.params, dt), fadeIn: Math.max(0, c.fadeIn - dt) };
}

/** 타임라인 시간 t 에서 클립을 둘로 나눈다. */
export function splitClip(c: Clip, t: number): [Clip, Clip] | null {
  if (t <= c.start + 1 / 60 || t >= clipEnd(c) - 1 / 60) return null;
  return [{ ...trimEnd(c, t), fadeOut: 0 }, { ...trimStart(c, t), id: newId(), fadeIn: 0 }];
}

/** 색 보정 한 번에 고르기 (루메트리 프리셋 같은 것) */
export const LOOKS: { label: string; color: Partial<ColorSettings> }[] = [
  { label: "원래대로", color: NEUTRAL_COLOR },
  { label: "따뜻하게", color: { temperature: 35, saturation: 10, exposure: 3 } },
  { label: "시원하게", color: { temperature: -35, tint: -5, contrast: 5 } },
  { label: "선명하게", color: { contrast: 25, saturation: 25 } },
  { label: "영화처럼", color: { contrast: 20, saturation: -15, temperature: 10, vignette: 40 } },
  { label: "빈티지", color: { contrast: -10, saturation: -30, temperature: 30, vignette: 55, exposure: 4 } },
  { label: "흑백", color: { saturation: -100, contrast: 15 } },
  { label: "꿈결", color: { exposure: 10, contrast: -15, blur: 2, saturation: 10 } },
];
