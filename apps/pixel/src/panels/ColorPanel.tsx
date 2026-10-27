import { useRef } from "react";
import { Panel } from "@suite/ui";
import type { PixelDoc } from "../doc/PixelDoc";
import { PALETTES } from "../doc/palettes";
import { usedColors } from "../doc/raster";
import { colorRamp } from "../doc/ramp";

interface Props {
  doc: PixelDoc;
  palette: string[];
  color: string;
  secondary: string;
  recent: string[];
  onChange: (hex: string) => void;
  onSecondary: (hex: string) => void;
  onLoad: () => void;
  onSave: () => void;
  notify: (m: string) => void;
}

/** 전경색·배경색, 그림의 팔레트 (순서가 명암 붓의 밝기 순서), 최근 쓴 색 */
export function ColorPanel({ doc, palette, color, secondary, recent, onChange, onSecondary, onLoad, onSave, notify }: Props) {
  const dragFrom = useRef<number | null>(null);
  return (
    <Panel title="색과 팔레트" className="color-panel">
      <div className="color-current">
        <div className="color-pair">
          <label className="color-big fg" style={{ background: color }} title="전경색 (칠하는 색) · 눌러서 아무 색이나">
            <input type="color" value={color} onChange={(e) => onChange(e.target.value)} />
          </label>
          <label className="color-big bg" style={{ background: secondary }} title="배경색 · X 로 바꾸기">
            <input type="color" value={secondary} onChange={(e) => onSecondary(e.target.value)} />
          </label>
        </div>
        <div>
          <div className="color-hex">{color.toUpperCase()}</div>
          <div className="color-tip">X: 전경색↔배경색 · 팔레트 칸 오른쪽 클릭: 배경색으로</div>
        </div>
      </div>
      <div className="palette-row">
        <select
          value=""
          onChange={(e) => {
            const p = PALETTES.find((x) => x.name === e.target.value);
            if (p) {
              doc.setPalette(p.colors);
              notify(`‘${p.name}’ 팔레트로 바꿨어요 (${p.colors.length}색).`);
            }
          }}
        >
          <option value="">팔레트 바꾸기…</option>
          {PALETTES.map((p) => (
            <option key={p.name}>{p.name}</option>
          ))}
        </select>
        <button
          className="mini"
          title="그림에 쓰인 색으로 팔레트 만들기"
          onClick={() => {
            const cols = usedColors(doc.layers.flatMap((l) => l.cels));
            if (!cols.length) return notify("아직 칠한 색이 없어요.");
            doc.setPalette(cols);
            notify(`그림에서 ${cols.length}색을 뽑았어요.`);
          }}
        >
          그림에서
        </button>
      </div>
      <div className="swatches" role="group" aria-label="팔레트">
        {palette.map((c, i) => (
          <button
            key={`${c}-${i}`}
            className="swatch"
            style={{ background: c }}
            aria-pressed={c === color}
            title={`${i + 1}. ${c} · 끌어서 순서 바꾸기 · Alt+클릭: 빼기`}
            draggable
            onDragStart={() => (dragFrom.current = i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              const from = dragFrom.current;
              dragFrom.current = null;
              if (from === null || from === i) return;
              const next = palette.slice();
              const [m] = next.splice(from, 1);
              next.splice(i, 0, m);
              doc.setPalette(next);
            }}
            onClick={(e) => (e.altKey ? doc.setPalette(palette.filter((_, j) => j !== i)) : onChange(c))}
            onContextMenu={(e) => {
              e.preventDefault();
              onSecondary(c);
            }}
          />
        ))}
        <button
          className="swatch add"
          title="지금 색을 팔레트에 넣기"
          onClick={() => (palette.includes(color) ? notify("이미 팔레트에 있어요.") : doc.setPalette([...palette, color]))}
        >
          ＋
        </button>
      </div>
      <div className="palette-row">
        <button className="mini" onClick={onLoad} title=".hex 나 .gpl 팔레트 파일 불러오기 (Lospec 에서 받은 것)">
          불러오기
        </button>
        <button className="mini" onClick={onSave} title=".hex 로 저장">
          저장
        </button>
        <button
          className="mini"
          title="밝기 순서로 정렬 (명암 붓이 잘 맞게)"
          onClick={() => {
            const lum = (h: string) => {
              const n = parseInt(h.slice(1), 16);
              return 0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255);
            };
            doc.setPalette([...palette].sort((a, b) => lum(a) - lum(b)));
          }}
        >
          밝기순
        </button>
        <button
          className="mini"
          title="전경색으로 어두운 색부터 밝은 색까지 5단계 램프를 만들어 팔레트에 넣어요. 어두울수록 파랑 쪽, 밝을수록 노랑 쪽으로 색조를 살짝 돌려서 탁하지 않아요 (hue shifting)"
          onClick={() => {
            const ramp = colorRamp(color, 5).filter((c) => !palette.includes(c));
            if (!ramp.length) return notify("이 램프는 이미 팔레트에 있어요.");
            doc.setPalette([...palette, ...ramp]);
            notify(`${color} 로 ${ramp.length}색 램프를 넣었어요. 명암 붓으로 바로 써 보세요.`);
          }}
        >
          램프 만들기
        </button>
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
