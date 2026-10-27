import { captionsAt, drawCaption } from "./captions";
import { frameSize, locate, totalLength, type Clip, type Project } from "./project";

/**
 * 미리보기와 내보내기를 맡는다. 조각마다 숨은 <video>/<img> 를 하나씩 두고,
 * 지금 시간의 화면을 캔버스에 그린다. 소리는 모두 AudioContext 를 거쳐 나가서 녹화에도 들어간다.
 */
export class Engine {
  private media = new Map<string, HTMLVideoElement | HTMLImageElement>();
  private gains = new Map<HTMLMediaElement, GainNode>();
  private audio: AudioContext | null = null;
  private recordDest: MediaStreamAudioDestinationNode | null = null;
  private musicEl: HTMLAudioElement | null = null;
  private raf = 0;
  private playing: { from: number; begin: number; current: HTMLVideoElement | null } | null = null;
  project: Project;
  time = 0;
  onTime: (t: number, playing: boolean) => void = () => {};

  constructor(
    private canvas: HTMLCanvasElement,
    project: Project,
  ) {
    this.project = project;
  }

  private ctx2d() {
    const { width, height } = frameSize(this.project);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    return this.canvas.getContext("2d")!;
  }

  private ensureAudio() {
    this.audio ??= new AudioContext();
    return this.audio;
  }

  /** 미디어 요소의 소리를 AudioContext 로 돌린다 (한 요소에 한 번만 가능) */
  private route(el: HTMLMediaElement, volume: number) {
    const ac = this.ensureAudio();
    let g = this.gains.get(el);
    if (!g) {
      g = ac.createGain();
      ac.createMediaElementSource(el).connect(g);
      g.connect(ac.destination);
      if (this.recordDest) g.connect(this.recordDest);
      this.gains.set(el, g);
    }
    g.gain.value = volume;
  }

  elementFor(clip: Clip) {
    let el = this.media.get(clip.url);
    if (!el) {
      if (clip.kind === "video") {
        const v = document.createElement("video");
        v.src = clip.url;
        v.preload = "auto";
        v.playsInline = true;
        v.addEventListener("seeked", () => !this.playing && this.draw());
        v.addEventListener("loadeddata", () => !this.playing && this.draw());
        el = v;
      } else {
        const img = new Image();
        img.onload = () => !this.playing && this.draw();
        img.src = clip.url;
        el = img;
      }
      this.media.set(clip.url, el);
    }
    return el;
  }

  setProject(p: Project) {
    this.project = p;
    if (!this.playing) this.seek(Math.min(this.time, totalLength(p)));
  }

  /** 멈춘 상태에서 t 로 가서 그린다 */
  seek(t: number) {
    this.time = Math.max(0, t);
    const at = locate(this.project, this.time);
    if (at?.clip.kind === "video") {
      const v = this.elementFor(at.clip) as HTMLVideoElement;
      if (Math.abs(v.currentTime - at.local) > 0.03) v.currentTime = at.local;
    }
    this.draw();
    this.onTime(this.time, false);
  }

  draw() {
    const ctx = this.ctx2d();
    const { width, height } = frameSize(this.project);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    const at = locate(this.project, this.time);
    if (at) {
      const el = this.elementFor(at.clip);
      const w = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
      const h = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
      if (w && h) {
        // 화면에 꽉 차지 않게, 다 보이게 (남는 곳은 검게)
        const s = Math.min(width / w, height / h);
        ctx.drawImage(el, (width - w * s) / 2, (height - h * s) / 2, w * s, h * s);
      }
    }
    for (const c of captionsAt(this.project, this.time)) drawCaption(ctx, c, width, height);
  }

  get isPlaying() {
    return !!this.playing;
  }

  play(from = this.time) {
    this.stop();
    const total = totalLength(this.project);
    if (!total) return;
    if (from >= total - 0.05) from = 0;
    const ac = this.ensureAudio();
    void ac.resume();
    this.playing = { from, begin: performance.now(), current: null };
    const music = this.project.music;
    if (music) {
      this.musicEl ??= new Audio();
      if (this.musicEl.src !== music.url) this.musicEl.src = music.url;
      this.route(this.musicEl, music.volume);
      this.musicEl.currentTime = from;
      void this.musicEl.play();
    }
    const tick = () => {
      if (!this.playing) return;
      const t = this.playing.from + (performance.now() - this.playing.begin) / 1000;
      if (t >= total) {
        this.stop();
        this.time = total;
        this.onTime(total, false);
        this.onEnded?.();
        return;
      }
      this.time = t;
      const at = locate(this.project, t)!;
      const el = this.elementFor(at.clip);
      const video = el instanceof HTMLVideoElement ? el : null;
      if (video !== this.playing.current) {
        this.playing.current?.pause();
        if (video) {
          this.route(video, at.clip.volume);
          video.currentTime = at.local;
          void video.play();
        }
        this.playing.current = video;
      } else if (video && Math.abs(video.currentTime - at.local) > 0.35) {
        // 너무 어긋나면 맞춘다
        video.currentTime = at.local;
      }
      this.draw();
      this.onTime(t, true);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  onEnded?: () => void;

  stop() {
    cancelAnimationFrame(this.raf);
    if (this.playing) {
      this.playing.current?.pause();
      this.musicEl?.pause();
      this.playing = null;
      this.onTime(this.time, false);
    }
  }

  /** 처음부터 끝까지 재생하면서 녹화한다 (실제 길이만큼 걸린다). */
  async record(onProgress: (ratio: number) => void): Promise<Blob> {
    const ac = this.ensureAudio();
    if (!this.recordDest) {
      this.recordDest = ac.createMediaStreamDestination();
      for (const g of this.gains.values()) g.connect(this.recordDest);
    }
    const stream = new MediaStream([...this.canvas.captureStream(30).getVideoTracks(), ...this.recordDest.stream.getAudioTracks()]);
    const type = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t))!;
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const total = totalLength(this.project);
    const done = new Promise<Blob>((resolve) => (rec.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }))));
    const prevTime = this.onTime;
    this.onTime = (t, playing) => {
      prevTime(t, playing);
      onProgress(Math.min(1, t / total));
    };
    this.onEnded = () => rec.stop();
    // 첫 화면을 미리 그려 둔다
    this.seek(0);
    await new Promise((r) => setTimeout(r, 300));
    rec.start(500);
    this.play(0);
    const blob = await done;
    this.onTime = prevTime;
    this.onEnded = undefined;
    return blob;
  }

  dispose() {
    this.stop();
    void this.audio?.close();
  }
}
