import { useEffect, useRef } from "react";
import { lengthOf, type Range, type Sound } from "./audio";

interface Props {
  sound: Sound;
  selection: Range | null;
  /** 커서 (샘플 위치) */
  cursor: number;
  /** 재생 중인 위치 (샘플), 멈춰 있으면 null */
  playhead: number | null;
  onSelect: (selection: Range | null, cursor: number) => void;
}

/** 소리 모양(파형)을 그리고, 끌어서 부분을 고르게 한다. */
export function Waveform({ sound, selection, cursor, playhead, onSelect }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const peaks = useRef<{ sound: Sound; width: number; data: Float32Array } | null>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const n = lengthOf(sound);
      const mid = h / 2;
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(0, mid, w, 1);
      if (!n) return;
      // 화면 한 칸마다 가장 큰 값과 작은 값
      if (!peaks.current || peaks.current.sound !== sound || peaks.current.width !== w) {
        const data = new Float32Array(w * 2);
        const per = n / w;
        for (let x = 0; x < w; x++) {
          let lo = 0;
          let hi = 0;
          const a = Math.floor(x * per);
          const b = Math.max(a + 1, Math.floor((x + 1) * per));
          for (const ch of sound.channels)
            for (let i = a; i < b && i < n; i += Math.max(1, Math.floor((b - a) / 200))) {
              if (ch[i] < lo) lo = ch[i];
              if (ch[i] > hi) hi = ch[i];
            }
          data[x * 2] = lo;
          data[x * 2 + 1] = hi;
        }
        peaks.current = { sound, width: w, data };
      }
      const toX = (s: number) => (s / n) * w;
      if (selection) {
        ctx.fillStyle = "rgba(255,200,61,0.14)";
        ctx.fillRect(toX(selection.start), 0, toX(selection.end) - toX(selection.start), h);
      }
      const d = peaks.current.data;
      for (let x = 0; x < w; x++) {
        const inSel = selection && x >= toX(selection.start) && x <= toX(selection.end);
        ctx.fillStyle = inSel ? "#ffc83d" : "#5fd3a0";
        const top = mid - d[x * 2 + 1] * mid * 0.92;
        const bottom = mid - d[x * 2] * mid * 0.92;
        ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
      }
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(Math.round(toX(cursor)), 0, 1.5, h);
      if (playhead !== null) {
        ctx.fillStyle = "#b39dff";
        ctx.fillRect(Math.round(toX(playhead)), 0, 2, h);
      }
    };
    draw();
    const resize = new ResizeObserver(draw);
    resize.observe(canvas);
    return () => resize.disconnect();
  }, [sound, selection, cursor, playhead]);

  useEffect(() => {
    const canvas = ref.current!;
    let start: number | null = null;
    const at = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const n = lengthOf(sound);
      return Math.round(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * n);
    };
    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      start = at(e);
      onSelect(null, start);
    };
    const move = (e: PointerEvent) => {
      if (start === null) return;
      const p = at(e);
      const a = Math.min(start, p);
      const b = Math.max(start, p);
      onSelect(b - a > lengthOf(sound) / 500 ? { start: a, end: b } : null, start);
    };
    const up = () => (start = null);
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
    };
  }, [sound, onSelect]);

  return <canvas ref={ref} className="waveform" />;
}
