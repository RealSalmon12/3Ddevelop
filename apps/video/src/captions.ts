import type { Caption, Project } from "./project";

export const captionsAt = (p: Project, t: number) => p.captions.filter((c) => t >= c.start && t < c.end);

/** 쇼츠 자막처럼: 굵은 흰 글자에 검은 테두리 */
export function drawCaption(ctx: CanvasRenderingContext2D, c: Caption, width: number, height: number) {
  const short = Math.min(width, height);
  const size = Math.round(short * (c.size === "small" ? 0.05 : c.size === "medium" ? 0.075 : 0.11));
  ctx.save();
  ctx.font = `800 ${size}px "Pretendard Variable", "Malgun Gothic", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  const lines = c.text.split("\n");
  const lh = size * 1.25;
  const cy = c.position === "top" ? height * 0.14 : c.position === "middle" ? height / 2 : height * 0.84;
  lines.forEach((line, i) => {
    const y = cy + (i - (lines.length - 1) / 2) * lh;
    ctx.lineWidth = Math.max(4, size / 6);
    ctx.strokeStyle = "#000";
    ctx.strokeText(line, width / 2, y);
    ctx.fillStyle = c.color;
    ctx.fillText(line, width / 2, y);
  });
  ctx.restore();
}
