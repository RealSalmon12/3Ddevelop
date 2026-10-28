/**
 * 모션 트래킹 (프리미어/애프터 이펙트의 트래커처럼): 화면 속 물체를 프레임마다 찾아서,
 * 고른 클립(글자, 스티커 사진, 모자이크용 조정 레이어)이 그 물체를 따라 움직이게 위치 키프레임을 만든다.
 *
 * 방법: 처음 프레임에서 클립 가운데 둘레의 작은 그림(템플릿)을 떼어 두고, 다음 프레임마다 지난 위치 둘레를 뒤져
 * 가장 닮은 곳을 찾는다 (밝기 평균을 뺀 차이 제곱의 합). 조명이 조금씩 바뀌어도 따라가도록 템플릿을 천천히 새로 고친다.
 */
import type { Engine } from "./engine";
import { clipEnd, evalParam, isVisual, type Clip, type Project } from "./model";

/** 분석용 화면 너비 (작을수록 빠르다) */
const AW = 480;

export interface TrackResult {
  /** 클립 시작부터의 시간과 그때 x, y 값 */
  keys: { t: number; x: number; y: number }[];
  /** 물체를 놓친 시간 (끝까지 따라갔으면 null) */
  lostAt: number | null;
}

function gray(img: ImageData) {
  const { data, width, height } = img;
  const g = new Float32Array(width * height);
  for (let i = 0; i < g.length; i++) g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  return g;
}

function patch(g: Float32Array, w: number, h: number, cx: number, cy: number, size: number) {
  const out = new Float32Array(size * size);
  const half = size >> 1;
  let mean = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const sx = Math.max(0, Math.min(w - 1, Math.round(cx) - half + x));
      const sy = Math.max(0, Math.min(h - 1, Math.round(cy) - half + y));
      const v = g[sy * w + sx];
      out[y * size + x] = v;
      mean += v;
    }
  mean /= size * size;
  for (let i = 0; i < out.length; i++) out[i] -= mean;
  return out;
}

/** 템플릿과 (cx, cy) 자리의 다른 정도 (작을수록 닮음). 평균을 빼서 밝기 변화에 덜 흔들린다. */
function score(g: Float32Array, w: number, h: number, tpl: Float32Array, size: number, cx: number, cy: number, limit: number) {
  const half = size >> 1;
  const x0 = cx - half;
  const y0 = cy - half;
  if (x0 < 0 || y0 < 0 || x0 + size > w || y0 + size > h) return Infinity;
  let mean = 0;
  for (let y = 0; y < size; y += 2) for (let x = 0; x < size; x += 2) mean += g[(y0 + y) * w + x0 + x];
  mean /= (size >> 1) * (size >> 1);
  let s = 0;
  for (let y = 0; y < size; y++) {
    const row = (y0 + y) * w + x0;
    for (let x = 0; x < size; x++) {
      const d = g[row + x] - mean - tpl[y * size + x];
      s += d * d;
    }
    if (s > limit) return s; // 이미 더 나쁘면 그만
  }
  return s;
}

export async function trackMotion(
  engine: Engine,
  project: Project,
  clip: Clip,
  from: number,
  /** 찾을 물체 크기 (화면 너비에 대한 비율) */
  boxFrac: number,
  onProgress: (ratio: number) => void,
  signal: { cancel: boolean },
): Promise<TrackResult> {
  const { width, height, fps } = project.sequence;
  const scale = AW / width;
  const aw = Math.round(width * scale);
  const ah = Math.round(height * scale);
  // 아래 영상이 클립보다 먼저 끝나면 거기까지만 (그 뒤는 빈 화면이라 따라갈 게 없다)
  const under = project.clips.filter((x) => x.id !== clip.id && isVisual(x) && x.start <= from && clipEnd(x) > from);
  const to = Math.min(clipEnd(clip), under.length ? Math.max(...under.map(clipEnd)) : Infinity);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const frameAt = async (t: number) => {
    await engine.renderAt(t, canvas, scale);
    return gray(ctx.getImageData(0, 0, aw, ah));
  };

  const local0 = from - clip.start;
  const x0 = evalParam(clip.params.x, local0);
  const y0 = evalParam(clip.params.y, local0);
  // 클립 가운데 = 화면 가운데 + (x, y)
  let px = (width / 2 + x0) * scale;
  let py = (height / 2 + y0) * scale;
  const size = Math.max(12, Math.round((aw * boxFrac) / 2) * 2);
  const radius = Math.max(10, Math.round(size * 0.9));

  let g = await frameAt(from);
  let tpl = patch(g, aw, ah, px, py, size);
  const first = tpl.slice();
  // 템플릿 자체가 얼마나 무늬가 있는지 (밋밋하면 따라갈 수 없다)
  const energy = tpl.reduce((a, v) => a + v * v, 0);
  if (energy / tpl.length < 20) throw new Error("클립 가운데 둘레가 너무 밋밋해서 따라갈 무늬가 없어요. 무늬나 모서리가 뚜렷한 곳에 클립을 놓고 다시 해 주세요.");

  const keys: TrackResult["keys"] = [{ t: local0, x: x0, y: y0 }];
  const sx = px;
  const sy = py;
  let vx = 0;
  let vy = 0;
  const frames = Math.max(1, Math.floor((to - from) * fps));
  let lostAt: number | null = null;
  for (let i = 1; i <= frames; i++) {
    if (signal.cancel) break;
    const t = from + i / fps;
    if (t >= to) break;
    g = await frameAt(t);
    // 지난 움직임만큼 앞서서 찾는다
    const gx = Math.round(px + vx);
    const gy = Math.round(py + vy);
    let best = Infinity;
    let bx = gx;
    let by = gy;
    // 넓게 2칸씩 → 둘레 1칸씩
    for (let dy = -radius; dy <= radius; dy += 2)
      for (let dx = -radius; dx <= radius; dx += 2) {
        const s = score(g, aw, ah, tpl, size, gx + dx, gy + dy, best);
        if (s < best) {
          best = s;
          bx = gx + dx;
          by = gy + dy;
        }
      }
    const cx = bx;
    const cy = by;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const s = score(g, aw, ah, tpl, size, cx + dx, cy + dy, best);
        if (s < best) {
          best = s;
          bx = cx + dx;
          by = cy + dy;
        }
      }
    // 닮은 정도가 너무 낮으면 놓친 것
    if (!Number.isFinite(best) || best / energy > 0.9) {
      // 클립 끝 두 프레임 안이면 (전환, 마지막 프레임) 놓친 걸로 치지 않는다
      if (to - t > 2 / fps) lostAt = t;
      break;
    }
    vx = bx - px;
    vy = by - py;
    px = bx;
    py = by;
    // 템플릿을 조금씩 새로 고치되, 처음 모습도 섞어 미끄러지지 않게
    const now = patch(g, aw, ah, px, py, size);
    for (let k = 0; k < tpl.length; k++) tpl[k] = 0.8 * tpl[k] + 0.12 * now[k] + 0.08 * first[k];
    keys.push({ t: t - clip.start, x: Math.round(x0 + (px - sx) / scale), y: Math.round(y0 + (py - sy) / scale) });
    onProgress(i / frames);
  }
  return { keys, lostAt };
}
