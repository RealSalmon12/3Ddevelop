import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { OBJExporter } from "three/addons/exporters/OBJExporter.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { buildClip, type AnimSettings, type Keyframe } from "./animation";
import { buildSkeleton, MAX_INFLUENCES, type Rig } from "../mesh/rig";
import { meshWeights, restGeometry } from "./ModelerScene";

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
  /** 있으면 GLB 에 키프레임 애니메이션을 넣는다 */
  anim?: AnimSettings,
): Promise<string | Uint8Array> {
  // 이펙트 표시와 입자는 다른 프로그램에서 쓸 수 없어서 뺀다.
  const root = source.clone(false);
  const animated: [Keyframe[], THREE.Object3D][] = [];
  const boneNodes = new Map<THREE.Object3D, Map<string, THREE.Object3D>>();
  source.children
    .filter((c) => c.userData.kind !== "effect" && (!only || only(c)))
    .forEach((c) => {
      // 화면에서 숨긴 것(H)도 내보낸다. 숨기기는 작업할 때 잠깐 치워 두는 것이라서.
      // 자식(편집 표시, 와이어프레임 선)은 빼고 모양만 복사한다.
      // userData(편집용 모양, 칠하기 그림 등)는 복사하지 않는다. 그대로 두면 GLB 의 extras 로 들어가 파일이 아주 커진다.
      const saved = c.userData;
      const rig = saved.rig as Rig | undefined;
      let copy: THREE.Object3D;
      if (rig && c instanceof THREE.Mesh && format !== "stl") {
        // 뼈대가 있으면 뼈와 가중치를 담은 스킨드 메시로 (STL 은 지금 포즈 그대로 굳힌 모양)
        const { skinned, nodes } = skinnedCopy(c, rig);
        copy = skinned;
        boneNodes.set(copy, nodes);
      } else {
        c.userData = {};
        copy = c.clone(false);
        c.userData = saved;
      }
      copy.visible = true;
      root.add(copy);
      if (c.userData.keys) animated.push([c.userData.keys as Keyframe[], copy]);
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
      const clip = anim && buildClip(animated, anim, boneNodes);
      const result = await new GLTFExporter().parseAsync(root, { binary: true, ...(clip ? { animations: [clip] } : {}) });
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

/** 쉬는 자세 모양 + 뼈 + 가중치로 스킨드 메시를 만든다. 지금 포즈는 뼈 회전으로 넣는다 */
function skinnedCopy(mesh: THREE.Mesh, rig: Rig) {
  const geometry = restGeometry(mesh);
  const corner = geometry.userData.cornerVertex as number[];
  const w = meshWeights(mesh)!;
  const index = new Uint16Array(corner.length * 4);
  const weight = new Float32Array(corner.length * 4);
  corner.forEach((v, i) => {
    for (let k = 0; k < 4; k++) {
      index[i * 4 + k] = k < MAX_INFLUENCES ? w.index[v * MAX_INFLUENCES + k] : 0;
      weight[i * 4 + k] = k < MAX_INFLUENCES ? w.weight[v * MAX_INFLUENCES + k] : 0;
    }
  });
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(index, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weight, 4));
  const skinned = new THREE.SkinnedMesh(geometry, mesh.material);
  skinned.name = mesh.name;
  skinned.position.copy(mesh.position);
  skinned.quaternion.copy(mesh.quaternion);
  skinned.scale.copy(mesh.scale);
  const { root, bones } = buildSkeleton(rig);
  root.forEach((b) => skinned.add(b));
  skinned.updateMatrixWorld(true);
  skinned.bind(new THREE.Skeleton(bones));
  const nodes = new Map<string, THREE.Object3D>();
  rig.bones.forEach((b, i) => {
    nodes.set(b.id, bones[i]);
    const r = rig.pose[b.id];
    if (r) bones[i].rotation.set(r[0], r[1], r[2]);
  });
  return { skinned, nodes };
}
