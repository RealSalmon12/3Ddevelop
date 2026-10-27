// 색 램프 (픽셀 아티스트들의 hue shifting): 한 색에서 어두운 색부터 밝은 색까지 단계를 만든다.
// 그냥 검정/흰색을 섞으면 탁해지므로, 어두울수록 색조를 차가운 쪽(파랑·보라)으로, 밝을수록 따뜻한 쪽(노랑)으로 돌리고
// 가운데는 채도를 높이고 양 끝은 낮춘다.

function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToHex(h: number, s: number, l: number) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round(Math.max(0, Math.min(1, v + m)) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** 색조를 target 쪽으로 amount 도만큼 (짧은 쪽으로) 돌린다 */
function toward(h: number, target: number, amount: number) {
  const d = ((target - h + 540) % 360) - 180;
  return h + Math.sign(d) * Math.min(Math.abs(d), amount);
}

/**
 * steps 단계 램프 (어두운 것부터). base 색이 가운데 근처에 들어간다.
 * shift: 양 끝에서 색조를 얼마나 돌릴지 (도)
 */
export function colorRamp(base: string, steps = 5, shift = 30): string[] {
  const [h, s, l] = hexToHsl(base);
  const out: string[] = [];
  // 아주 어둡거나 밝은 색은 램프의 끝에 둔다 (그보다 더 어둡거나 밝게 만들 수 없으니)
  const mid = l < 0.15 ? 0 : l > 0.85 ? steps - 1 : (steps - 1) / 2;
  for (let i = 0; i < steps; i++) {
    const t = i < mid ? (i - mid) / mid : i > mid ? (i - mid) / (steps - 1 - mid) : 0; // -1 (가장 어두움) ~ 1 (가장 밝음)
    if (Math.abs(t) < 1e-6) {
      out.push(base.toLowerCase());
      continue;
    }
    const lightness = t < 0 ? l * (1 + t * 0.78) : l + (0.96 - l) * t * (mid === 0 ? 1 : 0.8);
    // 회색에 가까운 색은 색조를 거의 안 돌린다
    const hue = s < 0.08 ? h : t < 0 ? toward(h, 250, shift * -t) : toward(h, 60, shift * t);
    const sat = Math.max(0, Math.min(1, s * (t < 0 ? 1 + 0.15 * -t : 1 - 0.35 * t)));
    out.push(hslToHex(hue, sat, Math.max(0.03, Math.min(0.97, lightness))));
  }
  return out;
}
