import { useEffect, useState } from "react";
import { Panel } from "@suite/ui";
import { PAINT_BRUSHES, type PaintSettings } from "../mesh/texturePaint";
import type { ModelerScene } from "../scene/ModelerScene";

interface Props {
  model: ModelerScene;
  id: string;
  name: string;
  settings: PaintSettings;
  onChange: (s: PaintSettings) => void;
  notify: (message: string) => void;
}

const IMAGE_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", bmp: "image/bmp", gif: "image/gif" };
const SWATCHES = ["#e0523a", "#f2a541", "#f6e05e", "#5cb85c", "#3a8ee0", "#7a5cd6", "#ffffff", "#8a8a8a", "#222222", "#8b5a2b", "#f3c6a5"];

async function savePng(canvas: HTMLCanvasElement, defaultName: string, notify: (m: string) => void, done: string) {
  if (!window.suite) return;
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) return notify("그림을 만들지 못했어요.");
  const result = await window.suite.files.save({ defaultName, filters: [{ name: "PNG 그림", extensions: ["png"] }], data: new Uint8Array(await blob.arrayBuffer()) });
  if (result.ok) notify(done);
  else if (result.reason === "error") notify(`저장하지 못했어요. ${result.message ?? ""}`);
}

/** 텍스처 칠하기 모드 (블렌더의 Texture Paint): 붓, 색, 그림 미리 보기, UV 펼치기 */
export function PaintPanel({ model, id, name, settings, onChange, notify }: Props) {
  const set = (patch: Partial<PaintSettings>) => onChange({ ...settings, ...patch });
  const [showUV, setShowUV] = useState(true);
  const [preview, setPreview] = useState("");
  // 붓을 뗄 때마다 (기록이 남을 때마다) 미리 보기를 새로 그린다
  useEffect(() => {
    let last: unknown = null;
    const draw = () => {
      const paint = model.getPaint(id);
      const uv = model.getMesh(id)?.userData.uv;
      // 그림이나 UV 가 바뀐 때만
      const key = paint?.url ?? "";
      if (last && (last as [string, unknown])[0] === key && (last as [string, unknown])[1] === uv) return;
      last = [key, uv];
      if (!paint) return setPreview("");
      const c = model.uvLayout(id, true);
      if (!showUV || !c) return setPreview(paint.url);
      // 작은 미리 보기용으로 줄인다
      const small = document.createElement("canvas");
      small.width = small.height = 256;
      small.getContext("2d")!.drawImage(c, 0, 0, 256, 256);
      setPreview(small.toDataURL("image/png"));
    };
    draw();
    const off = model.subscribe(draw);
    return () => void off();
  }, [model, id, showUV]);

  const loadImage = async () => {
    if (!window.suite) return;
    const result = await window.suite.files.open({ filters: [{ name: "그림", extensions: Object.keys(IMAGE_EXT) }], binary: true });
    if (!result.ok) {
      if (result.reason === "error") notify(`그림을 열지 못했어요. ${result.message ?? ""}`);
      return;
    }
    const ext = (result.path.split(".").pop() ?? "png").toLowerCase();
    const img = new Image();
    img.onload = () => {
      model.applyImage(id, img);
      notify("그림을 입혔어요. UV 배치도를 저장해 바코 진주에서 맞춰 그린 뒤 다시 불러오면 딱 맞게 입혀져요.");
    };
    img.onerror = () => notify("그림 파일을 읽지 못했어요.");
    img.src = `data:${IMAGE_EXT[ext] ?? "image/png"};base64,${result.text}`;
  };

  return (
    <Panel title="텍스처 칠하기" className="sculpt-panel paint-panel">
      <div className="sculpt-brushes paint-brushes">
        {PAINT_BRUSHES.map((b) => (
          <button key={b.id} className="prop-small-button" aria-pressed={settings.brush === b.id} title={`${b.hint} (${b.key})`} onClick={() => set({ brush: b.id })}>
            <b>{b.icon}</b> {b.label}
          </button>
        ))}
      </div>
      <div className="paint-colors">
        <input type="color" value={settings.color} title="붓 색" aria-label="붓 색" onChange={(e) => set({ color: e.target.value, brush: settings.brush === "pick" ? "paint" : settings.brush })} />
        {SWATCHES.map((c) => (
          <button key={c} className="paint-swatch" style={{ background: c }} aria-pressed={settings.color === c} title={c} onClick={() => set({ color: c, brush: "paint" })} />
        ))}
      </div>
      <label className="prop-row" title="붓 크기 ([ 와 ] 키)">
        <span className="prop-label">크기</span>
        <input type="range" min={2} max={300} value={settings.radius} onChange={(e) => set({ radius: Number(e.target.value) })} />
        <span className="sculpt-value">{settings.radius}px</span>
      </label>
      <label className="prop-row" title="불투명도 (Shift+[ 와 Shift+])">
        <span className="prop-label">진하기</span>
        <input type="range" min={0.05} max={1} step={0.05} value={settings.strength} onChange={(e) => set({ strength: Number(e.target.value) })} />
        <span className="sculpt-value">{Math.round(settings.strength * 100)}%</span>
      </label>
      <label className="prop-row" title="가장자리를 또렷하게 할지 부드럽게 번지게 할지">
        <span className="prop-label">단단함</span>
        <input type="range" min={0} max={1} step={0.05} value={settings.hardness} onChange={(e) => set({ hardness: Number(e.target.value) })} />
        <span className="sculpt-value">{Math.round(settings.hardness * 100)}%</span>
      </label>
      <label className="boolean-keep" title="왼쪽을 칠하면 오른쪽도 똑같이 (얼굴, 옷)">
        <input type="checkbox" checked={settings.symmetry} onChange={(e) => set({ symmetry: e.target.checked })} /> 좌우 대칭 (X)
      </label>

      <div className="paint-preview" title="펼친 그림 (UV). 하얀 선이 조각 테두리예요">
        {preview ? <img src={preview} alt="텍스처 미리 보기" /> : <span>모양 위를 칠하면 여기에 펼친 그림이 보여요</span>}
      </div>
      <label className="boolean-keep">
        <input type="checkbox" checked={showUV} onChange={(e) => setShowUV(e.target.checked)} /> UV 조각 테두리 보기
      </label>
      <div className="paint-actions">
        <button className="prop-small-button" title="바닥색 전체를 지금 붓 색으로" onClick={() => model.fillPaint(id, settings.color)}>
          ▣ 전체 채우기
        </button>
        <button className="prop-small-button" title="사진이나 그림 파일을 입히기 (PNG, JPG)" onClick={() => void loadImage()}>
          🖼 그림 입히기…
        </button>
        <button
          className="prop-small-button"
          title="스마트 UV 펼치기를 다시 해요 (모양을 많이 고친 뒤). 칠한 그림은 자리가 바뀌어요"
          onClick={() => {
            const n = model.unwrap(id);
            if (n) notify(`UV 를 다시 펼쳤어요 (조각 ${n}개). 칠한 그림이 어긋났으면 Ctrl+Z 로 되돌려요.`);
          }}
        >
          ✂ UV 다시 펼치기
        </button>
        <button
          className="prop-small-button"
          title="칠한 그림을 PNG 로 저장 (다른 3D 프로그램, 게임에서 텍스처로)"
          onClick={() => {
            const p = model.getPaint(id);
            if (p) void savePng(p.canvas, `${name}-텍스처.png`, notify, "텍스처를 저장했어요.");
          }}
        >
          💾 텍스처 저장…
        </button>
        <button
          className="prop-small-button"
          title="조각 테두리만 그린 PNG. 그림 프로그램에서 밑그림으로 쓰고 다시 ‘그림 입히기’로 불러와요"
          onClick={() => {
            const c = model.uvLayout(id);
            if (c) void savePng(c, `${name}-UV배치도.png`, notify, "UV 배치도를 저장했어요. 바코 진주에서 열어 그 위에 그려 보세요.");
          }}
        >
          ▦ UV 배치도 저장…
        </button>
        <button
          className="prop-small-button"
          title="칠한 그림을 떼고 처음 한 색으로"
          onClick={() => model.removePaint(id) && notify("그림을 뗐어요. Ctrl+Z 로 되돌릴 수 있어요.")}
        >
          ✕ 그림 떼기
        </button>
      </div>
      <p className="panel-empty sculpt-tip">모양 위를 끌면 칠하고, 빈 곳을 끌면 화면이 돌아가요. Ctrl: 잠깐 지우개 · B/E/I: 붓/지우개/스포이트 · GLB 로 내보내면 그림도 함께 들어가요.</p>
    </Panel>
  );
}
