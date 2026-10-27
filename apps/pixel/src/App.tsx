import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AIAssistantPanel,
  AppFrame,
  CommandSearch,
  MenuBar,
  StatusBar,
  Toast,
  Toolbar,
  Tour,
  UpdateButton,
  isTourOpen,
  menuCommands,
  useToast,
  useTour,
  useUpdater,
  type Menu,
  type TourStep,
} from "@suite/ui";
import { PixelCanvas, type CanvasController } from "./canvas/PixelCanvas";
import { HINTS, isTyping, TOOL_KEYS, TOOLS, type Symmetry, type ToolId } from "./canvas/tools";
import { AI_SYSTEM, AI_TOOL, aiContext, applyAIArt, type AIPixelArt } from "./doc/aiPixel";
import { hexToRgba } from "./doc/color";
import { EXAMPLES } from "./doc/examples";
import { MAX_FRAMES, MAX_LAYERS, PixelDoc } from "./doc/PixelDoc";
import { clearMasked, cutOut, flipRaster, outline, quantize, replaceColor, rotateRaster, shiftMask, stampRaster, type Raster } from "./doc/raster";
import { AdjustDialog, ExportDialog, SizeDialog } from "./Dialogs";
import { NewFileDialog } from "./NewFileDialog";
import { ColorPanel } from "./panels/ColorPanel";
import { PreviewPanel } from "./panels/PreviewPanel";
import { Timeline } from "./panels/Timeline";
import { useAutosave } from "./useAutosave";
import { useFile, type ExportOptions } from "./useFile";

const TOUR_STEPS: TourStep[] = [
  { title: "바코 눈꽃에 오신 걸 환영해요! 👋", body: "에이스프라이트처럼 픽셀 그림과 움직이는 스프라이트를 만드는 프로그램이에요. 아이콘, 게임 캐릭터, 로블록스 데칼·파티클을 만들 수 있어요." },
  { title: "칠하기", target: ".pixel-stage", body: "연필(B)로 칸을 칠하고, 오른쪽 버튼으로 지워요. 휠로 확대하고, Space 를 누른 채 끌면 화면이 옮겨져요." },
  { title: "도구", target: ".suite-toolbar", body: "채우기(G), 명암 붓(D), 네모 선택(M), 자동 선택(W), 옮기기(V)… 고른 부분 안에서만 칠해지고, Ctrl+C / Ctrl+V 로 복사해요." },
  { title: "도구 설정", target: ".pixel-options", body: "픽셀 퍼펙트(꺾인 곳 군더더기 없애기), 디더링, 좌우·위아래 대칭, 타일 모드(이어지는 텍스처)를 여기서 켜요." },
  { title: "타임라인", target: ".timeline", body: "줄은 레이어, 칸은 프레임이에요. ‘⧉ 복사’로 프레임을 늘리고 조금씩 바꾸면 애니메이션! 🧅 양파 껍질을 켜면 앞뒤 프레임이 비쳐 보여요. Enter 로 재생." },
  { title: "팔레트", target: ".color-panel", body: "PICO-8, Endesga 같은 유명 팔레트를 고를 수 있어요. 팔레트 순서는 명암 붓의 밝기 순서가 돼요. X 로 전경색과 배경색을 바꿔요." },
  { title: "내보내기", target: ".suite-menubar", body: "‘파일 → 내보내기’(Ctrl+Shift+E)에서 PNG, 스프라이트 시트(로블록스 플립북), 움직이는 GIF 로 저장해요." },
];

const SHORTCUT_HELP = `도구: B 연필 · E 지우개 · D 명암 붓 · G 채우기 · I 스포이트 · L 직선 · U 네모 · O 동그라미 · M 네모 선택 · W 자동 선택 · V 옮기기
[ ] 붓 크기 · X 전경색↔배경색 · Alt+클릭 색 가져오기 · 오른쪽 클릭 지우기 · Shift+클릭 직선
고르기: Ctrl+A 모두 · Ctrl+D 풀기 · Ctrl+Shift+I 반전 · Delete 지우기 · Ctrl+C/X/V · 방향키 옮기기
프레임: , . 이전/다음 · Enter 재생 · Alt+N 새 프레임 · Alt+D 프레임 복사 · Shift+N 새 레이어 · Ctrl+E 아래로 합치기
보기: 휠 확대 · Space+끌기 · 0 맞추기 · Shift+M 대칭 · Shift+T 타일 모드 · Shift+O 양파 껍질 · F3 기능 검색
파일: Ctrl+S 저장 · Ctrl+N 새 그림 · Ctrl+Shift+E 내보내기`;

