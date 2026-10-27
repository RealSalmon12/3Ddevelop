import { useEffect, useRef, useState } from "react";
import { Panel } from "@suite/ui";
import type { DocSnapshot, PixelDoc } from "../doc/PixelDoc";

/** 실제 크기 미리보기. 애니메이션이면 재생되고, 이어 붙여 보면 텍스처가 자연스럽게 이어지는지 볼 수 있다. */
export function PreviewPanel({ doc, snap, playing }: { doc: PixelDoc; snap: DocSnapshot; playing: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [tiled, setTiled] = useState(false);
  const [loop, setLoop] = useState(true);
  const [shown, setShown] = useState(snap.frame);

  // 타임라인이 재생 중이 아니면 미리보기가 스스로 재생한다
  useEffect(() => {
    if (playing || !loop || snap.frames.length < 2) return setShown(snap.frame);
    let f = snap.frame;
    let timer = 0;
    const step = () => {
      setShown(f);
      timer = window.setTimeout(() => {
        f = (f + 1) % doc.frames.length;
        step();
      }, doc.frames[f]?.duration ?? 100);
    };
    step();
    return () => clearTimeout(timer);
  }, [doc, playing, loop, snap.frames.length, snap.frame]);

  useEffect(() => {
    const canvas = ref.current!;
    const repeat = tiled ? 3 : 1;
    const { width, height } = snap;
    const frame = Math.min(shown, doc.frames.length - 1);
    // 미리보기 칸(최대 200px)에 맞는 가장 큰 정수 배율
    const scale = Math.max(1, Math.floor(200 / (Math.max(width, height) * repeat)));
    canvas.width = width * repeat * scale;
    canvas.height = height * repeat * scale;
    const ctx = canvas.getContext("2d")!;
    const tile = document.createElement("canvas");
    tile.width = width;
    tile.height = height;
    tile.getContext("2d")!.putImageData(new ImageData(doc.composite(frame), width, height), 0, 0);
    ctx.imageSmoothingEnabled = false;
    for (let y = 0; y < repeat; y++)
      for (let x = 0; x < repeat; x++) ctx.drawImage(tile, x * width * scale, y * height * scale, width * scale, height * scale);
  }, [doc, snap, tiled, shown]);

  return (
    <Panel title="미리보기">
      <div className="preview-box">
        <canvas ref={ref} />
      </div>
      <label className="check">
        <input type="checkbox" checked={tiled} onChange={(e) => setTiled(e.target.checked)} />
        이어 붙여 보기 (텍스처 확인)
      </label>
      {snap.frames.length > 1 && (
        <label className="check">
          <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
          애니메이션 계속 재생
        </label>
      )}
    </Panel>
  );
}
