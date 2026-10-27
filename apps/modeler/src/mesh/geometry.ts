import * as THREE from "three";
import { dot, faceNormal, type PolyMesh, type Vec3 } from "./PolyMesh";

/** 이 각도보다 완만하게 꺾인 면끼리는 부드럽게 이어 보이게 한다 (구, 원기둥 옆면 등). */
export const AUTO_SMOOTH_DEGREES = 40;

/**
 * PolyMesh 를 three.js 가 그릴 수 있는 삼각형 묶음으로 바꾼다.
 * userData.triangleFace[t] 는 t 번째 삼각형이 원래 몇 번 면인지 (편집 모드에서 클릭한 면 찾기에 쓴다).
 */
export function buildGeometry(mesh: PolyMesh, smoothDegrees = AUTO_SMOOTH_DEGREES): THREE.BufferGeometry {
  const normals = mesh.faces.map((face) => faceNormal(mesh, face));

  // 점마다 그 점을 쓰는 면 목록
  const facesAt: number[][] = mesh.vertices.map(() => []);
  mesh.faces.forEach((face, f) => face.forEach((v) => facesAt[v].push(f)));

  // 0 도면 모든 면이 각지게, 180 도면 모두 부드럽게 이어 보인다.
  const cosLimit = smoothDegrees >= 180 ? -2 : Math.cos((smoothDegrees * Math.PI) / 180);
  const cornerNormal = (f: number, v: number): Vec3 => {
    const n: Vec3 = [0, 0, 0];
    for (const g of facesAt[v]) {
      if (dot(normals[f], normals[g]) >= cosLimit) {
        n[0] += normals[g][0];
        n[1] += normals[g][1];
        n[2] += normals[g][2];
      }
    }
    return n;
  };

  const positions: number[] = [];
  const vertexNormals: number[] = [];
  const triangleFace: number[] = [];

  mesh.faces.forEach((face, f) => {
    // 볼록한 다각형은 첫 점에서 부채꼴로 나누면 된다.
    for (let i = 1; i < face.length - 1; i++) {
      for (const v of [face[0], face[i], face[i + 1]]) {
        positions.push(...mesh.vertices[v]);
        vertexNormals.push(...cornerNormal(f, v));
      }
      triangleFace.push(f);
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(vertexNormals, 3));
  geometry.normalizeNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.triangleFace = triangleFace;
  return geometry;
}
