import { useCallback, useEffect, useState } from "react";
import type { ViewportRenderer } from "../viewport/ViewportRenderer";

const SIZES: { label: string; w: number; h: number }[] = [
  { label: "1920 × 1080 (풀 HD)", w: 1920, h: 1080 },
  { label: "1280 × 720 (유튜브 썸네일)", w: 1280, h: 720 },
  { label: "1024 × 1024 (로블록스 아이콘·썸네일)", w: 1024, h: 1024 },
  { label: "512 × 512 (작은 아이콘)", w: 512, h: 512 },
  { label: "1080 × 1920 (세로, 쇼츠)", w: 1080, h: 1920 },
  { label: "3840 × 2160 (4K)", w: 3840, h: 2160 },
];

/** 렌더 (F12): 지금 보는 시점을 고화질 그림으로 뽑아 PNG 로 저장한다. */
export function RenderDialog({ viewport, name, notify, onClose }: { viewport: ViewportRenderer; name: string; notify: (m: string) => void; onClose: () => void }) {
  const [size, setSize] = useState(0);
  const [transparent, setTransparent] = useState(false);
  const [bloom, setBloom] = useState(true);
  const [background, setBackground] = useState("#232838");
  const [image, setImage] = useState<HTMLCanvasElement | null>(null);
  const [ms, setMs] = useState(0);

  const render = useCallback(() => {
    const s = SIZES[size];
    const t = performance.now();
    setImage(viewport.renderImage(s.w, s.h, { transparent, bloom, background }));
    setMs(Math.round(performance.now() - t));
  }, [viewport, size, transparent, bloom, background]);

  useEffect(() => {
    // 창이 그려진 다음 프레임에 렌더한다
    const id = requestAnimationFrame(render);
    return () => cancelAnimationFrame(id);
  }, [render]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    if (!image || !window.suite) return;
    const blob = await new Promise<Blob | null>((r) => image.toBlob(r, "image/png"));
    if (!blob) return notify("그림을 만들지 못했어요.");
    const s = SIZES[size];
    const result = await window.suite.files.save({
      defaultName: `${name}-렌더-${s.w}x${s.h}.png`,
      filters: [{ name: "PNG 그림", extensions: ["png"] }],
      data: new Uint8Array(await blob.arrayBuffer()),
    });
    if (result.ok) notify(`렌더를 저장했어요 (${s.w}×${s.h}).`);
    else if (result.reason === "error") notify(`저장하지 못했어요. ${result.message ?? ""}`);
  };

  return (
    <div className="render-dim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="render-dialog" role="dialog" aria-label="렌더">
        <div className="render-preview" data-transparent={transparent}>
          {image && <img src={image.toDataURL("image/png")} alt="렌더 결과" />}
        </div>
        <div className="render-side">
          <h2>렌더 (F12)</h2>
          <p>지금 보는 시점 그대로, 격자와 손잡이 없이 깨끗한 그림을 만들어요. 게임 아이콘, 썸네일, 홍보 그림에 쓰세요.</p>
          <label className="render-row">
            <span>크기</span>
            <select value={size} onChange={(e) => setSize(Number(e.target.value))}>
              {SIZES.map((s, i) => (
                <option key={s.label} value={i}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="render-check">
            <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} /> 배경 투명하게 (아이콘용)
          </label>
          {!transparent && (
            <>
              <label className="render-row">
                <span>배경색</span>
                <input type="color" value={background} onChange={(e) => setBackground(e.target.value)} />
              </label>
              <label className="render-check">
                <input type="checkbox" checked={bloom} onChange={(e) => setBloom(e.target.checked)} /> 빛 번짐
              </label>
            </>
          )}
          <p className="render-note">{image ? `${SIZES[size].w}×${SIZES[size].h} · ${ms}ms` : "렌더하는 중…"}</p>
          <div className="render-actions">
            <button className="suite-button ghost" onClick={render}>
              다시 렌더
            </button>
            <button className="suite-button" disabled={!image} onClick={() => void save()}>
              PNG 로 저장
            </button>
          </div>
          <button className="suite-ai-link" onClick={onClose}>
            닫기 (Esc)
          </button>
        </div>
      </div>
    </div>
  );
}
