// 바코 진주 문서 (포토샵식 레이어 문서)
// 바꿀 때마다 새 객체를 만들어서, 실행 취소는 예전 객체로 돌아가기만 하면 된다.
// 픽셀은 문서 안에 직접 두지 않고 pixels.ts 의 저장소 id 로 가리킨다 (붓질 한 번마다 큰 글자열을 만들지 않으려고).

export type BlendMode =
  | "source-over"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

export const BLEND_MODES: { id: BlendMode; label: string }[] = [
  { id: "source-over", label: "표준" },
  { id: "multiply", label: "곱하기" },
  { id: "screen", label: "스크린" },
  { id: "overlay", label: "오버레이" },
  { id: "soft-light", label: "소프트 라이트" },
  { id: "hard-light", label: "하드 라이트" },
  { id: "darken", label: "어둡게 하기" },
  { id: "lighten", label: "밝게 하기" },
  { id: "color-dodge", label: "색상 닷지" },
  { id: "color-burn", label: "색상 번" },
  { id: "difference", label: "차이" },
  { id: "exclusion", label: "제외" },
  { id: "hue", label: "색조" },
  { id: "saturation", label: "채도" },
  { id: "color", label: "색상" },
  { id: "luminosity", label: "광도" },
];

/** 사진 레이어에 바로 거는 빠른 보정 (예전 파일과 AI 가 쓴다). 100 이 원래대로 */
export interface QuickAdjust {
  brightness: number;
  contrast: number;
  saturation: number;
  /** -100(시원하게) ~ 100(따뜻하게) */
  warmth: number;
  blur: number;
  grayscale: boolean;
}
export const NO_ADJUST: QuickAdjust = { brightness: 100, contrast: 100, saturation: 100, warmth: 0, blur: 0, grayscale: false };

/** 레이어 스타일 (fx) */
export interface Effects {
  shadow: { on: boolean; color: string; opacity: number; angle: number; distance: number; size: number };
  glow: { on: boolean; color: string; opacity: number; size: number };
  stroke: { on: boolean; color: string; size: number };
}
export const NO_EFFECTS: Effects = {
  shadow: { on: false, color: "#000000", opacity: 0.6, angle: 120, distance: 12, size: 16 },
  glow: { on: false, color: "#ffe680", opacity: 0.8, size: 24 },
  stroke: { on: false, color: "#ffffff", size: 6 },
};

/** 마스크: 레이어 자기 픽셀 공간(보정 레이어는 그림 전체) 크기의 그림. 알파가 보이는 정도 */
export interface Mask {
  src: string;
  enabled: boolean;
}

interface LayerBase {
  id: number;
  name: string;
  visible: boolean;
  /** 잠그면 옮기거나 칠할 수 없다 */
  locked: boolean;
  opacity: number;
  blend: BlendMode;
  /** 레이어 가운데의 위치 (그림 좌표) */
  x: number;
  y: number;
  scale: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  mask: Mask | null;
  effects: Effects;
  /** 클리핑 마스크: 바로 아래(클리핑되지 않은) 레이어 모양 안에만 보인다 */
  clip?: boolean;
}

/** 픽셀 레이어 (사진, 붓으로 그린 것) */
export interface RasterLayer extends LayerBase {
  kind: "raster";
  src: string;
  width: number;
  height: number;
  adjust: QuickAdjust;
}

export interface TextLayer extends LayerBase {
  kind: "text";
  text: string;
  size: number;
  color: string;
  bold: boolean;
  font: string;
  strokeColor: string;
  strokeWidth: number;
  shadow: boolean;
  align: "left" | "center" | "right";
}

export type ShapeKind = "rect" | "round" | "ellipse";
export interface ShapeLayer extends LayerBase {
  kind: "shape";
  shape: ShapeKind;
  width: number;
  height: number;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  radius: number;
}

export type AdjustKind = "levels" | "curves" | "hueSat" | "brightness" | "colorBalance" | "vibrance" | "bw" | "invert" | "threshold" | "posterize" | "gradientMap";

export interface AdjustSettings {
  /** 레벨: 입력 검정, 회색(감마), 흰색, 출력 검정, 흰색 */
  levels: { inBlack: number; gamma: number; inWhite: number; outBlack: number; outWhite: number };
  /** 곡선: 0~255 점들 (x 오름차순) */
  curves: { points: { x: number; y: number }[] };
  hueSat: { hue: number; saturation: number; lightness: number; colorize: boolean };
  brightness: { brightness: number; contrast: number };
  colorBalance: { cyanRed: number; magentaGreen: number; yellowBlue: number };
  vibrance: { vibrance: number; saturation: number };
  bw: { tint: string | null };
  invert: Record<string, never>;
  threshold: { level: number };
  posterize: { levels: number };
  gradientMap: { from: string; to: string };
}

export interface AdjustLayer<K extends AdjustKind = AdjustKind> extends LayerBase {
  kind: "adjust";
  adjustKind: K;
  settings: AdjustSettings[K];
}

