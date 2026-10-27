import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  AIAssistantPanel,
  AppFrame,
  MenuBar,
  Panel,
  Segmented,
  StatusBar,
  Toast,
  Toolbar,
  Tour,
  isTourOpen,
  useToast,
  useTour,
  type Menu,
  type Tool,
  type ToolAction,
  type TourStep,
} from "@suite/ui";
import type { SelectMode } from "./mesh/selection";
import { PropertiesPanel } from "./panels/PropertiesPanel";
import { AI_SYSTEM, AI_TOOL, applyPlan, sceneContext, type ScenePlan } from "./scene/aiModeling";
import { EXPORT_FORMATS } from "./scene/exporters";
import { ModelerScene } from "./scene/ModelerScene";
import { SHAPES } from "./scene/shapes";
import { EFFECTS } from "./effects/particles";
import { useProjectFile } from "./scene/useProjectFile";
import { Viewport } from "./viewport/Viewport";
import type { ToolId, ViewportRenderer } from "./viewport/ViewportRenderer";

const TOOLS: (Tool & { id: ToolId })[] = [
  { id: "select", label: "선택", icon: "➚", hint: "오브젝트를 클릭해서 고르기", shortcut: "Q" },
  { id: "move", label: "이동", icon: "✥", hint: "화살표를 끌어서 오브젝트 옮기기", shortcut: "W" },
  { id: "rotate", label: "회전", icon: "⟳", hint: "고리를 끌어서 오브젝트 돌리기", shortcut: "E" },
  { id: "scale", label: "크기", icon: "⤢", hint: "네모 손잡이를 끌어서 크기 바꾸기", shortcut: "R" },
];

const HINTS: Record<ToolId, string> = {
  select: "클릭: 선택 · 왼쪽 드래그: 돌려보기 · 오른쪽 드래그: 화면 이동 · 휠: 확대/축소",
  move: "빨강/초록/파랑 화살표를 끌어 옮겨요 · 빈 곳 드래그: 돌려보기",
  rotate: "고리를 끌어 돌려요 · 빈 곳 드래그: 돌려보기",
  scale: "손잡이를 끌어 크기를 바꿔요 · 빈 곳 드래그: 돌려보기",
};

const EDIT_HINTS: Record<SelectMode, string> = {
  vertex: "점을 클릭해서 고르기 · Shift+클릭: 여러 개 · A: 모두 고르기 · Tab: 편집 끝내기",
  edge: "선을 클릭해서 고르기 · Shift+클릭: 여러 개 · A: 모두 고르기 · Tab: 편집 끝내기",
  face: "면을 클릭해서 고르기 · Shift+클릭: 여러 개 · 왼쪽 ‘돌출’로 면을 밀어내 보세요 · Tab: 편집 끝내기",
};

const SELECT_MODES: { value: SelectMode; label: string; hint: string }[] = [
  { value: "vertex", label: "점", hint: "점 고르기 (1)" },
  { value: "edge", label: "선", hint: "선 고르기 (2)" },
  { value: "face", label: "면", hint: "면 고르기 (3)" },
];

