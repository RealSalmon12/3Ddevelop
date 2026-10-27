import * as THREE from "three";
import { meshEdges, type PolyMesh } from "../mesh/PolyMesh";

/** 화면 보기 방식 (블렌더의 Z 키): 면 그대로 / 뼈대만 / 속이 비치게 */
export type Shading = "solid" | "wire" | "xray";

export const SHADING_LABEL: Record<Shading, string> = { solid: "솔리드", wire: "와이어프레임", xray: "X-ray (속 비치기)" };

const XRAY_OPACITY = 0.32;
const WHITE = new THREE.Color(0xffffff);

interface Saved {
  transparent: boolean;
  opacity: number;
  depthWrite: boolean;
}

/**
 * 매 프레임 오브젝트마다 보기 방식을 맞춘다. 실행 취소로 오브젝트가 새로 만들어져도 바로 따라온다.
 * 와이어프레임은 삼각형 대각선 없이 원래 면의 선만 그린다 (블렌더처럼).
 */
export function applyShading(meshes: THREE.Mesh[], shading: Shading) {
  for (const mesh of meshes) {
    if (mesh.userData.kind === "effect") continue;
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.visible = shading !== "wire";
    syncWire(mesh, shading !== "solid");

    const saved = mesh.userData.xraySaved as Saved | undefined;
    if (shading === "xray") {
      // 겉면을 바꾸면(유리 등) 재질 값이 다시 쓰이므로 그때마다 새로 기억한다.
      if (!saved || material.opacity !== XRAY_OPACITY) {
        mesh.userData.xraySaved = { transparent: material.transparent, opacity: material.opacity, depthWrite: material.depthWrite };
        material.transparent = true;
        material.opacity = XRAY_OPACITY;
        material.depthWrite = false;
        material.needsUpdate = true;
      }
    } else if (saved) {
      material.transparent = saved.transparent;
      material.opacity = saved.opacity;
      material.depthWrite = saved.depthWrite;
      material.needsUpdate = true;
      delete mesh.userData.xraySaved;
    }
  }
}

function syncWire(mesh: THREE.Mesh, show: boolean) {
  let wire = mesh.userData.wire as THREE.LineSegments | undefined;
  if (!show) {
    if (wire) {
      wire.removeFromParent();
      wire.geometry.dispose();
      (wire.material as THREE.Material).dispose();
      delete mesh.userData.wire;
    }
    return;
  }
  if (!wire) {
    wire = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9 }));
    wire.raycast = () => {};
    mesh.userData.wire = wire;
    mesh.add(wire);
  }
  const color = (mesh.material as THREE.MeshStandardMaterial).color;
  (wire.material as THREE.LineBasicMaterial).color.copy(color).lerp(WHITE, 0.35);
  // 모양이 바뀌면 geometry 가 새것으로 바뀐다. 그때만 선을 다시 만든다.
  if (wire.userData.source === mesh.geometry.uuid) return;
  // 매끈하게(서브디비전) 켠 오브젝트는 실제로 그려지는 잘게 나뉜 모양의 선을 보여 준다.
  const poly = (mesh.userData.displayPoly ?? mesh.userData.poly) as PolyMesh;
  const positions: number[] = [];
  for (const [a, b] of meshEdges(poly)) positions.push(...poly.vertices[a], ...poly.vertices[b]);
  wire.geometry.dispose();
  wire.geometry = new THREE.BufferGeometry();
  wire.geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  wire.userData.source = mesh.geometry.uuid;
}
