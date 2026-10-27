import { useEffect, useRef, useState } from "react";

/**
 * 루메트리 범위 (프리미어의 Lumetri Scopes): 눈으로 보기 어려운 밝기와 색을 그래프로 보여 준다.
 * - 파형: 화면의 가로 위치마다 밝기 분포. 위로 붙으면 하얗게 날아간 것, 아래로 붙으면 까맣게 뭉개진 것.
 * - RGB 퍼레이드: 빨강, 초록, 파랑 파형을 나란히. 셋의 높이가 같으면 흰색이 중립(색 틀어짐 없음).
 * - 벡터스코프: 색의 방향(색조)과 진하기(채도). 가운데에서 멀수록 진한 색, 주황 선은 피부색 선.
 * - 히스토그램: 밝기별 픽셀 수.
 */
export type ScopeMode = "waveform" | "parade" | "vector" | "histogram";

const MODES: { id: ScopeMode; label: string; hint: string }[] = [
  { id: "waveform", label: "파형", hint: "가로 위치마다 밝기 (위 100 = 흰색, 아래 0 = 검정)" },
  { id: "parade", label: "RGB 퍼레이드", hint: "빨강·초록·파랑을 나란히. 흰 곳에서 세 높이가 같으면 색이 틀어지지 않은 거예요" },
  { id: "vector", label: "벡터스코프", hint: "가운데에서 멀수록 진한 색. 주황 선은 피부색 선이에요" },
  { id: "histogram", label: "히스토그램", hint: "밝기별 픽셀 수 (왼쪽 어두움, 오른쪽 밝음)" },
];

const W = 320;
const H = 180;
const SW = W; // 분석용으로 줄인 화면 너비 (그래프 너비와 같게 해서 파형이 끊기지 않게)

/** BT.709 밝기 */
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** 쌓인 개수를 밝기로: 적게 찍힌 곳도 보이게 로그로 눌러 준다 */
function plot(out: ImageData, acc: Float32Array, color: [number, number, number], gain: number) {
  const d = out.data;
  for (let i = 0; i < acc.length; i++) {
    if (!acc[i]) continue;
    const v = Math.min(1, Math.log1p(acc[i] * gain) / Math.log1p(gain * 4));
    const o = i * 4;
    d[o] = Math.min(255, d[o] + color[0] * v);
    d[o + 1] = Math.min(255, d[o + 1] + color[1] * v);
    d[o + 2] = Math.min(255, d[o + 2] + color[2] * v);
    d[o + 3] = 255;
  }
}

export function drawScope(mode: ScopeMode, px: Uint8ClampedArray, sw: number, sh: number, ctx: CanvasRenderingContext2D) {
  const img = ctx.createImageData(W, H);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
  const gain = (W * H) / (sw * sh) * 3;
  if (mode === "waveform" || mode === "parade") {
    const chans: { acc: Float32Array; color: [number, number, number]; pick: (o: number) => number }[] =
      mode === "waveform"
        ? [{ acc: new Float32Array(W * H), color: [120, 255, 140], pick: (o) => luma(px[o], px[o + 1], px[o + 2]) }]
        : [
            { acc: new Float32Array(W * H), color: [255, 70, 70], pick: (o) => px[o] },
            { acc: new Float32Array(W * H), color: [70, 255, 90], pick: (o) => px[o + 1] },
            { acc: new Float32Array(W * H), color: [80, 130, 255], pick: (o) => px[o + 2] },
          ];
    const n = chans.length;
    const lane = W / n;
    chans.forEach((c, k) => {
      for (let y = 0; y < sh; y++)
        for (let x = 0; x < sw; x++) {
          const o = (y * sw + x) * 4;
          const gx = Math.min(W - 1, Math.floor(k * lane + ((x + 0.5) / sw) * (lane - (n > 1 ? 4 : 0))));
          const gy = Math.round((1 - c.pick(o) / 255) * (H - 1));
          c.acc[gy * W + gx]++;
        }
      plot(img, c.acc, c.color, gain);
    });
  } else if (mode === "vector") {
    const acc = new Float32Array(W * H);
    const cx = W / 2;
    const cy = H / 2;
    const R = H / 2 - 4;
    for (let i = 0; i < sw * sh; i++) {
      const o = i * 4;
      const r = px[o] / 255;
      const g = px[o + 1] / 255;
      const b = px[o + 2] / 255;
      const y = luma(r, g, b);
      // BT.709 Cb, Cr (±0.5)
      const cb = (b - y) / 1.8556;
      const cr = (r - y) / 1.5748;
      const x = Math.round(cx + cb * 2 * R);
      const yy = Math.round(cy - cr * 2 * R);
      if (x >= 0 && x < W && yy >= 0 && yy < H) acc[yy * W + x]++;
    }
    plot(img, acc, [200, 255, 210], gain);
  } else {
    const bins = [new Float32Array(W), new Float32Array(W), new Float32Array(W), new Float32Array(W)];
    for (let i = 0; i < sw * sh; i++) {
      const o = i * 4;
      bins[0][Math.round((px[o] / 255) * (W - 1))]++;
      bins[1][Math.round((px[o + 1] / 255) * (W - 1))]++;
      bins[2][Math.round((px[o + 2] / 255) * (W - 1))]++;
      bins[3][Math.round((luma(px[o], px[o + 1], px[o + 2]) / 255) * (W - 1))]++;
    }
    let max = 1;
    for (const b of bins) for (let x = 0; x < W; x++) max = Math.max(max, b[x]);
    const colors: [number, number, number][] = [
      [200, 50, 50],
      [50, 200, 70],
      [60, 100, 230],
      [200, 200, 200],
    ];
    bins.forEach((b, k) => {
      const col = colors[k];
      for (let x = 0; x < W; x++) {
        const h = Math.round((Math.sqrt(b[x] / max)) * (H - 1));
        for (let y = H - h; y < H; y++) {
          const o = (y * W + x) * 4;
          img.data[o] = Math.min(255, img.data[o] + col[0] * 0.6);
          img.data[o + 1] = Math.min(255, img.data[o + 1] + col[1] * 0.6);
          img.data[o + 2] = Math.min(255, img.data[o + 2] + col[2] * 0.6);
        }
      }
    });
  }
  ctx.putImageData(img, 0, 0);
  drawGraticule(mode, ctx);
}

