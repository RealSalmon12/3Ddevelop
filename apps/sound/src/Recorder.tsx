import { useEffect, useRef, useState } from "react";
import * as A from "./audio";
import { timeLabel } from "./Wave";
import workletUrl from "./capture.worklet.js?url&no-inline";

/**
 * 녹음 창 (어도비 오디션의 녹음처럼): 입력 장치 고르기, 녹음 전 입력 크기 확인(미터), 손실 없는 녹음,
 * 녹음하는 동안 파형과 시간, 넣는 방법 (새 파일 / 끼워 넣기 / 덮어쓰기 / 고른 구간 다시 녹음 = 펀치 인).
 *
 * 브라우저의 MediaRecorder 는 Opus 로 압축해서 소리가 조금 뭉개진다. 여기서는 AudioWorklet 으로
 * 마이크 소리를 그대로(32비트 실수) 받아 모은다.
 */
export type RecordMode = "new" | "insert" | "overwrite" | "punch";

export interface RecordResult {
  clip: A.Sound;
  mode: RecordMode;
  /** 넣을 자리 (샘플, 지금 소리 기준) */
  at: number;
  /** 펀치 인일 때 바꿀 구간 */
  range?: A.Range;
}


const loaded = new WeakSet<BaseAudioContext>();
async function ensureWorklet(ctx: AudioContext) {
  if (loaded.has(ctx)) return;
  await ctx.audioWorklet.addModule(workletUrl);
  loaded.add(ctx);
}

const toDb = (v: number) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
/** 미터 눈금: -60dB ~ 0dB */
const meterPos = (v: number) => Math.max(0, Math.min(1, (toDb(v) + 60) / 60));

/** 이음매에서 딸깍 소리가 나지 않게 5ms 동안 섞는다 */
function crossfadeInto(dst: Float32Array, src: Float32Array, at: number, fade: number) {
  for (let i = 0; i < src.length; i++) {
    const j = at + i;
    if (j >= dst.length) break;
    let w = 1;
    if (i < fade) w = i / fade;
    else if (i >= src.length - fade && j + 1 < dst.length) w = (src.length - i) / fade;
    dst[j] = dst[j] * (1 - w) + src[i] * w;
  }
}

/** 녹음 결과를 지금 소리에 넣는다 */
export function applyRecording(cur: A.Sound, r: RecordResult, insertAt: (s: A.Sound, at: number, clip: A.Sound) => A.Sound): A.Sound {
  const clip = r.clip.sampleRate === cur.sampleRate ? r.clip : A.resample(r.clip, cur.sampleRate);
  const fade = Math.round(cur.sampleRate * 0.005);
  if (r.mode === "new" || !A.lengthOf(cur)) return clip;
  if (r.mode === "insert") return insertAt(cur, r.at, clip);
  const len = A.lengthOf(clip);
  return {
    ...cur,
    channels: cur.channels.map((ch, c) => {
      const src = clip.channels[Math.min(c, clip.channels.length - 1)];
      if (r.mode === "punch" && r.range) {
        // 고른 구간만 정확히 바꾼다 (녹음이 짧으면 그만큼만)
        const out = ch.slice();
        crossfadeInto(out, src.subarray(0, Math.min(src.length, r.range.end - r.range.start)), r.range.start, fade);
        return out;
      }
      const out = new Float32Array(Math.max(ch.length, r.at + len));
      out.set(ch);
      crossfadeInto(out, src, r.at, fade);
      return out;
    }),
  };
}

interface Props {
  context: AudioContext;
  sound: A.Sound;
  cursor: number;
  selection: A.Range | null;
  onDone: (r: RecordResult) => void;
  onClose: () => void;
}

