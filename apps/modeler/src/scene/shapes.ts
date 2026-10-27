import type { PolyMesh } from "../mesh/PolyMesh";
import { coneMesh, cubeMesh, cylinderMesh, planeMesh, sphereMesh, torusMesh } from "../mesh/primitives";

/** 이펙트 위치를 보여주는 작은 팔면체 */
function markerMesh(): PolyMesh {
  const r = 0.15;
  return {
    vertices: [[r, 0, 0], [-r, 0, 0], [0, r, 0], [0, -r, 0], [0, 0, r], [0, 0, -r]],
    faces: [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]],
  };
}

/** "effect" 는 연기, 반짝이 같은 이펙트를 뿜는 자리 표시 오브젝트 */
export type ShapeKind = "cube" | "sphere" | "cylinder" | "cone" | "torus" | "plane" | "effect";

export const SHAPES: { kind: Exclude<ShapeKind, "effect">; label: string }[] = [
  { kind: "cube", label: "정육면체" },
  { kind: "sphere", label: "구" },
  { kind: "cylinder", label: "원기둥" },
  { kind: "cone", label: "원뿔" },
  { kind: "torus", label: "도넛" },
  { kind: "plane", label: "평면" },
];

export function createShape(kind: ShapeKind): PolyMesh {
  switch (kind) {
    case "cube":
      return cubeMesh();
    case "sphere":
      return sphereMesh();
    case "cylinder":
      return cylinderMesh();
    case "cone":
      return coneMesh();
    case "torus":
      return torusMesh();
    case "plane":
      return planeMesh();
    case "effect":
      return markerMesh();
  }
}
