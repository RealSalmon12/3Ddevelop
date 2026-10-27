// 효과 랙 패널: 효과를 위에서 아래로 이어 걸고, 재생하며 바로 들어 본 뒤 ‘적용’ 으로 굳힌다.
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { DEFAULT_BANDS, FX_INFO, RACK_PRESETS, eqResponse, newFx, type Band, type BandType, type Fx, type FxKind } from "./effects";

export function Knob({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "",
  log = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  /** 주파수처럼 로그 눈금으로 움직일지 */
  log?: boolean;
  onChange: (v: number) => void;
}) {
  const toPos = (v: number) => (log ? (Math.log(v / min) / Math.log(max / min)) * 1000 : v);
  const fromPos = (p: number) => {
    const v = log ? min * Math.pow(max / min, p / 1000) : p;
    return Math.round(v / step) * step;
  };
  const shown = Math.abs(value) >= 1000 && unit === "Hz" ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value * 100) / 100);
  return (
    <label className="fx-knob">
      <span>{label}</span>
      <input
        type="range"
        min={log ? 0 : min}
        max={log ? 1000 : max}
        step={log ? 1 : step}
        value={toPos(value)}
        onChange={(e) => onChange(fromPos(Number(e.target.value)))}
      />
      <input
        type="number"
        className="fx-num"
        value={shown.endsWith("k") ? value : shown}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)));
        }}
      />
      <small>{unit}</small>
    </label>
  );
}

const BAND_LABEL: Record<BandType, string> = {
  highpass: "저음 자르기",
  lowshelf: "저음 선반",
  peaking: "벨",
  highshelf: "고음 선반",
  lowpass: "고음 자르기",
  notch: "노치",
};
const BAND_COLORS = ["#ff7a7a", "#ffb347", "#ffe066", "#7ee08a", "#6fb4ff", "#c48bff"];

const FREQS = (() => {
  const n = 220;
  return Float32Array.from({ length: n }, (_, i) => 20 * Math.pow(1000, i / (n - 1)));
})();
const fx2x = (f: number, w: number) => (Math.log(f / 20) / Math.log(1000)) * w;
const x2f = (x: number, w: number) => 20 * Math.pow(1000, Math.max(0, Math.min(1, x / w)));
const DB = 18;

