import { useCallback, useEffect, useRef, useState } from "react";
import {
  AIAssistantPanel,
  AppFrame,
  CommandSearch,
  MenuBar,
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
  isPro,
  requirePro,
} from "@suite/ui";
import { AI_SYSTEM, AI_TOOL, aiContext, aiImages, applyAIEdit, type AIEdit } from "./ai";
import { DEFAULT_OPTIONS, PhotoCanvas, photoView, type CropRect, type ToolId, type ToolOptions } from "./Canvas";
import { parse, serialize } from "./fileio";
import {
  ADJUSTMENTS,
  blankDoc,
  newAdjustLayer,
  newRasterLayer,
  newShapeLayer,
  newTextLayer,
  SIZES,
  type AdjustKind,
  type Layer,
  type PhotoDoc,
} from "./model";
import {
  addMask,
  applyMask,
  blankLayer,
  canvasSize,
  copySelectionToLayer,
  cropDoc,
  duplicate,
  editTarget,
  flipDoc,
  insertAbove,
  mergeDown,
  mergeVisible,
  pixelTarget,
  rasterize,
  replaceLayer,
  replaceTarget,
  resampleDoc,
  rotateDoc,
  type PixelTarget,
} from "./ops";
import { applyFilter, clearPixels, fillAll, FILTERS, opaqueBounds, RETOUCH, type FilterKind } from "./paint";
import { contentAwareFill } from "./inpaint";
import { readPsd, writePsd } from "./psd";
import { LayersPanel, PropertiesPanel, setHistogramDoc, Histogram } from "./Panels";
import { createCanvas, ctx2d, dataUrlToBlob, pixelsAsync, putBlank, putCanvas } from "./pixels";
import { LiquifyDialog } from "./LiquifyDialog";
import { ActionsPanel, BatchDialog } from "./ActionsPanel";
import { loadActions, playAction, saveActions, syncStep, textStep, type PhotoAction, type Step } from "./actions";
import { flatten, layerMatrix, layerToDocCanvas } from "./render";
import { featherSelection, growSelection, invertSelection, selectAll, selectFromAlpha, type Selection } from "./selection";

interface ToolDef {
  id: ToolId;
  label: string;
  icon: string;
  key: string;
  hint: string;
}

const TOOLS: ToolDef[] = [
  { id: "move", label: "이동", icon: "✥", key: "V", hint: "레이어를 끌어 옮겨요. 모서리: 크기, 위 동그라미: 회전 (Shift: 15° 단위)" },
  { id: "marquee", label: "선택 윤곽", icon: "⬚", key: "M", hint: "끌어서 사각형/타원으로 선택해요. Shift: 더하기 · Alt: 빼기 · Shift+M: 모양 바꾸기" },
  { id: "lasso", label: "올가미", icon: "➰", key: "L", hint: "자유롭게 그려서 선택해요. Shift: 더하기 · Alt: 빼기" },
  { id: "pen", label: "펜", icon: "✒", key: "P", hint: "클릭: 곧은 점 · 끌기: 곡선 · 처음 점 클릭: 닫기 · Ctrl+끌기: 점 옮기기 · Alt+클릭: 곡선↔뾰족 · Enter: 선택 영역으로" },
  { id: "wand", label: "자동 선택", icon: "✨", key: "W", hint: "비슷한 색인 곳을 한 번에 선택해요 (허용치로 범위 조절)" },
  { id: "crop", label: "자르기", icon: "⛶", key: "C", hint: "남길 부분을 끌어서 고르고 Enter" },
  { id: "eyedropper", label: "스포이트", icon: "💧", key: "I", hint: "그림에서 색을 찍어 전경색으로 (붓 도구에서 Alt+클릭도 돼요)" },
  { id: "brush", label: "브러시", icon: "🖌", key: "B", hint: "전경색으로 칠해요. [ ] 크기 · 숫자키 불투명도 · Shift+클릭 직선" },
  { id: "eraser", label: "지우개", icon: "◻", key: "E", hint: "픽셀을 지워요 (마스크에서는 배경색으로 칠해요)" },
  { id: "clone", label: "복제 도장", icon: "⎘", key: "S", hint: "Alt+클릭으로 원본을 찍고, 칠하면 그 부분을 복사해요 (잡티 지우기)" },
  { id: "heal", label: "스팟 복구 브러시", icon: "✚", key: "J", hint: "잡티, 여드름, 전선 위를 칠하면 주변 색과 결로 자연스럽게 메워요" },
  { id: "retouch", label: "닷지/번/흐림", icon: "🌓", key: "O", hint: "칠한 곳만 밝게, 어둡게, 흐리게, 선명하게 (Alt: 닷지 ↔ 번)" },
  { id: "bucket", label: "페인트 통", icon: "🪣", key: "G", hint: "비슷한 색 영역을 전경색으로 채워요" },
  { id: "gradient", label: "그레이디언트", icon: "▦", key: "Shift+G", hint: "끌어서 전경색 → 배경색으로 이어 칠해요 (마스크에서는 부드럽게 사라지게)" },
  { id: "text", label: "글자", icon: "T", key: "T", hint: "클릭한 곳에 글자를 넣어요. 글자를 누르면 고쳐요" },
  { id: "shape", label: "도형", icon: "▭", key: "U", hint: "끌어서 사각형, 둥근 사각형, 타원을 그려요 (Shift: 정사각형)" },
  { id: "hand", label: "손", icon: "✋", key: "H", hint: "화면을 끌어 옮겨요 (언제든 Space 를 누른 채 끌어도 돼요)" },
  { id: "zoom", label: "돋보기", icon: "🔍", key: "Z", hint: "클릭: 확대 · Alt+클릭: 축소 · 휠로도 돼요" },
];

const TOUR_STEPS: TourStep[] = [
  { title: "바코 진주에 오신 걸 환영해요! 👋", body: "포토샵처럼 레이어, 마스크, 보정 레이어로 사진을 꾸미고 썸네일을 만들어요." },
  { title: "도구", target: ".ps-tools", body: "왼쪽 도구로 선택(M, L, W), 칠하기(B, E, G), 잡티 지우기(S), 글자(T), 도형(U)을 해요. 아래 두 네모는 전경색과 배경색이에요 (X: 바꾸기, D: 기본)." },
  { title: "옵션 막대", target: ".ps-options", body: "도구마다 크기, 단단함, 허용치 같은 설정이 위에 나와요." },
  { title: "레이어", target: ".layers", body: "레이어마다 혼합 모드, 불투명도, 마스크(◐), 스타일(fx)을 줄 수 있어요. 끌어서 순서를 바꿔요." },
  { title: "보정 레이어 ◑", target: ".layer-actions", body: "레벨, 곡선, 색조/채도 같은 보정을 원본을 건드리지 않고 덧씌워요. 마스크를 칠하면 일부에만 걸려요." },
  { title: "AI 도우미 ✨", target: ".suite-menubar-action.ai", body: "“유튜브 썸네일처럼 만들어줘”라고 쓰면 AI 가 사진을 보고 보정하고 글자를 넣어 줘요." },
];

const PROJECT = { name: "바코 진주 파일", extensions: ["nphoto"] };
const IMAGE_EXT = ["png", "jpg", "jpeg", "webp", "gif", "bmp"];
const IMAGES = { name: "그림", extensions: IMAGE_EXT };
const PSD = { name: "포토샵 PSD", extensions: ["psd"] };
const MAX_SIDE = 4096;
const baseName = (p: string) => p.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");

async function decodePhoto(blob: Blob) {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = createCanvas(bmp.width * scale, bmp.height * scale);
  ctx2d(c).drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}
const base64Blob = async (b64: string, ext: string) => dataUrlToBlob(`data:image/${ext === "jpg" ? "jpeg" : ext};base64,${b64}`);

type Dialog =
  | { kind: "new" }
  | { kind: "imageSize" }
  | { kind: "canvasSize" }
  | { kind: "export" }
  | { kind: "batch" }
  | { kind: "filter"; filter: FilterKind; orig: PhotoDoc }
  | { kind: "liquify"; t: PixelTarget; base: HTMLCanvasElement; sel: HTMLCanvasElement | null }
  | null;

