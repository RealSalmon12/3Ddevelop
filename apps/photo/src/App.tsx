import { useCallback, useEffect, useState } from "react";
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
  useHistory,
  useToast,
  useTour,
  useUpdater,
  type Menu,
  type Tool,
  type TourStep,
} from "@suite/ui";
import { AI_SYSTEM, AI_TOOL, aiContext, aiImages, applyAIEdit, type AIEdit } from "./ai";
import { blankDoc, newId, newImageLayer, newTextLayer, parse, renderDoc, serialize, SIZES, type Layer, type PhotoDoc } from "./doc";
import { fitPhotoView, PhotoCanvas, type CropRect, type ToolId } from "./PhotoCanvas";
import { LayersPanel, PropsPanel } from "./Props";

const TOOLS: (Tool & { id: ToolId })[] = [
  { id: "move", label: "옮기기", icon: "✥", hint: "사진이나 글자를 클릭해서 고르고, 끌어서 옮겨요. 모서리를 끌면 크기가 바뀌어요", shortcut: "V" },
  { id: "text", label: "글자", icon: "T", hint: "그림을 클릭하면 그 자리에 글자를 넣어요", shortcut: "T" },
  { id: "crop", label: "자르기", icon: "⛶", hint: "남길 부분을 끌어서 고르고 ‘자르기’를 눌러요", shortcut: "C" },
];

const HINTS: Record<ToolId, string> = {
  move: "클릭: 고르기 · 끌기: 옮기기 · 모서리 끌기: 크기 · 휠: 확대/축소 · 오른쪽 끌기: 화면 옮기기",
  text: "그림을 클릭하면 글자가 생겨요. 오른쪽에서 글자 내용과 색을 바꿔요",
  crop: "남길 부분을 끌어서 고르고, 위의 ‘자르기’를 누르거나 Enter",
};

const TOUR_STEPS: TourStep[] = [
  { title: "루미 포토에 오신 걸 환영해요! 👋", body: "사진을 꾸미고 글자를 넣어서 썸네일이나 게임 아이콘을 만들 수 있어요." },
  { title: "사진 넣기", target: ".suite-menu:nth-of-type(1)", body: "‘파일 → 사진 넣기’(Ctrl+I)로 사진을 가져와요. 사진 파일을 창에 끌어다 놓아도 돼요." },
  { title: "도구", target: ".suite-toolbar", body: "옮기기(V)로 사진과 글자를 옮기고 키우고, 글자(T)로 글자를 넣고, 자르기(C)로 필요한 부분만 남겨요." },
  { title: "보정과 필터", target: ".suite-side .suite-panel:nth-of-type(1)", body: "사진을 고르면 ‘선명하게’, ‘따뜻하게’, ‘흑백’ 같은 필터와 밝기·대비·채도를 바꿀 수 있어요." },
  { title: "AI 에게 부탁하기 ✨", target: ".suite-side .suite-panel:last-of-type", body: "“유튜브 썸네일처럼 만들어줘”라고 쓰면 AI 가 사진을 보고 보정하고 글자를 넣어 줘요." },
  { title: "저장하기", target: ".suite-menu:nth-of-type(1)", body: "‘PNG 로 내보내기’나 ‘JPG 로 내보내기’로 그림 파일을 만들어요. 나중에 고치려면 ‘저장’(Ctrl+S)도 해 두세요." },
];

const PROJECT = { name: "루미 포토 파일", extensions: ["nphoto"] };
const IMAGES = { name: "사진", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] };
const MAX_SIDE = 2560;
const baseName = (p: string) => p.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");

/** 사진을 읽어서 너무 크면 줄인다. */
async function loadPhoto(dataUrl: string): Promise<{ src: string; width: number; height: number }> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  if (scale === 1) return { src: dataUrl, width: img.naturalWidth, height: img.naturalHeight };
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return { src: c.toDataURL("image/jpeg", 0.92), width: c.width, height: c.height };
}

async function exportBytes(doc: PhotoDoc, type: "image/png" | "image/jpeg"): Promise<Uint8Array> {
  const c = document.createElement("canvas");
  c.width = doc.width;
  c.height = doc.height;
  const ctx = c.getContext("2d")!;
  if (type === "image/jpeg") {
    ctx.fillStyle = doc.background ?? "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
  }
  renderDoc(ctx, doc, () => {});
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, type, 0.92));
  if (!blob) throw new Error("그림을 만들지 못했어요.");
  return new Uint8Array(await blob.arrayBuffer());
}

