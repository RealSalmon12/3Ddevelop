import * as THREE from "three";

export type ViewName = "front" | "back" | "right" | "left" | "top" | "bottom";

const SIZE = 84;
const R = 30;
const AXES: { label: string; dir: THREE.Vector3; color: string; view: ViewName; opposite: ViewName }[] = [
  { label: "X", dir: new THREE.Vector3(1, 0, 0), color: "#e5646a", view: "right", opposite: "left" },
  { label: "Y", dir: new THREE.Vector3(0, 1, 0), color: "#7ccf5a", view: "top", opposite: "bottom" },
  { label: "Z", dir: new THREE.Vector3(0, 0, 1), color: "#5b8de8", view: "front", opposite: "back" },
];

/**
 * 오른쪽 위의 방향 표시 (블렌더의 내비게이션 기즈모). 지금 어느 쪽에서 보고 있는지 보여 주고,
 * 공을 클릭하면 그 방향에서 똑바로 본다. 가운데를 끌면 화면이 돌아간다.
 */
export class NavGizmo {
  readonly element: HTMLDivElement;
  private svg: SVGSVGElement;
  private last = new THREE.Quaternion(NaN, NaN, NaN, NaN);
  private drag: { x: number; y: number } | null = null;

  constructor(
    container: HTMLElement,
    private onView: (view: ViewName) => void,
    private onOrbit: (dx: number, dy: number) => void,
  ) {
    this.element = document.createElement("div");
    this.element.className = "nav-gizmo";
    this.element.title = "공을 누르면 그쪽에서 봐요 · 끌면 돌려 봐요";
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.setAttribute("viewBox", `${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`);
    this.svg.setAttribute("width", String(SIZE));
    this.svg.setAttribute("height", String(SIZE));
    this.element.appendChild(this.svg);
    container.appendChild(this.element);

    this.element.addEventListener("pointerdown", (e) => {
      if ((e.target as Element).closest("[data-view]")) return;
      this.drag = { x: e.clientX, y: e.clientY };
      this.element.setPointerCapture(e.pointerId);
    });
    this.element.addEventListener("pointermove", (e) => {
      if (!this.drag) return;
      this.onOrbit(e.clientX - this.drag.x, e.clientY - this.drag.y);
      this.drag = { x: e.clientX, y: e.clientY };
    });
    this.element.addEventListener("pointerup", () => (this.drag = null));
    this.element.addEventListener("click", (e) => {
      const view = (e.target as Element).closest("[data-view]")?.getAttribute("data-view");
      if (view) this.onView(view as ViewName);
    });
  }

  update(camera: THREE.Camera) {
    if (camera.quaternion.equals(this.last)) return;
    this.last.copy(camera.quaternion);
    const inverse = camera.quaternion.clone().invert();

    const balls = AXES.flatMap((a) => {
      const v = a.dir.clone().applyQuaternion(inverse);
      return [
        { ...a, x: v.x * R, y: -v.y * R, z: v.z, positive: true, view: a.view },
        { ...a, x: -v.x * R, y: v.y * R, z: -v.z, positive: false, view: a.opposite },
      ];
    });
    // 뒤에 있는 것부터 그려야 앞의 공이 위에 온다.
    balls.sort((a, b) => a.z - b.z);

    const parts = [`<circle r="${SIZE / 2 - 2}" class="nav-gizmo-bg"/>`];
    for (const b of balls) {
      if (b.positive) parts.push(`<line x1="0" y1="0" x2="${b.x}" y2="${b.y}" stroke="${b.color}" stroke-width="2.5"/>`);
      const title = { front: "앞", back: "뒤", right: "오른쪽", left: "왼쪽", top: "위", bottom: "아래" }[b.view];
      parts.push(
        `<g data-view="${b.view}" class="nav-gizmo-ball"><title>${title}에서 보기</title>` +
          (b.positive
            ? `<circle cx="${b.x}" cy="${b.y}" r="9" fill="${b.color}"/><text x="${b.x}" y="${b.y}" dy="0.35em">${b.label}</text>`
            : `<circle cx="${b.x}" cy="${b.y}" r="7" fill="${b.color}" fill-opacity="0.28" stroke="${b.color}" stroke-width="1.5"/>`) +
          "</g>",
      );
    }
    this.svg.innerHTML = parts.join("");
  }

  dispose() {
    this.element.remove();
  }
}
