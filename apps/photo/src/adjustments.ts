// 보정 레이어의 계산. 아래에 깔린 그림의 픽셀(ImageData)을 직접 바꾼다.
import type { AdjustKind, AdjustLayer, AdjustSettings } from "./model";

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

export const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

function lut(fn: (v: number) => number) {
  const t = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) t[i] = clamp255(Math.round(fn(i)));
  return t;
}

export function levelsLut(s: AdjustSettings["levels"]) {
  const range = Math.max(1, s.inWhite - s.inBlack);
  return lut((v) => {
    const n = Math.min(1, Math.max(0, (v - s.inBlack) / range));
    return s.outBlack + Math.pow(n, 1 / Math.max(0.05, s.gamma)) * (s.outWhite - s.outBlack);
  });
}

/** 곡선의 점들을 부드럽게 (단조 3차 보간) 잇는 표 */
export function curveLut(points: { x: number; y: number }[]) {
  const p = [...points].sort((a, b) => a.x - b.x);
  const n = p.length;
  if (n < 2) return lut((v) => v);
  const d: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((p[i + 1].y - p[i].y) / Math.max(1e-6, p[i + 1].x - p[i].x));
  m.push(d[0]);
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return lut((x) => {
    if (x <= p[0].x) return p[0].y;
    if (x >= p[n - 1].x) return p[n - 1].y;
    let i = 0;
    while (x > p[i + 1].x) i++;
    const h = p[i + 1].x - p[i].x;
    const t = (x - p[i].x) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * p[i].y + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * p[i + 1].y + (t3 - t2) * h * m[i + 1]
    );
  });
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h, s, l];
}

function hue2rgb(p: number, q: number, t: number) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255];
}

const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

type PixelFn = (r: number, g: number, b: number, out: Float32Array) => void;

