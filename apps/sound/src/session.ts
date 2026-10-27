/* 멀티트랙 세션: 오디션의 멀티트랙 화면처럼 여러 트랙에 소리 조각을 늘어놓고 섞는다. 원본 소리는 건드리지 않는다. */
import * as A from "./audio";
import { dbToGain, encodeWav } from "./dsp";
import { buildRack, newFx, type Fx } from "./effects";

export interface Source {
  id: string;
  name: string;
  sound: A.Sound;
  /** 디스크에서 불러온 파일이면 경로 (세션 파일에는 경로만 적는다) */
  path?: string;
  /** 그림용: PEAK_BLOCK 샘플마다 가장 큰 크기 */
  peaks: Float32Array;
}

export interface Clip {
  id: string;
  source: string;
  name: string;
  /** 타임라인에서 시작 (초) */
  start: number;
  /** 원본 안에서 어디부터 (초) */
  offset: number;
  length: number;
  gainDb: number;
  fadeIn: number;
  fadeOut: number;
}

export interface Track {
  id: string;
  name: string;
  color: string;
  volumeDb: number;
  /** -1 왼쪽 ~ 1 오른쪽 */
  pan: number;
  mute: boolean;
  solo: boolean;
  fx: Fx[];
  clips: Clip[];
}

export interface Session {
  tracks: Track[];
  sources: Record<string, Source>;
  masterDb: number;
  sampleRate: number;
}

export const PEAK_BLOCK = 256;
export const TRACK_COLORS = ["#4fb3ff", "#7fe0a8", "#ffc83d", "#ff8a65", "#c792ea", "#5ce1e6", "#ff7ab6", "#a5d65a"];

let counter = 0;
export const uid = (p: string) => `${p}${Date.now().toString(36)}${(++counter).toString(36)}`;

export function newTrack(index: number): Track {
  return { id: uid("t"), name: `트랙 ${index + 1}`, color: TRACK_COLORS[index % TRACK_COLORS.length], volumeDb: 0, pan: 0, mute: false, solo: false, fx: [], clips: [] };
}

export const emptySession = (): Session => ({ tracks: [0, 1, 2, 3].map(newTrack), sources: {}, masterDb: 0, sampleRate: 44100 });

export function makeSource(name: string, sound: A.Sound, path?: string): Source {
  const n = A.lengthOf(sound);
  const peaks = new Float32Array(Math.ceil(n / PEAK_BLOCK));
  for (const ch of sound.channels)
    for (let i = 0; i < n; i++) {
      const v = Math.abs(ch[i]);
      const b = (i / PEAK_BLOCK) | 0;
      if (v > peaks[b]) peaks[b] = v;
    }
  return { id: uid("s"), name, sound, path, peaks };
}

export const sourceSeconds = (s: Source) => A.secondsOf(s.sound);
export const clipEnd = (c: Clip) => c.start + c.length;
export const sessionLength = (s: Session) => Math.max(0, ...s.tracks.flatMap((t) => t.clips.map(clipEnd)));

export function clipFor(src: Source, start: number): Clip {
  return { id: uid("c"), source: src.id, name: src.name, start, offset: 0, length: sourceSeconds(src), gainDb: 0, fadeIn: 0, fadeOut: 0 };
}

/** 같은 트랙에 겹치지 않는 가장 가까운 자리를 찾지는 않고, 오디션처럼 겹쳐도 그냥 둔다 (위 조각이 이긴다) */
export function addClip(s: Session, trackId: string, clip: Clip): Session {
  return { ...s, tracks: s.tracks.map((t) => (t.id === trackId ? { ...t, clips: [...t.clips, clip] } : t)) };
}

export function updateClip(s: Session, clipId: string, patch: Partial<Clip>): Session {
  return { ...s, tracks: s.tracks.map((t) => (t.clips.some((c) => c.id === clipId) ? { ...t, clips: t.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)) } : t)) };
}

export function moveClip(s: Session, clipId: string, toTrack: string, start: number): Session {
  const found = findClip(s, clipId);
  if (!found) return s;
  const clip = { ...found.clip, start: Math.max(0, start) };
  const tracks = s.tracks.map((t) => {
    let clips = t.clips.filter((c) => c.id !== clipId);
    if (t.id === toTrack) clips = [...clips, clip];
    return clips.length === t.clips.length && t.id !== toTrack ? t : { ...t, clips };
  });
  return { ...s, tracks };
}