const TOUR_STEPS: TourStep[] = [
  { title: "3D 모델러에 오신 걸 환영해요! 👋", body: "1분이면 기본 사용법을 익힐 수 있어요. 언제든 ‘도움말’ 메뉴에서 이 안내를 다시 볼 수 있어요." },
  { title: "화면 돌려보기", target: ".suite-main", body: "빈 곳을 왼쪽 버튼으로 끌면 돌려볼 수 있고, 오른쪽 버튼으로 끌면 화면이 옮겨져요. 마우스 휠로 확대/축소해요. 길을 잃으면 Home 키를 누르세요." },
  { title: "도형 추가하기", target: ".suite-menu:nth-of-type(3)", body: "‘추가’ 메뉴에서 정육면체, 구, 원기둥 같은 도형을 넣을 수 있어요. 모든 모델은 이 도형들에서 시작해요." },
  { title: "옮기고, 돌리고, 크기 바꾸기", target: ".suite-toolbar", body: "도형을 클릭해서 고른 뒤 이동(W), 회전(E), 크기(R) 도구로 손잡이를 끌어 보세요. 크기 손잡이는 끈 쪽만 늘어나요." },
  { title: "숫자로 정확하게", target: ".suite-side .suite-panel:nth-of-type(2)", body: "속성 패널에서 위치, 크기, 색을 숫자로 바꿀 수 있어요. 실수하면 Ctrl+Z 로 되돌리면 돼요." },
  { title: "편집 모드로 모양 바꾸기", target: ".viewport-header", body: "Tab 을 누르면 편집 모드가 돼요. 점, 선, 면을 골라 움직이고, 면을 골라 ‘돌출’하면 새 부분이 튀어나와요." },
  { title: "AI 에게 부탁하기 ✨", target: ".suite-side .suite-panel:last-of-type", body: "만들고 싶은 것을 글로 쓰면 AI 가 만들어 줘요. 처음 한 번 ‘API 키 설정’에서 키를 넣어야 해요." },
  { title: "저장과 내보내기", target: ".suite-menu:nth-of-type(1)", body: "‘파일’ 메뉴에서 저장(Ctrl+S)하고, 3D 프린팅용 STL 이나 게임용 GLB 로 내보낼 수 있어요. 이제 마음껏 만들어 보세요!" },
];

const SHORTCUT_HELP = `마우스: 왼쪽 드래그 돌려보기 · 오른쪽 드래그 옮기기 · 휠 확대/축소
Q 선택 · W 이동 · E 회전 · R 크기 · Delete 지우기 · Ctrl+D 복제
Ctrl+Z 되돌리기 · Ctrl+Y 다시 실행 · Ctrl+S 저장 · Home 처음 시점 · . 선택한 것 가운데로
Tab 편집 모드 · 1/2/3 점/선/면 · A 모두 고르기 · Shift+E 돌출 · Shift+I 안쪽 면 · M 합치기`;

const SHORTCUTS: Record<string, ToolId> = { q: "select", w: "move", e: "rotate", r: "scale" };
const MODE_KEYS: Record<string, SelectMode> = { "1": "vertex", "2": "edge", "3": "face" };

function createStartScene() {
  const scene = new ModelerScene();
  scene.add("cube");
  // 시작 장면은 '저장할 것 없음' 상태로 둔다.
  scene.load(scene.serialize());
  return scene;
}

