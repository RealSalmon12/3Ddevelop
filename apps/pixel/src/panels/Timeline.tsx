import { useEffect, useRef, useState } from "react";
import { MAX_FRAMES, MAX_LAYERS, type DocSnapshot, type PixelDoc } from "../doc/PixelDoc";

interface Props {
  doc: PixelDoc;
  snap: DocSnapshot;
  playing: boolean;
  setPlaying: (v: boolean) => void;
  onion: boolean;
  setOnion: (v: boolean) => void;
}

/** 작은 셀 그림 (레이어 하나, 프레임 하나) */
function CelThumb({ doc, layer, frame, version }: { doc: PixelDoc; layer: number; frame: number; version: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const cel = doc.celAt(layer, frame);
    if (!c || !cel) return;
    c.width = cel.width;
    c.height = cel.height;
    c.getContext("2d")!.putImageData(new ImageData(cel.data.slice(), cel.width, cel.height), 0, 0);
  }, [doc, layer, frame, version]);
  return <canvas ref={ref} className="cel-thumb" />;
}

/**
 * 에이스프라이트식 타임라인: 줄은 레이어(위가 앞), 칸은 프레임.
 * 칸을 누르면 그 레이어·프레임에 그리고, 위 번호를 끌면 프레임 순서를 바꾼다.
 */
