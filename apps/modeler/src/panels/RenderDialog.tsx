import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ViewportRenderer } from "../viewport/ViewportRenderer";
import type { ModelerScene } from "../scene/ModelerScene";
import { createWebmEncoder } from "@suite/ui";

const SIZES: { label: string; w: number; h: number }[] = [
  { label: "1920 × 1080 (풀 HD)", w: 1920, h: 1080 },
  { label: "1280 × 720 (유튜브 썸네일)", w: 1280, h: 720 },
  { label: "1024 × 1024 (로블록스 아이콘·썸네일)", w: 1024, h: 1024 },
  { label: "512 × 512 (작은 아이콘)", w: 512, h: 512 },
  { label: "1080 × 1920 (세로, 쇼츠)", w: 1080, h: 1920 },
  { label: "3840 × 2160 (4K)", w: 3840, h: 2160 },
];

/** 렌더 (F12): 지금 보는 시점을 고화질 그림으로 뽑아 PNG 로 저장한다. 키프레임이 있으면 영상(WebM)도 뽑는다. */
export function RenderDialog({
  viewport,
  model,
  name,
  notify,
  onClose,
}: {
  viewport: ViewportRenderer;
  model: ModelerScene;
  name: string;
  notify: (m: string) => void;
  onClose: () => void;
}) {
  const [size, setSize] = useState(0);
  const [transparent, setTransparent] = useState(false);
  const [bloom, setBloom] = useState(true);
  const [background, setBackground] = useState("#232838");
  const [image, setImage] = useState<HTMLCanvasElement | null>(null);
  const [ms, setMs] = useState(0);
  const [progress, setProgress] = useState<number | null>(null);
  const cancel = useRef(false);
  // 미리보기 그림은 바뀔 때만 다시 만든다 (영상 렌더 중 진행 표시가 바뀔 때마다 PNG 를 만들면 느려서)
  const preview = useMemo(() => image?.toDataURL("image/png"), [image]);
  const animated = model.getSnapshot().items.some((i) => i.keys?.length);

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

  /** 애니메이션 렌더: 프레임마다 그려 정확한 시간을 붙여 영상(WebM)으로 묶는다. 느린 PC 에서도 빠지는 프레임이 없다. */
  const renderVideo = async () => {
    const s = SIZES[size];
    const { fps, end, frame: startFrame } = model.getSnapshot().anim;
    cancel.current = false;
    setProgress(0);
    try {
      const enc = await createWebmEncoder({ width: s.w, height: s.h, fps });
      for (let f = 0; f <= end && !cancel.current; f++) {
        model.setFrame(f);
        await enc.add(viewport.renderImage(s.w, s.h, { transparent: false, bloom, background }));
        setProgress(f / end);
        // 화면이 멈춘 것처럼 보이지 않게 가끔 숨을 돌린다
        if (f % 4 === 3) await new Promise((r) => setTimeout(r, 0));
      }
      const data = await enc.finish();
      if (cancel.current) return notify("영상 렌더를 멈췄어요.");
      if (!window.suite) return;
      const result = await window.suite.files.save({
        defaultName: `${name}-애니메이션-${s.w}x${s.h}.webm`,
        filters: [{ name: "WebM 영상", extensions: ["webm"] }],
        data,
      });
      if (result.ok) notify(`영상을 저장했어요 (${end + 1}프레임, ${((end + 1) / fps).toFixed(1)}초). 바코 오로라에 넣어 편집할 수 있어요.`);
      else if (result.reason === "error") notify(`저장하지 못했어요. ${result.message ?? ""}`);
    } catch (e) {
      notify(`영상을 만들지 못했어요. ${e instanceof Error ? e.message : ""}`);
    } finally {
      model.setFrame(startFrame);
      setProgress(null);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (cancel.current = true, onClose());
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
          {preview && <img src={preview} alt="렌더 결과" />}
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
            <button className="suite-button" disabled={!image || progress !== null} onClick={() => void save()}>
              PNG 로 저장
            </button>
          </div>
          {animated && (
            <div className="render-video">
              <p>키프레임 애니메이션을 처음부터 끝까지 영상(WebM)으로 뽑아요. 배경은 투명하지 않게 나와요.</p>
              {progress === null ? (
                <button className="suite-button" onClick={() => void renderVideo()}>
                  🎬 애니메이션 영상 렌더
                </button>
              ) : (
                <>
                  <progress max={1} value={progress} />
                  <button className="suite-button ghost" onClick={() => (cancel.current = true)}>
                    멈추기
                  </button>
                </>
              )}
            </div>
          )}
          <button className="suite-ai-link" onClick={onClose}>
            닫기 (Esc)
          </button>
        </div>
      </div>
    </div>
  );
}
