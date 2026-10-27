import type { EffectSettings } from "../effects/particles";
import type { Vec3 } from "../mesh/PolyMesh";
import type { Surface } from "./materials";
import type { ShapeKind } from "./shapes";

/** applyChanges 에 그대로 넣는 오브젝트 한 개 (회전은 라디안) */
interface Part {
  name: string;
  kind: ShapeKind;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  color?: string;
  glow?: number;
  surface?: Surface;
  effect?: EffectSettings;
}

const DEG = Math.PI / 180;
const part = (
  name: string,
  kind: ShapeKind,
  position: Vec3,
  scale: Vec3,
  color: string,
  extra: Partial<Part> & { rotationDeg?: Vec3 } = {},
): Part => {
  const { rotationDeg = [0, 0, 0], ...rest } = extra;
  return { name, kind, position, scale, color, rotation: rotationDeg.map((d) => d * DEG) as Vec3, ...rest };
};

/** AI 없이 바로 열어 볼 수 있는 예제. 모두 기본 도형만으로 만들어서, 뜯어보며 따라 하기 좋다. */
export const EXAMPLES: { label: string; hint: string; parts: Part[] }[] = [
  {
    label: "작은 집",
    hint: "정육면체를 45도 돌려서 지붕을 만들었어요",
    parts: [
      part("잔디", "plane", [0, 0, 0], [3, 1, 3], "#6fae5a", { surface: "matte" }),
      part("벽", "cube", [0, 1, 0], [3, 2, 3], "#efe2c4", { surface: "matte" }),
      part("지붕", "cube", [0, 2, 0], [2.2, 2.2, 2.96], "#c4483e", { rotationDeg: [0, 0, 45] }),
      part("굴뚝", "cube", [0.85, 3.1, -0.7], [0.35, 1, 0.35], "#8a4b3a", { surface: "matte" }),
      part("문", "cube", [0, 0.55, 1.5], [0.65, 1.1, 0.1], "#7a4e2d", { surface: "matte" }),
      part("문손잡이", "sphere", [0.2, 0.55, 1.57], [0.1, 0.1, 0.1], "#e8c25a", { surface: "metal" }),
      part("왼쪽 창문", "cube", [-0.9, 1.2, 1.5], [0.55, 0.55, 0.08], "#a9d8f2", { surface: "glass" }),
      part("오른쪽 창문", "cube", [0.9, 1.2, 1.5], [0.55, 0.55, 0.08], "#a9d8f2", { surface: "glass" }),
    ],
  },
  {
    label: "나무",
    hint: "원기둥 줄기에 구 세 개를 겹쳐 잎을 만들었어요",
    parts: [
      part("줄기", "cylinder", [0, 0.8, 0], [0.35, 1.6, 0.35], "#7b5234", { surface: "matte" }),
      part("잎 아래", "sphere", [0, 1.9, 0], [1.7, 1.4, 1.7], "#4f9a4a", { surface: "matte" }),
      part("잎 가운데", "sphere", [0.25, 2.5, 0.1], [1.2, 1.1, 1.2], "#5fb357", { surface: "matte" }),
      part("잎 위", "sphere", [-0.1, 3, -0.05], [0.8, 0.8, 0.8], "#72c464", { surface: "matte" }),
    ],
  },
  {
    label: "블록 캐릭터",
    hint: "로블록스 캐릭터처럼 정육면체로 몸을 만들었어요",
    parts: [
      part("왼다리", "cube", [-0.25, 0.5, 0], [0.48, 1, 0.48], "#5a9c4b"),
      part("오른다리", "cube", [0.25, 0.5, 0], [0.48, 1, 0.48], "#5a9c4b"),
      part("몸통", "cube", [0, 1.5, 0], [1, 1, 0.5], "#3f6fc7"),
      part("왼팔", "cube", [-0.75, 1.5, 0], [0.48, 1, 0.48], "#f2cd4b"),
      part("오른팔", "cube", [0.75, 1.5, 0], [0.48, 1, 0.48], "#f2cd4b"),
      part("머리", "cylinder", [0, 2.3, 0], [0.62, 0.6, 0.62], "#f2cd4b"),
      part("왼눈", "sphere", [-0.12, 2.35, 0.3], [0.08, 0.12, 0.05], "#1d1d1d", { surface: "shiny" }),
      part("오른눈", "sphere", [0.12, 2.35, 0.3], [0.08, 0.12, 0.05], "#1d1d1d", { surface: "shiny" }),
    ],
  },
  {
    label: "횃불",
    hint: "불꽃 이펙트와 빛나기를 함께 썼어요",
    parts: [
      part("손잡이", "cylinder", [0, 0.7, 0], [0.16, 1.4, 0.16], "#6b4428", { surface: "matte" }),
      part("받침", "cylinder", [0, 1.45, 0], [0.32, 0.22, 0.32], "#4a4a52", { surface: "metal" }),
      part("불씨", "sphere", [0, 1.6, 0], [0.22, 0.22, 0.22], "#ff8a2a", { glow: 2.5 }),
      part("불꽃", "effect", [0, 1.65, 0], [1, 1, 1], "#ff8a2a", { effect: { type: "fire", amount: 1, speed: 1 } }),
      part("연기", "effect", [0, 2.3, 0], [1, 1, 1], "#9aa0a6", { effect: { type: "smoke", amount: 0.5, speed: 0.8 } }),
    ],
  },
  {
    label: "마법 수정구",
    hint: "유리 겉면, 빛나기, 마법 이펙트를 겹쳤어요",
    parts: [
      part("받침대", "cylinder", [0, 0.2, 0], [1, 0.4, 1], "#3b3550", { surface: "shiny" }),
      part("고리", "torus", [0, 0.45, 0], [1.3, 1.3, 1.3], "#d6b25a", { surface: "metal", rotationDeg: [90, 0, 0] }),
      part("수정구", "sphere", [0, 1.1, 0], [1.1, 1.1, 1.1], "#b39dff", { surface: "glass", glow: 0.6 }),
      part("빛 심지", "sphere", [0, 1.1, 0], [0.3, 0.3, 0.3], "#d9ccff", { glow: 3 }),
      part("마법", "effect", [0, 1.1, 0], [1, 1, 1], "#b39dff", { effect: { type: "magic", amount: 1, speed: 1 } }),
    ],
  },
];
