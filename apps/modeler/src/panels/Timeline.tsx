import { useRef } from "react";
import { FPS_CHOICES, INTERPS, type Interp, type Keyframe } from "../scene/animation";
import type { ModelerScene, ObjectInfo, SceneSnapshot } from "../scene/ModelerScene";

interface Props {
  model: ModelerScene;
  anim: SceneSnapshot["anim"];
  items: ObjectInfo[];
  selected: ObjectInfo | null;
  playing: boolean;
  onPlay: () => void;
  notify: (m: string) => void;
}

/** 눈금 간격: 칸 사이가 40px 은 되게 */
function tickStep(pxPerFrame: number) {
  return [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 5000].find((s) => s * pxPerFrame >= 40) ?? 10000;
}

/**
 * 블렌더 아래쪽의 타임라인: 프레임을 끌어 넘기고, I 로 키를 넣고, ◆ 를 끌어 시간을 옮긴다.
 * 고른 오브젝트의 키는 노란 마름모, 다른 오브젝트의 키는 작은 회색 점으로 보인다.
 */
export function Timeline({ model, anim, items, selected, playing, onPlay, notify }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const { frame, end, fps, autoKey } = anim;
  const keys: Keyframe[] = selected?.keys ?? [];
  const keyHere = keys.find((k) => k.frame === frame);
  const others = new Set<number>();
  for (const it of items) if (it.id !== selected?.id) for (const k of it.keys ?? []) others.add(k.frame);

  const frameAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.round(((clientX - r.left) / r.width) * end);
  };
  const xOf = (f: number) => `${(f / end) * 100}%`;
  const width = track.current?.clientWidth ?? 800;
  const step = tickStep(width / end);
  const ticks: number[] = [];
  for (let f = 0; f <= end; f += step) ticks.push(f);

  const scrub = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    model.setFrame(frameAt(e.clientX));
    const move = (ev: PointerEvent) => model.setFrame(frameAt(ev.clientX));
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  const dragKey = (e: React.PointerEvent, key: Keyframe) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const el = track.current!;
    el.setPointerCapture(e.pointerId);
    let from = key.frame;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const to = Math.max(0, Math.min(end, frameAt(ev.clientX)));
      if (to === from) return;
      moved = true;
      model.moveKey(from, to, false);
      from = to;
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      if (moved) model.moveKey(from, from, true);
      model.setFrame(from);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  const jump = (dir: 1 | -1) => {
    const all = model.keyFrames();
    const next = dir > 0 ? all.find((f) => f > frame) : [...all].reverse().find((f) => f < frame);
    if (next === undefined) return notify(dir > 0 ? "뒤쪽에 키가 없어요." : "앞쪽에 키가 없어요.");
    model.setFrame(next);
  };

  const insert = () => {
    if (!model.insertKey()) notify("먼저 움직일 오브젝트를 골라 주세요 (오브젝트 모드에서).");
  };

  const seconds = (frame / fps).toFixed(2);

  return (
    <div
      className="timeline"
      // 버튼이 키보드 초점을 가져가지 않게 (Space, I 같은 단축키가 계속 뷰포트로 가도록)
      onMouseDown={(e) => e.target instanceof HTMLButtonElement && e.preventDefault()}
    >
      <div className="tl-controls">
        <button title="처음으로 (Shift+←)" onClick={() => model.setFrame(0)}>⏮</button>
        <button title="앞 키로 (↓)" onClick={() => jump(-1)}>◆◀</button>
        <button className="tl-play" title="재생 / 멈춤 (Space)" aria-pressed={playing} onClick={onPlay}>
          {playing ? "⏸" : "▶"}
        </button>
        <button title="다음 키로 (↑)" onClick={() => jump(1)}>▶◆</button>
        <button title="끝으로 (Shift+→)" onClick={() => model.setFrame(end)}>⏭</button>
        <label className="tl-frame" title={`${seconds}초`}>
          <input
            type="number"
            min={0}
            max={end}
            value={frame}
            onChange={(e) => model.setFrame(Number(e.target.value))}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
          <span>/ {end}</span>
        </label>
        <span className="tl-sep" />
        <button
          className="tl-autokey"
          aria-pressed={autoKey}
          title="자동 키: 켜 두면 옮기고 돌릴 때마다 지금 프레임에 키가 저절로 들어가요"
          onClick={() => model.setAutoKey(!autoKey)}
        >
          ● 자동 키
        </button>
        <button title="지금 모습을 이 프레임에 기록 (I)" disabled={!selected} onClick={insert}>
          ◆ 키 넣기
        </button>
        <button title="이 프레임의 키 지우기 (Alt+I)" disabled={!keyHere} onClick={() => model.deleteKey()}>
          ◇ 지우기
        </button>
        <label className="tl-field" title="이 키에서 다음 키까지 움직이는 방식">
          <span>이어 가기</span>
          <select disabled={!keyHere} value={keyHere?.interp ?? "smooth"} onChange={(e) => model.setInterp(frame, e.target.value as Interp)}>
            {INTERPS.map((i) => (
              <option key={i.value} value={i.value}>
                {i.label}
              </option>
            ))}
          </select>
        </label>
        <span className="tl-grow" />
        <label className="tl-field" title="1초에 몇 장">
          <span>FPS</span>
          <select value={fps} onChange={(e) => model.setAnim({ fps: Number(e.target.value) })}>
            {[...new Set([...FPS_CHOICES, fps])].sort((a, b) => a - b).map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="tl-field" title="마지막 프레임">
          <span>끝</span>
          <input type="number" min={1} value={end} onChange={(e) => Number(e.target.value) > 0 && model.setAnim({ end: Number(e.target.value) })} />
        </label>
      </div>
      <div className="tl-track" ref={track} onPointerDown={scrub}>
        {ticks.map((f) => (
          <span key={f} className="tl-tick" style={{ left: xOf(f) }}>
            {f}
          </span>
        ))}
        {[...others].map((f) => (
          <span key={`o${f}`} className="tl-other" style={{ left: xOf(f) }} />
        ))}
        {keys.map((k) => (
          <span
            key={k.frame}
            className="tl-key"
            data-current={k.frame === frame}
            data-interp={k.interp ?? "smooth"}
            style={{ left: xOf(k.frame) }}
            title={`${k.frame} 프레임 · 끌어서 옮기기`}
            onPointerDown={(e) => dragKey(e, k)}
          />
        ))}
        <span className="tl-head" style={{ left: xOf(frame) }}>
          <em>{frame}</em>
        </span>
      </div>
    </div>
  );
}
