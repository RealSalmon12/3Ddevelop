import type { AIRequest } from "@suite/shell/bridge";
import type { SfxParams } from "./audio";

export const AI_SYSTEM = `당신은 초보자를 돕는 게임 효과음 디자이너입니다. 사용자가 말한 소리를 8비트 게임 효과음 합성기 설정으로 만들어 주세요.
항상 make_sound 도구로 답하세요.
- wave: square(게임기 소리), saw(날카로움), sine(부드러움), triangle(맑음), noise(폭발·바람·타격)
- start_freq, end_freq: 시작·끝 높이 Hz (40~3000). 올라가면 점프·파워업, 내려가면 레이저·실패
- duration: 초 (0.03~3), attack: 서서히 커지는 시간 초 (0~0.5)
- vibrato: 떨림 0~1, vibrato_speed: Hz, jump: 중간에 음이 뛰는 배율 (1 은 없음, 동전은 1.33)
- volume: 0~1 (보통 0.5)
- message 에는 어떤 소리를 만들었는지 한국어로 짧게.`;

export const AI_TOOL: NonNullable<AIRequest["tool"]> = {
  name: "make_sound",
  description: "효과음 합성기 설정을 정한다.",
  input_schema: {
    type: "object",
    properties: {
      message: { type: "string" },
      wave: { type: "string", enum: ["square", "saw", "sine", "triangle", "noise"] },
      start_freq: { type: "number" },
      end_freq: { type: "number" },
      duration: { type: "number" },
      attack: { type: "number" },
      vibrato: { type: "number" },
      vibrato_speed: { type: "number" },
      jump: { type: "number" },
      volume: { type: "number" },
    },
    required: ["message", "wave", "start_freq", "end_freq", "duration"],
  },
};

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);

export function toSfx(input: Record<string, unknown>): SfxParams {
  const waves = ["square", "saw", "sine", "triangle", "noise"];
  return {
    wave: (waves.includes(input.wave as string) ? input.wave : "square") as SfxParams["wave"],
    startFreq: num(input.start_freq, 40, 3000, 440),
    endFreq: num(input.end_freq, 40, 3000, 440),
    duration: num(input.duration, 0.03, 3, 0.3),
    attack: num(input.attack, 0, 0.5, 0),
    vibrato: num(input.vibrato, 0, 1, 0),
    vibratoSpeed: num(input.vibrato_speed, 0, 40, 8),
    jump: num(input.jump, 0.5, 3, 1),
    volume: num(input.volume, 0.05, 1, 0.5),
  };
}
