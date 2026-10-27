import { useEffect, useRef } from "react";
import { lengthOf, type Range, type Sound } from "./audio";
import { fft, hann, type Band } from "./dsp";

export interface Marker {
  id: string;
  at: number;
  label: string;
}

export interface View {
  start: number;
  end: number;
}

interface Props {
  sound: Sound;
  view: View;
  setView: (v: View) => void;
  selection: Range | null;
  cursor: number;
  playhead: number | null;
  markers: Marker[];
  spectral: boolean;
  /** 스펙트럼에서 주파수 상자로 고르기 (E) */
  boxSelect: boolean;
  band: Band | null;
  onBand: (b: Band | null) => void;
  onSelect: (sel: Range | null, cursor: number) => void;
  onMarkerMove: (id: string, at: number, done: boolean) => void;
}

const OVERVIEW = 34;
const RULER = 22;
const BLOCK = 256;

interface Peaks {
  sound: Sound;
  /** 채널마다 BLOCK 샘플씩 [최소, 최대] */
  blocks: Float32Array[];
}

/** 스펙트로그램 (채널마다 그림 한 장) */
interface Spectro {
  sound: Sound;
  images: HTMLCanvasElement[];
  hop: number;
}

const peaksCache = new WeakMap<Sound, Peaks>();
function peaksOf(sound: Sound): Peaks {
  const hit = peaksCache.get(sound);
  if (hit) return hit;
  const n = lengthOf(sound);
  const count = Math.ceil(n / BLOCK);
  const blocks = sound.channels.map((ch) => {
    const out = new Float32Array(count * 2);
    for (let b = 0; b < count; b++) {
      let lo = 0;
      let hi = 0;
      const end = Math.min(n, (b + 1) * BLOCK);
      for (let i = b * BLOCK; i < end; i++) {
        const v = ch[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      out[b * 2] = lo;
      out[b * 2 + 1] = hi;
    }
    return out;
  });
  const p = { sound, blocks };
  peaksCache.set(sound, p);
  return p;
}

const spectroCache = new WeakMap<Sound, Spectro>();
const SPEC_SIZE = 1024;
const SPEC_ROWS = 256;
/** 색: 어두운 남색 → 보라 → 주황 → 노랑 (오디션 느낌) */
function heat(v: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, v));
  const stops: [number, number, number, number][] = [
    [0, 8, 10, 30],
    [0.35, 70, 20, 120],
    [0.6, 200, 50, 90],
    [0.8, 250, 150, 40],
    [1, 255, 250, 200],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, r0, g0, b0] = stops[i - 1];
      const [t1, r1, g1, b1] = stops[i];
      const k = (t - t0) / (t1 - t0);
      return [r0 + (r1 - r0) * k, g0 + (g1 - g0) * k, b0 + (b1 - b0) * k];
    }
  }
  return [255, 250, 200];
}
function spectroOf(sound: Sound): Spectro {
  const hit = spectroCache.get(sound);
  if (hit) return hit;
  const n = lengthOf(sound);
  const hop = Math.max(128, Math.ceil(n / 3000));
  const cols = Math.max(1, Math.ceil(n / hop));
  const win = hann(SPEC_SIZE);
  const nyq = sound.sampleRate / 2;
  // 세로 줄: 낮은 주파수를 넓게 보이게 로그 눈금 (30Hz ~ 나이퀴스트)
  const rowBin = Array.from({ length: SPEC_ROWS }, (_, r) => {
    const f = 30 * Math.pow(nyq / 30, 1 - r / (SPEC_ROWS - 1));
    return Math.min(SPEC_SIZE / 2, Math.round((f / nyq) * (SPEC_SIZE / 2)));
  });
  const images = sound.channels.map((ch) => {
    const c = document.createElement("canvas");
    c.width = cols;
    c.height = SPEC_ROWS;
    const g = c.getContext("2d")!;
    const img = g.createImageData(cols, SPEC_ROWS);
    const re = new Float32Array(SPEC_SIZE);
    const im = new Float32Array(SPEC_SIZE);
    for (let x = 0; x < cols; x++) {
      const at = x * hop - SPEC_SIZE / 2;
      for (let i = 0; i < SPEC_SIZE; i++) {
        re[i] = (ch[at + i] ?? 0) * win[i];
        im[i] = 0;
      }
      fft(re, im);
      for (let r = 0; r < SPEC_ROWS; r++) {
        const k = rowBin[r];
        const mag = Math.hypot(re[k], im[k]) / (SPEC_SIZE / 4);
        const db = 20 * Math.log10(mag + 1e-9);
        const [cr, cg, cb] = heat((db + 100) / 90);
        const o = (r * cols + x) * 4;
        img.data[o] = cr;
        img.data[o + 1] = cg;
        img.data[o + 2] = cb;
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  });
  const s = { sound, images, hop };
  spectroCache.set(sound, s);
  return s;
}

/** 시간 눈금 간격 (초) */
function tickStep(secPerPx: number) {
  const steps = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  return steps.find((s) => s / secPerPx >= 80) ?? 1200;
}

export const timeLabel = (sec: number, precise = false) => {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(precise ? 3 : 1).padStart(precise ? 6 : 4, "0")}`;
};

/** 오디션의 파형 편집 화면: 위에 전체 개요, 시간 눈금, 채널마다 파형(또는 스펙트럼) */
export function Wave(props: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const redraw = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    let frame = 0;
    type Drag =
      | { kind: "select"; anchor: number; moved: boolean; box?: { lane: number; f: number } }
      | { kind: "edge"; fixed: number }
      | { kind: "overview"; offset: number }
      | { kind: "pan"; x: number; view: View }
      | { kind: "marker"; id: string };
    let drag: Drag | null = null;
    let hover: number | null = null;

    const layout = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const top = OVERVIEW + RULER;
      const chs = Math.max(1, latest.current.sound.channels.length);
      const laneH = (h - top) / chs;
      return { w, h, top, laneH, chs };
    };
    const xOf = (sample: number) => {
      const { view } = latest.current;
      const { w } = layout();
      return ((sample - view.start) / Math.max(1, view.end - view.start)) * w;
    };
    // 스펙트럼 세로 위치 ↔ 주파수 (spectroOf 와 같은 로그 눈금)
    const freqAt = (clientY: number, lane: number) => {
      const { sound } = latest.current;
      const { top, laneH } = layout();
      const rect = canvas.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (clientY - rect.top - top - lane * laneH) / laneH));
      const nyq = sound.sampleRate / 2;
      return 30 * Math.pow(nyq / 30, 1 - t);
    };
    const yOfFreq = (f: number, lane: number) => {
      const { sound } = latest.current;
      const { top, laneH } = layout();
      const nyq = sound.sampleRate / 2;
      const t = 1 - Math.log(Math.max(30, Math.min(nyq, f)) / 30) / Math.log(nyq / 30);
      return top + lane * laneH + t * laneH;
    };
    const sampleAt = (clientX: number) => {
      const { view, sound } = latest.current;
      const rect = canvas.getBoundingClientRect();
      const t = (clientX - rect.left) / rect.width;
      return Math.round(Math.max(0, Math.min(lengthOf(sound), view.start + t * (view.end - view.start))));
    };

    const draw = () => {
      frame = 0;
      const { sound, view, selection, cursor, playhead, markers, spectral, band } = latest.current;
      const dpr = window.devicePixelRatio || 1;
      const { w, h, top, laneH } = layout();
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#0d0f16";
      ctx.fillRect(0, 0, w, h);
      const n = lengthOf(sound);
      const rate = sound.sampleRate;
      const span = Math.max(1, view.end - view.start);
      const spp = span / w;

      // ── 개요 (전체)
      ctx.fillStyle = "#151925";
      ctx.fillRect(0, 0, w, OVERVIEW);
      if (n) {
        const p = peaksOf(sound);
        const blocks = p.blocks[0].length / 2;
        ctx.fillStyle = "#3d6b5c";
        for (let x = 0; x < w; x++) {
          const a = Math.floor((x / w) * blocks);
          const b = Math.max(a + 1, Math.floor(((x + 1) / w) * blocks));
          let lo = 0;
          let hi = 0;
          for (const bl of p.blocks)
            for (let i = a; i < b; i++) {
              if (bl[i * 2] < lo) lo = bl[i * 2];
              if (bl[i * 2 + 1] > hi) hi = bl[i * 2 + 1];
            }
          const mid = OVERVIEW / 2;
          ctx.fillRect(x, mid - hi * mid * 0.9, 1, Math.max(1, (hi - lo) * mid * 0.9));
        }
        const vx = (view.start / n) * w;
        const vw = Math.max(4, (span / n) * w);
        ctx.fillStyle = "rgba(111,180,255,0.18)";
        ctx.fillRect(vx, 1, vw, OVERVIEW - 2);
        ctx.strokeStyle = "#6fb4ff";
        ctx.strokeRect(vx + 0.5, 1.5, vw - 1, OVERVIEW - 3);
        if (playhead !== null) {
          ctx.fillStyle = "#ff5a5a";
          ctx.fillRect((playhead / n) * w, 0, 1, OVERVIEW);
        }
      }

      // ── 시간 눈금
      ctx.fillStyle = "#1a1e2b";
      ctx.fillRect(0, OVERVIEW, w, RULER);
      const step = tickStep(spp / rate);
      ctx.font = "10px ui-monospace, Consolas, monospace";
      ctx.textBaseline = "top";
      const t0 = Math.floor(view.start / rate / step) * step;
      for (let t = t0; t * rate <= view.end; t += step) {
        const x = xOf(t * rate);
        if (x < -50) continue;
        ctx.fillStyle = "#3a4158";
        ctx.fillRect(Math.round(x), OVERVIEW + 12, 1, RULER - 12);
        ctx.fillStyle = "#8a92ab";
        ctx.fillText(timeLabel(t, step < 0.1), x + 3, OVERVIEW + 3);
        // 작은 눈금
        for (let k = 1; k < 5; k++) {
          const xs = xOf((t + (k * step) / 5) * rate);
          ctx.fillStyle = "#2a3044";
          ctx.fillRect(Math.round(xs), OVERVIEW + 17, 1, RULER - 17);
        }
      }

      // ── 채널
      const sx0 = selection ? xOf(selection.start) : 0;
      const sx1 = selection ? xOf(selection.end) : 0;
      sound.channels.forEach((ch, c) => {
        const y0 = top + c * laneH;
        const mid = y0 + laneH / 2;
        const amp = laneH / 2 - 4;
        ctx.fillStyle = c % 2 ? "#0f121b" : "#10141e";
        ctx.fillRect(0, y0, w, laneH);
        if (spectral && n) {
          const sp = spectroOf(sound);
          const img = sp.images[c];
          const ax = view.start / sp.hop;
          const aw = span / sp.hop;
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(img, ax, 0, Math.max(1, aw), img.height, 0, y0, w, laneH);
        } else {
          // 눈금선 (-6dB, -12dB 쯤)
          ctx.fillStyle = "#1c2131";
          for (const g of [0.5, 0.25]) {
            ctx.fillRect(0, Math.round(mid - g * amp), w, 1);
            ctx.fillRect(0, Math.round(mid + g * amp), w, 1);
          }
          ctx.fillStyle = "#273047";
          ctx.fillRect(0, Math.round(mid), w, 1);
        }
        if (!n) return;
        const color = spectral ? "rgba(255,255,255,0.35)" : "#4fd39e";
        const selColor = spectral ? "rgba(255,255,255,0.6)" : "#c6ffe6";
        if (spp >= 1) {
          const p = peaksOf(sound).blocks[c];
          for (let x = 0; x < w; x++) {
            const a = view.start + x * spp;
            const b = a + spp;
            let lo = 0;
            let hi = 0;
            if (spp >= BLOCK) {
              const ba = Math.floor(a / BLOCK);
              const bb = Math.max(ba + 1, Math.floor(b / BLOCK));
              for (let i = ba; i < bb && i * 2 < p.length; i++) {
                if (p[i * 2] < lo) lo = p[i * 2];
                if (p[i * 2 + 1] > hi) hi = p[i * 2 + 1];
              }
            } else {
              const ia = Math.floor(a);
              const ib = Math.min(n, Math.max(ia + 1, Math.floor(b)));
              for (let i = ia; i < ib; i++) {
                const v = ch[i];
                if (v < lo) lo = v;
                if (v > hi) hi = v;
              }
            }
            if (spectral && hi - lo < 0.002) continue;
            ctx.fillStyle = selection && x >= sx0 && x <= sx1 ? selColor : color;
            const yTop = mid - hi * amp;
            ctx.fillRect(x, yTop, 1, Math.max(1, (hi - lo) * amp));
          }
        } else {
          // 아주 크게 확대: 샘플 하나하나를 점과 선으로
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          const a = Math.max(0, Math.floor(view.start));
          const b = Math.min(n, Math.ceil(view.end) + 1);
          for (let i = a; i < b; i++) {
            const x = xOf(i);
            const y = mid - ch[i] * amp;
            if (i === a) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
          if (1 / spp > 6) {
            ctx.fillStyle = selColor;
            for (let i = a; i < b; i++) ctx.fillRect(xOf(i) - 2, mid - ch[i] * amp - 2, 4, 4);
          }
        }
        if (spectral) {
          // 주파수 눈금
          ctx.font = "9px ui-monospace, Consolas, monospace";
          for (const f of [100, 500, 1000, 2000, 5000, 10000]) {
            if (f >= sound.sampleRate / 2) continue;
            const y = yOfFreq(f, c);
            if (y < y0 + 14 || y > y0 + laneH - 6) continue;
            ctx.fillStyle = "rgba(255,255,255,0.18)";
            ctx.fillRect(w - 6, Math.round(y), 6, 1);
            ctx.fillStyle = "rgba(255,255,255,0.45)";
            ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, w - 30, y - 5);
          }
        }
        // 채널 이름
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.font = "bold 10px sans-serif";
        ctx.fillText(sound.channels.length === 1 ? "M" : c === 0 ? "L" : "R", 6, y0 + 6);
        ctx.strokeStyle = "#232838";
        ctx.beginPath();
        ctx.moveTo(0, y0 + laneH - 0.5);
        ctx.lineTo(w, y0 + laneH - 0.5);
        ctx.stroke();
      });

      // ── 선택 영역 (주파수 상자면 채널마다 상자로)
      if (selection && band && spectral) {
        ctx.fillStyle = "rgba(255,255,255,0.25)";
        ctx.fillRect(sx0, OVERVIEW, sx1 - sx0, RULER);
        sound.channels.forEach((_, c) => {
          const yTop = yOfFreq(band.high, c);
          const yBot = yOfFreq(band.low, c);
          ctx.fillStyle = "rgba(255,255,255,0.14)";
          ctx.fillRect(sx0, yTop, sx1 - sx0, yBot - yTop);
          ctx.strokeStyle = "#e9ecf5";
          ctx.setLineDash([5, 3]);
          ctx.strokeRect(Math.round(sx0) + 0.5, Math.round(yTop) + 0.5, Math.round(sx1 - sx0), Math.round(yBot - yTop));
          ctx.setLineDash([]);
        });
        ctx.fillStyle = "#e9ecf5";
        ctx.font = "10px ui-monospace, Consolas, monospace";
        const hz = (f: number) => (f >= 1000 ? `${(f / 1000).toFixed(1)}k` : `${Math.round(f)}`);
        ctx.fillText(`${hz(band.low)}–${hz(band.high)} Hz`, sx0 + 4, yOfFreq(band.high, 0) + 4);
      } else if (selection) {
        ctx.fillStyle = "rgba(255,255,255,0.13)";
        ctx.fillRect(sx0, top, sx1 - sx0, h - top);
        ctx.fillStyle = "rgba(255,255,255,0.25)";
        ctx.fillRect(sx0, OVERVIEW, sx1 - sx0, RULER);
        ctx.fillStyle = "#e9ecf5";
        ctx.fillRect(Math.round(sx0), top, 1, h - top);
        ctx.fillRect(Math.round(sx1), top, 1, h - top);
      }

      // ── 마커
      for (const m of markers) {
        const x = Math.round(xOf(m.at));
        if (x < -40 || x > w + 40) continue;
        ctx.fillStyle = "#ffb13b";
        ctx.fillRect(x, OVERVIEW, 1, h - OVERVIEW);
        ctx.beginPath();
        ctx.moveTo(x, OVERVIEW);
        ctx.lineTo(x + 9, OVERVIEW);
        ctx.lineTo(x + 9, OVERVIEW + 9);
        ctx.lineTo(x, OVERVIEW + 13);
        ctx.fill();
        ctx.fillStyle = "#ffcf85";
        ctx.font = "10px sans-serif";
        ctx.fillText(m.label, x + 12, OVERVIEW + 2);
      }

      // ── 커서, 재생 위치
      ctx.fillStyle = "#ffd23f";
      ctx.fillRect(Math.round(xOf(cursor)), OVERVIEW, 1, h - OVERVIEW);
      if (playhead !== null) {
        const x = Math.round(xOf(playhead));
        ctx.fillStyle = "#ff5a5a";
        ctx.fillRect(x, OVERVIEW, 1.5, h - OVERVIEW);
        ctx.beginPath();
        ctx.moveTo(x - 5, OVERVIEW);
        ctx.lineTo(x + 6, OVERVIEW);
        ctx.lineTo(x + 0.5, OVERVIEW + 8);
        ctx.fill();
      }
      if (hover !== null && !drag) {
        ctx.fillStyle = "rgba(255,255,255,0.18)";
        ctx.fillRect(Math.round(hover), top, 1, h - top);
      }
      if (!n) {
        ctx.fillStyle = "#59617a";
        ctx.font = "14px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("소리가 없어요. 녹음(R)하거나 파일을 열거나 끌어다 놓으세요.", w / 2, top + (h - top) / 2);
        ctx.textAlign = "start";
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    redraw.current = schedule;

    const onDown = (e: PointerEvent) => {
      const p = latest.current;
      const rect = canvas.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const x = e.clientX - rect.left;
      canvas.setPointerCapture(e.pointerId);
      const n = lengthOf(p.sound);
      if (e.button === 1 || e.button === 2) {
        drag = { kind: "pan", x: e.clientX, view: p.view };
        return;
      }
      if (y < OVERVIEW) {
        if (!n) return;
        const { w } = layout();
        const at = (x / w) * n;
        const span = p.view.end - p.view.start;
        const inside = at >= p.view.start && at <= p.view.end;
        const offset = inside ? at - p.view.start : span / 2;
        if (!inside) p.setView(clampView({ start: at - offset, end: at - offset + span }, n));
        drag = { kind: "overview", offset };
        return;
      }
      if (y < OVERVIEW + RULER) {
        const hit = p.markers.find((m) => Math.abs(xOf(m.at) - x) < 8);
        if (hit) {
          drag = { kind: "marker", id: hit.id };
          return;
        }
      }
      const s = sampleAt(e.clientX);
      if (p.selection) {
        const near = (v: number) => Math.abs(xOf(v) - x) < 6;
        if (near(p.selection.start)) {
          drag = { kind: "edge", fixed: p.selection.end };
          return;
        }
        if (near(p.selection.end)) {
          drag = { kind: "edge", fixed: p.selection.start };
          return;
        }
        if (e.shiftKey) {
          const fixed = Math.abs(s - p.selection.start) < Math.abs(s - p.selection.end) ? p.selection.end : p.selection.start;
          p.onSelect({ start: Math.min(fixed, s), end: Math.max(fixed, s) }, Math.min(fixed, s));
          drag = { kind: "edge", fixed };
          return;
        }
      }
      if (p.spectral && p.boxSelect && n) {
        const { top, laneH, chs } = layout();
        const lane = Math.max(0, Math.min(chs - 1, Math.floor((y - top) / laneH)));
        drag = { kind: "select", anchor: s, moved: false, box: { lane, f: freqAt(e.clientY, lane) } };
        return;
      }
      drag = { kind: "select", anchor: s, moved: false };
    };

    const onMove = (e: PointerEvent) => {
      const p = latest.current;
      const rect = canvas.getBoundingClientRect();
      hover = e.clientY - rect.top > OVERVIEW + RULER ? e.clientX - rect.left : null;
      const n = lengthOf(p.sound);
      if (!drag) {
        const near = p.selection && [p.selection.start, p.selection.end].some((v) => Math.abs(xOf(v) - (e.clientX - rect.left)) < 6);
        canvas.style.cursor = e.clientY - rect.top < OVERVIEW ? "grab" : near ? "ew-resize" : p.spectral && p.boxSelect ? "crosshair" : "text";
        return schedule();
      }
      const s = sampleAt(e.clientX);
      switch (drag.kind) {
        case "select": {
          const a = Math.min(drag.anchor, s);
          const b = Math.max(drag.anchor, s);
          if (!drag.moved && Math.abs(xOf(s) - xOf(drag.anchor)) < 3) return;
          drag.moved = true;
          p.onSelect(b > a ? { start: a, end: b } : null, a);
          if (drag.box) {
            const f = freqAt(e.clientY, drag.box.lane);
            p.onBand({ low: Math.min(f, drag.box.f), high: Math.max(f, drag.box.f) });
          }
          autoScroll(e.clientX);
          break;
        }
        case "edge":
          p.onSelect({ start: Math.min(drag.fixed, s), end: Math.max(drag.fixed, s) }, Math.min(drag.fixed, s));
          autoScroll(e.clientX);
          break;
        case "overview": {
          const { w } = layout();
          const at = ((e.clientX - rect.left) / w) * n;
          const span = p.view.end - p.view.start;
          p.setView(clampView({ start: at - drag.offset, end: at - drag.offset + span }, n));
          break;
        }
        case "pan": {
          const { w } = layout();
          const span = drag.view.end - drag.view.start;
          const d = ((drag.x - e.clientX) / w) * span;
          p.setView(clampView({ start: drag.view.start + d, end: drag.view.end + d }, n));
          break;
        }
        case "marker":
          p.onMarkerMove(drag.id, s, false);
          break;
      }
    };

    const autoScroll = (clientX: number) => {
      const p = latest.current;
      const rect = canvas.getBoundingClientRect();
      const n = lengthOf(p.sound);
      const span = p.view.end - p.view.start;
      if (clientX > rect.right - 10) p.setView(clampView({ start: p.view.start + span * 0.02, end: p.view.end + span * 0.02 }, n));
      if (clientX < rect.left + 10) p.setView(clampView({ start: p.view.start - span * 0.02, end: p.view.end - span * 0.02 }, n));
    };

    const onUp = (e: PointerEvent) => {
      const p = latest.current;
      const d = drag;
      drag = null;
      if (d?.kind === "select" && !d.moved) p.onSelect(null, sampleAt(e.clientX));
      if (d?.kind === "marker") p.onMarkerMove(d.id, sampleAt(e.clientX), true);
      schedule();
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = latest.current;
      const n = lengthOf(p.sound);
      if (!n) return;
      const span = p.view.end - p.view.start;
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const d = ((e.shiftKey ? e.deltaY : e.deltaX) / canvas.clientWidth) * span;
        p.setView(clampView({ start: p.view.start + d, end: p.view.end + d }, n));
        return;
      }
      const at = sampleAt(e.clientX);
      const k = e.deltaY < 0 ? 0.8 : 1.25;
      const nextSpan = Math.max(32, Math.min(n, span * k));
      const t = (at - p.view.start) / span;
      p.setView(clampView({ start: at - t * nextSpan, end: at - t * nextSpan + nextSpan }, n));
    };

    const onDbl = (e: MouseEvent) => {
      const p = latest.current;
      const rect = canvas.getBoundingClientRect();
      if (e.clientY - rect.top < OVERVIEW + RULER) return;
      // 보이는 부분 전체 고르기 (오디션처럼)
      p.onSelect({ start: Math.round(p.view.start), end: Math.round(p.view.end) }, Math.round(p.view.start));
    };
    const onLeave = () => {
      hover = null;
      schedule();
    };

    const resize = new ResizeObserver(schedule);
    resize.observe(canvas);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("dblclick", onDbl);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("dblclick", onDbl);
    };
  }, []);

  useEffect(() => redraw.current());

  return <canvas ref={ref} className="wave" />;
}

export function clampView(v: View, n: number): View {
  const span = Math.min(Math.max(32, v.end - v.start), Math.max(32, n));
  let start = v.start;
  if (start + span > n) start = n - span;
  if (start < 0) start = 0;
  return { start, end: start + span };
}
