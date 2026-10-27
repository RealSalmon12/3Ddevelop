import { useEffect, useRef, useState, type ReactNode } from "react";
import { Panel } from "@suite/ui";
import { curveLut, histogram } from "./adjustments";
import {
  ADJUSTMENTS,
  BLEND_MODES,
  DEFAULT_SETTINGS as DEFAULTS,
  NO_ADJUST,
  NO_EFFECTS,
  type AdjustKind,
  type AdjustLayer,
  type AdjustSettings,
  type Effects,
  type Layer,
  type PhotoDoc,
  type QuickAdjust,
  type RasterLayer,
  type ShapeLayer,
  type TextLayer,
} from "./model";
import { createCanvas, ctx2d, pixels } from "./pixels";
import { flatten, layerContent } from "./render";

export const QUICK_PRESETS: { label: string; adjust: Partial<QuickAdjust> }[] = [
  { label: "원래대로", adjust: NO_ADJUST },
  { label: "선명하게", adjust: { contrast: 125, saturation: 130, brightness: 105 } },
  { label: "따뜻하게", adjust: { warmth: 45, saturation: 110 } },
  { label: "시원하게", adjust: { warmth: -45, brightness: 104 } },
  { label: "흑백", adjust: { grayscale: true, contrast: 115 } },
  { label: "빈티지", adjust: { warmth: 35, contrast: 85, saturation: 70, brightness: 105 } },
];

export const FONTS = ["Pretendard Variable", "Malgun Gothic", "Gulim", "Batang", "Arial", "Arial Black", "Impact", "Georgia", "Times New Roman", "Comic Sans MS", "Consolas"];

interface Live {
  onPreview: (layer: Layer) => void;
  onCommit: () => void;
  onChange: (layer: Layer) => void;
}

/* ───────── 작은 부품 ───────── */

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "",
  onPreview,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onPreview: (v: number) => void;
  onCommit: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <label className="prop-slider">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onPreview(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onDoubleClick={() => {
          onPreview(Math.min(max, Math.max(min, 0)));
          onCommit();
        }}
      />
      <input
        className="prop-num"
        value={text ?? `${Math.round(value * 10) / 10}`}
        onFocus={(e) => {
          setText(String(Math.round(value * 10) / 10));
          requestAnimationFrame(() => e.target.select());
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const n = Number(text);
          setText(null);
          if (text !== null && Number.isFinite(n)) {
            onPreview(Math.min(max, Math.max(min, n)));
            onCommit();
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          e.stopPropagation();
        }}
      />
      <small>{unit}</small>
    </label>
  );
}

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="prop-section">
      <div className="prop-section-head">
        <button onClick={() => setOpen(!open)}>
          {open ? "▾" : "▸"} {title}
        </button>
        {right}
      </div>
      {open && <div className="prop-section-body">{children}</div>}
    </div>
  );
}

function Color({ value, onChange, title }: { value: string; onChange: (v: string) => void; title?: string }) {
  return <input type="color" title={title} value={value} onChange={(e) => onChange(e.target.value)} />;
}

/* ───────── 속성 ───────── */

export function PropertiesPanel({
  doc,
  layer,
  editMask,
  onBackground,
  onResize,
  ...live
}: Live & {
  doc: PhotoDoc;
  layer: Layer | null;
  editMask: boolean;
  onBackground: (c: string | null) => void;
  onResize: () => void;
}) {
  if (!layer) {
    return (
      <Panel title="속성">
        <p className="panel-note">
          문서 {doc.width} × {doc.height}px · 레이어 {doc.layers.length}개
        </p>
        <div className="prop-row">
          <span>배경</span>
          <Color value={doc.background ?? "#ffffff"} onChange={onBackground} />
          <button className="mini" aria-pressed={!doc.background} onClick={() => onBackground(doc.background ? null : "#ffffff")}>
            투명
          </button>
          <button className="mini" onClick={onResize}>
            크기 바꾸기…
          </button>
        </div>
      </Panel>
    );
  }
  const title =
    layer.kind === "adjust" ? `속성 · ${ADJUSTMENTS.find((a) => a.kind === layer.adjustKind)!.label}` : layer.kind === "text" ? "속성 · 글자" : layer.kind === "shape" ? "속성 · 도형" : "속성 · 픽셀 레이어";
  return (
    <Panel title={title}>
      {editMask && layer.mask && <p className="panel-note mask-note">◐ 마스크를 칠하는 중이에요. 검정은 숨기고 흰색은 보여요. (X: 색 바꾸기)</p>}
      {layer.kind === "adjust" && <AdjustProps layer={layer} {...live} />}
      {layer.kind === "text" && <TextProps layer={layer} {...live} />}
      {layer.kind === "shape" && <ShapeProps layer={layer} {...live} />}
      {layer.kind === "raster" && <QuickAdjustProps layer={layer} {...live} />}
      {layer.kind !== "adjust" && <TransformProps doc={doc} layer={layer} {...live} />}
      {layer.kind !== "adjust" && <EffectsProps layer={layer} {...live} />}
    </Panel>
  );
}

