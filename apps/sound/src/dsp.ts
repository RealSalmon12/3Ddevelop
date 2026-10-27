// 소리 계산 (오디션의 ‘효과’ 메뉴처럼 소리를 직접 바꾸는 것들). 모두 새 Sound 를 돌려준다.
import { lengthOf, type Range, type Sound } from "./audio";

/* ───────── FFT ───────── */

/** 제자리 복소수 FFT (길이는 2의 거듭제곱) */
export function fft(re: Float32Array, im: Float32Array, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
  if (inverse)
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
}

export const hann = (n: number) => Float32Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));

/* ───────── 도움 ───────── */

const clamp1 = (v: number) => (v > 1 ? 1 : v < -1 ? -1 : v);
export const dbToGain = (db: number) => Math.pow(10, db / 20);
export const gainToDb = (g: number) => (g <= 0 ? -Infinity : 20 * Math.log10(g));

/** 고른 부분을 fn 으로 만든 새 조각으로 바꾼다 (길이가 달라져도 된다) */
export function replaceRange(s: Sound, r: Range, fn: (part: Float32Array, ch: number) => Float32Array): Sound {
  return {
    ...s,
    channels: s.channels.map((ch, c) => {
      const part = fn(ch.slice(r.start, r.end), c);
      if (part.length === r.end - r.start) {
        const out = ch.slice();
        out.set(part, r.start);
        return out;
      }
      const out = new Float32Array(ch.length - (r.end - r.start) + part.length);
      out.set(ch.subarray(0, r.start));
      out.set(part, r.start);
      out.set(ch.subarray(r.end), r.start + part.length);
      return out;
    }),
  };
}

/* ───────── 크기 ───────── */

export function amplify(s: Sound, r: Range, db: number) {
  const g = dbToGain(db);
  return replaceRange(s, r, (p) => p.map((v) => clamp1(v * g)));
}

export function stats(s: Sound, r: Range) {
  let peak = 0;
  let sum = 0;
  let count = 0;
  for (const ch of s.channels)
    for (let i = r.start; i < r.end; i++) {
      const v = Math.abs(ch[i]);
      if (v > peak) peak = v;
      sum += v * v;
      count++;
    }
  return { peakDb: gainToDb(peak), rmsDb: gainToDb(Math.sqrt(sum / Math.max(1, count))), lufs: loudness(s, r) };
}

/** 가장 큰 소리를 targetDb 로 */
export function normalizePeak(s: Sound, r: Range, targetDb = -1) {
  const { peakDb } = stats(s, r);
  if (!Number.isFinite(peakDb)) return s;
  return amplify(s, r, targetDb - peakDb);
}

/** 2차 필터 (biquad) 를 한 채널에 */
function biquad(x: Float32Array, b0: number, b1: number, b2: number, a1: number, a2: number) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/**
 * 라우드니스 (LUFS, ITU-R BS.1770 근사): K 가중치를 걸고 400ms 블록 평균, -70 LUFS 절대 게이트와 상대 게이트.
 */