/** 보정 하나를 픽셀 하나에 거는 함수 */
function pixelFn(kind: AdjustKind, settings: AdjustSettings[AdjustKind]): PixelFn {
  switch (kind) {
    case "levels": {
      const t = levelsLut(settings as AdjustSettings["levels"]);
      return (r, g, b, o) => ((o[0] = t[r]), (o[1] = t[g]), (o[2] = t[b]));
    }
    case "curves": {
      const t = curveLut((settings as AdjustSettings["curves"]).points);
      return (r, g, b, o) => ((o[0] = t[r]), (o[1] = t[g]), (o[2] = t[b]));
    }
    case "brightness": {
      const s = settings as AdjustSettings["brightness"];
      const c = s.contrast * 1.27;
      const f = (259 * (c + 255)) / (255 * (259 - c));
      const t = lut((v) => f * (v + s.brightness * 1.2 - 128) + 128);
      return (r, g, b, o) => ((o[0] = t[r]), (o[1] = t[g]), (o[2] = t[b]));
    }
    case "hueSat": {
      const s = settings as AdjustSettings["hueSat"];
      return (r, g, b, o) => {
        let [h, sat, l] = rgbToHsl(r, g, b);
        if (s.colorize) {
          h = (((s.hue % 360) + 360) % 360) / 360;
          sat = Math.max(0, Math.min(1, 0.25 + s.saturation / 100));
        } else {
          h = (h + s.hue / 360 + 1) % 1;
          sat = s.saturation >= 0 ? sat + (1 - sat) * sat * (s.saturation / 100) * 1.5 : sat * (1 + s.saturation / 100);
          sat = Math.max(0, Math.min(1, sat));
        }
        l = s.lightness >= 0 ? l + (1 - l) * (s.lightness / 100) : l * (1 + s.lightness / 100);
        const c = hslToRgb(h, sat, l);
        o[0] = c[0];
        o[1] = c[1];
        o[2] = c[2];
      };
    }
    case "colorBalance": {
      const s = settings as AdjustSettings["colorBalance"];
      return (r, g, b, o) => {
        const l = luma(r, g, b) / 255;
        const mid = 4 * l * (1 - l) * 0.7;
        o[0] = r + s.cyanRed * mid;
        o[1] = g + s.magentaGreen * mid;
        o[2] = b + s.yellowBlue * mid;
      };
    }
    case "vibrance": {
      const s = settings as AdjustSettings["vibrance"];
      return (r, g, b, o) => {
        const max = Math.max(r, g, b);
        const avg = (r + g + b) / 3;
        const sat = (max - Math.min(r, g, b)) / 255;
        const amt = (s.vibrance / 100) * (1 - sat) * 1.5 + s.saturation / 100;
        o[0] = r + (r - avg) * amt;
        o[1] = g + (g - avg) * amt;
        o[2] = b + (b - avg) * amt;
        if (s.vibrance > 0 && max === r && r > g && g > b) {
          // 살색은 덜 바꾼다
          const k = 0.5;
          o[0] = r + (o[0] - r) * k;
          o[1] = g + (o[1] - g) * k;
          o[2] = b + (o[2] - b) * k;
        }
      };
    }
    case "bw": {
      const s = settings as AdjustSettings["bw"];
      const tint = s.tint ? hexToRgb(s.tint) : null;
      return (r, g, b, o) => {
        const y = luma(r, g, b);
        if (!tint) return void ((o[0] = y), (o[1] = y), (o[2] = y));
        const w = 1 - Math.abs(2 * (y / 255) - 1);
        o[0] = y + (tint[0] - 128) * w * 0.6;
        o[1] = y + (tint[1] - 128) * w * 0.6;
        o[2] = y + (tint[2] - 128) * w * 0.6;
      };
    }
    case "invert":
      return (r, g, b, o) => ((o[0] = 255 - r), (o[1] = 255 - g), (o[2] = 255 - b));
    case "threshold": {
      const level = (settings as AdjustSettings["threshold"]).level;
      return (r, g, b, o) => {
        const v = luma(r, g, b) >= level ? 255 : 0;
        o[0] = o[1] = o[2] = v;
      };
    }
    case "posterize": {
      const n = Math.max(2, (settings as AdjustSettings["posterize"]).levels);
      const t = lut((v) => (Math.round((v / 255) * (n - 1)) / (n - 1)) * 255);
      return (r, g, b, o) => ((o[0] = t[r]), (o[1] = t[g]), (o[2] = t[b]));
    }
    case "gradientMap": {
      const s = settings as AdjustSettings["gradientMap"];
      const a = hexToRgb(s.from);
      const z = hexToRgb(s.to);
      return (r, g, b, o) => {
        const t = luma(r, g, b) / 255;
        o[0] = a[0] + (z[0] - a[0]) * t;
        o[1] = a[1] + (z[1] - a[1]) * t;
        o[2] = a[2] + (z[2] - a[2]) * t;
      };
    }
  }
}

/**
 * 보정 레이어를 그림에 건다.
 * mask 는 같은 크기의 마스크 알파 (없으면 전체), amount 는 레이어 불투명도.
 */
export function applyAdjustment(data: ImageData, layer: AdjustLayer, mask: Uint8ClampedArray | null) {
  const fn = pixelFn(layer.adjustKind, layer.settings);
  const px = data.data;
  const out = new Float32Array(3);
  const amount = layer.opacity;
  // 같은 색이 많으니 바로 앞 픽셀 결과를 다시 쓴다.
  let lr = -1;
  let lg = -1;
  let lb = -1;
  const last = new Float32Array(3);
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const k = mask ? (mask[i + 3] / 255) * amount : amount;
    if (k <= 0) continue;
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    if (r !== lr || g !== lg || b !== lb) {
      fn(r, g, b, out);
      last[0] = out[0];
      last[1] = out[1];
      last[2] = out[2];
      lr = r;
      lg = g;
      lb = b;
    }
    px[i] = r + (last[0] - r) * k;
    px[i + 1] = g + (last[1] - g) * k;
    px[i + 2] = b + (last[2] - b) * k;
  }
}

/** 밝기 분포 (히스토그램): 256칸 [밝기, 빨강, 초록, 파랑] */
export function histogram(data: ImageData) {
  const lum = new Uint32Array(256);
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 8) continue;
    r[px[i]]++;
    g[px[i + 1]]++;
    b[px[i + 2]]++;
    lum[Math.round(luma(px[i], px[i + 1], px[i + 2]))]++;
  }
  return { lum, r, g, b };
}
