// 무비 컷 프로젝트: 조각(영상·사진)을 순서대로 잇고, 위에 자막, 아래에 배경 음악.

export interface Clip {
  id: number;
  kind: "video" | "image";
  name: string;
  /** blob: 주소 */
  url: string;
  /** 원래 길이 (초). 사진은 마음대로 늘릴 수 있게 크게 잡는다 */
  duration: number;
  /** 쓸 부분 (초) */
  in: number;
  out: number;
  /** 0~1.5 */
  volume: number;
}

export interface Caption {
  id: number;
  text: string;
  start: number;
  end: number;
  position: "top" | "middle" | "bottom";
  size: "small" | "medium" | "large";
  color: string;
}

export interface Music {
  name: string;
  url: string;
  volume: number;
}

export interface Project {
  portrait: boolean;
  clips: Clip[];
  captions: Caption[];
  music: Music | null;
}

export const EMPTY_PROJECT: Project = { portrait: false, clips: [], captions: [], music: null };

let nextId = 1;
export const newId = () => nextId++;

export const clipLength = (c: Clip) => Math.max(0.1, c.out - c.in);
export const totalLength = (p: Project) => p.clips.reduce((n, c) => n + clipLength(c), 0);

/** 전체 시간 t 에 보이는 조각과 그 조각 안의 시간 */
export function locate(p: Project, t: number): { index: number; clip: Clip; local: number; start: number } | null {
  let start = 0;
  for (let i = 0; i < p.clips.length; i++) {
    const c = p.clips[i];
    const len = clipLength(c);
    if (t < start + len || i === p.clips.length - 1) return { index: i, clip: c, local: c.in + Math.min(len, Math.max(0, t - start)), start };
    start += len;
  }
  return null;
}

export const clipStart = (p: Project, index: number) => p.clips.slice(0, index).reduce((n, c) => n + clipLength(c), 0);

export const frameSize = (p: Project) => (p.portrait ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 });

export const fmt = (sec: number) => `${Math.floor(sec / 60)}:${Math.floor(sec % 60).toString().padStart(2, "0")}.${Math.floor((sec % 1) * 10)}`;
