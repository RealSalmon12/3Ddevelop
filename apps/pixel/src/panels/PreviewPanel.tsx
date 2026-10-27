import { useEffect, useRef, useState } from "react";
import { Panel } from "@suite/ui";
import type { DocSnapshot, PixelDoc } from "../doc/PixelDoc";

/** 실제 크기와 이어 붙인 모습 (게임 바닥·벽 텍스처가 자연스럽게 이어지는지 볼 때) */
export function PreviewPanel({ doc, snap }: { doc: PixelDoc; snap: DocSnapshot }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [tiled, setTiled] = useState(false);

  useEffect(() => {
    const canvas = ref.current!;
    const repeat = tiled ? 3 : 1;
    const { width, height } = snap;
    // 미리보기 칸(최대 160px)에 맞는 가장 큰 정수 배율
    const scale = Math.max(1, Math.floor(160 / (Math.max(width, height) * repeat)));
    canvas.width = width * repeat * scale;
    canvas.height = height * repeat * scale;
    const ctx = canvas.getContext("2d")!;
    const tile = document.createElement("canvas");
    tile.width = width;
    tile.height = height;
    tile.getContext("2d")!.putImageData(new ImageData(doc.composite(), width, height), 0, 0);
    ctx.imageSmoothingEnabled = false;
    for (let y = 0; y < repeat; y++)
      for (let x = 0; x < repeat; x++) ctx.drawImage(tile, x * width * scale, y * height * scale, width * scale, height * scale);
  }, [doc, snap, tiled]);

  return (
    <Panel title="미리보기">
      <div className="preview-box">
        <canvas ref={ref} />
      </div>
      <label className="check">
        <input type="checkbox" checked={tiled} onChange={(e) => setTiled(e.target.checked)} />
        이어 붙여 보기 (텍스처가 자연스럽게 이어지는지 확인)
      </label>
    </Panel>
  );
}
