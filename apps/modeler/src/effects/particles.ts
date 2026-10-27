import * as THREE from "three";

export type EffectType = "smoke" | "sparkle" | "fire" | "snow" | "magic" | "bubbles";

export interface EffectSettings {
  type: EffectType;
  /** 입자 양 배율 (0.2 ~ 3) */
  amount: number;
  /** 움직이는 빠르기 배율 (0.2 ~ 3) */
  speed: number;
}

export const EFFECTS: { type: EffectType; label: string; color: string; hint: string }[] = [
  { type: "smoke", label: "연기", color: "#9aa0a8", hint: "천천히 피어오르는 연기" },
  { type: "sparkle", label: "반짝이", color: "#fff2a8", hint: "주변에서 반짝이는 별빛" },
  { type: "fire", label: "불꽃", color: "#ff7a1a", hint: "위로 타오르는 불" },
  { type: "snow", label: "눈", color: "#ffffff", hint: "위에서 내리는 눈" },
  { type: "magic", label: "마법", color: "#a98bff", hint: "빙글빙글 올라가는 빛" },
  { type: "bubbles", label: "거품", color: "#9fe3ff", hint: "흔들리며 떠오르는 방울" },
];

interface Preset {
  count: number;
  life: number;
  size: number;
  additive: boolean;
  /** 새 입자의 처음 위치와 속도를 정한다 */
  spawn(p: THREE.Vector3, v: THREE.Vector3, rand: () => number): void;
  /** 매 프레임 움직임 (t: 0~1 나이) */
  step?(p: THREE.Vector3, v: THREE.Vector3, t: number, dt: number, seed: number): void;
  /** 나이에 따른 크기 배율과 투명도 */
  shape(t: number, seed: number, time: number): { size: number; alpha: number };
}

const disc = (r: number, rand: () => number) => {
  const a = rand() * Math.PI * 2;
  const d = Math.sqrt(rand()) * r;
  return [Math.cos(a) * d, Math.sin(a) * d] as const;
};

const PRESETS: Record<EffectType, Preset> = {
  smoke: {
    count: 70,
    life: 4,
    size: 0.9,
    additive: false,
    spawn(p, v, rand) {
      const [x, z] = disc(0.2, rand);
      p.set(x, 0, z);
      v.set((rand() - 0.5) * 0.15, 0.35 + rand() * 0.2, (rand() - 0.5) * 0.15);
    },
    step(_p, v, _t, dt) {
      v.x += 0.04 * dt; // 바람에 살짝 밀린다
    },
    shape: (t) => ({ size: 0.4 + t * 1.6, alpha: Math.sin(Math.PI * t) * 0.45 }),
  },
  sparkle: {
    count: 50,
    life: 1.8,
    size: 0.18,
    additive: true,
    spawn(p, v, rand) {
      p.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(1.6);
      v.set(0, 0.05, 0);
    },
    shape: (t, seed, time) => ({
      size: Math.sin(Math.PI * t) * (0.7 + 0.3 * Math.sin(time * 18 + seed * 40)),
      alpha: Math.sin(Math.PI * t),
    }),
  },
  fire: {
    count: 90,
    life: 0.9,
    size: 0.5,
    additive: true,
    spawn(p, v, rand) {
      const [x, z] = disc(0.22, rand);
      p.set(x, 0, z);
      v.set(-x * 0.6, 0.9 + rand() * 0.6, -z * 0.6);
    },
    shape: (t) => ({ size: 1 - t * 0.8, alpha: (1 - t) * 0.9 }),
  },
  snow: {
    count: 120,
    life: 5,
    size: 0.08,
    additive: false,
    spawn(p, v, rand) {
      p.set((rand() - 0.5) * 3, 2, (rand() - 0.5) * 3);
      v.set(0, -0.45 - rand() * 0.2, 0);
    },
    step(p, _v, t, dt, seed) {
      p.x += Math.sin(t * 9 + seed * 20) * 0.15 * dt;
    },
    shape: (t) => ({ size: 1, alpha: Math.min(1, t * 6, (1 - t) * 6) }),
  },
  magic: {
    count: 80,
    life: 2.4,
    size: 0.16,
    additive: true,
    spawn(p, v) {
      p.set(0, 0, 0);
      v.set(0, 0.45, 0);
    },
    step(p, v, t, _dt, seed) {
      const a = seed * Math.PI * 2 + t * 7;
      const r = 0.25 + t * 0.45;
      p.x = Math.cos(a) * r;
      p.z = Math.sin(a) * r;
      v.y = 0.45;
    },
    shape: (t) => ({ size: 1 - t * 0.5, alpha: Math.sin(Math.PI * t) }),
  },
  bubbles: {
    count: 40,
    life: 3.5,
    size: 0.16,
    additive: false,
    spawn(p, v, rand) {
      const [x, z] = disc(0.35, rand);
      p.set(x, 0, z);
      v.set(0, 0.3 + rand() * 0.25, 0);
    },
    step(p, _v, t, dt, seed) {
      p.x += Math.sin(t * 12 + seed * 30) * 0.12 * dt;
    },
    shape: (t, seed) => ({ size: 0.6 + seed * 0.8, alpha: Math.min(1, t * 5) * (t > 0.95 ? 0 : 0.8) }),
  },
};

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  varying float vAlpha;
  uniform float uScale;
  void main() {
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // 오브젝트 크기를 키우면 입자도 같이 커진다
    gl_PointSize = aSize * uScale * length(modelMatrix[0].xyz) / -mv.z;
  }
