import { useCallback, useEffect, useRef, useState } from "react";
import {
  AIAssistantPanel,
  AppFrame,
  MenuBar,
  Panel,
  StatusBar,
  Toast,
  Tour,
  UpdateButton,
  isTourOpen,
  useHistory,
  useToast,
  useTour,
  useUpdater,
  type Menu,
  type TourStep,
} from "@suite/ui";
import { AI_SYSTEM, AI_TOOL, aiContext, applyAICaptions } from "./ai";
import { Engine } from "./engine";
import { clipLength, clipStart, EMPTY_PROJECT, fmt, locate, newId, totalLength, type Caption, type Clip, type Project } from "./project";

const TOUR_STEPS: TourStep[] = [
  { title: "바코 오로라에 오신 걸 환영해요! 👋", body: "영상과 사진을 이어 붙이고, 자막과 배경 음악을 넣어서 쇼츠 같은 짧은 영상을 만들 수 있어요." },
  { title: "영상 넣기", target: ".video-add", body: "영상이나 사진 파일을 창에 끌어다 놓거나 ‘＋ 영상·사진 넣기’를 눌러요. 넣은 순서대로 아래에 이어져요." },
  { title: "타임라인", target: ".timeline", body: "아래 줄이 시간 순서예요. 조각을 눌러 고르고, 오른쪽에서 앞뒤를 잘라 내거나 순서를 바꿔요. 줄을 클릭하면 그 시간으로 가요." },
  { title: "자막과 음악", target: ".suite-side .suite-panel:nth-of-type(2)", body: "‘＋ 자막’을 누르면 지금 시간에 자막이 생겨요. 배경 음악도 넣을 수 있어요." },
  { title: "AI 에게 부탁하기 ✨", target: ".suite-side .suite-panel:last-of-type", body: "“재밌는 자막 달아줘”라고 쓰면 AI 가 자막을 만들어 줘요." },
  { title: "영상으로 저장", target: ".suite-menu:nth-of-type(1)", body: "‘영상으로 내보내기’를 누르면 처음부터 끝까지 재생하면서 .webm 영상 파일로 저장해요. 유튜브에 바로 올릴 수 있어요." },
];

const MEDIA = { name: "영상, 사진", extensions: ["mp4", "webm", "mov", "mkv", "png", "jpg", "jpeg", "gif", "webp"] };
const AUDIO = { name: "음악", extensions: ["mp3", "wav", "ogg", "m4a"] };
const IMAGE_SECONDS = 3;

