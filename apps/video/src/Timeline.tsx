import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { PEAKS_PER_SECOND, thumbnail, waveform } from "./media";
import { clearRange, clipDuration, clipEnd, isStill, isVisual, projectDuration, splitClip, timecode, TRANSITIONS, transitionLength, type Clip, type MediaItem, type Project, type Track, type TransitionKind } from "./model";

export type TimelineTool = "select" | "razor";

interface TimelineProps {
  project: Project;
  time: number;
  pxPerSec: number;
  setPxPerSec: (pps: number) => void;
  tool: TimelineTool;
  snapping: boolean;
  selected: Set<string>;
  setSelected: (ids: Set<string>) => void;
  onSeek: (t: number) => void;
  /** 끄는 중 미리 보기 (기록 없음) */
  preview: (p: Project) => void;
  /** 끄기가 끝났을 때 한 번 기록 */
  commit: () => void;
  /** 바로 기록 */
  set: (p: Project) => void;
  onDropMedia: (mediaId: string, trackId: string, t: number) => void;
}

const HEADER = 132;
const RULER = 30;
const SNAP_PX = 8;
const EDGE_PX = 7;

type Drag =
  | { kind: "move"; startX: number; startY: number; origin: Project; ids: Set<string>; anchor: Clip; moved: boolean }
  | { kind: "trim-start" | "trim-end"; startX: number; origin: Project; clip: Clip; moved: boolean }
  | { kind: "scrub" };

/**
 * 프리미어식 타임라인: 위에 시간 눈금, 영상 트랙(V3 이 맨 앞), 아래 소리 트랙.
 * 클립을 끌어 옮기고(다른 트랙으로도), 가장자리를 끌어 자르고, 자르기 도구(C)로 나눈다. 겹치면 아래 것을 덮어쓴다.
 */
