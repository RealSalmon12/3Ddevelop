import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
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
  requirePro,
  useLicense,
} from "@suite/ui";
import { AI_SYSTEM, AI_TOOL, aiContext, applyAICaptions } from "./ai";
import { Scopes } from "./Scopes";
import { trackMotion } from "./tracker";
import { EffectControls } from "./EffectControls";
import { Engine, exportFormats } from "./engine";
import { canExportExact, exportExact } from "./exactExport";
import { kindOf, MEDIA_FILTER, probeMedia, thumbnail } from "./media";
import {
  clearRange,
  clipDuration,
  clipEnd,
  DEFAULT_TEXT,
  defaultParams,
  emptyProject,
  evalParam,
  isVisual,
  NEUTRAL_COLOR,
  newId,
  parseSrt,
  previousClip,
  projectDuration,
  toSrt,
  TRANSITIONS,
  SEQUENCE_PRESETS,
  setParam,
  splitClip,
  STILL_SECONDS,
  timecode,
  type Clip,
  type MediaItem,
  type Project,
  type Sequence,
} from "./model";
import { encodeLut, parseCube } from "./lut";
import { Timeline, type TimelineTool } from "./Timeline";

const PROJECT_FILTER = { name: "바코 오로라 프로젝트", extensions: ["bvid"] };
const AUTOSAVE_MS = 20_000;

const TOUR_STEPS: TourStep[] = [
  { title: "바코 오로라에 오신 걸 환영해요! 🎬", body: "프리미어 프로처럼 여러 트랙에 영상, 사진, 소리, 글자를 쌓아서 편집하는 프로그램이에요. 1분이면 기본을 익혀요." },
  { title: "1. 미디어 가져오기", target: ".bin", body: "영상, 사진, 음악 파일을 창에 끌어다 놓거나 ‘가져오기’를 눌러요. 여기 모인 파일을 아래 타임라인으로 끌어다 놓으면 편집이 시작돼요. 더블클릭하면 재생 위치에 바로 들어가요." },
  { title: "2. 타임라인", target: ".tl", body: "위쪽 V 트랙은 화면(위에 있을수록 앞에 보여요), 아래 A 트랙은 소리예요. 클립을 끌어 옮기고, 가장자리를 끌어 잘라요. C 를 누르면 자르기 도구, V 는 선택 도구예요. Ctrl+휠로 확대해요." },
  { title: "3. 효과 컨트롤", target: ".suite-side .suite-panel:first-of-type", body: "클립을 고르면 여기서 위치, 크기, 불투명도, 볼륨, 속도, 색 보정, 페이드를 바꿔요. 숫자는 좌우로 끌면 바뀌어요. ⏱ 를 켜고 재생 위치를 옮겨 가며 값을 바꾸면 움직이는 효과(키프레임)가 돼요." },
  { title: "4. 프로그램 모니터", target: ".monitor", body: "편집한 결과가 여기 보여요. Space 재생, ← → 한 프레임, J/K/L 되감기·멈춤·재생. I, O 로 내보낼 범위를 정하고, 고른 클립은 화면에서 끌어 옮길 수 있어요." },
  { title: "5. 내보내기", target: ".export-button", body: "다 만들었으면 ‘내보내기’(Ctrl+M)로 MP4 영상을 만들어요. 유튜브, 디스코드, 휴대폰 어디서나 열려요. 프로젝트는 Ctrl+S 로 저장해 두면 나중에 이어서 편집할 수 있어요." },
];

const baseName = (path: string) => path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");

function makeClip(media: MediaItem, track: string, start: number): Clip {
  const still = media.kind === "image";
  return {
    id: newId(),
    kind: media.kind,
    mediaId: media.id,
    name: media.name,
    track,
    start,
    in: 0,
    out: still ? STILL_SECONDS : media.duration,
    speed: 1,
    params: defaultParams(),
    color: { ...NEUTRAL_COLOR },
    fadeIn: 0,
    fadeOut: 0,
  };
}