function TransformProps({ doc, layer, onPreview, onCommit, onChange }: Live & { doc: PhotoDoc; layer: Exclude<Layer, AdjustLayer> }) {
  return (
    <Section title="변형">
      <Slider label="X" value={Math.round(layer.x)} min={-doc.width} max={doc.width * 2} onPreview={(v) => onPreview({ ...layer, x: v })} onCommit={onCommit} unit="px" />
      <Slider label="Y" value={Math.round(layer.y)} min={-doc.height} max={doc.height * 2} onPreview={(v) => onPreview({ ...layer, y: v })} onCommit={onCommit} unit="px" />
      <Slider label="크기" value={Math.round(layer.scale * 1000) / 10} min={1} max={400} step={0.5} unit="%" onPreview={(v) => onPreview({ ...layer, scale: v / 100 })} onCommit={onCommit} />
      <Slider label="회전" value={layer.rotation} min={-180} max={180} step={0.5} unit="°" onPreview={(v) => onPreview({ ...layer, rotation: v })} onCommit={onCommit} />
      <div className="prop-buttons">
        <button className="mini" onClick={() => onChange({ ...layer, x: doc.width / 2, y: doc.height / 2 })}>
          가운데로
        </button>
        <button className="mini" onClick={() => onChange({ ...layer, flipX: !layer.flipX })}>
          ⇋ 좌우 뒤집기
        </button>
        <button className="mini" onClick={() => onChange({ ...layer, flipY: !layer.flipY })}>
          ⇵ 상하 뒤집기
        </button>
        <button className="mini" onClick={() => onChange({ ...layer, rotation: 0, scale: 1, flipX: false, flipY: false })}>
          변형 초기화
        </button>
      </div>
    </Section>
  );
}

function EffectsProps({ layer, onPreview, onCommit, onChange }: Live & { layer: Exclude<Layer, AdjustLayer> }) {
  const fx = layer.effects ?? NO_EFFECTS;
  const set = <K extends keyof Effects>(key: K, patch: Partial<Effects[K]>, commit = false) =>
    (commit ? onChange : onPreview)({ ...layer, effects: { ...fx, [key]: { ...fx[key], ...patch } } });
  return (
    <Section title="레이어 스타일 (fx)">
      <div className="fx-toggle">
        <label>
          <input type="checkbox" checked={fx.shadow.on} onChange={(e) => set("shadow", { on: e.target.checked }, true)} /> 그림자
        </label>
        <Color value={fx.shadow.color} onChange={(c) => set("shadow", { color: c }, true)} />
      </div>
      {fx.shadow.on && (
        <>
          <Slider label="불투명도" value={Math.round(fx.shadow.opacity * 100)} min={0} max={100} unit="%" onPreview={(v) => set("shadow", { opacity: v / 100 })} onCommit={onCommit} />
          <Slider label="각도" value={fx.shadow.angle} min={-180} max={180} unit="°" onPreview={(v) => set("shadow", { angle: v })} onCommit={onCommit} />
          <Slider label="거리" value={fx.shadow.distance} min={0} max={200} unit="px" onPreview={(v) => set("shadow", { distance: v })} onCommit={onCommit} />
          <Slider label="크기" value={fx.shadow.size} min={0} max={150} unit="px" onPreview={(v) => set("shadow", { size: v })} onCommit={onCommit} />
        </>
      )}
      <div className="fx-toggle">
        <label>
          <input type="checkbox" checked={fx.glow.on} onChange={(e) => set("glow", { on: e.target.checked }, true)} /> 외부 광선
        </label>
        <Color value={fx.glow.color} onChange={(c) => set("glow", { color: c }, true)} />
      </div>
      {fx.glow.on && (
        <>
          <Slider label="불투명도" value={Math.round(fx.glow.opacity * 100)} min={0} max={100} unit="%" onPreview={(v) => set("glow", { opacity: v / 100 })} onCommit={onCommit} />
          <Slider label="크기" value={fx.glow.size} min={1} max={150} unit="px" onPreview={(v) => set("glow", { size: v })} onCommit={onCommit} />
        </>
      )}
      <div className="fx-toggle">
        <label>
          <input type="checkbox" checked={fx.stroke.on} onChange={(e) => set("stroke", { on: e.target.checked }, true)} /> 획 (테두리)
        </label>
        <Color value={fx.stroke.color} onChange={(c) => set("stroke", { color: c }, true)} />
      </div>
      {fx.stroke.on && <Slider label="두께" value={fx.stroke.size} min={1} max={60} unit="px" onPreview={(v) => set("stroke", { size: v })} onCommit={onCommit} />}
    </Section>
  );
}