function base64ToBlobUrl(b64: string, mime: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

const mimeOf = (name: string) => {
  const ext = name.split(".").pop()!.toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return `image/${ext === "jpg" ? "jpeg" : ext}`;
  if (["mp3", "wav", "ogg", "m4a"].includes(ext)) return `audio/${ext === "mp3" ? "mpeg" : ext === "m4a" ? "mp4" : ext}`;
  return `video/${ext === "mov" ? "quicktime" : ext === "mkv" ? "x-matroska" : ext}`;
};

/** 영상 길이 읽기 */
function probeVideo(url: string) {
  return new Promise<number>((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => resolve(Number.isFinite(v.duration) ? v.duration : 5);
    v.onerror = () => reject(new Error("영상을 읽을 수 없어요"));
    v.src = url;
  });
}

export function App() {
  const history = useHistory<Project>(EMPTY_PROJECT, 60);
  const project = history.state;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engine = useRef<Engine | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedClip, setSelectedClip] = useState<number | null>(null);
  const [selectedCaption, setSelectedCaption] = useState<number | null>(null);
  const [exporting, setExporting] = useState<number | null>(null);
  const [aiOpen, setAiOpen] = useState(true);
  const [toast, notify] = useToast(4500);
  const tour = useTour("video");
  const updater = useUpdater(notify);
  const total = totalLength(project);
  const clip = project.clips.find((c) => c.id === selectedClip) ?? null;
  const caption = project.captions.find((c) => c.id === selectedCaption) ?? null;

  useEffect(() => {
    const e = new Engine(canvasRef.current!, history.get());
    e.onTime = (t, p) => {
      setTime(t);
      setPlaying(p);
    };
    engine.current = e;
    e.seek(0);
    return () => e.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => engine.current?.setProject(project), [project]);

  useEffect(() => {
    document.title = `${history.dirty ? "● " : ""}바코 오로라`;
    window.suite?.window.setDirty(history.dirty);
  }, [history.dirty]);

  const addMedia = useCallback(
    async (url: string, name: string, mime: string) => {
      try {
        const isImage = mime.startsWith("image/");
        const duration = isImage ? 600 : await probeVideo(url);
        const c: Clip = { id: newId(), kind: isImage ? "image" : "video", name, url, duration, in: 0, out: isImage ? IMAGE_SECONDS : duration, volume: 1 };
        history.set((p) => ({ ...p, clips: [...p.clips, c] }));
        setSelectedClip(c.id);
      } catch {
        notify(`‘${name}’ 은(는) 열 수 없어요. mp4 나 webm 영상, png·jpg 사진을 써 주세요.`);
      }
    },
    [history, notify],
  );

  const setMusic = (url: string, name: string) => history.set((p) => ({ ...p, music: { name, url, volume: 0.5 } }));

  const openMedia = async () => {
    if (!window.suite) return;
    const r = await window.suite.files.open({ filters: [MEDIA], binary: true });
    if (!r.ok) return r.reason === "error" && notify(`열지 못했어요. ${r.message ?? ""}`);
    const name = r.path.split(/[\\/]/).pop()!;
    const mime = mimeOf(name);
    await addMedia(base64ToBlobUrl(r.text, mime), name.replace(/\.[^.]+$/, ""), mime);
  };

  const openMusic = async () => {
    if (!window.suite) return;
    const r = await window.suite.files.open({ filters: [AUDIO], binary: true });
    if (!r.ok) return r.reason === "error" && notify(`열지 못했어요. ${r.message ?? ""}`);
    const name = r.path.split(/[\\/]/).pop()!;
    setMusic(base64ToBlobUrl(r.text, mimeOf(name)), name.replace(/\.[^.]+$/, ""));
  };

  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = async (e: DragEvent) => {
      e.preventDefault();
      for (const file of Array.from(e.dataTransfer?.files ?? [])) {
        const url = URL.createObjectURL(file);
        const name = file.name.replace(/\.[^.]+$/, "");
        const mime = file.type || mimeOf(file.name);
        if (mime.startsWith("audio/")) setMusic(url, name);
        else await addMedia(url, name, mime);
      }
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  });

  const updateClip = (c: Clip, preview = false) => (preview ? history.preview : history.set)((p) => ({ ...p, clips: p.clips.map((x) => (x.id === c.id ? c : x)) }));
  const updateCaption = (c: Caption, preview = false) =>
    (preview ? history.preview : history.set)((p) => ({ ...p, captions: p.captions.map((x) => (x.id === c.id ? c : x)) }));

  const moveClip = (dir: -1 | 1) =>
    history.set((p) => {
      const i = p.clips.findIndex((c) => c.id === selectedClip);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= p.clips.length) return p;
      const clips = [...p.clips];
      [clips[i], clips[j]] = [clips[j], clips[i]];
      return { ...p, clips };
    });

  /** 지금 시간에서 조각을 둘로 나눈다 */
  const split = () => {
    const at = locate(project, time);
    if (!at || at.local - at.clip.in < 0.2 || at.clip.out - at.local < 0.2) return notify("조각 가운데쯤에서 나눌 수 있어요. 재생 위치를 옮겨 주세요.");
    const second: Clip = { ...at.clip, id: newId(), in: at.local };
    history.set((p) => {
      const clips = [...p.clips];
      clips.splice(at.index, 1, { ...at.clip, out: at.local }, second);
      return { ...p, clips };
    });
    setSelectedClip(second.id);
  };

  const addCaption = () => {
    const c: Caption = { id: newId(), text: "자막을 입력하세요", start: time, end: Math.min(Math.max(total, time + 2.5), time + 2.5), position: "bottom", size: "medium", color: "#ffffff" };
    history.set((p) => ({ ...p, captions: [...p.captions, c].sort((a, b) => a.start - b.start) }));
    setSelectedCaption(c.id);
    requestAnimationFrame(() => {
      const box = document.querySelector<HTMLTextAreaElement>(".caption-text");
      box?.focus();
      box?.select();
    });
  };

  const exportVideo = async () => {
    const e = engine.current;
    if (!e || !window.suite) return;
    if (!total) return notify("먼저 영상이나 사진을 넣어 주세요.");
    setExporting(0);
    try {
      const blob = await e.record((r) => setExporting(r));
      setExporting(null);
      const r = await window.suite.files.save({
        defaultName: "내 영상.webm",
        filters: [{ name: "WebM 영상", extensions: ["webm"] }],
        data: new Uint8Array(await blob.arrayBuffer()),
      });
      if (r.ok) {
        history.markSaved();
        notify("영상으로 저장했어요! 유튜브에 바로 올릴 수 있어요.");
      } else if (r.reason === "error") notify(`저장하지 못했어요. ${r.message ?? ""}`);
    } catch (err) {
      setExporting(null);
      notify(`영상을 만들지 못했어요. ${String(err)}`);
    }
  };

  const togglePlay = () => (engine.current?.isPlaying ? engine.current.stop() : engine.current?.play());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || (e.target instanceof HTMLInputElement && e.target.type !== "range") || isTourOpen() || exporting !== null) return;
      const key = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        const map: Record<string, () => void> = {
          z: () => (e.shiftKey ? history.redo() : history.undo()),
          y: history.redo,
          o: () => void openMedia(),
          e: () => void exportVideo(),
        };
        if (map[key]) {
          e.preventDefault();
          map[key]();
        }
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (key === "s") split();
      else if (key === "arrowleft") engine.current?.seek(Math.max(0, time - (e.shiftKey ? 1 : 0.1)));
      else if (key === "arrowright") engine.current?.seek(Math.min(total, time + (e.shiftKey ? 1 : 0.1)));
      else if (key === "home") engine.current?.seek(0);
      else if (key === "delete" || key === "backspace") {
        if (selectedCaption) {
          history.set((p) => ({ ...p, captions: p.captions.filter((c) => c.id !== selectedCaption) }));
          setSelectedCaption(null);
        } else if (selectedClip) {
          history.set((p) => ({ ...p, clips: p.clips.filter((c) => c.id !== selectedClip) }));
          setSelectedClip(null);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const menus: Menu[] = [
    {
      label: "파일",
      items: [
        { label: "영상·사진 넣기…", shortcut: "Ctrl+O", onSelect: () => void openMedia() },
        { label: "배경 음악 넣기…", onSelect: () => void openMusic() },
        { label: "영상으로 내보내기 (.webm)", shortcut: "Ctrl+E", onSelect: () => void exportVideo() },
      ],
    },
    {
      label: "편집",
      items: [
        { label: "실행 취소", shortcut: "Ctrl+Z", disabled: !history.canUndo, onSelect: history.undo },
        { label: "다시 실행", shortcut: "Ctrl+Y", disabled: !history.canRedo, onSelect: history.redo },
        { label: "지금 위치에서 나누기", shortcut: "S", onSelect: split },
        { label: "자막 넣기", onSelect: addCaption },
      ],
    },
    {
      label: "화면",
      items: [
        { label: `가로 영상 (유튜브)${project.portrait ? "" : " ✓"}`, onSelect: () => history.set((p) => ({ ...p, portrait: false })) },
        { label: `세로 영상 (쇼츠, 틱톡)${project.portrait ? " ✓" : ""}`, onSelect: () => history.set((p) => ({ ...p, portrait: true })) },
      ],
    },
    {
      label: "도움말",
      items: [
        { label: "따라하기 안내 다시 보기", onSelect: tour.start },
        { label: "업데이트 확인", onSelect: () => void updater.check(true) },
      ],
    },
  ];

  const slider = (label: string, value: number, min: number, max: number, step: number, unit: string, set: (v: number) => void, commit = history.commit) => (
    <label className="prop-slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} />
      <b>
        {Math.round(value * 10) / 10}
        {unit}
      </b>
    </label>
  );

  const pxPerSec = total ? 100 / total : 0;

  return (
    <AppFrame
      menubar={
        <MenuBar
          appName="바코 오로라"
          menus={menus}
          actions={
            <>
              <button className="suite-menubar-action history-button" disabled={!history.canUndo} title="실행 취소 (Ctrl+Z)" onClick={history.undo}>
                ↶
              </button>
              <button className="suite-menubar-action history-button" disabled={!history.canRedo} title="다시 실행 (Ctrl+Y)" onClick={history.redo}>
                ↷
              </button>
              <UpdateButton updater={updater} hasUnsavedWork={history.dirty} />
              <button className="suite-menubar-action ai" aria-pressed={aiOpen} onClick={() => setAiOpen(!aiOpen)}>
                ✨ AI 도우미
              </button>
            </>
          }
        />
      }
      sidebar={
        <>
          <Panel title={clip ? `조각: ${clip.name}` : "조각"}>
            {clip ? (
              <>
                {clip.kind === "video" ? (
                  <>
                    {slider("시작", clip.in, 0, Math.max(0, clip.out - 0.2), 0.1, "초", (v) => updateClip({ ...clip, in: v }, true))}
                    {slider("끝", clip.out, clip.in + 0.2, clip.duration, 0.1, "초", (v) => updateClip({ ...clip, out: v }, true))}
                    {slider("소리", Math.round(clip.volume * 100), 0, 150, 1, "%", (v) => updateClip({ ...clip, volume: v / 100 }, true))}
                  </>
                ) : (
                  slider("보이는 시간", clip.out, 0.5, 15, 0.5, "초", (v) => updateClip({ ...clip, out: v }, true))
                )}
                <div className="prop-buttons">
                  <button className="mini" onClick={() => moveClip(-1)}>
                    ◀ 앞으로
                  </button>
                  <button className="mini" onClick={() => moveClip(1)}>
                    뒤로 ▶
                  </button>
                  <button className="mini" onClick={split} title="재생 위치에서 둘로 나누기 (S)">
                    ✂ 나누기
                  </button>
                  <button
                    className="mini"
                    onClick={() => {
                      history.set((p) => ({ ...p, clips: p.clips.filter((c) => c.id !== clip.id) }));
                      setSelectedClip(null);
                    }}
                  >
                    🗑
                  </button>
                </div>
              </>
            ) : (
              <p className="panel-note">아래 타임라인에서 조각을 누르면 앞뒤를 잘라 내거나 순서를 바꿀 수 있어요.</p>
            )}
          </Panel>
          <Panel title="자막과 음악">
            <div className="prop-buttons">
              <button className="mini go" onClick={addCaption}>
                ＋ 자막 (지금 시간에)
              </button>
              <button className="mini" onClick={() => void openMusic()}>
                🎵 {project.music ? "음악 바꾸기" : "배경 음악"}
              </button>
            </div>
            {project.music && (
              <>
                <p className="panel-note">🎵 {project.music.name}</p>
                {slider("음악 소리", Math.round(project.music.volume * 100), 0, 100, 1, "%", (v) =>
                  history.preview((p) => ({ ...p, music: p.music && { ...p.music, volume: v / 100 } })),
                )}
                <button className="mini" onClick={() => history.set((p) => ({ ...p, music: null }))}>
                  음악 빼기
                </button>
              </>
            )}
            {caption && (
              <div className="caption-edit">
                <textarea className="caption-text" rows={2} value={caption.text} onChange={(e) => updateCaption({ ...caption, text: e.target.value }, true)} onBlur={history.commit} />
                {slider("시작", caption.start, 0, Math.max(0.1, total), 0.1, "초", (v) => updateCaption({ ...caption, start: v, end: Math.max(caption.end, v + 0.3) }, true))}
                {slider("끝", caption.end, caption.start + 0.3, Math.max(caption.start + 0.3, total), 0.1, "초", (v) => updateCaption({ ...caption, end: v }, true))}
                <div className="prop-buttons">
                  {(["top", "middle", "bottom"] as const).map((pos) => (
                    <button key={pos} className="mini" aria-pressed={caption.position === pos} onClick={() => updateCaption({ ...caption, position: pos })}>
                      {pos === "top" ? "위" : pos === "middle" ? "가운데" : "아래"}
                    </button>
                  ))}
                  {(["small", "medium", "large"] as const).map((s) => (
                    <button key={s} className="mini" aria-pressed={caption.size === s} onClick={() => updateCaption({ ...caption, size: s })}>
                      {s === "small" ? "작게" : s === "medium" ? "보통" : "크게"}
                    </button>
                  ))}
                  <input type="color" value={caption.color} onChange={(e) => updateCaption({ ...caption, color: e.target.value })} />
                  <button
                    className="mini"
                    onClick={() => {
                      history.set((p) => ({ ...p, captions: p.captions.filter((c) => c.id !== caption.id) }));
                      setSelectedCaption(null);
                    }}
                  >
                    🗑
                  </button>
                </div>
              </div>
            )}
          </Panel>
          {aiOpen && (
            <AIAssistantPanel
              app="video"
              greeting="안녕하세요! 영상을 넣고 “재밌는 자막 달아줘”처럼 부탁해 보세요. 자막을 만들어 드릴게요."
              examples={["재밌는 자막 달아줘", "처음에 큰 제목 넣어줘", "마지막에 구독 부탁 자막"]}
              getContext={() => aiContext(history.get())}
              system={AI_SYSTEM}
              tool={AI_TOOL}
              onResponse={({ text, toolInput }) => {
                if (!toolInput) return text;
                const input = toolInput as { message?: string; captions?: []; replace?: boolean };
                history.set((p) => applyAICaptions(p, input));
                return `${input.message ?? "자막을 넣었어요."}\n(마음에 안 들면 Ctrl+Z)`;
              }}
            />
          )}
        </>
      }
      statusbar={
        <StatusBar hint="Space: 재생/멈춤 · ← →: 조금씩 옮기기 · S: 나누기 · Delete: 고른 조각·자막 지우기 · 파일을 끌어다 놓으면 넣어져요">
          <span>{project.portrait ? "세로 1080×1920" : "가로 1920×1080"}</span>
          <span>조각 {project.clips.length}개</span>
          <span>전체 {fmt(total)}</span>
        </StatusBar>
      }
    >
      <div className="video-stage">
        <div className="video-preview">
          <canvas ref={canvasRef} className={project.portrait ? "portrait" : ""} />
          {!project.clips.length && (
            <div className="video-empty">
              <p>영상이나 사진 파일을 이 창에 끌어다 놓거나</p>
              <button className="suite-button video-add" onClick={() => void openMedia()}>
                ＋ 영상·사진 넣기
              </button>
            </div>
          )}
        </div>
        <div className="video-transport">
          <button className="play" onClick={togglePlay} disabled={!total}>
            {playing ? "■ 멈춤" : "▶ 재생"}
          </button>
          <span className="video-time">
            {fmt(time)} / {fmt(total)}
          </span>
          <button className="ghost video-add" onClick={() => void openMedia()}>
            ＋ 영상·사진 넣기
          </button>
          <button className="ghost" onClick={addCaption}>
            ＋ 자막
          </button>
          <button className="ghost" onClick={split}>
            ✂ 나누기
          </button>
          <button className="export" onClick={() => void exportVideo()} disabled={!total}>
            ⬇ 영상으로 내보내기
          </button>
        </div>
        <div
          className="timeline"
          onPointerDown={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            if (total && (e.target as HTMLElement).classList.contains("timeline")) engine.current?.seek(((e.clientX - rect.left) / rect.width) * total);
          }}
        >
          <div className="track clips">
            {project.clips.map((c, i) => (
              <button
                key={c.id}
                className={`block ${c.kind}`}
                aria-pressed={c.id === selectedClip}
                style={{ left: `${clipStart(project, i) * pxPerSec}%`, width: `${clipLength(c) * pxPerSec}%` }}
                onClick={() => {
                  setSelectedClip(c.id);
                  setSelectedCaption(null);
                  engine.current?.seek(clipStart(project, i));
                }}
              >
                {c.kind === "image" ? "🖼 " : "🎬 "}
                {c.name}
              </button>
            ))}
            {!project.clips.length && <span className="track-empty">영상 조각이 여기에 이어져요</span>}
          </div>
          <div className="track captions">
            {project.captions.map((c) => (
              <button
                key={c.id}
                className="block caption"
                aria-pressed={c.id === selectedCaption}
                style={{ left: `${c.start * pxPerSec}%`, width: `${Math.max(0.5, (c.end - c.start) * pxPerSec)}%` }}
                onClick={() => {
                  setSelectedCaption(c.id);
                  setSelectedClip(null);
                  engine.current?.seek(c.start);
                }}
              >
                {c.text}
              </button>
            ))}
            {!project.captions.length && <span className="track-empty">자막</span>}
          </div>
          <div className="track music">
            {project.music ? <div className="block music" style={{ left: 0, width: "100%" }}>🎵 {project.music.name}</div> : <span className="track-empty">배경 음악</span>}
          </div>
          {total > 0 && <div className="playhead" style={{ left: `${(time / total) * 100}%` }} />}
        </div>
      </div>
      {exporting !== null && (
        <div className="dialog-dim">
          <div className="dialog export-box">
            <h2>영상을 만들고 있어요… {Math.round(exporting * 100)}%</h2>
            <p>처음부터 끝까지 재생하면서 녹화해요. 영상 길이만큼 걸려요. 창을 닫지 말아 주세요.</p>
            <div className="bar">
              <div style={{ width: `${exporting * 100}%` }} />
            </div>
          </div>
        </div>
      )}
      <Toast message={toast} />
      <Tour steps={TOUR_STEPS} open={tour.open} onFinish={tour.finish} />
    </AppFrame>
  );
}