`;

// 비누방울은 테두리만, 나머지는 가운데가 밝은 부드러운 점
const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uRing;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float soft = pow(1.0 - d, 1.6);
    float ring = smoothstep(0.65, 0.9, d) * (1.0 - smoothstep(0.9, 1.0, d)) + soft * 0.15;
    float a = mix(soft, ring, uRing) * vAlpha;
    gl_FragColor = vec4(uColor * (1.0 + uRing * 0.3), a);
  }
`;

/** 이펙트 오브젝트에 붙어서 입자를 뿜는다. 오브젝트를 옮기고 크기를 바꾸면 같이 바뀐다. */
export class ParticleSystem {
  readonly points: THREE.Points;
  private material: THREE.ShaderMaterial;
  private preset: Preset;
  settings: EffectSettings;
  private ages: Float32Array;
  private seeds: Float32Array;
  private velocities: THREE.Vector3[];
  private positions: THREE.Vector3[];
  private time = 0;
  private rand = Math.random;

  constructor(settings: EffectSettings, color: string) {
    this.settings = settings;
    this.preset = PRESETS[settings.type];
    const max = Math.ceil(this.preset.count * 3);
    this.ages = new Float32Array(max).fill(Infinity);
    this.seeds = Float32Array.from({ length: max }, () => Math.random());
    this.velocities = Array.from({ length: max }, () => new THREE.Vector3());
    this.positions = Array.from({ length: max }, () => new THREE.Vector3());

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(max), 1));
    geometry.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(max), 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uScale: { value: 600 },
        uRing: { value: settings.type === "bubbles" ? 1 : 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: this.preset.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.raycast = () => {};
    // 처음부터 다 자란 모습으로 보이게 미리 돌려 둔다.
    for (let i = 0; i < 60; i++) this.update(this.preset.life / 60);
  }

  setColor(color: string) {
    this.material.uniforms.uColor.value.set(color);
  }

  /** 화면 높이와 카메라 화각에 맞춰 입자 크기를 맞춘다 (크기 1 = 1 미터) */
  setViewport(height: number, fovDegrees: number) {
    this.material.uniforms.uScale.value = height / (2 * Math.tan((fovDegrees * Math.PI) / 360));
  }

  update(dt: number) {
    const { preset, settings } = this;
    const step = Math.min(dt, 0.1) * settings.speed;
    this.time += step;
    const life = preset.life;
    const count = Math.min(this.ages.length, Math.max(1, Math.round(preset.count * settings.amount)));
    const rate = count / life;
    let toSpawn = rate * step + this.rand() * 0.5;

    const pos = this.points.geometry.getAttribute("position") as THREE.BufferAttribute;
    const size = this.points.geometry.getAttribute("aSize") as THREE.BufferAttribute;
    const alpha = this.points.geometry.getAttribute("aAlpha") as THREE.BufferAttribute;

    for (let i = 0; i < this.ages.length; i++) {
      if (this.ages[i] >= life) {
        if (toSpawn >= 1 && i < count) {
          toSpawn--;
          this.ages[i] = 0;
          preset.spawn(this.positions[i], this.velocities[i], this.rand);
        } else {
          alpha.setX(i, 0);
          continue;
        }
      }
      this.ages[i] += step;
      const t = Math.min(this.ages[i] / life, 1);
      const p = this.positions[i];
      p.addScaledVector(this.velocities[i], step);
      preset.step?.(p, this.velocities[i], t, step, this.seeds[i]);
      const s = preset.shape(t, this.seeds[i], this.time);
      pos.setXYZ(i, p.x, p.y, p.z);
      size.setX(i, Math.max(0, s.size) * preset.size);
      alpha.setX(i, Math.max(0, s.alpha));
    }
    pos.needsUpdate = size.needsUpdate = alpha.needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
    this.points.removeFromParent();
  }
}
