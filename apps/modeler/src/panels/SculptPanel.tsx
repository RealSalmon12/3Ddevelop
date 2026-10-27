import { Panel } from "@suite/ui";
import { SCULPT_BRUSHES, type SculptSettings } from "../mesh/sculpt";

interface Props {
  settings: SculptSettings;
  onChange: (s: SculptSettings) => void;
  /** 지금 모양의 면 개수 */
  faces: number;
  onDensify: () => void;
}

/** 조각 모드 붓 고르기 (블렌더 스컬프트 모드의 붓 목록) */
export function SculptPanel({ settings, onChange, faces, onDensify }: Props) {
  const set = (patch: Partial<SculptSettings>) => onChange({ ...settings, ...patch });
  const coarse = faces < 1500;
  return (
    <Panel title="조각 붓" className="sculpt-panel">
      <div className="sculpt-brushes">
        {SCULPT_BRUSHES.map((b) => (
          <button key={b.id} className="prop-small-button" aria-pressed={settings.brush === b.id} title={`${b.hint} (${b.key})`} onClick={() => set({ brush: b.id })}>
            <b>{b.icon}</b> {b.label}
          </button>
        ))}
      </div>
      <label className="prop-row" title="붓 크기 ([ 와 ] 키)">
        <span className="prop-label">크기</span>
        <input type="range" min={8} max={300} value={settings.radius} onChange={(e) => set({ radius: Number(e.target.value) })} />
        <span className="sculpt-value">{settings.radius}px</span>
      </label>
      <label className="prop-row" title="붓 세기 (Shift+[ 와 Shift+])">
        <span className="prop-label">세기</span>
        <input type="range" min={0.05} max={1} step={0.05} value={settings.strength} onChange={(e) => set({ strength: Number(e.target.value) })} />
        <span className="sculpt-value">{Math.round(settings.strength * 100)}%</span>
      </label>
      <label className="boolean-keep" title="왼쪽을 칠하면 오른쪽도 똑같이 (얼굴, 몸)">
        <input type="checkbox" checked={settings.symmetry} onChange={(e) => set({ symmetry: e.target.checked })} /> 좌우 대칭 (X)
      </label>
      <div className="sculpt-detail">
        <span>면 {faces.toLocaleString()}개</span>
        <button className="prop-small-button" title="모양을 매끈하게 한 번 나눠 면을 4배로. 많을수록 곱게 빚어지지만 무거워져요" onClick={onDensify}>
          ⊞ 촘촘하게
        </button>
      </div>
      <p className="panel-empty sculpt-tip">
        {coarse
          ? "면이 적으면 각지게 빚어져요. ‘촘촘하게’를 두세 번 눌러 찰흙을 곱게 만든 뒤 시작해 보세요."
          : "모양 위를 끌면 칠하고, 빈 곳을 끌면 화면이 돌아가요. Ctrl: 반대로 · Shift: 부드럽게 · Ctrl+Z: 되돌리기"}
      </p>
    </Panel>
  );
}