export function RecordDialog({ context, sound, cursor, selection, onDone, onClose }: Props) {
  const empty = !A.lengthOf(sound);
  const canPunch = !empty && !!selection && selection.end - selection.start > sound.sampleRate * 0.05;
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [device, setDevice] = useState(() => localStorage.getItem("sound.recDevice") ?? "");
  const [stereo, setStereo] = useState(() => localStorage.getItem("sound.recStereo") === "1");
  const [mode, setMode] = useState<RecordMode>(empty ? "new" : canPunch ? "punch" : "insert");
  const [countIn, setCountIn] = useState(false);
  const [preroll, setPreroll] = useState(true);
  const [state, setState] = useState<"idle" | "count" | "rec">("idle");
  const [count, setCount] = useState(0);
  const [levels, setLevels] = useState({ l: 0, r: 0, holdL: 0, holdR: 0 });
  const [clipped, setClipped] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const node = useRef<AudioWorkletNode | null>(null);
  const chunks = useRef<Float32Array[][]>([]);
  const frames = useRef(0);
  const wave = useRef<HTMLCanvasElement>(null);
  const cols = useRef<number[]>([]);
  const hold = useRef({ l: 0, r: 0, tl: 0, tr: 0 });
  const quietSince = useRef(0);
  const [hint, setHint] = useState("");
  const player = useRef<AudioBufferSourceNode | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  // 마이크 메시지는 처음 연 때의 함수로 들어오므로 지금 값은 여기서 읽는다
  const latest = useRef({ stereo, selection, cursor, onDone });
  latest.current = { stereo, selection, cursor, onDone };

  // 입력 장치 열기 (장치를 바꾸면 다시)
  useEffect(() => {
    let stream: MediaStream | null = null;
    let src: MediaStreamAudioSourceNode | null = null;
    let sink: GainNode | null = null;
    let cancelled = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: device ? { exact: device } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 },
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
        setDevices(list);
        if (context.state === "suspended") await context.resume();
        await ensureWorklet(context);
        if (cancelled) return;
        src = context.createMediaStreamSource(stream);
        const n = new AudioWorkletNode(context, "suite-capture", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: "explicit" });
        // 소리는 내보내지 않는다 (스피커로 나가면 울림이 생긴다). 그래도 처리되도록 무음으로 이어 둔다.
        sink = context.createGain();
        sink.gain.value = 0;
        src.connect(n);
        n.connect(sink);
        sink.connect(context.destination);
        n.port.onmessage = (e) => onMessage(e.data);
        node.current = n;
        setError("");
      } catch {
        setError("마이크를 쓸 수 없어요. 마이크가 연결되어 있는지, Windows 설정 → 개인 정보 → 마이크에서 앱 접근을 허용했는지 봐 주세요.");
      }
    })();
    return () => {
      cancelled = true;
      if (node.current) node.current.port.onmessage = null;
      node.current?.port.postMessage({ type: "stop" });
      node.current?.disconnect();
      node.current = null;
      src?.disconnect();
      sink?.disconnect();
      stream?.getTracks().forEach((t) => t.stop());
      player.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device]);

  const onMessage = (m: { type: string; peaks?: number[]; clip?: boolean; chs?: Float32Array[]; auto?: boolean }) => {
    if (m.type === "level" && m.peaks) {
      const now = performance.now();
      const h = hold.current;
      const [l, r] = m.peaks;
      if (l >= h.l || now - h.tl > 1500) Object.assign(h, { l, tl: now });
      if (r >= h.r || now - h.tr > 1500) Object.assign(h, { r, tr: now });
      setLevels({ l, r, holdL: h.l, holdR: h.r });
      if (m.clip) setClipped(true);
      // 안내: 너무 작으면 몇 초 뒤에 알려 준다
      const loud = Math.max(l, r);
      if (loud > 0.03) quietSince.current = now;
      else if (!quietSince.current) quietSince.current = now;
      setHint(m.clip ? "빨간불: 소리가 너무 커서 잘렸어요. 마이크에서 조금 떨어지거나 Windows 마이크 볼륨을 낮춰 주세요." : now - quietSince.current > 3000 ? "소리가 거의 안 들어와요. 마이크를 가까이 하거나 다른 입력 장치를 골라 보세요." : loud > 0.5 ? "좋아요! 가장 큰 소리가 노란색쯤이면 딱 알맞아요." : "말하거나 연주해 보세요. 막대가 움직이면 소리가 들어오는 거예요.");
    }
    if (m.type === "data" && m.chs) {
      chunks.current.push(m.chs);
      frames.current += m.chs[0].length;
      setElapsed(frames.current / context.sampleRate);
      // 파형: 덩어리마다 가장 큰 값 몇 개
      const step = Math.round(context.sampleRate / 50);
      const ch = m.chs[0];
      for (let i = 0; i < ch.length; i += step) {
        let peak = 0;
        for (let k = i; k < Math.min(ch.length, i + step); k++) peak = Math.max(peak, Math.abs(ch[k]));
        cols.current.push(peak);
      }
      drawWave();
    }
    if (m.type === "stopped") finish();
  };

  const drawWave = () => {
    const c = wave.current;
    if (!c) return;
    const g = c.getContext("2d")!;
    const w = c.width;
    const h = c.height;
    g.clearRect(0, 0, w, h);
    g.fillStyle = "#ff5c5c";
    const list = cols.current;
    const start = Math.max(0, list.length - w / 2);
    for (let i = start; i < list.length; i++) {
      const x = (i - start) * 2;
      const v = Math.max(1, list[i] * h * 0.95);
      g.fillRect(x, (h - v) / 2, 1.5, v);
    }
  };

  const start = () => {
    const n = node.current;
    if (!n) return;
    chunks.current = [];
    frames.current = 0;
    cols.current = [];
    setElapsed(0);
    setClipped(false);
    const m = modeRef.current;
    const rate = context.sampleRate;
    // 펀치 인: 고른 구간 길이만큼만 녹음하고, 그 앞 2초를 들려준다 (박자를 맞추기 쉽게)
    let at = context.currentTime + 0.05;
    let limit = -1;
    if (m === "punch" && selection) {
      limit = Math.round(((selection.end - selection.start) / sound.sampleRate) * rate);
      if (preroll) {
        const pre = Math.min(2, selection.start / sound.sampleRate);
        if (pre > 0.05) {
          const from = Math.round(selection.start - pre * sound.sampleRate);
          const buf = context.createBuffer(sound.channels.length, selection.start - from, sound.sampleRate);
          sound.channels.forEach((ch, c) => buf.copyToChannel(ch.slice(from, selection.start), c));
          const p = context.createBufferSource();
          p.buffer = buf;
          p.connect(context.destination);
          p.start(at);
          player.current = p;
          at += buf.duration;
        }
      }
    }
    n.port.postMessage({ type: "start", at, frames: limit });
    setState("rec");
  };

  const begin = () => {
    if (state !== "idle" || error) return;
    if (!countIn) return start();
    setState("count");
    let k = 3;
    setCount(k);
    const id = window.setInterval(() => {
      k--;
      if (k <= 0) {
        window.clearInterval(id);
        start();
      } else setCount(k);
    }, 1000);
  };

  const stopRec = () => node.current?.port.postMessage({ type: "stop" });

  const finish = () => {
    player.current?.stop();
    player.current = null;
    setState("idle");
    const total = frames.current;
    // 한 번만 (창을 닫을 때 오는 멈춤 알림은 무시)
    frames.current = 0;
    if (total < context.sampleRate * 0.05) return;
    const { stereo, selection, cursor, onDone } = latest.current;
    const chs = stereo ? [new Float32Array(total), new Float32Array(total)] : [new Float32Array(total)];
    let o = 0;
    for (const [l, r] of chunks.current) {
      if (stereo) {
        chs[0].set(l, o);
        chs[1].set(r, o);
      } else for (let i = 0; i < l.length; i++) chs[0][o + i] = l[i];
      o += l.length;
    }
    chunks.current = [];
    const m = modeRef.current;
    onDone({ clip: { sampleRate: context.sampleRate, channels: chs }, mode: m, at: m === "punch" && selection ? selection.start : cursor, range: m === "punch" && selection ? selection : undefined });
  };

  // R / Space: 녹음 시작·멈춤
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLSelectElement) return;
      const k = e.key.toLowerCase();
      if (k !== "r" && k !== " ") return;
      e.preventDefault();
      if (state === "rec") stopRec();
      else begin();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const bar = (v: number, holdV: number, label: string) => (
    <div className="rec-meter-row">
      <span>{label}</span>
      <div className="rec-meter">
        <div className="rec-meter-fill" style={{ width: `${meterPos(v) * 100}%` }} />
        <div className="rec-meter-hold" style={{ left: `${meterPos(holdV) * 100}%` }} />
      </div>
      <b>{Number.isFinite(toDb(holdV)) ? toDb(holdV).toFixed(0) : "-∞"}</b>
    </div>
  );

  const busy = state !== "idle";
  const MODES: { id: RecordMode; label: string; disabled?: boolean }[] = [
    { id: "new", label: "새 파일로" },
    { id: "insert", label: "커서 자리에 끼워 넣기", disabled: empty },
    { id: "overwrite", label: "커서부터 덮어쓰기", disabled: empty },
    { id: "punch", label: "고른 구간만 다시 녹음 (펀치 인)", disabled: !canPunch },
  ];

  return (
    <div className="dialog-dim" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="dialog record-dialog" role="dialog" aria-label="녹음">
        <h2>녹음</h2>
        <label className="dialog-row">
          <span>입력 장치</span>
          <select value={device} disabled={busy} onChange={(e) => (setDevice(e.target.value), localStorage.setItem("sound.recDevice", e.target.value))}>
            <option value="">기본 마이크</option>
            {devices
              .filter((d) => d.deviceId && d.deviceId !== "default")
              .map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `마이크 ${i + 1}`}
                </option>
              ))}
          </select>
        </label>
        <label className="dialog-row">
          <span>채널</span>
          <select value={stereo ? "2" : "1"} disabled={busy} onChange={(e) => (setStereo(e.target.value === "2"), localStorage.setItem("sound.recStereo", e.target.value === "2" ? "1" : "0"))}>
            <option value="1">모노 (목소리, 마이크 하나)</option>
            <option value="2">스테레오 (오디오 인터페이스, 악기)</option>
          </select>
        </label>
        <label className="dialog-row">
          <span>넣는 방법</span>
          <select value={mode} disabled={busy} onChange={(e) => setMode(e.target.value as RecordMode)}>
            {MODES.map((m) => (
              <option key={m.id} value={m.id} disabled={m.disabled}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <div className="rec-checks">
          <label className="dialog-check">
            <input type="checkbox" checked={countIn} disabled={busy} onChange={(e) => setCountIn(e.target.checked)} /> 3초 세고 시작
          </label>
          {mode === "punch" && (
            <label className="dialog-check" title="고른 구간 바로 앞 2초를 들려주고 이어서 녹음해요">
              <input type="checkbox" checked={preroll} disabled={busy} onChange={(e) => setPreroll(e.target.checked)} /> 앞 2초 들려주기
            </label>
          )}
        </div>

        <div className="rec-meters" title="입력 크기 (dBFS). 오른쪽 끝이 0dB, 넘으면 잘려요">
          {bar(levels.l, levels.holdL, stereo ? "L" : "입력")}
          {stereo && bar(levels.r, levels.holdR, "R")}
          <button className={clipped ? "rec-clip on" : "rec-clip"} title="잘림 표시 (눌러서 끄기)" onClick={() => setClipped(false)}>
            CLIP
          </button>
        </div>
        <p className="dialog-hint">{error || hint || "마이크를 준비하고 있어요…"}</p>

        <div className="rec-stage">
          <canvas ref={wave} width={440} height={64} />
          <div className="rec-time">
            {state === "count" ? <b className="rec-count">{count}</b> : <b>{timeLabel(elapsed, true)}</b>}
            {mode === "punch" && selection && <span>/ {timeLabel((selection.end - selection.start) / sound.sampleRate, true)}</span>}
          </div>
        </div>

        <div className="dialog-actions">
          <span className="dialog-hint rec-quality">손실 없이 {context.sampleRate.toLocaleString()} Hz 로 녹음해요</span>
          <span className="spacer" />
          <button className="suite-button ghost" disabled={busy} onClick={onClose}>
            닫기
          </button>
          {state === "rec" ? (
            <button className="suite-button rec-stop" onClick={stopRec}>
              ■ 멈추기 (R)
            </button>
          ) : (
            <button className="suite-button rec-start" disabled={!!error || state === "count"} onClick={begin}>
              ● 녹음 (R)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