export function Timeline(props: TimelineProps) {
  const { project, time, pxPerSec, tool, snapping, selected } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [snapLine, setSnapLine] = useState<number | null>(null);
  const [hover, setHover] = useState<"edge" | null>(null);
  const duration = projectDuration(project);
  const width = Math.max((duration + 30) * pxPerSec, (scrollRef.current?.clientWidth ?? 800) - HEADER);
  const timeAt = (clientX: number) => {
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left - HEADER + el.scrollLeft) / pxPerSec);
  };

  // 재생 중에는 재생 위치를 따라 화면을 넘긴다.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const x = time * pxPerSec;
    const view = el.clientWidth - HEADER;
    if (x < el.scrollLeft || x > el.scrollLeft + view - 20) el.scrollLeft = Math.max(0, x - view * 0.1);
  }, [time, pxPerSec]);

  // Ctrl+휠: 마우스 위치를 중심으로 확대/축소, 휠: 옆으로 넘기기
  useEffect(() => {
    const el = scrollRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.altKey) {
        e.preventDefault();
        const t = timeAt(e.clientX);
        const next = Math.min(800, Math.max(2, pxPerSec * (e.deltaY < 0 ? 1.25 : 0.8)));
        props.setPxPerSec(next);
        requestAnimationFrame(() => (el.scrollLeft = t * next - (e.clientX - el.getBoundingClientRect().left - HEADER)));
      } else if (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  /** 붙일 만한 시간들: 재생 위치, 0, 마커, 다른 클립의 앞뒤 */
  const snapTargets = (exclude: Set<string>) => [
    0,
    time,
    ...project.markers.map((m) => m.t),
    ...project.clips.filter((c) => !exclude.has(c.id)).flatMap((c) => [c.start, clipEnd(c)]),
  ];
  const snap = (t: number, exclude: Set<string>, alsoEnd?: number): { t: number; line: number | null } => {
    if (!snapping) return { t, line: null };
    let best: { d: number; t: number; line: number } | null = null;
    for (const target of snapTargets(exclude)) {
      for (const [edge, offset] of [[t, 0], ...(alsoEnd !== undefined ? [[t + alsoEnd, alsoEnd]] : [])] as [number, number][]) {
        const d = Math.abs(edge - target) * pxPerSec;
        if (d < SNAP_PX && (!best || d < best.d)) best = { d, t: target - offset, line: target };
      }
    }
    return best ? { t: best.t, line: best.line } : { t, line: null };
  };

  const trackOf = (id: string) => project.tracks.find((t) => t.id === id)!;
  const trackAtPoint = (x: number, y: number): Track | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-track]");
    return el ? (project.tracks.find((t) => t.id === el.dataset.track) ?? null) : null;
  };

  const onClipDown = (e: ReactPointerEvent, c: Clip) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (trackOf(c.track).locked) return;
    if (tool === "razor") {
      // Shift 를 누르면 그 시간의 모든 트랙을 한꺼번에 자른다.
      const t = snap(timeAt(e.clientX), new Set()).t;
      const targets = e.shiftKey ? project.clips.filter((x) => t > x.start && t < clipEnd(x) && !trackOf(x.track).locked) : [c];
      let clips = project.clips;
      for (const target of targets) {
        const parts = splitClip(target, t);
        if (parts) clips = clips.flatMap((x) => (x.id === target.id ? parts : [x]));
      }
      props.set({ ...project, clips });
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const edge = e.clientX - rect.left < EDGE_PX ? "trim-start" : rect.right - e.clientX < EDGE_PX ? "trim-end" : null;
    let ids = selected;
    if (e.shiftKey || e.ctrlKey) {
      ids = new Set(selected);
      if (ids.has(c.id)) ids.delete(c.id);
      else ids.add(c.id);
    } else if (!selected.has(c.id)) {
      ids = new Set([c.id]);
    }
    props.setSelected(ids);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = edge
      ? { kind: edge, startX: e.clientX, origin: project, clip: c, moved: false }
      : { kind: "move", startX: e.clientX, startY: e.clientY, origin: project, ids: ids.has(c.id) ? ids : new Set([c.id]), anchor: c, moved: false };
  };

  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) {
      // 가장자리에 올리면 자르기 커서
      const block = (e.target as HTMLElement).closest<HTMLElement>(".tl-clip");
      if (block && tool === "select") {
        const r = block.getBoundingClientRect();
        setHover(e.clientX - r.left < EDGE_PX || r.right - e.clientX < EDGE_PX ? "edge" : null);
      } else if (hover) setHover(null);
      return;
    }
    if (d.kind === "scrub") return props.onSeek(timeAt(e.clientX));
    if (Math.abs(e.clientX - d.startX) < 3 && !d.moved && (d.kind !== "move" || Math.abs(e.clientY - d.startY) < 3)) return;
    d.moved = true;
    const dt = (e.clientX - d.startX) / pxPerSec;

    if (d.kind === "move") {
      const anchor = d.anchor;
      const moving = d.origin.clips.filter((c) => d.ids.has(c.id));
      const minStart = Math.min(...moving.map((c) => c.start));
      const span = Math.max(...moving.map(clipEnd)) - minStart;
      const raw = Math.max(-minStart, dt);
      const snapped = snap(minStart + raw, d.ids, span);
      const shift = snapped.t - minStart;
      setSnapLine(snapped.line);
      // 위아래로 끌면 같은 종류의 다른 트랙으로 (가장 아래 클립 기준으로 같은 칸 수만큼)
      const target = trackAtPoint(e.clientX, e.clientY);
      const sameKind = d.origin.tracks.filter((t) => t.kind === trackOf(anchor.track).kind);
      const from = sameKind.findIndex((t) => t.id === anchor.track);
      const to = target && target.kind === trackOf(anchor.track).kind && !target.locked ? sameKind.findIndex((t) => t.id === target.id) : from;
      const rows = to - from;
      const clips = d.origin.clips.map((c) => {
        if (!d.ids.has(c.id)) return c;
        const kindTracks = d.origin.tracks.filter((t) => t.kind === trackOf(c.track).kind);
        const i = kindTracks.findIndex((t) => t.id === c.track);
        const j = Math.max(0, Math.min(kindTracks.length - 1, i + rows));
        return { ...c, start: c.start + shift, track: kindTracks[j].id };
      });
      props.preview({ ...d.origin, clips });
      return;
    }

    const c = d.clip;
    const media = d.origin.media.find((m) => m.id === c.mediaId);
    let next: Clip;
    if (d.kind === "trim-start") {
      const end = clipEnd(c);
      // 원본 앞부분보다 더 앞으로는 못 늘린다 (사진, 글자는 얼마든지).
      const earliest = isStill(c) ? 0 : Math.max(0, c.start - c.in / c.speed);
      const s = snap(Math.min(end - 1 / 30, Math.max(earliest, c.start + dt)), new Set([c.id]));
      setSnapLine(s.line);
      const shift = s.t - c.start;
      next = { ...c, start: s.t, in: isStill(c) ? 0 : c.in + shift * c.speed, out: isStill(c) ? c.out - shift : c.out };
    } else {
      const latest = isStill(c) || !media ? Infinity : c.start + (media.duration - c.in) / c.speed;
      const s = snap(Math.max(c.start + 1 / 30, Math.min(latest, clipEnd(c) + dt)), new Set([c.id]));
      setSnapLine(s.line);
      next = { ...c, out: c.in + (s.t - c.start) * c.speed };
    }
    props.preview({ ...d.origin, clips: d.origin.clips.map((x) => (x.id === c.id ? next : x)) });
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    setSnapLine(null);
    if (!d || d.kind === "scrub") return;
    if (!d.moved) return;
    // 내려놓은 자리에 있던 다른 클립은 덮어쓴다.
    const current = latest.current;
    const moved = current.clips.filter((c) => (d.kind === "move" ? d.ids.has(c.id) : c.id === d.clip.id));
    let clips = current.clips;
    const keep = new Set(moved.map((c) => c.id));
    for (const c of moved) clips = clearRange(clips, c.track, c.start, clipEnd(c), keep);
    props.preview({ ...current, clips });
    props.commit();
  };
  const latest = useRef(project);
  latest.current = project;

  const onLaneDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    props.setSelected(new Set());
    props.onSeek(timeAt(e.clientX));
  };

  const rulerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind: "scrub" };
    props.onSeek(snap(timeAt(e.clientX), new Set()).t);
  };

  const toggleTrack = (id: string, key: "muted" | "solo" | "hidden" | "locked") =>
    props.set({ ...project, tracks: project.tracks.map((t) => (t.id === id ? { ...t, [key]: !t[key] } : t)) });

  const firstAudio = project.tracks.findIndex((t) => t.kind === "audio");

  return (
    <div
      className={`tl tool-${tool}${hover ? " hover-edge" : ""}`}
      ref={scrollRef}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <div className="tl-inner" style={{ width: width + HEADER }}>
        <div className="tl-row tl-ruler-row" style={{ height: RULER }}>
          <div className="tl-head tl-corner">{timecode(time, project.sequence.fps)}</div>
          <div className="tl-ruler" onPointerDown={rulerDown} style={{ width }}>
            <Ruler pxPerSec={pxPerSec} width={width} fps={project.sequence.fps} />
            {project.inPoint !== null || project.outPoint !== null ? (
              <div
                className="tl-range"
                style={{ left: (project.inPoint ?? 0) * pxPerSec, width: ((project.outPoint ?? duration) - (project.inPoint ?? 0)) * pxPerSec }}
              />
            ) : null}
            {project.markers.map((m) => (
              <div
                key={m.id}
                className="tl-marker"
                title={`${m.label} (두 번 클릭: 이름 바꾸기 · 오른쪽 클릭: 지우기)`}
                style={{ left: m.t * pxPerSec, background: m.color }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  props.onSeek(m.t);
                }}
                onDoubleClick={() => {
                  const label = window.prompt("마커 이름 (유튜브 챕터 제목이 돼요)", m.label)?.trim();
                  if (label) props.set({ ...project, markers: project.markers.map((x) => (x.id === m.id ? { ...x, label } : x)) });
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  props.set({ ...project, markers: project.markers.filter((x) => x.id !== m.id) });
                }}
              />
            ))}
          </div>
        </div>
        {project.tracks.map((track, i) => (
          <div key={track.id} className={`tl-row ${track.kind}${i === firstAudio ? " first-audio" : ""}${track.locked ? " locked" : ""}`}>
            <div className="tl-head">
              <span className="tl-name">{track.name}</span>
              {track.kind === "video" ? (
                <button aria-pressed={!track.hidden} title={track.hidden ? "트랙 보이기" : "트랙 숨기기"} onClick={() => toggleTrack(track.id, "hidden")}>
                  {track.hidden ? "◌" : "👁"}
                </button>
              ) : (
                <>
                  <button className={track.muted ? "on mute" : ""} title="소리 끄기 (M)" onClick={() => toggleTrack(track.id, "muted")}>
                    M
                  </button>
                  <button className={track.solo ? "on solo" : ""} title="이 트랙만 듣기 (S)" onClick={() => toggleTrack(track.id, "solo")}>
                    S
                  </button>
                </>
              )}
              {track.kind === "video" && (
                <button className={track.muted ? "on mute" : ""} title="이 트랙 영상의 소리 끄기" onClick={() => toggleTrack(track.id, "muted")}>
                  M
                </button>
              )}
              <button className={track.locked ? "on lock" : ""} title={track.locked ? "잠금 풀기" : "잠그기 (실수로 안 움직이게)"} onClick={() => toggleTrack(track.id, "locked")}>
                {track.locked ? "🔒" : "🔓"}
              </button>
            </div>
            <div
              className="tl-lane"
              data-track={track.id}
              style={{ width }}
              onPointerDown={onLaneDown}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes(`application/x-baco-${track.kind}`) && !track.locked) {
                  e.preventDefault();
                  e.currentTarget.classList.add("drop");
                }
              }}
              onDragLeave={(e) => e.currentTarget.classList.remove("drop")}
              onDrop={(e) => {
                e.currentTarget.classList.remove("drop");
                const id = e.dataTransfer.getData("application/x-baco-media");
                if (id) props.onDropMedia(id, track.id, snap(timeAt(e.clientX), new Set()).t);
              }}
            >
              {project.clips
                .filter((c) => c.track === track.id)
                .map((c) => (
                  <ClipBlock
                    key={c.id}
                    clip={c}
                    media={project.media.find((m) => m.id === c.mediaId)}
                    pxPerSec={pxPerSec}
                    selected={selected.has(c.id)}
                    onPointerDown={(e) => onClipDown(e, c)}
                    onDropTransition={(kind) => {
                      if (track.locked || c.kind === "audio") return;
                      const duration = Math.min(1, clipDuration(c) / 2);
                      props.set({ ...project, clips: project.clips.map((x) => (x.id === c.id ? { ...x, transitionIn: { kind, duration } } : x)) });
                      props.setSelected(new Set([c.id]));
                    }}
                  />
                ))}
            </div>
          </div>
        ))}
        <div className="tl-playhead" style={{ left: HEADER + time * pxPerSec }} />
        {snapLine !== null && <div className="tl-snap" style={{ left: HEADER + snapLine * pxPerSec }} />}
      </div>
    </div>
  );
}

