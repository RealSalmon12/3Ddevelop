/* 오디션의 멀티트랙 화면: 트랙 머리(이름, 음소거, 솔로, 볼륨, 팬, 미터) + 조각을 늘어놓는 줄 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Panel, isTourOpen, useHistory, type Menu } from "@suite/ui";
import * as A from "./audio";
import * as D from "./dsp";
import * as S from "./session";
import type { Fx } from "./effects";
import { RackPanel } from "./Rack";
import { timeLabel } from "./Wave";

const ROW_H = 92;
const HEAD_W = 236;
const SNAP_PX = 8;
const AUDIO = { name: "소리 파일", extensions: ["wav", "mp3", "ogg", "m4a", "webm", "flac", "aac"] };
const SESSION = { name: "바코 파도 세션", extensions: ["bses"] };
const SOURCE_MIME = "application/x-baco-source";
const baseName = (p: string) => p.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");

export interface MultitrackOptions {
  active: boolean;
  ctx: () => AudioContext;
  notify: (m: string) => void;
  decode: (bytes: ArrayBuffer) => Promise<A.Sound>;
  /** 파형 편집기에 지금 있는 소리 */
  currentSound: () => { sound: A.Sound; name: string };
  /** 파형 편집기로 보내고 그 화면으로 바꾼다 */
  openInEditor: (s: A.Sound, name: string) => void;
  openSearch: () => void;
}

interface Playback {
  graph: S.Graph;
  begin: number;
  from: number;
  analysers: Map<string, AnalyserNode>;
  masterL: AnalyserNode;
  masterR: AnalyserNode;
  raf: number;
  session: S.Session;
}

export interface View {
  start: number;
  /** 1초가 몇 px */
  pps: number;
}