export function loudness(s: Sound, r: Range) {
  const fs = s.sampleRate;
  // K 가중치: 고역 쉘프 + 고역 통과 (48kHz 계수를 fs 에 맞게 다시 계산)
  const shelf = (() => {
    const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
    const K = Math.tan((Math.PI * f0) / fs);
    const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
    const a0 = 1 + K / Q + K * K;
    return [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  })();
  const hp = (() => {
    const f0 = 38.13547087602444, Q = 0.5003270373238773;
    const K = Math.tan((Math.PI * f0) / fs);
    const a0 = 1 + K / Q + K * K;
    return [1 / a0, -2 / a0, 1 / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  })();
  const weighted = s.channels.map((ch) => {
    const part = ch.subarray(r.start, r.end);
    const a = biquad(part, shelf[0], shelf[1], shelf[2], shelf[3], shelf[4]);
    return biquad(a, hp[0], hp[1], hp[2], hp[3], hp[4]);
  });
  const block = Math.round(0.4 * fs);
  const hop = Math.round(0.1 * fs);
  const n = r.end - r.start;
  const blocks: number[] = [];
  for (let at = 0; at + block <= n; at += hop) {
    let z = 0;
    for (const w of weighted) {
      let sum = 0;
      for (let i = at; i < at + block; i++) sum += w[i] * w[i];
      z += sum / block;
    }
    blocks.push(z);
  }
  if (!blocks.length) {
    let z = 0;
    for (const w of weighted) z += w.reduce((a, v) => a + v * v, 0) / Math.max(1, n);
    blocks.push(z);
  }
  const lk = (z: number) => -0.691 + 10 * Math.log10(z || 1e-12);
  const abs = blocks.filter((z) => lk(z) > -70);
  if (!abs.length) return -Infinity;
  const mean = abs.reduce((a, b) => a + b, 0) / abs.length;
  const rel = abs.filter((z) => lk(z) > lk(mean) - 10);
  return lk(rel.reduce((a, b) => a + b, 0) / Math.max(1, rel.length));
}

/** 라우드니스를 목표 LUFS 로 맞추고, 넘치면 -1dB 로 눌러 둔다 */
export function matchLoudness(s: Sound, r: Range, target: number) {
  const now = loudness(s, r);
  if (!Number.isFinite(now)) return s;
  const out = amplify(s, r, target - now);
  return limit(out, r, -1);
}

/** 간단한 리미터: 넘는 곳만 부드럽게 줄인다 (미리보기 5ms) */
export function limit(s: Sound, r: Range, ceilingDb = -1) {
  const ceil = dbToGain(ceilingDb);
  const look = Math.round(0.005 * s.sampleRate);
  const release = Math.exp(-1 / (0.08 * s.sampleRate));
  const n = r.end - r.start;
  // 채널을 묶어서 같은 양만큼 줄인다 (좌우 균형 유지)
  const need = new Float32Array(n);
  for (const ch of s.channels)
    for (let i = 0; i < n; i++) {
      const v = Math.abs(ch[r.start + i]);
      if (v > ceil) need[i] = Math.max(need[i], 1 - ceil / v);
    }
  const env = new Float32Array(n);
  let g = 0;
  for (let i = n - 1; i >= 0; i--) {
    // 앞을 미리 보고 줄이기 시작
    let m = 0;
    for (let k = 0; k < look && i + k < n; k += 8) m = Math.max(m, need[i + k]);
    g = m > g ? m : g * release + m * (1 - release);
    env[i] = g;
  }
  return replaceRange(s, r, (p) => p.map((v, i) => clamp1(v * (1 - env[i]))));
}

/* ───────── 페이드 ───────── */

export type FadeCurve = "linear" | "log" | "exp" | "s";
const curve = (t: number, c: FadeCurve) => (c === "linear" ? t : c === "log" ? Math.sqrt(t) : c === "exp" ? t * t : t * t * (3 - 2 * t));

export function fade(s: Sound, r: Range, dir: "in" | "out", c: FadeCurve) {
  const n = Math.max(1, r.end - r.start);
  return replaceRange(s, r, (p) => p.map((v, i) => v * curve(dir === "in" ? i / n : 1 - i / n, c)));
}

/* ───────── 기타 ───────── */

export const invert = (s: Sound, r: Range) => replaceRange(s, r, (p) => p.map((v) => -v));

export function removeDc(s: Sound, r: Range) {
  return replaceRange(s, r, (p) => {
    const mean = p.reduce((a, v) => a + v, 0) / Math.max(1, p.length);
    return p.map((v) => v - mean);
  });
}

export function toMono(s: Sound): Sound {
  if (s.channels.length === 1) return s;
  const [l, r] = s.channels;
  return { ...s, channels: [l.map((v, i) => (v + r[i]) / 2)] };
}

export function toStereo(s: Sound): Sound {
  if (s.channels.length === 2) return s;
  return { ...s, channels: [s.channels[0].slice(), s.channels[0].slice()] };
}

export function swapChannels(s: Sound): Sound {
  return s.channels.length === 2 ? { ...s, channels: [s.channels[1], s.channels[0]] } : s;
}

/** 처음과 끝의 조용한 부분 자르기 */
export function trimSilence(s: Sound, thresholdDb = -50): Sound {
  const th = dbToGain(thresholdDb);
  const n = lengthOf(s);
  const loud = (i: number) => s.channels.some((ch) => Math.abs(ch[i]) > th);
  let a = 0;
  while (a < n && !loud(a)) a++;
  let b = n;
  while (b > a && !loud(b - 1)) b--;
  const pad = Math.round(0.01 * s.sampleRate);
  a = Math.max(0, a - pad);
  b = Math.min(n, b + pad);
  return { ...s, channels: s.channels.map((ch) => ch.slice(a, b)) };
}

/** 노이즈 게이트: 기준보다 작은 소리를 줄인다 */
export function gate(s: Sound, r: Range, thresholdDb = -45, reduceDb = -40, holdMs = 60) {
  const th = dbToGain(thresholdDb);
  const floor = dbToGain(reduceDb);
  const hold = Math.round((holdMs / 1000) * s.sampleRate);
  const n = r.end - r.start;
  const atk = Math.exp(-1 / (0.002 * s.sampleRate));
  const rel = Math.exp(-1 / (0.05 * s.sampleRate));
  const open = new Float32Array(n);
  let last = -hold;
  for (let i = 0; i < n; i++) {
    if (s.channels.some((ch) => Math.abs(ch[r.start + i]) > th)) last = i;
    open[i] = i - last < hold ? 1 : floor;
  }
  let g = floor;
  for (let i = 0; i < n; i++) {
    const t = open[i];
    g = t > g ? t + (g - t) * atk : t + (g - t) * rel;
    open[i] = g;
  }
  return replaceRange(s, r, (p) => p.map((v, i) => v * open[i]));
}

/* ───────── 소음 제거 (스펙트럼 빼기) ───────── */

const NR_SIZE = 2048;

/** 잡음만 있는 부분에서 주파수별 크기(잡음 지문)를 잰다 */
export function noiseProfile(s: Sound, r: Range): Float32Array {
  const win = hann(NR_SIZE);
  const prof = new Float32Array(NR_SIZE / 2 + 1);
  let frames = 0;
  for (const ch of s.channels) {
    for (let at = r.start; at + NR_SIZE <= r.end; at += NR_SIZE / 2) {
      const re = new Float32Array(NR_SIZE);
      const im = new Float32Array(NR_SIZE);
      for (let i = 0; i < NR_SIZE; i++) re[i] = ch[at + i] * win[i];
      fft(re, im);
      for (let k = 0; k <= NR_SIZE / 2; k++) prof[k] += Math.hypot(re[k], im[k]);
      frames++;
    }
  }
  if (!frames) return prof;
  for (let k = 0; k < prof.length; k++) prof[k] /= frames;
  return prof;
}

/** 잡음 지문만큼 주파수마다 줄인다. amount 0~1, sensitivity 는 지문을 몇 배로 볼지 */
export function reduceNoise(s: Sound, r: Range, profile: Float32Array, amount = 0.8, sensitivity = 1.5) {
  const win = hann(NR_SIZE);
  const hop = NR_SIZE / 4;
  return replaceRange(s, r, (part) => {
    const n = part.length;
    const out = new Float32Array(n + NR_SIZE);
    const norm = new Float32Array(n + NR_SIZE);
    const padded = new Float32Array(n + NR_SIZE * 2);
    padded.set(part, NR_SIZE);
    // 바로 앞 프레임의 이득 (지글거림 줄이기)
    let prevGain = new Float32Array(NR_SIZE / 2 + 1).fill(1);
    for (let at = 0; at + NR_SIZE <= padded.length; at += hop) {
      const re = new Float32Array(NR_SIZE);
      const im = new Float32Array(NR_SIZE);
      for (let i = 0; i < NR_SIZE; i++) re[i] = padded[at + i] * win[i];
      fft(re, im);
      const gains = new Float32Array(NR_SIZE / 2 + 1);
      for (let k = 0; k <= NR_SIZE / 2; k++) {
        const mag = Math.hypot(re[k], im[k]);
        const noise = profile[k] * sensitivity;
        let g = mag > 0 ? Math.max(0, (mag - noise) / mag) : 0;
        g = 1 - amount * (1 - g);
        gains[k] = 0.6 * g + 0.4 * prevGain[k];
      }
      // 이웃 주파수와 고르게
      for (let k = 1; k < NR_SIZE / 2; k++) gains[k] = (gains[k - 1] + 2 * gains[k] + gains[k + 1]) / 4;
      prevGain = gains;
      for (let k = 0; k <= NR_SIZE / 2; k++) {
        re[k] *= gains[k];
        im[k] *= gains[k];
        if (k > 0 && k < NR_SIZE / 2) {
          re[NR_SIZE - k] = re[k];
          im[NR_SIZE - k] = -im[k];
        }
      }
      fft(re, im, true);
      for (let i = 0; i < NR_SIZE; i++) {
        const o = at + i - NR_SIZE;
        if (o < 0 || o >= out.length) continue;
        out[o] += re[i] * win[i];
        norm[o] += win[i] * win[i];
      }
    }
    const res = new Float32Array(n);
    for (let i = 0; i < n; i++) res[i] = norm[i] > 1e-6 ? out[i] / norm[i] : 0;
    return res;
  });
}

/* ───────── 음높이, 빠르기 ───────── */

/** 길이를 factor 배로 (음높이는 그대로): 겹쳐 더하기 (WSOLA 간단판) */
export function timeStretchChannel(x: Float32Array, factor: number, sampleRate: number) {
  const size = Math.round(0.05 * sampleRate);
  const hopOut = Math.round(size / 2);
  const hopIn = hopOut / factor;
  const search = Math.round(0.012 * sampleRate);
  const win = hann(size);
  const outLen = Math.round(x.length * factor);
  const out = new Float32Array(outLen + size);
  const norm = new Float32Array(outLen + size);
  let prevEnd = 0;
  for (let k = 0; k * hopOut < outLen; k++) {
    let pos = Math.round(k * hopIn);
    // 앞 조각과 가장 잘 이어지는 곳 찾기
    if (k > 0 && search > 0) {
      let best = pos;
      let bestScore = -Infinity;
      for (let d = -search; d <= search; d += 4) {
        const p = pos + d;
        if (p < 0 || p + hopOut >= x.length) continue;
        let score = 0;
        for (let i = 0; i < hopOut; i += 8) score += x[p + i] * x[prevEnd + i] || 0;
        if (score > bestScore) {
          bestScore = score;
          best = p;
        }
      }
      pos = best;
    }
    const o = k * hopOut;
    for (let i = 0; i < size; i++) {
      const v = x[pos + i] ?? 0;
      out[o + i] += v * win[i];
      norm[o + i] += win[i];
    }
    prevEnd = Math.min(x.length - hopOut - 1, pos + hopOut);
  }
  const res = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) res[i] = norm[i] > 1e-3 ? out[i] / norm[i] : 0;
  return res;
}

function resampleChannel(x: Float32Array, ratio: number) {
  const n = Math.max(1, Math.floor(x.length / ratio));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * ratio;
    const i0 = Math.floor(p);
    const f = p - i0;
    out[i] = (x[i0] ?? 0) * (1 - f) + (x[i0 + 1] ?? x[i0] ?? 0) * f;
  }
  return out;
}

