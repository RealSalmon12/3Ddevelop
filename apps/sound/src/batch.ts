// 일괄 처리 (오디션의 일괄 처리 + 라우드니스 맞추기 패널): 여러 소리 파일에 같은 처리 순서를 걸어 폴더에 저장한다.
import { lengthOf, type Range, type Sound } from "./audio";
import * as D from "./dsp";
import { renderRack, type Fx } from "./effects";

export type BatchStep =
  | { kind: "trim"; db: number }
  | { kind: "dc" }
  | { kind: "declick"; sens: number }
  | { kind: "gate"; threshold: number; reduce: number; hold: number }
  | { kind: "rack"; rack: Fx[] }
  | { kind: "loudness"; target: number }
  | { kind: "normalize"; db: number }
  | { kind: "limit"; ceiling: number }
  | { kind: "fadeIn"; ms: number }
  | { kind: "fadeOut"; ms: number }
  | { kind: "tempo"; rate: number }
  | { kind: "pitch"; semi: number }
  | { kind: "mono" }
  | { kind: "stereo" };

export type StepKind = BatchStep["kind"];

export interface StepField {
  key: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  unit?: string;
}

export const STEP_INFO: { kind: StepKind; label: string; hint: string; fields: StepField[]; make: () => BatchStep }[] = [
  { kind: "trim", label: "앞뒤 무음 자르기", hint: "처음과 끝의 조용한 부분을 잘라요", fields: [{ key: "db", label: "조용함 기준", min: -80, max: -20, unit: "dB" }], make: () => ({ kind: "trim", db: -50 }) },
  { kind: "dc", label: "DC 오프셋 없애기", hint: "파형이 한쪽으로 치우친 것을 가운데로", fields: [], make: () => ({ kind: "dc" }) },
  { kind: "declick", label: "클릭·팝 지우기", hint: "짧게 튀는 딸깍 소리를 메워요", fields: [{ key: "sens", label: "민감도", min: 1, max: 10 }], make: () => ({ kind: "declick", sens: 5 }) },
  {
    kind: "gate",
    label: "노이즈 게이트",
    hint: "말하지 않을 때의 작은 잡음을 줄여요",
    fields: [
      { key: "threshold", label: "문턱", min: -80, max: -10, unit: "dB" },
      { key: "reduce", label: "줄이는 양", min: -80, max: 0, unit: "dB" },
      { key: "hold", label: "유지", min: 5, max: 500, unit: "ms" },
    ],
    make: () => ({ kind: "gate", threshold: -45, reduce: -40, hold: 60 }),
  },
  { kind: "rack", label: "효과 랙 (지금 설정)", hint: "효과 랙에 걸어 둔 EQ, 컴프레서, 리버브… 를 그대로", fields: [], make: () => ({ kind: "rack", rack: [] }) },
  { kind: "loudness", label: "라우드니스 맞추기", hint: "귀에 들리는 크기를 목표 LUFS 로 (넘치면 -1dB 로 눌러요)", fields: [{ key: "target", label: "목표", min: -30, max: -8, step: 0.5, unit: "LUFS" }], make: () => ({ kind: "loudness", target: -14 }) },
  { kind: "normalize", label: "노멀라이즈", hint: "가장 큰 소리를 정한 크기로", fields: [{ key: "db", label: "최대 크기", min: -20, max: 0, step: 0.1, unit: "dBFS" }], make: () => ({ kind: "normalize", db: -1 }) },
  { kind: "limit", label: "하드 리미터", hint: "정한 크기를 넘지 않게", fields: [{ key: "ceiling", label: "천장", min: -12, max: 0, step: 0.1, unit: "dB" }], make: () => ({ kind: "limit", ceiling: -1 }) },
  { kind: "fadeIn", label: "페이드 인", hint: "시작을 부드럽게", fields: [{ key: "ms", label: "길이", min: 1, max: 5000, unit: "ms" }], make: () => ({ kind: "fadeIn", ms: 10 }) },
  { kind: "fadeOut", label: "페이드 아웃", hint: "끝을 부드럽게 (끝의 딸깍 소리 막기)", fields: [{ key: "ms", label: "길이", min: 1, max: 5000, unit: "ms" }], make: () => ({ kind: "fadeOut", ms: 30 }) },
  { kind: "tempo", label: "템포 바꾸기", hint: "음높이는 그대로 빠르기만", fields: [{ key: "rate", label: "빠르기", min: 50, max: 200, unit: "%" }], make: () => ({ kind: "tempo", rate: 110 }) },
  { kind: "pitch", label: "음높이 바꾸기", hint: "길이는 그대로 반음 단위로", fields: [{ key: "semi", label: "반음", min: -12, max: 12, step: 0.5 }], make: () => ({ kind: "pitch", semi: 2 }) },
  { kind: "mono", label: "모노로", hint: "두 채널을 하나로", fields: [], make: () => ({ kind: "mono" }) },
  { kind: "stereo", label: "스테레오로", hint: "한 채널을 양쪽으로", fields: [], make: () => ({ kind: "stereo" }) },
];

