import { useCallback, useEffect, useState } from "react";
import type { PixelDoc } from "./doc/PixelDoc";
import type { Example } from "./doc/examples";
import { encodeGif } from "./doc/gif";
import { parsePalette, paletteToHex } from "./doc/palettes";

const PROJECT_FILTER = { name: "바코 눈꽃 파일", extensions: ["npixel"] };
const IMAGE_FILTER = { name: "그림 파일", extensions: ["png", "jpg", "jpeg", "gif", "bmp", "webp"] };

const baseName = (path: string) => path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");

/** 내보낼 때 몇 배로 키울지. "roblox" 는 긴 쪽이 1024px 이 되게 키운다. */
export type ExportScale = 1 | 10 | "roblox";

export interface ExportOptions {
  kind: "png" | "sheet" | "gif";
  scale: number;
  /** 시트: 한 줄에 몇 프레임 (0 이면 가로 한 줄) */
  columns: number;
  /** 시트: 프레임 사이 빈 칸 */
  padding: number;
}

function canvasPng(c: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    c.toBlob(async (blob) => (blob ? resolve(new Uint8Array(await blob.arrayBuffer())) : reject(new Error("PNG 를 만들지 못했어요."))), "image/png"),
  );
}

/** 프레임 하나를 scale 배로 (칸이 흐려지지 않게) */
function frameCanvas(doc: PixelDoc, frame: number, scale: number) {
  const small = document.createElement("canvas");
  small.width = doc.width;
  small.height = doc.height;
  small.getContext("2d")!.putImageData(new ImageData(doc.composite(frame), doc.width, doc.height), 0, 0);
  const big = document.createElement("canvas");
  big.width = doc.width * scale;
  big.height = doc.height * scale;
  const ctx = big.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, big.width, big.height);
  return big;
}

export function sheetLayout(doc: PixelDoc, o: ExportOptions) {
  const n = doc.frames.length;
  const cols = o.columns > 0 ? Math.min(o.columns, n) : n;
  const rows = Math.ceil(n / cols);
  const fw = doc.width * o.scale;
  const fh = doc.height * o.scale;
  return { cols, rows, width: cols * fw + (cols - 1) * o.padding, height: rows * fh + (rows - 1) * o.padding, fw, fh };
}

export async function renderExport(doc: PixelDoc, o: ExportOptions): Promise<Uint8Array> {
  if (o.kind === "png") return canvasPng(frameCanvas(doc, doc.frame, o.scale));
  if (o.kind === "gif") {
    const frames = doc.frames.map((f, i) => ({ data: frameCanvas(doc, i, o.scale).getContext("2d")!.getImageData(0, 0, doc.width * o.scale, doc.height * o.scale).data, delay: f.duration }));
    return encodeGif(doc.width * o.scale, doc.height * o.scale, frames);
  }
  const L = sheetLayout(doc, o);
  const sheet = document.createElement("canvas");
  sheet.width = L.width;
  sheet.height = L.height;
  const ctx = sheet.getContext("2d")!;
  doc.frames.forEach((_, i) => ctx.drawImage(frameCanvas(doc, i, o.scale), (i % L.cols) * (L.fw + o.padding), Math.floor(i / L.cols) * (L.fh + o.padding)));
  return canvasPng(sheet);
}

/** 그림 파일을 캔버스 크기로 줄여서 픽셀로 바꾼다. 반쯤 투명한 곳은 투명이나 불투명 둘 중 하나로 정한다. */
async function imageToPixels(base64: string, ext: string, width: number, height: number) {
  const mime = ext === "jpg" ? "jpeg" : ext;
  const img = new Image();
  img.src = `data:image/${mime};base64,${base64}`;
  await img.decode();
  // 비율을 지키며 캔버스 안에 꼭 맞게
  const scale = Math.min(width / img.width, height / img.height);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, Math.floor((width - w) / 2), Math.floor((height - h) / 2), w, h);
  const data = ctx.getImageData(0, 0, width, height).data;
  for (let i = 3; i < data.length; i += 4) data[i] = data[i] < 128 ? 0 : 255;
  return data;
}

