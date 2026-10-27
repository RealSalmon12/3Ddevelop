import type * as THREE from "three";
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
export async function exportScene(root: THREE.Object3D, format: ExportFormat): Promise<string | Uint8Array> {
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
