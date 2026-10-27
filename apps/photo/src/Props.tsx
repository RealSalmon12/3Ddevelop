import { Panel } from "@suite/ui";
import { FILTER_PRESETS, NO_ADJUST, type Adjust, type ImageLayer, type Layer, type PhotoDoc, type TextLayer } from "./doc";

interface Props {
  doc: PhotoDoc;
  layer: Layer | null;
  /** 막대를 끄는 동안 (기록 없이) */
  onPreview: (layer: Layer) => void;
  onCommit: () => void;
  onChange: (layer: Layer) => void;
  onBackground: (color: string | null) => void;
}

function Slider({
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
      />
      <b>
        {Math.round(value * 10) / 10}
        {unit}
      </b>
    </label>
  );
}

/** 고른 레이어의 속성. 아무것도 안 골랐으면 그림 전체(배경) 속성 */
export function PropsPanel({ doc, layer, onPreview, onCommit, onChange, onBackground }: Props) {
  if (!layer) {
    return (
      <Panel title="그림">
        <p className="panel-note">
          {doc.width} × {doc.height}px. 사진이나 글자를 클릭하면 여기서 고칠 수 있어요.
        </p>
        <div className="prop-row">
          <span>배경</span>
          <input type="color" value={doc.background ?? "#ffffff"} onChange={(e) => onBackground(e.target.value)} />
          <button className="mini" aria-pressed={!doc.background} onClick={() => onBackground(doc.background ? null : "#ffffff")}>
            투명
          </button>
        </div>
      </Panel>
    );
  }

  const common = (
    <>
      <Slider label="크기" value={Math.round(layer.scale * 100)} min={2} max={400} unit="%" onPreview={(v) => onPreview({ ...layer, scale: v / 100 })} onCommit={onCommit} />
      <Slider label="회전" value={layer.rotation} min={-180} max={180} unit="°" onPreview={(v) => onPreview({ ...layer, rotation: v })} onCommit={onCommit} />
      <Slider label="투명도" value={Math.round(layer.opacity * 100)} min={0} max={100} unit="%" onPreview={(v) => onPreview({ ...layer, opacity: v / 100 })} onCommit={onCommit} />
      <div className="prop-buttons">
        <button className="mini" onClick={() => onChange({ ...layer, x: doc.width / 2, y: doc.height / 2 })}>
          가운데로
        </button>
        <button className="mini" onClick={() => onChange({ ...layer, rotation: 0 })}>
          회전 없애기
        </button>
      </div>
    </>
  );

  if (layer.kind === "text") {
    const t = layer as TextLayer;
    return (
      <Panel title="글자">
        <textarea
          className="prop-text"
          value={t.text}
          rows={2}
          onChange={(e) => onPreview({ ...t, text: e.target.value })}
          onBlur={onCommit}
        />
        <div className="prop-row">
          <span>글자색</span>
          <input type="color" value={t.color} onChange={(e) => onChange({ ...t, color: e.target.value })} />
          <span>테두리</span>
          <input type="color" value={t.strokeColor} onChange={(e) => onChange({ ...t, strokeColor: e.target.value })} />
        </div>
        <Slider label="글자 크기" value={t.size} min={8} max={400} unit="px" onPreview={(v) => onPreview({ ...t, size: v })} onCommit={onCommit} />
        <Slider label="테두리 굵기" value={t.strokeWidth} min={0} max={40} unit="px" onPreview={(v) => onPreview({ ...t, strokeWidth: v })} onCommit={onCommit} />
        <div className="prop-buttons">
          <button className="mini" aria-pressed={t.bold} onClick={() => onChange({ ...t, bold: !t.bold })}>
            굵게
          </button>
          <button className="mini" aria-pressed={t.shadow} onClick={() => onChange({ ...t, shadow: !t.shadow })}>
            그림자
          </button>
        </div>
        {common}
      </Panel>
    );
  }

  const img = layer as ImageLayer;
  const setAdjust = (patch: Partial<Adjust>, commit = false) =>
    (commit ? onChange : onPreview)({ ...img, adjust: { ...img.adjust, ...patch } });
  return (
    <Panel title="사진 보정">
      <div className="presets">
        {FILTER_PRESETS.map((p) => (
          <button key={p.label} className="mini" onClick={() => onChange({ ...img, adjust: { ...NO_ADJUST, ...p.adjust } })}>
            {p.label}
          </button>
        ))}
      </div>
      <Slider label="밝기" value={img.adjust.brightness} min={30} max={200} unit="%" onPreview={(v) => setAdjust({ brightness: v })} onCommit={onCommit} />
      <Slider label="대비" value={img.adjust.contrast} min={30} max={200} unit="%" onPreview={(v) => setAdjust({ contrast: v })} onCommit={onCommit} />
      <Slider label="채도" value={img.adjust.saturation} min={0} max={250} unit="%" onPreview={(v) => setAdjust({ saturation: v })} onCommit={onCommit} />
      <Slider label="따뜻함" value={img.adjust.warmth} min={-100} max={100} onPreview={(v) => setAdjust({ warmth: v })} onCommit={onCommit} />
      <Slider label="흐림" value={img.adjust.blur} min={0} max={20} step={0.5} unit="px" onPreview={(v) => setAdjust({ blur: v })} onCommit={onCommit} />
      <div className="prop-buttons">
        <button className="mini" aria-pressed={img.adjust.grayscale} onClick={() => setAdjust({ grayscale: !img.adjust.grayscale }, true)}>
          흑백
        </button>
      </div>
      {common}
    </Panel>
  );
}

export function LayersPanel({
  doc,
  selectedId,
  onSelect,
  onToggle,
  onMove,
  onDelete,
  onDuplicate,
}: {
  doc: PhotoDoc;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onToggle: (id: number) => void;
  onMove: (id: number, dir: 1 | -1) => void;
  onDelete: (id: number) => void;
  onDuplicate: (id: number) => void;
}) {
  const sel = selectedId;
  const index = doc.layers.findIndex((l) => l.id === sel);
  return (
    <Panel title="레이어">
      {doc.layers.length === 0 ? (
        <p className="panel-note">비어 있어요. ‘파일 → 사진 넣기’나 글자 도구(T)로 시작해 보세요.</p>
      ) : (
        <ul className="layers">
          {[...doc.layers].reverse().map((l) => (
            <li key={l.id} aria-current={l.id === sel}>
              <button className="layer-eye" aria-pressed={l.visible} title={l.visible ? "숨기기" : "보이기"} onClick={() => onToggle(l.id)}>
                {l.visible ? "👁" : "–"}
              </button>
              <button className="layer-name" onClick={() => onSelect(l.id)}>
                <span className="layer-kind">{l.kind === "text" ? "T" : "🖼"}</span>
                {l.kind === "text" ? l.text.split("\n")[0] || "(빈 글자)" : l.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="layer-actions">
        <button disabled={index < 0 || index >= doc.layers.length - 1} title="앞으로" onClick={() => onMove(sel!, 1)}>
          ▲ 앞으로
        </button>
        <button disabled={index <= 0} title="뒤로" onClick={() => onMove(sel!, -1)}>
          ▼ 뒤로
        </button>
        <button disabled={index < 0} onClick={() => onDuplicate(sel!)}>
          복제
        </button>
        <button disabled={index < 0} title="지우기 (Delete)" onClick={() => onDelete(sel!)}>
          🗑
        </button>
      </div>
    </Panel>
  );
}
