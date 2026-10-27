import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BLEND_MODES,
  DEFAULT_KEY,
  evalParam,
  LOOKS,
  TEXT_ANIMATIONS,
  TRANSITIONS,
  type BlendMode,
  type ChromaKey,
  type Crop,
  type TransitionKind,
  NEUTRAL_COLOR,
  setParam,
  toggleKeys,
  type Clip,
  type ColorSettings,
  type ParamName,
  type TextStyle,
} from "./model";
import { BUILTIN_LUTS, type LutAsset } from "./lut";

interface Props {
  clip: Clip;
  /** 재생 위치 (타임라인 초) */
  time: number;
  /** 끄는 중 (기록 없음) */
  preview: (c: Clip) => void;
  /** 끝났을 때 기록 */
  commit: () => void;
  /** 바로 기록 */
  set: (c: Clip) => void;
  onSeek: (t: number) => void;
  /** 프로젝트에 넣은 LUT */
  luts: LutAsset[];
  /** .cube 를 가져와서 이 클립에 입힌다 */
  onImportLut: () => void;
}

/**
 * 프리미어의 ‘효과 컨트롤’: 고른 클립의 위치, 크기, 회전, 불투명도, 소리, 속도, 색 보정, 페이드.
 * 숫자는 좌우로 끌어서 바꾸고(클릭하면 직접 입력), ⏱ 를 켜면 재생 위치마다 키프레임이 생겨 움직임을 만든다.
 */
