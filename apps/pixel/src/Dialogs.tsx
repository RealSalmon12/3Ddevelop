// 내보내기, 캔버스 크기, 색 조정 창
import { useEffect, useRef, useState } from "react";
import type { PixelDoc } from "./doc/PixelDoc";
import { adjustHsl, resizeCanvas, scaleNearest } from "./doc/raster";
import { exportFrames, sheetLayout, type ExportOptions } from "./useFile";

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

export function ExportDialog({ doc, initial, onExport, onClose }: { doc: PixelDoc; initial: ExportOptions; onExport: (o: ExportOptions) => void; onClose: () => void }) {
  const [o, setO] = useState<ExportOptions>(initial);
  useEscape(onClose);
  const n = exportFrames(doc, o).length;
  const flip = [2, 4, 8].find((k) => k * k >= n) ?? 8;
  const L = sheetLayout(doc, o);
  const outW = o.kind === "sheet" ? L.width : doc.width * o.scale;
  const outH = o.kind === "sheet" ? L.height : doc.height * o.scale;
  const robloxScale = Math.max(1, Math.floor(1024 / Math.max(doc.width, doc.height)));
  return (
    <div className="dialog-dim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog export-dialog" role="dialog" aria-label="내보내기">
        <h2>내보내기</h2>
        <div className="seg-row">
          {(
            [
              ["png", "PNG (지금 프레임)"],
              ["sheet", "스프라이트 시트"],
              ["gif", "움직이는 GIF"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} aria-pressed={o.kind === k} onClick={() => setO({ ...o, kind: k })}>
              {label}
            </button>
          ))}
        </div>
        <label className="form-row">
          <span>크기</span>
          <select value={o.scale} onChange={(e) => setO({ ...o, scale: Number(e.target.value) })}>
            {[...new Set([1, 2, 4, 8, 10, 16, 20, robloxScale])].sort((a, b) => a - b).map((s) => (
              <option key={s} value={s}>
                {s}배 ({doc.width * s}×{doc.height * s}){s === robloxScale ? " · 로블록스 추천" : ""}
              </option>
            ))}
          </select>
        </label>
        {o.kind !== "png" && doc.tags.length > 0 && (
          <label className="form-row">
            <span>프레임</span>
            <select value={o.tag ?? -1} onChange={(e) => setO({ ...o, tag: Number(e.target.value) < 0 ? null : Number(e.target.value) })}>
              <option value={-1}>전체 ({doc.frames.length}프레임)</option>
              {doc.tags.map((t, i) => (
                <option key={i} value={i}>
                  🏷 {t.name} ({t.from + 1}~{t.to + 1})
                </option>
              ))}
            </select>
          </label>
        )}
        {o.kind === "sheet" && (
          <>
            <label className="form-row">
              <span>배치</span>
              <select value={o.columns} onChange={(e) => setO({ ...o, columns: Number(e.target.value) })}>
                <option value={0}>가로 한 줄 ({n}×1)</option>
                <option value={Math.ceil(Math.sqrt(n))}>정사각형에 가깝게 ({Math.ceil(Math.sqrt(n))}열)</option>
                <option value={flip}>
                  로블록스 파티클 플립북 ({flip}×{flip})
                </option>
              </select>
            </label>
            <label className="form-row">
              <span>사이 칸</span>
              <input type="number" min={0} max={16} value={o.padding} onChange={(e) => setO({ ...o, padding: Math.max(0, Number(e.target.value)) })} />
              px
            </label>
          </>
        )}
        <p className="dialog-note">
          결과 {outW} × {outH}px
          {o.kind !== "png" && ` · ${n}프레임`}
          {o.kind === "gif" && " · 반투명 칸은 투명 또는 불투명으로 바뀌어요"}
          {Math.max(outW, outH) > 1024 && " · 로블록스는 1024px 보다 큰 그림을 줄여서 올려요"}
        </p>
        <div className="dialog-actions">
          <button className="suite-ai-link" onClick={onClose}>
            취소
          </button>
          <button className="suite-button" onClick={() => onExport(o)}>
            내보내기
          </button>
        </div>
      </div>
    </div>
  );
}