export function App() {
  const history = useHistory<PhotoDoc>(blankDoc());
  const doc = history.state;
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editMask, setEditMask] = useState(false);
  const [tool, setTool] = useState<ToolId>("move");
  const [options, setOptions] = useState<ToolOptions>(DEFAULT_OPTIONS);
  const [fg, setFg] = useState("#000000");
  const [bg, setBg] = useState("#ffffff");
  const [selection, setSelectionState] = useState<Selection | null>(null);
  const lastSelection = useRef<Selection | null>(null);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [pen, setPen] = useState({ count: 0, closed: false });
  const pathCmd = (cmd: "select" | "stroke" | "fill" | "clear" | "undo") => window.dispatchEvent(new CustomEvent("photo-path", { detail: cmd }));
  const [cloneSource, setCloneSource] = useState<{ x: number; y: number } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [status, setStatus] = useState({ x: -1, y: -1, zoom: 100 });
  const clipboard = useRef<HTMLCanvasElement | null>(null);
  const [toast, notify] = useToast(4500);
  const tour = useTour("photo");
  const updater = useUpdater(notify);
  const selected = doc.layers.find((l) => l.id === selectedId) ?? null;
  const name = filePath ? baseName(filePath) : "제목 없음";

  /* ───── 액션 (기록과 실행) ───── */
  const [photoActions, setPhotoActions] = useState<PhotoAction[]>(loadActions);
  const [actionsOpen, setActionsOpen] = useState(false);
  /** 액션 패널은 Pro (기간이 끝났으면 닫기만 한다) */
  const toggleActions = () => {
    if (!isPro()) return void (setActionsOpen(false), requirePro("액션 (작업 녹화와 다시 하기)"));
    setActionsOpen((v) => !v);
  };
  const [actionId, setActionId] = useState<string | null>(() => photoActions[0]?.id ?? null);
  const [recording, setRecording] = useState<string | null>(null);
  const recordingRef = useRef<string | null>(null);
  recordingRef.current = recording;
  useEffect(() => saveActions(photoActions), [photoActions]);
  /** 기록 중이면 단계를 하나 남긴다. ref 는 이 단계가 따라갈 레이어 (나중에 값을 고치면 단계도 바뀐다) */
  const rec = (step: Step, ref?: number) => {
    const id = recordingRef.current;
    if (!id) return;
    setPhotoActions((list) => list.map((a) => (a.id === id ? { ...a, steps: [...a.steps, { step, on: true, ref }] } : a)));
  };
  const prevDoc = useRef(doc);
  useEffect(() => {
    const prev = prevDoc.current;
    prevDoc.current = doc;
    const id = recordingRef.current;
    if (!id || prev === doc) return;
    setPhotoActions((list) =>
      list.map((a) => {
        if (a.id !== id) return a;
        const refs = new Set(a.steps.map((s) => s.ref).filter((r) => r !== undefined));
        let steps = a.steps.map((s) => {
          const l = s.ref === undefined ? null : doc.layers.find((x) => x.id === s.ref);
          const old = s.ref === undefined ? null : prev.layers.find((x) => x.id === s.ref);
          return l && l !== old ? syncStep(s, l, doc) : s;
        });
        // 기록 전부터 있던 레이어의 보정·불투명도·혼합·스타일이 바뀌면 ‘레이어 스타일’ 단계
        for (const l of doc.layers) {
          if (refs.has(l.id) && !steps.some((s) => s.ref === l.id && s.step.op === "style")) continue;
          const o = prev.layers.find((x) => x.id === l.id);
          if (!o || o === l) continue;
          const changed = o.opacity !== l.opacity || o.blend !== l.blend || o.effects !== l.effects || (l.kind === "raster" && o.kind === "raster" && o.adjust !== l.adjust);
          if (!changed) continue;
          const last = steps[steps.length - 1];
          const s = syncStep({ step: { op: "style", opacity: 1, blend: "source-over", effects: l.effects }, on: true, ref: l.id }, l, doc);
          steps = last?.ref === l.id && last.step.op === "style" ? [...steps.slice(0, -1), s] : [...steps, s];
        }
        return { ...a, steps };
      }),
    );
  }, [doc]);
  const playOn = async (a: PhotoAction) => {
    const r = await playAction(a, history.get(), selectedId);
    history.set(r.doc);
    selectLayer(r.current);
    fit();
    notify(r.skipped.length ? `‘${a.name}’ 실행. 건너뛴 단계: ${r.skipped.join(", ")}` : `‘${a.name}’ 액션을 실행했어요. 마음에 안 들면 Ctrl+Z 한 번으로 되돌려요.`);
  };
  const toggleRecord = (id: string | null) => {
    setRecording(id);
    if (id) {
      setActionId(id);
      notify("● 기록 중이에요. 메뉴로 하는 작업이 순서대로 남아요.");
    } else notify("기록을 멈췄어요. ▶ 실행이나 일괄 처리로 다시 쓸 수 있어요.");
  };

  const setSelection = (s: Selection | null) => {
    if (selection) lastSelection.current = selection;
    setSelectionState(s);
  };

  useEffect(() => {
    document.title = `${history.dirty ? "● " : ""}${name} @ ${status.zoom}% - 바코 진주`;
    window.suite?.window.setDirty(history.dirty);
  }, [name, history.dirty, status.zoom]);
  useEffect(() => setHistogramDoc(doc), [doc]);
  // 고른 레이어가 사라지면 (실행 취소 등) 고르기 해제
  useEffect(() => {
    if (selectedId !== null && !selected) setSelectedId(null);
    if (selected && !selected.mask && editMask) setEditMask(false);
  }, [selected, selectedId, editMask]);

  const selectLayer = (id: number | null, mask = false) => {
    setSelectedId(id);
    setEditMask(mask);
  };
  const changeLayer = useCallback((layer: Layer) => history.set((d) => replaceLayer(d, layer)), [history.set]);
  const previewLayer = useCallback((layer: Layer) => history.preview((d) => replaceLayer(d, layer)), [history.preview]);
  const confirmDiscard = () => !history.dirty || window.confirm("저장하지 않은 작업이 사라져요. 계속할까요?");
  const fit = () => requestAnimationFrame(() => photoView("fit"));

  const addLayer = (layer: Layer, mask = false) => {
    history.set((d) => insertAbove(d, layer, selectedId));
    selectLayer(layer.id, mask);
  };

  /** 사진을 새 레이어로 (빈 문서에 처음 넣으면 문서 크기를 사진에 맞춘다) */
  const addPhoto = useCallback(
    async (blob: Blob, label: string) => {
      try {
        const c = await decodePhoto(blob);
        const cur = history.get();
        const fresh = cur.layers.length === 0 && !history.dirty;
        const base = fresh ? { ...cur, width: c.width, height: c.height } : cur;
        const layer = newRasterLayer(base, putCanvas(c), c.width, c.height, label);
        if (!fresh) layer.scale = Math.min(1, (base.width * 0.9) / c.width, (base.height * 0.9) / c.height);
        history.set({ ...base, layers: [...base.layers, layer] });
        selectLayer(layer.id);
        setTool("move");
        if (fresh) fit();
      } catch {
        notify("이 그림은 읽을 수 없어요. PNG 나 JPG 로 해 주세요.");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history, notify],
  );

  const placeImage = async () => {
    if (!window.suite) return;
    const r = await window.suite.files.open({ filters: [IMAGES], binary: true });
    if (!r.ok) return r.reason === "error" && notify(`그림을 열지 못했어요. ${r.message ?? ""}`);
    await addPhoto(await base64Blob(r.text, r.path.split(".").pop()!.toLowerCase()), baseName(r.path));
  };

  const newDoc = (width: number, height: number, background: string | null) => {
    setDialog(null);
    if (!confirmDiscard()) return;
    history.reset(blankDoc(width, height, background));
    selectLayer(null);
    setSelection(null);
    setFilePath(null);
    fit();
  };

  const open = async () => {
    if (!window.suite || !confirmDiscard()) return;
    const r = await window.suite.files.open({ filters: [{ name: "바코 진주 파일, 그림", extensions: ["nphoto", "psd", ...IMAGE_EXT] }, PROJECT, PSD, IMAGES], binary: true });
    if (!r.ok) return r.reason === "error" && notify(`파일을 열지 못했어요. ${r.message ?? ""}`);
    const ext = r.path.split(".").pop()!.toLowerCase();
    try {
      if (ext === "nphoto") {
        const text = new TextDecoder().decode(Uint8Array.from(atob(r.text), (ch) => ch.charCodeAt(0)));
        history.reset(parse(text));
        setFilePath(r.path);
      } else if (ext === "psd") {
        const psd = readPsd(Uint8Array.from(atob(r.text), (ch) => ch.charCodeAt(0)));
        history.reset(psd);
        setFilePath(null);
        notify(`PSD 를 열었어요 (레이어 ${psd.layers.length}개). 저장하면 바코 진주 파일(.nphoto)로 저장돼요.`);
      } else {
        const c = await decodePhoto(await base64Blob(r.text, ext));
        const d = blankDoc(c.width, c.height, null);
        const layer = newRasterLayer(d, putCanvas(c), c.width, c.height, "배경");
        history.reset({ ...d, layers: [layer] });
        setFilePath(null);
      }
      selectLayer(null);
      setSelection(null);
      fit();
    } catch (err) {
      notify((err as Error).message);
    }
  };

  const save = async (saveAs = false) => {
    if (!window.suite) return;
    notify("저장하는 중…");
    const r = await window.suite.files.save({
      path: saveAs ? undefined : (filePath ?? undefined),
      defaultName: `${name}.nphoto`,
      filters: [PROJECT],
      data: await serialize(history.get()),
    });
    if (r.ok) {
      history.markSaved();
      setFilePath(r.path);
      notify("저장했어요.");
    } else if (r.reason === "error") notify(`저장하지 못했어요. ${r.message ?? ""}`);
    else notify("");
  };

  const exportPsd = async () => {
    if (!window.suite) return;
    notify("PSD 를 만드는 중…");
    const { data, skippedAdjust } = await writePsd(history.get());
    const r = await window.suite.files.save({ defaultName: `${name}.psd`, filters: [PSD], data });
    if (r.ok)
      notify(
        skippedAdjust
          ? `PSD 로 저장했어요. 보정 레이어 ${skippedAdjust}개는 합친 그림에만 들어갔어요.`
          : `PSD 로 저장했어요 (${Math.round(data.length / 1024)}KB). 포토샵에서 레이어 그대로 열 수 있어요.`,
      );
    else if (r.reason === "error") notify(`내보내지 못했어요. ${r.message ?? ""}`);
    else notify("");
  };

  const exportImage = async (type: "png" | "jpg" | "webp", quality: number, scale: number) => {
    if (!window.suite) return;
    setDialog(null);
    const d = history.get();
    const c = flatten(type === "jpg" && !d.background ? { ...d, background: "#ffffff" } : d, scale);
    const mime = type === "png" ? "image/png" : type === "jpg" ? "image/jpeg" : "image/webp";
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, mime, quality / 100));
    if (!blob) return notify("그림을 만들지 못했어요.");
    const r = await window.suite.files.save({
      defaultName: `${name}.${type}`,
      filters: [{ name: type.toUpperCase(), extensions: [type] }],
      data: new Uint8Array(await blob.arrayBuffer()),
    });
    if (r.ok) notify(`${type.toUpperCase()} 로 저장했어요 (${c.width}×${c.height}, ${Math.round(blob.size / 1024)}KB).`);
    else if (r.reason === "error") notify(`내보내지 못했어요. ${r.message ?? ""}`);
  };

  /* ───── 픽셀 작업 ───── */

  const target = () => {
    const t = pixelTarget(history.get(), selected, editMask);
    if (typeof t === "string") {
      notify(t);
      return null;
    }
    return t;
  };

  const editPixels = async (fn: (base: HTMLCanvasElement, sel: HTMLCanvasElement | null) => HTMLCanvasElement) => {
    const t = target();
    if (!t) return;
    const id = await editTarget(t, selection, fn);
    if (id) history.set((d) => replaceTarget(d, t.layer.id, t.kind, id));
  };

  const fill = (color: string) => editPixels((b, s) => fillAll(b, target()?.kind === "mask" ? (color === bg ? "#000" : "#fff") : color, s));

  /** 픽셀 유동화 (Shift+Ctrl+X): 얼굴 윤곽, 눈 크기, 머리 모양을 찰흙처럼 다듬는다 */
  const startLiquify = async () => {
    const t = target();
    if (!t) return;
    if (t.kind !== "pixels") return notify("사진(픽셀) 레이어를 골라 주세요. 글자나 도형은 먼저 래스터화해요.");
    const base = await pixelsAsync(t.src);
    if (!base) return;
    let sel: HTMLCanvasElement | null = null;
    if (selection) {
      sel = createCanvas(base.width, base.height);
      const g = ctx2d(sel);
      g.setTransform(t.matrix.inverse());
      g.drawImage(selection.canvas, 0, 0);
    }
    setDialog({ kind: "liquify", t, base, sel });
  };

  /** 내용 인식 채우기: 선택한 곳을 주변 그림으로 자연스럽게 메운다 */
  const contentFill = async () => {
    if (!selection) return notify("지울 물건을 올가미(L)나 선택 윤곽(M)으로 넉넉하게 둘러싼 뒤 다시 눌러 주세요.");
    const t = target();
    if (!t) return;
    if (t.kind !== "pixels") return notify("사진(픽셀) 레이어를 골라 주세요.");
    notify("주변을 살펴서 채우는 중…");
    await new Promise((r) => setTimeout(r, 30));
    await editPixels((b, s) => (s ? contentAwareFill(b, s) : b));
    notify("채웠어요. 어색한 곳은 스팟 복구 브러시(J)로 다듬어 보세요.");
  };

  const clearSelectionPixels = () => {
    if (!selection) {
      if (selected) removeLayer();
      return;
    }
    const t = target();
    if (!t) return;
    if (t.kind === "mask") return void editPixels((b, s) => clearPixels(b, s));
    void editPixels((b, s) => clearPixels(b, s));
  };

  const copy = async (cut: boolean, merged = false) => {
    if (!selection) return notify("먼저 복사할 부분을 선택해 주세요 (M, L, W).");
    const src = merged ? flatten({ ...doc, background: doc.background }) : selected && selected.kind !== "adjust" ? layerToDocCanvas(selected, doc) : null;
    if (!src) return notify("복사할 레이어를 골라 주세요.");
    const b = selection.bounds;
    const c = createCanvas(b.w, b.h);
    const g = ctx2d(c);
    g.drawImage(src, -b.x, -b.y);
    g.globalCompositeOperation = "destination-in";
    g.drawImage(selection.canvas, -b.x, -b.y);
    clipboard.current = c;
    c.toBlob((blob) => blob && void navigator.clipboard?.write?.([new ClipboardItem({ "image/png": blob })]).catch(() => {}));
    if (cut) clearSelectionPixels();
    notify(cut ? "잘라 냈어요." : "복사했어요. Ctrl+V 로 새 레이어에 붙여요.");
  };

  const pasteCanvas = (c: HTMLCanvasElement, label = "붙여넣은 레이어") => {
    const d = history.get();
    const layer = newRasterLayer(d, putCanvas(c), c.width, c.height, label);
    if (selection) {
      layer.x = selection.bounds.x + selection.bounds.w / 2;
      layer.y = selection.bounds.y + selection.bounds.h / 2;
    }
    addLayer(layer);
    setTool("move");
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
      const file = item?.getAsFile();
      if (file && !clipboard.current) {
        e.preventDefault();
        void decodePhoto(file).then((c) => pasteCanvas(c));
        return;
      }
      if (clipboard.current) {
        e.preventDefault();
        pasteCanvas(clipboard.current);
      } else if (file) void decodePhoto(file).then((c) => pasteCanvas(c));
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  const copyToLayer = async (cut: boolean) => {
    if (!selection) {
      if (selected) {
        const r = duplicate(history.get(), selected);
        history.set(r.doc);
        selectLayer(r.layer.id);
      }
      return;
    }
    const t = target();
    if (!t || t.kind === "mask") return;
    const r = await copySelectionToLayer(history.get(), t, selection, cut);
    if (!r) return;
    history.set(r.doc);
    selectLayer(r.layer.id);
    setSelection(null);
  };

  const removeLayer = () => {
    if (!selected) return;
    history.set((d) => ({ ...d, layers: d.layers.filter((l) => l.id !== selected.id) }));
    const i = doc.layers.findIndex((l) => l.id === selected.id);
    selectLayer(doc.layers[i - 1]?.id ?? doc.layers[i + 1]?.id ?? null);
  };

  const reorder = (id: number, to: number) =>
    history.set((d) => {
      const from = d.layers.findIndex((l) => l.id === id);
      if (from < 0 || to < 0 || to >= d.layers.length || from === to) return d;
      const layers = [...d.layers];
      const [l] = layers.splice(from, 1);
      layers.splice(to, 0, l);
      return { ...d, layers };
    });
  const arrange = (dir: "up" | "down" | "top" | "bottom") => {
    if (!selected) return;
    const i = doc.layers.findIndex((l) => l.id === selected.id);
    reorder(selected.id, dir === "up" ? i + 1 : dir === "down" ? i - 1 : dir === "top" ? doc.layers.length - 1 : 0);
  };

  const addAdjustment = (kind: AdjustKind) => {
    const layer = newAdjustLayer(doc, kind);
    const withMask = addMask({ ...doc, layers: [layer] }, layer, selection).layers[0];
    rec({ op: "adjust", kind, settings: structuredClone(layer.settings), opacity: layer.opacity, blend: layer.blend }, layer.id);
    addLayer(withMask, true);
    setSelection(null);
  };

  const newLayer = () => addLayer(blankLayer(doc, `레이어 ${doc.layers.length + 1}`));

  const selectLayerPixels = async (id: number) => {
    const l = doc.layers.find((x) => x.id === id);
    if (!l || l.kind === "adjust") return;
    setSelection(selectFromAlpha(null, doc.width, doc.height, "replace", layerToDocCanvas(l, doc)));
  };

  const trimToContent = async () => {
    const c = flatten({ ...doc, background: null });
    const b = opaqueBounds(c);
    if (!b) return notify("그림이 비어 있어요.");
    rec({ op: "trim" });
    history.set((d) => cropDoc(d, b));
    fit();
  };

  const applyCrop = () => {
    const r = crop ?? (selection ? selection.bounds : null);
    if (!r) return notify("먼저 남길 부분을 끌어서 골라 주세요.");
    rec({ op: "crop", rx: r.x / doc.width, ry: r.y / doc.height, rw: r.w / doc.width, rh: r.h / doc.height });
    history.set((d) => cropDoc(d, r));
    setCrop(null);
    setSelection(null);
    setTool("move");
    fit();
  };

  const cropRatio = (rw: number, rh: number) => {
    const w = Math.min(doc.width, (doc.height * rw) / rh);
    const h = (w * rh) / rw;
    setCrop({ x: Math.round((doc.width - w) / 2), y: Math.round((doc.height - h) / 2), w: Math.round(w), h: Math.round(h) });
  };

  const startFilter = (filter: FilterKind) => {
    if (!target()) return;
    setDialog({ kind: "filter", filter, orig: history.get() });
  };

  const addText = (x: number, y: number) => {
    const layer = { ...newTextLayer(doc), x, y, color: fg === "#000000" ? "#ffffff" : fg };
    rec(textStep(layer, doc), layer.id);
    addLayer(layer);
    setTool("move");
    requestAnimationFrame(() => {
      const box = document.querySelector<HTMLTextAreaElement>(".prop-text");
      box?.focus();
      box?.select();
    });
  };

  // 자동 저장
  useEffect(() => {
    const autosave = window.suite?.autosave;
    if (!autosave) return;
    autosave.read().then((saved) => {
      if (!saved) return;
      if (window.confirm("지난번에 프로그램이 저장하지 않은 채로 꺼졌어요.\n그때 작업을 다시 불러올까요?")) {
        try {
          history.reset(parse(saved.text), true);
          fit();
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
    const timer = setInterval(async () => void autosave.write(await serialize(history.get())), 30_000);
    return () => clearInterval(timer);
  }, [history.dirty, history.get]);

  // 그림 파일 끌어다 놓기
  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      for (const file of [...(e.dataTransfer?.files ?? [])]) if (file.type.startsWith("image/")) void addPhoto(file, file.name.replace(/\.[^.]+$/, ""));
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [addPhoto]);

  const brushKey = tool === "eraser" ? "eraser" : tool === "clone" ? "clone" : tool === "heal" ? "heal" : tool === "retouch" ? "retouch" : "brush";
  const setBrush = (patch: Partial<ToolOptions["brush"]>) => setOptions((o) => ({ ...o, [brushKey]: { ...o[brushKey], ...patch } }));

  const pickTool = (id: ToolId) => {
    setTool(id);
    if (id === "crop") cropRatio(doc.width, doc.height);
    else setCrop(null);
  };

  const adjustShortcut = (kind: AdjustKind) => () => addAdjustment(kind);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || (e.target instanceof HTMLInputElement && e.target.type !== "range" && e.target.type !== "checkbox") || e.target instanceof HTMLSelectElement) return;
      if (isTourOpen() || (dialog && dialog.kind !== "filter") || searchOpen) return;
      if (dialog) return;
      const key = e.key.toLowerCase();
      if (e.key === "F3") {
        e.preventDefault();
        return setSearchOpen(true);
      }
      if (e.key === "F9" && e.altKey) {
        e.preventDefault();
        return toggleActions();
      }
      if (e.key === "F5" && e.shiftKey) {
        e.preventDefault();
        return void contentFill();
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === "x") {
        e.preventDefault();
        return void startLiquify();
      }
      if (e.ctrlKey || e.metaKey) {
        const shift = e.shiftKey;
        const alt = e.altKey;
        const actions: Record<string, (() => void) | undefined> = {
          z: () => (shift ? history.redo() : history.undo()),
          y: history.redo,
          s: () => void save(shift),
          o: () => void open(),
          n: shift ? newLayer : () => setDialog({ kind: "new" }),
          p: shift ? () => void placeImage() : undefined,
          w: shift && alt ? () => setDialog({ kind: "export" }) : undefined,
          a: () => setSelection(selectAll(doc.width, doc.height)),
          d: shift ? () => lastSelection.current && setSelection(lastSelection.current) : () => setSelection(null),
          i: shift ? () => setSelection(invertSelection(selection, doc.width, doc.height)) : alt ? () => setDialog({ kind: "imageSize" }) : adjustShortcut("invert"),
          j: () => void copyToLayer(shift),
          g: alt ? toggleClip : undefined,
          e: shift ? () => (rec({ op: "mergeVisible" }), history.set((d) => mergeVisible(d, false))) : () => mergeSelected(),
          l: adjustShortcut("levels"),
          m: adjustShortcut("curves"),
          u: adjustShortcut("hueSat"),
          b: shift && alt ? adjustShortcut("bw") : adjustShortcut("colorBalance"),
          c: alt ? () => setDialog({ kind: "canvasSize" }) : () => void copy(false, shift),
          x: () => void copy(true),
          t: () => setTool("move"),
          "]": () => arrange(shift ? "top" : "up"),
          "[": () => arrange(shift ? "bottom" : "down"),
          "}": () => arrange("top"),
          "{": () => arrange("bottom"),
          "0": () => photoView("fit"),
          "1": () => photoView("actual"),
          "=": () => photoView("in"),
          "+": () => photoView("in"),
          "-": () => photoView("out"),
          backspace: () => fill(bg),
        };
        const action = actions[key];
        if (action) {
          e.preventDefault();
          action();
        }
        return;
      }
      if (e.altKey && (key === "backspace" || key === "delete")) {
        e.preventDefault();
        return fill(fg);
      }
      if (tool === "pen" && pen.count) {
        if (key === "enter") return pathCmd("select");
        if (key === "escape") return pathCmd("clear");
        if (key === "delete" || key === "backspace") return pathCmd("undo");
      }
      if (key === "enter" && tool === "crop") return applyCrop();
      if (key === "escape") {
        if (tool === "crop") setCrop(null);
        else if (selection) setSelection(null);
        else selectLayer(null);
        return;
      }
      if (key === "delete" || key === "backspace") return clearSelectionPixels();
      if (key === "x") return void (setFg(bg), setBg(fg));
      if (key === "d") return void (setFg("#000000"), setBg("#ffffff"));
      if (key === "[" || key === "]") {
        const b = options[brushKey];
        const step = b.size < 10 ? 1 : b.size < 50 ? 5 : b.size < 200 ? 10 : 25;
        return setBrush({ size: Math.max(1, Math.min(1000, b.size + (key === "]" ? step : -step))) });
      }
      if (/^[0-9]$/.test(key)) {
        const v = key === "0" ? 100 : Number(key) * 10;
        if (["brush", "eraser", "clone", "heal", "retouch"].includes(tool)) setBrush({ opacity: v });
        else if (selected) changeLayer({ ...selected, opacity: v / 100 });
        return;
      }
      if (e.shiftKey && key === "m") {
        setTool("marquee");
        return setOptions((o) => ({ ...o, marquee: o.marquee === "rect" ? "ellipse" : "rect" }));
      }
      if (e.shiftKey && key === "g") return pickTool("gradient");
      if (selected && key.startsWith("arrow") && tool === "move") {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        if (selected.kind === "adjust" || selected.locked) return;
        const dx = key === "arrowleft" ? -step : key === "arrowright" ? step : 0;
        const dy = key === "arrowup" ? -step : key === "arrowdown" ? step : 0;
        return changeLayer({ ...selected, x: selected.x + dx, y: selected.y + dy });
      }
      const t = TOOLS.find((x) => x.key.toLowerCase() === key);
      if (t && !e.altKey) pickTool(t.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /** 클리핑 마스크: 고른 레이어를 바로 아래 레이어 모양 안에만 보이게 */
  function toggleClip() {
    if (!selected) return;
    if (doc.layers[0]?.id === selected.id) return notify("맨 아래 레이어는 클리핑할 바탕이 없어요.");
    changeLayer({ ...selected, clip: !selected.clip });
    if (!selected.clip) notify("아래 레이어 모양 안에만 보여요. 사진 레이어를 글자 위에 두고 하면 글자 속에 사진이 들어가요.");
  }

  function mergeSelected() {
    if (!selected) return;
    const r = mergeDown(history.get(), selected.id);
    if (typeof r === "string") return notify(r);
    const i = doc.layers.findIndex((l) => l.id === selected.id);
    history.set(r);
    selectLayer(doc.layers[i - 1].id);
  }

  const doSelected = (fn: (l: Layer) => void) => () => (selected ? fn(selected) : notify("레이어를 먼저 골라 주세요."));

  const menus: Menu[] = [
    {
      label: "파일",
      items: [
        { label: "새로 만들기…", shortcut: "Ctrl+N", onSelect: () => setDialog({ kind: "new" }) },
        { label: "열기… (.nphoto, PSD, 그림)", shortcut: "Ctrl+O", onSelect: () => void open() },
        { label: "그림 가져오기 (새 레이어로)…", shortcut: "Ctrl+Shift+P", onSelect: () => void placeImage() },
        { label: "저장", shortcut: "Ctrl+S", onSelect: () => void save() },
        { label: "다른 이름으로 저장…", shortcut: "Ctrl+Shift+S", onSelect: () => void save(true) },
        { label: "내보내기 (PNG, JPG, WebP)…", shortcut: "Ctrl+Shift+Alt+W", onSelect: () => setDialog({ kind: "export" }) },
        { label: "PNG 로 빠르게 내보내기", onSelect: () => void exportImage("png", 100, 1) },
        { label: "포토샵 PSD 로 내보내기 (레이어 유지)…", onSelect: () => void exportPsd() },
        { label: "자동화: 일괄 처리 (여러 사진에 액션)…", onSelect: () => requirePro("일괄 처리") && setDialog({ kind: "batch" }) },
      ],
    },
    {
      label: "편집",
      items: [
        { label: "실행 취소", shortcut: "Ctrl+Z", disabled: !history.canUndo, onSelect: history.undo },
        { label: "다시 실행", shortcut: "Ctrl+Shift+Z", disabled: !history.canRedo, onSelect: history.redo },
        { label: "잘라내기", shortcut: "Ctrl+X", disabled: !selection, onSelect: () => void copy(true) },
        { label: "복사", shortcut: "Ctrl+C", disabled: !selection, onSelect: () => void copy(false) },
        { label: "병합하여 복사", shortcut: "Ctrl+Shift+C", disabled: !selection, onSelect: () => void copy(false, true) },
        { label: "붙여넣기", shortcut: "Ctrl+V", onSelect: () => clipboard.current && pasteCanvas(clipboard.current) },
        { label: "전경색으로 칠하기", shortcut: "Alt+Delete", onSelect: () => fill(fg) },
        { label: "배경색으로 칠하기", shortcut: "Ctrl+Delete", onSelect: () => fill(bg) },
        { label: "지우기 (선택 영역)", shortcut: "Delete", onSelect: clearSelectionPixels },
        { label: "내용 인식 채우기", shortcut: "Shift+F5", disabled: !selection, onSelect: () => void contentFill() },
        { label: "자유 변형", shortcut: "Ctrl+T", onSelect: () => setTool("move") },
      ],
    },
    {
      label: "이미지",
      items: [
        ...ADJUSTMENTS.map((a) => ({ label: `조정: ${a.label}`, shortcut: a.shortcut, onSelect: () => addAdjustment(a.kind) })),
        { label: "이미지 크기…", shortcut: "Ctrl+Alt+I", onSelect: () => setDialog({ kind: "imageSize" }) },
        { label: "캔버스 크기…", shortcut: "Ctrl+Alt+C", onSelect: () => setDialog({ kind: "canvasSize" }) },
        { label: "시계 방향 90° 회전", onSelect: () => (rec({ op: "rotate", dir: 1 }), history.set((d) => rotateDoc(d, 1)), fit()) },
        { label: "반시계 방향 90° 회전", onSelect: () => (rec({ op: "rotate", dir: -1 }), history.set((d) => rotateDoc(d, -1)), fit()) },
        { label: "캔버스 좌우 뒤집기", onSelect: () => (rec({ op: "flip", horizontal: true }), history.set((d) => flipDoc(d, true))) },
        { label: "캔버스 상하 뒤집기", onSelect: () => (rec({ op: "flip", horizontal: false }), history.set((d) => flipDoc(d, false))) },
        { label: "선택 영역으로 자르기", disabled: !selection, onSelect: applyCrop },
        { label: "투명한 여백 잘라내기", onSelect: () => void trimToContent() },
      ],
    },
    {
      label: "레이어",
      items: [
        { label: "새 레이어", shortcut: "Ctrl+Shift+N", onSelect: newLayer },
        { label: "레이어 복제 / 선택 영역을 새 레이어로", shortcut: "Ctrl+J", onSelect: () => void copyToLayer(false) },
        { label: "선택 영역을 잘라 새 레이어로", shortcut: "Ctrl+Shift+J", disabled: !selection, onSelect: () => void copyToLayer(true) },
        { label: "레이어 지우기", disabled: !selected, onSelect: removeLayer },
        { label: "새 칠 레이어 (전경색)", onSelect: () => addLayer({ ...newRasterLayer(doc, putBlank(doc.width, doc.height, fg), doc.width, doc.height, "칠") }) },
        { label: "레이어 마스크: 모두 보이기", disabled: !selected || !!selected.mask || selected.kind === "text" || selected.kind === "shape", onSelect: doSelected((l) => (history.set((d) => addMask(d, l, null)), setEditMask(true))) },
        { label: "레이어 마스크: 선택 영역 보이기", disabled: !selected || !selection || !!selected?.mask, onSelect: doSelected((l) => (history.set((d) => addMask(d, l, selection)), setEditMask(true), setSelection(null))) },
        { label: "레이어 마스크: 모두 숨기기", disabled: !selected || !!selected?.mask || selected?.kind === "text" || selected?.kind === "shape", onSelect: doSelected((l) => (history.set((d) => addMask(d, l, null, true)), setEditMask(true))) },
        { label: "레이어 마스크 적용", disabled: selected?.kind !== "raster" || !selected.mask, onSelect: doSelected((l) => l.kind === "raster" && void applyMask(history.get(), l).then((d) => (history.set(d), setEditMask(false)))) },
        { label: "레이어 마스크 삭제", disabled: !selected?.mask, onSelect: doSelected((l) => (changeLayer({ ...l, mask: null }), setEditMask(false))) },
        { label: selected?.clip ? "클리핑 마스크 풀기" : "클리핑 마스크 만들기 (아래 레이어 모양 안에만)", shortcut: "Ctrl+Alt+G", disabled: !selected || doc.layers[0]?.id === selected.id, onSelect: toggleClip },
        { label: "래스터화 (픽셀로 굳히기)", disabled: !selected || selected.kind === "adjust", onSelect: doSelected((l) => history.set((d) => rasterize(d, l))) },
        { label: "아래 레이어와 병합", shortcut: "Ctrl+E", disabled: !selected, onSelect: mergeSelected },
        { label: "보이는 레이어 병합", shortcut: "Ctrl+Shift+E", onSelect: () => (rec({ op: "mergeVisible" }), history.set((d) => mergeVisible(d, false))) },
        { label: "이미지 병합 (모두 하나로)", onSelect: () => (rec({ op: "flatten" }), history.set((d) => mergeVisible(d, true)), selectLayer(null)) },
        { label: "앞으로 가져오기", shortcut: "Ctrl+]", disabled: !selected, onSelect: () => arrange("up") },
        { label: "뒤로 보내기", shortcut: "Ctrl+[", disabled: !selected, onSelect: () => arrange("down") },
        { label: "맨 앞으로", shortcut: "Ctrl+Shift+]", disabled: !selected, onSelect: () => arrange("top") },
        { label: "맨 뒤로", shortcut: "Ctrl+Shift+[", disabled: !selected, onSelect: () => arrange("bottom") },
      ],
    },
    {
      label: "선택",
      items: [
        { label: "모두", shortcut: "Ctrl+A", onSelect: () => setSelection(selectAll(doc.width, doc.height)) },
        { label: "선택 해제", shortcut: "Ctrl+D", disabled: !selection, onSelect: () => setSelection(null) },
        { label: "다시 선택", shortcut: "Ctrl+Shift+D", onSelect: () => lastSelection.current && setSelection(lastSelection.current) },
        { label: "반전", shortcut: "Ctrl+Shift+I", onSelect: () => setSelection(invertSelection(selection, doc.width, doc.height)) },
        { label: "펜 패스를 선택 영역으로", shortcut: "Enter", disabled: !pen.count, onSelect: () => pathCmd("select") },
        { label: "레이어 모양대로 선택", disabled: !selected || selected.kind === "adjust", onSelect: () => selected && void selectLayerPixels(selected.id) },
        { label: "선택 영역 다듬기: 페더 (흐리게)…", disabled: !selection, onSelect: () => askNumber("페더 반경 (px)", 8, (v) => selection && setSelection(featherSelection(selection, v))) },
        { label: "선택 영역 확대…", disabled: !selection, onSelect: () => askNumber("넓힐 만큼 (px)", 4, (v) => selection && setSelection(growSelection(selection, v))) },
        { label: "선택 영역 축소…", disabled: !selection, onSelect: () => askNumber("좁힐 만큼 (px)", 4, (v) => selection && setSelection(growSelection(selection, -v))) },
      ],
    },
    {
      label: "필터",
      items: [
        { label: "픽셀 유동화… (얼굴·몸매 다듬기)", shortcut: "Shift+Ctrl+X", onSelect: () => void startLiquify() },
        ...FILTERS.map((f) => ({ label: `${f.label}…`, onSelect: () => startFilter(f.kind) })),
      ],
    },
    {
      label: "보기",
      items: [
        { label: recording ? "액션 기록 멈추기" : "액션 패널", shortcut: "Alt+F9", onSelect: () => (recording ? toggleRecord(null) : toggleActions()) },
        { label: "화면에 맞추기", shortcut: "Ctrl+0", onSelect: () => photoView("fit") },
        { label: "100% (실제 픽셀)", shortcut: "Ctrl+1", onSelect: () => photoView("actual") },
        { label: "확대", shortcut: "Ctrl++", onSelect: () => photoView("in") },
        { label: "축소", shortcut: "Ctrl+-", onSelect: () => photoView("out") },
        { label: `AI 도우미 ${aiOpen ? "닫기" : "열기"}`, onSelect: () => setAiOpen(!aiOpen) },
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

  function askNumber(label: string, initial: number, then: (v: number) => void) {
    const v = Number(window.prompt(label, String(initial)));
    if (Number.isFinite(v) && v > 0) then(v);
  }

  const toolDef = TOOLS.find((t) => t.id === tool)!;
  const brush = options[brushKey];

  return (
    <AppFrame
      menubar={
        <MenuBar
          appName="바코 진주"
          menus={menus}
          actions={
            <>
              <button className="suite-menubar-action history-button" disabled={!history.canUndo} title="실행 취소 (Ctrl+Z)" onClick={history.undo}>
                ↶
              </button>
              <button className="suite-menubar-action history-button" disabled={!history.canRedo} title="다시 실행 (Ctrl+Shift+Z)" onClick={history.redo}>
                ↷
              </button>
              <UpdateButton updater={updater} hasUnsavedWork={history.dirty} />
              <button className="suite-menubar-action export-button" onClick={() => setDialog({ kind: "export" })}>
                ⬆ 내보내기
              </button>
              <button className="suite-menubar-action ai" aria-pressed={aiOpen} onClick={() => setAiOpen(!aiOpen)}>
                ✨ AI 도우미
              </button>
            </>
          }
        />
      }
      toolbar={
        <nav className="ps-tools" aria-label="도구">
          {TOOLS.map((t) => (
            <button key={t.id} aria-pressed={tool === t.id} title={`${t.label} (${t.key})\n${t.hint}`} onClick={() => pickTool(t.id)}>
              {t.icon}
            </button>
          ))}
          <div className="ps-colors">
            <label className="ps-swatch fg" style={{ background: fg }} title="전경색 (붓, 글자, 채우기)">
              <input type="color" value={fg} onChange={(e) => setFg(e.target.value)} />
            </label>
            <label className="ps-swatch bg" style={{ background: bg }} title="배경색">
              <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} />
            </label>
            <button className="ps-swap" title="색 바꾸기 (X)" onClick={() => (setFg(bg), setBg(fg))}>
              ⇄
            </button>
            <button className="ps-default" title="기본 색 (D)" onClick={() => (setFg("#000000"), setBg("#ffffff"))}>
              ◩
            </button>
          </div>
        </nav>
      }
      sidebar={
        <>
          <div className="suite-panel hist-panel">
            <Histogram />
          </div>
          <PropertiesPanel
            doc={doc}
            layer={selected}
            editMask={editMask}
            onPreview={previewLayer}
            onCommit={history.commit}
            onChange={changeLayer}
            onBackground={(c) => history.set((d) => ({ ...d, background: c }))}
            onResize={() => setDialog({ kind: "imageSize" })}
          />
          <LayersPanel
            doc={doc}
            selectedId={selectedId}
            editMask={editMask}
            onSelect={(id, mask) => selectLayer(id, mask)}
            onUpdate={changeLayer}
            onPreviewLayer={previewLayer}
            onCommit={history.commit}
            onReorder={reorder}
            onNewLayer={newLayer}
            onAdjust={addAdjustment}
            onMask={() => selected && (history.set((d) => addMask(d, selected, selection)), setEditMask(true), setSelection(null))}
            onDuplicate={() => void copyToLayer(false)}
            onDelete={removeLayer}
            onSelectPixels={(id) => void selectLayerPixels(id)}
          />
          {aiOpen && (
            <AIAssistantPanel
              app="photo"
              greeting="안녕하세요! 사진을 넣고 “유튜브 썸네일처럼 만들어줘”처럼 부탁해 보세요. 사진을 보고 보정하고 글자를 넣어 드릴게요."
              examples={["유튜브 썸네일처럼 만들어줘", "더 밝고 선명하게", "‘신작 공개!’ 글자 크게 넣어줘"]}
              getContext={() => aiContext(history.get())}
              getImages={() => aiImages(history.get())}
              system={AI_SYSTEM}
              tool={AI_TOOL}
              onResponse={({ text, toolInput }) => {
                if (!toolInput) return text;
                const edit = toolInput as AIEdit;
                history.set((d) => applyAIEdit(d, edit));
                return `${edit.message ?? "바꿨어요."}\n(마음에 안 들면 Ctrl+Z)`;
              }}
            />
          )}
        </>
      }
      statusbar={
        <StatusBar hint={toolDef.hint}>
          <span>
            {history.dirty ? "● " : ""}
            {name}
          </span>
          <span>{status.zoom}%</span>
          <span>
            {doc.width} × {doc.height}px
          </span>
          {status.x >= 0 && (
            <span>
              X {status.x} · Y {status.y}
            </span>
          )}
          {selection && (
            <span>
              선택 {selection.bounds.w} × {selection.bounds.h}
            </span>
          )}
        </StatusBar>
      }
    >
      <PhotoCanvas
        doc={doc}
        tool={tool}
        options={options}
        selectedId={selectedId}
        editMask={editMask}
        selection={selection}
        fg={fg}
        bg={bg}
        crop={crop}
        cloneSource={cloneSource}
        editingTextId={null}
        onSelectLayer={(id) => selectLayer(id)}
        onPreview={(d) => history.preview(d)}
        onCommit={history.commit}
        onSet={(fn) => history.set(fn)}
        onSelection={setSelection}
        onPickColor={(c) => {
          setFg(c);
          notify(`전경색: ${c}`);
        }}
        onAddText={addText}
        onAddShape={(r) => addLayer(newShapeLayer(doc, options.shape, r.x + r.w / 2, r.y + r.h / 2, r.w, r.h, fg))}
        onCrop={setCrop}
        onCloneSource={(p) => {
          setCloneSource(p);
          notify("원본 위치를 찍었어요. 이제 칠하면 그곳을 복사해요.");
        }}
        onNotify={notify}
        onPathChange={(count, closed) => setPen({ count, closed })}
        onNeedLayer={() => {
          if (doc.layers.length) return null;
          const layer = blankLayer(doc, "레이어 1");
          addLayer(layer);
          return layer;
        }}
        onStatus={setStatus}
      />

      <div className="ps-options" role="toolbar" aria-label="도구 옵션">
        <span className="ps-options-tool">
          {toolDef.icon} {toolDef.label}
        </span>
        {["brush", "eraser", "clone", "heal", "retouch"].includes(tool) && (
          <>
            <NumberField label="크기" value={brush.size} min={1} max={1000} unit="px" onChange={(v) => setBrush({ size: v })} />
            <NumberField label="경도" value={brush.hardness} min={0} max={100} unit="%" onChange={(v) => setBrush({ hardness: v })} />
            <NumberField label="불투명도" value={brush.opacity} min={1} max={100} unit="%" onChange={(v) => setBrush({ opacity: v })} />
            {tool === "clone" && <span className="ps-hint">{cloneSource ? "Alt+클릭: 원본 다시 찍기" : "Alt+클릭으로 원본을 먼저 찍어요"}</span>}
            {tool === "heal" && <span className="ps-hint">지울 곳보다 조금 크게 칠하고 손을 떼요</span>}
            {tool === "retouch" && (
              <span className="ps-seg">
                {RETOUCH.map((r) => (
                  <button key={r.kind} aria-pressed={options.retouchKind === r.kind} onClick={() => setOptions({ ...options, retouchKind: r.kind })}>
                    {r.label}
                  </button>
                ))}
              </span>
            )}
          </>
        )}
        {(tool === "marquee" || tool === "lasso") && (
          <>
            {tool === "marquee" && (
              <span className="ps-seg">
                <button aria-pressed={options.marquee === "rect"} onClick={() => setOptions({ ...options, marquee: "rect" })}>
                  ⬚ 사각형
                </button>
                <button aria-pressed={options.marquee === "ellipse"} onClick={() => setOptions({ ...options, marquee: "ellipse" })}>
                  ◯ 타원
                </button>
              </span>
            )}
            <NumberField label="페더" value={options.feather} min={0} max={200} unit="px" onChange={(v) => setOptions({ ...options, feather: v })} />
            <span className="ps-hint">Shift: 더하기 · Alt: 빼기</span>
          </>
        )}
        {tool === "pen" && (
          <>
            <span className="ps-seg">
            <button disabled={!pen.count} title="패스 안을 선택 영역으로 (Enter)" onClick={() => pathCmd("select")}>
              ⬚ 선택 영역으로
            </button>
            <button disabled={pen.count < 2} title="브러시 크기와 전경색으로 패스를 따라 선을 그어요" onClick={() => pathCmd("stroke")}>
              ✎ 선 긋기
            </button>
            <button disabled={pen.count < 2} title="패스 안을 전경색으로 채워요" onClick={() => pathCmd("fill")}>
              ■ 채우기
            </button>
            <button disabled={!pen.count} title="패스 지우기 (Esc)" onClick={() => pathCmd("clear")}>
              지우기
            </button>
            </span>
            <span className="ps-hint">
              {pen.count ? `점 ${pen.count}개${pen.closed ? " · 닫힘" : ""} · Backspace: 마지막 점 빼기` : "클릭: 곧은 점 · 끌기: 곡선 · 처음 점 클릭: 닫기"}
            </span>
          </>
        )}
        {tool === "wand" && (
          <>
            <NumberField label="허용치" value={options.wandTolerance} min={0} max={100} onChange={(v) => setOptions({ ...options, wandTolerance: v })} />
            <Check label="인접" value={options.wandContiguous} onChange={(v) => setOptions({ ...options, wandContiguous: v })} />
            <Check label="모든 레이어 샘플링" value={options.wandAllLayers} onChange={(v) => setOptions({ ...options, wandAllLayers: v })} />
          </>
        )}
        {tool === "bucket" && (
          <>
            <NumberField label="허용치" value={options.bucketTolerance} min={0} max={100} onChange={(v) => setOptions({ ...options, bucketTolerance: v })} />
            <Check label="인접" value={options.bucketContiguous} onChange={(v) => setOptions({ ...options, bucketContiguous: v })} />
          </>
        )}
        {tool === "gradient" && (
          <>
            <span className="ps-seg">
              <button aria-pressed={options.gradient === "linear"} onClick={() => setOptions({ ...options, gradient: "linear" })}>
                선형
              </button>
              <button aria-pressed={options.gradient === "radial"} onClick={() => setOptions({ ...options, gradient: "radial" })}>
                원형
              </button>
            </span>
            <Check label="전경색 → 투명" value={options.gradientToTransparent} onChange={(v) => setOptions({ ...options, gradientToTransparent: v })} />
          </>
        )}
        {tool === "shape" && (
          <span className="ps-seg">
            {(["rect", "round", "ellipse"] as const).map((k) => (
              <button key={k} aria-pressed={options.shape === k} onClick={() => setOptions({ ...options, shape: k })}>
                {k === "rect" ? "▭ 사각형" : k === "round" ? "▢ 둥근" : "◯ 타원"}
              </button>
            ))}
          </span>
        )}
        {tool === "move" && <Check label="자동 선택" value={options.autoSelect} onChange={(v) => setOptions({ ...options, autoSelect: v })} />}
        {tool === "crop" && (
          <>
            <span className="ps-seg">
              <button onClick={() => cropRatio(16, 9)}>16:9</button>
              <button onClick={() => cropRatio(1, 1)}>1:1</button>
              <button onClick={() => cropRatio(4, 5)}>4:5</button>
              <button onClick={() => cropRatio(9, 16)}>9:16</button>
              <button onClick={() => cropRatio(doc.width, doc.height)}>원래 비율</button>
            </span>
            <button className="ps-go" onClick={applyCrop}>
              ✓ 자르기 (Enter)
            </button>
          </>
        )}
        {editMask && selected?.mask && <span className="ps-mask-badge">◐ 마스크 편집 중</span>}
      </div>

      {doc.layers.length === 0 && !dialog && (
        <div className="photo-empty">
          <p>그림 파일을 이 창에 끌어다 놓거나</p>
          <button className="suite-button" onClick={() => void open()}>
            그림 열기
          </button>
          <button className="suite-ai-link" onClick={() => setDialog({ kind: "new" })}>
            빈 캔버스 만들기
          </button>
        </div>
      )}

      {dialog?.kind === "new" && <NewDialog onClose={() => setDialog(null)} onCreate={newDoc} />}
      {dialog?.kind === "imageSize" && (
        <SizeDialog
          title="이미지 크기"
          note="모든 레이어를 같은 비율로 늘리거나 줄여요."
          width={doc.width}
          height={doc.height}
          onClose={() => setDialog(null)}
          onApply={(w, h) => {
            const same = Math.abs(w / h - doc.width / doc.height) < 0.01;
            rec({ op: "resize", mode: same ? "long" : "exact", width: w, height: h });
            history.set((d) => resampleDoc(d, w, h));
            setDialog(null);
            fit();
          }}
        />
      )}
      {dialog?.kind === "canvasSize" && (
        <SizeDialog
          title="캔버스 크기"
          note="그림은 그대로 두고 둘레를 넓히거나 잘라요. 기준점을 골라요."
          width={doc.width}
          height={doc.height}
          anchor
          onClose={() => setDialog(null)}
          onApply={(w, h, ax, ay) => {
            rec({ op: "canvas", width: w, height: h, ax, ay });
            history.set((d) => canvasSize(d, w, h, ax, ay));
            setDialog(null);
            fit();
          }}
        />
      )}
      {dialog?.kind === "export" && <ExportDialog doc={doc} onClose={() => setDialog(null)} onExport={(t, q, s) => void exportImage(t, q, s)} />}
      {dialog?.kind === "liquify" && (
        <LiquifyDialog
          base={dialog.base}
          sel={dialog.sel}
          onCancel={() => setDialog(null)}
          onApply={async (result) => {
            const t = dialog.t;
            setDialog(null);
            const id = await editTarget(t, null, () => result);
            if (id) history.set((d) => replaceTarget(d, t.layer.id, t.kind, id));
            notify("유동화를 적용했어요. 마음에 안 들면 Ctrl+Z.");
          }}
        />
      )}
      {dialog?.kind === "filter" && (
        <FilterDialog
          filter={dialog.filter}
          onPreview={async (amount) => {
            const t = pixelTarget(dialog.orig, selected, editMask);
            if (typeof t === "string") return;
            const id = await editTarget(t, selection, (b, s) => applyFilter(b, dialog.filter, amount, s));
            if (id) history.preview(replaceTarget(dialog.orig, t.layer.id, t.kind, id));
          }}
          onCancel={() => {
            history.preview(dialog.orig);
            history.commit();
            setDialog(null);
          }}
          onApply={(amount) => {
            rec({ op: "filter", kind: dialog.filter, amount });
            history.commit();
            setDialog(null);
          }}
        />
      )}
      {actionsOpen && (
        <ActionsPanel
          actions={photoActions}
          setActions={setPhotoActions}
          selected={actionId}
          onSelect={setActionId}
          recording={recording}
          onRecord={toggleRecord}
          onPlay={(a) => void playOn(a)}
          onBatch={() => requirePro("일괄 처리") && setDialog({ kind: "batch" })}
          onClose={() => setActionsOpen(false)}
          notify={notify}
        />
      )}
      {dialog?.kind === "batch" && <BatchDialog actions={photoActions} initial={actionId} decode={decodePhoto} onClose={() => setDialog(null)} notify={notify} />}

      <CommandSearch open={searchOpen} commands={menuCommands(menus)} onClose={() => setSearchOpen(false)} />
      <Toast message={toast} />
      <Tour steps={TOUR_STEPS} open={tour.open} onFinish={tour.finish} />
    </AppFrame>
  );
}

function NumberField({ label, value, min, max, unit = "", onChange }: { label: string; value: number; min: number; max: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <label className="ps-num">
      <span>{label}</span>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)));
        }}
        onKeyDown={(e) => e.stopPropagation()}
      />
      {unit && <small>{unit}</small>}
    </label>
  );
}