/** 빠르기만 바꾸기 (음높이 그대로). rate 2 = 두 배 빠르게 */
export const changeTempo = (s: Sound, r: Range, rate: number) => replaceRange(s, r, (p) => timeStretchChannel(p, 1 / rate, s.sampleRate));

/** 음높이만 바꾸기 (길이 그대로). 반음 단위 */
export function changePitch(s: Sound, r: Range, semitones: number) {
  const ratio = Math.pow(2, semitones / 12);
  return replaceRange(s, r, (p) => {
    const stretched = timeStretchChannel(p, ratio, s.sampleRate);
    const back = resampleChannel(stretched, ratio);
    const out = new Float32Array(p.length);
    out.set(back.subarray(0, p.length));
    return out;
  });
}

/* ───────── 만들기 ───────── */

export type NoiseColor = "white" | "pink" | "brown";

export function tone(sampleRate: number, channels: number, seconds: number, freq: number, wave: "sine" | "square" | "saw" | "triangle", volumeDb: number): Sound {
  const n = Math.round(seconds * sampleRate);
  const g = dbToGain(volumeDb);
  const ch = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const ph = ((i * freq) / sampleRate) % 1;
    const v = wave === "sine" ? Math.sin(2 * Math.PI * ph) : wave === "square" ? (ph < 0.5 ? 1 : -1) : wave === "saw" ? ph * 2 - 1 : ph < 0.5 ? ph * 4 - 1 : 3 - ph * 4;
    ch[i] = v * g;
  }
  // 딸깍 소리가 나지 않게 앞뒤 5ms
  const edge = Math.min(n / 2, Math.round(0.005 * sampleRate));
  for (let i = 0; i < edge; i++) {
    ch[i] *= i / edge;
    ch[n - 1 - i] *= i / edge;
  }
  return { sampleRate, channels: Array.from({ length: channels }, () => ch.slice()) };
}