export function SizeDialog({ doc, onClose, notify }: { doc: PixelDoc; onClose: () => void; notify: (m: string) => void }) {
  const [mode, setMode] = useState<"canvas" | "scale">("canvas");
  const [w, setW] = useState(doc.width);
  const [h, setH] = useState(doc.height);
  const [anchor, setAnchor] = useState<[number, number]>([0.5, 0.5]);
  const [lock, setLock] = useState(true);
  useEscape(onClose);
  const ok = w >= 1 && h >= 1 && w <= 1024 && h <= 1024;
  const apply = () => {
    if (!ok) return;
    const W = Math.round(w);
    const H = Math.round(h);
    doc.transformAll((r) => (mode === "canvas" ? resizeCanvas(r, W, H, anchor[0], anchor[1]) : scaleNearest(r, W, H)), W, H);
    notify(`${W}×${H} 로 바꿨어요.`);
    onClose();
  };
  return (
    <div className="dialog-dim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog small" role="dialog" aria-label="크기 바꾸기">
        <h2>크기 바꾸기</h2>
        <div className="seg-row">
          <button aria-pressed={mode === "canvas"} onClick={() => setMode("canvas")}>
            캔버스 크기 (칸 그대로)
          </button>
          <button aria-pressed={mode === "scale"} onClick={() => setMode("scale")}>
            그림 크기 (칸 늘리기)
          </button>
        </div>
        <div className="form-row">
          <span>가로</span>
          <input
            type="number"
            min={1}
            max={1024}
            value={w}
            onChange={(e) => {
              const v = Number(e.target.value);
              setW(v);
              if (lock && mode === "scale") setH(Math.round((v * doc.height) / doc.width));
            }}
          />
          <span>세로</span>
          <input
            type="number"
            min={1}
            max={1024}
            value={h}
            onChange={(e) => {
              const v = Number(e.target.value);
              setH(v);
              if (lock && mode === "scale") setW(Math.round((v * doc.width) / doc.height));
            }}
          />
        </div>
        {mode === "scale" ? (
          <>
            <label className="check">
              <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} /> 비율 지키기
            </label>
            <div className="prop-buttons">
              {[0.5, 2, 3, 4].map((k) => (
                <button key={k} className="mini" onClick={() => (setW(Math.max(1, Math.round(doc.width * k))), setH(Math.max(1, Math.round(doc.height * k))))}>
                  {k < 1 ? "½" : `${k}배`}
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="anchor-row">
            <span>기준</span>
            <div className="anchor-grid">
              {[0, 0.5, 1].flatMap((ay) =>
                [0, 0.5, 1].map((ax) => (
                  <button key={`${ax}${ay}`} aria-pressed={anchor[0] === ax && anchor[1] === ay} onClick={() => setAnchor([ax, ay])} title="그림을 붙여 둘 자리" />
                )),
              )}
            </div>
          </div>
        )}
        <div className="dialog-actions">
          <button className="suite-ai-link" onClick={onClose}>
            취소
          </button>
          <button className="suite-button" disabled={!ok} onClick={apply}>
            바꾸기
          </button>
        </div>
      </div>
    </div>
  );
}

/** 색조·채도·밝기: 끄는 동안 바로 보여 주고, 확인하면 한 번에 기록 */
export function AdjustDialog({ doc, onClose }: { doc: PixelDoc; onClose: () => void }) {
  const [v, setV] = useState({ h: 0, s: 0, l: 0 });
  const [all, setAll] = useState(false);
  const base = useRef<{ layer: number; data: Uint8ClampedArray[] } | null>(null);
  useEffect(() => {
    doc.begin();
    base.current = { layer: doc.active, data: doc.activeLayer.cels.map((c) => c.data.slice()) };
    return () => {
      if (base.current) doc.cancel();
    };
  }, [doc]);
  useEffect(() => {
    const b = base.current;
    if (!b) return;
    const layer = doc.layers[b.layer];
    layer.cels.forEach((c, f) => {
      c.data.set(b.data[f]);
      if (all || f === doc.frame) adjustHsl(c, v.h, v.s, v.l, doc.selection);
    });
    doc.preview();
  }, [doc, v, all]);
  const close = (keep: boolean) => {
    if (keep) {
      base.current = null;
      doc.commit();
    }
    onClose();
  };
  useEscape(() => close(false));
  const row = (label: string, key: "h" | "s" | "l", min: number, max: number) => (
    <label className="form-row">
      <span>{label}</span>
      <input type="range" min={min} max={max} value={v[key]} onChange={(e) => setV({ ...v, [key]: Number(e.target.value) })} />
      <b>{v[key]}</b>
    </label>
  );
  return (
    <div className="dialog-dim" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
      <div className="dialog small" role="dialog" aria-label="색조·채도·밝기">
        <h2>색조 · 채도 · 밝기</h2>
        {row("색조", "h", -180, 180)}
        {row("채도", "s", -100, 100)}
        {row("밝기", "l", -100, 100)}
        <label className="check">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> 이 레이어의 모든 프레임
        </label>
        <div className="dialog-actions">
          <button className="suite-ai-link" onClick={() => close(false)}>
            취소
          </button>
          <button className="suite-button" onClick={() => close(true)}>
            적용
          </button>
        </div>
      </div>
    </div>
  );
}