function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="ps-check">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

function NewDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (w: number, h: number, bg: string | null) => void }) {
  const [w, setW] = useState(1280);
  const [h, setH] = useState(720);
  const [bg, setBg] = useState<"white" | "black" | "none">("white");
  return (
    <div className="dialog-dim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label="새로 만들기">
        <h2>새로 만들기</h2>
        <div className="size-grid">
          {SIZES.map((s) => (
            <button key={s.label} className="size-card" aria-pressed={s.width === w && s.height === h} onClick={() => (setW(s.width), setH(s.height))}>
              <span className="size-demo" style={{ aspectRatio: `${s.width} / ${s.height}` }} />
              <b>{s.label}</b>
              <span>
                {s.width} × {s.height}
              </span>
            </button>
          ))}
        </div>
        <div className="form-row">
          <span>크기</span>
          <input type="number" value={w} min={1} max={10000} onChange={(e) => setW(Number(e.target.value))} />
          <span>×</span>
          <input type="number" value={h} min={1} max={10000} onChange={(e) => setH(Number(e.target.value))} />
          <span>px</span>
        </div>
        <div className="form-row">
          <span>배경</span>
          <span className="ps-seg">
            {(["white", "black", "none"] as const).map((k) => (
              <button key={k} aria-pressed={bg === k} onClick={() => setBg(k)}>
                {k === "white" ? "흰색" : k === "black" ? "검정" : "투명"}
              </button>
            ))}
          </span>
        </div>
        <div className="dialog-actions">
          <button className="suite-ai-link" onClick={onClose}>
            취소
          </button>
          <button className="suite-button" disabled={w < 1 || h < 1 || w > 10000 || h > 10000} onClick={() => onCreate(Math.round(w), Math.round(h), bg === "white" ? "#ffffff" : bg === "black" ? "#000000" : null)}>
            만들기
          </button>
        </div>
      </div>
    </div>
  );
}

