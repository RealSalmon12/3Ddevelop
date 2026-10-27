import * as THREE from "three";
import { edgeKey, meshEdges, type PolyMesh } from "../mesh/PolyMesh";
import { selectedVertices, type EditSelection } from "../mesh/selection";

const COLOR_NORMAL = new THREE.Color(0x111318);
const COLOR_SELECTED = new THREE.Color(0xffa64d);
const COLOR_EDGE = new THREE.Color(0x1b1d22);

/** 편집 모드에서 오브젝트 위에 점, 선, 고른 면을 그린다. 편집 중인 오브젝트의 자식으로 붙어 같이 움직인다. */
export class EditOverlay {
  readonly group = new THREE.Group();
  private points: THREE.Points;
  private lines: THREE.LineSegments;
  private faces: THREE.Mesh;

  constructor() {
    this.points = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, vertexColors: true }),
    );
    this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true }));
    this.faces = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: COLOR_SELECTED,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.group.add(this.faces, this.lines, this.points);
    // 선택 표시는 클릭 판정에 걸리지 않게 한다.
    this.group.traverse((o) => (o.raycast = () => {}));
  }

  update(mesh: PolyMesh, sel: EditSelection) {
    const verts = selectedVertices(mesh, sel);

    // 점: 점 모드일 때만 크게 보이고, 다른 모드에서는 작게
    const pointColors: number[] = [];
    mesh.vertices.forEach((_, i) => pointColors.push(...(verts.has(i) ? COLOR_SELECTED : COLOR_NORMAL).toArray()));
    setAttributes(this.points.geometry, mesh.vertices.flat(), pointColors);
    (this.points.material as THREE.PointsMaterial).size = sel.mode === "vertex" ? 7 : 3;

    // 선
    const linePositions: number[] = [];
    const lineColors: number[] = [];
    for (const [a, b] of meshEdges(mesh)) {
      const selected =
        sel.mode === "edge" ? sel.edges.has(edgeKey(a, b)) : sel.mode === "vertex" ? verts.has(a) && verts.has(b) : false;
      linePositions.push(...mesh.vertices[a], ...mesh.vertices[b]);
      const color = (selected ? COLOR_SELECTED : COLOR_EDGE).toArray();
      lineColors.push(...color, ...color);
    }
    if (sel.mode === "face") {
      // 고른 면의 테두리도 밝게
      for (const f of sel.faces) {
        const face = mesh.faces[f];
        face?.forEach((a, i) => {
          linePositions.push(...mesh.vertices[a], ...mesh.vertices[face[(i + 1) % face.length]]);
          lineColors.push(...COLOR_SELECTED.toArray(), ...COLOR_SELECTED.toArray());
        });
      }
    }
    setAttributes(this.lines.geometry, linePositions, lineColors);

    // 고른 면 (면 모드일 때만 칠한다)
    const facePositions: number[] = [];
    if (sel.mode === "face") {
      for (const f of sel.faces) {
        const face = mesh.faces[f];
        if (!face) continue;
        for (let i = 1; i < face.length - 1; i++) {
          facePositions.push(...mesh.vertices[face[0]], ...mesh.vertices[face[i]], ...mesh.vertices[face[i + 1]]);
        }
      }
    }
    setAttributes(this.faces.geometry, facePositions);
  }

  dispose() {
    for (const o of [this.points, this.lines, this.faces]) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
    this.group.removeFromParent();
  }
}

function setAttributes(geometry: THREE.BufferGeometry, positions: number[], colors?: number[]) {
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  if (colors) geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
}
