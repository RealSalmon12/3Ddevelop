// 사진 보정용 고급 필터: 표면 흐림(피부 매끈하게), 먼지와 스크래치(중간값), 하이 패스.
// 모두 픽셀 배열(RGBA)을 받아 새 배열을 돌려준다. 투명도는 그대로 둔다.

/** 합계 표(적분 영상): 어떤 사각형의 합이든 네 번 읽어 구한다 */
function integral(src: Float64Array, w: number, h: number) {
  const s = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += src[y * w + x];
      s[(y + 1) * (w + 1) + x + 1] = s[y * (w + 1) + x + 1] + row;
    }
  }
  return s;
}

/** 반경 r 상자 평균 (가장자리는 있는 칸만 센다) */
function boxMean(src: Float64Array, w: number, h: number, r: number) {
  const s = integral(src, w, h);
  const out = new Float64Array(w * h);
  const W = w + 1;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const sum = s[y1 * W + x1] - s[y0 * W + x1] - s[y1 * W + x0] + s[y0 * W + x0];
      out[y * w + x] = sum / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

/**
 * 표면 흐림 (포토샵 Surface Blur 와 같은 쓰임): 가장자리(눈, 입술, 머리카락 윤곽)는 살리고
 * 고른 면(피부, 하늘)만 매끈하게. 유도 필터(guided filter)라 반경이 커도 빠르다.
 * threshold: 0~255, 이보다 작은 색 차이만 뭉갠다.
 */
export function surfaceBlur(px: Uint8ClampedArray, w: number, h: number, radius: number, threshold = 24) {
  const out = new Uint8ClampedArray(px);
  const r = Math.max(1, Math.round(radius));
  const eps = threshold * threshold;
  const n = w * h;
  const I = new Float64Array(n);
  const II = new Float64Array(n);
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < n; i++) {
      const v = px[i * 4 + c];
      I[i] = v;
      II[i] = v * v;
    }
    const mean = boxMean(I, w, h, r);
    const mean2 = boxMean(II, w, h, r);
    // 칸마다 a·I + b 로 맞춘다. 분산이 크면(가장자리) a≈1 이라 그대로, 작으면(고른 면) a≈0 이라 평균으로.
    const a = new Float64Array(n);
    const b = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const variance = mean2[i] - mean[i] * mean[i];
      a[i] = variance / (variance + eps);
      b[i] = mean[i] - a[i] * mean[i];
    }
    const ma = boxMean(a, w, h, r);
    const mb = boxMean(b, w, h, r);
    for (let i = 0; i < n; i++) out[i * 4 + c] = ma[i] * I[i] + mb[i];
  }
  return out;
}

/**
 * 먼지와 스크래치 (중간값): 반경 안 색들의 가운데 값으로 바꿔 작은 점, 긁힌 자국, 노이즈를 없앤다.
 * 칸을 옮길 때 히스토그램에서 빠지는 줄과 들어오는 줄만 고쳐서 반경이 커져도 크게 느려지지 않는다.
 */
export function median(px: Uint8ClampedArray, w: number, h: number, radius: number) {
  const out = new Uint8ClampedArray(px);
  const r = Math.max(1, Math.round(radius));
  const hist = new Uint32Array(256);
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < h; y++) {
      hist.fill(0);
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(h - 1, y + r);
      let count = 0;
      const addCol = (x: number, d: 1 | -1) => {
        if (x < 0 || x >= w) return;
        for (let yy = y0; yy <= y1; yy++) hist[px[(yy * w + x) * 4 + c]] += d;
        count += d * (y1 - y0 + 1);
      };
      for (let x = -r; x <= r; x++) addCol(x, 1);
      for (let x = 0; x < w; x++) {
        if (x > 0) {
          addCol(x - r - 1, -1);
          addCol(x + r, 1);
        }
        const half = count >> 1;
        let acc = 0;
        let v = 0;
        for (; v < 255; v++) {
          acc += hist[v];
          if (acc > half) break;
        }
        out[(y * w + x) * 4 + c] = v;
      }
    }
  }
  return out;
}

/**
 * 하이 패스: 고른 면은 회색(128), 윤곽만 남긴다. 레이어를 복제해 이 필터를 걸고
 * 혼합 모드를 오버레이나 소프트 라이트로 두면 깔끔하게 선명해진다 (사진가들이 쓰는 방법).
 * blurred: 같은 크기로 흐린 픽셀
 */
export function highPass(px: Uint8ClampedArray, blurred: Uint8ClampedArray) {
  const out = new Uint8ClampedArray(px.length);
  for (let i = 0; i < px.length; i += 4) {
    out[i] = 128 + px[i] - blurred[i];
    out[i + 1] = 128 + px[i + 1] - blurred[i + 1];
    out[i + 2] = 128 + px[i + 2] - blurred[i + 2];
    out[i + 3] = px[i + 3];
  }
  return out;
}
