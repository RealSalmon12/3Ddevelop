import { SURFACES, type Surface } from "../scene/materials";
import { useEffect, useRef, useState } from "react";
import type * as THREE from "three";
import { Panel, Segmented } from "@suite/ui";
import { EFFECTS, type EffectType, type ParticleSystem } from "../effects/particles";
import type { EditState, ModelerScene, ObjectData, SmoothMode } from "../scene/ModelerScene";

interface PropertiesPanelProps {
  model: ModelerScene;
  item: ObjectData | null;
  edit: EditState | null;
}

const AXES = ["X", "Y", "Z"] as const;
const DEG = 180 / Math.PI;

/** 선택한 오브젝트의 이름, 위치, 회전, 크기, 색을 숫자로 바꾸는 패널 */
export function PropertiesPanel({ model, item, edit }: PropertiesPanelProps) {
  if (edit) {
    return (
      <Panel title="고른 점">
        {item && <SmoothRows model={model} item={item} />}
        {edit.center ? (
          <>
            <p className="panel-empty">점 {edit.selectedVertexCount}개를 골랐어요. 가운데 위치를 바꾸면 함께 움직여요.</p>
            <div className="prop-row">
              <span className="prop-label">가운데</span>
              <div className="prop-xyz">
                {AXES.map((axis, i) => (
                  <NumberField
                    key={axis}
                    axis={axis}
                    value={edit.center![i]}
                    onCommit={(n) => {
                      const next = [...edit.center!] as [number, number, number];
                      next[i] = n;
                      model.moveEditSelectionTo(next);
                    }}
                  />
                ))}
              </div>
            </div>
          </>
        ) : (
          <p className="panel-empty">아무것도 고르지 않았어요. 점, 선, 면을 클릭해 보세요.</p>
        )}
      </Panel>
    );
  }

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
      <div className="prop-swatches" role="group" aria-label="자주 쓰는 색">
        {SWATCHES.map(([color, name]) => (
          <button
            key={color}
            title={name}
            aria-label={name}
            aria-pressed={item.color === color}
            style={{ background: color }}
            onClick={() => update({ color })}
          />
        ))}
      </div>
      {item.effect ? (
        <>
          <div className="prop-row">
            <span className="prop-label">종류</span>
            <select
              className="prop-select"
              value={item.effect.type}
              onChange={(e) => update({ effect: { ...item.effect!, type: e.target.value as EffectType } })}
            >
              {EFFECTS.map((fx) => (
                <option key={fx.type} value={fx.type}>
                  {fx.label}
                </option>
              ))}
            </select>
          </div>
          <RangeField
            label="양"
            value={item.effect.amount}
            min={0.2}
            max={3}
            onPreview={(amount) => particlesOf(item.id) && (particlesOf(item.id)!.settings.amount = amount)}
            onCommit={(amount) => update({ effect: { ...item.effect!, amount } })}
          />
          <RangeField
            label="빠르기"
            value={item.effect.speed}
            min={0.2}
            max={3}
            onPreview={(speed) => particlesOf(item.id) && (particlesOf(item.id)!.settings.speed = speed)}
            onCommit={(speed) => update({ effect: { ...item.effect!, speed } })}
          />
        </>
      ) : (
        <>
        <div className="prop-row">
          <span className="prop-label">겉면</span>
          <select
            className="prop-select"
            value={item.surface ?? "plastic"}
            onChange={(e) => update({ surface: e.target.value as Surface })}
          >
            {SURFACES.map((s) => (
              <option key={s.type} value={s.type}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <SmoothRows model={model} item={item} />
        <RangeField
          label="빛나기"
          value={item.glow ?? 0}
          min={0}
          max={4}
          onPreview={(glow) => {
            const material = model.getMesh(item.id)?.material as THREE.MeshStandardMaterial | undefined;
            if (material) material.emissiveIntensity = glow * 0.6;
          }}
          onCommit={(glow) => update({ glow })}
        />
        </>
      )}
    </Panel>
  );

  function particlesOf(id: string) {
    return model.getMesh(id)?.userData.particles as ParticleSystem | undefined;
  }
}

const LEVELS = ["0", "1", "2", "3"] as const;

/**
 * 매끈하게 (서브디비전 표면) 단계와 면 이어 보이기. 원래 모양은 그대로라 언제든 끄거나 단계를 바꿀 수 있다.
 */
function SmoothRows({ model, item }: { model: ModelerScene; item: ObjectData }) {
  const level = item.subdivision ?? 0;
  return (
    <>
      <div className="prop-row">
        <span className="prop-label" title="각진 모양을 둥글게 나눠 보여 줘요. 원래 점, 선, 면은 그대로예요. (Ctrl+0~3)">
          매끈하게
        </span>
        <div className="prop-inline">
          <Segmented
            label="매끈하게 단계"
            value={String(level) as (typeof LEVELS)[number]}
            onChange={(v) => model.setSubdivision(Number(v))}
            options={LEVELS.map((v) => ({ value: v, label: v === "0" ? "끔" : v, hint: v === "0" ? "끄기 (Ctrl+0)" : `${v}단계 (Ctrl+${v})` }))}
          />
        </div>
      </div>
      <div className="prop-row">
        <span className="prop-label" title="오브젝트 가운데를 기준으로 반대쪽을 똑같이 만들어요. 한쪽만 고치면 반대쪽도 같이 바뀌어요 (블렌더의 Mirror 모디파이어). 편집 모드에서 반쪽을 지우고 쓰면 가운데가 깔끔하게 붙어요.">
          대칭
        </span>
        <div className="prop-inline">
          {(["x", "y", "z"] as const).map((a) => {
            const on = item.mirror?.includes(a) ?? false;
            return (
              <button
                key={a}
                className="prop-toggle"
                aria-pressed={on}
                title={`${a.toUpperCase()}축으로 비추기`}
                onClick={() => model.update(item.id, { mirror: on ? (item.mirror ?? []).filter((x) => x !== a) : [...(item.mirror ?? []), a] })}
              >
                {a.toUpperCase()}
              </button>
            );
          })}
        </div>
      </div>
      <div className="prop-row">
        <span className="prop-label" title="같은 모양을 줄지어 늘어놓아요. 계단, 울타리, 사슬 만들 때 좋아요 (블렌더의 Array 모디파이어).">
          배열
        </span>
        <div className="prop-inline">
          <input
            className="prop-count"
            type="number"
            min={1}
            max={64}
            value={item.array?.count ?? 1}
            title="모두 몇 개 (1 이면 끔)"
            onChange={(e) => {
              const count = Math.max(1, Math.min(64, Math.round(Number(e.target.value) || 1)));
              model.update(item.id, { array: count > 1 ? { count, offset: item.array?.offset ?? [1.1, 0, 0] } : undefined });
            }}
          />
          <span className="prop-unit">개</span>
          {item.array && (
            <select
              className="prop-select"
              title="늘어놓을 방향과 간격 (모양 크기 기준)"
              value={item.array.offset.join(",")}
              onChange={(e) => model.update(item.id, { array: { count: item.array!.count, offset: e.target.value.split(",").map(Number) as [number, number, number] } })}
            >
              <option value="1,0,0">X 방향 · 붙여서</option>
              <option value="1.1,0,0">X 방향 · 조금 띄워서</option>
              <option value="1.5,0,0">X 방향 · 넓게</option>
              <option value="0,1,0">Y 방향 (위로 쌓기)</option>
              <option value="0,0,1.1">Z 방향</option>
              <option value="1,1,0">계단 (X 와 Y)</option>
              <option value="1,0.5,0">완만한 계단</option>
            </select>
          )}
        </div>
      </div>
      {(level > 0 || !!item.mirror?.length || !!item.array) && (
        <div className="prop-row">
          <span className="prop-label" />
          <button className="prop-small-button" title="지금 보이는 모양(대칭, 배열, 매끈하게)을 진짜 점, 선, 면으로 바꿔요. 그 뒤로 하나하나 고칠 수 있어요." onClick={() => model.applySubdivision()}>
            모디파이어 적용
          </button>
        </div>
      )}
      <div className="prop-row">
        <span className="prop-label">면 잇기</span>
        <select
          className="prop-select"
          value={item.smooth ?? "auto"}
          onChange={(e) => model.update(item.id, { smooth: e.target.value as SmoothMode })}
        >
          <option value="auto">자동 (완만한 곳만 부드럽게)</option>
          <option value="smooth">모두 부드럽게</option>
          <option value="flat">모두 각지게</option>
        </select>
      </div>
    </>
  );
}

/** 한 번에 고르는 자주 쓰는 색. 로블록스 기본 색과 비슷하게 골랐다. */
const SWATCHES: [string, string][] = [
  ["#f2f3f5", "흰색"],
  ["#a3a9b3", "회색"],
  ["#2b2d33", "검정"],
  ["#c4483e", "빨강"],
  ["#f28a3b", "주황"],
  ["#f2cd4b", "노랑"],
  ["#5a9c4b", "초록"],
  ["#3f6fc7", "파랑"],
  ["#8a5cd6", "보라"],
  ["#e889b5", "분홍"],
  ["#7b5234", "나무색"],
  ["#efe2c4", "모래색"],
];

/** 끄는 동안은 미리 보기만 하고, 손을 떼면 한 번만 기록하는 슬라이더 */
function RangeField({
  label,
  value,
  min,
  max,
  onPreview,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onPreview: (n: number) => void;
  onCommit: (n: number) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [shown, setShown] = useState(value);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  useEffect(() => setShown(value), [value]);
  useEffect(() => {
    const input = ref.current!;
    const onChange = () => commitRef.current(Number(input.value));
    input.addEventListener("change", onChange);
    return () => input.removeEventListener("change", onChange);
  }, []);

  return (
    <div className="prop-row">
      <span className="prop-label">{label}</span>
      <div className="prop-range">
        <input
          ref={ref}
          type="range"
          min={min}
          max={max}
          step={0.05}
          value={shown}
          onChange={(e) => {
            const n = Number(e.target.value);
            setShown(n);
            onPreview(n);
          }}
        />
        <span>{formatNumber(shown)}</span>
      </div>
    </div>
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