function ClipBlock({
  clip,
  media,
  pxPerSec,
  selected,
  onPointerDown,
  onDropTransition,
}: {
  clip: Clip;
  media?: MediaItem;
  pxPerSec: number;
  selected: boolean;
  onPointerDown: (e: ReactPointerEvent) => void;
  onDropTransition: (kind: TransitionKind) => void;
}) {
  const [thumb, setThumb] = useState<string | null>(null);
  const w = clipDuration(clip) * pxPerSec;
  useEffect(() => {
    if (media && media.kind !== "audio") void thumbnail(media).then(setThumb);
  }, [media]);
  const graded = Object.values(clip.color).some((v) => (typeof v === "number" ? v !== 0 : !!v)) || !!clip.key?.on || (!!clip.blend && clip.blend !== "source-over");
  const keyed = Object.values(clip.params).some((p) => p.keys?.length);
  return (
    <div
      className={`tl-clip ${clip.kind}${selected ? " selected" : ""}`}
      style={{ left: clip.start * pxPerSec, width: Math.max(2, w) }}
      onPointerDown={onPointerDown}
      title={clip.name}
      onDragOver={(e) => {
        if (clip.kind !== "audio" && e.dataTransfer.types.includes("application/x-baco-transition")) {
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.classList.add("drop");
        }
      }}
      onDragLeave={(e) => e.currentTarget.classList.remove("drop")}
      onDrop={(e) => {
        const kind = e.dataTransfer.getData("application/x-baco-transition") as TransitionKind;
        e.currentTarget.classList.remove("drop");
        if (!kind) return;
        e.preventDefault();
        e.stopPropagation();
        onDropTransition(kind);
      }}
    >
      {thumb && isVisual(clip) && <div className="tl-thumb" style={{ backgroundImage: `url(${thumb})` }} />}
      {media && clip.kind === "audio" && <Wave media={media} clip={clip} width={w} />}
      <span className="tl-label">
        {graded && <b className="tl-badge">fx</b>}
        {keyed && <b className="tl-badge">◆</b>}
        {clip.speed !== 1 && <b className="tl-badge">{Math.round(clip.speed * 100)}%</b>}
        {clip.kind === "text" ? `T ${clip.text?.text.split("\n")[0] ?? ""}` : clip.kind === "adjust" ? `◐ ${clip.name}` : clip.name}
      </span>
      {clip.transitionIn && (
        <div className="tl-transition" style={{ width: Math.max(6, transitionLength(clip) * pxPerSec) }} title={`전환: ${TRANSITIONS.find((t) => t.kind === clip.transitionIn!.kind)?.label} · ${clip.transitionIn.duration.toFixed(2)}초`}>
          <span>{TRANSITIONS.find((t) => t.kind === clip.transitionIn!.kind)?.label}</span>
        </div>
      )}
      {clip.fadeIn > 0 && <div className="tl-fade in" style={{ width: clip.fadeIn * pxPerSec }} />}
      {clip.fadeOut > 0 && <div className="tl-fade out" style={{ width: clip.fadeOut * pxPerSec }} />}
    </div>
  );
}