function QuickAdjustProps({ layer, onPreview, onCommit, onChange }: Live & { layer: RasterLayer }) {
  const a = layer.adjust;
  const set = (patch: Partial<QuickAdjust>) => onPreview({ ...layer, adjust: { ...a, ...patch } });
  return (
    <Section title="빠른 보정">
      <div className="presets">
        {QUICK_PRESETS.map((p) => (
          <button key={p.label} className="mini" onClick={() => onChange({ ...layer, adjust: { ...NO_ADJUST, ...p.adjust } })}>
            {p.label}
          </button>
        ))}
      </div>
      <Slider label="밝기" value={a.brightness} min={30} max={200} unit="%" onPreview={(v) => set({ brightness: v })} onCommit={onCommit} />
      <Slider label="대비" value={a.contrast} min={30} max={200} unit="%" onPreview={(v) => set({ contrast: v })} onCommit={onCommit} />
      <Slider label="채도" value={a.saturation} min={0} max={250} unit="%" onPreview={(v) => set({ saturation: v })} onCommit={onCommit} />
      <Slider label="따뜻함" value={a.warmth} min={-100} max={100} onPreview={(v) => set({ warmth: v })} onCommit={onCommit} />
      <Slider label="흐림" value={a.blur} min={0} max={20} step={0.5} unit="px" onPreview={(v) => set({ blur: v })} onCommit={onCommit} />
      <p className="panel-note">더 정밀한 보정은 레이어 칸의 ◑ 버튼으로 보정 레이어(레벨, 곡선 …)를 더해요.</p>
    </Section>
  );
}

function TextProps({ layer: t, onPreview, onCommit, onChange }: Live & { layer: TextLayer }) {
  return (
    <Section title="글자">
      <textarea className="prop-text" value={t.text} rows={2} onChange={(e) => onPreview({ ...t, text: e.target.value })} onBlur={onCommit} />
      <div className="prop-row">
        <select value={t.font} onChange={(e) => onChange({ ...t, font: e.target.value })}>
          {FONTS.map((f) => (
            <option key={f} value={f} style={{ fontFamily: f }}>
              {f === "Pretendard Variable" ? "프리텐다드" : f === "Malgun Gothic" ? "맑은 고딕" : f === "Gulim" ? "굴림" : f === "Batang" ? "바탕" : f}
            </option>
          ))}
        </select>
        <Color value={t.color} title="글자색" onChange={(c) => onChange({ ...t, color: c })} />
      </div>
      <Slider label="크기" value={t.size} min={6} max={600} unit="px" onPreview={(v) => onPreview({ ...t, size: v })} onCommit={onCommit} />
      <div className="prop-row">
        <span>테두리</span>
        <Color value={t.strokeColor} onChange={(c) => onChange({ ...t, strokeColor: c })} />
      </div>
      <Slider label="두께" value={t.strokeWidth} min={0} max={60} unit="px" onPreview={(v) => onPreview({ ...t, strokeWidth: v })} onCommit={onCommit} />
      <div className="prop-buttons">
        <button className="mini" aria-pressed={t.bold} onClick={() => onChange({ ...t, bold: !t.bold })}>
          <b>굵게</b>
        </button>
        <button className="mini" aria-pressed={t.shadow} onClick={() => onChange({ ...t, shadow: !t.shadow })}>
          그림자
        </button>
        {(["left", "center", "right"] as const).map((a) => (
          <button key={a} className="mini" aria-pressed={t.align === a} onClick={() => onChange({ ...t, align: a })}>
            {a === "left" ? "⫷" : a === "center" ? "≡" : "⫸"}
          </button>
        ))}
      </div>
    </Section>
  );
}

