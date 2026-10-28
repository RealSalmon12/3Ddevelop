/**
 * 액션 (포토샵의 액션 패널): 메뉴로 한 작업을 순서대로 기록해 두었다가 다른 사진에 그대로 다시 한다.
 * 붓질처럼 손으로 그린 작업은 사진마다 달라서 기록하지 않는다. 크기와 위치는 그림 크기에 대한 비율로 남겨
 * 크기가 다른 사진에도 같은 자리에 들어간다.
 */
import {
  ADJUSTMENTS,
  NO_EFFECTS,
  newAdjustLayer,
  newTextLayer,
  type AdjustKind,
  type AdjustSettings,
  type BlendMode,
  type Effects,
  type Layer,
  type PhotoDoc,
  type QuickAdjust,
  type TextLayer,
} from "./model";
import { canvasSize, cropDoc, editTarget, flipDoc, insertAbove, mergeVisible, pixelTarget, replaceLayer, replaceTarget, resampleDoc, rotateDoc } from "./ops";
import { applyFilter, FILTERS, opaqueBounds, type FilterKind } from "./paint";
import { flatten } from "./render";

/** 사진 크기에 따라 달라지는 글자 레이어 값은 비율로 */
export interface TextStep {
  text: string;
  /** 가운데 위치 (그림 너비·높이에 대한 비율) */
  rx: number;
  ry: number;
  /** 글자 크기, 테두리 두께 (짧은 변에 대한 비율) */
  rsize: number;
  rstroke: number;
  color: string;
  bold: boolean;
  font: string;
  strokeColor: string;
  shadow: boolean;
  align: TextLayer["align"];
  opacity: number;
  blend: BlendMode;
  rotation: number;
  effects: Effects;
}

export type Step =
  | { op: "resize"; mode: "long" | "exact" | "percent"; width: number; height: number; percent?: number }
  | { op: "canvas"; width: number; height: number; ax: number; ay: number }
  | { op: "rotate"; dir: 1 | -1 }
  | { op: "flip"; horizontal: boolean }
  /** 비율로 자르기 (0~1) */
  | { op: "crop"; rx: number; ry: number; rw: number; rh: number }
  /** 가운데에서 가로:세로 비율로 자르기 */
  | { op: "cropRatio"; w: number; h: number }
  | { op: "trim" }
  | { op: "filter"; kind: FilterKind; amount: number }
  | { op: "adjust"; kind: AdjustKind; settings: AdjustSettings[AdjustKind]; opacity: number; blend: BlendMode }
  | ({ op: "text" } & TextStep)
  /** 지금 레이어의 빠른 보정, 불투명도, 혼합, 스타일 */
  | { op: "style"; adjust?: QuickAdjust; opacity: number; blend: BlendMode; effects: Effects }
  | { op: "mergeVisible" }
  | { op: "flatten" };

export interface ActionStep {
  step: Step;
  /** 끄면 실행할 때 건너뛴다 */
  on: boolean;
  /** 기록하는 동안 이 단계가 따라가는 레이어 (기록이 끝나면 의미 없음) */
  ref?: number;
}

