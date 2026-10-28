// 펜 도구 (포토샵 P): 점을 찍어 곧은 선, 끌어서 매끄러운 곡선(베지어)으로 정확한 모양을 그린다.
// 다 그린 패스는 선택 영역으로 바꾸거나, 붓처럼 선을 긋거나, 안을 채운다.

export interface Anchor {
  x: number;
  y: number;
  /** 나가는 손잡이 (점 기준). 들어오는 손잡이는 반대쪽 같은 길이. 0, 0 이면 뾰족한 점 */
  hx: number;
  hy: number;
}

export interface PenPath {
  anchors: Anchor[];
  closed: boolean;
}

export const emptyPath = (): PenPath => ({ anchors: [], closed: false });

/** 패스를 Path2D 로. map 으로 좌표를 바꿀 수 있다 (화면, 레이어 좌표) */
export function toPath2D(p: PenPath, map: (x: number, y: number) => { x: number; y: number } = (x, y) => ({ x, y })) {
  const out = new Path2D();
  const a = p.anchors;
  if (!a.length) return out;
  const m0 = map(a[0].x, a[0].y);
  out.moveTo(m0.x, m0.y);
  const seg = (from: Anchor, to: Anchor) => {
    const c1 = map(from.x + from.hx, from.y + from.hy);
    const c2 = map(to.x - to.hx, to.y - to.hy);
    const e = map(to.x, to.y);
    out.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, e.x, e.y);
  };
  for (let i = 1; i < a.length; i++) seg(a[i - 1], a[i]);
  if (p.closed && a.length > 1) {
    seg(a[a.length - 1], a[0]);
    out.closePath();
  }
  return out;
}

/** 곡선을 잘게 나눈 점들 (선택 영역 만들기용) */
export function flatten(p: PenPath, steps = 24): { x: number; y: number }[] {
  const a = p.anchors;
  const pts: { x: number; y: number }[] = [];
  if (!a.length) return pts;
  pts.push({ x: a[0].x, y: a[0].y });
  const seg = (from: Anchor, to: Anchor) => {
    const p0 = from;
    const p1 = { x: from.x + from.hx, y: from.y + from.hy };
    const p2 = { x: to.x - to.hx, y: to.y - to.hy };
    const p3 = to;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      pts.push({
        x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
        y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
      });
    }
  };
  for (let i = 1; i < a.length; i++) seg(a[i - 1], a[i]);
  if (a.length > 1) seg(a[a.length - 1], a[0]);
  return pts;
}
