import type { AIRequest } from "@suite/shell/bridge";
import { clearRange, clipEnd, DEFAULT_TEXT, defaultParams, NEUTRAL_COLOR, newId, projectDuration, type Clip, type Project } from "./model";

export const AI_SYSTEM = `당신은 초보자를 돕는 쇼츠·영상 자막 작가입니다. 사용자의 시퀀스(트랙과 클립 목록, 길이)를 보고 자막을 만들어 주세요.
항상 write_captions 도구로 답하세요.
- captions: start, end 는 시퀀스의 초 (0 ~ 전체 길이). 한 자막은 1.5~4초, 서로 겹치지 않게. 글은 짧고 재미있게 (한 줄 15자 이내, 필요하면 \\n 으로 두 줄).
- position: top(제목), middle(강조), bottom(일반 자막). size: small/medium/large. color: "#rrggbb" (보통 흰색, 강조는 노랑 #ffd23f).
- 자막은 가장 위 영상 트랙에 글자 클립으로 들어갑니다. replace: true 면 그 트랙의 원래 글자 클립을 지우고 새로 넣습니다.
- message 에는 무엇을 했는지 한국어로 짧게.`;

export const AI_TOOL: NonNullable<AIRequest["tool"]> = {
  name: "write_captions",
  description: "영상에 자막(글자 클립)을 넣는다.",
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

const round = (n: number) => Math.round(n * 10) / 10;

export function aiContext(p: Project) {
  const { width, height } = p.sequence;
  return {
    total_seconds: round(projectDuration(p)),
    frame: `${width}×${height} (${height > width ? "세로, 쇼츠" : width === height ? "정사각형" : "가로"})`,
    tracks: p.tracks.map((t) => ({
      track: t.name,
      clips: p.clips
        .filter((c) => c.track === t.id)
        .sort((a, b) => a.start - b.start)
        .map((c) => ({ name: c.kind === "text" ? `글자: ${c.text?.text ?? ""}` : c.name, kind: c.kind, from: round(c.start), to: round(clipEnd(c)) })),
    })),
    markers: p.markers.map((m) => ({ t: round(m.t), label: m.label })),
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

const SIZES = { small: 0.045, medium: 0.065, large: 0.095 };

/** AI 자막을 가장 위 영상 트랙에 글자 클립으로 넣는다. */
export function applyAICaptions(p: Project, input: { captions?: AICaption[]; replace?: boolean }): Project {
  const track = p.tracks.find((t) => t.kind === "video" && !t.locked);
  if (!track) return p;
  const total = projectDuration(p) || 60;
  const { width, height } = p.sequence;
  const short = Math.min(width, height);
  let clips = input.replace ? p.clips.filter((c) => !(c.track === track.id && c.kind === "text")) : p.clips;
  for (const c of input.captions ?? []) {
    if (typeof c.text !== "string" || !c.text.trim() || typeof c.start !== "number" || typeof c.end !== "number") continue;
    const start = Math.max(0, Math.min(total, c.start));
    const end = Math.max(start + 0.3, Math.min(total, c.end));
    const position = (["top", "middle", "bottom"].includes(c.position as string) ? c.position : "bottom") as "top" | "middle" | "bottom";
    const size = SIZES[(c.size as keyof typeof SIZES) in SIZES ? (c.size as keyof typeof SIZES) : "medium"];
    const params = defaultParams();
    params.y.value = position === "top" ? -height * 0.36 : position === "bottom" ? height * 0.36 : 0;
    const clip: Clip = {
      id: newId(),
      kind: "text",
      name: "자막",
      track: track.id,
      start,
      in: 0,
      out: end - start,
      speed: 1,
      params,
      color: { ...NEUTRAL_COLOR },
      fadeIn: 0.1,
      fadeOut: 0.1,
      text: {
        ...DEFAULT_TEXT,
        text: c.text.trim(),
        size: Math.round(short * size * (position === "top" ? 1.2 : 1)),
        color: /^#[0-9a-f]{6}$/i.test((c.color as string) ?? "") ? (c.color as string) : "#ffffff",
        stroke: Math.round(short * 0.006),
      },
    };
    clips = [...clearRange(clips, track.id, start, end), clip];
  }
  return { ...p, clips };
}