/** EQ 곡선: 점을 끌면 주파수(좌우)와 크기(위아래), 휠로 폭(Q) */
function EqGraph({ bands, onChange, spectrum }: { bands: Band[]; onChange: (b: Band[]) => void; spectrum?: Float32Array | null }) {
  const W = 268;
  const H = 120;
  const svg = useRef<SVGSVGElement>(null);
  const curve = useMemo(() => eqResponse(bands, FREQS), [bands]);
  const y = (db: number) => H / 2 - (db / DB) * (H / 2 - 6);
  const path = Array.from(curve, (db, i) => `${i ? "L" : "M"}${fx2x(FREQS[i], W).toFixed(1)},${y(Math.max(-DB - 6, Math.min(DB + 6, db))).toFixed(1)}`).join("");
  const drag = (i: number) => (e: ReactPointerEvent) => {
    e.preventDefault();
    const rect = svg.current!.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const px = ((ev.clientX - rect.left) / rect.width) * W;
      const py = ((ev.clientY - rect.top) / rect.height) * H;
      const freq = Math.round(x2f(px, W));
      const gain = Math.round(Math.max(-DB, Math.min(DB, ((H / 2 - py) / (H / 2 - 6)) * DB)) * 10) / 10;
      const b = bands[i];
      const usesGain = b.type === "peaking" || b.type === "lowshelf" || b.type === "highshelf";
      onChange(bands.map((x, j) => (j === i ? { ...x, on: true, freq, gain: usesGain ? gain : x.gain } : x)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const grid = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
  return (
    <svg ref={svg} className="eq-graph" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {spectrum && (
        <path
          className="eq-spectrum"
          d={
            Array.from(spectrum, (v, i) => `${i ? "L" : "M"}${((i / (spectrum.length - 1)) * W).toFixed(1)},${(H - Math.max(0, Math.min(1, (v + 100) / 90)) * H).toFixed(1)}`).join("") +
            `L${W},${H}L0,${H}Z`
          }
        />
      )}
      {grid.map((f) => (
        <line key={f} x1={fx2x(f, W)} x2={fx2x(f, W)} y1={0} y2={H} className="eq-grid" />
      ))}
      {[-12, -6, 0, 6, 12].map((d) => (
        <line key={d} x1={0} x2={W} y1={y(d)} y2={y(d)} className={d === 0 ? "eq-grid zero" : "eq-grid"} />
      ))}
      {[100, 1000, 10000].map((f) => (
        <text key={f} x={fx2x(f, W) + 2} y={H - 3} className="eq-label">
          {f >= 1000 ? `${f / 1000}k` : f}
        </text>
      ))}
      <path d={path} className="eq-curve" />
      {bands.map((b, i) => {
        const usesGain = b.type === "peaking" || b.type === "lowshelf" || b.type === "highshelf";
        return (
          <circle
            key={i}
            cx={fx2x(b.freq, W)}
            cy={usesGain ? y(b.gain) : H / 2}
            r={5}
            fill={b.on ? BAND_COLORS[i % BAND_COLORS.length] : "transparent"}
            stroke={BAND_COLORS[i % BAND_COLORS.length]}
            className="eq-dot"
            onPointerDown={drag(i)}
            onWheel={(e) => onChange(bands.map((x, j) => (j === i ? { ...x, q: Math.max(0.1, Math.min(18, x.q * (e.deltaY < 0 ? 1.15 : 1 / 1.15))) } : x)))}
            onDoubleClick={() => onChange(bands.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))}
          >
            <title>{`${BAND_LABEL[b.type]} ${Math.round(b.freq)}Hz${usesGain ? ` ${b.gain}dB` : ""} · 끌기: 옮기기 · 휠: 폭 · 두 번 클릭: 켜기/끄기`}</title>
          </circle>
        );
      })}
    </svg>
  );
}

function FxBody({ fx, set, spectrum }: { fx: Fx; set: (patch: Partial<Fx>) => void; spectrum?: Float32Array | null }) {
  switch (fx.kind) {
    case "eq":
      return (
        <>
          <EqGraph bands={fx.bands} onChange={(bands) => set({ bands } as Partial<Fx>)} spectrum={spectrum} />
          <div className="eq-bands">
            {fx.bands.map((b, i) => (
              <div key={i} className="eq-band">
                <input type="checkbox" checked={b.on} onChange={(e) => set({ bands: fx.bands.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)) } as Partial<Fx>)} />
                <i style={{ background: BAND_COLORS[i % BAND_COLORS.length] }} />
                <select value={b.type} onChange={(e) => set({ bands: fx.bands.map((x, j) => (j === i ? { ...x, type: e.target.value as BandType } : x)) } as Partial<Fx>)}>
                  {Object.entries(BAND_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <span>{b.freq >= 1000 ? `${(b.freq / 1000).toFixed(1)}k` : Math.round(b.freq)}Hz</span>
                <span>{b.type === "peaking" || b.type.endsWith("shelf") ? `${b.gain > 0 ? "+" : ""}${b.gain}dB` : `Q${b.q.toFixed(1)}`}</span>
              </div>
            ))}
          </div>
          <div className="prop-buttons">
            <button className="mini" onClick={() => set({ bands: DEFAULT_BANDS.map((b) => ({ ...b })) } as Partial<Fx>)}>
              평평하게
            </button>
          </div>
        </>
      );
    case "compressor":
      return (
        <>
          <CompCurve threshold={fx.threshold} ratio={fx.ratio} knee={fx.knee} makeup={fx.makeup} />
          <Knob label="문턱" value={fx.threshold} min={-60} max={0} unit="dB" onChange={(threshold) => set({ threshold })} />
          <Knob label="비율" value={fx.ratio} min={1} max={20} step={0.1} unit=":1" onChange={(ratio) => set({ ratio })} />
          <Knob label="어택" value={fx.attack} min={0} max={200} unit="ms" onChange={(attack) => set({ attack })} />
          <Knob label="릴리스" value={fx.release} min={10} max={1000} unit="ms" onChange={(release) => set({ release })} />
          <Knob label="무릎" value={fx.knee} min={0} max={30} unit="dB" onChange={(knee) => set({ knee })} />
          <Knob label="메이크업" value={fx.makeup} min={0} max={24} step={0.5} unit="dB" onChange={(makeup) => set({ makeup })} />
        </>
      );
    case "reverb":
      return (
        <>
          <Knob label="방 크기" value={fx.size} min={0.2} max={6} step={0.1} unit="초" onChange={(size) => set({ size })} />
          <Knob label="잦아듦" value={fx.decay} min={0.5} max={8} step={0.1} onChange={(decay) => set({ decay })} />
          <Knob label="첫 지연" value={fx.predelay} min={0} max={200} unit="ms" onChange={(predelay) => set({ predelay })} />
          <Knob label="울림" value={fx.wet} min={0} max={100} unit="%" onChange={(wet) => set({ wet })} />
          <Knob label="원음" value={fx.dry} min={0} max={100} unit="%" onChange={(dry) => set({ dry })} />
        </>
      );
    case "delay":
      return (
        <>
          <Knob label="간격" value={fx.time} min={20} max={2000} unit="ms" onChange={(time) => set({ time })} />
          <Knob label="되풀이" value={fx.feedback} min={0} max={90} unit="%" onChange={(feedback) => set({ feedback })} />
          <Knob label="섞기" value={fx.wet} min={0} max={100} unit="%" onChange={(wet) => set({ wet })} />
          <label className="fx-check">
            <input type="checkbox" checked={fx.pingpong} onChange={(e) => set({ pingpong: e.target.checked })} /> 핑퐁 (왼쪽 오른쪽 번갈아)
          </label>
        </>
      );
    case "chorus":
      return (
        <>
          <Knob label="속도" value={fx.rate} min={0.1} max={40} step={0.1} unit="Hz" onChange={(rate) => set({ rate })} />
          <Knob label="깊이" value={fx.depth} min={0.5} max={15} step={0.5} unit="ms" onChange={(depth) => set({ depth })} />
          <Knob label="섞기" value={fx.wet} min={0} max={100} unit="%" onChange={(wet) => set({ wet })} />
        </>
      );
    case "distortion":
      return (
        <>
          <Knob label="세기" value={fx.drive} min={0} max={100} unit="%" onChange={(drive) => set({ drive })} />
          <Knob label="톤" value={fx.tone} min={500} max={16000} log unit="Hz" onChange={(tone) => set({ tone })} />
          <Knob label="섞기" value={fx.wet} min={0} max={100} unit="%" onChange={(wet) => set({ wet })} />
        </>
      );
    case "stereo":
      return (
        <>
          <Knob label="팬 (좌↔우)" value={fx.pan} min={-100} max={100} onChange={(pan) => set({ pan })} />
          <Knob label="넓이" value={fx.width} min={0} max={200} unit="%" onChange={(width) => set({ width })} />
        </>
      );
    case "gain":
      return <Knob label="볼륨" value={fx.db} min={-30} max={24} step={0.5} unit="dB" onChange={(db) => set({ db })} />;
  }
}

/** 컴프레서 입력→출력 그래프 */
function CompCurve({ threshold, ratio, knee, makeup }: { threshold: number; ratio: number; knee: number; makeup: number }) {
  const S = 80;
  const out = (x: number) => {
    let y: number;
    if (2 * (x - threshold) < -knee) y = x;
    else if (2 * Math.abs(x - threshold) <= knee) y = x + ((1 / ratio - 1) * (x - threshold + knee / 2) ** 2) / (2 * Math.max(0.01, knee));
    else y = threshold + (x - threshold) / ratio;
    return y + makeup;
  };
  const p = Array.from({ length: 61 }, (_, i) => {
    const x = -60 + i;
    return `${i ? "L" : "M"}${((x + 60) / 60) * S},${S - (Math.max(-60, Math.min(0, out(x))) + 60) / 60 * S}`;
  }).join("");
  return (
    <svg className="comp-curve" viewBox={`0 0 ${S} ${S}`}>
      <line x1={0} y1={S} x2={S} y2={0} className="eq-grid" />
      <line x1={((threshold + 60) / 60) * S} x2={((threshold + 60) / 60) * S} y1={0} y2={S} className="eq-grid zero" />
      <path d={p} className="eq-curve" />
    </svg>
  );
}

interface RackProps {
  rack: Fx[];
  setRack: (r: Fx[]) => void;
  /** 멀티트랙의 트랙 랙처럼 늘 들리는 랙은 아래 셋을 빼고 title 만 준다 */
  live?: boolean;
  setLive?: (v: boolean) => void;
  onApply?: () => void;
  busy?: boolean;
  spectrum?: Float32Array | null;
  title?: string;
}

export function RackPanel({ rack, setRack, live = true, setLive, onApply, busy, spectrum, title = "🎛 효과 랙" }: RackProps) {
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const dragFrom = useRef<number | null>(null);
  const patch = (id: string, p: Partial<Fx>) => setRack(rack.map((f) => (f.id === id ? ({ ...f, ...p } as Fx) : f)));
  const add = (kind: FxKind) => {
    const fx = newFx(kind);
    setRack([...rack, fx]);
    setOpen(fx.id);
    setAdding(false);
  };
  return (
    <section className="suite-panel rack-panel">
      <div className="suite-panel-title rack-title">
        <span>{title}</span>
        {setLive && (
          <label className="rack-live" title="켜 두면 재생할 때 랙을 거친 소리를 들어요 (소리는 바뀌지 않아요)">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> 들으며 고치기
          </label>
        )}
      </div>
      <div className="suite-panel-body">
        <div className="rack-row">
          <select
            value=""
            onChange={(e) => {
              const p = RACK_PRESETS.find((x) => x.label === e.target.value);
              if (p) {
                const r = p.make();
                setRack(r);
                setOpen(r[0]?.id ?? null);
                setLive?.(true);
              }
            }}
          >
            <option value="">미리 설정 불러오기…</option>
            {RACK_PRESETS.map((p) => (
              <option key={p.label}>{p.label}</option>
            ))}
          </select>
          {rack.length > 0 && (
            <button className="mini" title="랙 비우기" onClick={() => setRack([])}>
              비우기
            </button>
          )}
        </div>
        <ol className="rack-list">
          {rack.map((fx, i) => {
            const info = FX_INFO.find((x) => x.kind === fx.kind)!;
            return (
              <li
                key={fx.id}
                className={fx.on ? "rack-fx" : "rack-fx off"}
                draggable
                onDragStart={() => (dragFrom.current = i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  const from = dragFrom.current;
                  dragFrom.current = null;
                  if (from === null || from === i) return;
                  const next = rack.slice();
                  const [m] = next.splice(from, 1);
                  next.splice(i, 0, m);
                  setRack(next);
                }}
              >
                <div className="rack-fx-head">
                  <button className="rack-power" aria-pressed={fx.on} title="켜기 / 끄기 (건너뛰기)" onClick={() => patch(fx.id, { on: !fx.on })}>
                    ⏻
                  </button>
                  <button className="rack-name" onClick={() => setOpen(open === fx.id ? null : fx.id)} title={info.hint}>
                    <b>{info.icon}</b> {info.label}
                    <span>{open === fx.id ? "▾" : "▸"}</span>
                  </button>
                  <button className="rack-x" title="빼기" onClick={() => setRack(rack.filter((f) => f.id !== fx.id))}>
                    ✕
                  </button>
                </div>
                {open === fx.id && (
                  <div className="rack-fx-body">
                    <FxBody fx={fx} set={(p) => patch(fx.id, p)} spectrum={spectrum} />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {adding ? (
          <div className="rack-add-grid">
            {FX_INFO.map((f) => (
              <button key={f.kind} className="mini" title={f.hint} onClick={() => add(f.kind)}>
                {f.icon} {f.label}
              </button>
            ))}
          </div>
        ) : (
          <button className="mini rack-add" onClick={() => setAdding(true)}>
            ＋ 효과 넣기
          </button>
        )}
        {rack.length > 0 && onApply && (
          <button className="mini go rack-apply" disabled={busy} onClick={onApply} title="고른 부분(없으면 전체)에 랙을 굳혀요">
            {busy ? "적용하는 중…" : "✔ 고른 부분에 적용"}
          </button>
        )}
      </div>
    </section>
  );
}