export function EffectControls({ clip, time, preview, commit, set, onSeek, luts, onImportLut }: Props) {
  const local = Math.max(0, time - clip.start);
  const inside = time >= clip.start && time <= clip.start + (clip.out - clip.in) / clip.speed;
  const visual = clip.kind !== "audio";
  const audible = clip.kind === "audio" || clip.kind === "video";

  const param = (name: ParamName, label: string, unit: string, opts: { min?: number; max?: number; step?: number; speed?: number } = {}) => {
    const p = clip.params[name];
    const value = evalParam(p, local);
    const keys = p.keys ?? [];
    const prev = [...keys].reverse().find((k) => k.t < local - 1e-3);
    const next = keys.find((k) => k.t > local + 1e-3);
    const onKey = keys.some((k) => Math.abs(k.t - local) < 1 / 120);
    const change = (v: number, live: boolean) => {
      const c = { ...clip, params: { ...clip.params, [name]: setParam(p, local, v) } };
      (live ? preview : set)(c);
    };
    return (
      <div className="fx-row" key={name}>
        <button
          className={`fx-watch${p.keys ? " on" : ""}`}
          title={p.keys ? "키프레임 끄기 (모두 지우고 지금 값만 남겨요)" : "키프레임 켜기: 재생 위치를 옮기며 값을 바꾸면 그 사이가 움직여요"}
          onClick={() => set({ ...clip, params: { ...clip.params, [name]: toggleKeys(p, local) } })}
        >
          ⏱
        </button>
        <span className="fx-label">{label}</span>
        <Scrub value={value} unit={unit} {...opts} onPreview={(v) => change(v, true)} onCommit={commit} onSet={(v) => change(v, false)} />
        {p.keys && (
          <span className="fx-keys">
            <button disabled={!prev} title="앞 키프레임으로" onClick={() => prev && onSeek(clip.start + prev.t)}>
              ◀
            </button>
            <button
              className={onKey ? "on" : ""}
              disabled={!inside}
              title={onKey ? "이 키프레임 지우기" : "여기에 키프레임 넣기"}
              onClick={() => {
                const rest = keys.filter((k) => Math.abs(k.t - local) >= 1 / 120);
                set({
                  ...clip,
                  params: { ...clip.params, [name]: onKey ? { value, keys: rest.length ? rest : undefined } : setParam(p, local, value) },
                });
              }}
            >
              ◆
            </button>
            <button disabled={!next} title="다음 키프레임으로" onClick={() => next && onSeek(clip.start + next.t)}>
              ▶
            </button>
          </span>
        )}
      </div>
    );
  };

  const color = (key: Exclude<keyof ColorSettings, "lut" | "lutAmount">, label: string, min = -100, max = 100) => (
    <div className="fx-row" key={key}>
      <span className="fx-watch-space" />
      <span className="fx-label">{label}</span>
      <Scrub
        value={clip.color[key]}
        min={min}
        max={max}
        step={1}
        onPreview={(v) => preview({ ...clip, color: { ...clip.color, [key]: v } })}
        onCommit={commit}
        onSet={(v) => set({ ...clip, color: { ...clip.color, [key]: v } })}
      />
    </div>
  );

  const textField = <K extends keyof TextStyle>(key: K, v: TextStyle[K]) => set({ ...clip, text: { ...clip.text!, [key]: v } });

  const key = clip.key ?? { ...DEFAULT_KEY, on: false };
  const setKey = (patch: Partial<ChromaKey>) => set({ ...clip, key: { ...key, ...patch } });
  const keyRow = (name: "similarity" | "smoothness" | "spill", label: string) => (
    <div className="fx-row" key={name}>
      <span className="fx-watch-space" />
      <span className="fx-label">{label}</span>
      <Scrub value={key[name]} min={0} max={100} step={1} onPreview={(v) => preview({ ...clip, key: { ...key, [name]: v } })} onCommit={commit} onSet={(v) => setKey({ [name]: v })} />
    </div>
  );
  /** 크롬의 스포이트로 화면 아무 곳의 색을 집는다 */
  const pickKeyColor = async () => {
    const Dropper = (window as unknown as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper;
    if (!Dropper) return;
    try {
      const r = await new Dropper().open();
      setKey({ color: r.sRGBHex, on: true });
    } catch {
      // 취소
    }
  };

  const crop = clip.crop ?? { left: 0, right: 0, top: 0, bottom: 0 };
  const cropRow = (side: keyof Crop, label: string) => (
    <div className="fx-row" key={side}>
      <span className="fx-watch-space" />
      <span className="fx-label">{label}</span>
      <Scrub
        value={crop[side]}
        unit="%"
        min={0}
        max={100}
        step={0.5}
        onPreview={(v) => preview({ ...clip, crop: { ...crop, [side]: v } })}
        onCommit={commit}
        onSet={(v) => set({ ...clip, crop: { ...crop, [side]: v } })}
      />
    </div>
  );

  return (
    <div className="fx">
      <div className="fx-clip-name">
        {clip.kind === "text" ? "T 글자" : clip.kind === "adjust" ? "◐ 조정 레이어" : clip.name}
        {!inside && <span className="fx-hint"> · 재생 위치가 클립 밖이에요</span>}
      </div>

      {clip.kind === "text" && clip.text && (
        <Section title="글자">
          <textarea
            className="fx-text"
            rows={2}
            value={clip.text.text}
            onChange={(e) => preview({ ...clip, text: { ...clip.text!, text: e.target.value } })}
            onBlur={commit}
          />
          <div className="fx-row">
            <span className="fx-watch-space" />
            <span className="fx-label">크기</span>
            <Scrub value={clip.text.size} min={10} max={600} step={1} onPreview={(v) => preview({ ...clip, text: { ...clip.text!, size: v } })} onCommit={commit} onSet={(v) => textField("size", v)} />
          </div>
          <div className="fx-inline">
            <label title="글자 색">
              <input type="color" value={clip.text.color} onChange={(e) => preview({ ...clip, text: { ...clip.text!, color: e.target.value } })} onBlur={commit} />
              글자
            </label>
            <label title="테두리 색">
              <input type="color" value={clip.text.strokeColor} onChange={(e) => preview({ ...clip, text: { ...clip.text!, strokeColor: e.target.value } })} onBlur={commit} />
              테두리
            </label>
            <label title="띠 색">
              <input type="color" value={clip.text.boxColor} onChange={(e) => preview({ ...clip, text: { ...clip.text!, boxColor: e.target.value } })} onBlur={commit} />
              띠
            </label>
          </div>
          <div className="fx-inline">
            <button className={clip.text.bold ? "on" : ""} onClick={() => textField("bold", !clip.text!.bold)}>
              굵게
            </button>
            <button className={clip.text.stroke ? "on" : ""} onClick={() => textField("stroke", clip.text!.stroke ? 0 : 10)}>
              테두리
            </button>
            <button className={clip.text.box ? "on" : ""} onClick={() => textField("box", !clip.text!.box)}>
              띠 배경
            </button>
            {(["left", "center", "right"] as const).map((a) => (
              <button key={a} className={clip.text!.align === a ? "on" : ""} onClick={() => textField("align", a)}>
                {a === "left" ? "⇤" : a === "center" ? "≡" : "⇥"}
              </button>
            ))}
          </div>
          <div className="fx-inline">
            {TEXT_PRESETS.map((p) => (
              <button key={p.label} onClick={() => set({ ...clip, text: { ...clip.text!, ...p.style } })}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="fx-sub">등장 애니메이션</div>
          <div className="fx-inline">
            {TEXT_ANIMATIONS.map((a) => (
              <button key={a.kind} className={(clip.textAnim ?? "none") === a.kind ? "on" : ""} onClick={() => set({ ...clip, textAnim: a.kind })}>
                {a.label}
              </button>
            ))}
          </div>
        </Section>
      )}

      {clip.kind === "color" && (
        <Section title="색 매트">
          <div className="fx-inline">
            <label>
              <input type="color" value={clip.fill ?? "#000000"} onChange={(e) => preview({ ...clip, fill: e.target.value })} onBlur={commit} />
              색
            </label>
          </div>
        </Section>
      )}

      {clip.kind === "adjust" && <p className="fx-note">조정 레이어는 아래 트랙에 보이는 모든 것에 색 보정을 입혀요. 길이를 늘리면 여러 클립을 한 번에 보정하고, 크롭으로 화면 일부만 보정할 수 있어요.</p>}

      {visual && clip.kind !== "adjust" && (
        <Section title="모션">
          {param("x", "위치 X", "px", { step: 1, speed: 2 })}
          {param("y", "위치 Y", "px", { step: 1, speed: 2 })}
          {param("scale", "크기", "%", { min: 0, max: 1000, step: 0.5 })}
          {param("rotation", "회전", "°", { step: 0.5 })}
          <div className="fx-inline">
            <button onClick={() => set({ ...clip, params: { ...clip.params, x: { value: 0 }, y: { value: 0 }, scale: { value: 100 }, rotation: { value: 0 } } })}>
              원래대로
            </button>
            <button title="천천히 확대되는 효과 (켄 번스)" onClick={() => set({ ...clip, params: { ...clip.params, scale: { value: 100, keys: [{ t: 0, v: 100 }, { t: (clip.out - clip.in) / clip.speed, v: 118 }] } } })}>
              천천히 확대
            </button>
            <button title="화면을 꽉 채우게" onClick={() => set({ ...clip, params: { ...clip.params, scale: { value: 133 } } })}>
              꽉 채우기
            </button>
          </div>
        </Section>
      )}

      {visual && (
        <Section title="불투명도">
          {param("opacity", "불투명도", "%", { min: 0, max: 100, step: 1 })}
          <div className="fx-row">
            <span className="fx-watch-space" />
            <span className="fx-label">혼합 모드</span>
            <select className="fx-select" value={clip.blend ?? "source-over"} onChange={(e) => set({ ...clip, blend: e.target.value as BlendMode })}>
              {BLEND_MODES.map((b) => (
                <option key={b.mode} value={b.mode}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>
        </Section>
      )}

      {visual && (
        <Section title="전환 (앞 클립에서 넘어오기)">
          <div className="fx-row">
            <span className="fx-watch-space" />
            <span className="fx-label">종류</span>
            <select
              className="fx-select"
              value={clip.transitionIn?.kind ?? ""}
              onChange={(e) => {
                const kind = e.target.value as TransitionKind | "";
                const duration = clip.transitionIn?.duration ?? Math.min(1, (clip.out - clip.in) / clip.speed / 2);
                set({ ...clip, transitionIn: kind ? { kind, duration } : undefined });
              }}
            >
              <option value="">없음 (바로 바뀜)</option>
              {TRANSITIONS.map((t) => (
                <option key={t.kind} value={t.kind} title={t.hint}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          {clip.transitionIn && (
            <div className="fx-row">
              <span className="fx-watch-space" />
              <span className="fx-label">길이</span>
              <Scrub
                value={clip.transitionIn.duration}
                unit="초"
                min={0.1}
                max={5}
                step={0.05}
                onPreview={(v) => preview({ ...clip, transitionIn: { ...clip.transitionIn!, duration: v } })}
                onCommit={commit}
                onSet={(v) => set({ ...clip, transitionIn: { ...clip.transitionIn!, duration: v } })}
              />
            </div>
          )}
          <p className="fx-note">왼쪽 ‘효과’ 탭에서 전환을 끌어 클립에 놓아도 돼요. 바로 앞에 붙은 클립이 없으면 아래 트랙(또는 검은 화면)에서 넘어와요.</p>
        </Section>
      )}

      {visual && clip.kind !== "text" && (
        <Section title="자르기 (크롭)" closed>
          {cropRow("left", "왼쪽")}
          {cropRow("right", "오른쪽")}
          {cropRow("top", "위")}
          {cropRow("bottom", "아래")}
          <div className="fx-inline">
            <button onClick={() => set({ ...clip, crop: undefined })}>원래대로</button>
            <button title="위아래를 잘라 영화 같은 와이드 화면으로" onClick={() => set({ ...clip, crop: { left: 0, right: 0, top: 12, bottom: 12 } })}>
              시네마 띠
            </button>
          </div>
        </Section>
      )}

      {(clip.kind === "video" || clip.kind === "image") && (
        <Section title="울트라 키 (초록 화면 지우기)" closed={!clip.key?.on}>
          <div className="fx-inline">
            <button className={key.on ? "on" : ""} onClick={() => setKey({ on: !key.on })}>
              {key.on ? "켜짐" : "꺼짐"}
            </button>
            <label title="지울 색">
              <input type="color" value={key.color} onChange={(e) => preview({ ...clip, key: { ...key, color: e.target.value, on: true } })} onBlur={commit} />
              지울 색
            </label>
            {"EyeDropper" in window && (
              <button title="화면에서 스포이트로 배경색 고르기" onClick={() => void pickKeyColor()}>
                💧 화면에서
              </button>
            )}
            <button onClick={() => setKey({ color: "#00d040", on: true })}>초록</button>
            <button onClick={() => setKey({ color: "#0047ff", on: true })}>파랑</button>
          </div>
          {keyRow("similarity", "범위")}
          {keyRow("smoothness", "가장자리")}
          {keyRow("spill", "초록 빼기")}
          <p className="fx-note">초록 배경 앞에서 찍은 영상을 위 트랙(V2)에 두고 켜면, 아래 트랙의 배경과 합쳐져요.</p>
        </Section>
      )}

      {audible && <Section title="소리">{param("volume", "볼륨", "%", { min: 0, max: 400, step: 1 })}</Section>}

      {(clip.kind === "video" || clip.kind === "audio") && (
        <Section title="속도">
          <div className="fx-inline">
            {[0.25, 0.5, 1, 1.5, 2, 4].map((s) => (
              <button key={s} className={clip.speed === s ? "on" : ""} onClick={() => set({ ...clip, speed: s })}>
                {s === 1 ? "보통" : `${s}배`}
              </button>
            ))}
          </div>
        </Section>
      )}

      {visual && clip.kind !== "text" && (
        <Section title="색 보정 (루메트리)">
          <div className="fx-inline fx-looks">
            {LOOKS.map((l) => (
              <button key={l.label} onClick={() => set({ ...clip, color: { ...NEUTRAL_COLOR, ...l.color } })}>
                {l.label}
              </button>
            ))}
          </div>
          {color("exposure", "밝기")}
          {color("contrast", "대비")}
          {color("saturation", "채도")}
          {color("temperature", "색온도")}
          {color("tint", "색조")}
          {color("vignette", "비네트", 0, 100)}
          {color("blur", "흐림", 0, 40)}
          <div className="fx-group-label">크리에이티브 룩 (LUT)</div>
          <div className="fx-row">
            <span className="fx-watch-space" />
            <span className="fx-label">룩</span>
            <select
              className="fx-select"
              value={clip.color.lut ?? ""}
              onChange={(e) => set({ ...clip, color: { ...clip.color, lut: e.target.value || undefined } })}
              title={BUILTIN_LUTS.find((l) => l.id === clip.color.lut)?.hint}
            >
              <option value="">없음</option>
              <optgroup label="기본 룩">
                {BUILTIN_LUTS.map((l) => (
                  <option key={l.id} value={l.id} title={l.hint}>
                    {l.label}
                  </option>
                ))}
              </optgroup>
              {luts.length > 0 && (
                <optgroup label="가져온 LUT">
                  {luts.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
          {clip.color.lut && (
            <div className="fx-row">
              <span className="fx-watch-space" />
              <span className="fx-label">강도</span>
              <Scrub
                value={clip.color.lutAmount ?? 100}
                unit="%"
                min={0}
                max={100}
                step={1}
                onPreview={(v) => preview({ ...clip, color: { ...clip.color, lutAmount: v } })}
                onCommit={commit}
                onSet={(v) => set({ ...clip, color: { ...clip.color, lutAmount: v } })}
              />
            </div>
          )}
          <div className="fx-inline">
            <button title="다빈치 리졸브, 프리미어, 포토샵에서 쓰는 3D LUT 파일" onClick={onImportLut}>
              .cube 가져오기
            </button>
          </div>
        </Section>
      )}

      <Section title="전환 (페이드)">
        <div className="fx-row">
          <span className="fx-watch-space" />
          <span className="fx-label">페이드 인</span>
          <Scrub value={clip.fadeIn} unit="초" min={0} max={10} step={0.05} onPreview={(v) => preview({ ...clip, fadeIn: v })} onCommit={commit} onSet={(v) => set({ ...clip, fadeIn: v })} />
        </div>
        <div className="fx-row">
          <span className="fx-watch-space" />
          <span className="fx-label">페이드 아웃</span>
          <Scrub value={clip.fadeOut} unit="초" min={0} max={10} step={0.05} onPreview={(v) => preview({ ...clip, fadeOut: v })} onCommit={commit} onSet={(v) => set({ ...clip, fadeOut: v })} />
        </div>
      </Section>
    </div>
  );
}

const TEXT_PRESETS: { label: string; style: Partial<TextStyle> }[] = [
  { label: "유튜브 자막", style: { size: 64, bold: true, color: "#ffffff", stroke: 8, strokeColor: "#000000", box: false } },
  { label: "노랑 강조", style: { size: 96, bold: true, color: "#ffd23f", stroke: 12, strokeColor: "#000000", box: false } },
  { label: "띠 자막", style: { size: 56, bold: true, color: "#ffffff", stroke: 0, box: true, boxColor: "#000000" } },
  { label: "큰 제목", style: { size: 160, bold: true, color: "#ffffff", stroke: 0, box: false } },
];

function Section({ title, children, closed = false }: { title: string; children: ReactNode; closed?: boolean }) {
  const [open, setOpen] = useState(!closed);
  return (
    <div className="fx-section">
      <button className="fx-section-title" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "▾" : "▸"} {title}
      </button>
      {open && <div className="fx-section-body">{children}</div>}
    </div>
  );
}

/**
 * 프리미어처럼 숫자를 좌우로 끌면 바뀌고 (Shift 는 빠르게, Ctrl 은 세밀하게), 클릭하면 직접 칠 수 있는 칸.
 */
export function Scrub({
  value,
  unit = "",
  min = -Infinity,
  max = Infinity,
  step = 1,
  speed = 1,
  onPreview,
  onCommit,
  onSet,
}: {
  value: number;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  speed?: number;
  onPreview: (v: number) => void;
  onCommit: () => void;
  onSet: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const drag = useRef<{ x: number; v: number; moved: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  const shown = Math.round(value * 100) / 100;

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="fx-scrub-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setEditing(false);
          const n = Number(text);
          if (Number.isFinite(n) && n !== shown) onSet(clamp(n));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setText(String(shown));
            setEditing(false);
          }
          e.stopPropagation();
        }}
      />
    );
  }
  return (
    <span
      className="fx-scrub"
      title="좌우로 끌어서 바꾸기 · 클릭해서 숫자 입력"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, v: value, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        if (!d.moved && Math.abs(dx) < 3) return;
        d.moved = true;
        const mult = e.shiftKey ? 10 : e.ctrlKey ? 0.1 : 1;
        onPreview(clamp(d.v + dx * step * speed * mult));
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (d?.moved) onCommit();
        else {
          setText(String(shown));
          setEditing(true);
        }
      }}
    >
      {shown}
      {unit && <small>{unit}</small>}
    </span>
  );
}
