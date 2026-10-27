// 효과 랙: 오디션처럼 효과를 여러 개 이어 걸고, 재생하면서 바로 들어 본 뒤 ‘적용’ 하면 소리에 굳힌다.
// 같은 연결 함수로 실시간 재생(AudioContext)과 적용(OfflineAudioContext)을 모두 만든다.
import { lengthOf, type Range, type Sound } from "./audio";
import { dbToGain, replaceRange } from "./dsp";

export type BandType = "highpass" | "lowshelf" | "peaking" | "highshelf" | "lowpass" | "notch";
export interface Band {
  type: BandType;
  freq: number;
  gain: number;
  q: number;
  on: boolean;
}

export type Fx =
  | { id: string; kind: "eq"; on: boolean; bands: Band[] }
  | { id: string; kind: "compressor"; on: boolean; threshold: number; ratio: number; attack: number; release: number; knee: number; makeup: number }
  | { id: string; kind: "reverb"; on: boolean; size: number; decay: number; predelay: number; wet: number; dry: number }
  | { id: string; kind: "delay"; on: boolean; time: number; feedback: number; wet: number; pingpong: boolean }
  | { id: string; kind: "chorus"; on: boolean; rate: number; depth: number; wet: number }
  | { id: string; kind: "distortion"; on: boolean; drive: number; tone: number; wet: number }
  | { id: string; kind: "stereo"; on: boolean; pan: number; width: number }
  | { id: string; kind: "gain"; on: boolean; db: number };

export type FxKind = Fx["kind"];

export const FX_INFO: { kind: FxKind; label: string; icon: string; hint: string }[] = [
  { kind: "eq", label: "파라메트릭 EQ", icon: "≋", hint: "주파수마다 키우거나 줄여요 (저음, 중음, 고음)" },
  { kind: "compressor", label: "컴프레서", icon: "▥", hint: "큰 소리는 줄이고 작은 소리는 키워서 고르게" },
  { kind: "reverb", label: "리버브", icon: "◌", hint: "방, 홀, 동굴처럼 울림을 더해요" },
  { kind: "delay", label: "딜레이", icon: "⋯", hint: "메아리처럼 되풀이해요" },
  { kind: "chorus", label: "코러스", icon: "≈", hint: "여러 명이 같이 부르는 것처럼 넓게" },
  { kind: "distortion", label: "디스토션", icon: "⚡", hint: "지글지글 거칠게 (기타, 무전기)" },
  { kind: "stereo", label: "스테레오 / 팬", icon: "⇔", hint: "왼쪽 오른쪽 위치와 넓이" },
  { kind: "gain", label: "볼륨", icon: "🔊", hint: "전체 크기 (dB)" },
];

let counter = 0;
const id = () => `fx${++counter}`;

export const DEFAULT_BANDS: Band[] = [
  { type: "highpass", freq: 80, gain: 0, q: 0.7, on: false },
  { type: "lowshelf", freq: 150, gain: 0, q: 0.7, on: true },
  { type: "peaking", freq: 500, gain: 0, q: 1, on: true },
  { type: "peaking", freq: 2500, gain: 0, q: 1, on: true },
  { type: "highshelf", freq: 7000, gain: 0, q: 0.7, on: true },
  { type: "lowpass", freq: 16000, gain: 0, q: 0.7, on: false },
];

export function newFx(kind: FxKind): Fx {
  switch (kind) {
    case "eq":
      return { id: id(), kind, on: true, bands: DEFAULT_BANDS.map((b) => ({ ...b })) };
    case "compressor":
      return { id: id(), kind, on: true, threshold: -20, ratio: 4, attack: 10, release: 150, knee: 6, makeup: 4 };
    case "reverb":
      return { id: id(), kind, on: true, size: 1.8, decay: 2.5, predelay: 20, wet: 30, dry: 100 };
    case "delay":
      return { id: id(), kind, on: true, time: 300, feedback: 35, wet: 30, pingpong: false };
    case "chorus":
      return { id: id(), kind, on: true, rate: 1.2, depth: 4, wet: 50 };
    case "distortion":
      return { id: id(), kind, on: true, drive: 40, tone: 4000, wet: 100 };
    case "stereo":
      return { id: id(), kind, on: true, pan: 0, width: 100 };
    case "gain":
      return { id: id(), kind, on: true, db: 0 };
  }
}

