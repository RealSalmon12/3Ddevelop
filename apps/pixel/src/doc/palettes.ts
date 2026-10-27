// 유명한 픽셀 아트 팔레트. 처음부터 어울리는 색으로 그리면 그림이 훨씬 깔끔해진다.
import { DEFAULT_PALETTE } from "./color";

export const PALETTES: { name: string; colors: string[] }[] = [
  { name: "DB32 (기본)", colors: DEFAULT_PALETTE },
  {
    name: "PICO-8",
    colors: ["#000000", "#1d2b53", "#7e2553", "#008751", "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8", "#ff004d", "#ffa300", "#ffec27", "#00e436", "#29adff", "#83769c", "#ff77a8", "#ffccaa"],
  },
  {
    name: "Sweetie 16",
    colors: ["#1a1c2c", "#5d275d", "#b13e53", "#ef7d57", "#ffcd75", "#a7f070", "#38b764", "#257179", "#29366f", "#3b5dc9", "#41a6f6", "#73eff7", "#f4f4f4", "#94b0c2", "#566c86", "#333c57"],
  },
  {
    name: "Endesga 32",
    colors: [
      "#be4a2f", "#d77643", "#ead4aa", "#e4a672", "#b86f50", "#733e39", "#3e2731", "#a22633", "#e43b44", "#f77622", "#feae34", "#fee761", "#63c74d", "#3e8948", "#265c42", "#193c3e",
      "#124e89", "#0099db", "#2ce8f5", "#ffffff", "#c0cbdc", "#8b9bb4", "#5a6988", "#3a4466", "#262b44", "#181425", "#ff0044", "#68386c", "#b55088", "#f6757a", "#e8b796", "#c28569",
    ],
  },
  { name: "게임보이", colors: ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"] },
  { name: "흑백 8단계", colors: ["#000000", "#242424", "#494949", "#6d6d6d", "#929292", "#b6b6b6", "#dbdbdb", "#ffffff"] },
  {
    name: "로블록스 기본 색",
    colors: ["#f2f3f3", "#a3a2a5", "#635f62", "#1b2a35", "#c4281c", "#da8541", "#f5cd30", "#4b974b", "#287f47", "#0d69ac", "#6e99ca", "#b4d2e4", "#6b327c", "#da867a", "#cc8e69", "#7c5c46"],
  },
];

/** .hex (한 줄에 색 하나) 나 .gpl (김프 팔레트) 글자를 색 목록으로 */
export function parsePalette(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") && !/^#[0-9a-f]{6}$/i.test(line)) continue;
    const hex = /^#?([0-9a-f]{6})$/i.exec(line);
    if (hex) {
      out.push(`#${hex[1].toLowerCase()}`);
      continue;
    }
    const gpl = /^(\d+)\s+(\d+)\s+(\d+)/.exec(line);
    if (gpl) out.push(`#${[gpl[1], gpl[2], gpl[3]].map((v) => Math.min(255, Number(v)).toString(16).padStart(2, "0")).join("")}`);
  }
  return out.slice(0, 256);
}

export const paletteToHex = (colors: string[]) => colors.map((c) => c.replace("#", "")).join("\n") + "\n";
