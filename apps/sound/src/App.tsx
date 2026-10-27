import { useCallback, useEffect, useRef, useState } from "react";
import {
  AIAssistantPanel,
  AppFrame,
  MenuBar,
  Panel,
  StatusBar,
  Toast,
  Toolbar,
  Tour,
  UpdateButton,
  isTourOpen,
  useHistory,
  useToast,
  useTour,
  useUpdater,
  type Menu,
  type ToolAction,
  type TourStep,
} from "@suite/ui";
import * as A from "./audio";
import { AI_SYSTEM, AI_TOOL, toSfx } from "./ai";
import { Waveform } from "./Waveform";

const TOUR_STEPS: TourStep[] = [
  { title: "웨이브 랩에 오신 걸 환영해요! 👋", body: "목소리를 녹음하거나 소리 파일을 열어서 자르고 붙이고, 게임 효과음도 만들 수 있어요." },
  { title: "소리 가져오기", target: ".sound-top", body: "● 녹음으로 목소리를 녹음하거나, ‘파일 → 열기’로 mp3·wav 파일을 열어요. 파일을 창에 끌어다 놓아도 돼요." },
  { title: "고르고 고치기", target: ".suite-toolbar", body: "파형 위를 끌어서 부분을 고른 뒤, 왼쪽 버튼으로 지우기, 남기기, 페이드, 메아리 같은 걸 해요. 아무것도 안 고르면 전체에 적용돼요." },
  { title: "게임 효과음 만들기", target: ".suite-side .suite-panel:nth-of-type(1)", body: "동전, 점프, 레이저 같은 버튼을 누르면 효과음이 생겨요. 막대로 높이와 길이를 바꿔 보세요." },
  { title: "AI 에게 부탁하기 ✨", target: ".suite-side .suite-panel:last-of-type", body: "“보물상자 여는 소리”처럼 쓰면 AI 가 효과음을 만들어 줘요." },
  { title: "저장하기", target: ".suite-menu:nth-of-type(1)", body: "‘WAV 로 저장’(Ctrl+S)으로 저장해요. 로블록스 스튜디오에 소리로 올릴 수 있어요. Space 로 재생/멈춤!" },
];

const AUDIO = { name: "소리 파일", extensions: ["wav", "mp3", "ogg", "m4a", "webm", "flac"] };
const baseName = (p: string) => p.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");
const fmt = (sec: number) => `${Math.floor(sec / 60)}:${(sec % 60).toFixed(2).padStart(5, "0")}`;

let audioCtx: AudioContext | null = null;
const ctx = () => (audioCtx ??= new AudioContext());

