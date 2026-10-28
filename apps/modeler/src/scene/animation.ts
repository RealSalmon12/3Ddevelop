/**
 * 키프레임 애니메이션 (블렌더의 I 키, 타임라인): 프레임마다 오브젝트의 위치, 회전, 크기를 기록해 두면
 * 그 사이를 부드럽게 이어 움직인다. GLB 로 내보내면 게임 엔진에서도 그대로 움직인다.
 */
import * as THREE from "three";
import type { Vec3 } from "../mesh/PolyMesh";

/** 다음 키까지 어떻게 이어 갈지: 부드럽게(천천히 출발해 천천히 멈춤), 일정하게, 뚝 끊어서 */
export type Interp = "smooth" | "linear" | "constant";

export const INTERPS: { value: Interp; label: string }[] = [
  { value: "smooth", label: "부드럽게" },
  { value: "linear", label: "일정하게" },
  { value: "constant", label: "끊어서" },
];

export interface Keyframe {
  frame: number;
  position: Vec3;
  /** 라디안 */
  rotation: Vec3;
  scale: Vec3;
  /** 이 키에서 다음 키까지 (없으면 부드럽게) */
  interp?: Interp;
  /** 뼈대 포즈: 뼈마다 회전 (뼈대가 있는 오브젝트만) */
  bones?: Record<string, Vec3>;
}

export interface AnimSettings {
  fps: number;
  /** 마지막 프레임 (0 부터) */
  end: number;
}

export const DEFAULT_ANIM: AnimSettings = { fps: 24, end: 120 };
export const FPS_CHOICES = [12, 24, 30, 60];

export interface Pose {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  bones?: Record<string, Vec3>;
}

/** 두 키의 뼈 회전을 섞는다. 한쪽에만 있는 뼈는 다른 쪽을 0 으로 본다 */
function lerpBones(a: Record<string, Vec3> | undefined, b: Record<string, Vec3> | undefined, t: number) {
  if (!a && !b) return undefined;
  const out: Record<string, Vec3> = {};
  const zero: Vec3 = [0, 0, 0];
  for (const k of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) out[k] = lerp3(a?.[k] ?? zero, b?.[k] ?? zero, t);
  return out;
}

const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** frame 에서의 모습. 키가 없으면 null */
export function sampleKeys(keys: Keyframe[] | undefined, frame: number): Pose | null {
  if (!keys?.length) return null;
  if (frame <= keys[0].frame) return keys[0];
  const last = keys[keys.length - 1];
  if (frame >= last.frame) return last;
  let i = 0;
  while (keys[i + 1].frame <= frame) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const interp = a.interp ?? "smooth";
  if (interp === "constant") return a;
  let t = (frame - a.frame) / (b.frame - a.frame);
  if (interp === "smooth") t = t * t * (3 - 2 * t);
  return { position: lerp3(a.position, b.position, t), rotation: lerp3(a.rotation, b.rotation, t), scale: lerp3(a.scale, b.scale, t), bones: lerpBones(a.bones, b.bones, t) };
}

/** 같은 프레임의 키는 바꾸고, 없으면 넣는다 (프레임 순서 유지). 보간 방식은 원래 키의 것을 남긴다. */
export function upsertKey(keys: Keyframe[] | undefined, key: Keyframe): Keyframe[] {
  const list = (keys ?? []).filter((k) => k.frame !== key.frame);
  const old = keys?.find((k) => k.frame === key.frame);
  list.push(old?.interp && !key.interp ? { ...key, interp: old.interp } : key);
  return list.sort((a, b) => a.frame - b.frame);
}

export const cloneKeys = (keys: Keyframe[]): Keyframe[] =>
  keys.map((k) => ({
    frame: k.frame,
    position: [...k.position] as Vec3,
    rotation: [...k.rotation] as Vec3,
    scale: [...k.scale] as Vec3,
    ...(k.interp && k.interp !== "smooth" ? { interp: k.interp } : {}),
    ...(k.bones ? { bones: Object.fromEntries(Object.entries(k.bones).map(([b, v]) => [b, [...v] as Vec3])) } : {}),
  }));

/**
 * GLB 에 넣을 애니메이션. 보간 방식이 셋이라 프레임마다 값을 찍어 넣는다 (어느 프로그램에서 열어도 똑같이 움직이게).
 * targets: [키 목록, 내보낼 복사본] 쌍
 */
export function buildClip(
  targets: [Keyframe[], THREE.Object3D][],
  anim: AnimSettings,
  /** 뼈대가 있으면: 키의 뼈 id → 내보낼 three.js 뼈 */
  boneNodes?: Map<THREE.Object3D, Map<string, THREE.Object3D>>,
): THREE.AnimationClip | null {
  const tracks: THREE.KeyframeTrack[] = [];
  const frames = Array.from({ length: anim.end + 1 }, (_, f) => f);
  const times = frames.map((f) => f / anim.fps);
  const euler = new THREE.Euler();
  const q = new THREE.Quaternion();
  for (const [keys, node] of targets) {
    if (!keys.length) continue;
    const pos: number[] = [];
    const rot: number[] = [];
    const scl: number[] = [];
    for (const f of frames) {
      const p = sampleKeys(keys, f)!;
      pos.push(...p.position);
      scl.push(...p.scale);
      q.setFromEuler(euler.set(...p.rotation));
      rot.push(q.x, q.y, q.z, q.w);
    }
    tracks.push(new THREE.VectorKeyframeTrack(`${node.uuid}.position`, times, pos));
    tracks.push(new THREE.QuaternionKeyframeTrack(`${node.uuid}.quaternion`, times, rot));
    tracks.push(new THREE.VectorKeyframeTrack(`${node.uuid}.scale`, times, scl));
    const nodes = boneNodes?.get(node);
    if (nodes && keys.some((k) => k.bones)) {
      for (const [boneId, bone] of nodes) {
        const values: number[] = [];
        for (const f of frames) {
          const r = sampleKeys(keys, f)!.bones?.[boneId] ?? [0, 0, 0];
          q.setFromEuler(euler.set(...r));
          values.push(q.x, q.y, q.z, q.w);
        }
        tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.uuid}.quaternion`, times, values));
      }
    }
  }
  return tracks.length ? new THREE.AnimationClip("애니메이션", anim.end / anim.fps, tracks) : null;
}