export function App() {
  const history = useHistory<PhotoDoc>(blankDoc());
  const doc = history.state;
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tool, setTool] = useState<ToolId>("move");
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(true);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [toast, notify] = useToast(4500);
  const tour = useTour("photo");
  const updater = useUpdater(notify);
  const selected = doc.layers.find((l) => l.id === selectedId) ?? null;
  const name = filePath ? baseName(filePath) : "제목 없음";

  useEffect(() => {
    document.title = `${history.dirty ? "● " : ""}${name} - 루미 포토`;
    window.suite?.window.setDirty(history.dirty);
  }, [name, history.dirty]);

  const replaceLayer = (layer: Layer) => (d: PhotoDoc) => ({ ...d, layers: d.layers.map((l) => (l.id === layer.id ? layer : l)) });
  const changeLayer = useCallback((layer: Layer) => history.set(replaceLayer(layer)), [history.set]);
  const previewLayer = useCallback((layer: Layer) => history.preview(replaceLayer(layer)), [history.preview]);

  const confirmDiscard = () => !history.dirty || window.confirm("저장하지 않은 작업이 사라져요. 계속할까요?");

  const addPhotoFromDataUrl = useCallback(
    async (dataUrl: string, label: string) => {
      try {
        const photo = await loadPhoto(dataUrl);
        const cur = history.get();
        // 빈 그림에 처음 넣는 사진이면 그림 크기를 사진에 맞춘다.
        const base = cur.layers.length === 0 && !history.dirty ? { ...cur, width: photo.width, height: photo.height } : cur;
        const layer = newImageLayer(base, photo.src, photo.width, photo.height, label);
        history.set({ ...base, layers: [...base.layers, layer] });
        setSelectedId(layer.id);
        setTool("move");
        requestAnimationFrame(fitPhotoView);
      } catch {
        notify("이 사진은 읽을 수 없어요. PNG 나 JPG 로 해 주세요.");
      }
    },
    [history, notify],
  );

  const insertPhoto = useCallback(async () => {
    if (!window.suite) return;
    const r = await window.suite.files.open({ filters: [IMAGES], binary: true });
    if (!r.ok) return r.reason === "error" && notify(`사진을 열지 못했어요. ${r.message ?? ""}`);
    const ext = r.path.split(".").pop()!.toLowerCase();
    await addPhotoFromDataUrl(`data:image/${ext === "jpg" ? "jpeg" : ext};base64,${r.text}`, baseName(r.path));
  }, [addPhotoFromDataUrl, notify]);

  const newDoc = (width: number, height: number) => {
    setNewOpen(false);
    if (!confirmDiscard()) return;
    history.reset(blankDoc(width, height));
    setSelectedId(null);
    setFilePath(null);
    requestAnimationFrame(fitPhotoView);
  };

  const openProject = async () => {
    if (!window.suite || !confirmDiscard()) return;
    const r = await window.suite.files.open({ filters: [PROJECT] });
    if (!r.ok) return r.reason === "error" && notify(`파일을 열지 못했어요. ${r.message ?? ""}`);
    try {
      history.reset(parse(r.text));
      setFilePath(r.path);
      setSelectedId(null);
      requestAnimationFrame(fitPhotoView);
    } catch (err) {
      notify((err as Error).message);
    }
  };

  const save = async (saveAs = false) => {
    if (!window.suite) return;
    const r = await window.suite.files.save({
      path: saveAs ? undefined : filePath ?? undefined,
      defaultName: `${name}.nphoto`,
      filters: [PROJECT],
      data: serialize(history.get()),
    });
    if (r.ok) {
      history.markSaved();
      setFilePath(r.path);
      notify("저장했어요.");
    } else if (r.reason === "error") notify(`저장하지 못했어요. ${r.message ?? ""}`);
  };

  const exportAs = async (type: "png" | "jpg") => {
    if (!window.suite) return;
    const r = await window.suite.files.save({
      defaultName: `${name}.${type}`,
      filters: [{ name: type.toUpperCase(), extensions: [type] }],
      data: await exportBytes(history.get(), type === "png" ? "image/png" : "image/jpeg"),
    });
    if (r.ok) notify(`${type.toUpperCase()} 로 저장했어요 (${doc.width}×${doc.height}).`);
    else if (r.reason === "error") notify(`내보내지 못했어요. ${r.message ?? ""}`);
  };

  /** 그림 크기 바꾸기: 레이어는 가운데 기준으로 그대로 둔다. */
  const resizeCanvas = (width: number, height: number) => {
    history.set((d) => ({
      ...d,
      width,
      height,
      layers: d.layers.map((l) => ({ ...l, x: l.x + (width - d.width) / 2, y: l.y + (height - d.height) / 2 })),
    }));
    requestAnimationFrame(fitPhotoView);
  };

  const applyCrop = () => {
    if (!crop) return notify("먼저 남길 부분을 끌어서 골라 주세요.");
    history.set((d) => ({
      ...d,
      width: crop.w,
      height: crop.h,
      layers: d.layers.map((l) => ({ ...l, x: l.x - crop.x, y: l.y - crop.y })),
    }));
    setCrop(null);
    setTool("move");
    requestAnimationFrame(fitPhotoView);
  };

  /** 자르기 칸을 정해진 비율로 가운데에 */
  const cropRatio = (rw: number, rh: number) => {
    const w = Math.min(doc.width, (doc.height * rw) / rh);
    const h = (w * rh) / rw;
    setCrop({ x: Math.round((doc.width - w) / 2), y: Math.round((doc.height - h) / 2), w: Math.round(w), h: Math.round(h) });
  };

  const removeLayer = (id: number) => {
    history.set((d) => ({ ...d, layers: d.layers.filter((l) => l.id !== id) }));
    setSelectedId(null);
  };
  const moveLayer = (id: number, dir: 1 | -1) =>
    history.set((d) => {
      const i = d.layers.findIndex((l) => l.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= d.layers.length) return d;
      const layers = [...d.layers];
      [layers[i], layers[j]] = [layers[j], layers[i]];
      return { ...d, layers };
    });
  const duplicateLayer = (id: number) => {
    const src = doc.layers.find((l) => l.id === id);
    if (!src) return;
    const copy = { ...src, id: newId(), x: src.x + 30, y: src.y + 30 };
    history.set((d) => ({ ...d, layers: [...d.layers, copy] }));
    setSelectedId(copy.id);
  };

  // 자동 저장: 갑자기 꺼졌을 때 되살리기
  useEffect(() => {
    const autosave = window.suite?.autosave;
    if (!autosave) return;
    autosave.read().then((saved) => {
      if (!saved) return;
      if (window.confirm("지난번에 프로그램이 저장하지 않은 채로 꺼졌어요.\n그때 작업을 다시 불러올까요?")) {
        try {
          history.reset(parse(saved.text), true);
          requestAnimationFrame(fitPhotoView);
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
    const timer = setInterval(() => void autosave.write(serialize(history.get())), 20_000);
    return () => clearInterval(timer);
  }, [history.dirty, history.get]);

  // 사진 파일을 창에 끌어다 놓기
  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer?.files[0];
      if (!file || !file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = () => void addPhotoFromDataUrl(reader.result as string, file.name.replace(/\.[^.]+$/, ""));
      reader.readAsDataURL(file);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [addPhotoFromDataUrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || (e.target instanceof HTMLInputElement && e.target.type !== "range") || isTourOpen() || newOpen) return;
      const key = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        const actions: Record<string, () => void> = {
          z: () => (e.shiftKey ? history.redo() : history.undo()),
          y: history.redo,
          s: () => void save(e.shiftKey),
          o: () => void openProject(),
          n: () => setNewOpen(true),
          i: () => void insertPhoto(),
          e: () => void exportAs("png"),
          d: () => selectedId && duplicateLayer(selectedId),
        };
        if (actions[key]) {
          e.preventDefault();
          actions[key]();
        }
        return;
      }
      const t = TOOLS.find((x) => x.shortcut!.toLowerCase() === key);
      if (t) setTool(t.id);
      else if ((key === "delete" || key === "backspace") && selectedId) removeLayer(selectedId);
      else if (key === "enter" && tool === "crop") applyCrop();
      else if (key === "escape") tool === "crop" ? setCrop(null) : setSelectedId(null);
      else if (key === "0") fitPhotoView();
      else if (selectedId && key.startsWith("arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const l = doc.layers.find((x) => x.id === selectedId)!;
        const dx = key === "arrowleft" ? -step : key === "arrowright" ? step : 0;
        const dy = key === "arrowup" ? -step : key === "arrowdown" ? step : 0;
        changeLayer({ ...l, x: l.x + dx, y: l.y + dy });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const menus: Menu[] = [
    {
      label: "파일",
      items: [
        { label: "새로 만들기…", shortcut: "Ctrl+N", onSelect: () => setNewOpen(true) },
        { label: "사진 넣기…", shortcut: "Ctrl+I", onSelect: () => void insertPhoto() },
        { label: "열기…", shortcut: "Ctrl+O", onSelect: () => void openProject() },
        { label: "저장", shortcut: "Ctrl+S", onSelect: () => void save() },
        { label: "다른 이름으로 저장…", shortcut: "Ctrl+Shift+S", onSelect: () => void save(true) },
        { label: "PNG 로 내보내기", shortcut: "Ctrl+E", onSelect: () => void exportAs("png") },
        { label: "JPG 로 내보내기 (작은 파일)", onSelect: () => void exportAs("jpg") },
      ],
    },
    {
      label: "편집",
      items: [
        { label: "실행 취소", shortcut: "Ctrl+Z", disabled: !history.canUndo, onSelect: history.undo },
        { label: "다시 실행", shortcut: "Ctrl+Y", disabled: !history.canRedo, onSelect: history.redo },
        { label: "복제", shortcut: "Ctrl+D", disabled: !selected, onSelect: () => selected && duplicateLayer(selected.id) },
        { label: "지우기", shortcut: "Delete", disabled: !selected, onSelect: () => selected && removeLayer(selected.id) },
        { label: "글자 넣기", onSelect: () => addText(doc.width / 2, doc.height / 2) },
      ],
    },
    {
      label: "그림 크기",
      items: SIZES.map((s) => ({ label: `${s.label} (${s.width}×${s.height})`, onSelect: () => resizeCanvas(s.width, s.height) })),
    },
    {
      label: "도움말",
      items: [
        { label: "따라하기 안내 다시 보기", onSelect: tour.start },
        { label: "업데이트 확인", onSelect: () => void updater.check(true) },
      ],
    },
  ];

  function addText(x: number, y: number) {
    const layer = { ...newTextLayer(doc), x, y };
    history.set((d) => ({ ...d, layers: [...d.layers, layer] }));
    setSelectedId(layer.id);
    setTool("move");
    requestAnimationFrame(() => {
      const box = document.querySelector<HTMLTextAreaElement>(".prop-text");
      box?.focus();
      box?.select();
    });
  }

  return (
    <AppFrame
      menubar={
        <MenuBar
          appName="루미 포토"
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
      toolbar={
        <Toolbar
          tools={TOOLS}
          active={tool}
          onChange={(id) => {
            setTool(id as ToolId);
            if (id === "crop") cropRatio(doc.width, doc.height);
            else setCrop(null);
          }}
        />
      }
      sidebar={
        <>
          <PropsPanel
            doc={doc}
            layer={selected}
            onPreview={previewLayer}
            onCommit={history.commit}
            onChange={changeLayer}
            onBackground={(c) => history.set((d) => ({ ...d, background: c }))}
          />
          <LayersPanel
            doc={doc}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onToggle={(id) => history.set((d) => ({ ...d, layers: d.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)) }))}
            onMove={moveLayer}
            onDelete={removeLayer}
            onDuplicate={duplicateLayer}
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
        <StatusBar hint={HINTS[tool]}>
          <span>
            {history.dirty ? "● " : ""}
            {name}
          </span>
          <span>
            {doc.width} × {doc.height}
          </span>
          <span>레이어 {doc.layers.length}개</span>
        </StatusBar>
      }
    >
      <PhotoCanvas
        doc={doc}
        tool={tool}
        selectedId={selectedId}
        crop={crop}
        onSelect={setSelectedId}
        onDrag={previewLayer}
        onDragEnd={history.commit}
        onAddText={addText}
        onCrop={setCrop}
      />
      {tool === "crop" && (
        <div className="photo-options" role="group" aria-label="자르기">
          <span>비율</span>
          <button onClick={() => cropRatio(16, 9)}>16:9 썸네일</button>
          <button onClick={() => cropRatio(1, 1)}>1:1 아이콘</button>
          <button onClick={() => cropRatio(9, 16)}>9:16 세로</button>
          <button onClick={() => cropRatio(doc.width, doc.height)}>전체</button>
          <button className="go" onClick={applyCrop}>
            ✂ 자르기
          </button>
        </div>
      )}
      {doc.layers.length === 0 && !newOpen && (
        <div className="photo-empty">
          <p>사진을 이 창에 끌어다 놓거나</p>
          <button className="suite-button" onClick={() => void insertPhoto()}>
            사진 넣기
          </button>
          <button className="suite-ai-link" onClick={() => addText(doc.width / 2, doc.height / 2)}>
            글자부터 넣기
          </button>
        </div>
      )}
      {newOpen && (
        <div className="dialog-dim" onMouseDown={(e) => e.target === e.currentTarget && setNewOpen(false)}>
          <div className="dialog" role="dialog" aria-label="새로 만들기">
            <h2>어떤 그림을 만들까요?</h2>
            <p>크기는 나중에 ‘그림 크기’ 메뉴에서 바꿀 수 있어요.</p>
            <div className="size-grid">
              {SIZES.map((s) => (
                <button key={s.label} className="size-card" onClick={() => newDoc(s.width, s.height)}>
                  <span className="size-demo" style={{ aspectRatio: `${s.width} / ${s.height}`, ["--cells" as string]: 4 }} />
                  <b>{s.label}</b>
                  <span>
                    {s.width} × {s.height}
                  </span>
                </button>
              ))}
            </div>
            <div className="dialog-actions">
              <button className="suite-ai-link" onClick={() => setNewOpen(false)}>
                취소
              </button>
            </div>
          </div>
        </div>
      )}
      <Toast message={toast} />
      <Tour steps={TOUR_STEPS} open={tour.open} onFinish={tour.finish} />
    </AppFrame>
  );
}
