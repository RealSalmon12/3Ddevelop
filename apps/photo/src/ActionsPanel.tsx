import { useRef, useState } from "react";
import { actionFile, describe, newActionId, parseActionFile, playAction, type PhotoAction } from "./actions";
import { newRasterLayer, type PhotoDoc } from "./model";
import { putCanvas } from "./pixels";
import { flatten } from "./render";

const ACTION_FILE = { name: "바코 진주 액션", extensions: ["bact"] };
const IMAGE_EXT = ["png", "jpg", "jpeg", "webp", "gif", "bmp"];

interface Props {
  actions: PhotoAction[];
  setActions: (fn: (list: PhotoAction[]) => PhotoAction[]) => void;
  selected: string | null;
  onSelect: (id: string) => void;
  /** 기록 중인 액션 */
  recording: string | null;
  onRecord: (id: string | null) => void;
  onPlay: (a: PhotoAction) => void;
  onBatch: () => void;
  onClose: () => void;
  notify: (m: string) => void;
}

/** 액션 패널 (Alt+F9): 기록, 실행, 단계 켜고 끄기, 나눠 주기 */
export function ActionsPanel({ actions, setActions, selected, onSelect, recording, onRecord, onPlay, onBatch, onClose, notify }: Props) {
  const action = actions.find((a) => a.id === selected) ?? null;
  const [renaming, setRenaming] = useState<string | null>(null);
  const update = (id: string, fn: (a: PhotoAction) => PhotoAction) => setActions((list) => list.map((a) => (a.id === id ? fn(a) : a)));

  const create = () => {
    const a: PhotoAction = { id: newActionId(), name: `액션 ${actions.length + 1}`, steps: [] };
    setActions((list) => [...list, a]);
    onSelect(a.id);
    onRecord(a.id);
    notify("기록을 시작했어요. 메뉴로 크기 바꾸기, 자르기, 필터, 조정 레이어, 글자 넣기를 하면 순서대로 남아요. 다 하면 ■ 를 눌러요.");
  };

  const exportFile = async (list: PhotoAction[]) => {
    if (!window.suite || !list.length) return;
    const r = await window.suite.files.save({ defaultName: `${list.length === 1 ? list[0].name : "진주 액션"}.bact`, filters: [ACTION_FILE], data: actionFile(list) });
    if (r.ok) notify("액션 파일로 저장했어요. 디스코드에 올려 친구와 나눠 쓸 수 있어요.");
  };
  const importFile = async () => {
    if (!window.suite) return;
    const r = await window.suite.files.open({ filters: [ACTION_FILE] });
    if (!r.ok) return;
    try {
      const list = parseActionFile(r.text);
      setActions((cur) => [...cur, ...list]);
      if (list[0]) onSelect(list[0].id);
      notify(`액션 ${list.length}개를 가져왔어요.`);
    } catch {
      notify("액션 파일을 읽지 못했어요.");
    }
  };

  return (
    <div className="actions-panel" role="dialog" aria-label="액션">
      <div className="actions-head">
        <b>액션</b>
        <span className="actions-sub">반복 작업을 기록해 두고 한 번에</span>
        <button className="actions-x" title="닫기 (Alt+F9)" onClick={onClose}>
          ✕
        </button>
      </div>
      <ul className="actions-list">
        {actions.map((a) => (
          <li key={a.id}>
            <button className={a.id === selected ? "on" : ""} onClick={() => onSelect(a.id)} onDoubleClick={() => setRenaming(a.id)}>
              {recording === a.id && <span className="actions-rec-dot">●</span>}
              {renaming === a.id ? (
                <input
                  autoFocus
                  defaultValue={a.name}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name) update(a.id, (x) => ({ ...x, name }));
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setRenaming(null);
                    e.stopPropagation();
                  }}
                />
              ) : (
                a.name
              )}
              <span className="actions-count">{a.steps.length}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="actions-bar">
        <button title="고른 액션을 지금 그림에 실행" disabled={!action || !!recording || !action.steps.some((s) => s.on)} onClick={() => action && onPlay(action)}>
          ▶ 실행
        </button>
        {recording ? (
          <button className="actions-rec on" title="기록 멈추기" onClick={() => onRecord(null)}>
            ■ 멈춤
          </button>
        ) : (
          <button className="actions-rec" title="고른 액션 끝에 이어서 기록" disabled={!action} onClick={() => action && onRecord(action.id)}>
            ● 기록
          </button>
        )}
        <button title="새 액션을 만들고 바로 기록" disabled={!!recording} onClick={create}>
          ＋ 새 액션
        </button>
        <button title="여러 사진에 한 번에 (일괄 처리)" disabled={!!recording} onClick={onBatch}>
          ⧉ 일괄 처리…
        </button>
      </div>
      {action && (
        <>
          <ol className="actions-steps">
            {action.steps.length === 0 && <li className="actions-empty">아직 단계가 없어요. ● 기록을 누르고 메뉴로 작업해 보세요.</li>}
            {action.steps.map((s, i) => (
              <li key={i} className={s.on ? "" : "off"}>
                <input
                  type="checkbox"
                  checked={s.on}
                  title="끄면 실행할 때 건너뛰어요"
                  onChange={(e) => update(action.id, (a) => ({ ...a, steps: a.steps.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)) }))}
                />
                <span className="actions-step-text">{describe(s.step)}</span>
                <button
                  title="위로"
                  disabled={i === 0}
                  onClick={() =>
                    update(action.id, (a) => {
                      const steps = [...a.steps];
                      [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]];
                      return { ...a, steps };
                    })
                  }
                >
                  ▲
                </button>
                <button title="이 단계 지우기" onClick={() => update(action.id, (a) => ({ ...a, steps: a.steps.filter((_, j) => j !== i) }))}>
                  ✕
                </button>
              </li>
            ))}
          </ol>
          <div className="actions-bar small">
            <button title="이름 바꾸기 (두 번 클릭해도 돼요)" onClick={() => setRenaming(action.id)}>
              이름 바꾸기
            </button>
            <button title="같은 액션을 하나 더" onClick={() => setActions((list) => [...list, { ...structuredClone(action), id: newActionId(), name: `${action.name} 복사` }])}>
              복제
            </button>
            <button title=".bact 파일로 저장해서 나눠 주기" onClick={() => void exportFile([action])}>
              파일로 저장
            </button>
            <button title=".bact 액션 파일 가져오기" onClick={() => void importFile()}>
              가져오기
            </button>
            <button
              title="이 액션 지우기"
              disabled={recording === action.id}
              onClick={() => {
                if (!window.confirm(`‘${action.name}’ 액션을 지울까요?`)) return;
                setActions((list) => list.filter((a) => a.id !== action.id));
              }}
            >
              지우기
            </button>
          </div>
        </>
      )}
      <p className="actions-tip">기록되는 것: 이미지·캔버스 크기, 회전·뒤집기, 자르기, 필터, 조정 레이어, 글자, 레이어 보정·스타일, 병합. 붓질처럼 손으로 그린 것은 사진마다 달라서 기록하지 않아요.</p>
    </div>
  );
}

