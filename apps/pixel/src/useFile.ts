import { useCallback, useEffect, useState } from "react";
import type { PixelDoc } from "./doc/PixelDoc";
import type { Example } from "./doc/examples";

const PROJECT_FILTER = { name: "도트 아틀리에 파일", extensions: ["npixel"] };
const IMAGE_FILTER = { name: "그림 파일", extensions: ["png", "jpg", "jpeg", "gif", "bmp", "webp"] };

const baseName = (path: string) => path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");

/** 내보낼 때 몇 배로 키울지. "roblox" 는 긴 쪽이 1024px 이 되게 키운다. */
export type ExportScale = 1 | 10 | "roblox";

function pngBytes(doc: PixelDoc, scale: number): Promise<Uint8Array> {
  const small = document.createElement("canvas");
  small.width = doc.width;
  small.height = doc.height;
  small.getContext("2d")!.putImageData(new ImageData(doc.composite(), doc.width, doc.height), 0, 0);
  const big = document.createElement("canvas");
  big.width = doc.width * scale;
  big.height = doc.height * scale;
  const ctx = big.getContext("2d")!;
  // 칸이 흐려지지 않게 그대로 키운다.
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, big.width, big.height);
  return new Promise((resolve, reject) =>
    big.toBlob(async (blob) => (blob ? resolve(new Uint8Array(await blob.arrayBuffer())) : reject(new Error("PNG 를 만들지 못했어요."))), "image/png"),
  );
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
    document.title = `${dirty ? "● " : ""}${name} - 도트 아틀리에`;
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

  const exportPng = useCallback(
    async (scale: ExportScale) => {
      if (!window.suite) return;
      const factor = scale === "roblox" ? Math.max(1, Math.floor(1024 / Math.max(doc.width, doc.height))) : scale;
      const suffix = scale === "roblox" ? "-로블록스" : factor > 1 ? `-x${factor}` : "";
      const result = await window.suite.files.save({
        defaultName: `${name}${suffix}.png`,
        filters: [{ name: "PNG 그림", extensions: ["png"] }],
        data: await pngBytes(doc, factor),
      });
      if (!result.ok) return result.reason === "error" && notify(`내보내지 못했어요. ${result.message ?? ""}`);
      notify(
        scale === "roblox"
          ? `${doc.width * factor}×${doc.height * factor} PNG 로 저장했어요. 로블록스 스튜디오에서 ‘Asset Manager → 이미지 올리기’ 또는 Decal 의 Texture 로 넣으면 돼요.`
          : `PNG 로 저장했어요 (${doc.width * factor}×${doc.height * factor}).`,
      );
    },
    [doc, name, notify],
  );

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

  return { name, newFile, openExample, open, save, exportPng, importImage };
}
