import { useEffect, useRef, useState } from "react";
import { resample, type Sound } from "./audio";
import { CHAIN_PRESETS, describeStep, loadChain, measure, runChain, saveChain, STEP_INFO, type BatchStep, type StepKind } from "./batch";
import { encodeWav } from "./dsp";
import type { Fx } from "./effects";

const AUDIO_EXT = ["wav", "mp3", "ogg", "m4a", "webm", "flac", "aac"];

interface Props {
  /** 지금 효과 랙 (‘효과 랙’ 단계가 쓴다) */
  rack: Fx[];
  decode: (bytes: ArrayBuffer) => Promise<Sound>;
  onClose: () => void;
  notify: (m: string) => void;
}

interface Row {
  name: string;
  before?: { lufs: number; peak: number; seconds: number };
  after?: { lufs: number; peak: number; seconds: number };
  error?: string;
}

const db = (v: number | undefined, unit = "") => (v === undefined ? "" : Number.isFinite(v) ? `${v.toFixed(1)}${unit}` : "−∞");

/** 일괄 처리: 여러 소리 파일에 같은 처리 순서를 걸고, 전후 라우드니스를 표로 보여 준다 */
export function BatchDialog({ rack, decode, onClose, notify }: Props) {
  const [steps, setSteps] = useState<BatchStep[]>(loadChain);
  const [files, setFiles] = useState<string[]>([]);
  const [folder, setFolder] = useState<string | null>(null);
  const [bits, setBits] = useState<16 | 24 | 32>(16);
  const [rate, setRate] = useState<number>(0);
  const [suffix, setSuffix] = useState("-처리");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<{ i: number; total: number } | null>(null);
  const cancel = useRef(false);
  const sep = window.suite?.platform === "win32" ? "\\" : "/";
  useEffect(() => saveChain(steps), [steps]);

  const setStep = (i: number, patch: Record<string, number>) => setSteps((list) => list.map((s, j) => (j === i ? ({ ...s, ...patch } as BatchStep) : s)));
  const move = (i: number, d: -1 | 1) =>
    setSteps((list) => {
      const next = [...list];
      const j = i + d;
      if (j < 0 || j >= next.length) return list;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const pick = async () => {
    const list = await window.suite?.files.pick({ filters: [{ name: "소리 파일", extensions: AUDIO_EXT }], multiple: true });
    if (list?.length) {
      setFiles((cur) => [...new Set([...cur, ...list])]);
      setRows([]);
    }
  };

  /** save=false 면 재기만 한다 (분석) */
  const run = async (save: boolean) => {
    if (!window.suite || !files.length || (save && !folder)) return;
    cancel.current = false;
    const chain = steps.map((s) => (s.kind === "rack" ? { kind: "rack" as const, rack } : s));
    const out: Row[] = [];
    let ok = 0;
    for (let i = 0; i < files.length; i++) {
      if (cancel.current) break;
      const path = files[i];
      const base = path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");
      setBusy({ i, total: files.length });
      const row: Row = { name: base };
      try {
        const bytes = await window.suite.files.read(path);
        if (!bytes) throw new Error("읽을 수 없어요");
        const s = await decode(bytes.slice().buffer as ArrayBuffer);
        row.before = measure(s);
        if (save) {
          let done = await runChain(s, chain);
          row.after = measure(done);
          if (rate && rate !== done.sampleRate) done = resample(done, rate);
          const target = `${folder}${folder!.endsWith(sep) ? "" : sep}${base}${suffix}.wav`;
          if (target === path) throw new Error("원본과 같은 이름이에요 (붙일 말을 넣어 주세요)");
          const r = await window.suite.files.save({ path: target, defaultName: `${base}.wav`, filters: [], data: encodeWav(done, bits) });
          if (!r.ok) throw new Error(r.reason === "error" ? (r.message ?? "저장 실패") : "취소");
          ok++;
        }
      } catch (e) {
        row.error = e instanceof Error ? e.message : String(e);
      }
      out.push(row);
      setRows([...out]);
    }
    setBusy(null);
    if (save) notify(cancel.current ? `멈췄어요. ${ok}개 저장했어요.` : `일괄 처리 끝! ${ok}/${files.length}개를 WAV 로 저장했어요.`);
  };

  return (
    <div className="dialog-dim" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="dialog batch-dialog" role="dialog" aria-label="일괄 처리">
        <h2>일괄 처리</h2>
        <p className="dialog-hint">여러 소리 파일에 같은 처리를 순서대로 걸고 폴더에 WAV 로 저장해요. 게임 효과음 수십 개의 크기를 한 번에 맞출 때 좋아요. 원본은 그대로 둬요.</p>
        <div className="batch-cols">
          <section>
            <div className="batch-head">
              <b>처리 순서</b>
              <select
                value=""
                disabled={!!busy}
                onChange={(e) => {
                  const p = CHAIN_PRESETS[Number(e.target.value)];
                  if (p) setSteps(structuredClone(p.steps));
                }}
              >
                <option value="">프리셋 불러오기…</option>
                {CHAIN_PRESETS.map((p, i) => (
                  <option key={p.label} value={i}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <ol className="batch-steps">
              {steps.length === 0 && <li className="batch-empty">아래에서 처리를 더해 주세요.</li>}
              {steps.map((s, i) => {
                const info = STEP_INFO.find((x) => x.kind === s.kind)!;
                return (
                  <li key={i}>
                    <div className="batch-step-head">
                      <span title={info.hint}>
                        {i + 1}. {describeStep(s)}
                        {s.kind === "rack" && <em> ({rack.filter((f) => f.on).length}개 효과)</em>}
                      </span>
                      <button disabled={i === 0 || !!busy} title="위로" onClick={() => move(i, -1)}>
                        ▲
                      </button>
                      <button disabled={i === steps.length - 1 || !!busy} title="아래로" onClick={() => move(i, 1)}>
                        ▼
                      </button>
                      <button disabled={!!busy} title="빼기" onClick={() => setSteps((list) => list.filter((_, j) => j !== i))}>
                        ✕
                      </button>
                    </div>
                    {info.fields.map((f) => (
                      <label key={f.key} className="batch-field">
                        <span>{f.label}</span>
                        <input
                          type="number"
                          min={f.min}
                          max={f.max}
                          step={f.step ?? 1}
                          disabled={!!busy}
                          value={(s as unknown as Record<string, number>)[f.key]}
                          onChange={(e) => setStep(i, { [f.key]: Math.min(f.max, Math.max(f.min, Number(e.target.value))) })}
                          onKeyDown={(e) => e.stopPropagation()}
                        />
                        <em>{f.unit}</em>
                      </label>
                    ))}
                  </li>
                );
              })}
            </ol>
            <select
              className="batch-add"
              value=""
              disabled={!!busy}
              onChange={(e) => {
                const info = STEP_INFO.find((x) => x.kind === (e.target.value as StepKind));
                if (info) setSteps((list) => [...list, info.make()]);
              }}
            >
              <option value="">＋ 처리 더하기…</option>
              {STEP_INFO.map((x) => (
                <option key={x.kind} value={x.kind} title={x.hint}>
                  {x.label}
                </option>
              ))}
            </select>
          </section>
          <section>
            <div className="batch-head">
              <b>파일 {files.length}개</b>
              <button className="suite-button ghost small" disabled={!!busy} onClick={() => void pick()}>
                ＋ 파일 고르기
              </button>
              {files.length > 0 && (
                <button className="suite-button ghost small" disabled={!!busy} onClick={() => (setFiles([]), setRows([]))}>
                  모두 빼기
                </button>
              )}
            </div>
            <div className="batch-table-wrap">
              <table className="batch-table">
                <thead>
                  <tr>
                    <th>이름</th>
                    <th title="처리 전 라우드니스">전 LUFS</th>
                    <th title="처리 전 최대 크기">전 피크</th>
                    <th title="처리 후 라우드니스">후 LUFS</th>
                    <th title="처리 후 최대 크기">후 피크</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((f, i) => {
                    const r = rows[i];
                    return (
                      <tr key={f} title={f} className={busy?.i === i ? "now" : r?.error ? "bad" : ""}>
                        <td>{r?.error ? `⚠ ${f.split(/[\\/]/).pop()} — ${r.error}` : f.split(/[\\/]/).pop()}</td>
                        <td>{db(r?.before?.lufs)}</td>
                        <td>{db(r?.before?.peak)}</td>
                        <td>{db(r?.after?.lufs)}</td>
                        <td>{db(r?.after?.peak)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="dialog-row">
              <span>저장할 폴더</span>
              <span className="batch-folder">
                <button
                  className="suite-button ghost small"
                  disabled={!!busy}
                  onClick={async () => {
                    const f = await window.suite?.files.pickFolder();
                    if (f) setFolder(f);
                  }}
                >
                  폴더 고르기
                </button>
                <span title={folder ?? ""}>{folder ?? "아직 안 골랐어요"}</span>
              </span>
            </div>
            <div className="dialog-row">
              <span>형식</span>
              <span className="batch-folder">
                <select value={bits} disabled={!!busy} onChange={(e) => setBits(Number(e.target.value) as 16 | 24 | 32)}>
                  <option value={16}>WAV 16비트</option>
                  <option value={24}>WAV 24비트</option>
                  <option value={32}>WAV 32비트 실수</option>
                </select>
                <select value={rate} disabled={!!busy} onChange={(e) => setRate(Number(e.target.value))}>
                  <option value={0}>샘플 레이트 그대로</option>
                  <option value={22050}>22,050 Hz</option>
                  <option value={44100}>44,100 Hz</option>
                  <option value={48000}>48,000 Hz</option>
                </select>
              </span>
            </div>
            <label className="dialog-row">
              <span>이름 뒤에</span>
              <input value={suffix} disabled={!!busy} onChange={(e) => setSuffix(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
            </label>
          </section>
        </div>
        {busy && (
          <div className="batch-progress">
            <div style={{ width: `${(busy.i / busy.total) * 100}%` }} />
            <span>
              {busy.i + 1}/{busy.total} 처리 중…
            </span>
          </div>
        )}
        <div className="dialog-actions">
          <button className="suite-button ghost" disabled={!!busy || !files.length} title="저장하지 않고 지금 크기(LUFS, 피크)만 재요" onClick={() => void run(false)}>
            크기만 재기
          </button>
          <span className="spacer" />
          {busy ? (
            <button className="suite-button ghost" onClick={() => (cancel.current = true)}>
              멈추기
            </button>
          ) : (
            <button className="suite-button ghost" onClick={onClose}>
              닫기
            </button>
          )}
          <button className="suite-button" disabled={!!busy || !files.length || !folder || !steps.length} onClick={() => void run(true)}>
            {files.length ? `${files.length}개 처리하기` : "처리하기"}
          </button>
        </div>
      </div>
    </div>
  );
}
