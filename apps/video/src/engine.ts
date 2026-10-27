import {
  activeClips,
  clipEnd,
  evalParam,
  fadeFactor,
  fileUrl,
  projectDuration,
  sourceTime,
  transitionsAt,
  type ChromaKey,
  type Clip,
  type ColorSettings,
  type Project,
  type TransitionKind,
} from "./model";
import { applyLut, lutTable } from "./lut";

/** 색 보정 중 캔버스 필터로 되는 것 (밝기, 대비, 채도, 흐림) */
function cssFilter(color: ColorSettings, extraBlur: number, scale: number) {
  return [
    color.exposure && `brightness(${1 + color.exposure / 100})`,
    color.contrast && `contrast(${1 + color.contrast / 100})`,
    color.saturation && `saturate(${1 + color.saturation / 100})`,
    (color.blur || extraBlur) && `blur(${(color.blur + extraBlur) * scale}px)`,
  ]
    .filter(Boolean)
    .join(" ");
}

/** 따로 그린 뒤 합쳐야 하는 보정이 있는지 */
const needsLayer = (color: ColorSettings) => !!(color.temperature || color.tint || color.vignette || (color.lut && (color.lutAmount ?? 100) > 0));

/** 전환 중인 클립이 맡은 역할: 들어오는(in) 쪽인지 나가는(out) 쪽인지, 진행률 */
interface TransitionRole {
  kind: TransitionKind;
  progress: number;
  role: "in" | "out";
}

const smooth = (u: number) => u * u * (3 - 2 * u);

type MediaEl = HTMLVideoElement | HTMLAudioElement;

export interface ExportOptions {
  mimeType: string;
  from: number;
  to: number;
  videoBitsPerSecond: number;
  /** 시퀀스 크기에 곱한다 (1 = 그대로, 0.5 = 절반) */
  scale: number;
}

/** MP4(H.264) 를 녹화할 수 있으면 먼저 쓴다. 유튜브, 디스코드, 휴대폰에서 바로 열린다. */
export function exportFormats(): { label: string; mimeType: string; ext: string }[] {
  const candidates = [
    { label: "MP4 (H.264, 어디서나 재생)", mimeType: "video/mp4;codecs=avc1.640028,mp4a.40.2", ext: "mp4" },
    { label: "MP4 (H.264, 어디서나 재생)", mimeType: "video/mp4;codecs=avc1,mp4a.40.2", ext: "mp4" },
    { label: "MP4", mimeType: "video/mp4", ext: "mp4" },
    { label: "WebM (VP9, 고화질 작은 용량)", mimeType: "video/webm;codecs=vp9,opus", ext: "webm" },
    { label: "WebM (VP8)", mimeType: "video/webm;codecs=vp8,opus", ext: "webm" },
  ];
  const ok = candidates.filter((c) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c.mimeType));
  // 같은 확장자는 가장 좋은 것 하나만
  return ok.filter((c, i) => ok.findIndex((d) => d.ext === c.ext) === i);
}

/**
 * 프로그램 모니터: 시간 t 의 화면을 그리고, 재생하고, 내보낸다.
 * 클립마다 숨은 <video>/<audio> 를 하나씩 두고, 소리는 모두 AudioContext 를 거쳐 나가서 녹화에도 들어간다.
 */
export class Engine {
  private ctx: CanvasRenderingContext2D;
  private scratch = document.createElement("canvas");
  private keyCanvas = document.createElement("canvas");
  private elements = new Map<string, MediaEl>();
  private images = new Map<string, HTMLImageElement>();
  private gains = new Map<MediaEl, GainNode>();
  private audio: AudioContext | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private recordDest: MediaStreamAudioDestinationNode | null = null;
  private raf = 0;
  private playing: { from: number; begin: number; until: number; rate: number } | null = null;
  private drawQueued = false;
  project: Project;
  time = 0;
  /** 재생 화질: 1 전체, 0.5 절반, 0.25 1/4 (무거운 영상도 끊기지 않게) */
  previewScale = 0.5;
  /** 선택한 클립 테두리 표시 */
  highlight: string | null = null;
  onTime: (t: number, playing: boolean) => void = () => {};
  onEnded?: () => void;