interface BatchProps {
  actions: PhotoAction[];
  initial: string | null;
  decode: (blob: Blob) => Promise<HTMLCanvasElement>;
  onClose: () => void;
  notify: (m: string) => void;
}

type Format = "png" | "jpg" | "webp";

/** 일괄 처리: 여러 사진에 액션을 실행하고 폴더에 저장 */
export function BatchDialog({ actions, initial, decode, onClose, notify }: BatchProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [actionId, setActionId] = useState(initial ?? actions[0]?.id ?? "");
  const [folder, setFolder] = useState<string | null>(null);
  const [format, setFormat] = useState<Format>("jpg");
  const [quality, setQuality] = useState(90);
  const [suffix, setSuffix] = useState("-편집");
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const cancel = useRef(false);
  const sep = window.suite?.platform === "win32" ? "\\" : "/";
  const action = actions.find((a) => a.id === actionId) ?? null;

  const pick = async () => {
    const list = await window.suite?.files.pick({ filters: [{ name: "그림", extensions: IMAGE_EXT }], multiple: true });
    if (list?.length) setFiles((cur) => [...new Set([...cur, ...list])]);
  };

  const run = async () => {
    if (!window.suite || !action || !files.length || !folder) return;
    cancel.current = false;
    const out: string[] = [];
    let ok = 0;
    for (let i = 0; i < files.length; i++) {
      if (cancel.current) break;
      const path = files[i];
      const base = path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");
      setProgress({ done: i, total: files.length, current: base });
      try {
        const bytes = await window.suite.files.read(path);
        if (!bytes) throw new Error("읽을 수 없어요");
        const c = await decode(new Blob([bytes.slice().buffer as ArrayBuffer]));
        const start: PhotoDoc = { width: c.width, height: c.height, background: null, layers: [] };
        const layer = newRasterLayer(start, putCanvas(c), c.width, c.height, base);
        const r = await playAction(action, { ...start, layers: [layer] }, layer.id);
        const d = format === "jpg" && !r.doc.background ? { ...r.doc, background: "#ffffff" } : r.doc;
        const canvas = flatten(d);
        const mime = format === "png" ? "image/png" : format === "jpg" ? "image/jpeg" : "image/webp";
        const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, mime, quality / 100));
        if (!blob) throw new Error("그림을 만들지 못했어요");
        const target = `${folder}${folder.endsWith(sep) ? "" : sep}${base}${suffix}.${format}`;
        if (target === path) throw new Error("원본과 같은 이름이라 건너뛰었어요 (붙일 말을 넣어 주세요)");
        const saved = await window.suite.files.save({ path: target, defaultName: `${base}.${format}`, filters: [], data: new Uint8Array(await blob.arrayBuffer()) });
        if (!saved.ok) throw new Error(saved.reason === "error" ? (saved.message ?? "저장 실패") : "취소");
        ok++;
        if (r.skipped.length) out.push(`${base}: ${r.skipped.join(", ")}`);
      } catch (e) {
        out.push(`${base}: ${e instanceof Error ? e.message : String(e)}`);
      }
      setLog([...out]);
    }
    setProgress(null);
    notify(cancel.current ? `멈췄어요. ${ok}장 저장했어요.` : `일괄 처리 끝! ${ok}/${files.length}장을 저장했어요.`);
    if (!out.length && !cancel.current) onClose();
  };

  const busy = !!progress;
  return (
    <div className="dialog-dim">
      <div className="dialog batch-dialog" role="dialog" aria-label="일괄 처리">
        <h2>일괄 처리</h2>
        <p className="batch-note">여러 사진에 같은 액션을 한 번에 실행하고 폴더에 저장해요. 원본은 그대로 둬요.</p>
        <label className="batch-row">
          <span>액션</span>
          <select value={actionId} disabled={busy} onChange={(e) => setActionId(e.target.value)}>
            {actions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.steps.filter((s) => s.on).length}단계)
              </option>
            ))}
          </select>
        </label>
        <div className="batch-row">
          <span>사진</span>
          <div className="batch-files">
            <button className="suite-ai-link" disabled={busy} onClick={() => void pick()}>
              ＋ 사진 고르기
            </button>
            {files.length > 0 && (
              <button className="suite-ai-link" disabled={busy} onClick={() => setFiles([])}>
                모두 빼기
              </button>
            )}
            <span className="batch-count">{files.length}장</span>
          </div>
        </div>
        {files.length > 0 && (
          <ul className="batch-list">
            {files.map((f) => (
              <li key={f} title={f}>
                {f.split(/[\\/]/).pop()}
              </li>
            ))}
          </ul>
        )}
        <div className="batch-row">
          <span>저장할 폴더</span>
          <div className="batch-files">
            <button
              className="suite-ai-link"
              disabled={busy}
              onClick={async () => {
                const f = await window.suite?.files.pickFolder();
                if (f) setFolder(f);
              }}
            >
              폴더 고르기
            </button>
            <span className="batch-path" title={folder ?? ""}>
              {folder ?? "아직 안 골랐어요"}
            </span>
          </div>
        </div>
        <label className="batch-row">
          <span>형식</span>
          <select value={format} disabled={busy} onChange={(e) => setFormat(e.target.value as Format)}>
            <option value="jpg">JPG (사진, 작은 용량)</option>
            <option value="png">PNG (투명 유지)</option>
            <option value="webp">WebP (웹용, 가장 작음)</option>
          </select>
        </label>
        {format !== "png" && (
          <label className="batch-row">
            <span>품질</span>
            <input type="range" min={40} max={100} value={quality} disabled={busy} onChange={(e) => setQuality(Number(e.target.value))} />
            <b>{quality}</b>
          </label>
        )}
        <label className="batch-row">
          <span>이름 뒤에 붙일 말</span>
          <input value={suffix} disabled={busy} onChange={(e) => setSuffix(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        </label>
        {progress && (
          <div className="batch-progress">
            <div style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            <span>
              {progress.done + 1}/{progress.total} · {progress.current}
            </span>
          </div>
        )}
        {log.length > 0 && (
          <ul className="batch-log">
            {log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        )}
        <div className="dialog-actions">
          {busy ? (
            <button className="suite-ai-link" onClick={() => (cancel.current = true)}>
              멈추기
            </button>
          ) : (
            <button className="suite-ai-link" onClick={onClose}>
              닫기
            </button>
          )}
          <button className="suite-button" disabled={busy || !action || !files.length || !folder} onClick={() => void run()}>
            {files.length ? `${files.length}장 처리하기` : "처리하기"}
          </button>
        </div>
      </div>
    </div>
  );
}
