// 녹음용 AudioWorklet: 마이크 소리를 그대로 모으고, 미터용 최고값을 1초에 30번 보낸다.
// (화면 보안 정책상 blob 주소 스크립트를 못 읽어서 따로 파일로 둔다)
class SuiteCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = false; this.startAt = 0; this.left = -1; this.buf = null; this.fill = 0;
    this.peaks = [0, 0]; this.clip = false; this.frames = 0;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === "start") { this.on = true; this.startAt = m.at || 0; this.left = m.frames || -1; }
      if (m.type === "stop") { this.flush(); this.on = false; this.port.postMessage({ type: "stopped" }); }
    };
  }
  flush() {
    if (!this.buf || !this.fill) return;
    this.port.postMessage({ type: "data", chs: this.buf.map((b) => b.slice(0, this.fill)) });
    this.fill = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input.length) return true;
    const n = input[0].length;
    for (let c = 0; c < Math.min(2, input.length); c++) {
      const ch = input[c];
      for (let i = 0; i < n; i++) {
        const a = Math.abs(ch[i]);
        if (a > this.peaks[c]) this.peaks[c] = a;
        if (a >= 0.999) this.clip = true;
      }
    }
    if (input.length === 1) this.peaks[1] = this.peaks[0];
    this.frames += n;
    // 미터는 1초에 30번쯤
    if (this.frames >= sampleRate / 30) {
      this.port.postMessage({ type: "level", peaks: this.peaks, clip: this.clip });
      this.peaks = [0, 0]; this.clip = false; this.frames = 0;
    }
    if (!this.on || currentTime < this.startAt) return true;
    if (!this.buf) this.buf = [new Float32Array(8192), new Float32Array(8192)];
    let take = n;
    if (this.left >= 0) take = Math.min(n, this.left);
    for (let i = 0; i < take; i++) {
      this.buf[0][this.fill] = input[0][i];
      this.buf[1][this.fill] = (input[1] || input[0])[i];
      this.fill++;
      if (this.fill === 8192) this.flush();
    }
    if (this.left >= 0) {
      this.left -= take;
      if (this.left === 0) { this.flush(); this.on = false; this.port.postMessage({ type: "stopped", auto: true }); }
    }
    return true;
  }
}
registerProcessor("suite-capture", SuiteCapture);
