// 색은 화면에서는 "#rrggbb" 글자로, 그림 안에서는 [r, g, b, a] 네 칸으로 다룬다.

export type RGBA = readonly [number, number, number, number];

export const TRANSPARENT: RGBA = [0, 0, 0, 0];

export function hexToRgba(hex: string): RGBA {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return TRANSPARENT;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

export function rgbaToHex([r, g, b]: RGBA | number[]): string {
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** 초보자가 바로 쓰기 좋은 32색. 피부, 풀, 하늘, 나무, 금속 색이 고루 들어 있다. */
export const DEFAULT_PALETTE = [
  "#000000", "#222034", "#45283c", "#663931", "#8f563b", "#df7126", "#d9a066", "#eec39a",
  "#fbf236", "#99e550", "#6abe30", "#37946e", "#4b692f", "#524b24", "#323c39", "#3f3f74",
  "#306082", "#5b6ee1", "#639bff", "#5fcde4", "#cbdbfc", "#ffffff", "#9badb7", "#847e87",
  "#696a6a", "#595652", "#76428a", "#ac3232", "#d95763", "#d77bba", "#8f974a", "#8a6f30",
];