export type Layer = RasterLayer | TextLayer | ShapeLayer | AdjustLayer;

export interface PhotoDoc {
  width: number;
  height: number;
  /** 배경색. null 이면 투명 */
  background: string | null;
  layers: Layer[];
}

export const ADJUSTMENTS: { kind: AdjustKind; label: string; icon: string; shortcut?: string }[] = [
  { kind: "brightness", label: "밝기/대비", icon: "☀" },
  { kind: "levels", label: "레벨", icon: "▤", shortcut: "Ctrl+L" },
  { kind: "curves", label: "곡선", icon: "∿", shortcut: "Ctrl+M" },
  { kind: "hueSat", label: "색조/채도", icon: "◑", shortcut: "Ctrl+U" },
  { kind: "vibrance", label: "활기", icon: "✦" },
  { kind: "colorBalance", label: "색상 균형", icon: "⚖", shortcut: "Ctrl+B" },
  { kind: "bw", label: "흑백", icon: "◐", shortcut: "Ctrl+Shift+Alt+B" },
  { kind: "gradientMap", label: "그레이디언트 맵", icon: "▦" },
  { kind: "invert", label: "반전", icon: "⊘", shortcut: "Ctrl+I" },
  { kind: "threshold", label: "한계값", icon: "◧" },
  { kind: "posterize", label: "포스터화", icon: "▥" },
];

export const DEFAULT_SETTINGS: AdjustSettings = {
  levels: { inBlack: 0, gamma: 1, inWhite: 255, outBlack: 0, outWhite: 255 },
  curves: {
    points: [
      { x: 0, y: 0 },
      { x: 255, y: 255 },
    ],
  },
  hueSat: { hue: 0, saturation: 0, lightness: 0, colorize: false },
  brightness: { brightness: 0, contrast: 0 },
  colorBalance: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
  vibrance: { vibrance: 0, saturation: 0 },
  bw: { tint: null },
  invert: {},
  threshold: { level: 128 },
  posterize: { levels: 4 },
  gradientMap: { from: "#1b1340", to: "#ffd27a" },
};

export const SIZES = [
  { label: "유튜브 썸네일", width: 1280, height: 720 },
  { label: "풀 HD", width: 1920, height: 1080 },
  { label: "로블록스 게임 아이콘", width: 512, height: 512 },
  { label: "인스타 정사각형", width: 1080, height: 1080 },
  { label: "세로 (쇼츠, 스토리)", width: 1080, height: 1920 },
  { label: "A4 (150dpi)", width: 1240, height: 1754 },
];

let nextId = 1;
export const newId = () => nextId++;

export function blankDoc(width = 1280, height = 720, background: string | null = "#ffffff"): PhotoDoc {
  return { width, height, background, layers: [] };
}

const base = (doc: PhotoDoc, name: string) => ({
  id: newId(),
  name,
  visible: true,
  locked: false,
  opacity: 1,
  blend: "source-over" as BlendMode,
  x: doc.width / 2,
  y: doc.height / 2,
  scale: 1,
  rotation: 0,
  flipX: false,
  flipY: false,
  mask: null,
  effects: NO_EFFECTS,
});

export function newRasterLayer(doc: PhotoDoc, src: string, width: number, height: number, name: string): RasterLayer {
  return { ...base(doc, name), kind: "raster", src, width, height, adjust: NO_ADJUST };
}

export function newTextLayer(doc: PhotoDoc, text = "글자를 입력하세요"): TextLayer {
  const short = Math.min(doc.width, doc.height);
  return {
    ...base(doc, "글자"),
    kind: "text",
    text,
    size: Math.round(short / 8),
    color: "#ffffff",
    bold: true,
    font: "Pretendard Variable",
    strokeColor: "#000000",
    strokeWidth: Math.round(short / 90),
    shadow: true,
    align: "center",
  };
}

export function newShapeLayer(doc: PhotoDoc, shape: ShapeKind, x: number, y: number, width: number, height: number, fill: string): ShapeLayer {
  return {
    ...base(doc, shape === "ellipse" ? "타원" : "사각형"),
    kind: "shape",
    shape,
    x,
    y,
    width,
    height,
    fill,
    stroke: null,
    strokeWidth: 0,
    radius: shape === "round" ? Math.round(Math.min(width, height) * 0.15) : 0,
  };
}

export function newAdjustLayer<K extends AdjustKind>(doc: PhotoDoc, kind: K): AdjustLayer<K> {
  const label = ADJUSTMENTS.find((a) => a.kind === kind)!.label;
  return { ...base(doc, label), kind: "adjust", adjustKind: kind, settings: structuredClone(DEFAULT_SETTINGS[kind]) };
}

export const isPixelLayer = (l: Layer | null | undefined): l is RasterLayer => l?.kind === "raster";

/** 레이어의 원래 크기 (scale 전). 글자는 render.ts 에서 잰다 */
export function boxSize(layer: RasterLayer | ShapeLayer) {
  return { w: layer.width, h: layer.height };
}
