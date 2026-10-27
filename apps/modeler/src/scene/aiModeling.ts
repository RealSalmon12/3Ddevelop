import type { ModelerScene } from "./ModelerScene";
import { SHAPES, type ShapeKind } from "./shapes";

type Vec3 = [number, number, number];

/** AI 가 돌려주는 장면 바꾸기 명령 */
export interface ScenePlan {
  reply: string;
  remove?: string[];
  objects?: {
    name: string;
    kind: ShapeKind;
    position: Vec3;
    /** 도 단위 */
    rotation?: Vec3;
    scale?: Vec3;
    color?: string;
  }[];
}

const DEG = Math.PI / 180;
const vec3 = { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 };

export const AI_SYSTEM = `당신은 초보자용 3D 모델링 프로그램의 AI 도우미입니다.
사용자가 한국어로 만들고 싶은 것을 설명하면, 기본 도형을 조합해 그 모양을 만들고 edit_scene 도구로 장면을 바꿉니다.

좌표계와 도형 규칙:
- 단위는 미터처럼 생각합니다. y 가 위쪽이고 바닥은 y = 0 입니다. 물체는 바닥 위에 놓이게 하세요.
- position 은 도형의 가운데 위치입니다. rotation 은 도 단위의 [x, y, z] 회전입니다. scale 은 [x, y, z] 배율입니다.
- 크기 1 일 때 도형 모양:
  - cube: 가로, 세로, 높이 모두 1 인 정육면체
  - sphere: 지름 1 인 구
  - cylinder: 지름 1, 높이 1 인 원기둥 (y 방향으로 서 있음)
  - cone: 바닥 지름 1, 높이 1 인 원뿔 (꼭짓점이 +y)
  - torus: 고리 반지름 0.4, 굵기 반지름 0.15 인 도넛 (xy 평면에 서 있음, 구멍이 z 방향)
  - plane: 2 x 2 크기의 바닥처럼 누운 판
- 예: 바닥에 놓인 높이 2 인 기둥은 kind=cylinder, scale=[0.3, 2, 0.3], position=[0, 1, 0].

작업 규칙:
- 사용자가 새것을 만들어 달라고 하면 기존 물체와 겹치지 않는 곳에 만드세요. 현재 장면이 비어 있으면 원점 근처에 만드세요.
- 고쳐 달라고 하면 현재 상태에 있는 같은 name 으로 objects 에 넣어 바꾸고, 필요 없는 것은 remove 에 이름을 넣으세요.
- 새 도형의 name 은 무엇인지 알 수 있는 짧은 한국어로 짓고, 기존 이름과 겹치지 않게 하세요 (예: "집 지붕", "의자 다리 1").
- 색은 실제 물건처럼 어울리게 "#rrggbb" 로 정하세요.
- 도형은 보통 3개에서 30개 사이로 충분히 알아볼 수 있게 만드세요.
- reply 에는 무엇을 만들었고 어떻게 더 고칠 수 있는지 초보자에게 친절하게 한두 문장으로 쓰세요.`;

export const AI_TOOL = {
  name: "edit_scene",
  description: "3D 장면에 도형을 추가하거나, 이름으로 기존 도형을 바꾸거나 지운다.",
  input_schema: {
    type: "object",
    properties: {
      reply: { type: "string", description: "사용자에게 보여줄 짧은 설명" },
      remove: { type: "array", items: { type: "string" }, description: "지울 도형 이름" },
      objects: {
        type: "array",
        description: "추가하거나 바꿀 도형. 같은 이름이 있으면 그 도형을 바꾼다.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            kind: { type: "string", enum: SHAPES.map((s) => s.kind) },
            position: vec3,
            rotation: vec3,
            scale: vec3,
            color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
          },
          required: ["name", "kind", "position"],
        },
      },
    },
    required: ["reply"],
  },
};

/** AI 에게 보여줄 현재 장면 */
export function sceneContext(model: ModelerScene) {
  return model.getSnapshot().items.map(({ name, kind, position, rotation, scale, color }) => ({
    name,
    kind,
    position,
    rotation: rotation.map((r) => Math.round(r / DEG)),
    scale,
    color,
  }));
}

/** AI 의 답을 장면에 적용한다. 한 번에 실행 취소할 수 있게 하나로 기록된다. */
export function applyPlan(model: ModelerScene, plan: ScenePlan): string {
  const kinds = new Set(SHAPES.map((s) => s.kind));
  const finite = (v: unknown, fallback: Vec3): Vec3 =>
    Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n)) ? (v as Vec3) : fallback;

  model.applyChanges({
    remove: plan.remove ?? [],
    upsert: (plan.objects ?? [])
      .filter((o) => o && typeof o.name === "string" && kinds.has(o.kind))
      .map((o) => ({
        name: o.name,
        kind: o.kind,
        position: finite(o.position, [0, 0.5, 0]),
        rotation: finite(o.rotation, [0, 0, 0]).map((d) => d * DEG) as Vec3,
        scale: finite(o.scale, [1, 1, 1]),
        color: /^#[0-9a-fA-F]{6}$/.test(o.color ?? "") ? o.color!.toLowerCase() : undefined,
      })),
  });
  return plan.reply;
}