export function removeClip(s: Session, clipId: string): Session {
  return { ...s, tracks: s.tracks.map((t) => (t.clips.some((c) => c.id === clipId) ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) } : t)) };
}

export function findClip(s: Session, clipId: string | null) {
  for (const track of s.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

/** at 초에서 조각을 둘로 나눈다. 새로 생긴 오른쪽 조각의 id 를 돌려준다. */
export function splitClip(s: Session, clipId: string, at: number): [Session, string | null] {
  const found = findClip(s, clipId);
  if (!found) return [s, null];
  const { clip } = found;
  const cut = at - clip.start;
  if (cut <= 0.01 || cut >= clip.length - 0.01) return [s, null];
  const left: Clip = { ...clip, length: cut, fadeOut: 0, fadeIn: Math.min(clip.fadeIn, cut) };
  const right: Clip = { ...clip, id: uid("c"), start: at, offset: clip.offset + cut, length: clip.length - cut, fadeIn: 0, fadeOut: Math.min(clip.fadeOut, clip.length - cut) };
  return [{ ...s, tracks: s.tracks.map((t) => (t === found.track ? { ...t, clips: t.clips.flatMap((c) => (c.id === clipId ? [left, right] : [c])) } : t)) }, right.id];
}

export const updateTrack = (s: Session, id: string, patch: Partial<Track>): Session => ({ ...s, tracks: s.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) });

/** 쓰지 않는 원본을 치운다 (저장할 때) */
export function usedSources(s: Session) {
  const used = new Set(s.tracks.flatMap((t) => t.clips.map((c) => c.source)));
  return Object.values(s.sources).filter((src) => used.has(src.id));
}

/* ───────── 소리 길 (재생과 믹스다운이 같은 길을 쓴다) ───────── */

export interface TrackNodes {
  /** 조각들이 모이는 곳. 효과 랙을 바꿀 때 여기서 끊고 새 랙에 잇는다 */
  input: GainNode;
  chain: { input: AudioNode; output: AudioNode };
  vol: GainNode;
  pan: StereoPannerNode;
}

export interface Graph {
  sources: AudioBufferSourceNode[];
  master: GainNode;
  tracks: Map<string, TrackNodes>;
}

const buffers = new WeakMap<BaseAudioContext, WeakMap<A.Sound, AudioBuffer>>();
function bufferOf(ctx: BaseAudioContext, s: A.Sound) {
  let m = buffers.get(ctx);
  if (!m) buffers.set(ctx, (m = new WeakMap()));
  let b = m.get(s);
  if (!b) m.set(s, (b = A.toAudioBuffer(ctx, s)));
  return b;
}

/** 조각 안 t 초에서의 크기 (페이드 포함) */
export function envelope(c: Clip, t: number) {
  let g = dbToGain(c.gainDb);
  if (c.fadeIn > 0 && t < c.fadeIn) g *= Math.max(0, t / c.fadeIn);
  if (c.fadeOut > 0 && t > c.length - c.fadeOut) g *= Math.max(0, (c.length - t) / c.fadeOut);
  return g;
}

export const trackGain = (s: Session, t: Track) => (t.mute || (s.tracks.some((x) => x.solo) && !t.solo) ? 0 : dbToGain(t.volumeDb));

/** 재생 중에 랙만 바뀌었을 때: 소리는 끊지 않고 이음새만 바꾼다 */
export function swapRack(ctx: BaseAudioContext, nodes: TrackNodes, fx: Fx[]) {
  nodes.input.disconnect();
  nodes.chain.output.disconnect();
  nodes.chain = buildRack(ctx, fx);
  nodes.input.connect(nodes.chain.input);
  nodes.chain.output.connect(nodes.vol);
}

/** from 초부터 재생되도록 세션을 ctx 에 연결한다. dest 는 보통 ctx.destination */
export function buildGraph(ctx: BaseAudioContext, s: Session, from: number, dest: AudioNode, when = ctx.currentTime): Graph {
  const master = ctx.createGain();
  master.gain.value = dbToGain(s.masterDb);
  master.connect(dest);
  const sources: AudioBufferSourceNode[] = [];
  const tracks = new Map<string, TrackNodes>();
  for (const track of s.tracks) {
    const input = ctx.createGain();
    const vol = ctx.createGain();
    vol.gain.value = trackGain(s, track);
    const pan = ctx.createStereoPanner();
    pan.pan.value = track.pan;
    const chain = buildRack(ctx, track.fx);
    input.connect(chain.input);
    chain.output.connect(vol);
    vol.connect(pan);
    pan.connect(master);
    tracks.set(track.id, { input, chain, vol, pan });
    for (const clip of track.clips) {
      const src = s.sources[clip.source];
      if (!src || clipEnd(clip) <= from) continue;
      const node = ctx.createBufferSource();
      node.buffer = bufferOf(ctx, src.sound);
      const g = ctx.createGain();
      const skip = Math.max(0, from - clip.start);
      const at = when + Math.max(0, clip.start - from);
      // 페이드 꼭짓점마다 값을 찍고 그 사이는 직선으로
      const points = [clip.fadeIn, clip.length - clip.fadeOut, clip.length].filter((t) => t > skip && t <= clip.length).sort((a, b) => a - b);
      g.gain.setValueAtTime(envelope(clip, skip), at);
      for (const t of points) g.gain.linearRampToValueAtTime(envelope(clip, Math.min(t, clip.length - 1e-4)), at + (t - skip));
      node.connect(g);
      g.connect(input);
      node.start(at, clip.offset + skip, clip.length - skip);
      sources.push(node);
    }
  }
  return { sources, master, tracks };
}

/** 세션 전체를 한 소리로 굳힌다 (스테레오) */
export async function mixdown(s: Session, range?: { start: number; end: number }): Promise<A.Sound> {
  const start = range?.start ?? 0;
  const end = range?.end ?? sessionLength(s);
  // 리버브·딜레이 꼬리가 잘리지 않게 끝에 조금 더
  const tail = s.tracks.some((t) => t.fx.some((f) => f.on && (f.kind === "reverb" || f.kind === "delay"))) && !range ? 2 : 0;
  const frames = Math.max(1, Math.ceil((end - start + tail) * s.sampleRate));
  const ctx = new OfflineAudioContext(2, frames, s.sampleRate);
  buildGraph(ctx, { ...s, tracks: s.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.start < end) })) }, start, ctx.destination, 0);
  const out = await ctx.startRendering();
  return A.fromAudioBuffer(out);
}