export function App() {
  const history = useHistory<Project>(emptyProject(), 100);
  const project = history.state;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engine = useRef<Engine | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tool, setTool] = useState<TimelineTool>("select");
  const [snapping, setSnapping] = useState(true);
  const [pxPerSec, setPxPerSec] = useState(40);
  const [previewScale, setPreviewScale] = useState(0.5);
  const [safeMargins, setSafeMargins] = useState(false);
  const [scopesOpen, setScopesOpen] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState<{ ratio: number; signal: { cancel: boolean }; exact?: boolean } | null>(null);
  const [tracking, setTracking] = useState<{ ratio: number; signal: { cancel: boolean } } | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [binTab, setBinTab] = useState<"media" | "effects">("media");
  const [filePath, setFilePath] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const clipboard = useRef<Clip[]>([]);
  const shuttle = useRef(0);
  const [toast, notify] = useToast(4500);
  const tour = useTour("video-v2");
  const updater = useUpdater(notify);
  const duration = projectDuration(project);
  const fps = project.sequence.fps;
  const frame = 1 / fps;
  const selectedClips = project.clips.filter((c) => selected.has(c.id));
  const focus = selectedClips.length === 1 ? selectedClips[0] : null;
  const name = filePath ? baseName(filePath) : "제목 없음";

  // ---------- 엔진 ----------

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
    if (!engine.current) return;
    engine.current.previewScale = previewScale;
    if (!engine.current.isPlaying) engine.current.draw();
  }, [previewScale]);
  // 오디오 미터
  useEffect(() => {
    if (!playing) return setLevel(0);
    let raf = 0;
    const loop = () => {
      setLevel(engine.current?.level() ?? 0);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const seek = useCallback((t: number) => {
    engine.current?.stop();
    shuttle.current = 0;
    engine.current?.seek(Math.max(0, t));
  }, []);

  // ---------- 제목, 닫기 경고, 자동 저장 ----------

  useEffect(() => {
    document.title = `${history.dirty ? "● " : ""}${name} - 바코 오로라`;
    window.suite?.window.setDirty(history.dirty);
  }, [history.dirty, name]);

  useEffect(() => {
    const autosave = window.suite?.autosave;
    if (!autosave) return;
    void autosave.read().then((saved) => {
      if (!saved) return;
      const when = new Date(saved.time).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
      if (window.confirm(`지난번에 프로그램이 저장하지 않은 채로 꺼졌어요 (${when}).\n그때 편집하던 것을 다시 불러올까요?`)) {
        try {
          history.reset(JSON.parse(saved.text) as Project, true);
          notify("지난 작업을 되살렸어요. 잊지 말고 저장해 주세요 (Ctrl+S).");
        } catch {
          notify("자동 저장본이 망가져서 불러오지 못했어요.");
        }
      }
      void autosave.write(null);
    });
    const clear = () => void autosave.write(null);
    window.addEventListener("pagehide", clear);
    return () => window.removeEventListener("pagehide", clear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const autosave = window.suite?.autosave;
    if (!autosave) return;
    if (!history.dirty) return void autosave.write(null);
    const timer = setInterval(() => void autosave.write(JSON.stringify(history.get())), AUTOSAVE_MS);
    return () => clearInterval(timer);
  }, [history, history.dirty]);

  // ---------- 파일 ----------

  const confirmDiscard = () => !history.dirty || window.confirm("저장하지 않은 편집이 사라져요. 계속할까요?");

  const newProject = (sequence: Sequence) => {
    history.reset(emptyProject(sequence));
    setFilePath(null);
    setSelected(new Set());
    seek(0);
    setNewOpen(false);
  };

  const openProject = async () => {
    if (!window.suite || !confirmDiscard()) return;
    const r = await window.suite.files.open({ filters: [PROJECT_FILTER] });
    if (!r.ok) return r.reason === "error" && notify(`열지 못했어요. ${r.message ?? ""}`);
    try {
      const p = JSON.parse(r.text) as Project;
      if (p.app !== "video" || p.version !== 2) throw new Error();
      history.reset(p);
      setFilePath(r.path);
      setSelected(new Set());
      seek(0);
      // 옮겨졌거나 지워진 파일이 있는지 알려 준다.
      const missing: string[] = [];
      await Promise.all(p.media.map((m) => window.suite!.files.read(m.path).then((b) => b === null && missing.push(m.name)).catch(() => {})));
      if (missing.length) notify(`찾을 수 없는 파일이 있어요: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? " 외" : ""}. 옮기거나 지웠는지 확인해 주세요.`);
    } catch {
      notify("바코 오로라 프로젝트 파일이 아니에요.");
    }
  };

  const saveProject = async (as = false) => {
    if (!window.suite) return;
    const r = await window.suite.files.save({
      path: as ? undefined : (filePath ?? undefined),
      defaultName: `${name}.bvid`,
      filters: [PROJECT_FILTER],
      data: JSON.stringify(history.get()),
    });
    if (r.ok) {
      setFilePath(r.path);
      history.markSaved();
      notify("프로젝트를 저장했어요.");
    } else if (r.reason === "error") notify(`저장하지 못했어요. ${r.message ?? ""}`);
  };

  // ---------- 미디어 ----------

  /** 경로들을 프로젝트에 가져온다. 이미 있는 파일은 다시 넣지 않는다. */
  const importPaths = useCallback(
    async (paths: string[]): Promise<MediaItem[]> => {
      const added: MediaItem[] = [];
      const failed: string[] = [];
      for (const path of paths) {
        const existing = history.get().media.find((m) => m.path === path);
        if (existing) {
          added.push(existing);
          continue;
        }
        try {
          added.push(await probeMedia(path));
        } catch {
          failed.push(baseName(path));
        }
      }
      const fresh = added.filter((m) => !history.get().media.some((x) => x.id === m.id));
      if (fresh.length) history.set((p) => ({ ...p, media: [...p.media, ...fresh] }));
      if (failed.length) notify(`열 수 없는 파일: ${failed.join(", ")}. mp4·mov·webm 영상, png·jpg 사진, mp3·wav 소리를 써 주세요.`);
      return added;
    },
    [history, notify],
  );

  const importDialog = async () => {
    if (!window.suite) return;
    const paths = await window.suite.files.pick({ filters: [MEDIA_FILTER], multiple: true });
    const added = await importPaths(paths);
    // 첫 편집이면 바로 타임라인에 이어 붙여 준다.
    if (added.length && history.get().clips.length === 0) appendToTimeline(added);
  };

  /** 클립 하나를 트랙의 t 에 덮어쓰기로 놓는다 */
  const placeClip = (p: Project, clip: Clip): Project => ({
    ...p,
    clips: [...clearRange(p.clips, clip.track, clip.start, clipEnd(clip)), clip],
  });

  const defaultTrack = (p: Project, kind: "video" | "audio") => {
    const list = p.tracks.filter((t) => t.kind === kind && !t.locked);
    return kind === "video" ? list[list.length - 1] : list[0];
  };

  /** 미디어 여러 개를 타임라인 끝에 차례로 붙인다 (사진, 영상은 V1, 소리는 A1) */
  const appendToTimeline = (media: MediaItem[]) => {
    history.set((p) => {
      let next = p;
      for (const m of media) {
        const track = defaultTrack(next, m.kind === "audio" ? "audio" : "video");
        if (!track) continue;
        const end = next.clips.filter((c) => c.track === track.id).reduce((n, c) => Math.max(n, clipEnd(c)), 0);
        next = placeClip(next, makeClip(m, track.id, end));
      }
      return next;
    });
  };

  const dropMedia = (mediaId: string, trackId: string, t: number) => {
    const media = project.media.find((m) => m.id === mediaId);
    if (!media) return;
    const clip = makeClip(media, trackId, t);
    history.set((p) => placeClip(p, clip));
    setSelected(new Set([clip.id]));
  };

  /** 재생 위치에 덮어쓰기 (더블클릭, .) */
  const overwriteAtPlayhead = (media: MediaItem) => {
    const track = defaultTrack(project, media.kind === "audio" ? "audio" : "video");
    if (!track) return notify("잠기지 않은 트랙이 없어요.");
    dropMedia(media.id, track.id, time);
  };

  /** 글자, 색 매트, 조정 레이어: 가장 위 영상 트랙(V3)의 재생 위치에 */
  const addGenerated = (kind: "text" | "color" | "adjust") => {
    const track = project.tracks.find((t) => t.kind === "video" && !t.locked);
    if (!track) return notify("잠기지 않은 영상 트랙이 없어요.");
    const clip: Clip = {
      id: newId(),
      kind,
      name: kind === "text" ? "글자" : kind === "adjust" ? "조정 레이어" : "색 매트",
      track: kind === "color" ? defaultTrack(project, "video")!.id : track.id,
      start: time,
      in: 0,
      out: STILL_SECONDS,
      speed: 1,
      params: defaultParams(),
      color: { ...NEUTRAL_COLOR },
      fadeIn: 0,
      fadeOut: 0,
      ...(kind === "text" ? { text: { ...DEFAULT_TEXT } } : kind === "color" ? { fill: "#1b1f2e" } : {}),
    };
    history.set((p) => placeClip(p, clip));
    setSelected(new Set([clip.id]));
    if (kind === "text") {
      requestAnimationFrame(() => {
        const box = document.querySelector<HTMLTextAreaElement>(".fx-text");
        box?.focus();
        box?.select();
      });
    }
  };

  // 파일을 창에 끌어다 놓기
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const drop = async (e: DragEvent) => {
      if (!e.dataTransfer?.files.length || !window.suite) return;
      e.preventDefault();
      const paths = Array.from(e.dataTransfer.files)
        .map((f) => window.suite!.files.pathOf(f))
        .filter((p) => p && kindOf(p));
      const projectFile = Array.from(e.dataTransfer.files).find((f) => f.name.endsWith(".bvid"));
      if (projectFile) return notify("프로젝트는 파일 → 프로젝트 열기(Ctrl+O)로 열어 주세요.");
      const added = await importPaths(paths);
      if (added.length && history.get().clips.length === 0) appendToTimeline(added);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  });

  // ---------- 편집 ----------

  const updateClip = (c: Clip, mode: "preview" | "set") =>
    (mode === "preview" ? history.preview : history.set)((p) => ({ ...p, clips: p.clips.map((x) => (x.id === c.id ? c : x)) }));

  const unlocked = (c: Clip) => !project.tracks.find((t) => t.id === c.track)?.locked;

  /** Ctrl+K: 재생 위치에서 자르기. 고른 클립이 있으면 그것만, 없으면 모든 트랙 */
  const cutAtPlayhead = () => {
    const targets = (selectedClips.length ? selectedClips : project.clips).filter(unlocked);
    let clips = project.clips;
    let count = 0;
    for (const c of targets) {
      const parts = splitClip(c, time);
      if (!parts) continue;
      clips = clips.flatMap((x) => (x.id === c.id ? parts : [x]));
      count++;
    }
    if (!count) return notify("재생 위치에 자를 클립이 없어요.");
    history.set({ ...project, clips });
  };

  /** Delete: 고른 클립 빼기 (빈자리는 그대로). ripple 이면 뒤에 있는 클립을 당겨서 빈자리를 없앤다 (Shift+Delete). */
  const deleteSelected = (ripple: boolean) => {
    const victims = selectedClips.filter(unlocked);
    if (!victims.length) return;
    history.set((p) => {
      let clips = p.clips.filter((c) => !victims.some((v) => v.id === c.id));
      if (ripple) {
        for (const v of [...victims].sort((a, b) => b.start - a.start)) {
          const gap = clipDuration(v);
          clips = clips.map((c) => (c.track === v.track && c.start >= v.start ? { ...c, start: Math.max(0, c.start - gap) } : c));
        }
      }
      return { ...p, clips };
    });
    setSelected(new Set());
  };

  const copy = () => {
    if (!selectedClips.length) return;
    clipboard.current = selectedClips;
    notify(`클립 ${selectedClips.length}개를 복사했어요. 재생 위치에서 Ctrl+V 로 붙여 넣어요.`);
  };

  const paste = () => {
    const items = clipboard.current;
    if (!items.length) return;
    const first = Math.min(...items.map((c) => c.start));
    const pasted = items.map((c) => ({ ...c, id: newId(), start: time + (c.start - first) }));
    history.set((p) => pasted.reduce(placeClip, p));
    setSelected(new Set(pasted.map((c) => c.id)));
  };

  /** Ctrl+D: 기본 전환. 바로 앞에 붙은 클립이 있으면 교차 디졸브, 없으면 앞뒤 0.5초 페이드 */
  const defaultTransition = () => {
    if (!selectedClips.length) return notify("먼저 전환을 넣을 클립을 골라 주세요.");
    const p = history.get();
    const dissolve = new Set(selectedClips.filter((c) => isVisual(c) && previousClip(p, c)).map((c) => c.id));
    history.set({
      ...p,
      clips: p.clips.map((c) => {
        if (!selected.has(c.id)) return c;
        if (dissolve.has(c.id)) return { ...c, transitionIn: { kind: "dissolve", duration: Math.min(1, clipDuration(c) / 2) } };
        return { ...c, fadeIn: Math.min(0.5, clipDuration(c) / 3), fadeOut: Math.min(0.5, clipDuration(c) / 3) };
      }),
    });
    notify(dissolve.size ? `교차 디졸브 ${dissolve.size}개를 넣었어요. 효과 컨트롤에서 종류와 길이를 바꿀 수 있어요.` : "앞뒤에 페이드를 넣었어요.");
  };

  const removeTransitions = () =>
    history.set((p) => ({ ...p, clips: p.clips.map((c) => (selected.has(c.id) ? { ...c, transitionIn: undefined, fadeIn: 0, fadeOut: 0 } : c)) }));

  // ---------- LUT ----------

  /** .cube 를 읽어 프로젝트에 넣고, 고른 클립에 바로 입힌다 */
  const importLut = async (target: Clip) => {
    if (!window.suite) return;
    const r = await window.suite.files.open({ filters: [{ name: "3D LUT", extensions: ["cube"] }] });
    if (!r.ok) return r.reason === "error" && notify(`열지 못했어요. ${r.message ?? ""}`);
    let table;
    try {
      table = parseCube(r.text);
    } catch (e) {
      return notify(`LUT 을 읽지 못했어요. ${(e as Error).message}`);
    }
    const name = baseName(r.path);
    const asset = { id: newId(), name, size: table.size, data: encodeLut(table) };
    history.set((p) => ({
      ...p,
      luts: [...(p.luts ?? []), asset],
      clips: p.clips.map((c) => (c.id === target.id ? { ...c, color: { ...c.color, lut: asset.id, lutAmount: c.color.lutAmount ?? 100 } } : c)),
    }));
    notify(`LUT ‘${name}’ 을 넣었어요.`);
  };

  // ---------- 자막 (SRT) ----------

  /** SRT 를 읽어 줄마다 글자 클립을 가장 위 영상 트랙에 넣는다 */
  const importSubtitles = async () => {
    if (!window.suite) return;
    const r = await window.suite.files.open({ filters: [{ name: "자막 파일", extensions: ["srt"] }] });
    if (!r.ok) return r.reason === "error" && notify(`열지 못했어요. ${r.message ?? ""}`);
    const cues = parseSrt(r.text);
    if (!cues.length) return notify("자막을 찾지 못했어요. SRT 파일이 맞는지 확인해 주세요.");
    // 자막 시간에 다른 클립이 없는 가장 위 트랙 (모두 차 있으면 맨 위 트랙에 덮어쓴다)
    const tracks = project.tracks.filter((t) => t.kind === "video" && !t.locked);
    const free = (id: string) => !project.clips.some((c) => c.track === id && cues.some((q) => c.start < q.end && clipEnd(c) > q.start));
    const track = tracks.find((t) => free(t.id)) ?? tracks[0];
    if (!track) return notify("잠기지 않은 영상 트랙이 없어요.");
    const { height } = project.sequence;
    const clips: Clip[] = cues.map((cue) => ({
      id: newId(),
      kind: "text",
      name: "자막",
      track: track.id,
      start: cue.start,
      in: 0,
      out: cue.end - cue.start,
      speed: 1,
      params: { ...defaultParams(), y: { value: height * 0.36 } },
      color: { ...NEUTRAL_COLOR },
      fadeIn: 0,
      fadeOut: 0,
      text: { ...DEFAULT_TEXT, text: cue.text, size: Math.round(height * 0.055), stroke: 8, bold: true },
    }));
    history.set((p) => ({ ...p, clips: clips.reduce((all, c) => [...clearRange(all, c.track, c.start, clipEnd(c)), c], p.clips) }));
    notify(`자막 ${clips.length}줄을 ${track.name} 트랙에 넣었어요. 하나를 고르고 효과 컨트롤에서 모양을 바꿀 수 있어요.`);
  };

  /** 글자 클립을 시간 순서대로 SRT 로 (유튜브에 자막 파일로 올릴 수 있게) */
  const exportSubtitles = async () => {
    if (!window.suite) return;
    const cues = project.clips
      .filter((c) => c.kind === "text" && c.text?.text.trim())
      .sort((a, b) => a.start - b.start)
      .map((c) => ({ start: c.start, end: clipEnd(c), text: c.text!.text.trim() }));
    if (!cues.length) return notify("내보낼 글자 클립이 없어요.");
    const r = await window.suite.files.save({ defaultName: `${name}.srt`, filters: [{ name: "자막 파일", extensions: ["srt"] }], data: toSrt(cues) });
    if (r.ok) notify(`자막 ${cues.length}줄을 저장했어요. 유튜브 스튜디오의 ‘자막 → 파일 업로드’에 올릴 수 있어요.`);
    else if (r.reason === "error") notify(`저장하지 못했어요. ${r.message ?? ""}`);
  };

  /** 편집점(클립 앞뒤) 사이 이동 */
  const editPoints = () => [...new Set([0, ...project.clips.flatMap((c) => [c.start, clipEnd(c)])])].sort((a, b) => a - b);
  const jumpEdit = (dir: 1 | -1) => {
    const pts = editPoints();
    const target = dir > 0 ? pts.find((t) => t > time + 1e-3) : [...pts].reverse().find((t) => t < time - 1e-3);
    if (target !== undefined) seek(target);
  };

  /** 마커를 유튜브 설명란에 붙일 챕터 목록으로 (0:00 부터, 3개 이상, 10초 이상씩이어야 유튜브가 챕터로 보여 준다) */
  const copyChapters = async () => {
    const sorted = [...project.markers].sort((a, b) => a.t - b.t);
    const list = sorted[0] && sorted[0].t < 0.5 ? sorted.map((m) => ({ t: m.t, label: m.label })) : [{ t: 0, label: "시작" }, ...sorted.map((m) => ({ t: m.t, label: m.label }))];
    const stamp = (t: number) => {
      const s = Math.floor(t);
      const h = Math.floor(s / 3600);
      const mm = Math.floor((s % 3600) / 60);
      const ss = String(s % 60).padStart(2, "0");
      return h ? `${h}:${String(mm).padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
    };
    const text = list.map((c, i) => `${i === 0 ? "0:00" : stamp(c.t)} ${c.label}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt("이 글을 복사해 유튜브 설명란에 붙여 넣어요", text);
      return;
    }
    const short = list.some((c, i) => i > 0 && c.t - list[i - 1].t < 10) || (duration > 0 && duration - list[list.length - 1].t < 10);
    notify(
      list.length < 3
        ? "복사했어요. 유튜브는 챕터가 3개 이상이어야 보여 줘요. 마커를 더 넣어 보세요."
        : short
          ? "복사했어요. 10초보다 짧은 챕터가 있으면 유튜브가 챕터를 안 보여 줄 수 있어요."
          : `챕터 ${list.length}개를 복사했어요. 유튜브 설명란에 붙여 넣으세요 (마커를 두 번 누르면 이름을 바꿔요).`,
    );
  };

  /** 모션 트래킹: 고른 클립이 그 아래 영상 속 물체를 따라가게 위치 키프레임을 만든다 */
  const runTracking = async (boxFrac: number) => {
    if (!requirePro("모션 트래킹")) return;
    const c = focus;
    const e = engine.current;
    if (!c || !e || !isVisual(c) || c.kind === "adjust") return notify("따라 움직일 글자, 사진, 영상 클립을 하나 골라 주세요.");
    if (time < c.start || time >= clipEnd(c) - 1 / project.sequence.fps) return notify("재생 위치를 그 클립이 보이는 곳에 두고, 클립을 따라갈 물체 위에 올려 둔 다음 해 주세요.");
    e.stop();
    const from = time;
    const signal = { cancel: false };
    setTracking({ ratio: 0, signal });
    // 클립 자신은 빼고 그 아래 화면에서 찾는다
    e.setProject({ ...project, clips: project.clips.filter((x) => x.id !== c.id) });
    try {
      const r = await trackMotion(e, project, c, from, boxFrac, (ratio) => setTracking({ ratio, signal }), signal);
      if (r.keys.length < 2) {
        notify(signal.cancel ? "멈췄어요." : "바로 다음 프레임에서 물체를 놓쳤어요. 물체 크기를 바꾸거나 무늬가 뚜렷한 곳에서 다시 해 주세요.");
        return;
      }
      const local0 = from - c.start;
      const merge = (old: { t: number; v: number }[] | undefined, fresh: { t: number; v: number }[]) => [...(old ?? []).filter((k) => k.t < local0 - 1e-4), ...fresh];
      history.set((p) => ({
        ...p,
        clips: p.clips.map((x) =>
          x.id === c.id
            ? {
                ...x,
                params: {
                  ...x.params,
                  x: { value: r.keys[0].x, keys: merge(x.params.x.keys, r.keys.map((k) => ({ t: k.t, v: k.x }))) },
                  y: { value: r.keys[0].y, keys: merge(x.params.y.keys, r.keys.map((k) => ({ t: k.t, v: k.y }))) },
                },
              }
            : x,
        ),
      }));
      const secs = (r.keys[r.keys.length - 1].t - r.keys[0].t).toFixed(1);
      notify(
        r.lostAt !== null
          ? `${secs}초 동안 따라가다 물체를 놓쳤어요 (가려졌거나 너무 빨라요). 거기서부터 다시 하면 이어서 따라가요.`
          : signal.cancel
            ? `${secs}초까지 따라갔어요.`
            : `${secs}초 동안 물체를 따라가요 (위치 키프레임 ${r.keys.length}개). 효과 컨트롤에서 고칠 수 있어요.`,
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    } finally {
      e.setProject(history.get());
      e.seek(from);
      setTracking(null);
    }
  };

  const addMarker = () =>
    history.set((p) => ({ ...p, markers: [...p.markers, { id: newId(), t: time, label: `마커 ${p.markers.length + 1}`, color: "#4fd1c5" }] }));

  const togglePlay = () => {
    const e = engine.current;
    if (!e) return;
    shuttle.current = 0;
    if (e.isPlaying) e.stop();
    else e.play(time >= duration - 0.05 ? 0 : time);
  };

  /** L: 앞으로 재생, 누를수록 빠르게 (1→2→4배). K: 멈춤. J: 1초씩 뒤로 */
  const shuttleForward = () => {
    shuttle.current = Math.min(4, shuttle.current ? shuttle.current * 2 : 1);
    engine.current?.play(time, duration, shuttle.current);
  };

  const fitTimeline = () => {
    const el = document.querySelector(".tl");
    if (el) setPxPerSec(Math.max(2, (el.clientWidth - 160) / Math.max(duration, 5)));
  };

  const snapshot = async () => {
    const e = engine.current;
    if (!e || !window.suite) return;
    const blob = await e.snapshot();
    const r = await window.suite.files.save({
      defaultName: `${name} ${timecode(time, fps).replace(/:/g, "-")}.png`,
      filters: [{ name: "PNG 그림", extensions: ["png"] }],
      data: new Uint8Array(await blob.arrayBuffer()),
    });
    if (r.ok) notify("지금 화면을 그림으로 저장했어요. 유튜브 썸네일로 써 보세요.");
  };

  // ---------- 모니터에서 끌어 옮기기 ----------

  const monitorDrag = useRef<{ x: number; y: number; clip: Clip; px: number; py: number } | null>(null);
  const onMonitorDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!focus || !isVisual(focus) || focus.kind === "adjust" || !unlocked(focus)) return;
    const local = time - focus.start;
    if (local < 0 || local > clipDuration(focus)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    monitorDrag.current = { x: e.clientX, y: e.clientY, clip: focus, px: evalParam(focus.params.x, local), py: evalParam(focus.params.y, local) };
  };
  const onMonitorMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = monitorDrag.current;
    if (!d) return;
    const rect = e.currentTarget.getBoundingClientRect();
    // 캔버스가 화면에 줄어 보이는 비율만큼 키워서 시퀀스 좌표로
    const k = project.sequence.width / Math.min(rect.width, (rect.height * project.sequence.width) / project.sequence.height);
    const local = time - d.clip.start;
    const c = d.clip;
    updateClip(
      {
        ...c,
        params: {
          ...c.params,
          x: setParam(c.params.x, local, Math.round(d.px + (e.clientX - d.x) * k)),
          y: setParam(c.params.y, local, Math.round(d.py + (e.clientY - d.y) * k)),
        },
      },
      "preview",
    );
  };
  const onMonitorUp = () => {
    if (monitorDrag.current) history.commit();
    monitorDrag.current = null;
  };

  // ---------- 단축키 (프리미어 기본값) ----------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && t.type !== "range") || isTourOpen() || exporting || searchOpen) return;
      const key = e.key.toLowerCase();
      if (key === "f3") {
        e.preventDefault();
        return setSearchOpen(true);
      }
      if (e.ctrlKey || e.metaKey) {
        const map: Record<string, () => void> = {
          z: () => (e.shiftKey ? history.redo() : history.undo()),
          y: history.redo,
          s: () => void saveProject(e.shiftKey),
          o: () => void openProject(),
          n: () => confirmDiscard() && setNewOpen(true),
          i: () => void importDialog(),
          m: () => setExportOpen(true),
          k: cutAtPlayhead,
          c: copy,
          v: paste,
          d: defaultTransition,
          t: () => addGenerated("text"),
          a: () => setSelected(new Set(project.clips.map((c) => c.id))),
        };
        if (map[key]) {
          e.preventDefault();
          map[key]();
        }
        return;
      }
      const step = e.shiftKey ? frame * 5 : frame;
      const actions: Record<string, () => void> = {
        " ": togglePlay,
        arrowleft: () => seek(time - step),
        arrowright: () => seek(Math.min(duration, time + step)),
        arrowup: () => jumpEdit(-1),
        arrowdown: () => jumpEdit(1),
        home: () => seek(0),
        end: () => seek(duration),
        j: () => seek(time - 1),
        k: () => {
          shuttle.current = 0;
          engine.current?.stop();
        },
        l: shuttleForward,
        i: () => history.set((p) => ({ ...p, inPoint: time, outPoint: p.outPoint !== null && p.outPoint <= time ? null : p.outPoint })),
        o: () => history.set((p) => ({ ...p, outPoint: time, inPoint: p.inPoint !== null && p.inPoint >= time ? null : p.inPoint })),
        m: addMarker,
        v: () => setTool("select"),
        c: () => setTool("razor"),
        s: () => setSnapping((s) => !s),
        delete: () => deleteSelected(e.shiftKey),
        backspace: () => deleteSelected(e.shiftKey),
        "=": () => setPxPerSec((p) => Math.min(800, p * 1.4)),
        "+": () => setPxPerSec((p) => Math.min(800, p * 1.4)),
        "-": () => setPxPerSec((p) => Math.max(2, p / 1.4)),
        "\\": fitTimeline,
        ".": () => {
          const m = project.media[project.media.length - 1];
          if (m) overwriteAtPlayhead(m);
        },
        escape: () => setSelected(new Set()),
      };
      if (actions[key]) {
        e.preventDefault();
        actions[key]();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---------- 메뉴 ----------

  const menus: Menu[] = [
    {
      label: "파일",
      items: [
        { label: "새 프로젝트…", shortcut: "Ctrl+N", onSelect: () => confirmDiscard() && setNewOpen(true) },
        { label: "프로젝트 열기…", shortcut: "Ctrl+O", onSelect: () => void openProject() },
        { label: "저장", shortcut: "Ctrl+S", onSelect: () => void saveProject() },
        { label: "다른 이름으로 저장…", shortcut: "Ctrl+Shift+S", onSelect: () => void saveProject(true) },
        { label: "미디어 가져오기…", shortcut: "Ctrl+I", onSelect: () => void importDialog() },
        { label: "내보내기 (MP4 영상)…", shortcut: "Ctrl+M", onSelect: () => setExportOpen(true) },
        { label: "지금 화면을 그림으로 저장 (썸네일)", onSelect: () => void snapshot() },
        { label: "자막 가져오기 (SRT)…", onSelect: () => void importSubtitles() },
        { label: "자막 내보내기 (SRT)…", onSelect: () => void exportSubtitles() },
      ],
    },
    {
      label: "편집",
      items: [
        { label: "실행 취소", shortcut: "Ctrl+Z", disabled: !history.canUndo, onSelect: history.undo },
        { label: "다시 실행", shortcut: "Ctrl+Y", disabled: !history.canRedo, onSelect: history.redo },
        { label: "복사", shortcut: "Ctrl+C", disabled: !selectedClips.length, onSelect: copy },
        { label: "붙여넣기 (재생 위치에)", shortcut: "Ctrl+V", onSelect: paste },
        { label: "지우기 (빈자리 남기기)", shortcut: "Delete", disabled: !selectedClips.length, onSelect: () => deleteSelected(false) },
        { label: "잔물결 지우기 (빈자리 당기기)", shortcut: "Shift+Delete", disabled: !selectedClips.length, onSelect: () => deleteSelected(true) },
        { label: "모두 고르기", shortcut: "Ctrl+A", onSelect: () => setSelected(new Set(project.clips.map((c) => c.id))) },
      ],
    },
    {
      label: "클립",
      items: [
        { label: "재생 위치에서 자르기", shortcut: "Ctrl+K", onSelect: cutAtPlayhead },
        { label: "기본 전환 넣기 (교차 디졸브)", shortcut: "Ctrl+D", disabled: !selectedClips.length, onSelect: defaultTransition },
        { label: "전환·페이드 지우기", disabled: !selectedClips.length, onSelect: removeTransitions },
        { label: "전환 고르기 (효과 탭)", onSelect: () => setBinTab("effects") },
        { label: "글자 넣기", shortcut: "Ctrl+T", onSelect: () => addGenerated("text") },
        { label: "색 매트 넣기", onSelect: () => addGenerated("color") },
        { label: "조정 레이어 넣기", onSelect: () => addGenerated("adjust") },
        { label: "모션 트래킹: 작은 물체 따라가기 (얼굴, 공)", disabled: !focus, onSelect: () => void runTracking(0.06) },
        { label: "모션 트래킹: 큰 물체 따라가기 (사람, 차)", disabled: !focus, onSelect: () => void runTracking(0.14) },
      ],
    },
    {
      label: "시퀀스",
      items: [
        { label: "시작 표시 (In)", shortcut: "I", onSelect: () => history.set((p) => ({ ...p, inPoint: time })) },
        { label: "끝 표시 (Out)", shortcut: "O", onSelect: () => history.set((p) => ({ ...p, outPoint: time })) },
        { label: "시작·끝 표시 지우기", disabled: project.inPoint === null && project.outPoint === null, onSelect: () => history.set((p) => ({ ...p, inPoint: null, outPoint: null })) },
        { label: "마커 넣기", shortcut: "M", onSelect: addMarker },
        { label: "마커로 유튜브 챕터 만들기 (복사)", disabled: !project.markers.length, onSelect: () => void copyChapters() },
        { label: `스냅 (자석) ${snapping ? "끄기" : "켜기"}`, shortcut: "S", onSelect: () => setSnapping(!snapping) },
        { label: "선택 도구", shortcut: "V", onSelect: () => setTool("select") },
        { label: "자르기 도구", shortcut: "C", onSelect: () => setTool("razor") },
        { label: "타임라인 확대", shortcut: "=", onSelect: () => setPxPerSec((p) => Math.min(800, p * 1.4)) },
        { label: "타임라인 축소", shortcut: "-", onSelect: () => setPxPerSec((p) => Math.max(2, p / 1.4)) },
        { label: "전체가 보이게", shortcut: "\\", onSelect: fitTimeline },
        ...SEQUENCE_PRESETS.map((s) => ({
          label: `화면 크기: ${s.label}${project.sequence.width === s.sequence.width && project.sequence.height === s.sequence.height && project.sequence.fps === s.sequence.fps ? " ✓" : ""}`,
          onSelect: () => history.set((p) => ({ ...p, sequence: s.sequence })),
        })),
      ],
    },
    {
      label: "보기",
      items: [
        ...[1, 0.5, 0.25].map((s) => ({ label: `재생 화질: ${s === 1 ? "전체" : s === 0.5 ? "1/2" : "1/4"}${previewScale === s ? " ✓" : ""}`, onSelect: () => setPreviewScale(s) })),
        { label: `안전 영역 ${safeMargins ? "숨기기" : "보이기"}`, onSelect: () => setSafeMargins(!safeMargins) },
        { label: `루메트리 범위 (파형 · 벡터스코프) ${scopesOpen ? "숨기기" : "보이기"}`, onSelect: () => setScopesOpen(!scopesOpen) },
      ],
    },
    {
      label: "도움말",
      items: [
        { label: "기능 검색", shortcut: "F3", onSelect: () => setSearchOpen(true) },
        { label: "따라하기 안내 다시 보기", onSelect: tour.start },
        { label: "단축키 보기", onSelect: () => window.alert(SHORTCUTS) },
        { label: "업데이트 확인", onSelect: () => void updater.check(true) },
      ],
    },
  ];

  const aspect = `${project.sequence.width} / ${project.sequence.height}`;

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
              <button className="suite-menubar-action export-button" onClick={() => setExportOpen(true)} disabled={!duration}>
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
        <>
          <Panel title="효과 컨트롤">
            {focus ? (
              <EffectControls
                clip={focus}
                time={time}
                preview={(c) => updateClip(c, "preview")}
                commit={history.commit}
                set={(c) => updateClip(c, "set")}
                onSeek={seek}
                luts={project.luts ?? []}
                onImportLut={() => void importLut(focus)}
              />
            ) : (
              <p className="panel-note">
                {selectedClips.length > 1
                  ? `클립 ${selectedClips.length}개를 골랐어요. 하나만 고르면 여기서 위치, 크기, 색, 속도를 바꿔요.`
                  : "타임라인에서 클립을 고르면 위치, 크기, 불투명도, 볼륨, 속도, 색 보정, 페이드를 바꿀 수 있어요."}
              </p>
            )}
          </Panel>
          {scopesOpen && (
            <Panel title="루메트리 범위">
              <Scopes source={canvasRef} time={time} project={project} playing={playing} />
            </Panel>
          )}
          {aiOpen && (
            <AIAssistantPanel
              app="video"
              greeting="안녕하세요! “재밌는 자막 달아줘”, “처음에 큰 제목 넣어줘”처럼 부탁해 보세요. 글자 클립으로 넣어 드릴게요."
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
        <StatusBar hint={tool === "razor" ? "자르기 도구: 클립을 누르면 그 자리에서 잘려요 (Shift: 모든 트랙) · V 로 선택 도구" : "Space 재생 · J K L · ← → 프레임 · I O 범위 · C 자르기 · Ctrl+K 재생 위치 자르기 · Ctrl+휠 확대 · F3 기능 검색"}>
          <span>
            {history.dirty ? "● " : ""}
            {name}
          </span>
          <span>
            {project.sequence.width}×{project.sequence.height} · {fps}fps
          </span>
          <span>스냅 {snapping ? "켜짐" : "꺼짐"} (S)</span>
          <span>길이 {timecode(duration, fps)}</span>
        </StatusBar>
      }
    >
      <div className="ed">
        <section className="bin">
          <header>
            <div className="bin-tabs">
              <button aria-pressed={binTab === "media"} onClick={() => setBinTab("media")}>
                프로젝트
              </button>
              <button aria-pressed={binTab === "effects"} onClick={() => setBinTab("effects")}>
                효과
              </button>
            </div>
            <button className="mini go" onClick={() => void importDialog()} title="영상, 사진, 소리 가져오기 (Ctrl+I)">
              ＋ 가져오기
            </button>
            <button className="mini" onClick={() => addGenerated("text")} title="재생 위치에 글자 넣기 (Ctrl+T)">
              T 글자
            </button>
            <button className="mini" onClick={() => addGenerated("color")} title="재생 위치에 단색 배경 넣기">
              ■ 색
            </button>
            <button className="mini" onClick={() => addGenerated("adjust")} title="조정 레이어: 아래 트랙 전체에 색 보정과 LUT 을 한 번에">
              ◐ 조정
            </button>
          </header>
          {binTab === "effects" ? (
            <div className="bin-list">
              <p className="panel-note">전환을 끌어서 타임라인의 뒤 클립에 놓아요. 앞 클립 끝에서 그 클립으로 넘어가요.</p>
              <div className="fx-group">영상 전환</div>
              {TRANSITIONS.map((t) => (
                <div
                  key={t.kind}
                  className="fx-item"
                  draggable
                  title={t.hint}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/x-baco-transition", t.kind);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                >
                  <i />
                  <span>
                    {t.label}
                    <small>{t.hint}</small>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="bin-list">
              {project.media.length === 0 && <p className="panel-note bin-empty">영상, 사진, 음악 파일을 이 창에 끌어다 놓거나 ‘가져오기’를 눌러요.</p>}
              {project.media.map((m) => (
                <BinItem key={m.id} media={m} onOpen={() => overwriteAtPlayhead(m)} />
              ))}
            </div>
          )}
        </section>

        <section className="monitor">
          <div className="monitor-screen">
            <div className="monitor-frame" style={{ aspectRatio: aspect, "--ar": project.sequence.width / project.sequence.height } as CSSProperties}>
              <canvas ref={canvasRef} onPointerDown={onMonitorDown} onPointerMove={onMonitorMove} onPointerUp={onMonitorUp} className={focus && isVisual(focus) ? "can-drag" : ""} />
              {safeMargins && <div className="safe-margins" />}
            </div>
            {!project.clips.length && (
              <div className="monitor-empty">
                <p>여기에 편집한 영상이 나와요</p>
                <button className="suite-button" onClick={() => void importDialog()}>
                  ＋ 영상·사진·음악 가져오기
                </button>
              </div>
            )}
          </div>
          <div className="transport">
            <span className="tc">{timecode(time, fps)}</span>
            <div className="transport-buttons">
              <button title="시작 표시 (I)" onClick={() => history.set((p) => ({ ...p, inPoint: time }))}>
                {"{"}
              </button>
              <button title="끝 표시 (O)" onClick={() => history.set((p) => ({ ...p, outPoint: time }))}>
                {"}"}
              </button>
              <button title="앞 편집점 (↑)" onClick={() => jumpEdit(-1)}>
                ⇤
              </button>
              <button title="한 프레임 뒤로 (←)" onClick={() => seek(time - frame)}>
                ◀|
              </button>
              <button className="play" title="재생/멈춤 (Space)" onClick={togglePlay} disabled={!duration}>
                {playing ? "■" : "▶"}
              </button>
              <button title="한 프레임 앞으로 (→)" onClick={() => seek(Math.min(duration, time + frame))}>
                |▶
              </button>
              <button title="다음 편집점 (↓)" onClick={() => jumpEdit(1)}>
                ⇥
              </button>
              <button title="마커 (M)" onClick={addMarker}>
                ⚑
              </button>
              <button title="지금 화면을 그림으로 저장" onClick={() => void snapshot()}>
                📷
              </button>
            </div>
            <select className="res" value={previewScale} title="재생 화질 (끊기면 낮춰요)" onChange={(e) => setPreviewScale(Number(e.target.value))}>
              <option value={1}>전체</option>
              <option value={0.5}>1/2</option>
              <option value={0.25}>1/4</option>
            </select>
            <div className="meter" title="소리 크기">
              <div style={{ height: `${Math.round(level * 100)}%`, background: level > 0.95 ? "#ff6b6b" : level > 0.7 ? "#ffd23f" : "#5fd3a0" }} />
            </div>
            <span className="tc dim">{timecode(duration, fps)}</span>
          </div>
        </section>

        <section className="timeline-area">
          <div className="tl-tools">
            <button aria-pressed={tool === "select"} title="선택 도구 (V)" onClick={() => setTool("select")}>
              ➚
            </button>
            <button aria-pressed={tool === "razor"} title="자르기 도구 (C)" onClick={() => setTool("razor")}>
              ✂
            </button>
            <button aria-pressed={snapping} title="스냅: 클립이 재생 위치, 다른 클립 끝에 착 붙어요 (S)" onClick={() => setSnapping(!snapping)}>
              🧲
            </button>
            <button title="확대 (=)" onClick={() => setPxPerSec((p) => Math.min(800, p * 1.4))}>
              ＋
            </button>
            <button title="축소 (-)" onClick={() => setPxPerSec((p) => Math.max(2, p / 1.4))}>
              －
            </button>
          </div>
          <Timeline
            project={project}
            time={time}
            pxPerSec={pxPerSec}
            setPxPerSec={setPxPerSec}
            tool={tool}
            snapping={snapping}
            selected={selected}
            setSelected={setSelected}
            onSeek={seek}
            preview={(p) => history.preview(p)}
            commit={history.commit}
            set={(p) => history.set(p)}
            onDropMedia={dropMedia}
          />
        </section>
      </div>

      {newOpen && (
        <div className="dialog-dim" onMouseDown={() => setNewOpen(false)}>
          <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
            <h2>새 프로젝트</h2>
            <p>어디에 올릴 영상인가요? 화면 크기는 나중에 ‘시퀀스’ 메뉴에서 바꿀 수 있어요.</p>
            <div className="preset-grid">
              {SEQUENCE_PRESETS.map((s) => (
                <button key={s.label} onClick={() => newProject(s.sequence)}>
                  <span className="preset-shape" style={{ aspectRatio: `${s.sequence.width} / ${s.sequence.height}` }} />
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {exportOpen && (
        <ExportDialog
          project={project}
          name={name}
          onClose={() => setExportOpen(false)}
          onStart={async (opts, fileName) => {
            const e = engine.current;
            if (!e || !window.suite) return;
            setExportOpen(false);
            const signal = { cancel: false };
            setExporting({ ratio: 0, signal });
            try {
              const onProgress = (ratio: number) => setExporting({ ratio, signal, exact: !!opts.exact });
              const t0 = performance.now();
              let data: Uint8Array | null;
              if (opts.exact) {
                e.stop();
                data = await exportExact(e, project, { format: opts.exact, from: opts.from, to: opts.to, scale: opts.scale, videoBitsPerSecond: opts.videoBitsPerSecond }, onProgress, signal);
                e.seek(time);
              } else {
                const blob = await e.record(opts, onProgress, signal);
                data = blob && new Uint8Array(await blob.arrayBuffer());
              }
              setExporting(null);
              if (!data) return notify("내보내기를 멈췄어요.");
              const ext = opts.exact ?? (opts.mimeType.includes("mp4") ? "mp4" : "webm");
              const took = (performance.now() - t0) / 1000;
              const r = await window.suite.files.save({
                defaultName: `${fileName}.${ext}`,
                filters: [{ name: ext === "mp4" ? "MP4 영상" : "WebM 영상", extensions: [ext] }],
                data,
              });
              if (r.ok && opts.exact) notify(`영상을 저장했어요! ${took.toFixed(0)}초 걸렸어요 (영상 길이 ${(opts.to - opts.from).toFixed(0)}초). 프레임 빠짐 없이 정확하게 만들었어요.`);
              else
              if (r.ok) notify("영상을 저장했어요! 유튜브, 디스코드에 바로 올릴 수 있어요.");
              else if (r.reason === "error") notify(`저장하지 못했어요. ${r.message ?? ""}`);
            } catch (err) {
              setExporting(null);
              notify(`영상을 만들지 못했어요. ${String(err)}`);
            }
          }}
        />
      )}

      {tracking && (
        <div className="dialog-dim">
          <div className="dialog export-box">
            <h2>물체를 따라가고 있어요… {Math.round(tracking.ratio * 100)}%</h2>
            <p>프레임마다 클립 아래의 물체를 찾아서 위치 키프레임을 만들어요. 중간에 멈춰도 거기까지는 남아요.</p>
            <div className="bar">
              <div style={{ width: `${tracking.ratio * 100}%` }} />
            </div>
            <div className="dialog-buttons">
              <button className="mini" onClick={() => (tracking.signal.cancel = true)}>
                멈추기
              </button>
            </div>
          </div>
        </div>
      )}
      {exporting && (
        <div className="dialog-dim">
          <div className="dialog export-box">
            <h2>영상을 만들고 있어요… {Math.round(exporting.ratio * 100)}%</h2>
            <p>
              {exporting.exact
                ? "프레임을 하나씩 그려서 정확하게 만들어요. 컴퓨터가 빠르면 영상 길이보다 빨리 끝나요. 이 창을 닫지 말아 주세요."
                : "처음부터 끝까지 재생하면서 녹화해요. 영상 길이만큼 걸려요. 다른 창으로 가려도 괜찮지만 이 창을 닫지 말아 주세요."}
            </p>
            <div className="bar">
              <div style={{ width: `${exporting.ratio * 100}%` }} />
            </div>
            <div className="dialog-buttons">
              <button className="mini" onClick={() => (exporting.signal.cancel = true)}>
                멈추기
              </button>
            </div>
          </div>
        </div>
      )}

      <CommandSearch open={searchOpen} commands={menuCommands(menus)} onClose={() => setSearchOpen(false)} />
      <Toast message={toast} />
      <Tour steps={TOUR_STEPS} open={tour.open} onFinish={tour.finish} />
    </AppFrame>
  );
}

const SHORTCUTS = `재생: Space 재생/멈춤 · J 1초 뒤로 · K 멈춤 · L 재생 (누를수록 2배, 4배)
이동: ← → 한 프레임 (Shift: 5프레임) · ↑ ↓ 앞/다음 편집점 · Home End 처음/끝
전환: Ctrl+D 교차 디졸브 · 왼쪽 ‘효과’ 탭에서 전환을 끌어 클립에 놓기
편집: V 선택 도구 · C 자르기 도구 · Ctrl+K 재생 위치 자르기 · Delete 지우기 · Shift+Delete 빈자리 당기며 지우기
Ctrl+C / Ctrl+V 복사, 붙여넣기 · Ctrl+D 기본 전환(페이드) · Ctrl+T 글자 · . 마지막 미디어를 재생 위치에
표시: I 시작 · O 끝 · M 마커 · S 스냅 켜기/끄기
보기: = - 확대/축소 · \\ 전체 보기 · Ctrl+휠 확대 · 휠 옆으로
파일: Ctrl+N 새 프로젝트 · Ctrl+O 열기 · Ctrl+S 저장 · Ctrl+I 가져오기 · Ctrl+M 내보내기 · F3 기능 검색`;

function BinItem({ media, onOpen }: { media: MediaItem; onOpen: () => void }) {
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => void thumbnail(media).then(setThumb), [media]);
  const icon = media.kind === "video" ? "🎬" : media.kind === "image" ? "🖼" : "🎵";
  return (
    <div
      className="bin-item"
      draggable
      title={`${media.path}\n더블클릭: 재생 위치에 넣기 · 끌어서 타임라인에 놓기`}
      onDoubleClick={onOpen}
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-baco-media", media.id);
        e.dataTransfer.setData(`application/x-baco-${media.kind === "audio" ? "audio" : "video"}`, "1");
        e.dataTransfer.effectAllowed = "copy";
      }}
    >
      <div className={`bin-thumb ${media.kind}`} style={thumb ? { backgroundImage: `url(${thumb})` } : undefined}>
        {!thumb && icon}
      </div>
      <div className="bin-meta">
        <span className="bin-name">{media.name}</span>
        <span className="bin-info">
          {icon} {media.kind === "image" ? `${media.width}×${media.height}` : `${Math.floor(media.duration / 60)}:${String(Math.floor(media.duration % 60)).padStart(2, "0")}`}
          {media.kind === "video" && ` · ${media.width}×${media.height}`}
        </span>
      </div>
    </div>
  );
}

function ExportDialog({
  project,
  name,
  onClose,
  onStart,
}: {
  project: Project;
  name: string;
  onClose: () => void;
  onStart: (opts: Parameters<Engine["record"]>[0], fileName: string) => void;
}) {
  // 정확 내보내기(프레임마다 인코딩)를 먼저, 안 되는 PC 를 위해 실시간 녹화도 남겨 둔다
  const formats = useMemo(
    () => [
      ...(canExportExact()
        ? [
            { label: "MP4 (H.264) · 정확하고 빠르게", mimeType: "exact:mp4" },
            { label: "WebM (VP9) · 정확하고 빠르게", mimeType: "exact:webm" },
          ]
        : []),
      ...exportFormats().map((f) => ({ ...f, label: `${f.label} · 실시간 녹화` })),
    ],
    [],
  );
  const { pro } = useLicense();
  const [format, setFormat] = useState((pro ? formats[0] : formats.find((f) => !f.mimeType.startsWith("exact:")))?.mimeType ?? "");
  const [quality, setQuality] = useState<"high" | "medium" | "small">("high");
  const [scale, setScale] = useState(1);
  const [range, setRange] = useState<"all" | "inout">(project.inPoint !== null || project.outPoint !== null ? "inout" : "all");
  const [fileName, setFileName] = useState(name === "제목 없음" ? "내 영상" : name);
  const duration = projectDuration(project);
  const from = range === "inout" ? (project.inPoint ?? 0) : 0;
  const to = range === "inout" ? (project.outPoint ?? duration) : duration;
  const pixels = project.sequence.width * project.sequence.height * scale * scale;
  const bits = Math.round(pixels * project.sequence.fps * { high: 0.2, medium: 0.11, small: 0.06 }[quality]);
  const sizeMB = ((bits + 192_000) * Math.max(0, to - from)) / 8 / 1024 / 1024;

  return (
    <div className="dialog-dim" onMouseDown={onClose}>
      <div className="dialog export-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h2>내보내기</h2>
        <label className="form-row">
          <span>파일 이름</span>
          <input value={fileName} onChange={(e) => setFileName(e.target.value)} />
        </label>
        <label className="form-row">
          <span>형식</span>
          <select value={format} onChange={(e) => (!e.target.value.startsWith("exact:") || requirePro("정확하고 빠른 내보내기")) && setFormat(e.target.value)}>
            {formats.map((f) => (
              <option key={f.mimeType} value={f.mimeType}>
                {f.label}
                {!pro && f.mimeType.startsWith("exact:") ? " 💎 Pro" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="form-row">
          <span>크기</span>
          <select value={scale} onChange={(e) => setScale(Number(e.target.value))}>
            <option value={1}>
              {project.sequence.width}×{project.sequence.height} (원래 크기)
            </option>
            <option value={0.5}>
              {project.sequence.width / 2}×{project.sequence.height / 2} (절반, 가볍게)
            </option>
          </select>
        </label>
        <label className="form-row">
          <span>화질</span>
          <select value={quality} onChange={(e) => setQuality(e.target.value as typeof quality)}>
            <option value="high">높음 (유튜브 권장)</option>
            <option value="medium">보통</option>
            <option value="small">작은 용량 (디스코드 첨부)</option>
          </select>
        </label>
        <label className="form-row">
          <span>범위</span>
          <select value={range} onChange={(e) => setRange(e.target.value as typeof range)}>
            <option value="all">전체 ({timecode(duration, project.sequence.fps)})</option>
            <option value="inout" disabled={project.inPoint === null && project.outPoint === null}>
              시작~끝 표시 (I~O)
            </option>
          </select>
        </label>
        <p className="export-summary">
          {timecode(to - from, project.sequence.fps)} · {project.sequence.fps}fps · {(bits / 1_000_000).toFixed(1)}Mbps · 약 {sizeMB < 1 ? "1MB 미만" : `${Math.round(sizeMB)}MB`}
          <br />
          {format.startsWith("exact:") ? "프레임을 하나씩 그려 정확하게 만들어요. 빠짐없이 매끄러워요." : "영상 길이만큼 재생하면서 만들어요."}
        </p>
        <div className="dialog-buttons">
          <button className="mini" onClick={onClose}>
            취소
          </button>
          <button
            className="mini go"
            disabled={!format || to - from < 0.1 || !fileName.trim()}
            onClick={() =>
              (!format.startsWith("exact:") || requirePro("정확하고 빠른 내보내기")) &&
              onStart(
                format.startsWith("exact:")
                  ? { mimeType: format, exact: format.slice(6) as "mp4" | "webm", from, to, videoBitsPerSecond: bits, scale }
                  : { mimeType: format, from, to, videoBitsPerSecond: bits, scale },
                fileName.trim(),
              )
            }
          >
            내보내기
          </button>
        </div>
      </div>
    </div>
  );
}