export function useMultitrack(o: MultitrackOptions) {
  const history = useHistory<S.Session>(S.emptySession(), 60);
  const session = history.state;
  const [selClip, setSelClip] = useState<string | null>(null);
  const [selTrack, setSelTrack] = useState<string>(session.tracks[0].id);
  const [playhead, setPlayheadRaw] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [view, setViewRaw] = useState<View>({ start: 0, pps: 40 });
  const [laneW, setLaneW] = useState(800);
  const [name, setName] = useState("새 세션");
  const [path, setPath] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const pb = useRef<Playback | null>(null);
  const playheadRef = useRef(0);
  const setPlayhead = (t: number) => {
    playheadRef.current = Math.max(0, t);
    setPlayheadRaw(playheadRef.current);
  };
  const setView = useCallback((v: View) => setViewRaw({ start: Math.max(0, v.start), pps: Math.max(2, Math.min(2000, v.pps)) }), []);
  const length = S.sessionLength(session);
  const track = session.tracks.find((t) => t.id === selTrack) ?? session.tracks[0];
  const clip = S.findClip(session, selClip);

  /* ───────── 재생 ───────── */

  const stop = useCallback(() => {
    const p = pb.current;
    if (!p) return;
    for (const s of p.graph.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* 시작 전 */
      }
      s.disconnect();
    }
    p.graph.master.disconnect();
    cancelAnimationFrame(p.raf);
    pb.current = null;
    setPlaying(false);
  }, []);

  const play = useCallback(
    (from = playheadRef.current) => {
      stop();
      const s = history.get();
      const end = S.sessionLength(s);
      if (!end) return o.notify("트랙이 비어 있어요. 소리 파일을 줄에 끌어다 놓거나 ‘파일 넣기’를 눌러 보세요.");
      if (from >= end - 0.01) from = 0;
      const c = o.ctx();
      void c.resume();
      const out = c.createGain();
      out.connect(c.destination);
      const graph = S.buildGraph(c, s, from, out, c.currentTime + 0.03);
      const analysers = new Map<string, AnalyserNode>();
      for (const [id, nodes] of graph.tracks) {
        const a = c.createAnalyser();
        a.fftSize = 1024;
        nodes.pan.connect(a);
        analysers.set(id, a);
      }
      const split = c.createChannelSplitter(2);
      const [masterL, masterR] = [0, 1].map(() => {
        const a = c.createAnalyser();
        a.fftSize = 2048;
        return a;
      });
      graph.master.disconnect();
      graph.master.connect(out);
      graph.master.connect(split);
      split.connect(masterL, 0);
      split.connect(masterR, 1);
      const begin = c.currentTime + 0.03;
      const tick = () => {
        const p = pb.current;
        if (!p) return;
        const t = p.from + Math.max(0, c.currentTime - p.begin);
        if (t > S.sessionLength(p.session) + 0.3) {
          stop();
          return;
        }
        setPlayhead(t);
        p.raf = requestAnimationFrame(tick);
      };
      pb.current = { graph, begin, from, analysers, masterL, masterR, raf: requestAnimationFrame(tick), session: s };
      setPlaying(true);
      setPlayhead(from);
    },
    [history, stop, o],
  );

  // 재생 중에 바뀐 것: 볼륨·팬·음소거는 값만, 랙은 이음새만, 조각이 바뀌면 그 자리부터 다시
  useEffect(() => {
    const p = pb.current;
    if (!p || p.session === session) return;
    const prev = p.session;
    const c = o.ctx();
    const clipsChanged = prev.sources !== session.sources || prev.tracks.length !== session.tracks.length || session.tracks.some((t, i) => t.id !== prev.tracks[i].id || t.clips !== prev.tracks[i].clips);
    if (clipsChanged) return play(playheadRef.current);
    p.graph.master.gain.setTargetAtTime(D.dbToGain(session.masterDb), c.currentTime, 0.02);
    session.tracks.forEach((t, i) => {
      const nodes = p.graph.tracks.get(t.id);
      if (!nodes) return;
      nodes.vol.gain.setTargetAtTime(S.trackGain(session, t), c.currentTime, 0.02);
      nodes.pan.pan.setTargetAtTime(t.pan, c.currentTime, 0.02);
      if (t.fx !== prev.tracks[i].fx) S.swapRack(c, nodes, t.fx);
    });
    p.session = session;
  }, [session, play, o]);

  useEffect(() => {
    if (!o.active) stop();
  }, [o.active, stop]);

  const level = (a: AnalyserNode | undefined) => {
    if (!a) return -Infinity;
    const buf = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(buf);
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v));
    return D.gainToDb(peak);
  };
  const getLevels = useCallback(() => {
    const p = pb.current;
    return p ? [level(p.masterL), level(p.masterR)] : null;
  }, []);
  const trackLevel = useCallback((id: string) => level(pb.current?.analysers.get(id)), []);

  const seek = (t: number) => {
    setPlayhead(t);
    if (pb.current) play(t);
  };

  /* ───────── 조각 넣기 ───────── */

  /** 겹치지 않는 트랙: 고른 트랙부터 아래로, 없으면 새 트랙 */
  const freeTrack = (s: S.Session, from: string, start: number, len: number): [S.Session, string] => {
    const i0 = Math.max(0, s.tracks.findIndex((t) => t.id === from));
    for (let i = i0; i < s.tracks.length; i++) {
      const t = s.tracks[i];
      if (!t.clips.some((c) => c.start < start + len && S.clipEnd(c) > start)) return [s, t.id];
    }
    const t = S.newTrack(s.tracks.length);
    return [{ ...s, tracks: [...s.tracks, t] }, t.id];
  };

  const insertSources = (items: { name: string; sound: A.Sound; path?: string }[], at = playheadRef.current, trackId?: string) => {
    if (!items.length) return;
    let s = history.get();
    let lastClip: string | null = null;
    let lastTrack = trackId ?? track.id;
    for (const item of items) {
      const src = S.makeSource(item.name, item.sound, item.path);
      const c = S.clipFor(src, at);
      let tid = lastTrack;
      if (!trackId || items.length > 1) [s, tid] = freeTrack(s, lastTrack, at, c.length);
      s = S.addClip({ ...s, sources: { ...s.sources, [src.id]: src }, sampleRate: Object.keys(s.sources).length ? s.sampleRate : Math.max(44100, item.sound.sampleRate) }, tid, c);
      lastClip = c.id;
      lastTrack = tid;
    }
    history.set(s);
    setSelClip(lastClip);
    setSelTrack(lastTrack);
  };

  const placeSource = (sourceId: string, trackId: string, at: number) => {
    const src = history.get().sources[sourceId];
    if (!src) return;
    const c = S.clipFor(src, at);
    history.set(S.addClip(history.get(), trackId, c));
    setSelClip(c.id);
    setSelTrack(trackId);
  };

  const readFiles = async (paths: string[]) => {
    const out: { name: string; sound: A.Sound; path?: string }[] = [];
    for (const p of paths) {
      const bytes = await window.suite?.files.read(p);
      if (!bytes) continue;
      try {
        out.push({ name: baseName(p), sound: await o.decode(bytes.slice().buffer), path: p });
      } catch {
        o.notify(`‘${baseName(p)}’ 은(는) 읽을 수 없는 소리 파일이에요.`);
      }
    }
    return out;
  };

  const importFiles = async () => {
    if (!window.suite) return;
    const paths = await window.suite.files.pick({ filters: [AUDIO], multiple: true });
    if (!paths.length) return;
    setBusy(true);
    try {
      const items = await readFiles(paths);
      insertSources(items);
      if (items.length) o.notify(`${items.length}개를 재생 위치(${timeLabel(playheadRef.current)})에 넣었어요. 겹치면 빈 트랙으로 내려가요.`);
    } finally {
      setBusy(false);
    }
  };

  const dropFiles = async (files: FileList, trackId: string, at: number) => {
    const items: { name: string; sound: A.Sound; path?: string }[] = [];
    for (const f of Array.from(files)) {
      try {
        items.push({ name: f.name.replace(/\.[^.]+$/, ""), sound: await o.decode(await f.arrayBuffer()), path: window.suite?.files.pathOf(f) || undefined });
      } catch {
        o.notify(`‘${f.name}’ 은(는) 읽을 수 없어요.`);
      }
    }
    insertSources(items, at, trackId);
  };

  const sendFromEditor = () => {
    const { sound, name: n } = o.currentSound();
    if (!A.lengthOf(sound)) return o.notify("파형 편집기가 비어 있어요.");
    insertSources([{ name: n, sound }]);
    o.notify(`파형 편집기의 ‘${n}’ 을(를) ${timeLabel(playheadRef.current)} 에 넣었어요.`);
  };

  /* ───────── 편집 ───────── */

  const split = () => {
    const t = playheadRef.current;
    let s = history.get();
    const sel = S.findClip(s, selClip);
    const targets = sel && sel.clip.start < t && S.clipEnd(sel.clip) > t ? [sel.clip.id] : s.tracks.flatMap((tr) => tr.clips.filter((c) => c.start < t && S.clipEnd(c) > t).map((c) => c.id));
    if (!targets.length) return o.notify("재생 위치(세로 선)에 걸친 조각이 없어요. 자를 곳으로 재생 위치를 옮겨 주세요.");
    let right: string | null = null;
    for (const id of targets) [s, right] = S.splitClip(s, id, t);
    history.set(s);
    if (right && targets.length === 1) setSelClip(right);
  };

  const removeSel = () => {
    if (!selClip) return o.notify("지울 조각을 먼저 클릭해 주세요.");
    history.set(S.removeClip(history.get(), selClip));
    setSelClip(null);
  };

  const duplicate = () => {
    const f = S.findClip(history.get(), selClip);
    if (!f) return o.notify("복제할 조각을 먼저 클릭해 주세요.");
    const c = { ...f.clip, id: S.uid("c"), start: S.clipEnd(f.clip) };
    history.set(S.addClip(history.get(), f.track.id, c));
    setSelClip(c.id);
  };

  const nudge = (dt: number) => {
    const f = S.findClip(history.get(), selClip);
    if (f) history.set(S.updateClip(history.get(), f.clip.id, { start: Math.max(0, f.clip.start + dt) }));
  };

  const addTrack = () => {
    const t = S.newTrack(history.get().tracks.length);
    history.set({ ...history.get(), tracks: [...history.get().tracks, t] });
    setSelTrack(t.id);
  };

  const removeTrack = (id: string) => {
    const s = history.get();
    const t = s.tracks.find((x) => x.id === id);
    if (!t || s.tracks.length <= 1) return;
    if (t.clips.length && !window.confirm(`‘${t.name}’ 에 조각이 ${t.clips.length}개 있어요. 트랙을 지울까요?`)) return;
    history.set({ ...s, tracks: s.tracks.filter((x) => x.id !== id) });
    if (selTrack === id) setSelTrack(s.tracks.find((x) => x.id !== id)!.id);
  };

  /** 슬라이더처럼 계속 바뀌는 값: 끄는 동안은 미리 보기, 놓으면 기록 */
  const commitTimer = useRef(0);
  const live = (next: S.Session) => {
    history.preview(next);
    clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(history.commit, 500);
  };
  const patchTrack = (id: string, p: Partial<S.Track>, continuous = false) => (continuous ? live : history.set)(S.updateTrack(history.get(), id, p));
  const patchClip = (id: string, p: Partial<S.Clip>, continuous = false) => (continuous ? live : history.set)(S.updateClip(history.get(), id, p));
  const setTrackFx = (id: string, fx: Fx[]) => live(S.updateTrack(history.get(), id, { fx }));
  const setMaster = (db: number) => live({ ...history.get(), masterDb: db });

  const editClip = () => {
    const f = S.findClip(history.get(), selClip);
    if (!f) return o.notify("파형 편집기에서 열 조각을 먼저 클릭해 주세요.");
    const src = history.get().sources[f.clip.source];
    const r = src.sound.sampleRate;
    o.openInEditor(A.keep(src.sound, { start: Math.round(f.clip.offset * r), end: Math.round((f.clip.offset + f.clip.length) * r) }), f.clip.name);
  };

  /* ───────── 믹스다운, 세션 파일 ───────── */

  const doMixdown = async () => {
    if (!S.sessionLength(history.get())) {
      o.notify("섞을 조각이 없어요.");
      return null;
    }
    stop();
    setBusy(true);
    try {
      return await S.mixdown(history.get());
    } finally {
      setBusy(false);
    }
  };

  const mixToEditor = async () => {
    const s = await doMixdown();
    if (s) o.openInEditor(s, `${name} 믹스다운`);
  };

  const exportMix = async () => {
    const s = await doMixdown();
    if (!s || !window.suite) return;
    const r = await window.suite.files.save({ defaultName: `${name}.wav`, filters: [{ name: "WAV 소리", extensions: ["wav"] }], data: D.encodeWav(s, 24) });
    if (r.ok) o.notify(`믹스다운을 저장했어요 (24비트, ${s.sampleRate}Hz, ${A.secondsOf(s).toFixed(1)}초).`);
    else if (r.reason === "error") o.notify(`저장하지 못했어요. ${r.message ?? ""}`);
  };

  const save = async (saveAs: boolean) => {
    if (!window.suite) return;
    const r = await window.suite.files.save({ path: saveAs ? undefined : path, defaultName: `${name}.bses`, filters: [SESSION], data: S.serialize(history.get()) });
    if (r.ok) {
      history.markSaved();
      setPath(r.path);
      setName(baseName(r.path));
      o.notify("세션을 저장했어요. 디스크에서 불러온 소리는 경로만 적으니 원본 파일을 옮기지 마세요.");
    } else if (r.reason === "error") o.notify(`저장하지 못했어요. ${r.message ?? ""}`);
  };

  const reset = (s: S.Session, n: string, p?: string) => {
    stop();
    history.reset(s);
    setSelClip(null);
    setSelTrack(s.tracks[0].id);
    setPlayhead(0);
    setViewRaw({ start: 0, pps: 40 });
    setName(n);
    setPath(p);
  };

  const newSession = () => {
    if (history.dirty && !window.confirm("저장하지 않은 세션이 사라져요. 계속할까요?")) return;
    reset(S.emptySession(), "새 세션");
  };

  const openSession = async () => {
    if (!window.suite) return;
    if (history.dirty && !window.confirm("저장하지 않은 세션이 사라져요. 계속할까요?")) return;
    const r = await window.suite.files.open({ filters: [SESSION] });
    if (!r.ok) return r.reason === "error" && o.notify(`열지 못했어요. ${r.message ?? ""}`);
    setBusy(true);
    try {
      const { session: s, missing } = await S.deserialize(r.text, o.decode, (p) => window.suite!.files.read(p));
      reset(s, baseName(r.path), r.path);
      o.notify(missing.length ? `원본 파일을 찾지 못한 소리가 있어요: ${missing.join(", ")}` : `‘${baseName(r.path)}’ 세션을 열었어요.`);
    } catch (e) {
      o.notify(`열지 못했어요. ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  /* ───────── 보기 ───────── */

  const zoom = (k: number, at = playheadRef.current) => {
    const pps = Math.max(2, Math.min(2000, view.pps / k));
    const x = (at - view.start) * view.pps;
    setView({ start: at - x / pps, pps });
  };
  const zoomFit = () => {
    const len = Math.max(5, S.sessionLength(history.get()));
    setView({ start: 0, pps: (laneW - 20) / len });
  };

  // 재생 위치가 화면 밖으로 나가면 따라간다
  useEffect(() => {
    if (!playing) return;
    const right = view.start + laneW / view.pps;
    if (playhead > right - 10 / view.pps || playhead < view.start) setView({ ...view, start: playhead - (laneW * 0.1) / view.pps });
  }, [playhead, playing, view, laneW, setView]);

  /* ───────── 단축키 ───────── */

  useEffect(() => {
    if (!o.active) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target;
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && el.type !== "range" && el.type !== "checkbox")) return;
      if (document.querySelector(".dialog-dim") || isTourOpen()) return;
      const key = e.key.toLowerCase();
      if (e.key === "F3") {
        e.preventDefault();
        return o.openSearch();
      }
      const ctrl = e.ctrlKey || e.metaKey;
      const map: Record<string, (() => void) | undefined> = ctrl
        ? {
            z: e.shiftKey ? history.redo : history.undo,
            y: history.redo,
            k: split,
            d: duplicate,
            i: () => void importFiles(),
            s: () => void save(e.shiftKey),
            o: () => void openSession(),
            n: newSession,
            e: e.shiftKey ? () => void exportMix() : undefined,
            m: e.shiftKey ? () => void mixToEditor() : undefined,
          }
        : {
            " ": () => (pb.current ? stop() : play()),
            delete: removeSel,
            backspace: removeSel,
            home: () => seek(0),
            end: () => seek(S.sessionLength(history.get())),
            "=": () => zoom(0.5),
            "+": () => zoom(0.5),
            "-": () => zoom(2),
            "\\": zoomFit,
            escape: () => setSelClip(null),
            arrowleft: e.altKey ? () => nudge(-0.01) : undefined,
            arrowright: e.altKey ? () => nudge(0.01) : undefined,
          };
      const fn = map[key];
      if (fn) {
        e.preventDefault();
        e.stopImmediatePropagation();
        fn();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const menus: Menu[] = [
    {
      label: "파일",
      items: [
        { label: "새 세션", shortcut: "Ctrl+N", onSelect: newSession },
        { label: "세션 열기…", shortcut: "Ctrl+O", onSelect: () => void openSession() },
        { label: "세션 저장", shortcut: "Ctrl+S", onSelect: () => void save(false) },
        { label: "다른 이름으로 세션 저장…", shortcut: "Ctrl+Shift+S", onSelect: () => void save(true) },
        { label: "파일 넣기…", shortcut: "Ctrl+I", onSelect: () => void importFiles() },
        { label: "파형 편집기의 소리 넣기", onSelect: sendFromEditor },
        { label: "믹스다운 내보내기 (WAV)…", shortcut: "Ctrl+Shift+E", onSelect: () => void exportMix() },
        { label: "믹스다운을 파형 편집기로", shortcut: "Ctrl+Shift+M", onSelect: () => void mixToEditor() },
      ],
    },
    {
      label: "편집",
      items: [
        { label: "실행 취소", shortcut: "Ctrl+Z", disabled: !history.canUndo, onSelect: history.undo },
        { label: "다시 실행", shortcut: "Ctrl+Y", disabled: !history.canRedo, onSelect: history.redo },
        { label: "재생 위치에서 자르기", shortcut: "Ctrl+K", onSelect: split },
        { label: "조각 복제", shortcut: "Ctrl+D", disabled: !selClip, onSelect: duplicate },
        { label: "조각 지우기", shortcut: "Delete", disabled: !selClip, onSelect: removeSel },
        { label: "조각을 파형 편집기에서 열기", disabled: !selClip, onSelect: editClip },
      ],
    },
    {
      label: "트랙",
      items: [
        { label: "트랙 더하기", onSelect: addTrack },
        { label: "고른 트랙 지우기", disabled: session.tracks.length <= 1, onSelect: () => removeTrack(track.id) },
        { label: track.mute ? "음소거 풀기" : "음소거", onSelect: () => patchTrack(track.id, { mute: !track.mute }) },
        { label: track.solo ? "솔로 풀기" : "솔로", onSelect: () => patchTrack(track.id, { solo: !track.solo }) },
        { label: "모든 솔로 풀기", onSelect: () => history.set({ ...history.get(), tracks: history.get().tracks.map((t) => (t.solo ? { ...t, solo: false } : t)) }) },
      ],
    },
    {
      label: "보기",
      items: [
        { label: "확대", shortcut: "=", onSelect: () => zoom(0.5) },
        { label: "축소", shortcut: "-", onSelect: () => zoom(2) },
        { label: "전체 보기", shortcut: "\\", onSelect: zoomFit },
      ],
    },
  ];

  return {
    history,
    session,
    track,
    clip,
    selClip,
    setSelClip,
    setSelTrack,
    playhead,
    playing,
    view,
    setView,
    laneW,
    setLaneW,
    name,
    busy,
    length,
    dirty: history.dirty,
    menus,
    play,
    stop,
    seek,
    zoom,
    zoomFit,
    split,
    addTrack,
    removeTrack,
    patchTrack,
    patchClip,
    setTrackFx,
    setMaster,
    importFiles,
    dropFiles,
    placeSource,
    sendFromEditor,
    editClip,
    exportMix,
    mixToEditor,
    getLevels,
    trackLevel,
  };
}

export type Multitrack = ReturnType<typeof useMultitrack>;

/* ───────── 화면 ───────── */

const TICKS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];

function Ruler({ mt }: { mt: Multitrack }) {
  const { view, laneW } = mt;
  const step = TICKS.find((s) => s * view.pps >= 80) ?? 600;
  const first = Math.floor(view.start / step) * step;
  const ticks: number[] = [];
  for (let t = first; t < view.start + laneW / view.pps; t += step) ticks.push(t);
  const scrub = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const at = (x: number) => Math.max(0, mt.view.start + (x - rect.left) / mt.view.pps);
    mt.seek(at(e.clientX));
    const move = (ev: PointerEvent) => mt.seek(at(ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div className="mt-ruler" onPointerDown={scrub} title="클릭하거나 끌어서 재생 위치 옮기기">
      {ticks.map((t) => (
        <span key={t.toFixed(3)} style={{ left: (t - view.start) * view.pps }}>
          {step < 1 ? timeLabel(t, true).slice(0, -1) : timeLabel(t).replace(/\.0$/, "")}
        </span>
      ))}
    </div>
  );
}

function ClipView({ mt, track, clip, tracksRef }: { mt: Multitrack; track: S.Track; clip: S.Clip; tracksRef: React.RefObject<HTMLDivElement | null> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { view, laneW } = mt;
  const src = mt.session.sources[clip.source];
  const left = (clip.start - view.start) * view.pps;
  const width = Math.max(4, clip.length * view.pps);
  // 화면에 보이는 부분만 그린다 (아주 크게 확대해도 캔버스가 커지지 않게)
  const visL = Math.max(0, -left);
  const visR = Math.min(width, laneW - left);
  const visW = Math.max(0, Math.ceil(visR - visL));
  const selected = mt.selClip === clip.id;

  useLayoutEffect(() => {
    const cv = canvas.current;
    if (!cv || !src || !visW) return;
    const h = ROW_H - 22;
    cv.width = visW;
    cv.height = h;
    const g = cv.getContext("2d")!;
    g.clearRect(0, 0, visW, h);
    g.fillStyle = track.color;
    g.globalAlpha = track.mute ? 0.35 : 0.85;
    const rate = src.sound.sampleRate;
    const mid = h / 2;
    for (let x = 0; x < visW; x++) {
      const t0 = (visL + x) / view.pps;
      const b0 = Math.floor(((clip.offset + t0) * rate) / S.PEAK_BLOCK);
      const b1 = Math.max(b0 + 1, Math.floor(((clip.offset + t0 + 1 / view.pps) * rate) / S.PEAK_BLOCK));
      let peak = 0;
      for (let b = b0; b < b1 && b < src.peaks.length; b++) peak = Math.max(peak, src.peaks[b]);
      const v = Math.min(1, peak * S.envelope(clip, t0)) * mid * 0.95;
      g.fillRect(x, mid - v, 1, Math.max(1, v * 2));
    }
    // 페이드 곡선
    g.globalAlpha = 1;
    g.strokeStyle = "rgba(255,255,255,0.75)";
    g.lineWidth = 1.5;
    g.beginPath();
    if (clip.fadeIn > 0) {
      g.moveTo(-visL, h);
      g.lineTo(clip.fadeIn * view.pps - visL, 0);
    }
    if (clip.fadeOut > 0) {
      g.moveTo(width - clip.fadeOut * view.pps - visL, 0);
      g.lineTo(width - visL, h);
    }
    g.stroke();
  }, [src, clip, track.color, track.mute, view.pps, visL, visW, width]);

  if (left > laneW || left + width < 0) return null;

  const drag = (e: React.PointerEvent, mode: "move" | "trimL" | "trimR" | "fadeIn" | "fadeOut") => {
    e.stopPropagation();
    if (e.button !== 0) return;
    mt.setSelClip(clip.id);
    mt.setSelTrack(track.id);
    const x0 = e.clientX;
    const orig = clip;
    const srcLen = S.sourceSeconds(src);
    const others = mt.session.tracks.flatMap((t) => t.clips.filter((c) => c.id !== clip.id).flatMap((c) => [c.start, S.clipEnd(c)]));
    const edges = [0, mt.playhead, ...others];
    const snap = (t: number) => {
      let best = t;
      let dist = SNAP_PX / mt.view.pps;
      for (const c of edges)
        if (Math.abs(c - t) < dist) {
          best = c;
          dist = Math.abs(c - t);
        }
      return best;
    };
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dt = (ev.clientX - x0) / mt.view.pps;
      if (!moved && Math.abs(ev.clientX - x0) < 3) return;
      moved = true;
      const s = mt.history.get();
      if (mode === "move") {
        let start = Math.max(0, orig.start + dt);
        const sEnd = snap(start + orig.length);
        const sStart = snap(start);
        if (sStart !== start) start = sStart;
        else if (sEnd !== start + orig.length) start = sEnd - orig.length;
        // 위아래로 끌면 다른 트랙으로
        const rect = tracksRef.current!.getBoundingClientRect();
        const row = Math.floor((ev.clientY - rect.top + tracksRef.current!.scrollTop) / ROW_H);
        const to = s.tracks[Math.max(0, Math.min(s.tracks.length - 1, row))].id;
        mt.history.preview(S.moveClip(s, clip.id, to, start));
        mt.setSelTrack(to);
      } else if (mode === "trimL") {
        const start = Math.max(orig.start - orig.offset, Math.min(S.clipEnd(orig) - 0.02, snap(orig.start + dt)));
        const d = start - orig.start;
        mt.history.preview(S.updateClip(s, clip.id, { start, offset: orig.offset + d, length: orig.length - d, fadeIn: Math.min(orig.fadeIn, orig.length - d) }));
      } else if (mode === "trimR") {
        const end = Math.max(orig.start + 0.02, Math.min(orig.start - orig.offset + srcLen, snap(S.clipEnd(orig) + dt)));
        mt.history.preview(S.updateClip(s, clip.id, { length: end - orig.start, fadeOut: Math.min(orig.fadeOut, end - orig.start) }));
      } else if (mode === "fadeIn") {
        mt.history.preview(S.updateClip(s, clip.id, { fadeIn: Math.max(0, Math.min(orig.length - orig.fadeOut, orig.fadeIn + dt)) }));
      } else {
        mt.history.preview(S.updateClip(s, clip.id, { fadeOut: Math.max(0, Math.min(orig.length - orig.fadeIn, orig.fadeOut - dt)) }));
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      mt.history.commit();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      className={selected ? "mt-clip selected" : "mt-clip"}
      style={{ left, width, ["--clip" as string]: track.color }}
      onPointerDown={(e) => drag(e, "move")}
      onDoubleClick={() => mt.editClip()}
      title={`${clip.name} · ${clip.length.toFixed(2)}초 · 더블클릭: 파형 편집기에서 열기`}
    >
      <div className="mt-clip-name" style={{ paddingLeft: Math.max(6, visL + 6) }}>
        {clip.name}
        {clip.gainDb !== 0 && <small> {clip.gainDb > 0 ? "+" : ""}{clip.gainDb.toFixed(1)}dB</small>}
      </div>
      {visW > 0 && <canvas ref={canvas} className="mt-clip-wave" style={{ left: visL, width: visW }} />}
      <i className="mt-edge l" onPointerDown={(e) => drag(e, "trimL")} title="끌어서 앞 다듬기" />
      <i className="mt-edge r" onPointerDown={(e) => drag(e, "trimR")} title="끌어서 뒤 다듬기" />
      <b className="mt-fade l" style={{ left: clip.fadeIn * view.pps }} onPointerDown={(e) => drag(e, "fadeIn")} title="끌어서 페이드 인" />
      <b className="mt-fade r" style={{ right: clip.fadeOut * view.pps }} onPointerDown={(e) => drag(e, "fadeOut")} title="끌어서 페이드 아웃" />
    </div>
  );
}

function TrackHead({ mt, track, index }: { mt: Multitrack; track: S.Track; index: number }) {
  const selected = mt.track.id === track.id;
  return (
    <div className={selected ? "mt-head selected" : "mt-head"} style={{ ["--clip" as string]: track.color }} onPointerDown={() => mt.setSelTrack(track.id)}>
      <div className="mt-head-row">
        <input className="mt-name" value={track.name} onChange={(e) => mt.patchTrack(track.id, { name: e.target.value }, true)} />
        <button className="mt-btn m" aria-pressed={track.mute} title="음소거" onClick={() => mt.patchTrack(track.id, { mute: !track.mute })}>
          M
        </button>
        <button className="mt-btn s" aria-pressed={track.solo} title="솔로 (이 트랙만 듣기)" onClick={() => mt.patchTrack(track.id, { solo: !track.solo })}>
          S
        </button>
        <button className="mt-btn fx" aria-pressed={track.fx.some((f) => f.on)} title="트랙 효과 (오른쪽 패널)" onClick={() => mt.setSelTrack(track.id)}>
          fx{track.fx.length ? track.fx.length : ""}
        </button>
        <button className="mt-btn x" title="트랙 지우기" disabled={mt.session.tracks.length <= 1} onClick={() => mt.removeTrack(track.id)}>
          ✕
        </button>
      </div>
      <label className="mt-slider" title="트랙 볼륨 (더블클릭: 0dB)" onDoubleClick={() => mt.patchTrack(track.id, { volumeDb: 0 })}>
        <span>🔊</span>
        <input type="range" min={-48} max={12} step={0.5} value={track.volumeDb} onChange={(e) => mt.patchTrack(track.id, { volumeDb: Number(e.target.value) }, true)} />
        <em>{track.volumeDb > 0 ? "+" : ""}{track.volumeDb.toFixed(1)}</em>
      </label>
      <label className="mt-slider" title="팬 (더블클릭: 가운데)" onDoubleClick={() => mt.patchTrack(track.id, { pan: 0 })}>
        <span>↔</span>
        <input type="range" min={-1} max={1} step={0.02} value={track.pan} onChange={(e) => mt.patchTrack(track.id, { pan: Number(e.target.value) }, true)} />
        <em>{Math.abs(track.pan) < 0.01 ? "C" : `${track.pan < 0 ? "L" : "R"}${Math.round(Math.abs(track.pan) * 100)}`}</em>
      </label>
      <div className="mt-meter">
        <i data-meter={track.id} />
      </div>
      <span className="mt-index">{index + 1}</span>
    </div>
  );
}

export function MultitrackView({ mt, meter }: { mt: Multitrack; meter: React.ReactNode }) {
  const lanesRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef<HTMLDivElement>(null);
  const { view, session } = mt;

  useLayoutEffect(() => {
    const el = lanesRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => mt.setLaneW(el.clientWidth - HEAD_W));
    ro.observe(el);
    return () => ro.disconnect();
  }, [mt.setLaneW]);

  // 트랙 미터: 화면을 다시 그리지 않고 막대 길이만 바꾼다
  useEffect(() => {
    if (!mt.playing) {
      document.querySelectorAll<HTMLElement>("[data-meter]").forEach((el) => (el.style.width = "0"));
      return;
    }
    let raf = 0;
    const tick = () => {
      document.querySelectorAll<HTMLElement>("[data-meter]").forEach((el) => {
        const db = mt.trackLevel(el.dataset.meter!);
        const r = Number.isFinite(db) ? Math.max(0, Math.min(1, (db + 60) / 60)) : 0;
        el.style.width = `${r * 100}%`;
        el.classList.toggle("hot", db > -1);
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mt.playing, mt.trackLevel]);

  const timeAt = (clientX: number) => {
    const rect = lanesRef.current!.getBoundingClientRect();
    return Math.max(0, view.start + (clientX - rect.left - HEAD_W) / view.pps);
  };

  const onWheel = (e: React.WheelEvent) => {
    if ((e.target as HTMLElement).closest(".mt-head")) return;
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) mt.setView({ ...view, start: view.start + (e.deltaX || e.deltaY) / view.pps });
    else mt.zoom(e.deltaY > 0 ? 1.25 : 0.8, timeAt(e.clientX));
  };

  const x = (mt.playhead - view.start) * view.pps;
  const empty = !session.tracks.some((t) => t.clips.length);

  return (
    <div className="mt-stage">
      <div className="transport">
        <button title="처음으로 (Home)" onClick={() => mt.seek(0)}>
          ⏮
        </button>
        <button className="play" title="재생 / 멈춤 (Space)" onClick={() => (mt.playing ? mt.stop() : mt.play())}>
          {mt.playing ? "■" : "▶"}
        </button>
        <button title="끝으로 (End)" onClick={() => mt.seek(mt.length)}>
          ⏭
        </button>
        <div className="clock">{timeLabel(mt.playhead, true)}</div>
        <div className="mt-tools">
          <button className="mini" onClick={() => void mt.importFiles()} disabled={mt.busy} title="소리 파일을 재생 위치에 넣어요 (Ctrl+I)">
            📂 파일 넣기
          </button>
          <button className="mini" onClick={mt.sendFromEditor} title="파형 편집기에 있는 소리를 재생 위치에 넣어요">
            〰 편집기 소리 넣기
          </button>
          <button className="mini" onClick={mt.split} title="재생 위치에서 조각 자르기 (Ctrl+K)">
            ✂ 자르기
          </button>
          <button className="mini" onClick={mt.addTrack}>
            ＋ 트랙
          </button>
        </div>
        <span className="spacer" />
        <div className="view-buttons">
          <button title="확대 (=)" onClick={() => mt.zoom(0.5)}>
            ＋
          </button>
          <button title="축소 (-)" onClick={() => mt.zoom(2)}>
            －
          </button>
          <button title="전체 보기 (\)" onClick={mt.zoomFit}>
            ⤢
          </button>
        </div>
        <button className="mini go mt-mix" disabled={mt.busy} onClick={() => void mt.exportMix()} title="모든 트랙을 섞어 WAV 로 (Ctrl+Shift+E)">
          {mt.busy ? "섞는 중…" : "⬇ 믹스다운"}
        </button>
      </div>
      <div className="mt" ref={lanesRef} onWheel={onWheel}>
        <div className="mt-top">
          <div className="mt-corner">
            {session.tracks.length}개 트랙 · {timeLabel(mt.length)}
          </div>
          <Ruler mt={mt} />
        </div>
        <div className="mt-tracks" ref={tracksRef}>
          {session.tracks.map((t, i) => (
            <div className="mt-row" key={t.id}>
              <TrackHead mt={mt} track={t} index={i} />
              <div
                className={mt.track.id === t.id ? "mt-lane selected" : "mt-lane"}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  mt.setSelClip(null);
                  mt.setSelTrack(t.id);
                  mt.seek(timeAt(e.clientX));
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const at = timeAt(e.clientX);
                  const id = e.dataTransfer.getData(SOURCE_MIME);
                  if (id) mt.placeSource(id, t.id, at);
                  else if (e.dataTransfer.files.length) void mt.dropFiles(e.dataTransfer.files, t.id, at);
                }}
              >
                {t.clips.map((c) => (
                  <ClipView key={c.id} mt={mt} track={t} clip={c} tracksRef={tracksRef} />
                ))}
              </div>
            </div>
          ))}
          {empty && (
            <div className="mt-empty">
              <p className="big">🎚 멀티트랙</p>
              <p>소리 파일을 트랙 줄에 끌어다 놓거나 📂 파일 넣기를 눌러요. 목소리, 배경 음악, 효과음을 트랙마다 따로 두고 섞을 수 있어요.</p>
            </div>
          )}
        </div>
        {x >= 0 && x <= mt.laneW && <div className="mt-playhead" style={{ left: HEAD_W + x }} />}
      </div>
      {meter}
    </div>
  );
}

/** 오른쪽 패널: 트랙 효과 랙, 고른 조각, 원본 소리, 마스터 */
export function MultitrackSidebar({ mt }: { mt: Multitrack }) {
  const { track, clip } = mt;
  const sources = Object.values(mt.session.sources);
  const num = (v: number, set: (v: number) => void, min: number, max: number, step: number, unit: string, label: string) => (
    <label className="fx-knob">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => set(Number(e.target.value))} />
      <input className="fx-num" type="number" min={min} max={max} step={step} value={Number(v.toFixed(2))} onChange={(e) => set(Math.max(min, Math.min(max, Number(e.target.value))))} />
      <small>{unit}</small>
    </label>
  );
  return (
    <>
      <RackPanel key={track.id} title={`🎛 트랙 효과: ${track.name}`} rack={track.fx} setRack={(fx) => mt.setTrackFx(track.id, fx)} />
      <Panel title="✂ 고른 조각" className="clip-panel">
        {clip ? (
          <>
            <p className="clip-title">{clip.clip.name}</p>
            {num(clip.clip.gainDb, (v) => mt.patchClip(clip.clip.id, { gainDb: v }, true), -30, 18, 0.5, "dB", "볼륨")}
            {num(clip.clip.fadeIn, (v) => mt.patchClip(clip.clip.id, { fadeIn: Math.min(v, clip.clip.length - clip.clip.fadeOut) }, true), 0, Math.min(30, clip.clip.length), 0.01, "초", "페이드 인")}
            {num(clip.clip.fadeOut, (v) => mt.patchClip(clip.clip.id, { fadeOut: Math.min(v, clip.clip.length - clip.clip.fadeIn) }, true), 0, Math.min(30, clip.clip.length), 0.01, "초", "페이드 아웃")}
            <div className="info-grid">
              <span>시작</span>
              <b>{timeLabel(clip.clip.start, true)}</b>
              <span>길이</span>
              <b>{timeLabel(clip.clip.length, true)}</b>
            </div>
            <div className="prop-buttons">
              <button className="mini" onClick={mt.editClip} title="이 조각을 파형 편집기에서 열어 자세히 고쳐요">
                〰 파형 편집기에서 열기
              </button>
            </div>
          </>
        ) : (
          <p className="panel-empty">조각을 클릭하면 볼륨과 페이드를 고칠 수 있어요. 조각 위 모서리의 작은 네모를 끌어도 페이드가 생겨요.</p>
        )}
      </Panel>
      <Panel title="📁 원본 소리" className="source-panel">
        {sources.length ? (
          <ul className="source-list">
            {sources.map((s) => (
              <li key={s.id} draggable onDragStart={(e) => e.dataTransfer.setData(SOURCE_MIME, s.id)} title="트랙 줄에 끌어다 놓으면 한 번 더 넣어요">
                <span>🎵 {s.name}</span>
                <small>{timeLabel(S.sourceSeconds(s))}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="panel-empty">넣은 소리가 여기 모여요. 끌어서 트랙에 몇 번이든 다시 넣을 수 있어요.</p>
        )}
      </Panel>
      <Panel title="🎚 마스터" className="master-panel">
        {num(mt.session.masterDb, mt.setMaster, -24, 12, 0.5, "dB", "전체 볼륨")}
        <div className="prop-buttons">
          <button className="mini" disabled={mt.busy} onClick={() => void mt.mixToEditor()} title="모두 섞은 소리를 파형 편집기에서 열어 라우드니스 맞추기 같은 마무리를 해요">
            믹스다운 → 파형 편집기
          </button>
        </div>
      </Panel>
    </>
  );
}
