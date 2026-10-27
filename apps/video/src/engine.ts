import {
  activeClips,
  clipEnd,
  evalParam,
  fadeFactor,
  fileUrl,
  projectDuration,
  sourceTime,
  type Clip,
  type Project,
} from "./model";

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
    for (const c of this.project.clips) {
      if (c.kind !== "video" || this.time < c.start || this.time >= clipEnd(c)) continue;
      const el = this.elementFor(c) as HTMLVideoElement | null;
      if (el && Math.abs(el.currentTime - sourceTime(c, this.time)) > 0.02) el.currentTime = sourceTime(c, this.time);
    }
    this.draw();
    this.onTime(this.time, false);
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
    for (const c of activeClips(this.project, this.time, "visual")) this.drawClip(ctx, c, scale);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** 클립 하나를 시퀀스 좌표(가운데가 0,0)로 그린다. */
  private drawClip(ctx: CanvasRenderingContext2D, c: Clip, scale: number) {
    const { width, height } = this.project.sequence;
    const local = this.time - c.start;
    const opacity = (evalParam(c.params.opacity, local) / 100) * fadeFactor(c, this.time);
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

    const color = c.color;
    const graded = color.temperature || color.tint || color.vignette;
    const filter = [
      color.exposure && `brightness(${1 + color.exposure / 100})`,
      color.contrast && `contrast(${1 + color.contrast / 100})`,
      color.saturation && `saturate(${1 + color.saturation / 100})`,
      color.blur && `blur(${color.blur * scale}px)`,
    ]
      .filter(Boolean)
      .join(" ");

    // 색 온도, 비네트는 클립 모양에만 입혀야 해서 따로 그린 뒤 합친다.
    const layer = graded ? this.prepareScratch(width * scale, height * scale) : null;
    const target = layer ?? ctx;
    target.save();
    if (layer) target.setTransform(scale, 0, 0, scale, 0, 0);
    target.globalAlpha = layer ? 1 : opacity;
    target.filter = filter || "none";
    target.translate(width / 2 + evalParam(c.params.x, local), height / 2 + evalParam(c.params.y, local));
    target.rotate((evalParam(c.params.rotation, local) * Math.PI) / 180);
    const s = evalParam(c.params.scale, local) / 100;
    target.scale(s, s);

    if (source && sw && sh) {
      // 화면 안에 다 보이게 맞춘 크기가 100%
      const fit = Math.min(width / sw, height / sh);
      target.drawImage(source, (-sw * fit) / 2, (-sh * fit) / 2, sw * fit, sh * fit);
    } else if (c.kind === "color") {
      target.fillStyle = c.fill ?? "#000";
      target.fillRect(-width / 2, -height / 2, width, height);
    } else if (c.kind === "text" && c.text) {
      drawText(target, c.text);
    }
    target.restore();

    if (layer) {
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
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = opacity;
      ctx.drawImage(layer.canvas, 0, 0);
      ctx.restore();
    }
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
    for (const c of this.project.clips) {
      if ((c.kind !== "video" && c.kind !== "audio") || t < c.start || t >= clipEnd(c)) continue;
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