/** 랙 미리 설정 */
export const RACK_PRESETS: { label: string; make: () => Fx[] }[] = [
  {
    label: "또렷한 목소리 (방송)",
    make: () => [
      { ...(newFx("eq") as Extract<Fx, { kind: "eq" }>), bands: [
        { type: "highpass", freq: 90, gain: 0, q: 0.7, on: true },
        { type: "lowshelf", freq: 200, gain: -2, q: 0.7, on: true },
        { type: "peaking", freq: 400, gain: -3, q: 1.2, on: true },
        { type: "peaking", freq: 3000, gain: 3, q: 1, on: true },
        { type: "highshelf", freq: 9000, gain: 2, q: 0.7, on: true },
        { type: "lowpass", freq: 18000, gain: 0, q: 0.7, on: false },
      ] },
      { ...(newFx("compressor") as Extract<Fx, { kind: "compressor" }>), threshold: -22, ratio: 3.5, makeup: 6 },
    ],
  },
  {
    label: "라디오 / 전화기",
    make: () => [
      { ...(newFx("eq") as Extract<Fx, { kind: "eq" }>), bands: [
        { type: "highpass", freq: 400, gain: 0, q: 1, on: true },
        { type: "lowshelf", freq: 150, gain: 0, q: 0.7, on: false },
        { type: "peaking", freq: 1500, gain: 6, q: 1, on: true },
        { type: "peaking", freq: 2500, gain: 0, q: 1, on: false },
        { type: "highshelf", freq: 7000, gain: 0, q: 0.7, on: false },
        { type: "lowpass", freq: 3200, gain: 0, q: 1, on: true },
      ] },
      { ...(newFx("distortion") as Extract<Fx, { kind: "distortion" }>), drive: 20, wet: 60 },
    ],
  },
  { label: "큰 홀", make: () => [{ ...(newFx("reverb") as Extract<Fx, { kind: "reverb" }>), size: 3.5, decay: 3, wet: 40 }] },
  { label: "동굴 메아리", make: () => [{ ...(newFx("delay") as Extract<Fx, { kind: "delay" }>), time: 420, feedback: 45, wet: 35 }, { ...(newFx("reverb") as Extract<Fx, { kind: "reverb" }>), size: 2.5, decay: 4, wet: 35 }] },
  { label: "로봇", make: () => [{ ...(newFx("chorus") as Extract<Fx, { kind: "chorus" }>), rate: 30, depth: 2, wet: 80 }, { ...(newFx("distortion") as Extract<Fx, { kind: "distortion" }>), drive: 30, wet: 50 }] },
  {
    label: "따뜻한 저음",
    make: () => [
      { ...(newFx("eq") as Extract<Fx, { kind: "eq" }>), bands: DEFAULT_BANDS.map((b, i) => (i === 1 ? { ...b, gain: 5 } : i === 4 ? { ...b, gain: -2 } : { ...b })) },
    ],
  },
];

/** 리버브 울림 (잡음이 점점 작아지는 것) */
function impulse(ctx: BaseAudioContext, size: number, decay: number) {
  const n = Math.max(1, Math.round(size * ctx.sampleRate));
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
  }
  return b;
}

function shaper(drive: number) {
  const k = 1 + drive / 10;
  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) curve[i] = Math.tanh(((i / 1023) * 2 - 1) * k) / Math.tanh(k);
  return curve;
}

interface Stage {
  input: AudioNode;
  output: AudioNode;
}

