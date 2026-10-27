/* 다른 프로그램에서 만든 3D 모델 가져오기 (GLB, glTF, OBJ, STL). 조각마다 편집할 수 있는 오브젝트가 된다. */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { trisToQuads } from "../mesh/boolean";
import type { PolyMesh, Vec3 } from "../mesh/PolyMesh";

export const IMPORT_FILTER = { name: "3D 모델", extensions: ["glb", "gltf", "obj", "stl"] };
/** 너무 큰 모델은 점 하나하나 편집하기 어려워 막는다 */
export const IMPORT_TRIANGLE_LIMIT = 150_000;

export interface ImportedPart {
  name: string;
  poly: PolyMesh;
  color: string;
}

async function loadObject(bytes: Uint8Array, ext: string): Promise<THREE.Object3D> {
  const buffer = bytes.slice().buffer;
  if (ext === "stl") {
    const g = new STLLoader().parse(buffer);
    return new THREE.Mesh(g, new THREE.MeshStandardMaterial());
  }
  if (ext === "obj") return new OBJLoader().parse(new TextDecoder().decode(bytes));
  const gltf = await new GLTFLoader().parseAsync(ext === "gltf" ? new TextDecoder().decode(bytes) : buffer, "");
  return gltf.scene;
}

/** 삼각형 묶음을 같은 자리 점끼리 이어 붙인 다각형 메시로 */
function toPoly(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4): PolyMesh {
  const pos = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const v = new THREE.Vector3();
  const vertices: Vec3[] = [];
  const lookup = new Map<string, number>();
  const point = (i: number) => {
    v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
    const key = `${Math.round(v.x * 1e4)},${Math.round(v.y * 1e4)},${Math.round(v.z * 1e4)}`;
    let n = lookup.get(key);
    if (n === undefined) {
      n = vertices.length;
      vertices.push([v.x, v.y, v.z]);
      lookup.set(key, n);
    }
    return n;
  };
  const faces: number[][] = [];
  const count = index ? index.count : pos.count;
  // 거울처럼 뒤집힌 변환이면 면 방향도 뒤집는다
  const flip = matrix.determinant() < 0;
  for (let t = 0; t + 2 < count; t += 3) {
    const tri = [0, 1, 2].map((k) => point(index ? index.getX(t + k) : t + k));
    if (new Set(tri).size < 3) continue;
    faces.push(flip ? [tri[0], tri[2], tri[1]] : tri);
  }
  return trisToQuads({ vertices, faces });
}

/**
 * 파일 내용을 조각 목록으로. 모델이 아주 크거나 작으면 2m 쯤으로 맞추고 바닥에 놓는다.
 * 돌려주는 scaled 는 크기를 맞췄는지.
 */
export async function importModel(bytes: Uint8Array, fileExt: string): Promise<{ parts: ImportedPart[]; triangles: number; scaled: boolean }> {
  const ext = fileExt.toLowerCase();
  const root = await loadObject(bytes, ext);
  root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  let triangles = 0;
  for (const m of meshes) {
    const g = m.geometry as THREE.BufferGeometry;
    triangles += (g.getIndex()?.count ?? g.getAttribute("position").count) / 3;
  }
  if (!meshes.length) throw new Error("모델 안에 도형이 없어요.");
  if (triangles > IMPORT_TRIANGLE_LIMIT) throw new Error(`삼각형이 ${Math.round(triangles).toLocaleString()}개라 너무 커요. ${IMPORT_TRIANGLE_LIMIT.toLocaleString()}개 아래로 줄여서 가져와 주세요.`);

  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z);
  const scaled = longest > 50 || longest < 0.05;
  const k = scaled ? 2 / longest : 1;
  const center = box.getCenter(new THREE.Vector3());
  // 가운데를 원점에, 바닥을 땅에
  const fit = new THREE.Matrix4().makeScale(k, k, k).multiply(new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z));

  const parts = meshes.map((m, i) => {
    const material = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial | undefined;
    // OBJ(재질 파일 없이), STL 은 색 정보가 없어 하얗게 나오므로 기본 회색으로
    const hasColor = ext === "glb" || ext === "gltf" || (material?.color && material.color.getHex() !== 0xffffff);
    const color = hasColor && material?.color ? `#${material.color.getHexString()}` : "#b8bcc4";
    return {
      name: m.name || `${ext.toUpperCase()} 조각 ${i + 1}`,
      poly: toPoly(m.geometry as THREE.BufferGeometry, fit.clone().multiply(m.matrixWorld)),
      color,
    };
  });
  return { parts, triangles: Math.round(triangles), scaled };
}
