// 픽셀 유동화 (포토샵 Shift+Ctrl+X): 그림을 찰흙처럼 밀고, 부풀리고, 오므리고, 돌린다.
// 칸마다 "어디서 가져올지"(변위 dx, dy)를 기억해 두고, 그 자리의 원본 색을 가져와 그린다.
// 미리보기는 작은 크기로 바로바로, 적용할 때만 원래 크기로 한 번 계산한다.

export type LiquifyTool = "push" | "bloat" | "pucker" | "twirl" | "restore";

export const LIQUIFY_TOOLS: { id: LiquifyTool; label: string; icon: string; key: string; hint: string }[] = [
  { id: "push", label: "앞으로 밀기", icon: "☝", key: "W", hint: "끄는 방향으로 픽셀을 밀어요 (얼굴 윤곽, 머리카락)" },
  { id: "bloat", label: "부풀리기", icon: "◉", key: "B", hint: "누르고 있으면 가운데가 커져요 (눈 키우기)" },
  { id: "pucker", label: "오목하게", icon: "◎", key: "S", hint: "누르고 있으면 가운데로 오므라들어요 (코 줄이기)" },
  { id: "twirl", label: "돌리기", icon: "↻", key: "C", hint: "시계 방향으로 소용돌이 (Alt: 반대로)" },
  { id: "restore", label: "되돌리기 붓", icon: "↺", key: "R", hint: "칠한 곳을 원래대로 천천히 돌려놓아요" },
];

export class Field {
  readonly dx: Float32Array;
  readonly dy: Float32Array;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.dx = new Float32Array(w * h);
    this.dy = new Float32Array(w * h);
  }

  /** (x, y) 의 변위 (쌍선형) */
  sample(x: number, y: number): [number, number] {
    const { w, h, dx, dy } = this;
    x = Math.max(0, Math.min(w - 1, x));
    y = Math.max(0, Math.min(h - 1, y));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(w - 1, x0 + 1);
    const y1 = Math.min(h - 1, y0 + 1);
    const fx = x - x0;
    const fy = y - y0;
    const i00 = y0 * w + x0;
    const i10 = y0 * w + x1;
    const i01 = y1 * w + x0;
    const i11 = y1 * w + x1;
    const a = dx[i00] * (1 - fx) + dx[i10] * fx;
    const b = dx[i01] * (1 - fx) + dx[i11] * fx;
    const c = dy[i00] * (1 - fx) + dy[i10] * fx;
    const d = dy[i01] * (1 - fx) + dy[i11] * fx;
    return [a * (1 - fy) + b * fy, c * (1 - fy) + d * fy];
  }

  /**
   * 붓 한 번. cx, cy, r: 붓 위치와 반지름, (vx, vy): 밀기에서 마우스가 움직인 만큼, k: 세기 0~1.
   * 바뀐 사각형을 돌려준다.
   */
  dab(tool: LiquifyTool, cx: number, cy: number, r: number, k: number, vx = 0, vy = 0, reverse = false) {
    const { w, dx, dy } = this;
    const x0 = Math.max(0, Math.floor(cx - r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + r));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + r));
    if (x1 < x0 || y1 < y0) return null;
    // 밀기는 이전 변위를 따라가며 겹쳐야 해서 붓 둘레의 원래 값을 먼저 베껴 둔다
    let old: Field | null = null;
    let ox0 = 0;
    let oy0 = 0;
    if (tool === "push") {
      const m = Math.ceil(Math.hypot(vx, vy)) + 2;
      ox0 = Math.max(0, x0 - m);
      oy0 = Math.max(0, y0 - m);
      const ox1 = Math.min(this.w - 1, x1 + m);
      const oy1 = Math.min(this.h - 1, y1 + m);
      old = new Field(ox1 - ox0 + 1, oy1 - oy0 + 1);
      for (let y = oy0; y <= oy1; y++)
        for (let x = ox0; x <= ox1; x++) {
          old.dx[(y - oy0) * old.w + x - ox0] = dx[y * w + x];
          old.dy[(y - oy0) * old.w + x - ox0] = dy[y * w + x];
        }
    }
    const sign = reverse ? -1 : 1;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const px = x - cx;
        const py = y - cy;
        const d = Math.hypot(px, py) / r;
        if (d >= 1) continue;
        // 가장자리로 갈수록 부드럽게 약해진다
        const f = (1 - d * d) * (1 - d * d) * k;
        const i = y * w + x;
        switch (tool) {
          case "push": {
            const mx = vx * f;
            const my = vy * f;
            const [ox, oy] = old!.sample(x - mx - ox0, y - my - oy0);
            dx[i] = ox - mx;
            dy[i] = oy - my;
            break;
          }
          case "bloat":
          case "pucker": {
            const s = (tool === "bloat" ? 1 : -1) * sign * 0.08 * f;
            dx[i] -= px * s;
            dy[i] -= py * s;
            break;
          }
          case "twirl": {
            const a = 0.12 * f * sign;
            const cos = Math.cos(a);
            const sin = Math.sin(a);
            dx[i] += px * cos - py * sin - px;
            dy[i] += px * sin + py * cos - py;
            break;
          }
          case "restore":
            dx[i] *= 1 - 0.25 * f;
            dy[i] *= 1 - 0.25 * f;
            break;
        }
      }
    return { x0, y0, x1, y1 };
  }

  isEmpty() {
    for (let i = 0; i < this.dx.length; i++) if (this.dx[i] !== 0 || this.dy[i] !== 0) return false;
    return true;
  }
}

/** 원본에서 변위대로 색을 가져와 out 에 그린다 (사각형 안만). scale: 원본 픽셀 / 변위 칸 */
export function renderWarp(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  out: Uint8ClampedArray,
  field: Field,
  scale: number,
  rect = { x0: 0, y0: 0, x1: sw - 1, y1: sh - 1 },
) {
  for (let y = rect.y0; y <= rect.y1; y++)
    for (let x = rect.x0; x <= rect.x1; x++) {
      const [ddx, ddy] = field.sample((x + 0.5) / scale - 0.5, (y + 0.5) / scale - 0.5);
      const sx = Math.max(0, Math.min(sw - 1, x + ddx * scale));
      const sy = Math.max(0, Math.min(sh - 1, y + ddy * scale));
      const xa = Math.floor(sx);
      const ya = Math.floor(sy);
      const xb = Math.min(sw - 1, xa + 1);
      const yb = Math.min(sh - 1, ya + 1);
      const fx = sx - xa;
      const fy = sy - ya;
      const o = (y * sw + x) * 4;
      const a = (ya * sw + xa) * 4;
      const b = (ya * sw + xb) * 4;
      const c = (yb * sw + xa) * 4;
      const d = (yb * sw + xb) * 4;
      for (let k = 0; k < 4; k++) {
        out[o + k] = (src[a + k] * (1 - fx) + src[b + k] * fx) * (1 - fy) + (src[c + k] * (1 - fx) + src[d + k] * fx) * fy;
      }
    }
}