export function Timeline({ doc, snap, playing, setPlaying, onion, setOnion }: Props) {
  const order = snap.layers.map((layer, index) => ({ layer, index })).reverse();
  const dragFrame = useRef<number | null>(null);
  const [opacity, setOpacity] = useState<number | null>(null);
  const opacityStart = useRef(100);
  const active = snap.layers[snap.active];
  const totalMs = snap.frames.reduce((s, f) => s + f.duration, 0);

  return (
    <div className="timeline" aria-label="타임라인">
      <div className="tl-bar">
        <button title="처음 프레임 (Home)" onClick={() => doc.setFrame(0)}>
          ⏮
        </button>
        <button title="이전 프레임 (,)" onClick={() => doc.setFrame(snap.frame - 1)}>
          ◀
        </button>
        <button className="tl-play" aria-pressed={playing} title="재생 / 멈춤 (Enter)" onClick={() => setPlaying(!playing)}>
          {playing ? "■" : "▶"}
        </button>
        <button title="다음 프레임 (.)" onClick={() => doc.setFrame(snap.frame + 1)}>
          ▶
        </button>
        <button title="마지막 프레임 (End)" onClick={() => doc.setFrame(snap.frames.length - 1)}>
          ⏭
        </button>
        <span className="tl-sep" />
        <button title="새 빈 프레임 (Alt+N)" disabled={snap.frames.length >= MAX_FRAMES} onClick={() => doc.addFrame(false)}>
          ＋ 빈 프레임
        </button>
        <button title="지금 프레임 복사 (Alt+D)" disabled={snap.frames.length >= MAX_FRAMES} onClick={() => doc.addFrame(true)}>
          ⧉ 복사
        </button>
        <button title="지금 프레임 지우기" disabled={snap.frames.length <= 1} onClick={() => doc.removeFrame()}>
          🗑
        </button>
        <label className="tl-dur" title="지금 프레임을 보여 줄 시간">
          <input
            type="number"
            min={10}
            max={10000}
            step={10}
            value={snap.frames[snap.frame].duration}
            onChange={(e) => Number(e.target.value) >= 10 && doc.setDuration(snap.frame, Number(e.target.value))}
          />
          ms
        </label>
        <button title="모든 프레임을 이 시간으로" onClick={() => doc.setDuration(null, snap.frames[snap.frame].duration)}>
          모두
        </button>
        <span className="tl-sep" />
        <button aria-pressed={onion} title="양파 껍질: 앞 프레임(빨강)과 뒤 프레임(파랑)을 흐리게 보여 줘요" onClick={() => setOnion(!onion)}>
          🧅 양파 껍질
        </button>
        <span className="tl-info">
          {snap.frame + 1} / {snap.frames.length} 프레임 · {(totalMs / 1000).toFixed(2)}초 · {Math.round(1000 / (totalMs / snap.frames.length))} fps
        </span>
        <span className="tl-sep grow" />
        <label className="tl-opacity" title="지금 레이어 불투명도">
          불투명도
          <input
            type="range"
            min={0}
            max={100}
            value={opacity ?? active.opacity}
            onChange={(e) => {
              if (opacity === null) opacityStart.current = active.opacity;
              setOpacity(Number(e.target.value));
              doc.setOpacity(snap.active, Number(e.target.value), true);
            }}
            onPointerUp={() => {
              if (opacity === null) return;
              const v = opacity;
              setOpacity(null);
              // 끄기 전 값으로 돌려 놓고 한 번에 기록 (실행 취소가 처음 값으로 가게)
              doc.layers[snap.active].opacity = opacityStart.current;
              doc.setOpacity(snap.active, v);
            }}
          />
          <b>{opacity ?? active.opacity}%</b>
        </label>
      </div>
      <div className="tl-grid">
        <table>
          <thead>
            <tr>
              <th className="tl-layer-head">
                <button title="새 레이어 (Shift+N)" disabled={snap.layers.length >= MAX_LAYERS} onClick={() => doc.addLayer()}>
                  ＋
                </button>
                <button title="레이어 복제" disabled={snap.layers.length >= MAX_LAYERS} onClick={() => doc.duplicateLayer()}>
                  ⧉
                </button>
                <button title="위로" disabled={snap.active >= snap.layers.length - 1} onClick={() => doc.moveLayer(snap.active, 1)}>
                  ▲
                </button>
                <button title="아래로" disabled={snap.active === 0} onClick={() => doc.moveLayer(snap.active, -1)}>
                  ▼
                </button>
                <button title="아래 레이어와 합치기 (Ctrl+E)" disabled={snap.active === 0} onClick={() => doc.mergeDown()}>
                  ⤓
                </button>
                <button title="레이어 지우기" disabled={snap.layers.length <= 1} onClick={() => doc.removeLayer()}>
                  🗑
                </button>
              </th>
              {snap.frames.map((f, i) => (
                <th
                  key={i}
                  className={i === snap.frame ? "tl-frame current" : "tl-frame"}
                  draggable
                  onDragStart={() => (dragFrame.current = i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragFrame.current !== null) doc.moveFrame(dragFrame.current, i);
                    dragFrame.current = null;
                  }}
                  onClick={() => doc.setFrame(i)}
                  title={`${i + 1}번 프레임 · ${f.duration}ms · 끌어서 순서 바꾸기`}
                >
                  {i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {order.map(({ layer, index }) => (
              <tr key={layer.id} className={index === snap.active ? "current" : ""}>
                <th className="tl-layer">
                  <button className="tl-icon" aria-pressed={layer.visible} title={layer.visible ? "숨기기" : "보이기"} onClick={() => doc.toggleVisible(index)}>
                    {layer.visible ? "👁" : "–"}
                  </button>
                  <button className="tl-icon" aria-pressed={layer.locked} title={layer.locked ? "잠금 풀기" : "잠그기"} onClick={() => doc.toggleLocked(index)}>
                    {layer.locked ? "🔒" : "🔓"}
                  </button>
                  <button
                    className="tl-name"
                    onClick={() => doc.setActive(index)}
                    onDoubleClick={() => {
                      const name = window.prompt("레이어 이름", layer.name);
                      if (name) doc.renameLayer(index, name);
                    }}
                    title="눌러서 이 레이어에 그리기 · 두 번 눌러서 이름 바꾸기"
                  >
                    {layer.name}
                    {layer.opacity < 100 && <small> {layer.opacity}%</small>}
                  </button>
                </th>
                {snap.frames.map((_, f) => (
                  <td
                    key={f}
                    className={[f === snap.frame && "col", f === snap.frame && index === snap.active && "sel"].filter(Boolean).join(" ")}
                    onClick={() => {
                      doc.setActive(index);
                      doc.setFrame(f);
                    }}
                  >
                    {doc.celEmpty(index, f) ? <span className="cel-empty">○</span> : <CelThumb doc={doc} layer={index} frame={f} version={snap.version} />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