function SizeDialog({
  title,
  note,
  width,
  height,
  anchor,
  onClose,
  onApply,
}: {
  title: string;
  note: string;
  width: number;
  height: number;
  anchor?: boolean;
  onClose: () => void;
  onApply: (w: number, h: number, ax: number, ay: number) => void;
}) {
  const [w, setW] = useState(width);
  const [h, setH] = useState(height);
  const [lock, setLock] = useState(!anchor);
  const [a, setA] = useState({ x: 0.5, y: 0.5 });
  return (
    <div className="dialog-dim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog small" role="dialog" aria-label={title}>
        <h2>{title}</h2>
        <p>{note}</p>
        <div className="form-row">
          <span>가로</span>
          <input type="number" value={w} min={1} max={10000} onChange={(e) => (setW(Number(e.target.value)), lock && setH(Math.round((Number(e.target.value) * height) / width)))} />
          <span>px</span>
        </div>
        <div className="form-row">
          <span>세로</span>
          <input type="number" value={h} min={1} max={10000} onChange={(e) => (setH(Number(e.target.value)), lock && setW(Math.round((Number(e.target.value) * width) / height)))} />
          <span>px</span>
        </div>
        <label className="ps-check">
          <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} /> 비율 유지
        </label>
        {anchor && (
          <div className="anchor-grid">
            {[0, 0.5, 1].flatMap((y) =>
              [0, 0.5, 1].map((x) => <button key={`${x}${y}`} aria-pressed={a.x === x && a.y === y} onClick={() => setA({ x, y })} />),
            )}
          </div>
        )}
        <div className="dialog-actions">
          <button className="suite-ai-link" onClick={onClose}>
            취소
          </button>
          <button className="suite-button" disabled={w < 1 || h < 1 || w > 10000 || h > 10000} onClick={() => onApply(Math.round(w), Math.round(h), a.x, a.y)}>
            확인
          </button>
        </div>
      </div>
    </div>
  );
}