function ShapeProps({ layer: s, onPreview, onCommit, onChange }: Live & { layer: ShapeLayer }) {
  return (
    <Section title="도형">
      <div className="prop-buttons">
        {(["rect", "round", "ellipse"] as const).map((k) => (
          <button key={k} className="mini" aria-pressed={s.shape === k} onClick={() => onChange({ ...s, shape: k, radius: k === "round" && !s.radius ? Math.round(Math.min(s.width, s.height) * 0.15) : s.radius })}>
            {k === "rect" ? "▭ 사각형" : k === "round" ? "▢ 둥근 사각형" : "◯ 타원"}
          </button>
        ))}
      </div>
      <Slider label="가로" value={Math.round(s.width)} min={1} max={4000} unit="px" onPreview={(v) => onPreview({ ...s, width: v })} onCommit={onCommit} />
      <Slider label="세로" value={Math.round(s.height)} min={1} max={4000} unit="px" onPreview={(v) => onPreview({ ...s, height: v })} onCommit={onCommit} />
      {s.shape === "round" && <Slider label="둥글기" value={s.radius} min={0} max={500} unit="px" onPreview={(v) => onPreview({ ...s, radius: v })} onCommit={onCommit} />}
      <div className="prop-row">
        <label>
          <input type="checkbox" checked={!!s.fill} onChange={(e) => onChange({ ...s, fill: e.target.checked ? "#ffc83d" : null })} /> 칠
        </label>
        {s.fill && <Color value={s.fill} onChange={(c) => onChange({ ...s, fill: c })} />}
        <label>
          <input type="checkbox" checked={!!s.stroke} onChange={(e) => onChange({ ...s, stroke: e.target.checked ? "#000000" : null, strokeWidth: s.strokeWidth || 6 })} /> 선
        </label>
        {s.stroke && <Color value={s.stroke} onChange={(c) => onChange({ ...s, stroke: c })} />}
      </div>
      {s.stroke && <Slider label="선 두께" value={s.strokeWidth} min={1} max={100} unit="px" onPreview={(v) => onPreview({ ...s, strokeWidth: v })} onCommit={onCommit} />}
    </Section>
  );
}

/* ───────── 보정 레이어 ───────── */

