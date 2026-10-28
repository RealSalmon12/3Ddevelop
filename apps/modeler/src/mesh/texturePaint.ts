/**
 * 텍스처 칠하기 (블렌더의 Texture Paint): 3D 모양 위를 붓으로 칠하면 펼쳐 둔 UV 그림에 색이 들어간다.
 *
 * 붓은 그림(2D) 위가 아니라 모양(3D) 위에서 동그랗다. 붓이 닿는 삼각형마다 그 삼각형이 차지한 그림 칸을 돌며
 * 칸의 3D 위치가 붓 가운데에서 얼마나 먼지로 칠할 양을 정한다. 그래서 조각과 조각 사이(이음매)를 넘어가도
 * 붓 자국이 끊기지 않는다.
 */
import * as THREE from "three";
import type { FaceUVs } from "./uv";

export const TEXTURE_SIZE = 1024;

export type PaintBrush = "paint" | "erase" | "pick";

export interface PaintSettings {
  brush: PaintBrush;
  /** "#rrggbb" */
  color: string;
  /** 화면 픽셀 */
  radius: number;
  /** 불투명도 0~1 */
  strength: number;
  /** 가장자리 단단함 0~1 (0 이면 아주 부드럽게 번짐) */
  hardness: number;
  /** 왼쪽을 칠하면 오른쪽도 (X 축 대칭) */
  symmetry: boolean;
}

export const DEFAULT_PAINT: PaintSettings = { brush: "paint", color: "#e0523a", radius: 30, strength: 1, hardness: 0.6, symmetry: false };

export const PAINT_BRUSHES: { id: PaintBrush; label: string; icon: string; key: string; hint: string }[] = [
  { id: "paint", label: "붓", icon: "🖌", key: "B", hint: "고른 색으로 칠하기" },
  { id: "erase", label: "지우개", icon: "⌫", key: "E", hint: "처음 바탕색으로 되돌리기" },
  { id: "pick", label: "스포이트", icon: "💧", key: "I", hint: "모양 위의 색을 찍어 붓 색으로" },
];

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace("#", ""), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** 오브젝트 하나의 칠할 수 있는 그림 */
export class PaintTexture {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private img: ImageData;
  /** 붓질 하나 동안: 시작 때 그림과 칸마다 가장 진하게 칠한 양 (여러 번 찍혀도 불투명도를 넘지 않게) */
  private stroke: { before: Uint8ClampedArray; mask: Float32Array; x0: number; y0: number; x1: number; y1: number } | null = null;
  /** 저장용 PNG 글자 (붓을 뗄 때 새로 만든다) */
  url = "";

  constructor(
    source: HTMLCanvasElement | HTMLImageElement | string,
    readonly size = TEXTURE_SIZE,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;
    if (typeof source === "string") {
      this.ctx.fillStyle = source;
      this.ctx.fillRect(0, 0, size, size);
    } else this.ctx.drawImage(source, 0, 0, size, size);
    this.img = this.ctx.getImageData(0, 0, size, size);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
  }

  /** 바깥에서 canvas 에 직접 그린 뒤 (사진 입히기 등) */
  reload() {
    this.img = this.ctx.getImageData(0, 0, this.size, this.size);
    this.texture.needsUpdate = true;
  }