function ExportDialog({ doc, onClose, onExport }: { doc: PhotoDoc; onClose: () => void; onExport: (t: "png" | "jpg" | "webp", quality: number, scale: number) => void }) {
  const [type, setType] = useState<"png" | "jpg" | "webp">("png");
  const [quality, setQuality] = useState(90);
  const [scale, setScale] = useState(100);
  const [size, setSize] = useState<number | null>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      const c = flatten(type === "jpg" && !doc.background ? { ...doc, background: "#ffffff" } : doc, scale / 100);
      const p = preview.current;
      if (p) {
        const s = Math.min(p.width / c.width, p.height / c.height);
        const g = ctx2d(p);
        g.clearRect(0, 0, p.width, p.height);
        g.drawImage(c, (p.width - c.width * s) / 2, (p.height - c.height * s) / 2, c.width * s, c.height * s);
      }
      c.toBlob((b) => setSize(b?.size ?? null), type === "png" ? "image/png" : type === "jpg" ? "image/jpeg" : "image/webp", quality / 100);
    }, 200);
    return () => clearTimeout(t);
  }, [doc, type, quality, scale]);
  return (
    <div className="dialog-dim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog export" role="dialog" aria-label="내보내기">
        <h2>내보내기</h2>
        <canvas ref={preview} className="export-preview" width={480} height={270} />
        <div className="form-row">
          <span>형식</span>
          <span className="ps-seg">
            {(["png", "jpg", "webp"] as const).map((k) => (
              <button key={k} aria-pressed={type === k} onClick={() => setType(k)}>
                {k.toUpperCase()}
              </button>
            ))}
          </span>
        </div>
        {type !== "png" && (
          <div className="form-row">
            <span>품질</span>
            <input type="range" min={10} max={100} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
            <b>{quality}</b>
          </div>
        )}
        <div className="form-row">
          <span>크기</span>
          <input type="range" min={10} max={200} step={5} value={scale} onChange={(e) => setScale(Number(e.target.value))} />
          <b>
            {scale}% ({Math.round((doc.width * scale) / 100)} × {Math.round((doc.height * scale) / 100)})
          </b>
        </div>
        <p className="panel-note">
          {type === "png" ? "PNG: 투명 배경을 지키고 화질이 그대로예요." : type === "jpg" ? "JPG: 사진에 알맞고 파일이 작아요 (투명한 곳은 흰색)." : "WebP: 웹용. JPG 보다 작아요."}
          {size !== null && ` · 예상 크기 ${size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)}MB` : `${Math.round(size / 1024)}KB`}`}
        </p>
        <div className="dialog-actions">
          <button className="suite-ai-link" onClick={onClose}>
            취소
          </button>
          <button className="suite-button" onClick={() => onExport(type, quality, scale / 100)}>
            내보내기…
          </button>
        </div>
      </div>
    </div>
  );
}

function FilterDialog({ filter, onPreview, onCancel, onApply }: { filter: FilterKind; onPreview: (amount: number) => Promise<void>; onCancel: () => void; onApply: (amount: number) => void }) {
  const def = FILTERS.find((f) => f.kind === filter)!;
  const [amount, setAmount] = useState(def.initial);
  const busy = useRef(false);
  const pending = useRef<number | null>(null);
  useEffect(() => {
    const run = async (v: number) => {
      if (busy.current) {
        pending.current = v;
        return;
      }
      busy.current = true;
      await onPreview(v);
      busy.current = false;
      if (pending.current !== null) {
        const next = pending.current;
        pending.current = null;
        void run(next);
      }
    };
    const t = setTimeout(() => void run(amount), 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount]);
  return (
    <div className="filter-dialog" role="dialog" aria-label={def.label}>
      <h3>{def.label}</h3>
      <label className="ps-num wide">
        <span>{def.amountLabel}</span>
        <input type="range" min={def.min} max={def.max} step={def.max <= 60 ? 0.5 : 1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        <b>{amount}</b>
      </label>
      <div className="dialog-actions">
        <button className="suite-ai-link" onClick={onCancel}>
          취소
        </button>
        <button className="suite-button" onClick={() => onApply(amount)}>
          적용
        </button>
      </div>
    </div>
  );
}

export { layerMatrix, pixelsAsync };