function AdjustProps({ layer, onPreview, onCommit, onChange }: Live & { layer: AdjustLayer }) {
  const set = <K extends AdjustKind>(patch: Partial<AdjustSettings[K]>, commit = false) =>
    (commit ? onChange : onPreview)({ ...layer, settings: { ...(layer.settings as object), ...patch } } as unknown as AdjustLayer);
  const s = layer.settings as never as Record<string, number & string & boolean>;
  const slider = (key: string, label: string, min: number, max: number, step = 1, unit = "") => (
    <Slider key={key} label={label} value={s[key]} min={min} max={max} step={step} unit={unit} onPreview={(v) => set({ [key]: v })} onCommit={onCommit} />
  );
  const reset = (
    <button className="mini" onClick={() => onChange({ ...layer, settings: structuredClone((DEFAULTS as unknown as Record<string, unknown>)[layer.adjustKind]) } as AdjustLayer)}>
      초기화
    </button>
  );
  let body: ReactNode = null;
  switch (layer.adjustKind) {
    case "levels":
      body = (
        <>
          <Histogram />
          {slider("inBlack", "입력 검정", 0, 253)}
          {slider("gamma", "중간톤", 0.1, 4, 0.01)}
          {slider("inWhite", "입력 흰색", 2, 255)}
          {slider("outBlack", "출력 검정", 0, 255)}
          {slider("outWhite", "출력 흰색", 0, 255)}
          <div className="prop-buttons">
            <button className="mini" onClick={() => set({ inBlack: 12, inWhite: 240, gamma: 1.05 }, true)}>
              자동 대비
            </button>
            <button className="mini" onClick={() => set({ gamma: 1.4 }, true)}>
              어두운 곳 밝게
            </button>
            {reset}
          </div>
        </>
      );
      break;
    case "curves":
      body = (
        <>
          <CurveEditor points={(layer.settings as AdjustSettings["curves"]).points} onPreview={(points) => set({ points })} onCommit={onCommit} />
          <div className="prop-buttons">
            {CURVE_PRESETS.map((p) => (
              <button key={p.label} className="mini" onClick={() => set({ points: p.points }, true)}>
                {p.label}
              </button>
            ))}
          </div>
          <p className="panel-note">점을 끌어 옮기고, 빈 곳을 눌러 점을 더해요. 점을 밖으로 끌거나 더블클릭하면 지워져요.</p>
        </>
      );
      break;
    case "hueSat":
      body = (
        <>
          {slider("hue", "색조", -180, 180, 1, "°")}
          {slider("saturation", "채도", -100, 100)}
          {slider("lightness", "밝기", -100, 100)}
          <label className="prop-check">
            <input type="checkbox" checked={!!s.colorize} onChange={(e) => set({ colorize: e.target.checked }, true)} /> 색상화 (한 가지 색으로)
          </label>
          <div className="prop-buttons">{reset}</div>
        </>
      );
      break;
    case "brightness":
      body = (
        <>
          {slider("brightness", "밝기", -150, 150)}
          {slider("contrast", "대비", -50, 100)}
          <div className="prop-buttons">{reset}</div>
        </>
      );
      break;
    case "colorBalance":
      body = (
        <>
          {slider("cyanRed", "녹청 ↔ 빨강", -100, 100)}
          {slider("magentaGreen", "마젠타 ↔ 초록", -100, 100)}
          {slider("yellowBlue", "노랑 ↔ 파랑", -100, 100)}
          <div className="prop-buttons">{reset}</div>
        </>
      );
      break;
    case "vibrance":
      body = (
        <>
          {slider("vibrance", "활기", -100, 100)}
          {slider("saturation", "채도", -100, 100)}
          <div className="prop-buttons">{reset}</div>
        </>
      );
      break;
    case "bw": {
      const tint = (layer.settings as AdjustSettings["bw"]).tint;
      body = (
        <div className="prop-row">
          <label>
            <input type="checkbox" checked={!!tint} onChange={(e) => set({ tint: e.target.checked ? "#c8a070" : null }, true)} /> 색조 입히기
          </label>
          {tint && <Color value={tint} onChange={(c) => set({ tint: c }, true)} />}
        </div>
      );
      break;
    }
    case "threshold":
      body = slider("level", "한계값", 1, 255);
      break;
    case "posterize":
      body = slider("levels", "단계", 2, 32);
      break;
    case "gradientMap": {
      const g = layer.settings as AdjustSettings["gradientMap"];
      body = (
        <>
          <div className="gradient-bar" style={{ background: `linear-gradient(90deg, ${g.from}, ${g.to})` }} />
          <div className="prop-row">
            <span>어두운 곳</span>
            <Color value={g.from} onChange={(c) => set({ from: c }, true)} />
            <span>밝은 곳</span>
            <Color value={g.to} onChange={(c) => set({ to: c }, true)} />
          </div>
          <div className="prop-buttons">
            {GRADIENT_MAPS.map((m) => (
              <button key={m.label} className="mini" style={{ background: `linear-gradient(90deg, ${m.from}, ${m.to})`, color: "#fff", textShadow: "0 1px 2px #000" }} onClick={() => set({ from: m.from, to: m.to }, true)}>
                {m.label}
              </button>
            ))}
          </div>
        </>
      );
      break;
    }
    case "invert":
      body = <p className="panel-note">아래 레이어들의 색을 모두 뒤집어요. 마스크를 칠하면 일부만 뒤집을 수 있어요.</p>;
      break;
  }
  return (
    <>
      {body}
      <Slider label="불투명도" value={Math.round(layer.opacity * 100)} min={0} max={100} unit="%" onPreview={(v) => onPreview({ ...layer, opacity: v / 100 })} onCommit={onCommit} />
      <p className="panel-note">보정 레이어는 아래에 있는 모든 레이어에 걸려요. 원본은 그대로라 언제든 고칠 수 있어요.</p>
    </>
  );
}

const CURVE_PRESETS = [
  { label: "직선", points: [{ x: 0, y: 0 }, { x: 255, y: 255 }] },
  { label: "S자 (대비↑)", points: [{ x: 0, y: 0 }, { x: 64, y: 48 }, { x: 192, y: 210 }, { x: 255, y: 255 }] },
  { label: "밝게", points: [{ x: 0, y: 0 }, { x: 120, y: 160 }, { x: 255, y: 255 }] },
  { label: "어둡게", points: [{ x: 0, y: 0 }, { x: 140, y: 100 }, { x: 255, y: 255 }] },
  { label: "필름 페이드", points: [{ x: 0, y: 30 }, { x: 128, y: 128 }, { x: 255, y: 235 }] },
];

