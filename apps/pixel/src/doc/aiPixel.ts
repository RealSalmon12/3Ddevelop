import type { AIRequest } from "@suite/shell/bridge";
import { rgbaToHex } from "./color";
import type { PixelDoc } from "./PixelDoc";
import { ROW_ALPHABET, type PixelRows } from "./raster";

/** AI 가 한 번에 그릴 수 있는 가장 큰 크기. 더 큰 캔버스에는 칸을 키워서 넣는다. */
export const AI_MAX_SIZE = 64;

export const AI_SYSTEM = `당신은 초보자를 돕는 픽셀 아트 화가입니다. 사용자는 로블록스 데칼, 게임 아이템, 캐릭터 같은 작은 픽셀 그림을 만듭니다.
항상 draw_pixel_art 도구로 답하세요.
- rows 는 위에서 아래로 한 줄씩, 정확히 요청받은 가로 × 세로 크기여야 합니다.
- 각 글자는 palette 의 번호입니다: '0'~'9' 는 0~9번, 'a'~'z' 는 10~35번, 'A'~'Z' 는 36~61번. '.' 은 투명한 빈칸입니다.
- palette 는 "#rrggbb" 색 목록입니다. 보통 4~16색이면 충분합니다.
- 좋은 픽셀 아트처럼: 물체를 가운데에 크게, 진한 외곽선(검정에 가까운 어두운 색), 왼쪽 위에서 오는 빛(밝은 면과 어두운 면), 배경은 투명하게.
- 현재 그림(current)이 있고 사용자가 고쳐 달라고 하면, 그 그림을 바탕으로 필요한 부분만 바꾼 전체 그림을 다시 보내세요.
- message 에는 무엇을 그렸는지 한국어로 짧고 친절하게 쓰세요.`;

export const AI_TOOL: NonNullable<AIRequest["tool"]> = {
  name: "draw_pixel_art",
  description: "픽셀 그림 한 장을 그린다.",
  input_schema: {
    type: "object",
    properties: {
      message: { type: "string", description: "사용자에게 보여 줄 짧은 설명 (한국어)" },
      palette: { type: "array", items: { type: "string" }, maxItems: 62, description: '"#rrggbb" 색 목록' },
      rows: { type: "array", items: { type: "string" }, description: "한 줄에 한 문자열. 글자 하나가 칸 하나." },
    },
    required: ["message", "palette", "rows"],
  },
};

/** 지금 레이어를 글자 그림으로. 색이 너무 많거나 비어 있으면 null. */
function layerToRows(doc: PixelDoc): PixelRows | null {
  const { width, height } = doc;
  const data = doc.activeLayer.raster.data;
  const palette: string[] = [];
  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    let row = "";
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 128) {
        row += ".";
        continue;
      }
      const hex = rgbaToHex([data[i], data[i + 1], data[i + 2]]);
      let index = palette.indexOf(hex);
      if (index < 0) {
        if (palette.length >= ROW_ALPHABET.length) return null;
        index = palette.push(hex) - 1;
      }
      row += ROW_ALPHABET[index];
    }
    rows.push(row);
  }
  return palette.length ? { palette, rows } : null;
}

/** AI 가 그릴 크기: 캔버스가 크면 같은 비율로 줄인 크기 */
export function aiSize(doc: PixelDoc) {
  const factor = Math.ceil(Math.max(doc.width, doc.height) / AI_MAX_SIZE);
  return { width: Math.floor(doc.width / factor), height: Math.floor(doc.height / factor), factor };
}

export function aiContext(doc: PixelDoc) {
  const size = aiSize(doc);
  return {
    canvas: `${doc.width}x${doc.height}`,
    draw_size: `가로 ${size.width} × 세로 ${size.height} (rows ${size.height}줄, 줄마다 ${size.width}글자)`,
    layer: doc.activeLayer.name,
    current: size.factor === 1 ? layerToRows(doc) : null,
  };
}

export interface AIPixelArt {
  message?: string;
  palette?: unknown;
  rows?: unknown;
}

/** AI 의 답을 지금 레이어에 그리고, 대화창에 보여 줄 문장을 돌려준다. */
export function applyAIArt(doc: PixelDoc, input: AIPixelArt): string {
  const palette = Array.isArray(input.palette) ? input.palette.filter((c): c is string => typeof c === "string") : [];
  const rows = Array.isArray(input.rows) ? input.rows.filter((r): r is string => typeof r === "string") : [];
  if (!palette.length || !rows.length) throw new Error("AI 가 그림을 보내지 않았어요. 다시 부탁해 주세요.");
  const { width, height } = aiSize(doc);
  // 너무 크면 자르고, 작으면 drawRows 가 키워서 가운데에 놓는다.
  const fitted = rows.slice(0, height).map((r) => r.slice(0, width));
  if (!doc.activeLayer.visible) doc.toggleVisible(doc.active);
  doc.drawRows({ palette, rows: fitted });
  return `${input.message ?? "그렸어요."}\n(‘${doc.activeLayer.name}’ 레이어에 그렸어요. 마음에 안 들면 Ctrl+Z)`;
}
