import { useEffect, useRef, useState } from "react";
import { Field, LIQUIFY_TOOLS, renderWarp, type LiquifyTool } from "./liquify";
import { createCanvas, ctx2d } from "./pixels";

interface Props {
  /** 고칠 레이어 픽셀 */
  base: HTMLCanvasElement;
  /** 선택 영역 (레이어 공간). 있으면 그 안만 바뀐다 */
  sel: HTMLCanvasElement | null;
  onApply: (result: HTMLCanvasElement) => void;
  onCancel: () => void;
}

const MAX_W = 960;
const MAX_H = 640;

/** 픽셀 유동화 창: 작은 미리보기에서 붓으로 밀고, 적용하면 원래 크기로 계산한다 */
export function LiquifyDialog({ base, sel, onApply, onCancel }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<LiquifyTool>("push");
  const [size, setSize] = useState(80);
  const [pressure, setPressure] = useState(50);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const scale = Math.min(1, MAX_W / base.width, MAX_H / base.height);
  const pw = Math.max(1, Math.round(base.width * scale));
  const ph = Math.max(1, Math.round(base.height * scale));
  const state = useRef<{ field: Field; src: Uint8ClampedArray; out: ImageData } | null>(null);
  const settings = useRef({ tool, size, pressure });
  settings.current = { tool, size, pressure };

  useEffect(() => {
    const small = createCanvas(pw, ph);
    const g = ctx2d(small);
    g.drawImage(base, 0, 0, pw, ph);
    const img = g.getImageData(0, 0, pw, ph);
    state.current = { field: new Field(pw, ph), src: new Uint8ClampedArray(img.data), out: img };
    ctx2d(canvas.current!).putImageData(img, 0, 0);
  }, [base, pw, ph]);

  // 붓질
  useEffect(() => {
    const el = canvas.current!;
    let down: { x: number; y: number; alt: boolean } | null = null;
    let raf = 0;
    const pos = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * pw, y: ((e.clientY - r.top) / r.height) * ph };
    };
    const stamp = (x: number, y: number, vx = 0, vy = 0) => {
      const st = state.current;
      if (!st) return;
      const { tool: t, size: s, pressure: p } = settings.current;
      const rect = st.field.dab(t, x, y, s / 2, p / 100, vx, vy, down?.alt);
      if (!rect) return;
      renderWarp(st.src, pw, ph, st.out.data, st.field, 1, rect);
      ctx2d(el).putImageData(st.out, 0, 0, rect.x0, rect.y0, rect.x1 - rect.x0 + 1, rect.y1 - rect.y0 + 1);
    };
    // 부풀리기, 오므리기, 돌리기, 되돌리기는 누르고 있는 동안 계속
    const hold = () => {
      if (!down) return;
      if (settings.current.tool !== "push") stamp(down.x, down.y);
      raf = requestAnimationFrame(hold);
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      el.setPointerCapture(e.pointerId);
      down = { ...pos(e), alt: e.altKey };
      raf = requestAnimationFrame(hold);
    };
    const onMove = (e: PointerEvent) => {
      const p = pos(e);
      const r = el.getBoundingClientRect();
      setCursor({ x: e.clientX - r.left, y: e.clientY - r.top });
      if (!down) return;
      if (settings.current.tool === "push") {
        // 붓 크기의 1/4 마다 나눠서 밀어 끊기지 않게
        const dist = Math.hypot(p.x - down.x, p.y - down.y);
        const steps = Math.max(1, Math.ceil(dist / Math.max(2, settings.current.size / 8)));
        for (let i = 1; i <= steps; i++) {
          const ax = down.x + ((p.x - down.x) * (i - 1)) / steps;
          const ay = down.y + ((p.y - down.y) * (i - 1)) / steps;
          stamp(ax, ay, (p.x - down.x) / steps, (p.y - down.y) / steps);
        }
      }
      down.x = p.x;
      down.y = p.y;
    };
    const onUp = () => {
      down = null;
      cancelAnimationFrame(raf);
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointerleave", () => setCursor(null));
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
    };
  }, [pw, ph]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const k = e.key.toLowerCase();
      const t = LIQUIFY_TOOLS.find((x) => x.key.toLowerCase() === k);
      if (t) setTool(t.id);
      else if (e.key === "[") setSize((s) => Math.max(6, Math.round(s / 1.2)));
      else if (e.key === "]") setSize((s) => Math.min(600, Math.round(s * 1.2)));
      else if (e.key === "Escape") onCancel();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onCancel]);

  const resetAll = () => {
    const st = state.current;
    if (!st) return;
    st.field.dx.fill(0);
    st.field.dy.fill(0);
    st.out.data.set(st.src);
    ctx2d(canvas.current!).putImageData(st.out, 0, 0);
  };

  const apply = async () => {
    const st = state.current;
    if (!st || st.field.isEmpty()) return onCancel();
    setBusy(true);
    await new Promise((r) => setTimeout(r, 30));
    const w = base.width;
    const h = base.height;
    const g = ctx2d(base);
    const src = g.getImageData(0, 0, w, h);
    const out = new ImageData(w, h);
    renderWarp(src.data, w, h, out.data, st.field, w / pw);
    const result = createCanvas(w, h);
    ctx2d(result).putImageData(out, 0, 0);
    if (sel) {
      // 선택 영역 안만 바꾼 것으로, 밖은 원래대로
      const inside = ctx2d(result);
      inside.globalCompositeOperation = "destination-in";
      inside.drawImage(sel, 0, 0);
      const merged = createCanvas(w, h);
      const m = ctx2d(merged);
      m.drawImage(base, 0, 0);
      m.globalCompositeOperation = "destination-out";
      m.drawImage(sel, 0, 0);
      m.globalCompositeOperation = "source-over";
      m.drawImage(result, 0, 0);
      return onApply(merged);
    }
    onApply(result);
  };

  const shown = canvas.current ? canvas.current.getBoundingClientRect().width / pw : 1;
  const current = LIQUIFY_TOOLS.find((t) => t.id === tool)!;

  return (
    <div className="dialog-dim">
      <div className="liquify" role="dialog" aria-label="픽셀 유동화">
        <div className="liquify-tools">
          {LIQUIFY_TOOLS.map((t) => (
            <button key={t.id} aria-pressed={tool === t.id} title={`${t.label} (${t.key}) · ${t.hint}`} onClick={() => setTool(t.id)}>
              <b>{t.icon}</b>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        <div className="liquify-stage">
          <canvas ref={canvas} width={pw} height={ph} />
          {cursor && <span className="liquify-cursor" style={{ left: cursor.x, top: cursor.y, width: size * shown, height: size * shown }} />}
        </div>
        <div className="liquify-side">
          <h2>픽셀 유동화</h2>
          <p>{current.hint}</p>
          <label className="ps-num wide">
            <span>붓 크기</span>
            <input type="range" min={6} max={600} value={size} onChange={(e) => setSize(Number(e.target.value))} />
            <b>{size}</b>
          </label>
          <label className="ps-num wide">
            <span>세기</span>
            <input type="range" min={1} max={100} value={pressure} onChange={(e) => setPressure(Number(e.target.value))} />
            <b>{pressure}</b>
          </label>
          <p className="liquify-keys">[ ] 붓 크기 · W B S C R 도구 · Alt: 반대로{sel ? " · 선택 영역 안만 바뀌어요" : ""}</p>
          <button className="suite-ai-link" onClick={resetAll}>
            모두 되돌리기
          </button>
          <div className="dialog-actions">
            <button className="suite-ai-link" onClick={onCancel}>
              취소
            </button>
            <button className="suite-button" disabled={busy} onClick={() => void apply()}>
              {busy ? "적용하는 중…" : "적용"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
