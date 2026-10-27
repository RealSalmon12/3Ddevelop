import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { OBJExporter } from "three/addons/exporters/OBJExporter.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";

export type ExportFormat = "glb" | "obj" | "stl";

export const EXPORT_FORMATS: { format: ExportFormat; label: string; filterName: string }[] = [
  { format: "glb", label: "GLB (게임, 웹, 다른 3D 프로그램용)", filterName: "GLB 3D 모델" },
  { format: "obj", label: "OBJ (대부분의 3D 프로그램용)", filterName: "OBJ 3D 모델" },
  { format: "stl", label: "STL (3D 프린팅용)", filterName: "STL 3D 프린팅 모델" },
];

/** 장면을 다른 프로그램에서 쓸 수 있는 파일 내용으로 바꾼다. */
export async function exportScene(
  source: THREE.Object3D,
  format: ExportFormat,
  only?: (child: THREE.Object3D) => boolean,
): Promise<string | Uint8Array> {
  // 이펙트 표시와 입자는 다른 프로그램에서 쓸 수 없어서 뺀다.
  const root = source.clone(false);
  source.children
    .filter((c) => c.userData.kind !== "effect" && (!only || only(c)))
    .forEach((c) => {
      // 화면에서 숨긴 것(H)도 내보낸다. 숨기기는 작업할 때 잠깐 치워 두는 것이라서.
      // 자식(편집 표시, 와이어프레임 선)은 빼고 모양만 복사한다.
      const copy = c.clone(false);
      copy.visible = true;
      root.add(copy);
    });
  root.updateMatrixWorld(true);
  switch (format) {
    case "obj":
      return new OBJExporter().parse(root);
    case "stl": {
      const view = new STLExporter().parse(root, { binary: true }) as DataView;
      return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    }
    case "glb": {
      const result = await new GLTFExporter().parseAsync(root, { binary: true });
      return new Uint8Array(result as ArrayBuffer);
    }
  }
}

/** 로블록스가 메시 하나에 받아 주는 삼각형 수 (대략적인 한도) */
export const ROBLOX_TRIANGLE_LIMIT = 20000;

export function triangleCount(mesh: THREE.Mesh): number {
  const g = mesh.geometry;
  return Math.round((g.index ? g.index.count : g.attributes.position.count) / 3);
}

/** 로블록스에 넣기 전에 걸리는 점들. 문제가 없으면 빈 배열. */
export function robloxProblems(meshes: THREE.Mesh[]): string[] {
  return meshes
    .filter((m) => m.userData.kind !== "effect" && triangleCount(m) > ROBLOX_TRIANGLE_LIMIT)
    .map((m) => `‘${m.name}’ 삼각형 ${triangleCount(m).toLocaleString()}개`);
}
