import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  AIAssistantPanel,
  AppFrame,
  MenuBar,
  Panel,
  StatusBar,
  Toast,
  Toolbar,
  useToast,
  type Menu,
  type Tool,
} from "@suite/ui";
import { PropertiesPanel } from "./panels/PropertiesPanel";
import { EXPORT_FORMATS } from "./scene/exporters";
import { ModelerScene } from "./scene/ModelerScene";
import { SHAPES } from "./scene/shapes";
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

const SHORTCUTS: Record<string, ToolId> = { q: "select", w: "move", e: "rotate", r: "scale" };

function createStartScene() {
  const scene = new ModelerScene();
  scene.add("cube");
  // 시작 장면은 '저장할 것 없음' 상태로 둔다.
  scene.load(scene.serialize());
  return scene;
}

export function App() {
  const model = useMemo(createStartScene, []);
  const { items, selectedId, canUndo, canRedo, dirty } = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const selected = items.find((i) => i.id === selectedId) ?? null;
  const [viewport, setViewport] = useState<ViewportRenderer | null>(null);
  const [tool, setTool] = useState<ToolId>("move");
  const [aiOpen, setAiOpen] = useState(true);
  const [toast, notify] = useToast();
  const file = useProjectFile(model, dirty, notify);
  const onViewportReady = useCallback((v: ViewportRenderer | null) => setViewport(v), []);

  useEffect(() => viewport?.setTool(tool), [viewport, tool]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 글자를 입력하는 중에는 단축키를 쓰지 않는다.
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
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
      if (SHORTCUTS[key]) setTool(SHORTCUTS[key]);
      else if (key === "delete" || key === "x") model.removeSelected();
      else if (key === "home") viewport?.resetView();
      else if (key === ".") viewport?.frameSelected();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [model, viewport, file]);

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
      ],
    },
    {
      label: "추가",
      items: SHAPES.map((s) => ({ label: s.label, onSelect: () => model.add(s.kind) })),
    },
    {
      label: "보기",
      items: [
        { label: "처음 시점으로", shortcut: "Home", onSelect: () => viewport?.resetView() },
        { label: "선택한 것 가운데로", shortcut: ".", onSelect: () => viewport?.frameSelected() },
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
              <button className="suite-menubar-action" aria-pressed={aiOpen} onClick={() => setAiOpen(!aiOpen)}>
                ✨ AI 도우미
              </button>
            </>
          }
        />
      }
      toolbar={<Toolbar tools={TOOLS} active={tool} onChange={(id) => setTool(id as ToolId)} />}
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
          <PropertiesPanel model={model} item={selected} />
          {aiOpen && (
            <AIAssistantPanel
              app="modeler"
              greeting="안녕하세요! 만들고 싶은 것을 글로 설명해 주시면 제가 모델로 만들어 드릴게요."
              examples={["빨간 지붕이 있는 작은 집", "나무 의자", "눈사람"]}
              getContext={() => items.map(({ name, kind, position, rotation, scale, color }) => ({ name, kind, position, rotation, scale, color }))}
            />
          )}
        </>
      }
      statusbar={
        <StatusBar hint={HINTS[tool]}>
          <span>
            {dirty ? "● " : ""}
            {file.name}
          </span>
          <span>오브젝트 {items.length}개</span>
        </StatusBar>
      }
    >
      <Viewport model={model} onReady={onViewportReady} />
      <Toast message={toast} />
    </AppFrame>
  );
}