export function App() {
  const history = useHistory<A.Sound>(A.EMPTY, 30);
  const sound = history.state;
  const [selection, setSelection] = useState<A.Range | null>(null);
  const [cursor, setCursor] = useState(0);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [clipboard, setClipboard] = useState<A.Sound | null>(null);
  const [sfx, setSfx] = useState<A.SfxParams>(A.SFX_PRESETS[0].params);
  const [recording, setRecording] = useState<MediaRecorder | null>(null);
  const [aiOpen, setAiOpen] = useState(true);
  const [name, setName] = useState("제목 없음");
  const [toast, notify] = useToast(4500);
  const tour = useTour("sound");
  const updater = useUpdater(notify);
  const playing = useRef<{ source: AudioBufferSourceNode; raf: number } | null>(null);
  const n = A.lengthOf(sound);
  const range: A.Range = selection ?? { start: 0, end: n };

  useEffect(() => {
    document.title = `${history.dirty ? "● " : ""}${name} - 웨이브 랩`;
    window.suite?.window.setDirty(history.dirty);
  }, [name, history.dirty]);

  const stop = useCallback(() => {
    if (!playing.current) return;
    playing.current.source.onended = null;
    playing.current.source.stop();
    cancelAnimationFrame(playing.current.raf);
    playing.current = null;
    setPlayhead(null);
  }, []);

  /** 고른 부분을 (없으면 커서부터 끝까지) 재생 */
  const play = useCallback(
    (what?: A.Sound) => {
      stop();
      const s = what ?? history.get();
      const len = A.lengthOf(s);
      if (!len) return notify("아직 소리가 없어요. 녹음하거나 파일을 열거나, 오른쪽에서 효과음을 만들어 보세요.");
      const from = what ? 0 : selection ? selection.start : cursor >= len - 10 ? 0 : cursor;
      const to = what ? len : selection ? selection.end : len;
      const c = ctx();
      const source = c.createBufferSource();
      source.buffer = A.toAudioBuffer(c, s);
      source.connect(c.destination);
      const begin = c.currentTime;
      source.start(0, from / s.sampleRate, (to - from) / s.sampleRate);
      const tick = () => {
        if (!what) setPlayhead(from + (c.currentTime - begin) * s.sampleRate);
        playing.current!.raf = requestAnimationFrame(tick);
      };
      playing.current = { source, raf: requestAnimationFrame(tick) };
      source.onended = () => stop();
    },
    [history, selection, cursor, stop, notify],
  );

  const edit = (fn: (s: A.Sound, r: A.Range) => A.Sound, keepSelection = true) => {
    if (!n) return notify("먼저 소리를 넣어 주세요.");
    stop();
    history.set(fn(history.get(), range));
    if (!keepSelection) setSelection(null);
  };

  const loadBytes = async (bytes: ArrayBuffer, label: string) => {
    try {
      const decoded = await ctx().decodeAudioData(bytes);
      const s = A.fromAudioBuffer(decoded);
      if (!A.lengthOf(history.get())) {
        history.reset(s);
        setName(label);
      } else {
        history.set(A.insert(history.get(), cursor, s));
      }
      setSelection(null);
      notify(`‘${label}’ 을(를) 넣었어요 (${A.secondsOf(s).toFixed(1)}초).`);
    } catch {
      notify("이 소리 파일은 읽을 수 없어요. wav 나 mp3 로 해 주세요.");
    }
  };

  const open = async () => {
    if (!window.suite) return;
    const r = await window.suite.files.open({ filters: [AUDIO], binary: true });
    if (!r.ok) return r.reason === "error" && notify(`열지 못했어요. ${r.message ?? ""}`);
    const bin = atob(r.text);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    await loadBytes(bytes.buffer, baseName(r.path));
  };

  const saveWav = async () => {
    if (!window.suite) return;
    if (!n) return notify("저장할 소리가 없어요.");
    const r = await window.suite.files.save({ defaultName: `${name}.wav`, filters: [{ name: "WAV 소리", extensions: ["wav"] }], data: A.toWav(history.get()) });
    if (r.ok) {
      history.markSaved();
      setName(baseName(r.path));
      notify("WAV 로 저장했어요. 로블록스 스튜디오의 Asset Manager 에서 소리로 올릴 수 있어요.");
    } else if (r.reason === "error") notify(`저장하지 못했어요. ${r.message ?? ""}`);
  };

  const record = async () => {
    if (recording) return recording.stop();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(null);
        await loadBytes(await new Blob(chunks).arrayBuffer(), "녹음");
      };
      rec.start();
      setRecording(rec);
    } catch {
      notify("마이크를 쓸 수 없어요. 마이크가 연결되어 있는지, Windows 설정에서 마이크를 허용했는지 봐 주세요.");
    }
  };

  const newEmpty = () => {
    if (history.dirty && !window.confirm("저장하지 않은 소리가 사라져요. 계속할까요?")) return;
    stop();
    history.reset(A.EMPTY);
    setSelection(null);
    setCursor(0);
    setName("제목 없음");
  };

  /** 효과음을 커서 자리에 넣는다 (비어 있으면 새로) */
  const putSfx = (p: A.SfxParams) => {
    const s = A.synth(p, A.lengthOf(history.get()) ? history.get().sampleRate : 44100);
    stop();
    if (!A.lengthOf(history.get())) {
      history.set(s);
    } else {
      history.set(A.insert(history.get(), cursor, s));
    }
    setSelection({ start: A.lengthOf(history.get()) ? cursor : 0, end: (A.lengthOf(history.get()) ? cursor : 0) + A.lengthOf(s) });
  };

  const cut = () => {
    if (!selection) return notify("먼저 파형 위를 끌어서 자를 부분을 골라 주세요.");
    setClipboard(A.copy(sound, selection));
    edit(A.remove, false);
    setCursor(selection.start);
  };

  const actions: ToolAction[] = [
    { label: "재생", icon: "▶", hint: "고른 부분(없으면 커서부터)을 들어 봐요", shortcut: "Space", onRun: () => (playing.current ? stop() : play()) },
    { label: "지우기", icon: "✕", hint: "고른 부분을 지워요", shortcut: "Delete", onRun: () => (selection ? edit(A.remove, false) : notify("먼저 지울 부분을 끌어서 골라 주세요.")) },
    { label: "남기기", icon: "⛶", hint: "고른 부분만 남기고 나머지를 지워요", onRun: () => (selection ? (edit(A.keep, false), setCursor(0)) : notify("먼저 남길 부분을 끌어서 골라 주세요.")) },
    { label: "잘라내기", icon: "✂", hint: "고른 부분을 잘라서 기억해 둬요", shortcut: "Ctrl+X", onRun: cut },
    { label: "붙여넣기", icon: "📋", hint: "기억한 소리를 커서 자리에 넣어요", shortcut: "Ctrl+V", disabled: !clipboard, onRun: () => clipboard && history.set(A.insert(sound, cursor, clipboard)) },
    { label: "서서히 커지게", icon: "◢", hint: "고른 부분이 작게 시작해서 커져요 (페이드 인)", onRun: () => edit(A.fadeIn) },
    { label: "서서히 작게", icon: "◣", hint: "고른 부분이 점점 작아져요 (페이드 아웃)", onRun: () => edit(A.fadeOut) },
    { label: "크게", icon: "🔊", hint: "소리를 1.5배 크게", onRun: () => edit((s, r) => A.gain(s, r, 1.5)) },
    { label: "작게", icon: "🔉", hint: "소리를 반으로 작게", onRun: () => edit((s, r) => A.gain(s, r, 0.5)) },
    { label: "크기 맞추기", icon: "⇕", hint: "너무 작은 소리를 알맞게 키워요", onRun: () => edit(A.normalize) },
    { label: "메아리", icon: "〰", hint: "산에서 외친 것처럼 울려요", onRun: () => edit((s, r) => A.echo(s, r)) },
    { label: "빠르게", icon: "⏩", hint: "빠르고 높게 (다람쥐 목소리)", onRun: () => edit((s, r) => A.speed(s, r, 1.5), false) },
    { label: "느리게", icon: "⏪", hint: "느리고 낮게 (괴물 목소리)", onRun: () => edit((s, r) => A.speed(s, r, 0.7), false) },
    { label: "거꾸로", icon: "⇄", hint: "뒤에서부터 재생되게 뒤집어요", onRun: () => edit(A.reverse) },
    { label: "조용히", icon: "∅", hint: "고른 부분을 소리 없음으로", onRun: () => edit(A.silence) },
  ];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || (e.target instanceof HTMLInputElement && e.target.type !== "range") || isTourOpen()) return;
      const key = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        const map: Record<string, () => void> = {
          z: () => (e.shiftKey ? history.redo() : history.undo()),
          y: history.redo,
          s: () => void saveWav(),
          o: () => void open(),
          x: cut,
          c: () => selection && (setClipboard(A.copy(sound, selection)), notify("복사했어요. 원하는 곳을 클릭하고 Ctrl+V")),
          v: () => clipboard && history.set(A.insert(sound, cursor, clipboard)),
          a: () => setSelection({ start: 0, end: n }),
        };
        if (map[key]) {
          e.preventDefault();
          map[key]();
        }
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        playing.current ? stop() : play();
      } else if (key === "delete" || key === "backspace") selection && edit(A.remove, false);
      else if (key === "escape") setSelection(null);
      else if (key === "r") void record();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = async (e: DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer?.files[0];
      if (file) await loadBytes(await file.arrayBuffer(), file.name.replace(/\.[^.]+$/, ""));
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  });

  const onSelect = useCallback((sel: A.Range | null, c: number) => {
    setSelection(sel);
    setCursor(c);
  }, []);

  const menus: Menu[] = [
    {
      label: "파일",
      items: [
        { label: "새로 (비우기)", onSelect: newEmpty },
        { label: "열기 / 소리 넣기…", shortcut: "Ctrl+O", onSelect: () => void open() },
        { label: recording ? "녹음 멈추기" : "녹음하기", shortcut: "R", onSelect: () => void record() },
        { label: "WAV 로 저장", shortcut: "Ctrl+S", onSelect: () => void saveWav() },
      ],
    },
    {
      label: "편집",
      items: [
        { label: "실행 취소", shortcut: "Ctrl+Z", disabled: !history.canUndo, onSelect: history.undo },
        { label: "다시 실행", shortcut: "Ctrl+Y", disabled: !history.canRedo, onSelect: history.redo },
        { label: "모두 고르기", shortcut: "Ctrl+A", onSelect: () => setSelection({ start: 0, end: n }) },
        { label: "잘라내기", shortcut: "Ctrl+X", onSelect: cut },
        { label: "붙여넣기", shortcut: "Ctrl+V", disabled: !clipboard, onSelect: () => clipboard && history.set(A.insert(sound, cursor, clipboard)) },
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

  const slider = (label: string, key: keyof A.SfxParams, min: number, max: number, step: number, unit: string) => (
    <label className="prop-slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={sfx[key] as number} onChange={(e) => setSfx({ ...sfx, [key]: Number(e.target.value) })} />
      <b>
        {Math.round((sfx[key] as number) * 100) / 100}
        {unit}
      </b>
    </label>
  );

  const sec = A.secondsOf(sound);
  return (
    <AppFrame
      menubar={
        <MenuBar
          appName="웨이브 랩"
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
      toolbar={<Toolbar tools={[]} active="" onChange={() => {}} actions={{ title: selection ? "고른 부분" : "전체", items: actions }} />}
      sidebar={
        <>
          <Panel title="🎮 게임 효과음 만들기">
            <div className="sfx-presets">
              {A.SFX_PRESETS.map((p) => (
                <button
                  key={p.label}
                  className="mini"
                  onClick={() => {
                    setSfx(p.params);
                    play(A.synth(p.params));
                  }}
                >
                  {p.icon} {p.label}
                </button>
              ))}
              <button
                className="mini"
                onClick={() => {
                  const r = A.randomSfx();
                  setSfx(r);
                  play(A.synth(r));
                }}
              >
                🎲 아무거나
              </button>
            </div>
            <div className="prop-row">
              <span>소리 종류</span>
              <select value={sfx.wave} onChange={(e) => setSfx({ ...sfx, wave: e.target.value as A.SfxParams["wave"] })}>
                <option value="square">네모 (게임기)</option>
                <option value="saw">톱니 (날카로움)</option>
                <option value="triangle">세모 (맑음)</option>
                <option value="sine">둥근 (부드러움)</option>
                <option value="noise">지글지글 (폭발, 바람)</option>
              </select>
            </div>
            {slider("시작 높이", "startFreq", 40, 3000, 1, "")}
            {slider("끝 높이", "endFreq", 40, 3000, 1, "")}
            {slider("길이", "duration", 0.03, 2, 0.01, "초")}
            {slider("떨림", "vibrato", 0, 1, 0.01, "")}
            {slider("크기", "volume", 0.05, 1, 0.01, "")}
            <div className="prop-buttons">
              <button className="mini" onClick={() => play(A.synth(sfx))}>
                ▶ 들어 보기
              </button>
              <button className="mini go" onClick={() => putSfx(sfx)}>
                ＋ 넣기
              </button>
            </div>
          </Panel>
          {aiOpen && (
            <AIAssistantPanel
              app="sound"
              greeting="안녕하세요! 만들고 싶은 효과음을 말해 주세요. 예를 들어 “보물상자 여는 소리”처럼요."
              examples={["보물상자 여는 소리", "슬라임이 튀는 소리", "우주선 경보음"]}
              getContext={() => ({ current: sfx })}
              system={AI_SYSTEM}
              tool={AI_TOOL}
              onResponse={({ text, toolInput }) => {
                if (!toolInput) return text;
                const p = toSfx(toolInput as Record<string, unknown>);
                setSfx(p);
                play(A.synth(p));
                return `${(toolInput as { message?: string }).message ?? "만들었어요."}\n(마음에 들면 왼쪽 ‘＋ 넣기’를 눌러요)`;
              }}
            />
          )}
        </>
      }
      statusbar={
        <StatusBar hint="파형을 끌어서 고르기 · 클릭: 커서 놓기 · Space: 재생/멈춤 · R: 녹음 · Delete: 고른 부분 지우기">
          <span>
            {history.dirty ? "● " : ""}
            {name}
          </span>
          <span>
            {selection ? `고름 ${fmt(selection.start / sound.sampleRate)}~${fmt(selection.end / sound.sampleRate)} · ` : `커서 ${fmt(cursor / sound.sampleRate)} · `}
            전체 {fmt(sec)}
          </span>
          <span>{sound.channels.length === 2 ? "스테레오" : "모노"}</span>
        </StatusBar>
      }
    >
      <div className="sound-stage">
        <div className="sound-top">
          <button className={recording ? "rec on" : "rec"} onClick={() => void record()} title="녹음 (R)">
            {recording ? "■ 녹음 멈추기" : "● 녹음"}
          </button>
          <button className="play" onClick={() => (playing.current ? stop() : play())} title="재생 / 멈춤 (Space)">
            {playhead !== null ? "■ 멈춤" : "▶ 재생"}
          </button>
          <button className="ghost" onClick={() => void open()}>
            📂 소리 파일 열기
          </button>
          <span className="sound-time">{fmt(playhead !== null ? playhead / sound.sampleRate : (selection?.start ?? cursor) / sound.sampleRate)}</span>
        </div>
        <div className="sound-wave">
          {n ? (
            <Waveform sound={sound} selection={selection} cursor={cursor} playhead={playhead} onSelect={onSelect} />
          ) : (
            <div className="sound-empty">
              <p>아직 소리가 없어요.</p>
              <p>● 녹음을 누르거나, 소리 파일을 끌어다 놓거나, 오른쪽에서 🎮 효과음을 만들어 보세요.</p>
            </div>
          )}
        </div>
      </div>
      <Toast message={toast} />
      <Tour steps={TOUR_STEPS} open={tour.open} onFinish={tour.finish} />
    </AppFrame>
  );
}
