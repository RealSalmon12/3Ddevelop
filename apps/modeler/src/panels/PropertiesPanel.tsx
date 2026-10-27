import { useEffect, useRef, useState } from "react";
import type * as THREE from "three";
import { Panel } from "@suite/ui";
import type { ModelerScene, ObjectData } from "../scene/ModelerScene";

interface PropertiesPanelProps {
  model: ModelerScene;
  item: ObjectData | null;
}

const AXES = ["X", "Y", "Z"] as const;
const DEG = 180 / Math.PI;

/** 선택한 오브젝트의 이름, 위치, 회전, 크기, 색을 숫자로 바꾸는 패널 */
export function PropertiesPanel({ model, item }: PropertiesPanelProps) {
  if (!item) {
    return (
      <Panel title="속성">
        <p className="panel-empty">오브젝트를 고르면 위치, 크기, 색을 여기서 바꿀 수 있어요.</p>
      </Panel>
    );
  }

  const update = (patch: Parameters<ModelerScene["update"]>[1]) => model.update(item.id, patch);
  const vectorRow = (
    label: string,
    values: [number, number, number],
    onChange: (v: [number, number, number]) => void,
    scale = 1,
  ) => (
    <div className="prop-row">
      <span className="prop-label">{label}</span>
      <div className="prop-xyz">
        {AXES.map((axis, i) => (
          <NumberField
            key={axis}
            axis={axis}
            value={values[i] * scale}
            onCommit={(n) => {
              const next = [...values] as [number, number, number];
              next[i] = n / scale;
              onChange(next);
            }}
          />
        ))}
      </div>
    </div>
  );

  return (
    <Panel title="속성">
      <div className="prop-row">
        <span className="prop-label">이름</span>
        <TextField value={item.name} onCommit={(name) => name.trim() && update({ name: name.trim() })} />
      </div>
      {vectorRow("위치", item.position, (position) => update({ position }))}
      {vectorRow("회전 (°)", item.rotation, (rotation) => update({ rotation }), DEG)}
      {vectorRow("크기", item.scale, (scale) => update({ scale }))}
      <div className="prop-row">
        <span className="prop-label">색</span>
        <ColorField
          value={item.color}
          onPreview={(color) => (model.getMesh(item.id)?.material as THREE.MeshStandardMaterial).color.set(color)}
          onCommit={(color) => update({ color })}
        />
      </div>
    </Panel>
  );
}

function NumberField({ axis, value, onCommit }: { axis: string; value: number; onCommit: (n: number) => void }) {
  const shown = formatNumber(value);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);

  const commit = () => {
    const n = Number(text);
    if (Number.isFinite(n) && formatNumber(n) !== shown) onCommit(n);
    else setText(shown);
  };

  return (
    <label className={`prop-number axis-${axis.toLowerCase()}`}>
      <span>{axis}</span>
      <input
        value={text}
        inputMode="decimal"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setText(shown);
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function TextField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      className="prop-text"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => (text !== value ? onCommit(text) : undefined)}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

/**
 * 색 고르는 창을 움직이는 동안은 미리 보기만 하고, 창을 닫아 다 고르면 한 번만 기록한다.
 * (React 의 onChange 는 움직일 때마다 불리기 때문에 브라우저의 change 이벤트를 직접 듣는다.)
 */
function ColorField({
  value,
  onPreview,
  onCommit,
}: {
  value: string;
  onPreview: (color: string) => void;
  onCommit: (color: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  useEffect(() => {
    const input = ref.current!;
    const onChange = () => commitRef.current(input.value);
    input.addEventListener("change", onChange);
    return () => input.removeEventListener("change", onChange);
  }, []);

  return (
    <input
      ref={ref}
      type="color"
      className="prop-color"
      defaultValue={value}
      key={value}
      onInput={(e) => onPreview(e.currentTarget.value)}
    />
  );
}

function formatNumber(n: number) {
  return String(Math.round(n * 1000) / 1000);
}