function Wave({ media, clip, width }: { media: MediaItem; clip: Clip; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  useEffect(() => void waveform(media).then(setPeaks), [media]);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !peaks) return;
    const w = Math.max(1, Math.min(8000, Math.round(width)));
    const h = 40;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(10, 40, 25, 0.55)";
    const from = clip.in * PEAKS_PER_SECOND;
    const per = ((clip.out - clip.in) * PEAKS_PER_SECOND) / w;
    for (let x = 0; x < w; x++) {
      let p = 0;
      for (let i = Math.floor(from + x * per); i < Math.floor(from + (x + 1) * per) + 1; i++) p = Math.max(p, peaks[i] ?? 0);
      const bar = p * (h - 4);
      ctx.fillRect(x, (h - bar) / 2, 1, Math.max(1, bar));
    }
  }, [peaks, width, clip.in, clip.out]);
  return <canvas ref={ref} className="tl-wave" />;
}

/** 시간 눈금: 확대 정도에 맞춰 1프레임 ~ 1분 간격 */
function Ruler({ pxPerSec, width, fps }: { pxPerSec: number; width: number; fps: number }) {
  const steps = [1 / fps, 5 / fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  const step = steps.find((s) => s * pxPerSec >= 70) ?? 600;
  const ticks: number[] = [];
  for (let t = 0; t * pxPerSec < width; t += step) ticks.push(t);
  const label = (t: number) => {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    const f = Math.round((t % 1) * fps);
    return step < 1 ? `${m}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  };
  return (
    <>
      {ticks.map((t) => (
        <div key={t} className="tl-tick" style={{ left: t * pxPerSec }}>
          <span>{label(t)}</span>
        </div>
      ))}
    </>
  );
}
