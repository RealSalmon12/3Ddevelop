import type { PolyMesh } from "../mesh/PolyMesh";
import { coneMesh, cubeMesh, cylinderMesh, planeMesh, sphereMesh, torusMesh } from "../mesh/primitives";

export type ShapeKind = "cube" | "sphere" | "cylinder" | "cone" | "torus" | "plane";

export const SHAPES: { kind: ShapeKind; label: string }[] = [
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
  }
}
