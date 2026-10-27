import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AIAssistantPanel,
  AppFrame,
  MenuBar,
  StatusBar,
  Toast,
  Toolbar,
  Tour,
  UpdateButton,
  isTourOpen,
  useToast,
  useTour,
  useUpdater,
  type Menu,
  type TourStep,
} from "@suite/ui";
import { PixelCanvas, type CanvasController } from "./canvas/PixelCanvas";
import { HINTS, isTyping, TOOL_KEYS, TOOLS, type ToolId } from "./canvas/tools";
import { AI_SYSTEM, AI_TOOL, aiContext, applyAIArt, type AIPixelArt } from "./doc/aiPixel";
import { EXAMPLES } from "./doc/examples";
import { PixelDoc } from "./doc/PixelDoc";
import { NewFileDialog } from "./NewFileDialog";
import { ColorPanel } from "./panels/ColorPanel";
import { LayersPanel } from "./panels/LayersPanel";
import { PreviewPanel } from "./panels/PreviewPanel";
import { useAutosave } from "./useAutosave";
import { useFile } from "./useFile";

const TOUR_STEPS: TourStep[] = [
  { title: "바코 눈꽃에 오신 걸 환영해요! 👋", body: "네모 칸을 하나씩 칠해서 그림을 그리는 프로그램이에요. 아이콘, 게임 캐릭터, 로블록스 데칼을 만들 수 있어요. 언제든 ‘도움말’에서 이 안내를 다시 볼 수 있어요." },
  { title: "칠하기", target: ".suite-main", body: "연필로 칸을 클릭하거나 끌어서 칠해요. 오른쪽 버튼으로 누르면 지워져요. 마우스 휠로 확대/축소하고, Space 를 누른 채 끌면 화면이 옮겨져요." },
  { title: "도구", target: ".suite-toolbar", body: "채우기(G)로 넓은 곳을 한 번에, 직선·네모·동그라미로 모양을 그려요. 스포이트(I)는 그림에 있는 색을 가져와요." },
  { title: "좌우 대칭", target: ".pixel-options", body: "‘좌우 대칭’을 켜면 한쪽만 그려도 반대쪽이 똑같이 그려져요. 캐릭터 얼굴이나 몸을 그릴 때 아주 편해요." },
  { title: "색 고르기", target: ".suite-side .suite-panel:nth-of-type(1)", body: "아래 색 칸을 눌러 골라요. 큰 네모를 누르면 아무 색이나 고를 수 있어요." },
  { title: "레이어", target: ".suite-side .suite-panel:nth-of-type(2)", body: "레이어는 투명한 종이를 겹친 거예요. 몸과 옷을 다른 레이어에 그리면 따로 고치기 쉬워요." },
  { title: "AI 에게 부탁하기 ✨", target: ".suite-side .suite-panel:last-of-type", body: "“빨간 포션 병 그려줘” 처럼 쓰면 AI 가 지금 레이어에 그려 줘요. “뚜껑을 파랗게” 처럼 이어서 고칠 수도 있어요." },
  { title: "저장과 내보내기", target: ".suite-menu:nth-of-type(1)", body: "‘파일’에서 저장(Ctrl+S)하고, PNG 로 내보내요. ‘로블록스용 PNG’는 칸이 흐려지지 않게 1024px 로 키워서 저장해요. 예제(하트, 검, 슬라임)도 열어 보세요!" },
];

const SHORTCUT_HELP = `B 연필 · E 지우개 · G 채우기 · I 스포이트 · L 직선 · U 네모 · O 동그라미 · V 옮기기
[ ] 붓 크기 · M 좌우 대칭 · Alt+클릭 색 가져오기 · 오른쪽 클릭 지우기
휠 확대/축소 · Space+끌기 화면 옮기기 · 0 화면에 맞추기
Ctrl+Z 되돌리기 · Ctrl+Y 다시 실행 · Ctrl+S 저장 · Ctrl+N 새 그림 · Ctrl+E 로블록스용 PNG`;

const RECENT_LIMIT = 10;