  fill(color: string) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.size, this.size);
    this.reload();
  }

  drawImage(image: CanvasImageSource) {
    this.ctx.drawImage(image, 0, 0, this.size, this.size);
    this.reload();
  }

  /** UV 자리의 색 */
  pick(u: number, v: number): string {
    const x = Math.max(0, Math.min(this.size - 1, Math.floor(u * this.size)));
    const y = Math.max(0, Math.min(this.size - 1, Math.floor((1 - v) * this.size)));
    const o = (y * this.size + x) * 4;
    const d = this.img.data;
    return `#${[d[o], d[o + 1], d[o + 2]].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  }

  begin() {
    const n = this.size * this.size;
    this.stroke = { before: this.img.data.slice(), mask: new Float32Array(n), x0: this.size, y0: this.size, x1: 0, y1: 0 };
  }

  /** 붓질이 끝나면 true (바뀐 게 있으면) */
  end(): boolean {
    const st = this.stroke;
    this.stroke = null;
    if (!st || st.x1 <= st.x0) return false;
    this.url = this.canvas.toDataURL("image/png");
    return true;
  }

  /**
   * 붓 한 번 찍기. 좌표는 모두 오브젝트 기준.
   * geometry: 삼각형마다 점 셋 (buildGeometry 가 만든 것, uv 가 있어야 한다)
   * facing: 붓이 닿은 면의 방향. 반대쪽을 보는 면(얇은 판의 뒷면)은 칠하지 않는다.
   */
  dab(geometry: THREE.BufferGeometry, center: THREE.Vector3, radius: number, facing: THREE.Vector3, color: string, strength: number, hardness: number) {
    const st = this.stroke;
    const uvAttr = geometry.getAttribute("uv");
    if (!st || !uvAttr) return;
    const pos = geometry.getAttribute("position").array as Float32Array;
    const uv = uvAttr.array as Float32Array;
    const S = this.size;
    const r2 = radius * radius;
    const rgb = hexToRgb(color);
    const d = this.img.data;
    const { before, mask } = st;
    const h = Math.min(0.99, Math.max(0, hardness));
    let dx0 = S, dy0 = S, dx1 = -1, dy1 = -1;
    const cx = center.x, cy = center.y, cz = center.z;
    const tris = pos.length / 9;
    for (let t = 0; t < tris; t++) {
      const p = t * 9;
      const ax = pos[p], ay = pos[p + 1], az = pos[p + 2];
      const bx = pos[p + 3], by = pos[p + 4], bz = pos[p + 5];
      const qx = pos[p + 6], qy = pos[p + 7], qz = pos[p + 8];
      // 붓 공과 삼각형 상자가 안 겹치면 건너뛴다
      if (Math.min(ax, bx, qx) > cx + radius || Math.max(ax, bx, qx) < cx - radius) continue;
      if (Math.min(ay, by, qy) > cy + radius || Math.max(ay, by, qy) < cy - radius) continue;
      if (Math.min(az, bz, qz) > cz + radius || Math.max(az, bz, qz) < cz - radius) continue;
      // 삼각형 방향이 붓 방향과 반대면 (뒷면) 건너뛴다
      const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
      const e2x = qx - ax, e2y = qy - ay, e2z = qz - az;
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      if (nx * facing.x + ny * facing.y + nz * facing.z <= 0) continue;

      const q = t * 6;
      const u0 = uv[q] * S, v0 = (1 - uv[q + 1]) * S;
      const u1 = uv[q + 2] * S, v1 = (1 - uv[q + 3]) * S;
      const u2 = uv[q + 4] * S, v2 = (1 - uv[q + 5]) * S;
      const area = (u1 - u0) * (v2 - v0) - (v1 - v0) * (u2 - u0);
      if (Math.abs(area) < 1e-9) continue;
      // 이음매가 그림 칸 사이로 새지 않게 삼각형보다 1.5칸 넓게 칠한다 (조각 사이 틈 안이라 옆 조각은 안 건드린다)
      const grow = 1.5;
      const x0 = Math.max(0, Math.floor(Math.min(u0, u1, u2) - grow));
      const x1 = Math.min(S - 1, Math.ceil(Math.max(u0, u1, u2) + grow));
      const y0 = Math.max(0, Math.floor(Math.min(v0, v1, v2) - grow));
      const y1 = Math.min(S - 1, Math.ceil(Math.max(v0, v1, v2) + grow));
      // 변마다 "칸 몇 개 바깥까지" 를 무게 단위로
      const l0 = Math.hypot(u2 - u1, v2 - v1), l1 = Math.hypot(u0 - u2, v0 - v2), l2 = Math.hypot(u1 - u0, v1 - v0);
      const g0 = -(grow * l0) / Math.abs(area), g1 = -(grow * l1) / Math.abs(area), g2 = -(grow * l2) / Math.abs(area);
      for (let y = y0; y <= y1; y++) {
        const py = y + 0.5;
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5;
          const w0 = ((u1 - px) * (v2 - py) - (v1 - py) * (u2 - px)) / area;
          const w1 = ((u2 - px) * (v0 - py) - (v2 - py) * (u0 - px)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < g0 || w1 < g1 || w2 < g2) continue;
          // 그 칸의 3D 위치
          const wx = ax * w0 + bx * w1 + qx * w2 - cx;
          const wy = ay * w0 + by * w1 + qy * w2 - cy;
          const wz = az * w0 + bz * w1 + qz * w2 - cz;
          const dist2 = wx * wx + wy * wy + wz * wz;
          if (dist2 >= r2) continue;
          const k = Math.sqrt(dist2) / radius;
          const fall = k <= h ? 1 : 1 - smooth((k - h) / (1 - h));
          const a = fall * strength;
          const i = y * S + x;
          if (a <= mask[i]) continue;
          mask[i] = a;
          const o = i * 4;
          d[o] = before[o] + (rgb[0] - before[o]) * a;
          d[o + 1] = before[o + 1] + (rgb[1] - before[o + 1]) * a;
          d[o + 2] = before[o + 2] + (rgb[2] - before[o + 2]) * a;
          d[o + 3] = 255;
          if (x < dx0) dx0 = x;
          if (x > dx1) dx1 = x;
          if (y < dy0) dy0 = y;
          if (y > dy1) dy1 = y;
        }
      }
    }
    if (dx1 < 0) return;
    this.ctx.putImageData(this.img, 0, 0, dx0, dy0, dx1 - dx0 + 1, dy1 - dy0 + 1);
    this.texture.needsUpdate = true;
    st.x0 = Math.min(st.x0, dx0);
    st.y0 = Math.min(st.y0, dy0);
    st.x1 = Math.max(st.x1, dx1 + 1);
    st.y1 = Math.max(st.y1, dy1 + 1);
  }

  dispose() {
    this.texture.dispose();
  }
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** UV 배치도 (블렌더의 Export UV Layout): 조각 테두리를 그린 PNG. 다른 그림 프로그램에서 밑그림으로 쓴다. */
export function uvLayoutCanvas(uvs: FaceUVs, background?: HTMLCanvasElement, size = TEXTURE_SIZE): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  if (background) {
    g.drawImage(background, 0, 0, size, size);
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.fillRect(0, 0, size, size);
  }
  g.strokeStyle = background ? "rgba(255,255,255,0.8)" : "#222";
  g.fillStyle = background ? "rgba(255,255,255,0.06)" : "rgba(80,140,255,0.12)";
  g.lineWidth = Math.max(1, size / 1024);
  g.beginPath();
  for (const face of uvs) {
    face.forEach(([u, v], i) => (i ? g.lineTo(u * size, (1 - v) * size) : g.moveTo(u * size, (1 - v) * size)));
    g.closePath();
  }
  g.fill();
  g.stroke();
  return c;
}