export interface PhotoAction {
  id: string;
  name: string;
  steps: ActionStep[];
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** 단계 설명 (패널에 보여 줄 글) */
export function describe(s: Step): string {
  switch (s.op) {
    case "resize":
      return s.mode === "long" ? `이미지 크기: 긴 변 ${Math.max(s.width, s.height)}px` : s.mode === "percent" ? `이미지 크기: ${s.percent}%` : `이미지 크기: ${s.width}×${s.height}`;
    case "canvas":
      return `캔버스 크기: ${s.width}×${s.height}`;
    case "rotate":
      return s.dir === 1 ? "시계 방향 90° 회전" : "반시계 방향 90° 회전";
    case "flip":
      return s.horizontal ? "캔버스 좌우 뒤집기" : "캔버스 상하 뒤집기";
    case "crop":
      return `자르기: 가로 ${pct(s.rw)} × 세로 ${pct(s.rh)}`;
    case "cropRatio":
      return `가운데 ${s.w}:${s.h} 로 자르기`;
    case "trim":
      return "투명한 여백 잘라내기";
    case "filter":
      return `필터: ${FILTERS.find((f) => f.kind === s.kind)?.label ?? s.kind} (${s.amount})`;
    case "adjust":
      return `조정 레이어: ${ADJUSTMENTS.find((a) => a.kind === s.kind)?.label ?? s.kind}`;
    case "text":
      return `글자: “${s.text.length > 14 ? `${s.text.slice(0, 14)}…` : s.text}”`;
    case "style":
      return "레이어 보정·스타일 바꾸기";
    case "mergeVisible":
      return "보이는 레이어 병합";
    case "flatten":
      return "이미지 병합 (모두 하나로)";
  }
}

export function textStep(layer: TextLayer, doc: PhotoDoc): { op: "text" } & TextStep {
  const short = Math.min(doc.width, doc.height);
  return {
    op: "text",
    text: layer.text,
    rx: layer.x / doc.width,
    ry: layer.y / doc.height,
    rsize: (layer.size * layer.scale) / short,
    rstroke: (layer.strokeWidth * layer.scale) / short,
    color: layer.color,
    bold: layer.bold,
    font: layer.font,
    strokeColor: layer.strokeColor,
    shadow: layer.shadow,
    align: layer.align,
    opacity: layer.opacity,
    blend: layer.blend,
    rotation: layer.rotation,
    effects: layer.effects,
  };
}

/** 기록 중에 따라가는 레이어가 바뀌었으면 그 단계를 새 값으로 */
export function syncStep(s: ActionStep, layer: Layer, doc: PhotoDoc): ActionStep {
  if (s.step.op === "text" && layer.kind === "text") return { ...s, step: textStep(layer, doc) };
  if (s.step.op === "adjust" && layer.kind === "adjust") return { ...s, step: { ...s.step, settings: structuredClone(layer.settings), opacity: layer.opacity, blend: layer.blend } };
  if (s.step.op === "style") return { ...s, step: { op: "style", adjust: layer.kind === "raster" ? layer.adjust : undefined, opacity: layer.opacity, blend: layer.blend, effects: layer.effects } };
  return s;
}

export interface PlayResult {
  doc: PhotoDoc;
  /** 실행한 뒤 고를 레이어 */
  current: number | null;
  /** 건너뛴 단계와 이유 */
  skipped: string[];
}

/** 맨 위의 픽셀 레이어 */
const topRaster = (doc: PhotoDoc) => [...doc.layers].reverse().find((l) => l.kind === "raster" && l.visible && !l.locked) ?? null;

/** 액션 하나를 문서에 실행한다. current 는 지금 고른 레이어 (필터, 스타일이 걸릴 곳) */
export async function playAction(action: PhotoAction, start: PhotoDoc, current: number | null): Promise<PlayResult> {
  let doc = start;
  let cur = current;
  const skipped: string[] = [];
  const layer = () => doc.layers.find((l) => l.id === cur) ?? null;
  for (const { step: s, on } of action.steps) {
    if (!on) continue;
    switch (s.op) {
      case "resize": {
        let w = s.width;
        let h = s.height;
        if (s.mode === "long") {
          const k = Math.max(s.width, s.height) / Math.max(doc.width, doc.height);
          w = doc.width * k;
          h = doc.height * k;
        } else if (s.mode === "percent") {
          w = (doc.width * (s.percent ?? 100)) / 100;
          h = (doc.height * (s.percent ?? 100)) / 100;
        }
        doc = resampleDoc(doc, Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
        break;
      }
      case "canvas":
        doc = canvasSize(doc, s.width, s.height, s.ax, s.ay);
        break;
      case "rotate":
        doc = rotateDoc(doc, s.dir);
        break;
      case "flip":
        doc = flipDoc(doc, s.horizontal);
        break;
      case "crop":
        doc = cropDoc(doc, { x: s.rx * doc.width, y: s.ry * doc.height, w: Math.max(1, s.rw * doc.width), h: Math.max(1, s.rh * doc.height) });
        break;
      case "cropRatio": {
        const w = Math.min(doc.width, (doc.height * s.w) / s.h);
        const h = (w * s.h) / s.w;
        doc = cropDoc(doc, { x: Math.round((doc.width - w) / 2), y: Math.round((doc.height - h) / 2), w: Math.round(w), h: Math.round(h) });
        break;
      }
      case "trim": {
        const b = opaqueBounds(flatten({ ...doc, background: null }));
        if (b) doc = cropDoc(doc, b);
        break;
      }
      case "filter": {
        let t = pixelTarget(doc, layer(), false);
        if (typeof t === "string") t = pixelTarget(doc, topRaster(doc), false);
        if (typeof t === "string") {
          skipped.push(`${describe(s)}: 픽셀 레이어가 없어요`);
          break;
        }
        const tt = t;
        const id = await editTarget(tt, null, (b) => applyFilter(b, s.kind, s.amount, null));
        if (id) doc = replaceTarget(doc, tt.layer.id, tt.kind, id);
        cur = tt.layer.id;
        break;
      }
      case "adjust": {
        const l = { ...newAdjustLayer(doc, s.kind), settings: structuredClone(s.settings), opacity: s.opacity, blend: s.blend };
        doc = insertAbove(doc, l, null);
        cur = l.id;
        break;
      }
      case "text": {
        const short = Math.min(doc.width, doc.height);
        const base = newTextLayer(doc, s.text);
        const l: TextLayer = {
          ...base,
          x: s.rx * doc.width,
          y: s.ry * doc.height,
          size: Math.max(1, Math.round(s.rsize * short)),
          strokeWidth: s.rstroke * short,
          color: s.color,
          bold: s.bold,
          font: s.font,
          strokeColor: s.strokeColor,
          shadow: s.shadow,
          align: s.align,
          opacity: s.opacity,
          blend: s.blend,
          rotation: s.rotation,
          effects: s.effects,
        };
        doc = insertAbove(doc, l, null);
        cur = l.id;
        break;
      }
      case "style": {
        const l = layer() ?? topRaster(doc);
        if (!l) {
          skipped.push(`${describe(s)}: 레이어가 없어요`);
          break;
        }
        const next = { ...l, opacity: s.opacity, blend: s.blend, effects: s.effects } as Layer;
        if (next.kind === "raster" && s.adjust) next.adjust = s.adjust;
        doc = replaceLayer(doc, next);
        cur = l.id;
        break;
      }
      case "mergeVisible":
        doc = mergeVisible(doc, false);
        cur = topRaster(doc)?.id ?? null;
        break;
      case "flatten":
        doc = mergeVisible(doc, true);
        cur = topRaster(doc)?.id ?? null;
        break;
    }
  }
  return { doc, current: cur, skipped };
}

const step = (s: Step): ActionStep => ({ step: s, on: true });

/** 처음부터 들어 있는 액션 (포토샵의 기본 액션처럼) */
export const DEFAULT_ACTIONS: PhotoAction[] = [
  { id: "web1920", name: "웹용: 긴 변 1920px", steps: [step({ op: "resize", mode: "long", width: 1920, height: 1920 }), step({ op: "filter", kind: "sharpen", amount: 40 })] },
  { id: "insta", name: "인스타 정사각형 1080", steps: [step({ op: "cropRatio", w: 1, h: 1 }), step({ op: "resize", mode: "exact", width: 1080, height: 1080 })] },
  { id: "thumb", name: "유튜브 썸네일 16:9 (1280×720)", steps: [step({ op: "cropRatio", w: 16, h: 9 }), step({ op: "resize", mode: "exact", width: 1280, height: 720 })] },
  {
    id: "mono",
    name: "흑백 사진 (대비 살짝)",
    steps: [
      step({ op: "adjust", kind: "bw", settings: { tint: null }, opacity: 1, blend: "source-over" }),
      step({ op: "adjust", kind: "brightness", settings: { brightness: 0, contrast: 18 }, opacity: 1, blend: "source-over" }),
    ],
  },
  {
    id: "vivid",
    name: "선명하고 생생하게",
    steps: [
      step({ op: "adjust", kind: "vibrance", settings: { vibrance: 30, saturation: 5 }, opacity: 1, blend: "source-over" }),
      step({ op: "adjust", kind: "brightness", settings: { brightness: 4, contrast: 12 }, opacity: 1, blend: "source-over" }),
      step({ op: "flatten" }),
      step({ op: "filter", kind: "sharpen", amount: 60 }),
    ],
  },
  {
    id: "watermark",
    name: "워터마크 (오른쪽 아래)",
    steps: [
      step({
        op: "text",
        text: "© 내 이름",
        rx: 0.86,
        ry: 0.93,
        rsize: 0.045,
        rstroke: 0,
        color: "#ffffff",
        bold: true,
        font: "Pretendard Variable",
        strokeColor: "#000000",
        shadow: true,
        align: "center",
        opacity: 0.7,
        blend: "source-over",
        rotation: 0,
        effects: NO_EFFECTS,
      }),
    ],
  },
];

const STORE = "photo-actions";

export function loadActions(): PhotoAction[] {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      const list = JSON.parse(raw) as PhotoAction[];
      if (Array.isArray(list)) return list;
    }
  } catch {
    // 처음이거나 망가진 값
  }
  return structuredClone(DEFAULT_ACTIONS);
}

export function saveActions(list: PhotoAction[]) {
  try {
    localStorage.setItem(STORE, JSON.stringify(list.map((a) => ({ ...a, steps: a.steps.map(({ step, on }) => ({ step, on })) }))));
  } catch {
    // 저장소를 못 쓰면 이번 실행에서만
  }
}

/** .bact 파일 (액션 나눠 주기) */
export function actionFile(list: PhotoAction[]) {
  return JSON.stringify({ app: "바코 진주", type: "actions", version: 1, actions: list.map((a) => ({ ...a, steps: a.steps.map(({ step, on }) => ({ step, on })) })) }, null, 1);
}

export function parseActionFile(text: string): PhotoAction[] {
  const j = JSON.parse(text);
  const list = Array.isArray(j) ? j : j.actions;
  if (!Array.isArray(list)) throw new Error("액션 파일이 아니에요");
  return list
    .filter((a) => a && typeof a.name === "string" && Array.isArray(a.steps))
    .map((a) => ({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: a.name, steps: a.steps.filter((s: ActionStep) => s && s.step && typeof s.step.op === "string") }));
}

export const newActionId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
