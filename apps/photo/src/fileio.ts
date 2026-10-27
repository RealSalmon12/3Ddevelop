// .nphoto 파일 읽기, 쓰기. 픽셀 id 는 저장할 때 data: 주소로 바꾸고, 읽을 때 다시 저장소에 넣는다.
import { NO_ADJUST, NO_EFFECTS, newId, type Layer, type PhotoDoc } from "./model";
import { putDataUrl, toDataUrl } from "./pixels";

export async function serialize(doc: PhotoDoc): Promise<string> {
  const layers = await Promise.all(
    doc.layers.map(async (l) => {
      const out: Record<string, unknown> = { ...l };
      if (l.kind === "raster") out.src = await toDataUrl(l.src);
      if (l.mask) out.mask = { ...l.mask, src: await toDataUrl(l.mask.src) };
      return out;
    }),
  );
  return JSON.stringify({ format: "nphoto", version: 2, width: doc.width, height: doc.height, background: doc.background, layers });
}

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function parse(text: string): PhotoDoc {
  let data: Raw;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("바코 진주 파일이 아니에요.");
  }
  if (data.format !== "nphoto" || !Array.isArray(data.layers)) throw new Error("바코 진주 파일이 아니에요.");
  const doc: PhotoDoc = { width: data.width, height: data.height, background: data.background ?? null, layers: [] };
  doc.layers = (data.layers as Raw[]).map((l): Layer => {
    const common = {
      id: newId(),
      name: l.name ?? "레이어",
      visible: l.visible ?? true,
      locked: l.locked ?? false,
      opacity: l.opacity ?? 1,
      blend: l.blend ?? "source-over",
      x: l.x ?? doc.width / 2,
      y: l.y ?? doc.height / 2,
      scale: l.scale ?? 1,
      rotation: l.rotation ?? 0,
      flipX: l.flipX ?? false,
      flipY: l.flipY ?? false,
      effects: { ...NO_EFFECTS, ...(l.effects ?? {}) },
      mask: null,
    };
    const maskOf = (w: number, h: number) => (l.mask?.src ? { src: putDataUrl(l.mask.src, w, h), enabled: l.mask.enabled ?? true } : null);
    if (l.kind === "image" || l.kind === "raster") {
      // version 1 의 사진 레이어도 여기로
      return { ...common, kind: "raster", src: putDataUrl(l.src, l.width, l.height), width: l.width, height: l.height, adjust: { ...NO_ADJUST, ...(l.adjust ?? {}) }, mask: maskOf(l.width, l.height) };
    }
    if (l.kind === "text") {
      return {
        ...common,
        kind: "text",
        text: l.text ?? "",
        size: l.size ?? 64,
        color: l.color ?? "#ffffff",
        bold: l.bold ?? true,
        font: l.font ?? "Pretendard Variable",
        strokeColor: l.strokeColor ?? "#000000",
        strokeWidth: l.strokeWidth ?? 0,
        shadow: l.shadow ?? false,
        align: l.align ?? "center",
      };
    }
    if (l.kind === "shape") return { ...common, ...(l as object), id: common.id, effects: common.effects, mask: null } as Layer;
    if (l.kind === "adjust") return { ...common, kind: "adjust", adjustKind: l.adjustKind, settings: l.settings, mask: maskOf(doc.width, doc.height) } as Layer;
    throw new Error("이 파일은 더 새로운 바코 진주에서 만들어졌어요. 업데이트해 주세요.");
  });
  return doc;
}
