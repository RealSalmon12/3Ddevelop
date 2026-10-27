import type { AIRequest } from "@suite/shell/bridge";
import { clipLength, newId, totalLength, type Caption, type Project } from "./project";

export const AI_SYSTEM = `당신은 초보자를 돕는 쇼츠·영상 자막 작가입니다. 사용자의 영상 조각 목록과 길이를 보고 자막을 만들어 주세요.
항상 write_captions 도구로 답하세요.
- captions: start, end 는 초 (0 ~ 전체 길이). 한 자막은 1.5~4초, 서로 겹치지 않게. 글은 짧고 재미있게 (한 줄 15자 이내, 필요하면 \\n 으로 두 줄).
- position: top(제목), middle(강조), bottom(일반 자막). size: small/medium/large. color: "#rrggbb" (보통 흰색, 강조는 노랑 #ffd23f).
- replace: true 면 원래 자막을 지우고 새로 넣습니다.
- message 에는 무엇을 했는지 한국어로 짧게.`;

export const AI_TOOL: NonNullable<AIRequest["tool"]> = {
  name: "write_captions",
  description: "영상에 자막을 넣는다.",
  input_schema: {
    type: "object",
    properties: {
      message: { type: "string" },
      replace: { type: "boolean" },
      captions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            start: { type: "number" },
            end: { type: "number" },
            position: { type: "string", enum: ["top", "middle", "bottom"] },
            size: { type: "string", enum: ["small", "medium", "large"] },
            color: { type: "string" },
          },
          required: ["text", "start", "end"],
        },
      },
    },
    required: ["message", "captions"],
  },
};

export function aiContext(p: Project) {
  let t = 0;
  return {
    total_seconds: Math.round(totalLength(p) * 10) / 10,
    shape: p.portrait ? "세로 (쇼츠)" : "가로",
    clips: p.clips.map((c) => {
      const item = { name: c.name, kind: c.kind === "video" ? "영상" : "사진", from: Math.round(t * 10) / 10, to: Math.round((t + clipLength(c)) * 10) / 10 };
      t += clipLength(c);
      return item;
    }),
    captions: p.captions.map(({ text, start, end }) => ({ text, start, end })),
  };
}

interface AICaption {
  text?: unknown;
  start?: unknown;
  end?: unknown;
  position?: unknown;
  size?: unknown;
  color?: unknown;
}

export function applyAICaptions(p: Project, input: { captions?: AICaption[]; replace?: boolean }): Project {
  const total = totalLength(p) || 60;
  const made: Caption[] = (input.captions ?? [])
    .filter((c) => typeof c.text === "string" && c.text.trim() && typeof c.start === "number" && typeof c.end === "number")
    .map((c) => {
      const start = Math.max(0, Math.min(total, c.start as number));
      return {
        id: newId(),
        text: (c.text as string).trim(),
        start,
        end: Math.max(start + 0.3, Math.min(total, c.end as number)),
        position: (["top", "middle", "bottom"].includes(c.position as string) ? c.position : "bottom") as Caption["position"],
        size: (["small", "medium", "large"].includes(c.size as string) ? c.size : "medium") as Caption["size"],
        color: /^#[0-9a-f]{6}$/i.test((c.color as string) ?? "") ? (c.color as string) : "#ffffff",
      };
    });
  return { ...p, captions: [...(input.replace ? [] : p.captions), ...made].sort((a, b) => a.start - b.start) };
}