const RECENT_LIMIT = 10;
const SYMMETRY: { value: Symmetry; label: string }[] = [
  { value: "none", label: "대칭 없음" },
  { value: "x", label: "↔ 좌우" },
  { value: "y", label: "↕ 위아래" },
  { value: "both", label: "✣ 네 방향" },
];

type DialogKind = "new" | "export" | "size" | "adjust" | null;

export function App() {
  const doc = useMemo(() => new PixelDoc(16, 16), []);
  const snap = useSyncExternalStore(doc.subscribe, doc.getSnapshot);
  const [tool, setTool] = useState<ToolId>("pencil");
  const [color, setColor] = useState("#d95763");
  const [secondary, setSecondary] = useState("#222034");
  const [recent, setRecent] = useState<string[]>([]);
  const [size, setSize] = useState(1);
  const [symmetry, setSymmetry] = useState<Symmetry>("none");
  const [filled, setFilled] = useState(false);
  const [gradient, setGradient] = useState<"linear" | "radial">("linear");
  const [gradientDither, setGradientDither] = useState(true);
  const [text, setText] = useState("HELLO");
  const [textSize, setTextSize] = useState(12);
  const [textBold, setTextBold] = useState(false);
  const [grid, setGrid] = useState(true);
  const [contiguous, setContiguous] = useState(true);
  const [pixelPerfect, setPixelPerfect] = useState(true);
  const [dither, setDither] = useState(false);
  const [tile, setTile] = useState(false);
  const [onion, setOnion] = useState(false);
  const [playing, setPlaying] = useState(false);
  /** 고른 태그: 재생, 미리보기, 내보내기가 이 태그의 프레임만 쓴다 */
  const [activeTagRaw, setActiveTag] = useState<number | null>(null);
  const activeTag = activeTagRaw !== null && snap.tags[activeTagRaw] ? activeTagRaw : null;
  const [aiOpen, setAiOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [exportOpts, setExportOpts] = useState<ExportOptions>({ kind: "png", scale: 1, columns: 0, padding: 0, tag: null });
  const [searchOpen, setSearchOpen] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(16);
  const [toast, notify] = useToast(4500);
  const clipboard = useRef<{ raster: Raster; mask: Uint8Array } | null>(null);
  const view = useRef<CanvasController | null>(null);
  const fitView = useCallback(() => requestAnimationFrame(() => view.current?.fit()), []);
  const file = useFile(doc, snap.dirty, notify, fitView);
  const tour = useTour("pixel");
  const updater = useUpdater(notify);
  useAutosave(doc, snap.dirty, notify, fitView);
  const onReady = useCallback((c: CanvasController) => (view.current = c), []);

  const rememberColor = useCallback((hex: string) => {
    setRecent((list) => [hex, ...list.filter((c) => c !== hex)].slice(0, RECENT_LIMIT));
  }, []);

  const pickColor = useCallback((hex: string) => {
    setColor(hex);
    // 스포이트로 색을 가져오면 바로 칠할 수 있게 연필로 돌아간다.
    setTool((t) => (t === "picker" ? "pencil" : t));
  }, []);

  // 재생: 프레임마다 정한 시간만큼 보여 준다
  useEffect(() => {
    if (!playing) return;
    if (doc.frames.length < 2) {
      setPlaying(false);
      notify("프레임이 하나뿐이에요. 타임라인의 ‘⧉ 복사’로 프레임을 늘려 보세요.");
      return;
    }
    // 태그를 골랐으면 그 태그의 순서(앞으로, 거꾸로, 왕복)대로
    const seq = doc.sequence(activeTag);
    let i = Math.max(0, seq.indexOf(doc.frame));
    let timer = 0;
    const step = () => {
      timer = window.setTimeout(() => {
        i = (i + 1) % seq.length;
        doc.setFrame(seq[i]);
        step();
      }, doc.frames[doc.frame].duration);
    };
    if (seq.indexOf(doc.frame) < 0) doc.setFrame(seq[0]);
    step();
    return () => clearTimeout(timer);
  }, [playing, doc, notify, activeTag]);

  /* ───────── 고르기, 클립보드 ───────── */

  const copy = (cut: boolean) => {
    const mask = doc.selection ?? new Uint8Array(doc.width * doc.height).fill(1);
    clipboard.current = { raster: cutOut(doc.cel, mask), mask: mask.slice() };
    if (cut) {
      if (doc.activeLayer.locked) return notify("잠긴 레이어예요.");
      doc.transformCel((r) => clearMasked(r, doc.selection));
    }
    notify(cut ? "잘라냈어요. Ctrl+V 로 붙여넣어요." : "복사했어요. Ctrl+V 로 붙여넣어요.");
  };

  const paste = () => {
    const c = clipboard.current;
    if (!c) return notify("먼저 Ctrl+C 로 복사해 주세요.");
    if (c.raster.width !== doc.width || c.raster.height !== doc.height) return notify("크기가 다른 그림이라 붙여넣을 수 없어요.");
    if (doc.activeLayer.locked) return notify("잠긴 레이어예요.");
    doc.transformCel((r) => stampRaster(r, c.raster, 0, 0));
    doc.setSelection(c.mask.slice());
    setTool("move");
    notify("붙여넣었어요. 끌어서 원하는 자리로 옮겨요 (방향키로 한 칸씩).");
  };

  const deleteSelected = () => {
    if (doc.activeLayer.locked) return notify("잠긴 레이어예요.");
    doc.transformCel((r) => clearMasked(r, doc.selection));
  };

  const nudge = (dx: number, dy: number) => {
    if (doc.activeLayer.locked) return;
    const mask = doc.selection;
    doc.transformCel((r) => {
      const float = cutOut(r, mask);
      clearMasked(r, mask);
      stampRaster(r, float, dx, dy);
    });
    if (mask) doc.setSelection(shiftMask(mask, doc.width, doc.height, dx, dy));
  };

  const invertSelection = () => {
    const m = doc.selection;
    doc.setSelection(m ? m.map((v) => v ^ 1) : null);
  };

  const flipSel = (horizontal: boolean) => doc.transformCel((r) => flipRaster(r, horizontal, doc.selectionBounds(), doc.selection));

  const swapColors = () => {
    setColor(secondary);
    setSecondary(color);
  };

  /* ───────── 단축키 ───────── */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || isTourOpen() || dialog || searchOpen) return;
      const key = e.key.toLowerCase();
      if (e.key === "F3") {
        e.preventDefault();
        return setSearchOpen(true);
      }
      if (e.ctrlKey || e.metaKey) {
        const actions: Record<string, () => void> = {
          z: () => (e.shiftKey ? doc.redo() : doc.undo()),
          y: () => doc.redo(),
          s: () => void file.save(e.shiftKey),
          o: () => void file.open(),
          n: () => setDialog("new"),
          e: () => (e.shiftKey ? setDialog("export") : doc.mergeDown()),
          a: () => doc.selectAll(),
          d: () => doc.setSelection(null),
          i: () => e.shiftKey && invertSelection(),
          c: () => copy(false),
          x: () => copy(true),
          v: paste,
        };
        if (actions[key]) {
          e.preventDefault();
          actions[key]();
        }
        return;
      }
      if (e.altKey) {
        if (key === "n") (e.preventDefault(), doc.addFrame(false));
        else if (key === "d") (e.preventDefault(), doc.addFrame(true));
        return;
      }
      const arrows: Record<string, [number, number]> = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
      if (arrows[key] && (tool === "move" || doc.selection)) {
        e.preventDefault();
        const k = e.shiftKey ? 8 : 1;
        return nudge(arrows[key][0] * k, arrows[key][1] * k);
      }
      if (e.shiftKey) {
        if (key === "m") return setSymmetry((s) => (s === "none" ? "x" : s === "x" ? "y" : s === "y" ? "both" : "none"));
        if (key === "t") return setTile((t) => !t);
        if (key === "o") return setOnion((t) => !t);
        if (key === "n") return void doc.addLayer();
      }
      if (TOOL_KEYS[key] && !e.shiftKey) setTool(TOOL_KEYS[key]);
      else if (key === "[") setSize((s) => Math.max(1, s - 1));
      else if (key === "]") setSize((s) => Math.min(16, s + 1));
      else if (key === "x") swapColors();
      else if (key === ",") doc.setFrame(doc.frame - 1);
      else if (key === ".") doc.setFrame(doc.frame + 1);
      else if (key === "enter") setPlaying((p) => !p);
      else if (key === "home") doc.setFrame(0);
      else if (key === "end") doc.setFrame(doc.frames.length - 1);
      else if (key === "delete" || key === "backspace") deleteSelected();
      else if (key === "escape") doc.setSelection(null);
      else if (key === "0") view.current?.fit();
      else if (key === "+" || key === "=") view.current?.zoomBy(1.25);
      else if (key === "-") view.current?.zoomBy(0.8);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const menus: Menu[] = [
    {
      label: "파일",
      items: [
        { label: "새 그림…", shortcut: "Ctrl+N", onSelect: () => setDialog("new") },
        { label: "열기… (.npixel, 에이스프라이트)", shortcut: "Ctrl+O", onSelect: () => void file.open() },
        ...EXAMPLES.map((ex) => ({ label: `예제 열기: ${ex.label}`, onSelect: () => file.openExample(ex) })),
        { label: "저장", shortcut: "Ctrl+S", onSelect: () => void file.save() },
        { label: "다른 이름으로 저장…", shortcut: "Ctrl+Shift+S", onSelect: () => void file.save(true) },
        { label: "그림 파일 가져오기 (새 레이어)…", onSelect: () => void file.importImage() },
        { label: "스프라이트 시트 가져오기 (프레임으로)…", onSelect: () => void file.importSheet() },
        { label: "내보내기 (PNG · 시트 · GIF)…", shortcut: "Ctrl+Shift+E", onSelect: () => setDialog("export") },
        { label: "로블록스용 PNG 로 바로 내보내기", onSelect: () => void file.exportPng("roblox") },
        { label: "에이스프라이트로 내보내기 (.aseprite)…", onSelect: () => void file.exportAseprite() },
        { label: "팔레트 불러오기 (.hex .gpl)…", onSelect: () => void file.loadPalette() },
        { label: "팔레트 저장 (.hex)…", onSelect: () => void file.savePalette() },
      ],
    },
    {
      label: "편집",
      items: [
        { label: "실행 취소", shortcut: "Ctrl+Z", disabled: !snap.canUndo, onSelect: () => doc.undo() },
        { label: "다시 실행", shortcut: "Ctrl+Y", disabled: !snap.canRedo, onSelect: () => doc.redo() },
        { label: "잘라내기", shortcut: "Ctrl+X", onSelect: () => copy(true) },
        { label: "복사", shortcut: "Ctrl+C", onSelect: () => copy(false) },
        { label: "붙여넣기", shortcut: "Ctrl+V", onSelect: paste },
        { label: "지우기 (고른 부분 / 레이어)", shortcut: "Delete", onSelect: deleteSelected },
        { label: "좌우 뒤집기 (고른 부분 / 레이어)", onSelect: () => flipSel(true) },
        { label: "위아래 뒤집기 (고른 부분 / 레이어)", onSelect: () => flipSel(false) },
        { label: "외곽선 넣기 (전경색)", onSelect: () => doc.transformCel((r) => outline(r, hexToRgba(color), false, doc.selection)) },
        { label: "외곽선 넣기 (대각선 포함)", onSelect: () => doc.transformCel((r) => outline(r, hexToRgba(color), true, doc.selection)) },
        {
          label: "배경색을 전경색으로 바꾸기 (모든 프레임)",
          onSelect: () => {
            let n = 0;
            doc.transformCel((r) => void (n += replaceColor(r, hexToRgba(secondary), hexToRgba(color), doc.selection)), true);
            notify(n ? `${n}칸을 바꿨어요.` : `${secondary} 색 칸이 없어요. 배경색을 바꿀 색으로 골라 주세요 (팔레트 오른쪽 클릭).`);
          },
        },
        { label: "색조 · 채도 · 밝기…", onSelect: () => (doc.activeLayer.locked ? notify("잠긴 레이어예요.") : setDialog("adjust")) },
        { label: "팔레트 색으로 맞추기", onSelect: () => doc.transformCel((r) => quantize(r, doc.palette.map(hexToRgba), doc.selection)) },
      ],
    },
    {
      label: "선택",
      items: [
        { label: "모두 고르기", shortcut: "Ctrl+A", onSelect: () => doc.selectAll() },
        { label: "고르기 풀기", shortcut: "Ctrl+D", onSelect: () => doc.setSelection(null) },
        { label: "고르기 반전", shortcut: "Ctrl+Shift+I", onSelect: invertSelection },
      ],
    },
    {
      label: "스프라이트",
      items: [
        { label: "크기 바꾸기 (캔버스 / 그림)…", onSelect: () => setDialog("size") },
        { label: "오른쪽으로 90도 돌리기", onSelect: () => doc.transformAll((r) => rotateRaster(r, true), doc.height, doc.width) },
        { label: "왼쪽으로 90도 돌리기", onSelect: () => doc.transformAll((r) => rotateRaster(r, false), doc.height, doc.width) },
        { label: "그림 전체 좌우 뒤집기", onSelect: () => doc.transformAll((r) => (flipRaster(r, true), r)) },
        { label: "그림 전체 위아래 뒤집기", onSelect: () => doc.transformAll((r) => (flipRaster(r, false), r)) },
      ],
    },
    {
      label: "레이어",
      items: [
        { label: "새 레이어", shortcut: "Shift+N", disabled: snap.layers.length >= MAX_LAYERS, onSelect: () => doc.addLayer() },
        { label: "레이어 복제", disabled: snap.layers.length >= MAX_LAYERS, onSelect: () => doc.duplicateLayer() },
        { label: "아래 레이어와 합치기", shortcut: "Ctrl+E", disabled: snap.active === 0, onSelect: () => doc.mergeDown() },
        { label: "지금 셀 비우기", onSelect: () => doc.clearLayer() || notify("이미 비어 있어요.") },
        { label: "레이어 지우기", disabled: snap.layers.length <= 1, onSelect: () => doc.removeLayer() },
      ],
    },
    {
      label: "프레임",
      items: [
        { label: "새 빈 프레임", shortcut: "Alt+N", disabled: snap.frames.length >= MAX_FRAMES, onSelect: () => doc.addFrame(false) },
        { label: "지금 프레임 복사", shortcut: "Alt+D", disabled: snap.frames.length >= MAX_FRAMES, onSelect: () => doc.addFrame(true) },
        { label: "프레임 지우기", disabled: snap.frames.length <= 1, onSelect: () => doc.removeFrame() },
        { label: "이전 프레임", shortcut: ",", onSelect: () => doc.setFrame(doc.frame - 1) },
        { label: "다음 프레임", shortcut: ".", onSelect: () => doc.setFrame(doc.frame + 1) },
        { label: playing ? "멈춤" : "재생", shortcut: "Enter", onSelect: () => setPlaying(!playing) },
        { label: onion ? "양파 껍질 끄기" : "양파 껍질 켜기", shortcut: "Shift+O", onSelect: () => setOnion(!onion) },
      ],
    },
    {
      label: "보기",
      items: [
        { label: grid ? "격자 숨기기" : "격자 보이기", onSelect: () => setGrid(!grid) },
        { label: `대칭 바꾸기 (지금: ${SYMMETRY.find((s) => s.value === symmetry)!.label})`, shortcut: "Shift+M", onSelect: () => setSymmetry(symmetry === "none" ? "x" : symmetry === "x" ? "y" : symmetry === "y" ? "both" : "none") },
        { label: tile ? "타일 모드 끄기" : "타일 모드 켜기", shortcut: "Shift+T", onSelect: () => setTile(!tile) },
        { label: "화면에 맞추기", shortcut: "0", onSelect: () => view.current?.fit() },
        { label: "확대", shortcut: "+", onSelect: () => view.current?.zoomBy(1.25) },
        { label: "축소", shortcut: "-", onSelect: () => view.current?.zoomBy(0.8) },
      ],
    },
    {
      label: "도움말",
      items: [
        { label: "기능 검색", shortcut: "F3", onSelect: () => setSearchOpen(true) },
        { label: "따라하기 안내 다시 보기", onSelect: tour.start },
        { label: "단축키 보기", onSelect: () => window.alert(SHORTCUT_HELP) },
        { label: "업데이트 확인", onSelect: () => void updater.check(true) },
      ],
    },
  ];

  const sizeMatters = tool === "pencil" || tool === "eraser" || tool === "line";
  const shapeTool = tool === "rect" || tool === "ellipse";
  const paints = tool === "pencil" || tool === "fill" || shapeTool || tool === "line";

  return (
    <AppFrame
      menubar={
        <MenuBar
          appName="바코 눈꽃"
          menus={menus}
          actions={
            <>
              <button className="suite-menubar-action history-button" disabled={!snap.canUndo} title="실행 취소 (Ctrl+Z)" onClick={() => doc.undo()}>
                ↶
              </button>
              <button className="suite-menubar-action history-button" disabled={!snap.canRedo} title="다시 실행 (Ctrl+Y)" onClick={() => doc.redo()}>
                ↷
              </button>
              <UpdateButton updater={updater} hasUnsavedWork={snap.dirty} />
              <button className="suite-menubar-action export-button" onClick={() => setDialog("export")}>
                ⬆ 내보내기
              </button>
              <button className="suite-menubar-action ai" aria-pressed={aiOpen} onClick={() => setAiOpen(!aiOpen)}>
                ✨ AI 도우미
              </button>
            </>
          }
        />
      }
      toolbar={<Toolbar tools={TOOLS} active={tool} onChange={(id) => setTool(id as ToolId)} />}
      sidebar={
        <>
          <ColorPanel
            doc={doc}
            palette={snap.palette}
            color={color}
            secondary={secondary}
            recent={recent}
            onChange={setColor}
            onSecondary={setSecondary}
            onLoad={() => void file.loadPalette()}
            onSave={() => void file.savePalette()}
            notify={notify}
          />
          <PreviewPanel doc={doc} snap={snap} playing={playing} tag={activeTag} />
          {aiOpen && (
            <AIAssistantPanel
              app="pixel"
              greeting="안녕하세요! 그리고 싶은 것을 말해 주시면 지금 레이어·프레임에 픽셀 그림으로 그려 드릴게요."
              examples={["빨간 물약 병", "웃는 고양이 얼굴", "다이아몬드 검"]}
              getContext={() => aiContext(doc)}
              system={AI_SYSTEM}
              tool={AI_TOOL}
              onResponse={({ text, toolInput }) => (toolInput ? applyAIArt(doc, toolInput as AIPixelArt) : text)}
            />
          )}
        </>
      }
      statusbar={
        <StatusBar hint={HINTS[tool]}>
          <span>
            {snap.dirty ? "● " : ""}
            {file.name}
          </span>
          <span>
            {snap.width} × {snap.height}
            {snap.selection ? ` · 고름 ${snap.selection.w}×${snap.selection.h}` : ""}
          </span>
          <span>{hover ? `칸 ${hover.x}, ${hover.y}` : "칸 -"}</span>
          <span>
            프레임 {snap.frame + 1}/{snap.frames.length}
          </span>
          <span>{zoom * 100}%</span>
        </StatusBar>
      }
    >
      <div className="pixel-stage">
        <PixelCanvas
          doc={doc}
          options={{ tool, color, secondary, gradient, gradientDither, text, textSize, textBold, size, symmetry, filled, grid, contiguous, pixelPerfect, dither, tile, onion }}
          onPickColor={pickColor}
          onUsedColor={rememberColor}
          onHover={setHover}
          onZoom={setZoom}
          onReady={onReady}
          notify={notify}
        />
        <div className="pixel-options" role="group" aria-label="도구 설정">
          <span className="pixel-swatch" style={{ background: color, boxShadow: `5px 5px 0 -1px ${secondary}` }} title={`전경색 ${color} · 배경색 ${secondary} (X: 바꾸기)`} />
          {sizeMatters && (
            <label title="붓 크기 ([ 와 ] 키)">
              크기
              <input type="range" min={1} max={16} value={size} onChange={(e) => setSize(Number(e.target.value))} />
              <b>{size}</b>
            </label>
          )}
          {tool === "pencil" && (
            <button aria-pressed={pixelPerfect} onClick={() => setPixelPerfect(!pixelPerfect)} title="꺾인 곳에 생기는 군더더기 칸을 없애서 선을 깔끔하게 (붓 크기 1일 때)">
              픽셀 퍼펙트
            </button>
          )}
          {paints && (
            <button aria-pressed={dither} onClick={() => setDither(!dither)} title="바둑판 무늬로 한 칸씩 건너 칠해요 (디더링)">
              ▚ 디더링
            </button>
          )}
          {shapeTool && (
            <button aria-pressed={filled} onClick={() => setFilled(!filled)} title="네모, 동그라미 속을 채워요">
              속 채우기
            </button>
          )}
          {tool === "gradient" && (
            <>
              <select value={gradient} onChange={(e) => setGradient(e.target.value as "linear" | "radial")} title="그라디언트 모양">
                <option value="linear">▤ 직선</option>
                <option value="radial">◎ 원형</option>
              </select>
              <button aria-pressed={gradientDither} onClick={() => setGradientDither(!gradientDither)} title="켜면 두 색만 써서 바둑판 무늬로 (픽셀 아트답게), 끄면 사이 색을 섞어요">
                ▚ 디더링 무늬
              </button>
            </>
          )}
          {tool === "text" && (
            <>
              <input className="pixel-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="쓸 글자" title="찍을 글자" />
              <label title="글자 크기 (칸)">
                크기
                <input type="range" min={5} max={32} value={textSize} onChange={(e) => setTextSize(Number(e.target.value))} />
                <b>{textSize}</b>
              </label>
              <button aria-pressed={textBold} onClick={() => setTextBold(!textBold)} title="굵게">
                <b>B</b>
              </button>
            </>
          )}
          {(tool === "fill" || tool === "wand") && (
            <button aria-pressed={contiguous} onClick={() => setContiguous(!contiguous)} title="끄면 이어지지 않은 같은 색도 모두">
              이어진 곳만
            </button>
          )}
          <select value={symmetry} onChange={(e) => setSymmetry(e.target.value as Symmetry)} title="대칭 그리기 (Shift+M)">
            {SYMMETRY.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <button aria-pressed={tile} onClick={() => setTile(!tile)} title="타일 모드: 그림이 사방으로 이어져 보이고, 끝을 넘으면 반대쪽에 칠해져요 (Shift+T)">
            ▦ 타일
          </button>
          <button aria-pressed={grid} onClick={() => setGrid(!grid)} title="칸 나눔 선 보이기">
            # 격자
          </button>
          <button onClick={() => view.current?.fit()} title="그림을 화면에 맞추기 (0)">
            ⤢
          </button>
        </div>
      </div>
      <Timeline doc={doc} snap={snap} playing={playing} setPlaying={setPlaying} onion={onion} setOnion={setOnion} activeTag={activeTag} setActiveTag={setActiveTag} />
      {dialog === "new" && (
        <NewFileDialog
          onClose={() => setDialog(null)}
          onPick={(w, h) => {
            setDialog(null);
            if (file.newFile(w, h)) notify(`${w}×${h} 새 그림이에요. 연필로 칸을 칠해 보세요!`);
          }}
        />
      )}
      {dialog === "export" && (
        <ExportDialog
          doc={doc}
          initial={{ ...exportOpts, tag: activeTag }}
          onClose={() => setDialog(null)}
          onExport={(o) => {
            setExportOpts(o);
            setDialog(null);
            void file.exportImage(o);
          }}
        />
      )}
      {dialog === "size" && <SizeDialog doc={doc} notify={notify} onClose={() => (setDialog(null), fitView())} />}
      {dialog === "adjust" && <AdjustDialog doc={doc} onClose={() => setDialog(null)} />}
      <CommandSearch open={searchOpen} commands={menuCommands(menus)} onClose={() => setSearchOpen(false)} />
      <Toast message={toast} />
      <Tour steps={TOUR_STEPS} open={tour.open} onFinish={tour.finish} />
    </AppFrame>
  );
}
