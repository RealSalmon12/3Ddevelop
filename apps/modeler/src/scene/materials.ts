import type * as THREE from "three";

/** 겉면 느낌. 색은 그대로 두고 반짝임, 금속 느낌, 투명도만 바꾼다. */
export type Surface = "plastic" | "matte" | "shiny" | "metal" | "glass";

export const SURFACES: { type: Surface; label: string; roughness: number; metalness: number; opacity: number }[] = [
  { type: "plastic", label: "플라스틱", roughness: 0.55, metalness: 0.05, opacity: 1 },
  { type: "matte", label: "흙, 나무 (반짝임 없음)", roughness: 0.95, metalness: 0, opacity: 1 },
  { type: "shiny", label: "반들반들 (도자기, 사탕)", roughness: 0.12, metalness: 0, opacity: 1 },
  { type: "metal", label: "금속", roughness: 0.28, metalness: 1, opacity: 1 },
  { type: "glass", label: "유리 (반투명)", roughness: 0.05, metalness: 0, opacity: 0.35 },
];

export const isSurface = (v: unknown): v is Surface => SURFACES.some((s) => s.type === v);

export function applySurface(material: THREE.MeshStandardMaterial, surface: Surface = "plastic") {
  const s = SURFACES.find((x) => x.type === surface) ?? SURFACES[0];
  material.roughness = s.roughness;
  material.metalness = s.metalness;
  material.opacity = s.opacity;
  material.transparent = s.opacity < 1;
  // 반투명한 면은 뒤에 있는 것을 가리지 않게 깊이를 쓰지 않는다.
  material.depthWrite = s.opacity === 1;
}