const GRADIENT_MAPS = [
  { label: "노을", from: "#2b0f45", to: "#ffb35c" },
  { label: "바다", from: "#041b33", to: "#7ff0ff" },
  { label: "세피아", from: "#2a1a0c", to: "#f3dcb0" },
  { label: "네온", from: "#1a0033", to: "#00ffd0" },
];

function CurveEditor({ points, onPreview, onCommit }: { points: { x: number; y: number }[]; onPreview: (p: { x: number; y: number }[]) => void; onCommit: () => void }) {
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const size = 220;
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const t = curveLut(sorted);
  const path = Array.from({ length: 64 }, (_, i) => {
    const x = (i / 63) * 255;
    return `${i ? "L" : "M"}${(x / 255) * size},${size - (t[Math.round(x)] / 255) * size}`;
  }).join(" ");
  const at = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: Math.round(((e.clientX - r.left) / r.width) * 255), y: Math.round((1 - (e.clientY - r.top) / r.height) * 255) };
  };
  return (
    <svg
      ref={ref}
      className="curve"
      viewBox={`0 0 ${size} ${size}`}
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture?.(e.pointerId);
        const p = at(e);
        const near = sorted.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) < 14);
        if (near >= 0) drag.current = near;
        else {
          const next = [...sorted, p].sort((a, b) => a.x - b.x);
          drag.current = next.indexOf(p);
          onPreview(next);
        }
      }}
      onPointerMove={(e) => {
        if (drag.current === null) return;
        const p = at(e);
        const i = drag.current;
        const out = p.y < -30 || p.y > 285 || p.x < -30 || p.x > 285;
        const next = sorted.map((q) => ({ ...q }));
        if (out && i > 0 && i < next.length - 1) {
          next.splice(i, 1);
          drag.current = null;
          return onPreview(next);
        }
        const lo = i > 0 ? next[i - 1].x + 1 : 0;
        const hi = i < next.length - 1 ? next[i + 1].x - 1 : 255;
        next[i] = { x: Math.max(lo, Math.min(hi, p.x)), y: Math.max(0, Math.min(255, p.y)) };
        onPreview(next);
      }}
      onPointerUp={() => {
        drag.current = null;
        onCommit();
      }}
      onDoubleClick={(e) => {
        const p = at(e);
        const i = sorted.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) < 14);
        if (i > 0 && i < sorted.length - 1) {
          onPreview(sorted.filter((_, j) => j !== i));
          onCommit();
        }
      }}
    >
      {[1, 2, 3].map((k) => (
        <g key={k} className="curve-grid">
          <line x1={(k * size) / 4} y1={0} x2={(k * size) / 4} y2={size} />
          <line x1={0} y1={(k * size) / 4} x2={size} y2={(k * size) / 4} />
        </g>
      ))}
      <line className="curve-base" x1={0} y1={size} x2={size} y2={0} />
      <path className="curve-line" d={path} />
      {sorted.map((p, i) => (
        <circle key={i} className="curve-point" cx={(p.x / 255) * size} cy={size - (p.y / 255) * size} r={5} />
      ))}
    </svg>
  );
}

/* ───────── 히스토그램 ───────── */

let histDoc: PhotoDoc | null = null;
const histListeners = new Set<() => void>();
export function setHistogramDoc(doc: PhotoDoc) {
  histDoc = doc;
  histListeners.forEach((f) => f());
}

export function Histogram() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let timer = 0;
    const update = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        const c = ref.current;
        if (!c || !histDoc) return;
        const scale = Math.min(1, 400 / Math.max(histDoc.width, histDoc.height));
        const img = flatten(histDoc, scale);
        const h = histogram(ctx2d(img).getImageData(0, 0, img.width, img.height));
        const g = ctx2d(c);
        g.clearRect(0, 0, c.width, c.height);
        const max = Math.max(1, ...Array.from(h.lum).slice(2, 254));
        g.globalCompositeOperation = "screen";
        const drawChannel = (arr: Uint32Array, color: string) => {
          g.fillStyle = color;
          g.beginPath();
          g.moveTo(0, c.height);
          for (let i = 0; i < 256; i++) g.lineTo((i / 255) * c.width, c.height - Math.min(1, arr[i] / max) * c.height);
          g.lineTo(c.width, c.height);
          g.fill();
        };
        drawChannel(h.r, "rgba(255,70,70,0.55)");
        drawChannel(h.g, "rgba(70,255,110,0.55)");
        drawChannel(h.b, "rgba(80,140,255,0.55)");
        g.globalCompositeOperation = "source-over";
        g.strokeStyle = "rgba(255,255,255,0.7)";
        g.beginPath();
        for (let i = 0; i < 256; i++) g.lineTo((i / 255) * c.width, c.height - Math.min(1, h.lum[i] / max) * c.height);
        g.stroke();
      }, 150);
    };
    histListeners.add(update);
    update();
    return () => {
      histListeners.delete(update);
      clearTimeout(timer);
    };
  }, []);
  return <canvas ref={ref} className="histogram" width={256} height={90} />;
}

