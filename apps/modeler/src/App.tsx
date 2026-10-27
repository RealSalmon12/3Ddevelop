import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AIAssistantPanel,
  AppFrame,
  CommandSearch,
  MenuBar,
  menuCommands,
  Panel,
  Segmented,
  StatusBar,
  Toast,
  Toolbar,
  Tour,
  UpdateButton,
  isTourOpen,
  useToast,
  useTour,
  useUpdater,
  type Command,
  type Menu,
  type Tool,
  type ToolAction,
  type TourStep,
} from "@suite/ui";
import type { SelectMode } from "./mesh/selection";
import { PropertiesPanel } from "./panels/PropertiesPanel";
import { RenderDialog } from "./panels/RenderDialog";
import { AI_SYSTEM, AI_TOOL, applyPlan, sceneContext, type ScenePlan } from "./scene/aiModeling";
import { EXPORT_FORMATS, triangleCount } from "./scene/exporters";
import { EXAMPLES } from "./scene/examples";
import { useAutosave } from "./scene/useAutosave";
import { ModelerScene } from "./scene/ModelerScene";
import { SHAPES } from "./scene/shapes";
import { EFFECTS } from "./effects/particles";
import { useProjectFile } from "./scene/useProjectFile";
import { Viewport } from "./viewport/Viewport";
import type { ToolId, ViewName, ViewportRenderer } from "./viewport/ViewportRenderer";
import { SHADING_LABEL, type Shading } from "./viewport/shading";

const TOOLS: (Tool & { id: ToolId })[] = [
  { id: "select", label: "선택", icon: "➚", hint: "오브젝트를 클릭해서 고르기", shortcut: "Q" },
  { id: "move", label: "이동", icon: "✥", hint: "화살표를 끌어서 오브젝트 옮기기", shortcut: "W" },
  { id: "rotate", label: "회전", icon: "⟳", hint: "고리를 끌어서 오브젝트 돌리기", shortcut: "E" },
  { id: "scale", label: "크기", icon: "⤢", hint: "네모 손잡이를 끌어서 크기 바꾸기", shortcut: "T" },
];

const HINTS: Record<ToolId, string> = {
  select: "클릭: 선택 · 왼쪽 드래그: 박스 선택 · 휠 버튼 드래그: 돌려보기 · 오른쪽 드래그: 화면 이동 · F3: 기능 검색",
  move: "화살표를 끌어 옮겨요 · G 를 누르면 마우스로 바로 옮겨요 · Shift+A: 추가 · F3: 기능 검색",
  rotate: "고리를 끌어 돌려요 · R 을 누르면 마우스로 바로 돌려요 · F3: 기능 검색",
  scale: "손잡이를 끌어 크기를 바꿔요 · S 를 누르면 마우스로 바로 늘려요 · F3: 기능 검색",
};

const EDIT_HINTS: Record<SelectMode, string> = {
  vertex: "점 클릭: 고르기 · Shift+클릭: 여러 개 · Alt+클릭: 한 줄 · B: 박스 · G/R/S: 옮기기/돌리기/늘리기 · Tab: 끝내기",
  edge: "선 클릭: 고르기 · Alt+클릭: 한 줄 · Ctrl+R: 루프 컷 · B: 박스 · G/R/S: 옮기기/돌리기/늘리기 · Tab: 끝내기",
  face: "면 클릭: 고르기 · Alt+클릭: 한 바퀴 · E: 돌출 · I: 안쪽 면 · B: 박스 · G/R/S: 옮기기/돌리기/늘리기 · Tab: 끝내기",
};

const SHADINGS: Shading[] = ["solid", "wire", "xray"];

const SELECT_MODES: { value: SelectMode; label: string; hint: string }[] = [
  { value: "vertex", label: "점", hint: "점 고르기 (1)" },
  { value: "edge", label: "선", hint: "선 고르기 (2)" },
  { value: "face", label: "면", hint: "면 고르기 (3)" },
];

