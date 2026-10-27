import * as THREE from "three";
import { createGeometry, SHAPES, type ShapeKind } from "./shapes";

export interface SceneItem {
  id: string;
  name: string;
  kind: ShapeKind;
}

export interface SceneSnapshot {
  items: SceneItem[];
  selectedId: string | null;
}

const DEFAULT_COLOR = 0xb8bcc4;

/**
 * 3D 장면의 상태를 들고 있는 곳. 화면(React)은 snapshot 을 구독해서 목록과 패널을 그리고,
 * 뷰포트(three.js)는 같은 객체의 root 를 그린다.
 */
export class ModelerScene {
  readonly root = new THREE.Group();
  private meshes = new Map<string, THREE.Mesh>();
  private counters = new Map<ShapeKind, number>();
  private listeners = new Set<() => void>();
  private snapshot: SceneSnapshot = { items: [], selectedId: null };

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  private emit() {
    const items = [...this.meshes.values()].map((m) => ({
      id: m.uuid,
      name: m.name,
      kind: m.userData.kind as ShapeKind,
    }));
    this.snapshot = { items, selectedId: this.snapshot.selectedId };
    this.listeners.forEach((l) => l());
  }

  add(kind: ShapeKind, position?: THREE.Vector3Like): string {
    const n = (this.counters.get(kind) ?? 0) + 1;
    this.counters.set(kind, n);
    const label = SHAPES.find((s) => s.kind === kind)!.label;

    const mesh = new THREE.Mesh(
      createGeometry(kind),
      new THREE.MeshStandardMaterial({ color: DEFAULT_COLOR, roughness: 0.55, metalness: 0.05 }),
    );
    mesh.name = n === 1 ? label : `${label} ${n}`;
    mesh.userData.kind = kind;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // 바닥 위에 올려놓는다.
    mesh.geometry.computeBoundingBox();
    const minY = mesh.geometry.boundingBox!.min.y;
    const spot = position ?? this.findFreeSpot();
    mesh.position.set(spot.x, position?.y ?? -minY, spot.z);

    this.root.add(mesh);
    this.meshes.set(mesh.uuid, mesh);
    this.select(mesh.uuid);
    this.emit();
    return mesh.uuid;
  }

  /** 새 도형이 기존 도형 안에 숨지 않도록 가운데에서 가까운 빈자리를 찾는다. */
  private findFreeSpot(): { x: number; z: number } {
    const step = 1.5;
    const taken = (x: number, z: number) =>
      [...this.meshes.values()].some((m) => Math.hypot(m.position.x - x, m.position.z - z) < step * 0.9);
    for (let ring = 0; ring < 20; ring++) {
      for (let i = -ring; i <= ring; i++) {
        for (const [x, z] of [[i, -ring], [i, ring], [-ring, i], [ring, i]]) {
          if (!taken(x * step, z * step)) return { x: x * step, z: z * step };
        }
      }
    }
    return { x: 0, z: 0 };
  }

  remove(id: string) {
    const mesh = this.meshes.get(id);
    if (!mesh) return;
    this.root.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    this.meshes.delete(id);
    if (this.snapshot.selectedId === id) this.snapshot = { ...this.snapshot, selectedId: null };
    this.emit();
  }

  removeSelected() {
    if (this.snapshot.selectedId) this.remove(this.snapshot.selectedId);
  }

  select(id: string | null) {
    if (this.snapshot.selectedId === id) return;
    this.snapshot = { ...this.snapshot, selectedId: id };
    this.listeners.forEach((l) => l());
  }

  getMesh(id: string | null) {
    return id ? this.meshes.get(id) ?? null : null;
  }

  allMeshes() {
    return [...this.meshes.values()];
  }
}
