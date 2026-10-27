import { Panel } from "@suite/ui";
import { DEFAULT_PALETTE } from "../doc/color";

interface Props {
  color: string;
  recent: string[];
  onChange: (hex: string) => void;
}

/** 지금 색, 직접 고르기, 기본 32색, 최근 쓴 색 */
export function ColorPanel({ color, recent, onChange }: Props) {
  return (
    <Panel title="색">
      <div className="color-current">
        <label className="color-big" style={{ background: color }} title="눌러서 아무 색이나 고르기">
          <input type="color" value={color} onChange={(e) => onChange(e.target.value)} />
        </label>
        <div>
          <div className="color-hex">{color.toUpperCase()}</div>
          <div className="color-tip">왼쪽 네모를 누르면 아무 색이나 고를 수 있어요.</div>
        </div>
      </div>
      <div className="swatches" role="group" aria-label="기본 색">
        {DEFAULT_PALETTE.map((c) => (
          <button key={c} className="swatch" style={{ background: c }} aria-pressed={c === color} title={c} onClick={() => onChange(c)} />
        ))}
      </div>
      {recent.length > 0 && (
        <>
          <div className="color-label">최근 쓴 색</div>
          <div className="swatches recent">
            {recent.map((c) => (
              <button key={c} className="swatch" style={{ background: c }} aria-pressed={c === color} title={c} onClick={() => onChange(c)} />
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}
