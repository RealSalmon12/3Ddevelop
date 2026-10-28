import { useEffect, useRef, useState } from "react";
import { clipDuration, EASE_PRESETS, evalParam, type Clip, type Key, type KeyEase, type ParamName } from "./model";

interface Props {
  clip: Clip;
  name: ParamName;
  unit: string;
  /** 재생 위치 (클립 시작부터 초) */
  local: number;
  preview: (c: Clip) => void;
  commit: () => void;
  set: (c: Clip) => void;
  onSeek: (t: number) => void;
}

const H = 132;
const PAD = 10;
const BOX = 116;
/** 조절점 곡선이 없는 키(부드럽게)를 끌기 시작할 때의 모양 */
const SMOOTH: [number, number, number, number] = [0.42, 0, 0.58, 1];

type Drag = { kind: "key"; index: number; x: number; y: number; t: number; v: number } | { kind: "handle"; which: 0 | 1 };

/**
 * 그래프 에디터 (애프터 이펙트·프리미어): 값이 시간에 따라 어떻게 바뀌는지 곡선으로 보고,
 * 키를 끌어 시간과 값을 고치고, 키 사이 구간의 속도 곡선을 손잡이로 다듬는다.
 */
export function GraphEditor({ clip, name, unit, local, preview, commit, set, onSeek }: Props) {
  const p = clip.params[name];
  const keys = p.keys ?? [];
  const [mode, setMode] = useState<"value" | "speed">("value");
  const [sel, setSel] = useState(() => Math.max(0, keys.findIndex((k, i) => i < keys.length - 1 && local >= k.t && local <= keys[i + 1].t)));
  const seg = Math.min(sel, Math.max(0, keys.length - 2));
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(260);
  const drag = useRef<Drag | null>(null);
  const moved = useRef(false);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(120, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const dur = Math.max(clipDuration(clip), keys.length ? keys[keys.length - 1].t : 0, 1e-3);
  const W = width;
  const N = Math.max(60, Math.round(W / 2));
  const samples: number[] = [];
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * dur;
    if (mode === "value") samples.push(evalParam(p, t));
    else {
      const h = dur / N / 2;
      samples.push((evalParam(p, Math.min(dur, t + h)) - evalParam(p, Math.max(0, t - h))) / (Math.min(dur, t + h) - Math.max(0, t - h)));
    }
  }
  const vals = mode === "value" ? [...samples, ...keys.map((k) => k.v)] : samples;
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (mode === "speed") {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (hi - lo < 1e-6) {
    lo -= 1;
    hi += 1;
  }
  const span = hi - lo;
  lo -= span * 0.12;
  hi += span * 0.12;
  const sx = (t: number) => PAD + (t / dur) * (W - PAD * 2);
  const sy = (v: number) => PAD + (1 - (v - lo) / (hi - lo)) * (H - PAD * 2);
  const tx = (x: number) => ((x - PAD) / (W - PAD * 2)) * dur;
  const vy = (y: number) => lo + (1 - (y - PAD) / (H - PAD * 2)) * (hi - lo);
  const path = samples.map((v, i) => `${i ? "L" : "M"}${sx((i / N) * dur).toFixed(1)},${sy(v).toFixed(1)}`).join("");

  const withKeys = (next: Key[]) => ({ ...clip, params: { ...clip.params, [name]: { value: next[0]?.v ?? p.value, keys: next } } });
  const setEase = (ease: KeyEase | undefined, all = false) => {
    const next = keys.map((k, i) => {
      if (i >= keys.length - 1 || (!all && i !== seg)) return k;
      const { ease: _old, ...rest } = k;
      return ease ? { ...rest, ease } : rest;
    });
    set(withKeys(next));
  };

  const local2 = (e: React.PointerEvent) => {
    const r = (e.currentTarget as Element).closest("svg")!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onKeyDown = (e: React.PointerEvent, index: number) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const { x, y } = local2(e);
    drag.current = { kind: "key", index, x, y, t: keys[index].t, v: keys[index].v };
    moved.current = false;
    setSel(Math.min(index, keys.length - 2));
  };
  const onKeyMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.kind !== "key") return;
    const { x, y } = local2(e);
    if (!moved.current && Math.hypot(x - d.x, y - d.y) < 3) return;
    moved.current = true;
    const prev = keys[d.index - 1];
    const nxt = keys[d.index + 1];
    const gap = 1 / 60;
    // Shift: 시간은 그대로, 값만
    const t = e.shiftKey ? d.t : Math.min(nxt ? nxt.t - gap : dur, Math.max(prev ? prev.t + gap : 0, d.t + tx(x) - tx(d.x)));
    // 값 그래프에서만 값을 옮긴다 (속도 그래프에서는 시간만)
    const v = mode === "value" ? d.v + vy(y) - vy(d.y) : d.v;
    preview(withKeys(keys.map((k, i) => (i === d.index ? { ...k, t, v: Math.round(v * 100) / 100 } : k))));
  };
  const onKeyUp = (index: number) => {
    const d = drag.current;
    drag.current = null;
    if (moved.current) commit();
    else if (d) onSeek(clip.start + keys[index].t);
  };

  // 속도 곡선 상자 (고른 구간을 0~1 로 펴서 본다)
  const a = keys[seg];
  const ease = a?.ease;
  const curve: [number, number, number, number] | null = ease === "hold" ? null : (ease ?? SMOOTH);
  // 넘치는 손잡이도 보이게 세로 범위를 넓힌다
  const top = Math.max(1.15, ...(curve ? [curve[1], curve[3]] : []).map((v) => v + 0.1));
  const bottom = Math.min(-0.15, ...(curve ? [curve[1], curve[3]] : []).map((v) => v - 0.1));
  const bx = (u: number) => PAD + u * (BOX - PAD * 2);
  const by = (u: number) => PAD + ((top - u) / (top - bottom)) * (BOX - PAD * 2);
  const ux = (x: number) => (x - PAD) / (BOX - PAD * 2);
  const uy = (y: number) => top - ((y - PAD) / (BOX - PAD * 2)) * (top - bottom);
  let easePath = "";
  for (let i = 0; i <= 48; i++) {
    const u = i / 48;
    const v = ease === "hold" ? (u >= 1 ? 1 : 0) : !ease ? u * u * (3 - 2 * u) : null;
    if (v !== null) easePath += `${i ? "L" : "M"}${bx(u).toFixed(1)},${by(v).toFixed(1)}`;
  }
  if (ease && ease !== "hold") {
    const [x1, y1, x2, y2] = ease;
    easePath = `M${bx(0)},${by(0)} C${bx(x1)},${by(y1)} ${bx(x2)},${by(y2)} ${bx(1)},${by(1)}`;
  }
  const onHandleDown = (e: React.PointerEvent, which: 0 | 1) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { kind: "handle", which };
  };
  const onHandleMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.kind !== "handle" || !curve) return;
    const { x, y } = local2(e);
    const c = [...curve] as [number, number, number, number];
    const u = Math.min(1, Math.max(0, ux(x)));
    const v = Math.min(2, Math.max(-1, uy(y)));
    c[d.which * 2] = Math.round(u * 100) / 100;
    c[d.which * 2 + 1] = Math.round(v * 100) / 100;
    preview(withKeys(keys.map((k, i) => (i === seg ? { ...k, ease: c } : k))));
  };
  const onHandleUp = () => {
    if (drag.current?.kind === "handle") commit();
    drag.current = null;
  };

  const presetId = EASE_PRESETS.find((x) => JSON.stringify(x.ease) === JSON.stringify(ease))?.id ?? "custom";
  const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));

  return (
    <div
      className="graph-editor"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "F9") {
          e.preventDefault();
          setEase(undefined, e.shiftKey);
        }
      }}
    >
      <div className="graph-top">
        <div className="graph-modes">
          <button aria-pressed={mode === "value"} title="값이 시간에 따라 어떻게 바뀌는지" onClick={() => setMode("value")}>
            값 그래프
          </button>
          <button aria-pressed={mode === "speed"} title="얼마나 빨리 바뀌는지 (초당 변화량)" onClick={() => setMode("speed")}>
            속도 그래프
          </button>
        </div>
        <span className="graph-range">
          {fmt(hi)}
          {mode === "speed" ? `${unit}/초` : unit} ~ {fmt(lo)}
        </span>
      </div>
      <div ref={wrap} className="graph-wrap">
        <svg
          width={W}
          height={H}
          className="graph-svg"
          onPointerDown={(e) => {
            if (e.button === 0) onSeek(clip.start + Math.min(dur, Math.max(0, tx(local2(e).x))));
          }}
        >
          {mode === "speed" && <line x1={PAD} x2={W - PAD} y1={sy(0)} y2={sy(0)} className="graph-zero" />}
          {keys.length > 1 && <rect x={sx(keys[seg].t)} y={PAD} width={Math.max(1, sx(keys[seg + 1].t) - sx(keys[seg].t))} height={H - PAD * 2} className="graph-seg" />}
          <path d={path} className="graph-curve" />
          <line x1={sx(local)} x2={sx(local)} y1={0} y2={H} className="graph-playhead" />
          {keys.map((k, i) => {
            const cx = sx(k.t);
            const cy = mode === "value" ? sy(k.v) : H - PAD;
            return (
              <rect
                key={i}
                x={cx - 5}
                y={cy - 5}
                width={10}
                height={10}
                transform={`rotate(45 ${cx} ${cy})`}
                className={`graph-key${i === seg || i === seg + 1 ? " on" : ""}`}
                onPointerDown={(e) => onKeyDown(e, i)}
                onPointerMove={onKeyMove}
                onPointerUp={() => onKeyUp(i)}
              >
                <title>{`${k.t.toFixed(2)}초 · ${fmt(k.v)}${unit} (끌어서 옮기기, Shift: 값만)`}</title>
              </rect>
            );
          })}
        </svg>
      </div>
      {keys.length > 1 && (
        <div className="graph-ease">
          <svg width={BOX} height={BOX} className="graph-box" onPointerMove={onHandleMove} onPointerUp={onHandleUp}>
            <rect x={bx(0)} y={by(1)} width={bx(1) - bx(0)} height={by(0) - by(1)} className="graph-box-frame" />
            <path d={easePath} className="graph-curve" />
            {curve && (
              <>
                <line x1={bx(0)} y1={by(0)} x2={bx(curve[0])} y2={by(curve[1])} className="graph-arm" />
                <line x1={bx(1)} y1={by(1)} x2={bx(curve[2])} y2={by(curve[3])} className="graph-arm" />
                {([0, 1] as const).map((w) => (
                  <circle
                    key={w}
                    cx={bx(curve[w * 2])}
                    cy={by(curve[w * 2 + 1])}
                    r={5}
                    className={`graph-handle${ease ? "" : " ghost"}`}
                    onPointerDown={(e) => onHandleDown(e, w)}
                    onPointerMove={onHandleMove}
                    onPointerUp={onHandleUp}
                  >
                    <title>{w === 0 ? "출발 손잡이: 오른쪽으로 길게 끌수록 천천히 출발" : "도착 손잡이: 왼쪽으로 길게 끌수록 천천히 도착"}</title>
                  </circle>
                ))}
              </>
            )}
          </svg>
          <div className="graph-presets">
            <span className="graph-seg-label">
              구간 {seg + 1}/{keys.length - 1} · {(keys[seg + 1].t - keys[seg].t).toFixed(2)}초
              {presetId === "custom" && curve ? ` · (${curve.join(", ")})` : ""}
            </span>
            {EASE_PRESETS.map((x) => (
              <button key={x.id} aria-pressed={presetId === x.id} title={x.title} onClick={() => setEase(x.ease)}>
                {x.label}
              </button>
            ))}
            <button title="지금 고른 속도 곡선을 이 값의 모든 구간에 (Shift+F9: 모두 부드럽게)" onClick={() => setEase(ease, true)}>
              모든 구간에
            </button>
          </div>
        </div>
      )}
      <p className="graph-tip">◆ 를 끌면 키의 시간과 값이 바뀌어요. 위 그래프에서 키를 누르면 그 뒤 구간을 골라요. 아래 상자의 손잡이로 출발·도착 속도를 다듬어요.</p>
    </div>
  );
}