export function App() {
  const model = useMemo(createStartScene, []);
  const { items, selectedId, canUndo, canRedo, dirty, edit } = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const selected = items.find((i) => i.id === selectedId) ?? null;
  const [viewport, setViewport] = useState<ViewportRenderer | null>(null);
  const [tool, setTool] = useState<ToolId>("move");
  const [aiOpen, setAiOpen] = useState(true);
  const [bloom, setBloom] = useState(true);
  const [toast, notify] = useToast();
  const file = useProjectFile(model, dirty, notify);
  const tour = useTour("modeler");
  const onViewportReady = useCallback((v: ViewportRenderer | null) => setViewport(v), []);

  useEffect(() => viewport?.setTool(tool), [viewport, tool]);
  useEffect(() => viewport?.setBloom(bloom), [viewport, bloom]);

  const needFaces = "먼저 면을 골라 주세요. 위에서 ‘면’을 누르고 면을 클릭하면 돼요.";
  const editActions: ToolAction[] = [
    { label: "돌출", icon: "⬆", hint: "고른 면을 바깥으로 밀어내며 벽을 세워요", shortcut: "Shift+E", onRun: () => model.extrude() || notify(needFaces) },
    { label: "안쪽 면", icon: "▣", hint: "고른 면 안쪽에 작은 면을 만들어요", shortcut: "Shift+I", onRun: () => model.inset() || notify(needFaces) },
    { label: "세분화", icon: "⊞", hint: "고른 면을 더 작은 면으로 나눠요", onRun: () => model.subdivide() || notify(needFaces) },
    { label: "합치기", icon: "⊙", hint: "고른 점들을 한 점으로 합쳐요", shortcut: "M", onRun: () => model.merge() || notify("합칠 점을 두 개 이상 골라 주세요.") },
    { label: "뒤집기", icon: "⇅", hint: "고른 면의 앞뒤를 바꿔요", onRun: () => model.flip() || notify(needFaces) },
    { label: "지우기", icon: "✕", hint: "고른 점, 선, 면을 지워요", shortcut: "Delete", onRun: () => model.deleteEditSelection() || notify("지울 것을 먼저 골라 주세요.") },
  ];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 글자를 입력하는 중이나 안내가 떠 있을 때는 단축키를 쓰지 않는다.
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || isTourOpen()) return;
      const key = e.key.toLowerCase();

      if (e.ctrlKey || e.metaKey) {
        const actions: Record<string, () => void> = {
          z: () => (e.shiftKey ? model.redo() : model.undo()),
          y: () => model.redo(),
          s: () => file.save(e.shiftKey),
          o: () => file.open(),
          n: () => file.newFile(),
          d: () => model.duplicateSelected(),
        };
        if (actions[key]) {
          e.preventDefault();
          actions[key]();
        }
        return;
      }
      if (e.altKey) return;
      if (key === "tab") {
        e.preventDefault();
        model.toggleEdit();
        return;
      }
      if (model.getSnapshot().edit) {
        if (e.shiftKey && key === "e") return void (model.extrude() || notify(needFaces));
        if (e.shiftKey && key === "i") return void (model.inset() || notify(needFaces));
        if (key === "m") return void (model.merge() || notify("합칠 점을 두 개 이상 골라 주세요."));
        if (key === "a") return model.toggleSelectAll();
        if (MODE_KEYS[key]) return model.setSelectMode(MODE_KEYS[key]);
      }
      if (e.shiftKey) return;
      if (SHORTCUTS[key]) setTool(SHORTCUTS[key]);
      else if (key === "delete" || key === "x") model.removeSelected();
      else if (key === "home") viewport?.resetView();
      else if (key === ".") viewport?.frameSelected();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [model, viewport, file, notify]);

  const menus: Menu[] = [
    {
      label: "파일",
      items: [
        { label: "새로 만들기", shortcut: "Ctrl+N", onSelect: file.newFile },
        { label: "열기…", shortcut: "Ctrl+O", onSelect: file.open },
        { label: "저장", shortcut: "Ctrl+S", onSelect: () => file.save() },
        { label: "다른 이름으로 저장…", shortcut: "Ctrl+Shift+S", onSelect: () => file.save(true) },
        ...EXPORT_FORMATS.map((f) => ({ label: `내보내기: ${f.label}`, onSelect: () => file.exportAs(f.format) })),
      ],
    },
    {
      label: "편집",
      items: [
        { label: "실행 취소", shortcut: "Ctrl+Z", disabled: !canUndo, onSelect: () => model.undo() },
        { label: "다시 실행", shortcut: "Ctrl+Y", disabled: !canRedo, onSelect: () => model.redo() },
        { label: "복제", shortcut: "Ctrl+D", disabled: !selected, onSelect: () => model.duplicateSelected() },
        { label: "지우기", shortcut: "Delete", disabled: !selected, onSelect: () => model.removeSelected() },
        { label: edit ? "편집 모드 끝내기" : "편집 모드 (점, 선, 면 고치기)", shortcut: "Tab", disabled: !selected, onSelect: () => model.toggleEdit() },
      ],
    },
    {
      label: "추가",
      items: SHAPES.map((s) => ({ label: s.label, onSelect: () => model.add(s.kind) })),
    },
    {
      label: "이펙트",
      items: EFFECTS.map((fx) => ({ label: `${fx.label}: ${fx.hint}`, onSelect: () => model.addEffect(fx.type) })),
    },
    {
      label: "보기",
      items: [
        { label: bloom ? "빛 번짐 끄기" : "빛 번짐 켜기", onSelect: () => setBloom(!bloom) },
        { label: "처음 시점으로", shortcut: "Home", onSelect: () => viewport?.resetView() },
        { label: "선택한 것 가운데로", shortcut: ".", onSelect: () => viewport?.frameSelected() },
      ],
    },
    {
      label: "도움말",
      items: [
        { label: "따라하기 안내 다시 보기", onSelect: tour.start },
        { label: "단축키 보기", onSelect: () => window.alert(SHORTCUT_HELP) },
      ],
    },
  ];

  return (
    <AppFrame
      menubar={
        <MenuBar
          appName="3D 모델러"
          menus={menus}
          actions={
            <>
              <button className="suite-menubar-action history-button" disabled={!canUndo} title="실행 취소 (Ctrl+Z)" onClick={() => model.undo()}>
                ↶
              </button>
              <button className="suite-menubar-action history-button" disabled={!canRedo} title="다시 실행 (Ctrl+Y)" onClick={() => model.redo()}>
                ↷
              </button>
              <button className="suite-menubar-action ai" aria-pressed={aiOpen} onClick={() => setAiOpen(!aiOpen)}>
                ✨ AI 도우미
              </button>
            </>
          }
        />
      }
      toolbar={
        <Toolbar
          tools={TOOLS}
          active={tool}
          onChange={(id) => setTool(id as ToolId)}
          actions={edit ? { title: "편집 도구", items: editActions } : undefined}
        />
      }
      sidebar={
        <>
          <Panel title="장면 목록">
            {items.length === 0 ? (
              <p className="panel-empty">비어 있어요. 위의 ‘추가’ 메뉴에서 도형을 넣어 보세요.</p>
            ) : (
              <ul className="outliner">
                {items.map((item) => (
                  <li key={item.id}>
                    <button aria-pressed={item.id === selectedId} onClick={() => model.select(item.id)}>
                      <span className="outliner-swatch" style={{ background: item.color }} />
                      {item.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <PropertiesPanel model={model} item={selected} edit={edit} />
          {aiOpen && (
            <AIAssistantPanel
              app="modeler"
              greeting="안녕하세요! 만들고 싶은 것을 글로 설명해 주시면 제가 모델로 만들어 드릴게요."
              examples={["빨간 지붕이 있는 작은 집", "나무 의자", "눈사람"]}
              getContext={() => sceneContext(model)}
              system={AI_SYSTEM}
              tool={AI_TOOL}
              onResponse={({ text, toolInput }) =>
                toolInput ? `${applyPlan(model, toolInput as ScenePlan)}\n(마음에 안 들면 Ctrl+Z 로 되돌릴 수 있어요.)` : text
              }
            />
          )}
        </>
      }
      statusbar={
        <StatusBar hint={edit ? EDIT_HINTS[edit.mode] : HINTS[tool]}>
          <span>
            {dirty ? "● " : ""}
            {file.name}
          </span>
          <span>오브젝트 {items.length}개</span>
        </StatusBar>
      }
    >
      <Viewport model={model} onReady={onViewportReady} />
      <div className="viewport-header">
        <Segmented
          label="모드"
          value={edit ? "edit" : "object"}
          onChange={(mode) => (mode === "edit" ? model.enterEdit() : model.exitEdit())}
          options={[
            { value: "object", label: "오브젝트 모드", hint: "오브젝트를 통째로 옮기고 돌리기 (Tab)" },
            { value: "edit", label: "편집 모드", hint: selected ? "점, 선, 면을 고쳐서 모양 바꾸기 (Tab)" : "먼저 오브젝트를 골라 주세요" },
          ]}
        />
        {edit && <Segmented label="고르는 단위" value={edit.mode} onChange={(m) => model.setSelectMode(m)} options={SELECT_MODES} />}
      </div>
      <Toast message={toast} />
      <Tour steps={TOUR_STEPS} open={tour.open} onFinish={tour.finish} />
    </AppFrame>
  );
}