export function noise(sampleRate: number, channels: number, seconds: number, color: NoiseColor, volumeDb: number): Sound {
  const n = Math.round(seconds * sampleRate);
  const g = dbToGain(volumeDb);
  const make = () => {
    const ch = new Float32Array(n);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (color === "white") ch[i] = w * 0.5;
      else if (color === "pink") {
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        ch[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
      } else {
        last = (last + 0.02 * w) / 1.02;
        ch[i] = last * 3.5;
      }
      ch[i] *= g;
    }
    return ch;
  };
  return { sampleRate, channels: Array.from({ length: channels }, make) };
}

/** 고른 자리를 다른 소리로 바꾸거나 (r 이 비었으면 끼워 넣기) */
export function insertAt(s: Sound, at: number, clip: Sound): Sound {
  return {
    ...s,
    channels: s.channels.map((ch, c) => {
      const src = clip.channels[Math.min(c, clip.channels.length - 1)];
      const out = new Float32Array(ch.length + src.length);
      out.set(ch.subarray(0, at));
      out.set(src, at);
      out.set(ch.subarray(at), at + src.length);
      return out;
    }),
  };
}

/** 소리 위에 다른 소리를 겹쳐 섞기 */
export function mixAt(s: Sound, at: number, clip: Sound): Sound {
  const need = at + lengthOf(clip);
  return {
    ...s,
    channels: s.channels.map((ch, c) => {
      const src = clip.channels[Math.min(c, clip.channels.length - 1)];
      const out = new Float32Array(Math.max(ch.length, need));
      out.set(ch);
      for (let i = 0; i < src.length; i++) out[at + i] = clamp1(out[at + i] + src[i]);
      return out;
    }),
  };
}

/** 여러 비트 깊이의 WAV */
export function encodeWav(s: Sound, bits: 16 | 24 | 32): Uint8Array {
  const n = lengthOf(s);
  const ch = s.channels.length;
  const bytesPer = bits / 8;
  const data = n * ch * bytesPer;
  const buf = new ArrayBuffer(44 + data);
  const v = new DataView(buf);
  const str = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + data, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, bits === 32 ? 3 : 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, s.sampleRate, true);
  v.setUint32(28, s.sampleRate * ch * bytesPer, true);
  v.setUint16(32, ch * bytesPer, true);
  v.setUint16(34, bits, true);
  str(36, "data");
  v.setUint32(40, data, true);
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) {
      const x = clamp1(s.channels[c][i]);
      if (bits === 16) v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
      else if (bits === 24) {
        const iv = Math.round(x < 0 ? x * 0x800000 : x * 0x7fffff);
        v.setUint8(o, iv & 255);
        v.setUint8(o + 1, (iv >> 8) & 255);
        v.setUint8(o + 2, (iv >> 16) & 255);
      } else v.setFloat32(o, x, true);
      o += bytesPer;
    }
  return new Uint8Array(buf);
}