/** 새로 만들기, 열기, 저장, 내보내기, 그림 가져오기 */
export function useFile(doc: PixelDoc, dirty: boolean, notify: (message: string) => void, onNewSize: () => void) {
  const [filePath, setFilePath] = useState<string | null>(null);
  const name = filePath ? baseName(filePath) : "제목 없음";

  useEffect(() => {
    document.title = `${dirty ? "● " : ""}${name} - 바코 눈꽃`;
    window.suite?.window.setDirty(dirty);
  }, [name, dirty]);

  const confirmDiscard = useCallback(
    () => !doc.getSnapshot().dirty || window.confirm("저장하지 않은 그림이 사라져요. 계속할까요?"),
    [doc],
  );

  const newFile = useCallback(
    (width: number, height: number) => {
      if (!confirmDiscard()) return false;
      doc.reset(width, height);
      setFilePath(null);
      onNewSize();
      return true;
    },
    [doc, confirmDiscard, onNewSize],
  );

  const openExample = useCallback(
    (example: Example) => {
      if (!confirmDiscard()) return;
      doc.reset(example.rows[0].length, example.rows.length);
      doc.drawRows(example);
      doc.markSaved();
      setFilePath(null);
      onNewSize();
      notify(`‘${example.label}’ 예제예요. ${example.hint}.`);
    },
    [doc, confirmDiscard, onNewSize, notify],
  );

  const open = useCallback(async () => {
    if (!window.suite || !confirmDiscard()) return;
    const result = await window.suite.files.open({ filters: [PROJECT_FILTER] });
    if (!result.ok) {
      if (result.reason === "error") notify(`파일을 열지 못했어요. ${result.message ?? ""}`);
      return;
    }
    try {
      doc.load(result.text);
      setFilePath(result.path);
      onNewSize();
    } catch (err) {
      notify(err instanceof Error ? err.message : "파일을 열지 못했어요.");
    }
  }, [doc, confirmDiscard, notify, onNewSize]);

  const save = useCallback(
    async (saveAs = false) => {
      if (!window.suite) return;
      const result = await window.suite.files.save({
        path: saveAs ? undefined : filePath ?? undefined,
        defaultName: `${name}.npixel`,
        filters: [PROJECT_FILTER],
        data: doc.serialize(),
      });
      if (result.ok) {
        doc.markSaved();
        setFilePath(result.path);
        notify("저장했어요.");
      } else if (result.reason === "error") {
        notify(`저장하지 못했어요. ${result.message ?? ""}`);
      }
    },
    [doc, filePath, name, notify],
  );

  const exportImage = useCallback(
    async (o: ExportOptions) => {
      if (!window.suite) return false;
      const ext = o.kind === "gif" ? "gif" : "png";
      const suffix = o.kind === "sheet" ? "-시트" : o.scale > 1 ? `-x${o.scale}` : "";
      const result = await window.suite.files.save({
        defaultName: `${name}${suffix}.${ext}`,
        filters: [ext === "gif" ? { name: "움직이는 GIF", extensions: ["gif"] } : { name: "PNG 그림", extensions: ["png"] }],
        data: await renderExport(doc, o),
      });
      if (!result.ok) {
        if (result.reason === "error") notify(`내보내지 못했어요. ${result.message ?? ""}`);
        return false;
      }
      notify(
        o.kind === "gif"
          ? `GIF 로 저장했어요 (${doc.frames.length}프레임). 디스코드나 웹에 바로 올릴 수 있어요.`
          : o.kind === "sheet"
            ? "스프라이트 시트로 저장했어요. 로블록스에서는 ImageLabel 의 ImageRectOffset 이나 파티클 Flipbook 으로 움직여요."
            : `PNG 로 저장했어요 (${doc.width * o.scale}×${doc.height * o.scale}). 로블록스 스튜디오의 Asset Manager 나 Decal 에 넣으면 돼요.`,
      );
      return true;
    },
    [doc, name, notify],
  );

  const exportPng = useCallback(
    (scale: ExportScale) =>
      exportImage({ kind: "png", scale: scale === "roblox" ? Math.max(1, Math.floor(1024 / Math.max(doc.width, doc.height))) : scale, columns: 0, padding: 0 }),
    [doc, exportImage],
  );

  const loadPalette = useCallback(async () => {
    if (!window.suite) return;
    const r = await window.suite.files.open({ filters: [{ name: "팔레트", extensions: ["hex", "gpl", "txt"] }] });
    if (!r.ok) return r.reason === "error" && notify(`열지 못했어요. ${r.message ?? ""}`);
    const colors = parsePalette(r.text);
    if (!colors.length) return notify("팔레트에서 색을 찾지 못했어요. .hex 나 .gpl 파일인지 봐 주세요.");
    doc.setPalette(colors);
    notify(`팔레트 ${colors.length}색을 불러왔어요.`);
  }, [doc, notify]);

  const savePalette = useCallback(async () => {
    if (!window.suite) return;
    const r = await window.suite.files.save({ defaultName: `${name}.hex`, filters: [{ name: "팔레트", extensions: ["hex"] }], data: paletteToHex(doc.palette) });
    if (r.ok) notify("팔레트를 저장했어요.");
  }, [doc, name, notify]);

  const importImage = useCallback(async () => {
    if (!window.suite) return;
    const result = await window.suite.files.open({ filters: [IMAGE_FILTER], binary: true });
    if (!result.ok) {
      if (result.reason === "error") notify(`그림을 열지 못했어요. ${result.message ?? ""}`);
      return;
    }
    try {
      const ext = result.path.split(".").pop()!.toLowerCase();
      const pixels = await imageToPixels(result.text, ext, doc.width, doc.height);
      if (!doc.importPixels(pixels, baseName(result.path))) return notify("레이어가 너무 많아요. 하나를 지우고 다시 해 주세요.");
      notify("그림을 픽셀로 바꿔서 새 레이어에 넣었어요. 연필로 다듬어 보세요!");
    } catch {
      notify("이 그림은 읽을 수 없어요. PNG 나 JPG 로 해 주세요.");
    }
  }, [doc, notify]);

  /** 스프라이트 시트 그림을 캔버스 크기로 잘라 프레임으로 */
  const importSheet = useCallback(async () => {
    if (!window.suite) return;
    const result = await window.suite.files.open({ filters: [IMAGE_FILTER], binary: true });
    if (!result.ok) return result.reason === "error" && notify(`그림을 열지 못했어요. ${result.message ?? ""}`);
    try {
      const ext = result.path.split(".").pop()!.toLowerCase();
      const img = new Image();
      img.src = `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${result.text}`;
      await img.decode();
      const cols = Math.floor(img.width / doc.width);
      const rows = Math.floor(img.height / doc.height);
      if (!cols || !rows) return notify(`그림이 캔버스(${doc.width}×${doc.height})보다 작아요. 프레임 크기로 새 그림을 만든 뒤 가져와 주세요.`);
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      const frames: Uint8ClampedArray[] = [];
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) frames.push(g.getImageData(x * doc.width, y * doc.height, doc.width, doc.height).data);
      if (!doc.importFrames(frames, baseName(result.path))) return notify("레이어가 너무 많아요. 하나를 지우고 다시 해 주세요.");
      notify(`${frames.length}프레임으로 나눠서 넣었어요 (${cols}×${rows}).`);
    } catch {
      notify("이 그림은 읽을 수 없어요. PNG 로 해 주세요.");
    }
  }, [doc, notify]);

  return { name, newFile, openExample, open, save, exportImage, exportPng, importImage, importSheet, loadPalette, savePalette };
}
