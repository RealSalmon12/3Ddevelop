import { useCallback, useEffect, useRef, useState } from "react";
import {
  AIAssistantPanel,
  AppFrame,
  CommandSearch,
  MenuBar,
  Panel,
  StatusBar,
  Toast,
  Tour,
  UpdateButton,
  isTourOpen,
  menuCommands,
  useHistory,
  useToast,
  useTour,
  useUpdater,
  type Menu,
  type TourStep,
} from "@suite/ui";
import * as A from "./audio";
import * as D from "./dsp";
import { buildRack, renderRack, type Fx } from "./effects";
import { AI_SYSTEM, AI_TOOL, toSfx } from "./ai";
import { RackPanel, Knob } from "./Rack";
import { Wave, clampView, timeLabel, type Marker, type View } from "./Wave";
import { MultitrackSidebar, MultitrackView, useMultitrack } from "./Multitrack";

const TOUR_STEPS: TourStep[] = [
  { title: "바코 파도에 오신 걸 환영해요! 👋", body: "목소리, 음악, 게임 효과음을 전문 오디오 편집기처럼 다듬는 곳이에요. 녹음하거나 소리 파일을 끌어다 놓아 보세요." },
  { title: "재생 막대", target: ".transport", body: "Space 로 재생/멈춤, L 로 반복 재생, R 로 커서 자리에 녹음해요. 큰 시계는 지금 위치예요." },
  { title: "파형", target: ".wave", body: "끌어서 고르고, 휠로 확대해요 (Shift+휠: 옆으로). 맨 위 띠는 전체 모습이라 끌면 보는 곳이 움직여요. Shift+D 로 스펙트럼(주파수) 보기!" },
  { title: "효과 랙", target: ".rack-panel", body: "EQ, 컴프레서, 리버브 같은 효과를 이어 걸어요. ‘들으며 고치기’를 켜면 재생하면서 바로 바뀐 소리를 들을 수 있고, 마음에 들면 ‘적용’ 해요." },
  { title: "효과 메뉴", target: ".suite-menubar", body: "‘효과’ 메뉴에 라우드니스 맞추기(로블록스·유튜브 -14 LUFS), 노이즈 줄이기, 템포·음높이 바꾸기가 있어요. F3 으로 기능을 검색할 수도 있어요." },
  { title: "내보내기", target: ".export-button", body: "WAV 16/24/32비트로 내보내요. 로블록스 스튜디오에 소리로 그대로 올릴 수 있어요." },
];

const AUDIO = { name: "소리 파일", extensions: ["wav", "mp3", "ogg", "m4a", "webm", "flac", "aac"] };
const baseName = (p: string) => p.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");

let audioCtx: AudioContext | null = null;
const ctx = () => (audioCtx ??= new AudioContext());

/* ───────── 설정 창 ───────── */

type Field =
  | { key: string; label: string; min: number; max: number; step?: number; unit?: string; log?: boolean }
  | { key: string; label: string; options: [string, string][] };

interface DialogSpec {
  title: string;
  hint?: string;
  fields: Field[];
  values: Record<string, number | string>;
  /** 길이가 바뀌는 효과는 고른 부분을 풀어 준다 */
  changesLength?: boolean;
  run: (s: A.Sound, r: A.Range, v: Record<string, number | string>) => A.Sound | Promise<A.Sound>;
}

type DialogState = { kind: "params"; spec: DialogSpec } | { kind: "export" } | null;

interface ExportOptions {
  bits: 16 | 24 | 32;
  rate: number;
  channels: "keep" | "mono" | "stereo";
  selectionOnly: boolean;
}

interface Playing {
  source: AudioBufferSourceNode;
  chain: { input: AudioNode; output: AudioNode } | null;
  post: GainNode;
  analysers: AnalyserNode[];
  spectrum: AnalyserNode;
  raf: number;
  begin: number;
  from: number;
  loop: A.Range | null;
  preview: boolean;
}

