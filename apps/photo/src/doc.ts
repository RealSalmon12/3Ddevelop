// 바코 진주 문서. 바꿀 때마다 새 객체를 만들어서, 실행 취소는 예전 객체로 돌아가기만 하면 된다.

export interface Adjust {
  /** 밝기, 대비, 채도: 100 이 원래대로 */
  brightness: number;
  contrast: number;
  saturation: number;
  /** -100(시원하게) ~ 100(따뜻하게) */
  warmth: number;
  /** 흐림 (px) */
  blur: number;
  grayscale: boolean;
}

export const NO_ADJUST: Adjust = { brightness: 100, contrast: 100, saturation: 100, warmth: 0, blur: 0, grayscale: false };

interface LayerBase {
  id: number;
  name: string;
  visible: boolean;
  /** 레이어 가운데의 위치 (그림 안 좌표) */
  x: number;
  y: number;
  scale: number;
  /** 도 */
  rotation: number;
  /** 0~1 */
  opacity: number;
}

export interface ImageLayer extends LayerBase {
  kind: "image";
  /** data: URL */
  src: string;
  width: number;
  height: number;
  adjust: Adjust;
}

export interface TextLayer extends LayerBase {
  kind: "text";
  text: string;
  size: number;
  color: string;
  bold: boolean;
  /** 글자 테두리 (썸네일처럼 잘 보이게) */
  strokeColor: string;
  strokeWidth: number;
  shadow: boolean;
}

export type Layer = ImageLayer | TextLayer;

export interface PhotoDoc {
  width: number;
  height: number;
  /** 배경색. null 이면 투명 */
  background: string | null;
  layers: Layer[];
}

export const SIZES = [
  { label: "유튜브 썸네일", width: 1280, height: 720 },
  { label: "로블록스 게임 아이콘", width: 512, height: 512 },
  { label: "로블록스 게임 썸네일", width: 1920, height: 1080 },
  { label: "인스타 정사각형", width: 1080, height: 1080 },
  { label: "세로 (쇼츠, 스토리)", width: 1080, height: 1920 },
];

let nextId = 1;
export const newId = () => nextId++;

export function blankDoc(width = 1280, height = 720, background: string | null = "#ffffff"): PhotoDoc {
  return { width, height, background, layers: [] };
}

/** CSS filter 로 보정을 표현한다. 따뜻함은 따로 색을 덧칠한다. */
export function filterOf(a: Adjust) {
  const parts = [`brightness(${a.brightness}%)`, `contrast(${a.contrast}%)`, `saturate(${a.saturation}%)`];
  if (a.grayscale) parts.push("grayscale(100%)");
  if (a.blur > 0) parts.push(`blur(${a.blur}px)`);
  return parts.join(" ");
}

export const FILTER_PRESETS: { label: string; adjust: Partial<Adjust> }[] = [
  { label: "원래대로", adjust: NO_ADJUST },
  { label: "선명하게", adjust: { contrast: 125, saturation: 130, brightness: 105 } },
  { label: "따뜻하게", adjust: { warmth: 45, saturation: 110 } },
  { label: "시원하게", adjust: { warmth: -45, brightness: 104 } },
  { label: "흑백", adjust: { grayscale: true, contrast: 115 } },
  { label: "빈티지", adjust: { warmth: 35, contrast: 85, saturation: 70, brightness: 105 } },
  { label: "어둡고 강하게", adjust: { brightness: 85, contrast: 140, saturation: 115 } },
];

const fontOf = (t: TextLayer) => `${t.bold ? 800 : 500} ${t.size}px "Pretendard Variable", "Malgun Gothic", sans-serif`;

let measureCtx: CanvasRenderingContext2D | null = null;
/** 레이어의 크기 (scale 적용 전) */
export function layerSize(layer: Layer): { w: number; h: number } {
  if (layer.kind === "image") return { w: layer.width, h: layer.height };
  measureCtx ??= document.createElement("canvas").getContext("2d")!;
  measureCtx.font = fontOf(layer);
  const lines = layer.text.split("\n");
  const w = Math.max(...lines.map((l) => measureCtx!.measureText(l).width), layer.size * 0.5);
  return { w: w + layer.strokeWidth * 2, h: lines.length * layer.size * 1.2 + layer.strokeWidth * 2 };
}