/** 효과 하나를 노드로 */
function stage(ctx: BaseAudioContext, fx: Fx): Stage {
  const wetDry = (wetPct: number, dryPct: number, wetIn: AudioNode, wetOut: AudioNode): Stage => {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = dryPct / 100;
    const wet = ctx.createGain();
    wet.gain.value = wetPct / 100;
    input.connect(dry).connect(output);
    input.connect(wetIn);
    wetOut.connect(wet).connect(output);
    return { input, output };
  };
  switch (fx.kind) {
    case "eq": {
      const input = ctx.createGain();
      let last: AudioNode = input;
      for (const b of fx.bands) {
        if (!b.on) continue;
        const f = ctx.createBiquadFilter();
        f.type = b.type;
        f.frequency.value = b.freq;
        f.gain.value = b.gain;
        f.Q.value = b.q;
        last.connect(f);
        last = f;
      }
      return { input, output: last };
    }
    case "compressor": {
      const c = ctx.createDynamicsCompressor();
      c.threshold.value = fx.threshold;
      c.ratio.value = fx.ratio;
      c.attack.value = fx.attack / 1000;
      c.release.value = fx.release / 1000;
      c.knee.value = fx.knee;
      const g = ctx.createGain();
      g.gain.value = dbToGain(fx.makeup);
      c.connect(g);
      return { input: c, output: g };
    }
    case "reverb": {
      const pre = ctx.createDelay(1);
      pre.delayTime.value = fx.predelay / 1000;
      const conv = ctx.createConvolver();
      conv.buffer = impulse(ctx, fx.size, fx.decay);
      pre.connect(conv);
      return wetDry(fx.wet, fx.dry, pre, conv);
    }
    case "delay": {
      const d = ctx.createDelay(3);
      d.delayTime.value = fx.time / 1000;
      const fb = ctx.createGain();
      fb.gain.value = Math.min(0.95, fx.feedback / 100);
      d.connect(fb).connect(d);
      if (fx.pingpong) {
        const pan = ctx.createStereoPanner();
        pan.pan.value = -0.7;
        d.connect(pan);
        return wetDry(fx.wet, 100, d, pan);
      }
      return wetDry(fx.wet, 100, d, d);
    }
    case "chorus": {
      const d = ctx.createDelay(0.1);
      d.delayTime.value = 0.02;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = fx.rate;
      const depth = ctx.createGain();
      depth.gain.value = fx.depth / 1000;
      lfo.connect(depth).connect(d.delayTime);
      lfo.start();
      return wetDry(fx.wet, 100 - fx.wet / 2, d, d);
    }
    case "distortion": {
      const ws = ctx.createWaveShaper();
      ws.curve = shaper(fx.drive);
      ws.oversample = "4x";
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = fx.tone;
      ws.connect(lp);
      return wetDry(fx.wet, 100 - fx.wet, ws, lp);
    }
    case "stereo": {
      const input = ctx.createGain();
      const split = ctx.createChannelSplitter(2);
      const merge = ctx.createChannelMerger(2);
      input.channelCount = 2;
      input.channelCountMode = "explicit";
      input.connect(split);
      const w = fx.width / 100;
      const same = (1 + w) / 2;
      const cross = (1 - w) / 2;
      const g = (v: number) => {
        const n = ctx.createGain();
        n.gain.value = v;
        return n;
      };
      split.connect(g(same), 0).connect(merge, 0, 0);
      split.connect(g(cross), 1).connect(merge, 0, 0);
      split.connect(g(same), 1).connect(merge, 0, 1);
      split.connect(g(cross), 0).connect(merge, 0, 1);
      const pan = ctx.createStereoPanner();
      pan.pan.value = fx.pan / 100;
      merge.connect(pan);
      return { input, output: pan };
    }
    case "gain": {
      const g = ctx.createGain();
      g.gain.value = dbToGain(fx.db);
      return { input: g, output: g };
    }
  }
}

/** 랙 전체를 이어 붙인다. 꺼진 효과는 건너뛴다. */
export function buildRack(ctx: BaseAudioContext, rack: Fx[]): Stage {
  const input = ctx.createGain();
  let last: AudioNode = input;
  for (const fx of rack) {
    if (!fx.on) continue;
    const s = stage(ctx, fx);
    last.connect(s.input);
    last = s.output;
  }
  const output = ctx.createGain();
  last.connect(output);
  return { input, output };
}

/** 랙을 고른 부분에 굳힌다 */
export async function renderRack(s: Sound, r: Range, rack: Fx[]): Promise<Sound> {
  const n = r.end - r.start;
  if (n <= 0) return s;
  const channels = Math.max(2, s.channels.length);
  const ctx = new OfflineAudioContext(channels, n, s.sampleRate);
  const buf = ctx.createBuffer(s.channels.length, n, s.sampleRate);
  s.channels.forEach((ch, c) => buf.copyToChannel(ch.slice(r.start, r.end), c));
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const chain = buildRack(ctx, rack);
  src.connect(chain.input);
  chain.output.connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  // 모노 소리였어도 스테레오 효과(팬, 넓이)가 있으면 스테레오로
  const stereoFx = rack.some((f) => f.on && (f.kind === "stereo" || (f.kind === "delay" && f.pingpong)));
  const base: Sound = stereoFx && s.channels.length === 1 ? { ...s, channels: [s.channels[0], s.channels[0].slice()] } : s;
  return replaceRange(base, r, (_p, c) => out.getChannelData(Math.min(c, out.numberOfChannels - 1)).slice());
}

/** EQ 곡선 (그림용): 주파수 배열에 대한 dB */
export function eqResponse(bands: Band[], freqs: Float32Array, sampleRate = 48000): Float32Array {
  const ctx = new OfflineAudioContext(1, 1, sampleRate);
  const total = new Float32Array(freqs.length).fill(1);
  const mag = new Float32Array(freqs.length);
  const phase = new Float32Array(freqs.length);
  for (const b of bands) {
    if (!b.on) continue;
    const f = ctx.createBiquadFilter();
    f.type = b.type;
    f.frequency.value = b.freq;
    f.gain.value = b.gain;
    f.Q.value = b.q;
    f.getFrequencyResponse(freqs as Float32Array<ArrayBuffer>, mag as Float32Array<ArrayBuffer>, phase as Float32Array<ArrayBuffer>);
    for (let i = 0; i < freqs.length; i++) total[i] *= mag[i];
  }
  return total.map((m) => 20 * Math.log10(Math.max(1e-6, m)));
}

export const soundLength = lengthOf;