export function App() {
  const doc = useMemo(() => new PixelDoc(16, 16), []);
  const snap = useSyncExternalStore(doc.subscribe, doc.getSnapshot);
  const [tool, setTool] = useState<ToolId>("pencil");
  const [color, setColor] = useState("#d95763");
  const [recent, setRecent] = useState<string[]>([]);
  const [size, setSize] = useState(1);
  const [mirror, setMirror] = useState(false);
  const [filled, setFilled] = useState(false);
  const [grid, setGrid] = useState(true);
  const [aiOpen, setAiOpen] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(16);
  const [toast, notify] = useToast(4500);
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

  const pickColor = useCallback(
    (hex: string) => {
      setColor(hex);
      // 스포이트로 색을 가져오면 바로 칠할 수 있게 연필로 돌아간다.
      setTool((t) => (t === "picker" ? "pencil" : t));
    },
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || isTourOpen() || newOpen) return;
      const key = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        const actions: Record<string, () => void> = {
          z: () => (e.shiftKey ? doc.redo() : doc.undo()),
          y: () => doc.redo(),
          s: () => void file.save(e.shiftKey),
          o: () => void file.open(),
          n: () => setNewOpen(true),
          e: () => void file.exportPng("roblox"),
        };
        if (actions[key]) {
          e.preventDefault();
          actions[key]();
        }
        return;
      }
      if (e.altKey) return;
      if (TOOL_KEYS[key]) setTool(TOOL_KEYS[key]);
      else if (key === "[") setSize((s) => Math.max(1, s - 1));
      else if (key === "]") setSize((s) => Math.min(8, s + 1));
      else if (key === "m") setMirror((m) => !m);
      else if (key === "0") view.current?.fit();
      else if (key === "+" || key === "=") view.current?.zoomBy(1.25);
      else if (key === "-") view.current?.zoomBy(0.8);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc, file, newOpen]);

  const menus: Menu[] = [
    {
      label: "파일",
      items: [
        { label: "새 그림…", shortcut: "Ctrl+N", onSelect: () => setNewOpen(true) },
        { label: "열기…", shortcut: "Ctrl+O", onSelect: () => void file.open() },
        ...EXAMPLES.map((ex) => ({ label: `예제 열기: ${ex.label}`, onSelect: () => file.openExample(ex) })),
        { label: "저장", shortcut: "Ctrl+S", onSelect: () => void file.save() },
        { label: "다른 이름으로 저장…", shortcut: "Ctrl+Shift+S", onSelect: () => void file.save(true) },
        { label: "그림 파일 가져오기 (사진을 픽셀로)…", onSelect: () => void file.importImage() },
        { label: "PNG 로 내보내기 (원래 크기)", onSelect: () => void file.exportPng(1) },
        { label: "PNG 로 내보내기 (10배 크게)", onSelect: () => void file.exportPng(10) },
        { label: "로블록스용 PNG 로 내보내기 (1024px)", shortcut: "Ctrl+E", onSelect: () => void file.exportPng("roblox") },
      ],
    },
    {
      label: "편집",
      items: [
        { label: "실행 취소", shortcut: "Ctrl+Z", disabled: !snap.canUndo, onSelect: () => doc.undo() },
        { label: "다시 실행", shortcut: "Ctrl+Y", disabled: !snap.canRedo, onSelect: () => doc.redo() },
        { label: "지금 레이어 깨끗이 지우기", onSelect: () => doc.clearLayer() || notify("이미 비어 있어요.") },
        { label: "그림 좌우 뒤집기", onSelect: () => doc.flip(true) },
        { label: "그림 위아래 뒤집기", onSelect: () => doc.flip(false) },
      ],
    },
    {
      label: "보기",
      items: [
        { label: grid ? "격자 숨기기" : "격자 보이기", onSelect: () => setGrid(!grid) },
        { label: mirror ? "좌우 대칭 끄기" : "좌우 대칭 켜기", shortcut: "M", onSelect: () => setMirror(!mirror) },
        { label: "화면에 맞추기", shortcut: "0", onSelect: () => view.current?.fit() },
        { label: "확대", shortcut: "+", onSelect: () => view.current?.zoomBy(1.25) },
        { label: "축소", shortcut: "-", onSelect: () => view.current?.zoomBy(0.8) },
      ],
    },
    {
      label: "도움말",
      items: [
        { label: "따라하기 안내 다시 보기", onSelect: tour.start },
        { label: "단축키 보기", onSelect: () => window.alert(SHORTCUT_HELP) },
        { label: "업데이트 확인", onSelect: () => void updater.check(true) },
      ],
    },
  ];

  const sizeMatters = tool === "pencil" || tool === "eraser" || tool === "line";
  const shapeTool = tool === "rect" || tool === "ellipse";

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
          <ColorPanel color={color} recent={recent} onChange={setColor} />
          <LayersPanel doc={doc} snap={snap} />
          <PreviewPanel doc={doc} snap={snap} />
          {aiOpen && (
            <AIAssistantPanel
              app="pixel"
              greeting="안녕하세요! 그리고 싶은 것을 말해 주시면 지금 레이어에 픽셀 그림으로 그려 드릴게요."
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
          </span>
          <span>{hover ? `칸 ${hover.x + 1}, ${hover.y + 1}` : "칸 -"}</span>
          <span>{zoom * 100}%</span>
        </StatusBar>
      }
    >
      <PixelCanvas
        doc={doc}
        options={{ tool, color, size, mirror, filled, grid }}
        onPickColor={pickColor}
        onUsedColor={rememberColor}
        onHover={setHover}
        onZoom={setZoom}
        onReady={onReady}
        notify={notify}
      />
      <div className="pixel-options" role="group" aria-label="도구 설정">
        <span className="pixel-swatch" style={{ background: color }} title={`지금 색 ${color}`} />
        {sizeMatters && (
          <label title="붓 크기 ([ 와 ] 키)">
            크기
            <input type="range" min={1} max={8} value={size} onChange={(e) => setSize(Number(e.target.value))} />
            <b>{size}</b>
          </label>
        )}
        {shapeTool && (
          <button aria-pressed={filled} onClick={() => setFilled(!filled)} title="네모, 동그라미 속을 채워요">
            속 채우기
          </button>
        )}
        <button aria-pressed={mirror} onClick={() => setMirror(!mirror)} title="한쪽에 그리면 반대쪽에도 그려져요 (M)">
          ↔ 좌우 대칭
        </button>
        <button aria-pressed={grid} onClick={() => setGrid(!grid)} title="칸 나눔 선 보이기">
          # 격자
        </button>
        <button onClick={() => view.current?.fit()} title="그림을 화면에 맞추기 (0)">
          ⤢ 맞추기
        </button>
      </div>
      {newOpen && (
        <NewFileDialog
          onClose={() => setNewOpen(false)}
          onPick={(s) => {
            setNewOpen(false);
            if (file.newFile(s, s)) notify(`${s}×${s} 새 그림이에요. 연필로 칸을 칠해 보세요!`);
          }}
        />
      )}
      <Toast message={toast} />
      <Tour steps={TOUR_STEPS} open={tour.open} onFinish={tour.finish} />
    </AppFrame>
  );
}