const images = new Map<string, HTMLImageElement>();
/** data: URL 로 만든 그림을 한 번만 읽어 둔다. 다 읽으면 onLoad 를 부른다. */
export function imageFor(src: string, onLoad: () => void): HTMLImageElement | null {
  let img = images.get(src);
  if (!img) {
    img = new Image();
    img.onload = onLoad;
    img.src = src;
    images.set(src, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}

/** 레이어 하나를 그린다. ctx 는 그림 좌표로 맞춰져 있어야 한다. */
export function drawLayer(ctx: CanvasRenderingContext2D, layer: Layer, onLoad: () => void) {
  if (!layer.visible) return;
  const { w, h } = layerSize(layer);
  ctx.save();
  ctx.globalAlpha = layer.opacity;
  ctx.translate(layer.x, layer.y);
  ctx.rotate((layer.rotation * Math.PI) / 180);
  ctx.scale(layer.scale, layer.scale);
  if (layer.kind === "image") {
    const img = imageFor(layer.src, onLoad);
    if (img) {
      const a = layer.adjust;
      if (a.warmth === 0) {
        ctx.filter = filterOf(a);
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
      } else {
        // 따뜻함: 주황(또는 파랑)을 부드럽게 덧칠하고, 원래 그림 모양대로 잘라 낸다.
        const off = document.createElement("canvas");
        off.width = w;
        off.height = h;
        const o = off.getContext("2d")!;
        o.filter = filterOf(a);
        o.drawImage(img, 0, 0, w, h);
        o.filter = "none";
        o.globalCompositeOperation = "soft-light";
        o.globalAlpha = Math.min(1, Math.abs(a.warmth) / 100);
        o.fillStyle = a.warmth > 0 ? "#ff8a00" : "#0077ff";
        o.fillRect(0, 0, w, h);
        o.globalAlpha = 1;
        o.globalCompositeOperation = "destination-in";
        o.drawImage(img, 0, 0, w, h);
        ctx.drawImage(off, -w / 2, -h / 2);
      }
    }
  } else {
    ctx.font = fontOf(layer);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const lines = layer.text.split("\n");
    const lh = layer.size * 1.2;
    lines.forEach((line, i) => {
      const y = (i - (lines.length - 1) / 2) * lh;
      if (layer.shadow) {
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.55)";
        ctx.shadowBlur = layer.size * 0.15;
        ctx.shadowOffsetY = layer.size * 0.08;
        ctx.fillStyle = layer.strokeWidth > 0 ? layer.strokeColor : layer.color;
        ctx.fillText(line, 0, y);
        ctx.restore();
      }
      if (layer.strokeWidth > 0) {
        ctx.strokeStyle = layer.strokeColor;
        ctx.lineWidth = layer.strokeWidth * 2;
        ctx.strokeText(line, 0, y);
      }
      ctx.fillStyle = layer.color;
      ctx.fillText(line, 0, y);
    });
  }
  ctx.restore();
}

/** 그림 전체를 캔버스에 그린다 (내보내기, 미리보기) */
export function renderDoc(ctx: CanvasRenderingContext2D, doc: PhotoDoc, onLoad: () => void) {
  if (doc.background) {
    ctx.fillStyle = doc.background;
    ctx.fillRect(0, 0, doc.width, doc.height);
  }
  for (const layer of doc.layers) drawLayer(ctx, layer, onLoad);
}

/** 점이 레이어 안에 있는지 (회전, 크기 고려) */
export function hitLayer(layer: Layer, px: number, py: number) {
  const { w, h } = layerSize(layer);
  const r = (-layer.rotation * Math.PI) / 180;
  const dx = px - layer.x;
  const dy = py - layer.y;
  const lx = (dx * Math.cos(r) - dy * Math.sin(r)) / layer.scale;
  const ly = (dx * Math.sin(r) + dy * Math.cos(r)) / layer.scale;
  return Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2;
}

export function newTextLayer(doc: PhotoDoc, text = "글자를 입력하세요"): TextLayer {
  return {
    kind: "text",
    id: newId(),
    name: "글자",
    visible: true,
    x: doc.width / 2,
    y: doc.height / 2,
    scale: 1,
    rotation: 0,
    opacity: 1,
    text,
    size: Math.round(Math.min(doc.width, doc.height) / 8),
    color: "#ffffff",
    bold: true,
    strokeColor: "#000000",
    strokeWidth: Math.round(Math.min(doc.width, doc.height) / 90),
    shadow: true,
  };
}

/** 사진을 그림 크기에 꽉 차게 (남는 부분은 넘치게) 놓는다. */
export function newImageLayer(doc: PhotoDoc, src: string, width: number, height: number, name: string): ImageLayer {
  const cover = doc.layers.length === 0;
  const fit = cover ? Math.max(doc.width / width, doc.height / height) : Math.min((doc.width * 0.6) / width, (doc.height * 0.6) / height, 1);
  return {
    kind: "image",
    id: newId(),
    name,
    visible: true,
    x: doc.width / 2,
    y: doc.height / 2,
    scale: fit,
    rotation: 0,
    opacity: 1,
    src,
    width,
    height,
    adjust: NO_ADJUST,
  };
}

export function serialize(doc: PhotoDoc) {
  return JSON.stringify({ format: "nphoto", version: 1, ...doc });
}

export function parse(text: string): PhotoDoc {
  let data: PhotoDoc & { format?: string };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("바코 진주 파일이 아니에요.");
  }
  if (data.format !== "nphoto" || !Array.isArray(data.layers)) throw new Error("바코 진주 파일이 아니에요.");
  const layers = data.layers.map((l) => ({ ...l, id: newId() }));
  return { width: data.width, height: data.height, background: data.background ?? null, layers };
}