const TOUR_STEPS: TourStep[] = [
  { title: "바코 빙산에 오신 걸 환영해요! 👋", body: "1분이면 기본 사용법을 익힐 수 있어요. 언제든 ‘도움말’ 메뉴에서 이 안내를 다시 볼 수 있어요." },
  { title: "화면 돌려보기", target: ".suite-main", body: "빈 곳을 왼쪽 버튼으로 끌면 돌려볼 수 있고, 오른쪽 버튼으로 끌면 화면이 옮겨져요. 마우스 휠로 확대/축소해요. 길을 잃으면 Home 키를 누르세요." },
  { title: "도형 추가하기", target: ".suite-menu:nth-of-type(3)", body: "‘추가’ 메뉴에서 정육면체, 구, 원기둥 같은 도형을 넣을 수 있어요. 모든 모델은 이 도형들에서 시작해요." },
  { title: "옮기고, 돌리고, 크기 바꾸기", target: ".suite-toolbar", body: "도형을 클릭해서 고른 뒤 이동(W), 회전(E), 크기(T) 도구로 손잡이를 끌어 보세요. 익숙해지면 G(옮기기), R(돌리기), S(늘리기) 키를 눌러 마우스로 바로 움직여 보세요. X, Y, Z 를 누르면 그 방향으로만 움직여요." },
  { title: "숫자로 정확하게", target: ".suite-side .suite-panel:nth-of-type(2)", body: "속성 패널에서 위치, 크기, 색을 숫자로 바꿀 수 있어요. 실수하면 Ctrl+Z 로 되돌리면 돼요." },
  { title: "편집 모드로 모양 바꾸기", target: ".viewport-header", body: "Tab 을 누르면 편집 모드가 돼요. 점, 선, 면을 골라 움직이고, 면을 골라 ‘돌출’하면 새 부분이 튀어나와요." },
  { title: "AI 에게 부탁하기 ✨", target: ".suite-side .suite-panel:last-of-type", body: "만들고 싶은 것을 글로 쓰면 AI 가 만들어 줘요. 처음 한 번 ‘API 키 설정’에서 키를 넣어야 해요." },
  { title: "저장, 예제, 내보내기", target: ".suite-menu:nth-of-type(1)", body: "‘파일’ 메뉴에서 저장(Ctrl+S)하고, 예제(집, 나무, 블록 캐릭터…)를 열어 뜯어볼 수 있어요. 로블록스용이나 3D 프린팅용으로 내보낼 수도 있어요. 기능이 어디 있는지 모르겠으면 F3 을 누르고 이름을 쳐 보세요. 이제 마음껏 만들어 보세요!" },
];

const SHORTCUT_HELP = `F3 기능 검색 (이름을 쳐서 아무 기능이나 실행) · Shift+A 추가 메뉴
마우스: 왼쪽 드래그 돌려보기 · 오른쪽 드래그 옮기기 · 휠 확대/축소
G 옮기기 · R 돌리기 · S 늘리기 → 이어서 X/Y/Z 방향 고정, 숫자 입력, 클릭·Enter 확정, Esc 취소
Q 선택 도구 · W 이동 도구 · E 회전 도구 · T 크기 도구 · Shift+Tab 칸 맞춤
X·Delete 지우기 · Shift+D 복제해서 옮기기 · Ctrl+D 복제 · Ctrl+M 좌우 대칭 복제
H 숨기기 · Shift+H 고른 것만 보기 · Alt+H 모두 보이기 · Z 보기 방식 (솔리드/와이어/X-ray)
숫자패드 1/3/7 앞/옆/위 (Ctrl 누르면 반대쪽) · 5 원근/평면 · 2/4/6/8 돌려 보기 · 9 반대편
Ctrl+Z 되돌리기 · Ctrl+Y 다시 실행 · Ctrl+S 저장 · Home 처음 시점 · . 선택한 것 가운데로
Ctrl+1/2/3 매끈하게 (서브디비전) · Ctrl+0 매끈하게 끄기 · B 박스 선택
Tab 편집 모드 · 1/2/3 점/선/면 · A 모두 고르기 · Alt+클릭 한 줄 고르기 · E 돌출 · I 안쪽 면 · Ctrl+R 루프 컷 · M 합치기
O 비례 편집 (G/R/S 중 휠로 반경) · F12 렌더 (PNG, 투명 배경)`;