/* ───────── 레이어 ───────── */

function LayerThumb({ layer, doc, mask }: { layer: Layer; doc: PhotoDoc; mask?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = ctx2d(c);
    g.clearRect(0, 0, c.width, c.height);
    const src = mask ? (layer.mask ? pixels(layer.mask.src, () => setTick((n) => n + 1)) : null) : layerContent(layer, doc, { onLoad: () => setTick((n) => n + 1) });
    if (mask) {
      g.fillStyle = "#000";
      g.fillRect(0, 0, c.width, c.height);
    }
    if (!src) return;
    const s = Math.min(c.width / src.width, c.height / src.height);
    if (mask) {
      const tmp = createCanvas(src.width, src.height);
      const tg = ctx2d(tmp);
      tg.drawImage(src, 0, 0);
      tg.globalCompositeOperation = "source-in";
      tg.fillStyle = "#fff";
      tg.fillRect(0, 0, tmp.width, tmp.height);
      g.drawImage(tmp, (c.width - src.width * s) / 2, (c.height - src.height * s) / 2, src.width * s, src.height * s);
    } else g.drawImage(src, (c.width - src.width * s) / 2, (c.height - src.height * s) / 2, src.width * s, src.height * s);
  }, [layer, doc.width, doc.height, mask, tick]);
  return <canvas ref={ref} width={44} height={30} className={mask ? "thumb mask" : "thumb"} />;
}