export const CHAIN_PRESETS: { label: string; steps: BatchStep[] }[] = [
  {
    label: "게임 효과음 정리 (-18 LUFS)",
    steps: [{ kind: "dc" }, { kind: "trim", db: -50 }, { kind: "loudness", target: -18 }, { kind: "fadeOut", ms: 8 }],
  },
  {
    label: "목소리·팟캐스트 (-16 LUFS)",
    steps: [{ kind: "dc" }, { kind: "declick", sens: 5 }, { kind: "gate", threshold: -45, reduce: -30, hold: 80 }, { kind: "loudness", target: -16 }],
  },
  { label: "음악 (유튜브·로블록스 -14 LUFS)", steps: [{ kind: "loudness", target: -14 }, { kind: "limit", ceiling: -1 }] },
  { label: "최대 크기만 맞추기 (-1 dB)", steps: [{ kind: "normalize", db: -1 }] },
];

export const describeStep = (s: BatchStep) => STEP_INFO.find((x) => x.kind === s.kind)!.label;

const all = (s: Sound): Range => ({ start: 0, end: lengthOf(s) });

export async function runChain(input: Sound, steps: BatchStep[]): Promise<Sound> {
  let s = input;
  for (const st of steps) {
    if (!lengthOf(s)) break;
    const sr = s.sampleRate;
    switch (st.kind) {
      case "trim":
        s = D.trimSilence(s, st.db);
        break;
      case "dc":
        s = D.removeDc(s, all(s));
        break;
      case "declick":
        s = D.declick(s, all(s), st.sens).sound;
        break;
      case "gate":
        s = D.gate(s, all(s), st.threshold, st.reduce, st.hold);
        break;
      case "rack":
        if (st.rack.some((f) => f.on)) s = await renderRack(s, all(s), st.rack);
        break;
      case "loudness":
        s = D.matchLoudness(s, all(s), st.target);
        break;
      case "normalize":
        s = D.normalizePeak(s, all(s), st.db);
        break;
      case "limit":
        s = D.limit(s, all(s), st.ceiling);
        break;
      case "fadeIn":
        s = D.fade(s, { start: 0, end: Math.min(lengthOf(s), Math.round((st.ms / 1000) * sr)) }, "in", "s");
        break;
      case "fadeOut": {
        const n = lengthOf(s);
        s = D.fade(s, { start: Math.max(0, n - Math.round((st.ms / 1000) * sr)), end: n }, "out", "s");
        break;
      }
      case "tempo":
        s = D.changeTempo(s, all(s), st.rate / 100);
        break;
      case "pitch":
        s = D.changePitch(s, all(s), st.semi);
        break;
      case "mono":
        if (s.channels.length > 1) s = D.toMono(s);
        break;
      case "stereo":
        if (s.channels.length === 1) s = D.toStereo(s);
        break;
    }
  }
  return s;
}

export const measure = (s: Sound) => {
  const st = D.stats(s, all(s));
  return { lufs: st.lufs, peak: st.peakDb, seconds: lengthOf(s) / s.sampleRate };
};

const STORE = "sound-batch-chain";

export function loadChain(): BatchStep[] {
  try {
    const raw = localStorage.getItem(STORE);
    const list = raw ? (JSON.parse(raw) as BatchStep[]) : null;
    if (Array.isArray(list) && list.every((s) => STEP_INFO.some((x) => x.kind === s?.kind))) return list;
  } catch {
    // 처음
  }
  return structuredClone(CHAIN_PRESETS[0].steps);
}

export function saveChain(steps: BatchStep[]) {
  try {
    // 효과 랙 단계는 열 때마다 지금 랙을 쓰므로 저장하지 않는다
    localStorage.setItem(STORE, JSON.stringify(steps.map((s) => (s.kind === "rack" ? { kind: "rack", rack: [] } : s))));
  } catch {
    // 저장소를 못 쓰면 이번만
  }
}