const SHORTCUTS: Record<string, ToolId> = { q: "select", w: "move", e: "rotate", t: "scale" };
const MODAL_KEYS = { g: "grab", r: "rotate", s: "scale" } as const;
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
  const [snap, setSnap] = useState(false);
  const [proportional, setProportional] = useState(false);
  const [renderOpen, setRenderOpen] = useState(false);
  const [shading, setShading] = useState<Shading>("solid");
  const [ortho, setOrtho] = useState(false);
  const [search, setSearch] = useState<null | { kind: "all" } | { kind: "add"; at: { x: number; y: number } }>(null);
  const [toast, notify] = useToast(4500);
  const needFaces = "먼저 면을 골라 주세요. 위에서 ‘면’을 누르고 면을 클릭하면 돼요.";
  const needEdge = "자를 방향의 선을 하나 골라 주세요. 위에서 ‘선’을 누르고, 가로질러 자를 선을 클릭하면 돼요. (사각형 면이 이어진 곳만 잘려요)";
  const setSubdivision = (level: number) =>
    model.setSubdivision(level) ? notify(level ? `매끈하게 ${level}단계` : "매끈하게 끔") : notify("먼저 매끈하게 할 오브젝트를 골라 주세요.");
  const file = useProjectFile(model, dirty, notify);
  const tour = useTour("modeler");
  const updater = useUpdater(notify);
  useAutosave(model, dirty, notify);
  /** 화면 기준 마우스 위치. Shift+A 메뉴를 마우스 옆에 띄울 때 쓴다. */
  const pointer = useRef({ x: 0, y: 0 });
  const onViewportReady = useCallback((v: ViewportRenderer | null) => setViewport(v), []);

  useEffect(() => viewport?.setTool(tool), [viewport, tool]);
  useEffect(() => viewport?.setBloom(bloom), [viewport, bloom]);
  useEffect(() => viewport?.setSnap(snap), [viewport, snap]);
  useEffect(() => viewport?.setProportional(proportional), [viewport, proportional]);
  useEffect(() => viewport?.setShading(shading), [viewport, shading]);
  const toggleOrtho = () => viewport && setOrtho(viewport.toggleOrthographic());
  const view = (v: ViewName) => viewport?.setView(v);
  const cycleShading = () => setShading((s) => SHADINGS[(SHADINGS.indexOf(s) + 1) % SHADINGS.length]);
  const nothingToMove = () =>
    notify(edit ? "먼저 움직일 점, 선, 면을 골라 주세요." : "먼저 움직일 오브젝트를 클릭해서 골라 주세요.");
  const startModal = (kind: "grab" | "rotate" | "scale") => viewport?.startModal(kind) || nothingToMove();
  /** E: 면을 돌출하고 바로 마우스로 높이를 정한다. 취소하면 돌출 전으로 돌아간다. */
  const extrudeModal = () => {
    if (!model.extrude(0)) return void notify(needFaces);
    viewport?.startModal("grab", {
      direction: model.selectedFaceNormal() ?? undefined,
      label: "돌출",
      onConfirm: () => model.amendCommit(),
      onCancel: () => model.undo(),
    });
  };
  /** Shift+D: 같은 자리에 복제하고 바로 옮긴다. */
  const duplicateModal = () => {
    if (!model.duplicateSelected(true)) return void notify("먼저 복제할 오브젝트를 골라 주세요.");
    viewport?.startModal("grab", { label: "복제해서 옮기기", onConfirm: () => model.amendCommit() });
  };

  const EDIT_BLOCKED = {
    "nothing-selected": "편집 모드는 오브젝트 하나의 모양을 고치는 곳이에요. 먼저 고칠 오브젝트를 클릭하거나 오른쪽 장면 목록에서 골라 주세요.",
    effect: "이펙트는 고칠 모양이 없어서 편집 모드를 쓸 수 없어요. 도형을 골라 주세요.",
  } as const;
  const explainEdit = (result: "ok" | keyof typeof EDIT_BLOCKED) => result !== "ok" && notify(EDIT_BLOCKED[result]);

  const editActions: ToolAction[] = [
    { label: "돌출", icon: "⬆", hint: "고른 면을 바깥으로 밀어내며 벽을 세워요. E 키로 하면 마우스로 높이를 정해요", shortcut: "E", onRun: () => model.extrude() || notify(needFaces) },
    { label: "안쪽 면", icon: "▣", hint: "고른 면 안쪽에 작은 면을 만들어요", shortcut: "I", onRun: () => model.inset() || notify(needFaces) },
    { label: "세분화", icon: "⊞", hint: "고른 면을 더 작은 면으로 나눠요", onRun: () => model.subdivide() || notify(needFaces) },
    { label: "루프 컷", icon: "⫼", hint: "고른 선을 가로지르는 고리 모양의 면들을 한 줄 잘라요. 선을 하나 골라 주세요", shortcut: "Ctrl+R", onRun: () => model.loopCut() || notify(needEdge) },
    { label: "모서리 깎기", icon: "◇", hint: "모든 모서리를 비스듬히 깎아요. 여러 번 하면 둥글어져요", shortcut: "Ctrl+B", onRun: () => model.bevel() || notify("구멍 없이 닫힌 모양에서만 깎을 수 있어요. 편집 모드에서 써 주세요.") },
    { label: "합치기", icon: "⊙", hint: "고른 점들을 한 점으로 합쳐요", shortcut: "M", onRun: () => model.merge() || notify("합칠 점을 두 개 이상 골라 주세요.") },
    { label: "뒤집기", icon: "⇅", hint: "고른 면의 앞뒤를 바꿔요", onRun: () => model.flip() || notify(needFaces) },
    { label: "지우기", icon: "✕", hint: "고른 점, 선, 면을 지워요", shortcut: "Delete", onRun: () => model.deleteEditSelection() || notify("지울 것을 먼저 골라 주세요.") },
  ];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 글자를 입력하는 중이나 안내가 떠 있을 때는 단축키를 쓰지 않는다.
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || isTourOpen()) return;
      // G/R/S 로 움직이는 중에는 키가 모두 그쪽으로 간다 (X/Y/Z, 숫자, Enter, Esc).
      if (viewport?.modalActive()) {
        if (viewport.modalKey(e)) e.preventDefault();
        return;
      }
      const key = e.key.toLowerCase();

      if (key === "f12") {
        e.preventDefault();
        return setRenderOpen(true);
      }
      if (key === "f3" || (key === " " && e.ctrlKey)) {
        e.preventDefault();
        return setSearch({ kind: "all" });
      }
      // 숫자패드는 블렌더처럼 시점 바꾸기. 위쪽 숫자 1/2/3 (점/선/면) 과 겹치지 않게 code 로 구분한다.
      const numpad: Record<string, () => void> = {
        Numpad1: () => view(e.ctrlKey ? "back" : "front"),
        Numpad3: () => view(e.ctrlKey ? "left" : "right"),
        Numpad7: () => view(e.ctrlKey ? "bottom" : "top"),
        Numpad5: toggleOrtho,
        Numpad9: () => viewport?.orbitStep(12, 0),
        Numpad4: () => viewport?.orbitStep(-1, 0),
        Numpad6: () => viewport?.orbitStep(1, 0),
        Numpad8: () => viewport?.orbitStep(0, 1),
        Numpad2: () => viewport?.orbitStep(0, -1),
        NumpadDecimal: () => viewport?.frameSelected(),
      };
      if (numpad[e.code]) {
        e.preventDefault();
        return numpad[e.code]();
      }

      if (e.ctrlKey || e.metaKey) {
        const actions: Record<string, () => void> = {
          z: () => (e.shiftKey ? model.redo() : model.undo()),
          y: () => model.redo(),
          s: () => file.save(e.shiftKey),
          o: () => file.open(),
          n: () => file.newFile(),
          d: () => model.duplicateSelected(),
          m: () => void (model.mirrorSelected() || notify("먼저 대칭으로 복제할 오브젝트를 골라 주세요.")),
          b: () => void (model.bevel() || notify("구멍 없이 닫힌 모양에서만 깎을 수 있어요. 편집 모드에서 써 주세요.")),
          r: () => void (model.getSnapshot().edit ? model.loopCut() || notify(needEdge) : notify("루프 컷은 편집 모드(Tab)에서 써요.")),
        };
        // Ctrl+0~3: 매끈하게 단계 (블렌더의 서브디비전 단축키)
        const digit = /^Digit([0-3])$/.exec(e.code);
        if (digit) {
          e.preventDefault();
          return setSubdivision(Number(digit[1]));
        }
        if (actions[key]) {
          e.preventDefault();
          actions[key]();
        }
        return;
      }
      if (e.altKey) {
        if (key === "h") {
          e.preventDefault();
          model.unhideAll();
        }
        return;
      }
      if (key === "tab") {
        e.preventDefault();
        if (e.shiftKey) setSnap((on) => !on);
        else explainEdit(model.toggleEdit());
        return;
      }
      const editing = model.getSnapshot().edit;
      if (editing) {
        if (key === "e") return extrudeModal();
        if (key === "i") return void (model.inset() || notify(needFaces));
        if (key === "m") return void (model.merge() || notify("합칠 점을 두 개 이상 골라 주세요."));
        if (key === "a") return model.toggleSelectAll();
        if (key === "o") {
          setProportional((on) => !on);
          return;
        }
        if (MODE_KEYS[key]) return model.setSelectMode(MODE_KEYS[key]);
      }
      if (e.shiftKey) {
        if (key === "a") {
          const p = pointer.current;
          return setSearch({ kind: "add", at: { x: p.x, y: p.y } });
        }
        if (key === "d" && !editing) return duplicateModal();
        if (key === "h" && !editing) return void (model.hideSelected(true) || notify("먼저 남겨 둘 오브젝트를 골라 주세요."));
        return;
      }
      if (key === "b") return viewport?.beginBoxSelect();
      if (MODAL_KEYS[key as keyof typeof MODAL_KEYS]) return startModal(MODAL_KEYS[key as keyof typeof MODAL_KEYS]);
      if (SHORTCUTS[key]) setTool(SHORTCUTS[key]);
      else if (key === "delete" || key === "x") model.removeSelected();
      else if (key === "z") cycleShading();
      else if (key === "h" && !editing) model.hideSelected() || notify("먼저 숨길 오브젝트를 골라 주세요.");
      else if (key === "home") viewport?.resetView();
      else if (key === ".") viewport?.frameSelected();
    };
    const onKeyUp = (e: KeyboardEvent) => viewport?.modalKeyUp(e);
    const onMove = (e: MouseEvent) => (pointer.current = { x: e.clientX, y: e.clientY });
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousemove", onMove);
    };
  });

  const menus: Menu[] = [
    {
      label: "파일",
      items: [
        { label: "새로 만들기", shortcut: "Ctrl+N", onSelect: file.newFile },
        { label: "열기…", shortcut: "Ctrl+O", onSelect: file.open },
        ...EXAMPLES.map((ex) => ({ label: `예제 열기: ${ex.label}`, onSelect: () => file.openExample(ex) && viewport?.frameSelected() })),
        { label: "저장", shortcut: "Ctrl+S", onSelect: () => file.save() },
        { label: "다른 이름으로 저장…", shortcut: "Ctrl+Shift+S", onSelect: () => file.save(true) },
        ...EXPORT_FORMATS.map((f) => ({ label: `내보내기: ${f.label}`, onSelect: () => file.exportAs(f.format) })),
        { label: "로블록스용으로 내보내기 (전체)", onSelect: () => file.exportForRoblox() },
        { label: "로블록스용으로 내보내기 (고른 것만)", onSelect: () => file.exportForRoblox(true) },
      ],
    },
    {
      label: "편집",
      items: [
        { label: "실행 취소", shortcut: "Ctrl+Z", disabled: !canUndo, onSelect: () => model.undo() },
        { label: "다시 실행", shortcut: "Ctrl+Y", disabled: !canRedo, onSelect: () => model.redo() },
        { label: "옮기기 (마우스로 바로)", shortcut: "G", disabled: !selected, onSelect: () => startModal("grab") },
        { label: "돌리기 (마우스로 바로)", shortcut: "R", disabled: !selected, onSelect: () => startModal("rotate") },
        { label: "늘리기 (마우스로 바로)", shortcut: "S", disabled: !selected, onSelect: () => startModal("scale") },
        { label: "복제", shortcut: "Ctrl+D", disabled: !selected, onSelect: () => model.duplicateSelected() },
        { label: "복제해서 옮기기", shortcut: "Shift+D", disabled: !selected || !!edit, onSelect: duplicateModal },
        { label: "좌우 대칭 복제 (팔, 다리, 눈 짝 만들기)", shortcut: "Ctrl+M", disabled: !selected, onSelect: () => model.mirrorSelected() },
        { label: "지우기", shortcut: "Delete", disabled: !selected, onSelect: () => model.removeSelected() },
        { label: "루프 컷 (편집 모드)", shortcut: "Ctrl+R", disabled: !edit, onSelect: () => model.loopCut() || notify(needEdge) },
        { label: "박스 선택", shortcut: "B", onSelect: () => viewport?.beginBoxSelect() },
        ...[1, 2, 3].map((n) => ({ label: `매끈하게 ${n}단계 (서브디비전)`, shortcut: `Ctrl+${n}`, disabled: !selected || selected.kind === "effect", onSelect: () => setSubdivision(n) })),
        { label: "매끈하게 끄기", shortcut: "Ctrl+0", disabled: !selected?.subdivision, onSelect: () => setSubdivision(0) },
        { label: "매끈하게를 모양에 적용 (점 하나하나 고치기)", disabled: !selected?.subdivision, onSelect: () => model.applySubdivision() },
        { label: "숨기기", shortcut: "H", disabled: !selected || !!edit, onSelect: () => model.hideSelected() },
        { label: "고른 것만 보기 (나머지 숨기기)", shortcut: "Shift+H", disabled: !selected || !!edit, onSelect: () => model.hideSelected(true) },
        { label: "숨긴 것 모두 보이기", shortcut: "Alt+H", disabled: !items.some((i) => i.hidden), onSelect: () => model.unhideAll() },
        { label: edit ? "편집 모드 끝내기" : "편집 모드 (점, 선, 면 고치기)", shortcut: "Tab", onSelect: () => explainEdit(model.toggleEdit()) },
        { label: proportional ? "비례 편집 끄기" : "비례 편집 켜기 (둘레 점도 부드럽게 따라오기)", shortcut: "O", onSelect: () => setProportional(!proportional) },
        { label: "모디파이어 적용 (대칭·배열·매끈하게를 모양에 굳히기)", disabled: !selected || selected.kind === "effect", onSelect: () => void (model.applySubdivision() || notify("고른 오브젝트에 켜진 모디파이어가 없어요. 속성 패널에서 대칭, 배열, 매끈하게를 켜 보세요.")) },
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
        { label: snap ? "칸에 맞춰 움직이기 끄기" : "칸에 맞춰 움직이기 켜기", shortcut: "Shift+Tab", onSelect: () => setSnap(!snap) },
        ...SHADINGS.map((s) => ({ label: `보기 방식: ${SHADING_LABEL[s]}${s === shading ? " ✓" : ""}`, onSelect: () => setShading(s) })),
        { label: ortho ? "원근 보기로 (멀수록 작게)" : "평면 보기로 (치수 맞추기 좋게)", shortcut: "숫자패드 5", onSelect: toggleOrtho },
        { label: "앞에서 보기", shortcut: "숫자패드 1", onSelect: () => view("front") },
        { label: "뒤에서 보기", shortcut: "Ctrl+숫자패드 1", onSelect: () => view("back") },
        { label: "오른쪽에서 보기", shortcut: "숫자패드 3", onSelect: () => view("right") },
        { label: "왼쪽에서 보기", shortcut: "Ctrl+숫자패드 3", onSelect: () => view("left") },
        { label: "위에서 보기", shortcut: "숫자패드 7", onSelect: () => view("top") },
        { label: "아래에서 보기", shortcut: "Ctrl+숫자패드 7", onSelect: () => view("bottom") },
        { label: "처음 시점으로", shortcut: "Home", onSelect: () => viewport?.resetView() },
        { label: "선택한 것 (없으면 전체) 가운데로", shortcut: ".", onSelect: () => viewport?.frameSelected() },
      ],
    },
    {
      label: "렌더",
      items: [{ label: "이미지 렌더 (PNG, 투명 배경)", shortcut: "F12", onSelect: () => setRenderOpen(true) }],
    },
    {
      label: "도움말",
      items: [
        { label: "기능 검색", shortcut: "F3", onSelect: () => setSearch({ kind: "all" }) },
        { label: "따라하기 안내 다시 보기", onSelect: tour.start },
        { label: "단축키 보기", onSelect: () => window.alert(SHORTCUT_HELP) },
        { label: "업데이트 확인", onSelect: () => void updater.check(true) },
      ],
    },
  ];

  const addCommands: Command[] = [
    ...SHAPES.map((sh) => ({ label: sh.label, group: "도형", onSelect: () => model.add(sh.kind) })),
    ...EFFECTS.map((fx) => ({ label: fx.label, group: "이펙트", onSelect: () => model.addEffect(fx.type) })),
  ];

  return (
    <AppFrame
      menubar={
        <MenuBar
          appName="바코 빙산"
          menus={menus}
          actions={
            <>
              <button className="suite-menubar-action history-button" disabled={!canUndo} title="실행 취소 (Ctrl+Z)" onClick={() => model.undo()}>
                ↶
              </button>
              <button className="suite-menubar-action history-button" disabled={!canRedo} title="다시 실행 (Ctrl+Y)" onClick={() => model.redo()}>
                ↷
              </button>
              <UpdateButton updater={updater} hasUnsavedWork={dirty} />
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
                  <li key={item.id} className={item.hidden ? "is-hidden" : undefined}>
                    <button aria-pressed={item.id === selectedId} onClick={() => model.select(item.id)}>
                      <span className="outliner-swatch" style={{ background: item.color }} />
                      {item.name}
                    </button>
                    <button
                      className="outliner-eye"
                      title={item.hidden ? "다시 보이기" : "숨기기 (H)"}
                      aria-label={item.hidden ? `${item.name} 보이기` : `${item.name} 숨기기`}
                      aria-pressed={!item.hidden}
                      onClick={() => model.setHidden(item.id, !item.hidden)}
                    >
                      {item.hidden ? "◌" : "👁"}
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
          {snap && <span>칸 맞춤 켜짐 (Shift+Tab)</span>}
          {proportional && edit && <span>비례 편집 켜짐 (O · 휠로 반경)</span>}
          {shading !== "solid" && <span>{SHADING_LABEL[shading]} (Z)</span>}
          {ortho && <span>평면 보기 (숫자패드 5)</span>}
          <span title="화면에 그려지는 삼각형 수예요. 게임에 넣을 때는 적을수록 가벼워요.">
            삼각형 {model.allMeshes().filter((m) => m.userData.kind !== "effect").reduce((n, m) => n + triangleCount(m), 0).toLocaleString()}개
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
          onChange={(mode) => (mode === "edit" ? explainEdit(model.enterEdit()) : model.exitEdit())}
          options={[
            { value: "object", label: "오브젝트 모드", hint: "오브젝트를 통째로 옮기고 돌리기 (Tab)" },
            { value: "edit", label: "편집 모드", hint: selected ? "점, 선, 면을 고쳐서 모양 바꾸기 (Tab)" : "먼저 오브젝트를 골라 주세요" },
          ]}
        />
        {edit && <Segmented label="고르는 단위" value={edit.mode} onChange={(m) => model.setSelectMode(m)} options={SELECT_MODES} />}
      </div>
      <div className="view-buttons" role="group" aria-label="시점">
        <button title="앞에서 보기 (숫자패드 1)" onClick={() => view("front")}>앞</button>
        <button title="옆에서 보기 (숫자패드 3)" onClick={() => view("right")}>옆</button>
        <button title="위에서 보기 (숫자패드 7)" onClick={() => view("top")}>위</button>
        <button title={ortho ? "원근 보기로 (숫자패드 5)" : "평면 보기로 (숫자패드 5)"} aria-pressed={ortho} onClick={toggleOrtho}>
          {ortho ? "평면" : "원근"}
        </button>
        <button title={`보기 방식: ${SHADING_LABEL[shading]} (Z 로 바꾸기)`} aria-pressed={shading !== "solid"} onClick={cycleShading}>
          {shading === "solid" ? "◼" : shading === "wire" ? "◻" : "◧"}
        </button>
        <button title="처음 시점으로 (Home)" onClick={() => viewport?.resetView()}>⌂</button>
      </div>
      <CommandSearch
        open={search !== null}
        title={search?.kind === "add" ? "추가" : undefined}
        placeholder={search?.kind === "add" ? "넣을 것 (예: 구, 불꽃)" : undefined}
        at={search?.kind === "add" ? search.at : null}
        commands={search?.kind === "add" ? addCommands : menuCommands(menus)}
        onClose={() => setSearch(null)}
      />
      {renderOpen && viewport && <RenderDialog viewport={viewport} name={file.name} notify={notify} onClose={() => setRenderOpen(false)} />}
      <Toast message={toast} />
      <Tour steps={TOUR_STEPS} open={tour.open} onFinish={tour.finish} />
    </AppFrame>
  );
}