/** 눈금 */
function drawGraticule(mode: ScopeMode, ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.font = "9px sans-serif";
  ctx.lineWidth = 1;
  if (mode === "waveform" || mode === "parade") {
    for (const v of [0, 25, 50, 75, 100]) {
      const y = Math.round((1 - v / 100) * (H - 1)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
      ctx.fillText(String(v), 2, Math.min(H - 2, Math.max(9, y - 2)));
    }
  } else if (mode === "vector") {
    const cx = W / 2;
    const cy = H / 2;
    const R = H / 2 - 4;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.moveTo(cx - R, cy);
    ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R);
    ctx.lineTo(cx, cy + R);
    ctx.stroke();
    // 원색 목표점: R, Mg, B, Cy, G, Yl (75% 색 막대)
    const targets: [string, number, number, number][] = [
      ["R", 0.75, 0, 0],
      ["Mg", 0.75, 0, 0.75],
      ["B", 0, 0, 0.75],
      ["Cy", 0, 0.75, 0.75],
      ["G", 0, 0.75, 0],
      ["Yl", 0.75, 0.75, 0],
    ];
    for (const [name, r, g, b] of targets) {
      const y = luma(r, g, b);
      const x = cx + ((b - y) / 1.8556) * 2 * R;
      const yy = cy - ((r - y) / 1.5748) * 2 * R;
      ctx.strokeRect(x - 4, yy - 4, 8, 8);
      ctx.fillText(name, x + 6, yy + 3);
    }
    // 피부색 선 (I 축, 약 123°)
    ctx.strokeStyle = "rgba(255,170,90,0.6)";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    const a = (123 * Math.PI) / 180;
    ctx.lineTo(cx + Math.cos(a) * R, cy - Math.sin(a) * R);
    ctx.stroke();
  } else {
    for (const v of [0.25, 0.5, 0.75]) {
      const x = Math.round(v * (W - 1)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
  }
  ctx.restore();
}

interface Props {
  source: React.RefObject<HTMLCanvasElement | null>;
  /** 둘 중 하나가 바뀌면 다시 그린다 */
  time: number;
  project: unknown;
  playing: boolean;
}

export function Scopes({ source, time, project, playing }: Props) {
  const [mode, setMode] = useState<ScopeMode>(() => {
    try {
      return (localStorage.getItem("video.scope") as ScopeMode) || "waveform";
    } catch {
      return "waveform";
    }
  });
  const out = useRef<HTMLCanvasElement>(null);
  const small = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem("video.scope", mode);
    } catch {
      /* 저장 못 해도 괜찮다 */
    }
  }, [mode]);

  useEffect(() => {
    const render = () => {
      const src = source.current;
      const dst = out.current;
      if (!src || !dst || !src.width || !src.height) return;
      const sh = Math.max(1, Math.round((SW * src.height) / src.width));
      if (!small.current) small.current = document.createElement("canvas");
      const s = small.current;
      if (s.width !== SW || s.height !== sh) {
        s.width = SW;
        s.height = sh;
      }
      const g = s.getContext("2d", { willReadFrequently: true })!;
      g.clearRect(0, 0, SW, sh);
      g.drawImage(src, 0, 0, SW, sh);
      drawScope(mode, g.getImageData(0, 0, SW, sh).data, SW, sh, dst.getContext("2d")!);
    };
    // 멈춰 있을 때는 그림이 다 그려진 다음 한 번, 재생 중에는 1초에 열두 번쯤
    if (!playing) {
      const id = window.setTimeout(render, 60);
      return () => window.clearTimeout(id);
    }
    const id = window.setInterval(render, 80);
    return () => window.clearInterval(id);
  }, [source, time, project, playing, mode]);

  const current = MODES.find((m) => m.id === mode)!;
  return (
    <div className="scopes">
      <div className="scope-modes">
        {MODES.map((m) => (
          <button key={m.id} aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      <canvas ref={out} width={W} height={H} title={current.hint} />
      <p className="panel-note">{current.hint}</p>
    </div>
  );
}