/** 오디션식 레벨 미터 (왼쪽, 오른쪽) */
function Meter({ getLevels }: { getLevels: () => number[] | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const g = canvas.getContext("2d")!;
    const hold = [-Infinity, -Infinity];
    const holdAt = [0, 0];
    const shown = [-90, -90];
    let raf = 0;
    const toX = (db: number, w: number) => Math.max(0, Math.min(1, (db + 60) / 60)) * w;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
      if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = "#0d0f16";
      g.fillRect(0, 0, w, h);
      const levels = getLevels() ?? [];
      const now = performance.now();
      const barH = (h - 14) / 2 - 2;
      for (let c = 0; c < 2; c++) {
        const db = levels[Math.min(c, levels.length - 1)] ?? -90;
        shown[c] = db > shown[c] ? db : Math.max(db, shown[c] - 1.2);
        if (db > hold[c] || now - holdAt[c] > 1500) {
          hold[c] = db;
          holdAt[c] = now;
        }
        const y = 1 + c * (barH + 2);
        const grad = g.createLinearGradient(0, 0, w, 0);
        grad.addColorStop(0, "#2fbf71");
        grad.addColorStop(0.75, "#2fbf71");
        grad.addColorStop(0.9, "#f5d442");
        grad.addColorStop(1, "#ff4d4d");
        g.fillStyle = "#1a1f2c";
        g.fillRect(0, y, w, barH);
        g.fillStyle = grad;
        g.fillRect(0, y, toX(shown[c], w), barH);
        if (Number.isFinite(hold[c]) && hold[c] > -60) {
          g.fillStyle = hold[c] > -0.1 ? "#ff4d4d" : "#e8ecf4";
          g.fillRect(toX(hold[c], w) - 1, y, 2, barH);
        }
      }
      g.fillStyle = "#7d8597";
      g.font = "10px system-ui";
      for (const db of [-60, -48, -36, -24, -18, -12, -6, -3, 0]) {
        const x = toX(db, w);
        g.fillRect(x, h - 13, 1, 3);
        g.fillText(String(db), Math.min(w - 12, Math.max(0, x - 6)), h - 1);
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [getLevels]);
  return <canvas ref={ref} className="meter" />;
}

function ParamDialog({
  spec,
  onPreview,
  onApply,
  onClose,
}: {
  spec: DialogSpec;
  onPreview: (v: Record<string, number | string>) => void;
  onApply: (v: Record<string, number | string>) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState(spec.values);
  return (
    <div className="dialog-dim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog param-dialog" role="dialog" aria-label={spec.title}>
        <h2>{spec.title}</h2>
        {spec.hint && <p className="dialog-hint">{spec.hint}</p>}
        {spec.fields.map((f) =>
          "options" in f ? (
            <label key={f.key} className="dialog-row">
              <span>{f.label}</span>
              <select value={String(values[f.key])} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}>
                {f.options.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <Knob
              key={f.key}
              label={f.label}
              value={Number(values[f.key])}
              min={f.min}
              max={f.max}
              step={f.step}
              unit={f.unit}
              log={f.log}
              onChange={(v) => setValues({ ...values, [f.key]: v })}
            />
          ),
        )}
        <div className="dialog-actions">
          <button className="suite-button ghost" onClick={() => onPreview(values)}>
            ▶ 들어 보기
          </button>
          <span className="spacer" />
          <button className="suite-button ghost" onClick={onClose}>
            취소
          </button>
          <button className="suite-button" onClick={() => onApply(values)}>
            적용
          </button>
        </div>
      </div>
    </div>
  );
}

function ExportDialog({
  sound,
  selection,
  initial,
  onExport,
  onClose,
}: {
  sound: A.Sound;
  selection: A.Range | null;
  initial: ExportOptions;
  onExport: (o: ExportOptions) => void;
  onClose: () => void;
}) {
  const [o, setO] = useState<ExportOptions>({ ...initial, selectionOnly: initial.selectionOnly && !!selection });
  const len = o.selectionOnly && selection ? selection.end - selection.start : A.lengthOf(sound);
  const chs = o.channels === "keep" ? sound.channels.length : o.channels === "mono" ? 1 : 2;
  const bytes = Math.round((len / sound.sampleRate) * o.rate) * chs * (o.bits / 8) + 44;
  return (
    <div className="dialog-dim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog export-dialog" role="dialog" aria-label="내보내기">
        <h2>WAV 로 내보내기</h2>
        <label className="dialog-row">
          <span>비트 깊이</span>
          <select value={o.bits} onChange={(e) => setO({ ...o, bits: Number(e.target.value) as 16 | 24 | 32 })}>
            <option value={16}>16비트 (보통, 로블록스·게임)</option>
            <option value={24}>24비트 (작업용, 더 정밀)</option>
            <option value={32}>32비트 실수 (잘림 없음)</option>
          </select>
        </label>
        <label className="dialog-row">
          <span>샘플 레이트</span>
          <select value={o.rate} onChange={(e) => setO({ ...o, rate: Number(e.target.value) })}>
            {[...new Set([sound.sampleRate, 22050, 44100, 48000, 96000])].sort((a, b) => a - b).map((r) => (
              <option key={r} value={r}>
                {r.toLocaleString()} Hz{r === sound.sampleRate ? " (지금 그대로)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="dialog-row">
          <span>채널</span>
          <select value={o.channels} onChange={(e) => setO({ ...o, channels: e.target.value as ExportOptions["channels"] })}>
            <option value="keep">그대로 ({sound.channels.length === 2 ? "스테레오" : "모노"})</option>
            <option value="mono">모노 (파일이 반으로 작아요)</option>
            <option value="stereo">스테레오</option>
          </select>
        </label>
        <label className="dialog-check">
          <input type="checkbox" disabled={!selection} checked={o.selectionOnly} onChange={(e) => setO({ ...o, selectionOnly: e.target.checked })} /> 고른 부분만 내보내기
        </label>
        <p className="dialog-hint">
          길이 {timeLabel(len / sound.sampleRate, true)} · 예상 크기 {(bytes / 1024 / 1024).toFixed(2)} MB
          {bytes > 20 * 1024 * 1024 ? " · 로블록스는 20MB 까지만 올라가요. 모노나 16비트로 줄여 보세요." : ""}
        </p>
        <div className="dialog-actions">
          <span className="spacer" />
          <button className="suite-button ghost" onClick={onClose}>
            취소
          </button>
          <button className="suite-button" onClick={() => onExport(o)}>
            내보내기
          </button>
        </div>
      </div>
    </div>
  );
}

let markerCount = 0;

export function App() {
  const history = useHistory<A.Sound>(A.EMPTY, 30);
  const sound = history.state;
  const n = A.lengthOf(sound);
  const [selection, setSelection] = useState<A.Range | null>(null);
  const [cursor, setCursor] = useState(0);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [view, setViewRaw] = useState<View>({ start: 0, end: 1 });
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [spectral, setSpectral] = useState(false);
  const [loop, setLoop] = useState(false);
  const [rack, setRack] = useState<Fx[]>([]);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [clipboard, setClipboard] = useState<A.Sound | null>(null);
  const [sfx, setSfx] = useState<A.SfxParams>(A.SFX_PRESETS[0].params);
  const [recording, setRecording] = useState<MediaRecorder | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [sfxOpen, setSfxOpen] = useState(false);
  const [name, setName] = useState("제목 없음");
  const [path, setPath] = useState<string | undefined>();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [exportOpts, setExportOpts] = useState<ExportOptions>({ bits: 16, rate: 44100, channels: "keep", selectionOnly: false });
  const [noiseProfile, setNoiseProfile] = useState<Float32Array | null>(null);
  const [info, setInfo] = useState<{ peakDb: number; rmsDb: number; lufs: number } | null>(null);
  const [spectrum, setSpectrum] = useState<Float32Array | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [toast, notify] = useToast(4500);
  const tour = useTour("sound");
  const updater = useUpdater(notify);
  const playing = useRef<Playing | null>(null);
  const [mode, setModeRaw] = useState<"wave" | "multi">("wave");
  const mt = useMultitrack({
    active: mode === "multi",
    ctx,
    notify,
    decode: async (bytes) => A.fromAudioBuffer(await ctx().decodeAudioData(bytes)),
    currentSound: () => ({ sound: history.get(), name }),
    openInEditor: (s, label) => {
      if (history.dirty && !window.confirm("파형 편집기에 저장하지 않은 소리가 있어요. 바꿀까요?")) return;
      stop();
      history.reset(s, true);
      setName(label);
      setPath(undefined);
      setSelection(null);
      setCursor(0);
      setMarkers([]);
      setModeRaw("wave");
      notify(`‘${label}’ 을(를) 파형 편집기에서 열었어요. 9 를 누르면 멀티트랙으로 돌아가요.`);
    },
    openSearch: () => setSearchOpen(true),
  });
  const range: A.Range = selection ?? { start: 0, end: n };
  const rate = sound.sampleRate;

  const setView = useCallback((v: View) => setViewRaw(clampView(v, A.lengthOf(history.get()))), [history]);

  // 소리 길이가 바뀌면 보는 범위를 맞춘다
  const lastLen = useRef(0);
  useEffect(() => {
    if (n === lastLen.current) return;
    const grewFromEmpty = lastLen.current === 0;
    lastLen.current = n;
    setViewRaw((v) => (grewFromEmpty || v.end - v.start >= n ? { start: 0, end: Math.max(32, n) } : clampView(v, n)));
    setSelection((s) => (s && s.end <= n ? s : null));
    setCursor((c) => Math.min(c, n));
    setInfo(null);
  }, [n]);

  useEffect(() => {
    const [label, dirty] = mode === "multi" ? [mt.name, mt.dirty] : [name, history.dirty];
    document.title = `${dirty ? "● " : ""}${label} - 바코 파도`;
    window.suite?.window.setDirty(history.dirty || mt.dirty);
  }, [name, history.dirty, mode, mt.name, mt.dirty]);

  /* ───────── 재생 ───────── */

  const stop = useCallback(() => {
    const p = playing.current;
    if (!p) return;
    p.source.onended = null;
    try {
      p.source.stop();
    } catch {
      /* 이미 멈춤 */
    }
    p.source.disconnect();
    p.post.disconnect();
    cancelAnimationFrame(p.raf);
    playing.current = null;
    setPlayhead(null);
    setSpectrum(null);
  }, []);

  const setMode = (m: "wave" | "multi") => {
    stop();
    setModeRaw(m);
  };

  const liveRef = useRef({ live, rack });
  liveRef.current = { live, rack };

  /** what 을 주면 그 소리를 처음부터 (미리 듣기), 아니면 고른 부분이나 커서부터 */
  const play = useCallback(
    (what?: A.Sound, fromSample?: number) => {
      stop();
      const s = what ?? history.get();
      const len = A.lengthOf(s);
      if (!len) return notify("아직 소리가 없어요. 녹음하거나 파일을 열거나, 효과음을 만들어 보세요.");
      const c = ctx();
      void c.resume();
      const source = c.createBufferSource();
      source.buffer = A.toAudioBuffer(c, s);
      const loopRange = !what && loop ? (selection ?? { start: 0, end: len }) : null;
      let from = what ? 0 : (fromSample ?? (selection ? selection.start : cursor >= len - 10 ? 0 : cursor));
      if (loopRange && (from < loopRange.start || from >= loopRange.end)) from = loopRange.start;
      const to = what || loopRange ? len : selection && fromSample === undefined ? selection.end : len;
      const post = c.createGain();
      const splitter = c.createChannelSplitter(2);
      const analysers = [0, 1].map(() => {
        const a = c.createAnalyser();
        a.fftSize = 2048;
        return a;
      });
      const spectrumNode = c.createAnalyser();
      spectrumNode.fftSize = 4096;
      spectrumNode.smoothingTimeConstant = 0.8;
      post.connect(c.destination);
      post.connect(splitter);
      post.connect(spectrumNode);
      splitter.connect(analysers[0], 0);
      splitter.connect(analysers[1], 1);
      let chain: Playing["chain"] = null;
      if (!what && liveRef.current.live && liveRef.current.rack.length) {
        chain = buildRack(c, liveRef.current.rack);
        source.connect(chain.input);
        chain.output.connect(post);
      } else source.connect(post);
      if (loopRange) {
        source.loop = true;
        source.loopStart = loopRange.start / s.sampleRate;
        source.loopEnd = loopRange.end / s.sampleRate;
        source.start(0, from / s.sampleRate);
      } else source.start(0, from / s.sampleRate, (to - from) / s.sampleRate);
      const begin = c.currentTime;
      let frame = 0;
      const tick = () => {
        const p = playing.current;
        if (!p) return;
        if (!p.preview) {
          let pos = p.from + (c.currentTime - p.begin) * s.sampleRate;
          if (p.loop && pos >= p.loop.end) pos = p.loop.start + ((pos - p.loop.start) % Math.max(1, p.loop.end - p.loop.start));
          setPlayhead(pos);
        }
        if (++frame % 3 === 0) {
          const bins = new Float32Array(p.spectrum.frequencyBinCount);
          p.spectrum.getFloatFrequencyData(bins);
          // EQ 그림처럼 20Hz~20kHz 로그 눈금으로 다시 뽑는다
          const out = new Float32Array(120);
          for (let i = 0; i < out.length; i++) {
            const f = 20 * Math.pow(1000, i / (out.length - 1));
            out[i] = bins[Math.min(bins.length - 1, Math.round((f / (c.sampleRate / 2)) * bins.length))];
          }
          setSpectrum(out);
        }
        p.raf = requestAnimationFrame(tick);
      };
      playing.current = { source, chain, post, analysers, spectrum: spectrumNode, raf: requestAnimationFrame(tick), begin, from, loop: loopRange, preview: !!what };
      source.onended = () => {
        if (!what && !loopRange) setCursor((cur) => cur);
        stop();
      };
    },
    [history, selection, cursor, loop, stop, notify],
  );

  // 들으며 고치기: 재생 중에 랙이 바뀌면 연결만 새로 한다
  useEffect(() => {
    const p = playing.current;
    if (!p || p.preview) return;
    const c = ctx();
    p.source.disconnect();
    p.chain?.output.disconnect();
    p.chain = null;
    if (live && rack.length) {
      p.chain = buildRack(c, rack);
      p.source.connect(p.chain.input);
      p.chain.output.connect(p.post);
    } else p.source.connect(p.post);
  }, [rack, live]);

  const getLevels = useCallback(() => {
    const p = playing.current;
    if (!p) return null;
    const buf = new Float32Array(p.analysers[0].fftSize);
    return p.analysers.map((a) => {
      a.getFloatTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v));
      return D.gainToDb(peak);
    });
  }, []);

  /* ───────── 편집 ───────── */

  const edit = (fn: (s: A.Sound, r: A.Range) => A.Sound, keepSelection = true) => {
    if (!n) return notify("먼저 소리를 넣어 주세요.");
    stop();
    history.set(fn(history.get(), range));
    if (!keepSelection) setSelection(null);
  };

  const params = (spec: DialogSpec) => {
    if (!n) return notify("먼저 소리를 넣어 주세요.");
    setDialog({ kind: "params", spec });
  };

  const previewSpec = async (spec: DialogSpec, v: Record<string, number | string>) => {
    const s = history.get();
    const r = selection ?? { start: 0, end: A.lengthOf(s) };
    // 너무 길면 앞 10초만 들어 본다
    const part = A.keep(s, { start: r.start, end: Math.min(r.end, r.start + s.sampleRate * 10) });
    play(await spec.run(part, { start: 0, end: A.lengthOf(part) }, v));
  };

  const applySpec = async (spec: DialogSpec, v: Record<string, number | string>) => {
    stop();
    setBusy(true);
    try {
      const before = history.get();
      const out = await spec.run(before, range, v);
      history.set(out);
      if (spec.changesLength && selection) {
        const diff = A.lengthOf(out) - A.lengthOf(before);
        setSelection({ start: selection.start, end: Math.max(selection.start + 1, selection.end + diff) });
      }
      setDialog(null);
    } finally {
      setBusy(false);
    }
  };

  const applyRack = async () => {
    if (!n) return notify("먼저 소리를 넣어 주세요.");
    stop();
    setBusy(true);
    try {
      history.set(await renderRack(history.get(), range, rack));
      setLive(false);
      notify(`효과 ${rack.filter((f) => f.on).length}개를 ${selection ? "고른 부분" : "전체"}에 적용했어요. ‘들으며 고치기’는 껐어요.`);
    } catch (e) {
      notify(`적용하지 못했어요. ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const loadBytes = async (bytes: ArrayBuffer, label: string, filePath?: string) => {
    try {
      const decoded = await ctx().decodeAudioData(bytes);
      const s = A.fromAudioBuffer(decoded);
      stop();
      if (!A.lengthOf(history.get())) {
        history.reset(s);
        setName(label);
        setPath(filePath && /\.wav$/i.test(filePath) ? filePath : undefined);
        setMarkers([]);
        setExportOpts((o) => ({ ...o, rate: s.sampleRate }));
      } else {
        const cur = history.get();
        history.set(D.insertAt(cur, cursor, s.sampleRate === cur.sampleRate ? s : A.resample(s, cur.sampleRate)));
        setSelection({ start: cursor, end: cursor + Math.round((A.lengthOf(s) * cur.sampleRate) / s.sampleRate) });
      }
      notify(`‘${label}’ 을(를) 넣었어요 (${A.secondsOf(s).toFixed(1)}초, ${s.sampleRate}Hz, ${s.channels.length === 2 ? "스테레오" : "모노"}).`);
    } catch {
      notify("이 소리 파일은 읽을 수 없어요. wav, mp3, ogg 로 해 주세요.");
    }
  };

  const open = async (asNew: boolean) => {
    if (!window.suite) return;
    if (asNew && history.dirty && !window.confirm("저장하지 않은 소리가 사라져요. 계속할까요?")) return;
    const r = await window.suite.files.open({ filters: [AUDIO], binary: true });
    if (!r.ok) return r.reason === "error" && notify(`열지 못했어요. ${r.message ?? ""}`);
    const bin = atob(r.text);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (asNew) {
      history.reset(A.EMPTY);
      setSelection(null);
      setCursor(0);
    }
    await loadBytes(bytes.buffer, baseName(r.path), r.path);
  };

  const render = (o: ExportOptions) => {
    let s = history.get();
    if (o.selectionOnly && selection) s = A.keep(s, selection);
    if (o.channels === "mono" && s.channels.length > 1) s = D.toMono(s);
    if (o.channels === "stereo" && s.channels.length === 1) s = D.toStereo(s);
    if (o.rate !== s.sampleRate) s = A.resample(s, o.rate);
    return D.encodeWav(s, o.bits);
  };

  const exportWav = async (o: ExportOptions, saveAs: boolean) => {
    if (!window.suite) return;
    if (!n) return notify("저장할 소리가 없어요.");
    setDialog(null);
    setExportOpts(o);
    const r = await window.suite.files.save({
      path: saveAs || o.selectionOnly ? undefined : path,
      defaultName: `${name}${o.selectionOnly ? " (부분)" : ""}.wav`,
      filters: [{ name: "WAV 소리", extensions: ["wav"] }],
      data: render(o),
    });
    if (r.ok) {
      if (!o.selectionOnly) {
        history.markSaved();
        setName(baseName(r.path));
        setPath(r.path);
      }
      notify(`저장했어요 (${o.bits}비트, ${o.rate}Hz). 로블록스 스튜디오의 Asset Manager 에서 소리로 올릴 수 있어요.`);
    } else if (r.reason === "error") notify(`저장하지 못했어요. ${r.message ?? ""}`);
  };

  const record = async () => {
    if (recording) return recording.stop();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(null);
        await loadBytes(await new Blob(chunks).arrayBuffer(), "녹음");
      };
      stop();
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
    setMarkers([]);
    setName("제목 없음");
    setPath(undefined);
  };

  /** 소리 조각을 커서 자리에 넣는다 (비어 있으면 새로) */
  const insertClip = (clip: A.Sound, mix = false) => {
    stop();
    const cur = history.get();
    if (!A.lengthOf(cur)) {
      history.set(clip);
      setSelection({ start: 0, end: A.lengthOf(clip) });
      return;
    }
    const c = clip.sampleRate === cur.sampleRate ? clip : A.resample(clip, cur.sampleRate);
    history.set(mix ? D.mixAt(cur, cursor, c) : D.insertAt(cur, cursor, c));
    setSelection({ start: cursor, end: cursor + A.lengthOf(c) });
  };

  const copySel = () => {
    if (!selection) return notify("먼저 파형 위를 끌어서 고를 부분을 정해 주세요.");
    setClipboard(A.copy(sound, selection));
    notify("복사했어요. 넣을 곳을 클릭하고 Ctrl+V (섞어 넣기: Ctrl+Shift+V)");
  };
  const cut = () => {
    if (!selection) return notify("먼저 파형 위를 끌어서 자를 부분을 골라 주세요.");
    setClipboard(A.copy(sound, selection));
    edit(A.remove, false);
    setCursor(selection.start);
  };
  const paste = (mix: boolean) => (clipboard ? insertClip(clipboard, mix) : notify("먼저 복사하거나 잘라 주세요."));
  const del = () => (selection ? (edit(A.remove, false), setCursor(selection.start)) : notify("먼저 지울 부분을 끌어서 골라 주세요."));
  const crop = () => (selection ? (edit(A.keep, false), setCursor(0)) : notify("먼저 남길 부분을 끌어서 골라 주세요."));

  /* ───────── 보기, 마커 ───────── */

  const zoom = (k: number) => {
    const mid = playhead ?? (selection ? (selection.start + selection.end) / 2 : (view.start + view.end) / 2);
    const span = (view.end - view.start) * k;
    setView({ start: mid - span / 2, end: mid + span / 2 });
  };
  const zoomFit = () => setView({ start: 0, end: n });
  const zoomSel = () => selection && setView({ start: selection.start - (selection.end - selection.start) * 0.05, end: selection.end + (selection.end - selection.start) * 0.05 });

  const addMarker = () => {
    if (!n) return;
    const at = Math.round(playhead ?? cursor);
    setMarkers((m) => [...m, { id: `m${++markerCount}`, at, label: `마커 ${m.length + 1}` }].sort((a, b) => a.at - b.at));
  };
  const jumpMarker = (dir: 1 | -1) => {
    const pos = playhead ?? cursor;
    const list = dir > 0 ? markers.filter((m) => m.at > pos + 1) : markers.filter((m) => m.at < pos - 1).reverse();
    const m = list[0];
    if (!m) return;
    setCursor(m.at);
    setSelection(null);
    if (m.at < view.start || m.at > view.end) setView({ start: m.at - (view.end - view.start) / 2, end: m.at + (view.end - view.start) / 2 });
  };
  const selectBetweenMarkers = () => {
    const pos = cursor;
    const before = [0, ...markers.map((m) => m.at)].filter((a) => a <= pos).pop() ?? 0;
    const after = [...markers.map((m) => m.at), n].find((a) => a > pos) ?? n;
    setSelection({ start: before, end: after });
  };

  const onSelect = useCallback(
    (sel: A.Range | null, c: number) => {
      setSelection(sel);
      setCursor(c);
      if (playing.current && !playing.current.preview && !sel) {
        // 재생 중 클릭: 그 자리부터 이어서
        play(undefined, c);
      }
    },
    [play],
  );
  const onMarkerMove = useCallback((id: string, at: number, done: boolean) => {
    setMarkers((m) => {
      const next = m.map((x) => (x.id === id ? { ...x, at } : x));
      return done ? next.sort((a, b) => a.at - b.at) : next;
    });
  }, []);

  /* ───────── 효과 목록 ───────── */

  const FX = {
    amplify: (): DialogSpec => ({
      title: "볼륨 바꾸기",
      hint: "고른 부분(없으면 전체)을 dB 만큼 키우거나 줄여요. +6dB 는 약 두 배예요.",
      fields: [{ key: "db", label: "바꿀 크기", min: -30, max: 30, step: 0.5, unit: "dB" }],
      values: { db: 3 },
      run: (s, r, v) => D.amplify(s, r, Number(v.db)),
    }),
    normalize: (): DialogSpec => ({
      title: "노멀라이즈 (최대 크기 맞추기)",
      hint: "가장 큰 소리가 정한 크기에 딱 닿도록 전체를 키우거나 줄여요.",
      fields: [{ key: "db", label: "최대 크기", min: -20, max: 0, step: 0.1, unit: "dBFS" }],
      values: { db: -1 },
      run: (s, r, v) => D.normalizePeak(s, r, Number(v.db)),
    }),
    loudness: (): DialogSpec => ({
      title: "라우드니스 맞추기 (LUFS)",
      hint: "사람 귀에 들리는 크기를 맞춰요. 여러 소리의 크기를 고르게 할 때 좋아요. 맞춘 뒤 -1dB 리미터로 찢어짐을 막아요.",
      fields: [
        {
          key: "target",
          label: "목표",
          options: [
            ["-14", "-14 LUFS (유튜브, 로블록스, 스트리밍)"],
            ["-16", "-16 LUFS (팟캐스트, 목소리)"],
            ["-18", "-18 LUFS (게임 효과음 여유)"],
            ["-23", "-23 LUFS (TV 방송)"],
          ],
        },
      ],
      values: { target: "-14" },
      run: (s, r, v) => D.matchLoudness(s, r, Number(v.target)),
    }),
    fade: (dir: "in" | "out"): DialogSpec => ({
      title: dir === "in" ? "페이드 인 (서서히 커지게)" : "페이드 아웃 (서서히 작아지게)",
      hint: "고른 부분 전체에 걸쳐 크기가 바뀌어요.",
      fields: [
        {
          key: "curve",
          label: "곡선",
          options: [
            ["linear", "직선"],
            ["log", "로그 (빠르게 시작)"],
            ["exp", "지수 (천천히 시작)"],
            ["s", "S자 (부드럽게)"],
          ],
        },
      ],
      values: { curve: "s" },
      run: (s, r, v) => D.fade(s, r, dir, v.curve as D.FadeCurve),
    }),
    limit: (): DialogSpec => ({
      title: "하드 리미터",
      hint: "정한 크기를 절대 넘지 않게 큰 소리를 눌러요. 내보내기 전에 걸면 찢어지는 소리를 막아요.",
      fields: [
        { key: "pre", label: "먼저 키우기", min: 0, max: 18, step: 0.5, unit: "dB" },
        { key: "ceiling", label: "천장", min: -12, max: 0, step: 0.1, unit: "dB" },
      ],
      values: { pre: 0, ceiling: -1 },
      run: (s, r, v) => D.limit(D.amplify(s, r, Number(v.pre)), r, Number(v.ceiling)),
    }),
    gate: (): DialogSpec => ({
      title: "노이즈 게이트",
      hint: "말하지 않을 때의 작은 잡음(숨소리, 방 소리)을 줄여요.",
      fields: [
        { key: "threshold", label: "문턱", min: -80, max: -10, unit: "dB" },
        { key: "reduce", label: "줄이는 양", min: -80, max: 0, unit: "dB" },
        { key: "hold", label: "유지", min: 5, max: 500, unit: "ms" },
      ],
      values: { threshold: -45, reduce: -40, hold: 60 },
      run: (s, r, v) => D.gate(s, r, Number(v.threshold), Number(v.reduce), Number(v.hold)),
    }),
    reduceNoise: (): DialogSpec => ({
      title: "노이즈 줄이기",
      hint: "잡아 둔 노이즈 지문(웅~, 쉬~ 하는 바탕 소리)을 고른 부분에서 빼요. 너무 세게 하면 물속 같은 소리가 나요.",
      fields: [
        { key: "amount", label: "줄이는 양", min: 0, max: 100, unit: "%" },
        { key: "sensitivity", label: "민감도", min: 1, max: 4, step: 0.1 },
      ],
      values: { amount: 80, sensitivity: 1.5 },
      run: (s, r, v) => D.reduceNoise(s, r, noiseProfile!, Number(v.amount) / 100, Number(v.sensitivity)),
    }),
    tempo: (): DialogSpec => ({
      title: "템포 바꾸기 (음높이 그대로)",
      hint: "말이나 음악을 빠르게, 느리게 해요. 목소리 높이는 그대로예요.",
      fields: [{ key: "rate", label: "빠르기", min: 50, max: 200, unit: "%" }],
      values: { rate: 120 },
      changesLength: true,
      run: (s, r, v) => D.changeTempo(s, r, Number(v.rate) / 100),
    }),
    pitch: (): DialogSpec => ({
      title: "음높이 바꾸기 (길이 그대로)",
      hint: "반음 단위로 높이를 바꿔요. +12 는 한 옥타브 위 (다람쥐), -12 는 아래 (괴물).",
      fields: [{ key: "semi", label: "반음", min: -12, max: 12, step: 0.5 }],
      values: { semi: 4 },
      run: (s, r, v) => D.changePitch(s, r, Number(v.semi)),
    }),
    silence: (): DialogSpec => ({
      title: "무음 넣기",
      hint: "커서 자리에 조용한 부분을 끼워 넣어요.",
      fields: [{ key: "sec", label: "길이", min: 0.05, max: 30, step: 0.05, unit: "초" }],
      values: { sec: 1 },
      changesLength: true,
      run: (s, _r, v) => D.insertAt(s, cursor, { sampleRate: s.sampleRate, channels: s.channels.map(() => new Float32Array(Math.round(Number(v.sec) * s.sampleRate))) }),
    }),
  };

  const generate = (kind: "tone" | "noise") => {
    const sr = n ? rate : 44100;
    const chs = n ? sound.channels.length : 1;
    const spec: DialogSpec =
      kind === "tone"
        ? {
            title: "톤 만들기",
            hint: "삐~ 소리, 신호음, 테스트 음을 커서 자리에 넣어요.",
            fields: [
              { key: "freq", label: "높이", min: 20, max: 20000, log: true, unit: "Hz" },
              { key: "wave", label: "모양", options: [["sine", "사인 (깨끗함)"], ["square", "네모"], ["saw", "톱니"], ["triangle", "세모"]] },
              { key: "sec", label: "길이", min: 0.05, max: 30, step: 0.05, unit: "초" },
              { key: "db", label: "크기", min: -40, max: 0, unit: "dB" },
            ],
            values: { freq: 440, wave: "sine", sec: 1, db: -12 },
            run: (s, _r, v) => D.tone(sr, chs, Number(v.sec), Number(v.freq), v.wave as "sine", Number(v.db)),
          }
        : {
            title: "잡음 만들기",
            hint: "바람, 파도, 비, 라디오 잡음 같은 바탕 소리를 만들어요.",
            fields: [
              { key: "color", label: "종류", options: [["white", "화이트 (쉬~ 날카로움)"], ["pink", "핑크 (비, 폭포)"], ["brown", "브라운 (바람, 파도)"]] },
              { key: "sec", label: "길이", min: 0.05, max: 60, step: 0.05, unit: "초" },
              { key: "db", label: "크기", min: -40, max: 0, unit: "dB" },
            ],
            values: { color: "pink", sec: 2, db: -18 },
            run: (s, _r, v) => D.noise(sr, chs, Number(v.sec), v.color as D.NoiseColor, Number(v.db)),
          };
    // 생성은 ‘만든 소리’ 를 미리 듣고, 적용하면 커서 자리에 넣는다
    setDialog({
      kind: "params",
      spec: {
        ...spec,
        changesLength: true,
        run: async (s, r, v) => {
          const clip = await spec.run(s, r, v);
          // 미리 듣기 때는 s 가 잘라 낸 조각이라 그냥 만든 소리를 돌려준다
          return s === history.get() ? (A.lengthOf(s) ? D.insertAt(s, cursor, clip) : clip) : clip;
        },
      },
    });
  };

  const captureNoise = () => {
    if (!selection) return notify("잡음만 있는 부분(말하기 전 조용한 곳)을 0.5초 이상 골라 주세요.");
    setNoiseProfile(D.noiseProfile(sound, selection));
    notify("노이즈 지문을 잡았어요. 이제 줄일 부분을 고르고(없으면 전체) ‘노이즈 줄이기’를 하세요.");
  };

  const analyze = () => {
    if (!n) return;
    setInfo(D.stats(sound, range));
  };

  /* ───────── 단축키 ───────── */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || (e.target instanceof HTMLInputElement && e.target.type !== "range" && e.target.type !== "checkbox") || isTourOpen()) return;
      if (dialog) {
        if (e.key === "Escape") setDialog(null);
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "8" || e.key === "9")) return setMode(e.key === "8" ? "wave" : "multi");
      if (mode === "multi") return;
      const key = e.key.toLowerCase();
      if (e.key === "F3") {
        e.preventDefault();
        return setSearchOpen(true);
      }
      if (e.ctrlKey || e.metaKey) {
        const map: Record<string, () => void> = {
          z: () => (e.shiftKey ? history.redo() : history.undo()),
          y: history.redo,
          s: () => (e.shiftKey ? setDialog({ kind: "export" }) : void exportWav(exportOpts, false)),
          o: () => void open(!e.shiftKey),
          n: newEmpty,
          x: cut,
          c: copySel,
          v: () => paste(e.shiftKey),
          a: () => setSelection({ start: 0, end: n }),
          t: crop,
          l: () => params(FX.loudness()),
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
      } else if (key === "delete" || key === "backspace") del();
      else if (key === "escape") setSelection(null);
      else if (key === "r") void record();
      else if (key === "l") setLoop((v) => !v);
      else if (key === "m") addMarker();
      else if (key === "d" && e.shiftKey) setSpectral((v) => !v);
      else if (key === "=" || key === "+") zoom(0.5);
      else if (key === "-") zoom(2);
      else if (key === "\\") zoomFit();
      else if (key === "home") (setCursor(0), setSelection(null), setView({ start: 0, end: view.end - view.start }));
      else if (key === "end") (setCursor(n), setSelection(null));
      else if (key === "arrowright" && e.altKey) jumpMarker(1);
      else if (key === "arrowleft" && e.altKey) jumpMarker(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = async (e: DragEvent) => {
      e.preventDefault();
      if (mode === "multi") return;
      const file = e.dataTransfer?.files[0];
      if (file) await loadBytes(await file.arrayBuffer(), file.name.replace(/\.[^.]+$/, ""), window.suite?.files.pathOf(file));
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  });

  const menus: Menu[] = [
    {
      label: "파일",
      items: [
        { label: "새로 만들기", shortcut: "Ctrl+N", onSelect: newEmpty },
        { label: "열기…", shortcut: "Ctrl+O", onSelect: () => void open(true) },
        { label: "커서 자리에 파일 넣기…", shortcut: "Ctrl+Shift+O", onSelect: () => void open(false) },
        { label: recording ? "녹음 멈추기" : "커서 자리에 녹음", shortcut: "R", onSelect: () => void record() },
        { label: "저장 (WAV)", shortcut: "Ctrl+S", onSelect: () => void exportWav(exportOpts, false) },
        { label: "내보내기 설정…", shortcut: "Ctrl+Shift+S", onSelect: () => setDialog({ kind: "export" }) },
      ],
    },
    {
      label: "편집",
      items: [
        { label: "실행 취소", shortcut: "Ctrl+Z", disabled: !history.canUndo, onSelect: history.undo },
        { label: "다시 실행", shortcut: "Ctrl+Y", disabled: !history.canRedo, onSelect: history.redo },
        { label: "잘라내기", shortcut: "Ctrl+X", onSelect: cut },
        { label: "복사", shortcut: "Ctrl+C", onSelect: copySel },
        { label: "붙여넣기 (끼워 넣기)", shortcut: "Ctrl+V", disabled: !clipboard, onSelect: () => paste(false) },
        { label: "섞어 붙여넣기 (겹치기)", shortcut: "Ctrl+Shift+V", disabled: !clipboard, onSelect: () => paste(true) },
        { label: "지우기", shortcut: "Delete", onSelect: del },
        { label: "고른 부분만 남기기", shortcut: "Ctrl+T", onSelect: crop },
        { label: "모두 고르기", shortcut: "Ctrl+A", onSelect: () => setSelection({ start: 0, end: n }) },
        { label: "마커 사이 고르기", onSelect: selectBetweenMarkers },
        { label: "고르기 풀기", shortcut: "Esc", onSelect: () => setSelection(null) },
      ],
    },
    {
      label: "효과",
      items: [
        { label: "볼륨 바꾸기…", onSelect: () => params(FX.amplify()) },
        { label: "노멀라이즈…", onSelect: () => params(FX.normalize()) },
        { label: "라우드니스 맞추기 (LUFS)…", shortcut: "Ctrl+L", onSelect: () => params(FX.loudness()) },
        { label: "하드 리미터…", onSelect: () => params(FX.limit()) },
        { label: "페이드 인…", onSelect: () => params(FX.fade("in")) },
        { label: "페이드 아웃…", onSelect: () => params(FX.fade("out")) },
        { label: "템포 바꾸기…", onSelect: () => params(FX.tempo()) },
        { label: "음높이 바꾸기…", onSelect: () => params(FX.pitch()) },
        { label: "거꾸로", onSelect: () => edit(A.reverse) },
        { label: "위상 뒤집기", onSelect: () => edit(D.invert) },
        { label: "DC 오프셋 없애기", onSelect: () => edit(D.removeDc) },
        { label: "조용하게 (무음으로)", onSelect: () => edit(A.silence) },
        { label: "앞뒤 무음 자르기", onSelect: () => edit((s) => D.trimSilence(s), false) },
        { label: "효과 랙 적용", disabled: !rack.length, onSelect: () => void applyRack() },
      ],
    },
    {
      label: "노이즈",
      items: [
        { label: "노이즈 지문 잡기 (고른 부분)", shortcut: "Shift+P", onSelect: captureNoise },
        { label: "노이즈 줄이기…", disabled: !noiseProfile, onSelect: () => params(FX.reduceNoise()) },
        { label: "노이즈 게이트…", onSelect: () => params(FX.gate()) },
      ],
    },
    {
      label: "생성",
      items: [
        { label: "무음…", onSelect: () => (n ? params(FX.silence()) : notify("빈 곳에는 톤이나 잡음을 먼저 만들어 보세요.")) },
        { label: "톤…", onSelect: () => generate("tone") },
        { label: "잡음…", onSelect: () => generate("noise") },
        { label: sfxOpen ? "게임 효과음 패널 닫기" : "게임 효과음 만들기", onSelect: () => setSfxOpen(!sfxOpen) },
      ],
    },
    {
      label: "채널",
      items: [
        { label: "모노로 바꾸기", disabled: sound.channels.length < 2, onSelect: () => (stop(), history.set(D.toMono(history.get()))) },
        { label: "스테레오로 바꾸기", disabled: sound.channels.length > 1 || !n, onSelect: () => (stop(), history.set(D.toStereo(history.get()))) },
        { label: "왼쪽 오른쪽 바꾸기", disabled: sound.channels.length < 2, onSelect: () => (stop(), history.set(D.swapChannels(history.get()))) },
      ],
    },
    {
      label: "보기",
      items: [
        { label: "확대", shortcut: "=", onSelect: () => zoom(0.5) },
        { label: "축소", shortcut: "-", onSelect: () => zoom(2) },
        { label: "전체 보기", shortcut: "\\", onSelect: zoomFit },
        { label: "고른 부분 크게 보기", disabled: !selection, onSelect: zoomSel },
        { label: spectral ? "파형 보기" : "스펙트럼 보기", shortcut: "Shift+D", onSelect: () => setSpectral(!spectral) },
        { label: loop ? "반복 재생 끄기" : "반복 재생 켜기", shortcut: "L", onSelect: () => setLoop(!loop) },
        { label: "마커 넣기", shortcut: "M", onSelect: addMarker },
        { label: "다음 마커로", shortcut: "Alt+→", onSelect: () => jumpMarker(1) },
        { label: "이전 마커로", shortcut: "Alt+←", onSelect: () => jumpMarker(-1) },
      ],
    },
    {
      label: "도움말",
      items: [
        { label: "기능 검색", shortcut: "F3", onSelect: () => setSearchOpen(true) },
        { label: "따라하기 안내 다시 보기", onSelect: tour.start },
        { label: "업데이트 확인", onSelect: () => void updater.check(true) },
      ],
    },
  ];

  const modeItem = mode === "wave" ? { label: "멀티트랙 화면으로", shortcut: "9", onSelect: () => setMode("multi") } : { label: "파형 편집 화면으로", shortcut: "8", onSelect: () => setMode("wave") };
  const activeHistory = mode === "multi" ? mt.history : history;
  const shownMenus: Menu[] = (mode === "wave" ? menus : [...mt.menus, menus[menus.length - 1]]).map((m) => (m.label === "보기" ? { ...m, items: [modeItem, ...m.items] } : m));

  // Shift+P 는 메뉴 단축키라서 따로 받는다
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (mode === "wave" && e.shiftKey && !e.ctrlKey && e.key.toLowerCase() === "p" && !(e.target instanceof HTMLInputElement) && !dialog) captureNoise();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const sfxSlider = (label: string, key: keyof A.SfxParams, min: number, max: number, step: number, unit: string) => (
    <Knob label={label} value={sfx[key] as number} min={min} max={max} step={step} unit={unit} onChange={(v) => setSfx({ ...sfx, [key]: v })} />
  );

  const pos = playhead ?? (selection?.start ?? cursor);
  const fmtDb = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : "-∞");

  return (
    <AppFrame
      menubar={
        <MenuBar
          appName="바코 파도"
          menus={shownMenus}
          actions={
            <>
              <div className="mode-switch" role="tablist">
                <button role="tab" aria-selected={mode === "wave"} title="파형 편집 (8)" onClick={() => setMode("wave")}>
                  〰 파형
                </button>
                <button role="tab" aria-selected={mode === "multi"} title="멀티트랙 (9)" onClick={() => setMode("multi")}>
                  ▤ 멀티트랙
                </button>
              </div>
              <button className="suite-menubar-action history-button" disabled={!activeHistory.canUndo} title="실행 취소 (Ctrl+Z)" onClick={activeHistory.undo}>
                ↶
              </button>
              <button className="suite-menubar-action history-button" disabled={!activeHistory.canRedo} title="다시 실행 (Ctrl+Y)" onClick={activeHistory.redo}>
                ↷
              </button>
              <UpdateButton updater={updater} hasUnsavedWork={history.dirty || mt.dirty} />
              <button className="suite-menubar-action export-button" onClick={() => (mode === "multi" ? void mt.exportMix() : n ? setDialog({ kind: "export" }) : notify("저장할 소리가 없어요."))}>
                ⬆ 내보내기
              </button>
              <button className="suite-menubar-action ai" aria-pressed={aiOpen} onClick={() => setAiOpen(!aiOpen)}>
                ✨ AI 도우미
              </button>
            </>
          }
        />
      }
      sidebar={
        mode === "multi" ? (
          <MultitrackSidebar mt={mt} />
        ) : (
          <>
            <RackPanel rack={rack} setRack={setRack} live={live} setLive={setLive} onApply={() => void applyRack()} busy={busy} spectrum={spectrum} />
            <Panel title="📍 마커" className="marker-panel">
              {markers.length ? (
                <ul className="marker-list">
                  {markers.map((m) => (
                    <li key={m.id}>
                      <button
                        className="marker-go"
                        title="여기로 가기"
                        onClick={() => {
                          setCursor(m.at);
                          setSelection(null);
                        }}
                      >
                        {timeLabel(m.at / rate, true)}
                      </button>
                      <input value={m.label} onChange={(e) => setMarkers(markers.map((x) => (x.id === m.id ? { ...x, label: e.target.value } : x)))} />
                      <button className="rack-x" title="지우기" onClick={() => setMarkers(markers.filter((x) => x.id !== m.id))}>
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="panel-empty">M 을 누르면 커서 자리에 마커가 생겨요. 노래의 후렴, 대사 시작처럼 표시해 두세요.</p>
              )}
            </Panel>
            <Panel title="📊 분석" className="info-panel">
              <div className="info-grid">
                <span>범위</span>
                <b>{selection ? "고른 부분" : "전체"}</b>
                <span>최대 (Peak)</span>
                <b>{info ? `${fmtDb(info.peakDb)} dB` : "–"}</b>
                <span>평균 (RMS)</span>
                <b>{info ? `${fmtDb(info.rmsDb)} dB` : "–"}</b>
                <span>라우드니스</span>
                <b className={info && info.lufs > -9 ? "warn" : ""}>{info ? `${fmtDb(info.lufs)} LUFS` : "–"}</b>
              </div>
              <div className="prop-buttons">
                <button className="mini" onClick={analyze} disabled={!n}>
                  측정하기
                </button>
                <button className="mini" onClick={() => params(FX.loudness())} disabled={!n}>
                  -14 LUFS 로 맞추기…
                </button>
              </div>
            </Panel>
            {sfxOpen && (
              <Panel title="🎮 게임 효과음 만들기" className="sfx-panel">
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
                <label className="dialog-row">
                  <span>소리 종류</span>
                  <select value={sfx.wave} onChange={(e) => setSfx({ ...sfx, wave: e.target.value as A.SfxParams["wave"] })}>
                    <option value="square">네모 (게임기)</option>
                    <option value="saw">톱니 (날카로움)</option>
                    <option value="triangle">세모 (맑음)</option>
                    <option value="sine">둥근 (부드러움)</option>
                    <option value="noise">지글지글 (폭발, 바람)</option>
                  </select>
                </label>
                {sfxSlider("시작 높이", "startFreq", 40, 3000, 1, "Hz")}
                {sfxSlider("끝 높이", "endFreq", 40, 3000, 1, "Hz")}
                {sfxSlider("길이", "duration", 0.03, 2, 0.01, "초")}
                {sfxSlider("떨림", "vibrato", 0, 1, 0.01, "")}
                {sfxSlider("크기", "volume", 0.05, 1, 0.01, "")}
                <div className="prop-buttons">
                  <button className="mini" onClick={() => play(A.synth(sfx))}>
                    ▶ 들어 보기
                  </button>
                  <button className="mini go" onClick={() => insertClip(A.synth(sfx, n ? rate : 44100))}>
                    ＋ 커서 자리에 넣기
                  </button>
                </div>
              </Panel>
            )}
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
                  setSfxOpen(true);
                  play(A.synth(p));
                  return `${(toolInput as { message?: string }).message ?? "만들었어요."}\n(마음에 들면 ‘게임 효과음’ 패널의 ‘＋ 커서 자리에 넣기’를 눌러요)`;
                }}
              />
            )}
          </>
        )
      }
      statusbar={
        <StatusBar
          hint={
            mode === "multi"
              ? "조각 끌기: 옮기기 · 가장자리: 다듬기 · 위 모서리 네모: 페이드 · Ctrl+K: 자르기 · Space: 재생 · 8: 파형 편집"
              : "끌기: 고르기 · 휠: 확대 · Shift+휠: 옆으로 · Space: 재생 · L: 반복 · M: 마커 · Shift+D: 스펙트럼 · 9: 멀티트랙 · F3: 기능 검색"
          }
        >
          {mode === "multi" ? (
            <>
              <span>
                {mt.dirty ? "● " : ""}
                {mt.name}
              </span>
              <span>
                {mt.session.sampleRate.toLocaleString()} Hz · 스테레오 믹스 · 트랙 {mt.session.tracks.length}개
              </span>
              <span>{timeLabel(mt.length, true)}</span>
            </>
          ) : (
            <>
            <span>
              {history.dirty ? "● " : ""}
              {name}
            </span>
            <span>
              {rate.toLocaleString()} Hz · {sound.channels.length === 2 ? "스테레오" : "모노"} · 32비트 실수
            </span>
            <span>
              {timeLabel(A.secondsOf(sound), true)} · {((n * sound.channels.length * 4) / 1024 / 1024).toFixed(1)} MB
            </span>
            </>
          )}
        </StatusBar>
      }
    >
      {mode === "multi" ? (
        <MultitrackView mt={mt} meter={<Meter getLevels={mt.getLevels} />} />
      ) : (
        <div className="sound-stage">
          <div className="transport">
            <button title="처음으로 (Home)" onClick={() => (setCursor(0), setSelection(null), playing.current && play(undefined, 0))}>
              ⏮
            </button>
            <button className="play" title="재생 / 멈춤 (Space)" onClick={() => (playing.current ? stop() : play())}>
              {playhead !== null ? "■" : "▶"}
            </button>
            <button className={recording ? "rec on" : "rec"} title="커서 자리에 녹음 (R)" onClick={() => void record()}>
              ●
            </button>
            <button title="끝으로 (End)" onClick={() => (setCursor(n), setSelection(null), stop())}>
              ⏭
            </button>
            <button aria-pressed={loop} title="반복 재생 (L)" onClick={() => setLoop(!loop)}>
              🔁
            </button>
            <div className="clock">{timeLabel(pos / rate, true)}</div>
            <div className="sel-info">
              <span>시작</span>
              <b>{timeLabel((selection?.start ?? cursor) / rate, true)}</b>
              <span>끝</span>
              <b>{timeLabel((selection?.end ?? cursor) / rate, true)}</b>
              <span>길이</span>
              <b>{timeLabel((selection ? selection.end - selection.start : 0) / rate, true)}</b>
            </div>
            <span className="spacer" />
            <div className="view-buttons">
              <button title="확대 (=)" onClick={() => zoom(0.5)}>
                ＋
              </button>
              <button title="축소 (-)" onClick={() => zoom(2)}>
                －
              </button>
              <button title="전체 보기 (\)" onClick={zoomFit}>
                ⤢
              </button>
              <button aria-pressed={spectral} title="스펙트럼 보기 (Shift+D)" onClick={() => setSpectral(!spectral)}>
                🌈
              </button>
              {live && rack.length > 0 && <span className="live-badge">🎛 랙 켜짐</span>}
            </div>
          </div>
          <div className="sound-wave">
            {n ? (
              <Wave
                sound={sound}
                view={view}
                setView={setView}
                selection={selection}
                cursor={cursor}
                playhead={playhead}
                markers={markers}
                spectral={spectral}
                onSelect={onSelect}
                onMarkerMove={onMarkerMove}
              />
            ) : (
              <div className="sound-empty">
                <p className="big">🌊 소리를 넣어 주세요</p>
                <p>소리 파일을 끌어다 놓거나, Ctrl+O 로 열거나, ● 로 녹음하세요.</p>
                <div className="empty-buttons">
                  <button className="suite-button" onClick={() => void open(true)}>
                    📂 파일 열기
                  </button>
                  <button className="suite-button ghost" onClick={() => void record()}>
                    ● 녹음
                  </button>
                  <button className="suite-button ghost" onClick={() => setSfxOpen(true)}>
                    🎮 효과음 만들기
                  </button>
                </div>
              </div>
            )}
          </div>
          <Meter getLevels={getLevels} />
        </div>
      )}
      {dialog?.kind === "params" && (
        <ParamDialog
          spec={dialog.spec}
          onClose={() => setDialog(null)}
          onPreview={(v) => void previewSpec(dialog.spec, v)}
          onApply={(v) => void applySpec(dialog.spec, v)}
        />
      )}
      {dialog?.kind === "export" && (
        <ExportDialog sound={sound} selection={selection} initial={exportOpts} onClose={() => setDialog(null)} onExport={(o) => void exportWav(o, true)} />
      )}
      <CommandSearch open={searchOpen} commands={menuCommands(shownMenus)} onClose={() => setSearchOpen(false)} />
      <Toast message={toast} />
      <Tour steps={TOUR_STEPS} open={tour.open} onFinish={tour.finish} />
    </AppFrame>
  );
}
