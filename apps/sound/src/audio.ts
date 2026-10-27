// 소리 한 덩어리와 그것을 고치는 계산. 모두 새 값을 돌려줘서 실행 취소가 쉽다.

export interface Sound {
  sampleRate: number;
  /** 왼쪽, 오른쪽 (모노면 하나) */
  channels: Float32Array[];
}

export interface Range {
  start: number;
  end: number;
}

export const EMPTY: Sound = { sampleRate: 44100, channels: [new Float32Array(0)] };

export const lengthOf = (s: Sound) => s.channels[0].length;
export const secondsOf = (s: Sound) => lengthOf(s) / s.sampleRate;

const map = (s: Sound, fn: (ch: Float32Array) => Float32Array): Sound => ({ ...s, channels: s.channels.map(fn) });

function concat(...parts: Float32Array[]) {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** 고른 부분만 남기기 */
export const keep = (s: Sound, r: Range) => map(s, (ch) => ch.slice(r.start, r.end));
/** 고른 부분 지우기 */
export const remove = (s: Sound, r: Range) => map(s, (ch) => concat(ch.subarray(0, r.start), ch.subarray(r.end)));
/** 고른 부분 복사 */
export const copy = (s: Sound, r: Range): Sound => keep(s, r);

/** 다른 소리를 at 자리에 끼워 넣는다. 채널 수와 빠르기는 앞 소리에 맞춘다. */
export function insert(s: Sound, at: number, clip: Sound): Sound {
  const fitted = resample(clip, s.sampleRate);
  return {
    ...s,
    channels: s.channels.map((ch, i) => {
      const src = fitted.channels[Math.min(i, fitted.channels.length - 1)];
      return concat(ch.subarray(0, at), src, ch.subarray(at));
    }),
  };
}

/** 고른 부분에만 fn 을 적용한다 (샘플 위치 0~1 비율과 함께). */
function inRange(s: Sound, r: Range, fn: (v: number, t: number) => number): Sound {
  return map(s, (ch) => {
    const out = ch.slice();
    const len = Math.max(1, r.end - r.start);
    for (let i = r.start; i < r.end; i++) out[i] = fn(ch[i], (i - r.start) / len);
    return out;
  });
}

export const fadeIn = (s: Sound, r: Range) => inRange(s, r, (v, t) => v * t);
export const fadeOut = (s: Sound, r: Range) => inRange(s, r, (v, t) => v * (1 - t));
export const gain = (s: Sound, r: Range, g: number) => inRange(s, r, (v) => Math.max(-1, Math.min(1, v * g)));
export const silence = (s: Sound, r: Range) => inRange(s, r, () => 0);

/** 가장 큰 소리가 0.95 가 되게 */
export function normalize(s: Sound, r: Range) {
  let peak = 0;
  for (const ch of s.channels) for (let i = r.start; i < r.end; i++) peak = Math.max(peak, Math.abs(ch[i]));
  return peak > 0 ? gain(s, r, 0.95 / peak) : s;
}

export function reverse(s: Sound, r: Range) {
  return map(s, (ch) => {
    const out = ch.slice();
    for (let i = r.start; i < r.end; i++) out[i] = ch[r.end - 1 - (i - r.start)];
    return out;
  });
}

/** 메아리: delay 초 뒤에 decay 만큼 작게 여러 번 */
export function echo(s: Sound, r: Range, delay = 0.25, decay = 0.45) {
  const d = Math.round(delay * s.sampleRate);
  return map(s, (ch) => {
    const out = ch.slice();
    for (let i = r.start; i < r.end; i++) if (i - d >= r.start) out[i] = Math.max(-1, Math.min(1, out[i] + out[i - d] * decay));
    return out;
  });
}

/** 빠르기 바꾸기 (빠르면 목소리가 높아진다, 다람쥐 목소리) */
export function speed(s: Sound, r: Range, factor: number) {
  const part = resample(keep(s, r), s.sampleRate / factor);
  return {
    ...s,
    channels: s.channels.map((ch, i) => concat(ch.subarray(0, r.start), part.channels[i], ch.subarray(r.end))),
  };
}

/** 빠르기(샘플 수)를 바꾼다. 선형 보간 */
export function resample(s: Sound, rate: number): Sound {
  if (rate === s.sampleRate) return s;
  const ratio = s.sampleRate / rate;
  const n = Math.max(0, Math.floor(lengthOf(s) / ratio));
  return {
    sampleRate: rate,
    channels: s.channels.map((ch) => {
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = i * ratio;
        const i0 = Math.floor(x);
        const f = x - i0;
        out[i] = (ch[i0] ?? 0) * (1 - f) + (ch[i0 + 1] ?? ch[i0] ?? 0) * f;
      }
      return out;
    }),
  };
}

export function fromAudioBuffer(b: AudioBuffer): Sound {
  const channels = [];
  for (let i = 0; i < Math.min(2, b.numberOfChannels); i++) channels.push(b.getChannelData(i).slice());
  return { sampleRate: b.sampleRate, channels };
}

export function toAudioBuffer(ctx: BaseAudioContext, s: Sound): AudioBuffer {
  const b = ctx.createBuffer(s.channels.length, Math.max(1, lengthOf(s)), s.sampleRate);
  s.channels.forEach((ch, i) => b.copyToChannel(ch as Float32Array<ArrayBuffer>, i));
  return b;
}