  constructor(
    private canvas: HTMLCanvasElement,
    project: Project,
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.project = project;
  }

  // ---------- 소리 ----------

  private ensureAudio() {
    if (!this.audio) {
      this.audio = new AudioContext();
      this.master = this.audio.createGain();
      this.analyser = this.audio.createAnalyser();
      this.analyser.fftSize = 1024;
      this.master.connect(this.analyser);
      this.master.connect(this.audio.destination);
    }
    return this.audio;
  }

  private gainFor(el: MediaEl) {
    const ac = this.ensureAudio();
    let g = this.gains.get(el);
    if (!g) {
      g = ac.createGain();
      ac.createMediaElementSource(el).connect(g);
      g.connect(this.master!);
      this.gains.set(el, g);
    }
    return g;
  }

  /** 지금 소리 크기 (0~1). 오디오 미터에 쓴다. */
  level(): number {
    if (!this.analyser || !this.playing) return 0;
    const data = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v));
    return Math.min(1, peak);
  }

  // ---------- 미디어 ----------

  private elementFor(c: Clip): MediaEl | null {
    if (c.kind !== "video" && c.kind !== "audio") return null;
    let el = this.elements.get(c.id);
    const media = this.project.media.find((m) => m.id === c.mediaId);
    if (!media) return null;
    const url = fileUrl(media.path);
    if (!el || el.dataset.url !== url) {
      el?.pause();
      el = document.createElement(c.kind);
      el.dataset.url = url;
      el.preload = "auto";
      el.src = url;
      if (el instanceof HTMLVideoElement) el.playsInline = true;
      el.addEventListener("seeked", () => this.requestDraw());
      el.addEventListener("loadeddata", () => this.requestDraw());
      this.elements.set(c.id, el);
    }
    return el;
  }

  private imageFor(mediaId: string): HTMLImageElement | null {
    const media = this.project.media.find((m) => m.id === mediaId);
    if (!media) return null;
    let img = this.images.get(mediaId);
    if (!img) {
      img = new Image();
      img.onload = () => this.requestDraw();
      img.src = fileUrl(media.path);
      this.images.set(mediaId, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  }

  setProject(p: Project) {
    this.project = p;
    // 지운 클립의 숨은 영상은 정리한다.
    const ids = new Set(p.clips.map((c) => c.id));
    for (const [id, el] of this.elements) {
      if (!ids.has(id)) {
        el.pause();
        this.elements.delete(id);
      }
    }
    if (!this.playing) this.seek(this.time);
  }

  // ---------- 그리기 ----------

  private requestDraw() {
    if (this.playing || this.drawQueued) return;
    this.drawQueued = true;
    requestAnimationFrame(() => {
      this.drawQueued = false;
      this.draw();
    });
  }

  /** 멈춘 상태에서 t 로 가서 그린다 */
  seek(t: number) {
    this.time = Math.max(0, t);
    for (const c of this.liveClips(this.time)) {
      if (c.kind !== "video") continue;
      const el = this.elementFor(c) as HTMLVideoElement | null;
      if (el && Math.abs(el.currentTime - sourceTime(c, this.time)) > 0.02) el.currentTime = sourceTime(c, this.time);
    }
    this.draw();
    this.onTime(this.time, false);
  }

  /** 시간 t 에 원본을 재생해야 하는 클립: 지금 걸친 클립과, 전환 동안 뒷부분을 이어서 보여 주는 앞 클립 */
  private liveClips(t: number): Clip[] {
    const live = this.project.clips.filter((c) => t >= c.start && t < clipEnd(c));
    for (const tr of transitionsAt(this.project, t).values()) if (tr.outgoing) live.push(tr.outgoing);
    return live;
  }

  draw(target = this.canvas, scale = this.previewScale) {
    const { width, height } = this.project.sequence;
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    if (target.width !== w || target.height !== h) {
      target.width = w;
      target.height = h;
    }
    const ctx = target === this.canvas ? this.ctx : target.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const transitions = transitionsAt(this.project, this.time);
    for (const c of activeClips(this.project, this.time, "visual")) {
      const tr = transitions.get(c.id);
      if (c.kind === "adjust") {
        this.drawAdjust(ctx, c, tr?.progress);
        continue;
      }
      if (!tr) {
        this.drawClip(ctx, c, scale);
        continue;
      }
      if (tr.outgoing && tr.outgoing.kind !== "audio") this.drawClip(ctx, tr.outgoing, scale, { kind: tr.kind, progress: tr.progress, role: "out" });
      this.drawClip(ctx, c, scale, { kind: tr.kind, progress: tr.progress, role: "in" });
      if (tr.kind === "dip-black" || tr.kind === "dip-white") {
        // 가운데에서 가장 진하게
        ctx.save();
        ctx.globalAlpha = 1 - Math.abs(tr.progress * 2 - 1);
        ctx.fillStyle = tr.kind === "dip-black" ? "#000" : "#fff";
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** 클립 하나를 시퀀스 좌표(가운데가 0,0)로 그린다. */
  private drawClip(ctx: CanvasRenderingContext2D, c: Clip, scale: number, tr?: TransitionRole) {
    const { width, height } = this.project.sequence;
    const local = this.time - c.start;
    // 전환으로 끝을 넘어 이어 보여 주는 앞 클립은 끝 직전의 페이드 값을 쓴다.
    const fadeAt = tr?.role === "out" ? Math.min(this.time, clipEnd(c) - 1e-3) : this.time;
    let opacity = (evalParam(c.params.opacity, local) / 100) * fadeFactor(c, fadeAt);

    // 전환과 글자 애니메이션이 더하는 움직임
    let dx = 0;
    let dy = 0;
    let zoom = 1;
    let blur = 0;
    let clipPath: ((t: CanvasRenderingContext2D) => void) | null = null;
    if (tr) {
      const p = tr.progress;
      const e = smooth(p);
      const inn = tr.role === "in";
      switch (tr.kind) {
        case "dissolve":
          if (inn) opacity *= p;
          break;
        case "dip-black":
        case "dip-white":
          if (inn ? p < 0.5 : p >= 0.5) return;
          break;
        case "push-left":
          dx = inn ? (1 - e) * width : -e * width;
          break;
        case "push-right":
          dx = inn ? -(1 - e) * width : e * width;
          break;
        case "slide-left":
          if (inn) dx = (1 - e) * width;
          break;
        case "wipe-left":
          if (inn) clipPath = (t) => t.rect(width * (1 - e), 0, width * e + 1, height);
          break;
        case "wipe-right":
          if (inn) clipPath = (t) => t.rect(0, 0, width * e, height);
          break;
        case "iris":
          if (inn) clipPath = (t) => t.arc(width / 2, height / 2, (e * Math.hypot(width, height)) / 2 + 0.5, 0, Math.PI * 2);
          break;
        case "zoom":
          if (inn) {
            zoom = 1.5 - 0.5 * e;
            opacity *= p;
          } else zoom = 1 + 0.8 * e;
          break;
        case "blur":
          if (inn) {
            opacity *= p;
            blur = (1 - e) * 30;
          } else blur = e * 30;
          break;
      }
    }
    let textStyle = c.text;
    if (c.kind === "text" && c.text && c.textAnim && c.textAnim !== "none") {
      const anim = textAnimation(c.textAnim, local, c.text.text, width);
      dx += anim.dx;
      dy += anim.dy;
      zoom *= anim.scale;
      opacity *= anim.alpha;
      textStyle = { ...c.text, text: anim.text };
    }
    if (opacity <= 0.001) return;

    let source: CanvasImageSource | null = null;
    let sw = 0;
    let sh = 0;
    if (c.kind === "video") {
      const el = this.elementFor(c) as HTMLVideoElement | null;
      if (el && el.readyState >= 2) {
        source = el;
        sw = el.videoWidth;
        sh = el.videoHeight;
      }
    } else if (c.kind === "image" && c.mediaId) {
      const img = this.imageFor(c.mediaId);
      if (img) {
        source = img;
        sw = img.naturalWidth;
        sh = img.naturalHeight;
      }
    }

    const s = (evalParam(c.params.scale, local) / 100) * zoom;
    const fit = sw && sh ? Math.min(width / sw, height / sh) : 1;
    // 크로마 키: 화면에 보일 크기로 줄여서 초록을 지운 사본을 쓴다.
    let drawSource: CanvasImageSource | null = source;
    let srcW = sw;
    let srcH = sh;
    if (source && sw && sh && c.key?.on) {
      const k = this.keyed(source, sw, sh, c.key, Math.min(1, fit * s * scale));
      drawSource = k;
      srcW = k.width;
      srcH = k.height;
    }

    const color = c.color;
    const graded = needsLayer(color);
    const filter = cssFilter(color, blur, scale);
    const blend = c.blend ?? "source-over";

    // 색 온도, 비네트는 클립 모양에만 입혀야 해서 따로 그린 뒤 합친다.
    const layer = graded ? this.prepareScratch(width * scale, height * scale) : null;
    const target = layer ?? ctx;
    target.save();
    if (layer) target.setTransform(scale, 0, 0, scale, 0, 0);
    if (clipPath) {
      target.beginPath();
      clipPath(target);
      target.clip();
    }
    target.globalAlpha = layer ? 1 : opacity;
    if (!layer) target.globalCompositeOperation = blend;
    target.filter = filter || "none";
    target.translate(width / 2 + evalParam(c.params.x, local) + dx, height / 2 + evalParam(c.params.y, local) + dy);
    target.rotate((evalParam(c.params.rotation, local) * Math.PI) / 180);
    target.scale(s, s);

    const crop = c.crop ?? { left: 0, right: 0, top: 0, bottom: 0 };
    const cl = crop.left / 100;
    const cr = crop.right / 100;
    const ct = crop.top / 100;
    const cb = crop.bottom / 100;
    if (drawSource && sw && sh) {
      // 화면 안에 다 보이게 맞춘 크기가 100%
      const w = sw * fit;
      const h = sh * fit;
      const kw = 1 - cl - cr;
      const kh = 1 - ct - cb;
      if (kw > 0 && kh > 0) target.drawImage(drawSource, srcW * cl, srcH * ct, srcW * kw, srcH * kh, -w / 2 + w * cl, -h / 2 + h * ct, w * kw, h * kh);
    } else if (c.kind === "color") {
      target.fillStyle = c.fill ?? "#000";
      target.fillRect(-width / 2 + width * cl, -height / 2 + height * ct, width * (1 - cl - cr), height * (1 - ct - cb));
    } else if (c.kind === "text" && textStyle) {
      drawText(target, textStyle);
    }
    target.restore();

    if (layer) {
      this.grade(layer, color);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = opacity;
      ctx.globalCompositeOperation = blend;
      ctx.drawImage(layer.canvas, 0, 0);
      ctx.restore();
    }
  }

  /** 조정 레이어: 지금까지 그린 화면 전체(아래 트랙)에 색 보정을 입힌다. 크롭으로 일부만 보정할 수도 있다. */
  private drawAdjust(ctx: CanvasRenderingContext2D, c: Clip, progress?: number) {
    const local = this.time - c.start;
    let opacity = (evalParam(c.params.opacity, local) / 100) * fadeFactor(c, this.time);
    if (progress !== undefined) opacity *= progress;
    if (opacity <= 0.001) return;
    const canvas = ctx.canvas;
    const lw = canvas.width;
    const lh = canvas.height;
    const layer = this.prepareScratch(lw, lh);
    layer.filter = cssFilter(c.color, 0, lw / this.project.sequence.width) || "none";
    layer.drawImage(canvas, 0, 0);
    layer.filter = "none";
    this.grade(layer, c.color);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (c.crop) {
      const { left, right, top, bottom } = c.crop;
      ctx.beginPath();
      ctx.rect((lw * left) / 100, (lh * top) / 100, (lw * (100 - left - right)) / 100, (lh * (100 - top - bottom)) / 100);
      ctx.clip();
    }
    ctx.globalAlpha = opacity;
    ctx.globalCompositeOperation = c.blend ?? "source-over";
    ctx.drawImage(layer.canvas, 0, 0);
    ctx.restore();
  }

  /** 색온도, 색조, 비네트, LUT: 이미 그린 모양(투명하지 않은 곳)에만 입힌다 */
  private grade(layer: CanvasRenderingContext2D, color: ColorSettings) {
    const lw = layer.canvas.width;
    const lh = layer.canvas.height;
    layer.save();
    layer.setTransform(1, 0, 0, 1, 0, 0);
    layer.globalCompositeOperation = "source-atop";
    if (color.temperature) {
      layer.fillStyle = color.temperature > 0 ? `rgba(255,140,30,${(color.temperature / 100) * 0.22})` : `rgba(40,130,255,${(-color.temperature / 100) * 0.22})`;
      layer.fillRect(0, 0, lw, lh);
    }
    if (color.tint) {
      layer.fillStyle = color.tint > 0 ? `rgba(255,60,200,${(color.tint / 100) * 0.15})` : `rgba(60,255,120,${(-color.tint / 100) * 0.15})`;
      layer.fillRect(0, 0, lw, lh);
    }
    if (color.vignette) {
      const g = layer.createRadialGradient(lw / 2, lh / 2, Math.min(lw, lh) * 0.3, lw / 2, lh / 2, Math.hypot(lw, lh) / 2);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, `rgba(0,0,0,${(color.vignette / 100) * 0.85})`);
      layer.fillStyle = g;
      layer.fillRect(0, 0, lw, lh);
    }
    layer.restore();
    const amount = (color.lutAmount ?? 100) / 100;
    const lut = color.lut && amount > 0 ? lutTable(color.lut, this.project.luts) : null;
    if (lut) {
      const img = layer.getImageData(0, 0, lw, lh);
      applyLut(img.data, lut, amount);
      layer.putImageData(img, 0, 0);
    }
  }

  /** 크로마 키: 고른 색과 색감(Cb, Cr)이 가까운 칸을 투명하게, 가장자리에 남은 초록(파랑)은 줄인다. */
  private keyed(source: CanvasImageSource, sw: number, sh: number, key: ChromaKey, k: number): HTMLCanvasElement {
    const canvas = this.keyCanvas;
    const w = Math.max(1, Math.round(sw * k));
    const h = Math.max(1, Math.round(sh * k));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(source, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const kr = parseInt(key.color.slice(1, 3), 16);
    const kg = parseInt(key.color.slice(3, 5), 16);
    const kb = parseInt(key.color.slice(5, 7), 16);
    const kCb = -0.168736 * kr - 0.331264 * kg + 0.5 * kb;
    const kCr = 0.5 * kr - 0.418688 * kg - 0.081312 * kb;
    const lo = (key.similarity / 100) * 0.6 * 128;
    const hi = lo + ((key.smoothness / 100) * 0.5 + 0.01) * 128;
    const spill = key.spill / 100;
    const greenKey = kg >= kb;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      const cb = -0.168736 * r - 0.331264 * g + 0.5 * b - kCb;
      const cr = 0.5 * r - 0.418688 * g - 0.081312 * b - kCr;
      const dist = Math.sqrt(cb * cb + cr * cr);
      if (dist <= lo) {
        d[i + 3] = 0;
        continue;
      }
      if (dist < hi) d[i + 3] = Math.round(d[i + 3] * ((dist - lo) / (hi - lo)));
      if (spill > 0) {
        if (greenKey) {
          const limit = Math.max(r, b);
          if (g > limit) d[i + 1] = g - (g - limit) * spill;
        } else {
          const limit = Math.max(r, g);
          if (b > limit) d[i + 2] = b - (b - limit) * spill;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  private prepareScratch(w: number, h: number) {
    const canvas = this.scratch;
    if (canvas.width !== Math.round(w) || canvas.height !== Math.round(h)) {
      canvas.width = Math.round(w);
      canvas.height = Math.round(h);
    }
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return ctx;
  }

  /** 지금 화면을 전체 화질 PNG 로 */
  async snapshot(): Promise<Blob> {
    const canvas = document.createElement("canvas");
    this.draw(canvas, 1);
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
  }

  // ---------- 재생 ----------

  get isPlaying() {
    return !!this.playing;
  }

  /** rate: J/K/L 처럼 빠르게 (1, 2, 4) 재생. 뒤로 재생은 지원하지 않는다. */
  play(from = this.time, until = projectDuration(this.project), rate = 1) {
    this.stop();
    if (until - from < 0.05) from = 0;
    if (until <= 0) return;
    void this.ensureAudio().resume();
    this.playing = { from, begin: performance.now(), until, rate };
    const tick = () => {
      if (!this.playing) return;
      const t = this.playing.from + ((performance.now() - this.playing.begin) / 1000) * this.playing.rate;
      if (t >= this.playing.until) {
        this.time = this.playing.until;
        this.stop();
        this.draw();
        this.onTime(this.time, false);
        this.onEnded?.();
        return;
      }
      this.time = t;
      this.syncMedia(t, this.playing.rate);
      this.draw();
      this.onTime(t, true);
      this.raf = requestAnimationFrame(tick);
    };
    this.syncMedia(from, rate);
    this.raf = requestAnimationFrame(tick);
  }

  /** 지금 나와야 하는 영상, 소리를 재생 위치에 맞춰 틀고, 나머지는 멈춘다. */
  private syncMedia(t: number, rate: number) {
    const audible = new Set(activeClips(this.project, t, "audible").map((c) => c.id));
    const live = new Set<string>();
    for (const c of this.liveClips(t)) {
      if (c.kind !== "video" && c.kind !== "audio") continue;
      const el = this.elementFor(c);
      if (!el) continue;
      live.add(c.id);
      const want = sourceTime(c, t);
      el.playbackRate = Math.min(16, c.speed * rate);
      const g = this.gainFor(el);
      g.gain.value = audible.has(c.id) ? (evalParam(c.params.volume, t - c.start) / 100) * fadeFactor(c, t) : 0;
      if (el.paused) {
        el.currentTime = want;
        void el.play().catch(() => {});
      } else if (Math.abs(el.currentTime - want) > 0.3) {
        el.currentTime = want;
      }
    }
    for (const [id, el] of this.elements) if (!live.has(id) && !el.paused) el.pause();
  }

  stop() {
    cancelAnimationFrame(this.raf);
    if (!this.playing) return;
    this.playing = null;
    for (const el of this.elements.values()) el.pause();
    this.onTime(this.time, false);
  }

  /** 범위를 처음부터 끝까지 재생하면서 녹화한다 (실제 길이만큼 걸린다). */
  async record(options: ExportOptions, onProgress: (ratio: number) => void, signal: { cancel: boolean }): Promise<Blob | null> {
    const ac = this.ensureAudio();
    this.recordDest ??= ac.createMediaStreamDestination();
    this.master!.connect(this.recordDest);
    const savedScale = this.previewScale;
    this.previewScale = options.scale;
    const stream = new MediaStream([
      ...this.canvas.captureStream(this.project.sequence.fps).getVideoTracks(),
      ...this.recordDest.stream.getAudioTracks(),
    ]);
    const rec = new MediaRecorder(stream, { mimeType: options.mimeType, videoBitsPerSecond: options.videoBitsPerSecond, audioBitsPerSecond: 192_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<Blob>((resolve) => (rec.onstop = () => resolve(new Blob(chunks, { type: options.mimeType.split(";")[0] }))));
    const prevTime = this.onTime;
    const span = Math.max(0.1, options.to - options.from);
    this.onTime = (t, playing) => {
      prevTime(t, playing);
      onProgress(Math.min(1, (t - options.from) / span));
      if (signal.cancel && playing) this.stop();
    };
    this.onEnded = () => rec.state !== "inactive" && rec.stop();
    // 첫 화면과 영상을 미리 준비해 둔다.
    this.seek(options.from);
    await new Promise((r) => setTimeout(r, 400));
    rec.start(500);
    this.play(options.from, options.to);
    const watcher = setInterval(() => {
      if (!this.playing && rec.state !== "inactive") rec.stop();
    }, 200);
    const blob = await done;
    clearInterval(watcher);
    this.master!.disconnect(this.recordDest);
    this.onTime = prevTime;
    this.onEnded = undefined;
    this.previewScale = savedScale;
    this.seek(this.time);
    return signal.cancel ? null : blob;
  }

  dispose() {
    this.stop();
    for (const el of this.elements.values()) el.src = "";
    void this.audio?.close();
  }
}

/** 글자 등장 애니메이션: 클립 시작부터 local 초가 지났을 때 움직임 */
function textAnimation(kind: NonNullable<Clip["textAnim"]>, local: number, text: string, width: number) {
  const out = { dx: 0, dy: 0, scale: 1, alpha: 1, text };
  const t = Math.max(0, local);
  switch (kind) {
    case "typewriter":
      out.text = [...text].slice(0, Math.floor(t * 22)).join("");
      break;
    case "pop": {
      // 조금 커졌다가 제자리로 (back-out)
      const v = Math.min(1, t / 0.35) - 1;
      out.scale = Math.max(0.01, 1 + 2.70158 * v * v * v + 1.70158 * v * v);
      out.alpha = Math.min(1, (v + 1) * 2);
      break;
    }
    case "rise": {
      const e = smooth(Math.min(1, t / 0.5));
      out.dy = (1 - e) * 90;
      out.alpha = e;
      break;
    }
    case "slide": {
      const e = smooth(Math.min(1, t / 0.5));
      out.dx = -(1 - e) * width * 0.35;
      out.alpha = e;
      break;
    }
    case "bounce": {
      const u = Math.min(1, t / 0.9);
      out.dy = -Math.abs(Math.sin(u * Math.PI * 3)) * (1 - u) * 110;
      out.alpha = Math.min(1, u * 5);
      break;
    }
  }
  return out;
}

/** 글자 클립. 여러 줄, 테두리, 띠 배경 */
export function drawText(ctx: CanvasRenderingContext2D, t: NonNullable<Clip["text"]>) {
  ctx.font = `${t.bold ? 800 : 500} ${t.size}px "${t.font}", "Pretendard Variable", "Malgun Gothic", sans-serif`;
  ctx.textAlign = t.align;
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  const lines = t.text.split("\n");
  const lh = t.size * 1.25;
  const widths = lines.map((l) => ctx.measureText(l).width);
  const maxW = Math.max(0, ...widths);
  const anchor = t.align === "left" ? -maxW / 2 : t.align === "right" ? maxW / 2 : 0;
  lines.forEach((line, i) => {
    const y = (i - (lines.length - 1) / 2) * lh;
    if (t.box) {
      const pad = t.size * 0.25;
      const w = widths[i];
      const left = t.align === "left" ? anchor : t.align === "right" ? anchor - w : -w / 2;
      ctx.fillStyle = t.boxColor;
      ctx.fillRect(left - pad, y - lh / 2, w + pad * 2, lh);
    }
    if (t.stroke > 0) {
      ctx.lineWidth = t.stroke;
      ctx.strokeStyle = t.strokeColor;
      ctx.strokeText(line, anchor, y);
    }
    ctx.fillStyle = t.color;
    ctx.fillText(line, anchor, y);
  });
}