/* ───────── 세션 파일 (.bses) ───────── */

interface SavedSource {
  id: string;
  name: string;
  path?: string;
  /** 경로가 없는 소리 (녹음, 파형 편집기에서 보낸 것) 는 32비트 WAV 를 base64 로 담는다 */
  wav?: string;
}

function toBase64(bytes: Uint8Array) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromBase64(text: string) {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function serialize(s: Session): string {
  const sources: SavedSource[] = usedSources(s).map((src) => (src.path ? { id: src.id, name: src.name, path: src.path } : { id: src.id, name: src.name, wav: toBase64(encodeWav(src.sound, 32)) }));
  return JSON.stringify({ format: "baco-pado-session", version: 1, sampleRate: s.sampleRate, masterDb: s.masterDb, tracks: s.tracks, sources });
}

/** decode: 파일 내용을 소리로. read: 경로로 파일 읽기 */
export async function deserialize(
  text: string,
  decode: (bytes: ArrayBuffer) => Promise<A.Sound>,
  read: (path: string) => Promise<Uint8Array | null>,
): Promise<{ session: Session; missing: string[] }> {
  const data = JSON.parse(text);
  if (data?.format !== "baco-pado-session") throw new Error("바코 파도 세션 파일이 아니에요.");
  const sources: Record<string, Source> = {};
  const missing: string[] = [];
  for (const saved of data.sources as SavedSource[]) {
    const bytes = saved.wav ? fromBase64(saved.wav) : saved.path ? await read(saved.path) : null;
    if (!bytes) {
      missing.push(saved.name);
      continue;
    }
    const src = makeSource(saved.name, await decode(bytes.slice().buffer), saved.path);
    sources[saved.id] = { ...src, id: saved.id };
  }
  const tracks = (data.tracks as Track[]).map((t) => ({ ...newTrack(0), ...t, fx: (t.fx ?? []).map((f) => ({ ...newFx(f.kind), ...f, id: newFx(f.kind).id })) as Fx[], clips: t.clips.filter((c) => sources[c.source]) }));
  return { session: { tracks, sources, masterDb: data.masterDb ?? 0, sampleRate: data.sampleRate ?? 44100 }, missing };
}