export function LayersPanel({
  doc,
  selectedId,
  editMask,
  onSelect,
  onUpdate,
  onPreviewLayer,
  onCommit,
  onReorder,
  onNewLayer,
  onAdjust,
  onMask,
  onDuplicate,
  onDelete,
  onSelectPixels,
}: {
  doc: PhotoDoc;
  selectedId: number | null;
  editMask: boolean;
  onSelect: (id: number, mask: boolean) => void;
  onUpdate: (layer: Layer) => void;
  onPreviewLayer: (layer: Layer) => void;
  onCommit: () => void;
  onReorder: (id: number, toIndex: number) => void;
  onNewLayer: () => void;
  onAdjust: (kind: AdjustKind) => void;
  onMask: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onSelectPixels: (id: number) => void;
}) {
  const sel = doc.layers.find((l) => l.id === selectedId) ?? null;
  const [adjOpen, setAdjOpen] = useState(false);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const rows = [...doc.layers].reverse();
  return (
    <Panel title="레이어">
      <div className="layer-top">
        <select value={sel?.blend ?? "source-over"} disabled={!sel || sel.kind === "adjust"} title="혼합 모드" onChange={(e) => sel && onUpdate({ ...sel, blend: e.target.value as Layer["blend"] })}>
          {BLEND_MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <label className="layer-opacity" title="불투명도">
          <span>불투명도</span>
          <input
            type="range"
            min={0}
            max={100}
            disabled={!sel}
            value={Math.round((sel?.opacity ?? 1) * 100)}
            onChange={(e) => sel && onPreviewLayer({ ...sel, opacity: Number(e.target.value) / 100 })}
            onPointerUp={onCommit}
          />
          <b>{Math.round((sel?.opacity ?? 1) * 100)}%</b>
        </label>
        <button className={`layer-lock${sel?.locked ? " on" : ""}`} disabled={!sel} title="잠그기" onClick={() => sel && onUpdate({ ...sel, locked: !sel.locked })}>
          🔒
        </button>
      </div>
      {doc.layers.length === 0 ? (
        <p className="panel-note">비어 있어요. 사진을 끌어다 놓거나 ＋ 로 새 레이어를 만들어요.</p>
      ) : (
        <ul className="layers" onDragOver={(e) => e.preventDefault()}>
          {rows.map((l, rowIndex) => {
            const index = doc.layers.length - 1 - rowIndex;
            const fx = l.kind !== "adjust" && (l.effects.shadow.on || l.effects.glow.on || l.effects.stroke.on);
            return (
              <li
                key={l.id}
                aria-current={l.id === selectedId}
                className={`${dropAt === index ? "drop" : ""}${l.visible ? "" : " hidden"}${l.clip && index > 0 ? " clipped" : ""}`}
                draggable={renaming !== l.id}
                onDragStart={(e) => {
                  setDragId(l.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDropAt(index);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setDropAt(null);
                }}
                onDrop={() => {
                  if (dragId !== null) onReorder(dragId, index);
                  setDragId(null);
                  setDropAt(null);
                }}
              >
                <button className="layer-eye" aria-pressed={l.visible} title={l.visible ? "숨기기" : "보이기"} onClick={() => onUpdate({ ...l, visible: !l.visible })}>
                  {l.visible ? "👁" : ""}
                </button>
                {l.clip && index > 0 && (
                  <span className="layer-clip" title="클리핑 마스크: 아래 레이어 모양 안에만 보여요">
                    ↳
                  </span>
                )}
                {l.kind === "adjust" ? (
                  <span className="thumb adj" onClick={() => onSelect(l.id, false)}>
                    {ADJUSTMENTS.find((a) => a.kind === l.adjustKind)!.icon}
                  </span>
                ) : (
                  <span
                    className={`thumb-wrap${l.id === selectedId && !editMask ? " target" : ""}`}
                    title="Ctrl+클릭: 이 레이어 모양대로 선택"
                    onClick={(e) => (e.ctrlKey ? onSelectPixels(l.id) : onSelect(l.id, false))}
                  >
                    <LayerThumb layer={l} doc={doc} />
                  </span>
                )}
                {l.mask && (
                  <span
                    className={`thumb-wrap${l.id === selectedId && (editMask || l.kind === "adjust") ? " target" : ""}${l.mask.enabled ? "" : " off"}`}
                    title="마스크: 누르면 마스크를 칠해요 · Shift+클릭: 잠시 끄기"
                    onClick={(e) => (e.shiftKey ? onUpdate({ ...l, mask: { ...l.mask!, enabled: !l.mask!.enabled } }) : onSelect(l.id, true))}
                  >
                    <LayerThumb layer={l} doc={doc} mask />
                  </span>
                )}
                {renaming === l.id ? (
                  <input
                    className="layer-rename"
                    autoFocus
                    defaultValue={l.name}
                    onBlur={(e) => {
                      setRenaming(null);
                      if (e.target.value.trim() && e.target.value !== l.name) onUpdate({ ...l, name: e.target.value.trim() });
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") setRenaming(null);
                    }}
                  />
                ) : (
                  <button className="layer-name" onClick={() => onSelect(l.id, false)} onDoubleClick={() => setRenaming(l.id)} title="더블클릭: 이름 바꾸기">
                    {l.kind === "text" ? <span className="layer-kind">T</span> : l.kind === "shape" ? <span className="layer-kind">◆</span> : null}
                    {l.kind === "text" ? l.text.split("\n")[0] || "(빈 글자)" : l.name}
                  </button>
                )}
                {fx && <span className="layer-fx">fx</span>}
                {l.blend !== "source-over" && <span className="layer-fx" title="혼합 모드">{BLEND_MODES.find((m) => m.id === l.blend)?.label.slice(0, 2)}</span>}
                {l.locked && <span className="layer-fx">🔒</span>}
              </li>
            );
          })}
        </ul>
      )}
      <div className="layer-actions">
        <button title="새 레이어 (Ctrl+Shift+N)" onClick={onNewLayer}>
          ＋
        </button>
        <div className="adj-menu-wrap">
          <button title="보정 레이어" onClick={() => setAdjOpen(!adjOpen)}>
            ◑
          </button>
          {adjOpen && (
            <div className="adj-menu" onMouseLeave={() => setAdjOpen(false)}>
              {ADJUSTMENTS.map((a) => (
                <button
                  key={a.kind}
                  onClick={() => {
                    setAdjOpen(false);
                    onAdjust(a.kind);
                  }}
                >
                  <span>{a.icon}</span> {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button title="마스크 더하기 (선택 영역이 있으면 그 부분만 보이게)" disabled={!sel || !!sel.mask || sel.kind === "text" || sel.kind === "shape"} onClick={onMask}>
          ◐
        </button>
        <button title="복제 (Ctrl+J)" disabled={!sel} onClick={onDuplicate}>
          ⧉
        </button>
        <button title="지우기" disabled={!sel} onClick={onDelete}>
          🗑
        </button>
      </div>
    </Panel>
  );
}
