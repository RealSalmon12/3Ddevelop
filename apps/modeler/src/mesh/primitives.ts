import type { PolyMesh, Vec3 } from "./PolyMesh";

const TAU = Math.PI * 2;

export function cubeMesh(size = 1): PolyMesh {
  const h = size / 2;
  const vertices: Vec3[] = [
    [-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h],
    [-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h],
  ];
  const faces = [
    [4, 5, 6, 7], // 앞 (+z)
    [1, 0, 3, 2], // 뒤 (-z)
    [5, 1, 2, 6], // 오른쪽 (+x)
    [0, 4, 7, 3], // 왼쪽 (-x)
    [7, 6, 2, 3], // 위 (+y)
    [0, 1, 5, 4], // 아래 (-y)
  ];
  return { vertices, faces };
}

export function planeMesh(size = 2): PolyMesh {
  const h = size / 2;
  return {
    vertices: [[-h, 0, h], [h, 0, h], [h, 0, -h], [-h, 0, -h]],
    faces: [[0, 1, 2, 3]],
  };
}

/** y 높이에 놓인 원 둘레의 점들 (위에서 보면 반시계) */
function ring(radius: number, y: number, segments: number): Vec3[] {
  return Array.from({ length: segments }, (_, i) => {
    const a = (i / segments) * TAU;
    return [Math.cos(a) * radius, y, -Math.sin(a) * radius] as Vec3;
  });
}

export function cylinderMesh(radius = 0.5, height = 1, segments = 24): PolyMesh {
  const vertices = [...ring(radius, -height / 2, segments), ...ring(radius, height / 2, segments)];
  const faces: number[][] = [];
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    faces.push([i, j, segments + j, segments + i]);
  }
  faces.push(Array.from({ length: segments }, (_, i) => segments + i)); // 위
  faces.push(Array.from({ length: segments }, (_, i) => segments - 1 - i)); // 아래
  return { vertices, faces };
}

export function coneMesh(radius = 0.5, height = 1, segments = 24): PolyMesh {
  const vertices: Vec3[] = [...ring(radius, -height / 2, segments), [0, height / 2, 0]];
  const apex = segments;
  const faces: number[][] = [];
  for (let i = 0; i < segments; i++) faces.push([i, (i + 1) % segments, apex]);
  faces.push(Array.from({ length: segments }, (_, i) => segments - 1 - i));
  return { vertices, faces };
}

export function sphereMesh(radius = 0.5, segments = 24, rings = 12): PolyMesh {
  const vertices: Vec3[] = [[0, radius, 0]];
  for (let r = 1; r < rings; r++) {
    const phi = (r / rings) * Math.PI;
    vertices.push(...ring(Math.sin(phi) * radius, Math.cos(phi) * radius, segments));
  }
  vertices.push([0, -radius, 0]);
  const top = 0;
  const bottom = vertices.length - 1;
  const at = (r: number, i: number) => 1 + (r - 1) * segments + (i % segments);

  const faces: number[][] = [];
  for (let i = 0; i < segments; i++) faces.push([top, at(1, i), at(1, i + 1)]);
  for (let r = 1; r < rings - 1; r++) {
    for (let i = 0; i < segments; i++) faces.push([at(r, i), at(r + 1, i), at(r + 1, i + 1), at(r, i + 1)]);
  }
  for (let i = 0; i < segments; i++) faces.push([bottom, at(rings - 1, i + 1), at(rings - 1, i)]);
  return { vertices, faces };
}

export function torusMesh(radius = 0.4, tube = 0.15, segments = 32, sides = 12): PolyMesh {
  const vertices: Vec3[] = [];
  for (let i = 0; i < segments; i++) {
    const u = (i / segments) * TAU;
    for (let j = 0; j < sides; j++) {
      const v = (j / sides) * TAU;
      const r = radius + Math.cos(v) * tube;
      // 도넛은 서 있는 모양 (xy 평면)
      vertices.push([Math.cos(u) * r, Math.sin(u) * r, Math.sin(v) * tube]);
    }
  }
  const at = (i: number, j: number) => (i % segments) * sides + (j % sides);
  const faces: number[][] = [];
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < sides; j++) faces.push([at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]);
  }
  return { vertices, faces };
}
