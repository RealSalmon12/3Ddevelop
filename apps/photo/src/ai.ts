import type { AIRequest } from "@suite/shell/bridge";
import { newTextLayer, NO_ADJUST, type QuickAdjust as Adjust, type RasterLayer, type PhotoDoc, type TextLayer } from "./model";
import { flatten } from "./render";

export const AI_SYSTEM = `당신은 초보자를 돕는 사진 편집 도우미입니다. 사용자는 유튜브 썸네일, 로블록스 게임 아이콘·썸네일 같은 그림을 만듭니다.
항상 edit_photo 도구로 답하세요. 함께 온 그림이 지금 작업 화면입니다.
- adjust: 사진 보정. brightness/contrast/saturation 은 100 이 원래대로 (50~160 사이), warmth 는 -100(시원) ~ 100(따뜻), blur 는 0~10, grayscale 은 흑백.
  사진 레이어가 있을 때만 쓰고, 바꿀 값만 넣으세요.
- texts: 새로 넣을 글자. 썸네일 글자는 짧고 굵게(2~8자), 사진과 대비되는 색, 진한 테두리. position 은 top / middle / bottom.
- remove_texts: true 면 원래 있던 글자 레이어를 모두 지우고 새로 넣습니다 (글자를 바꿔 달라고 할 때).
- background: 사진이 없을 때 배경색 "#rrggbb".
- message 에는 무엇을 했는지 한국어로 짧고 친절하게 쓰세요.`;

export const AI_TOOL: NonNullable<AIRequest["tool"]> = {
  name: "edit_photo",
  description: "사진을 보정하고 글자를 넣는다.",
  input_schema: {
    type: "object",
    properties: {
      message: { type: "string" },
      adjust: {
        type: "object",
        properties: {
          brightness: { type: "number" },
          contrast: { type: "number" },
          saturation: { type: "number" },
          warmth: { type: "number" },
          blur: { type: "number" },
          grayscale: { type: "boolean" },
        },
      },
      texts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            position: { type: "string", enum: ["top", "middle", "bottom"] },
            color: { type: "string" },
            stroke_color: { type: "string" },
            size: { type: "string", enum: ["small", "medium", "large"] },
          },
          required: ["text"],
        },
      },
      remove_texts: { type: "boolean" },
      background: { type: "string" },
    },
    required: ["message"],
  },
};

export interface AIEdit {
  message?: string;
  adjust?: Partial<Adjust>;
  texts?: { text: string; position?: string; color?: string; stroke_color?: string; size?: string }[];
  remove_texts?: boolean;
  background?: string;
}

const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;

export function aiContext(doc: PhotoDoc) {
  return {
    size: `${doc.width}x${doc.height}`,
    background: doc.background,
    layers: doc.layers.map((l) =>
      l.kind === "text" ? { kind: "글자", text: l.text } : l.kind === "raster" ? { kind: "사진", name: l.name, adjust: l.adjust } : { kind: l.kind === "adjust" ? "보정 레이어" : "도형", name: l.name },
    ),
  };
}

/** AI 가 볼 작은 그림 (긴 쪽 768px JPEG) */
export function aiImages(doc: PhotoDoc): AIRequest["images"] {
  const scale = Math.min(1, 768 / Math.max(doc.width, doc.height));
  const canvas = flatten({ ...doc, background: doc.background ?? "#ffffff" }, scale);
  return [{ mediaType: "image/jpeg", data: canvas.toDataURL("image/jpeg", 0.8).split(",")[1] }];
}

/** AI 의 답을 문서에 적용한 새 문서 */
export function applyAIEdit(doc: PhotoDoc, edit: AIEdit): PhotoDoc {
  let layers = doc.layers;
  if (edit.adjust) {
    const a = edit.adjust;
    layers = layers.map((l): typeof l => {
      if (l.kind !== "raster") return l;
      const cur = l.adjust;
      const adjust: Adjust = {
        brightness: clamp(a.brightness, 30, 200, cur.brightness),
        contrast: clamp(a.contrast, 30, 200, cur.contrast),
        saturation: clamp(a.saturation, 0, 250, cur.saturation),
        warmth: clamp(a.warmth, -100, 100, cur.warmth),
        blur: clamp(a.blur, 0, 20, cur.blur),
        grayscale: typeof a.grayscale === "boolean" ? a.grayscale : cur.grayscale,
      };
      return { ...(l as RasterLayer), adjust };
    });
  }
  if (edit.remove_texts) layers = layers.filter((l) => l.kind !== "text");
  const texts = (edit.texts ?? []).filter((t) => t && typeof t.text === "string" && t.text.trim());
  const added: TextLayer[] = texts.map((t) => {
    const base = newTextLayer(doc, t.text.trim());
    const short = Math.min(doc.width, doc.height);
    const size = Math.round(short * (t.size === "small" ? 0.08 : t.size === "medium" ? 0.12 : 0.17));
    const y = t.position === "top" ? doc.height * 0.2 : t.position === "bottom" ? doc.height * 0.8 : doc.height / 2;
    return {
      ...base,
      name: `글자: ${t.text.trim().slice(0, 10)}`,
      y,
      size,
      strokeWidth: Math.max(2, Math.round(size / 12)),
      color: HEX.test(t.color ?? "") ? t.color! : base.color,
      strokeColor: HEX.test(t.stroke_color ?? "") ? t.stroke_color! : base.strokeColor,
    };
  });
  return {
    ...doc,
    background: HEX.test(edit.background ?? "") ? edit.background! : doc.background,
    layers: [...layers, ...added],
  };
}

export { NO_ADJUST };
