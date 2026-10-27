import * as THREE from "three";

export type ShapeKind = "cube" | "sphere" | "cylinder" | "cone" | "torus" | "plane";

export const SHAPES: { kind: ShapeKind; label: string }[] = [
  { kind: "cube", label: "정육면체" },
  { kind: "sphere", label: "구" },
  { kind: "cylinder", label: "원기둥" },
  { kind: "cone", label: "원뿔" },
  { kind: "torus", label: "도넛" },
  { kind: "plane", label: "평면" },
];

export function createGeometry(kind: ShapeKind): THREE.BufferGeometry {
  switch (kind) {
    case "cube":
      return new THREE.BoxGeometry(1, 1, 1);
    case "sphere":
      return new THREE.SphereGeometry(0.5, 32, 16);
    case "cylinder":
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
    case "cone":
      return new THREE.ConeGeometry(0.5, 1, 32);
    case "torus":
      return new THREE.TorusGeometry(0.4, 0.15, 16, 48);
    case "plane":
      return new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  }
}