/** 16비트 WAV 파일 */
export function toWav(s: Sound): Uint8Array {
  const n = lengthOf(s);
  const ch = s.channels.length;
  const bytes = new ArrayBuffer(44 + n * ch * 2);
  const v = new DataView(bytes);
  const str = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + n * ch * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, s.sampleRate, true);
  v.setUint32(28, s.sampleRate * ch * 2, true);
  v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, n * ch * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) {
      const x = Math.max(-1, Math.min(1, s.channels[c][i]));
      v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
      o += 2;
    }
  return new Uint8Array(bytes);
}

// ---------- 게임 효과음 만들기 ----------

export interface SfxParams {
  wave: "square" | "saw" | "sine" | "triangle" | "noise";
  /** 시작, 끝 높이 (Hz) */
  startFreq: number;
  endFreq: number;
  /** 길이 (초) */
  duration: number;
  /** 소리가 커지는 시간, 줄어드는 비율 (0~1) */
  attack: number;
  /** 떨림 (0~1) 과 빠르기 (Hz) */
  vibrato: number;
  vibratoSpeed: number;
  /** 중간에 음이 뛰는 비율 (동전 소리처럼). 1 이면 없음 */
  jump: number;
  /** 0~1 */
  volume: number;
}

export const SFX_PRESETS: { label: string; icon: string; params: SfxParams }[] = [
  { label: "동전", icon: "🪙", params: { wave: "square", startFreq: 988, endFreq: 988, duration: 0.35, attack: 0, vibrato: 0, vibratoSpeed: 0, jump: 1.335, volume: 0.5 } },
  { label: "점프", icon: "⤴", params: { wave: "square", startFreq: 300, endFreq: 750, duration: 0.25, attack: 0.02, vibrato: 0, vibratoSpeed: 0, jump: 1, volume: 0.5 } },
  { label: "레이저", icon: "⚡", params: { wave: "saw", startFreq: 1400, endFreq: 180, duration: 0.22, attack: 0, vibrato: 0, vibratoSpeed: 0, jump: 1, volume: 0.45 } },
  { label: "폭발", icon: "💥", params: { wave: "noise", startFreq: 900, endFreq: 60, duration: 0.8, attack: 0, vibrato: 0, vibratoSpeed: 0, jump: 1, volume: 0.7 } },
  { label: "파워업", icon: "⬆", params: { wave: "triangle", startFreq: 300, endFreq: 1200, duration: 0.6, attack: 0.02, vibrato: 0.25, vibratoSpeed: 18, jump: 1, volume: 0.6 } },
  { label: "맞음", icon: "✖", params: { wave: "noise", startFreq: 1800, endFreq: 300, duration: 0.18, attack: 0, vibrato: 0, vibratoSpeed: 0, jump: 1, volume: 0.6 } },
  { label: "클릭", icon: "•", params: { wave: "sine", startFreq: 1200, endFreq: 800, duration: 0.05, attack: 0, vibrato: 0, vibratoSpeed: 0, jump: 1, volume: 0.6 } },
  { label: "실패", icon: "☹", params: { wave: "square", startFreq: 440, endFreq: 110, duration: 0.7, attack: 0.01, vibrato: 0.15, vibratoSpeed: 9, jump: 1, volume: 0.45 } },
];

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
export function randomSfx(): SfxParams {
  const waves: SfxParams["wave"][] = ["square", "saw", "sine", "triangle", "noise"];
  return {
    wave: waves[Math.floor(Math.random() * waves.length)],
    startFreq: rand(100, 1600),
    endFreq: rand(60, 1600),
    duration: rand(0.08, 0.7),
    attack: Math.random() < 0.6 ? 0 : rand(0, 0.1),
    vibrato: Math.random() < 0.7 ? 0 : rand(0.05, 0.4),
    vibratoSpeed: rand(4, 25),
    jump: Math.random() < 0.7 ? 1 : rand(1.1, 2),
    volume: 0.5,
  };
}

/** 효과음을 직접 계산해서 만든다 (8비트 게임 소리처럼). */
export function synth(p: SfxParams, sampleRate = 44100): Sound {
  const n = Math.max(1, Math.round(Math.min(5, Math.max(0.02, p.duration)) * sampleRate));
  const out = new Float32Array(n);
  let phase = 0;
  let noise = 0;
  let noisePhase = 0;
  const attack = Math.max(1, Math.round(p.attack * sampleRate));
  for (let i = 0; i < n; i++) {
    const t = i / n;
    let f = p.startFreq * Math.pow(Math.max(1, p.endFreq) / Math.max(1, p.startFreq), t);
    if (p.jump !== 1 && t > 0.3) f *= p.jump;
    if (p.vibrato > 0) f *= 1 + p.vibrato * 0.5 * Math.sin((2 * Math.PI * p.vibratoSpeed * i) / sampleRate);
    phase = (phase + f / sampleRate) % 1;
    let v: number;
    switch (p.wave) {
      case "square":
        v = phase < 0.5 ? 0.6 : -0.6;
        break;
      case "saw":
        v = (phase * 2 - 1) * 0.7;
        break;
      case "triangle":
        v = (phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4) * 0.9;
        break;
      case "sine":
        v = Math.sin(2 * Math.PI * phase);
        break;
      default:
        // 높이에 따라 바뀌는 빠르기로 무작위 값을 고른다 (낮을수록 우르릉)
        noisePhase += f / sampleRate;
        if (noisePhase >= 1) {
          noisePhase %= 1;
          noise = Math.random() * 2 - 1;
        }
        v = noise * 0.8;
    }
    const env = i < attack ? i / attack : Math.pow(1 - (i - attack) / Math.max(1, n - attack), 1.6);
    out[i] = v * env * p.volume;
  }
  return { sampleRate, channels: [out] };
}
