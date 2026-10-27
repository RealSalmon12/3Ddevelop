// 픽셀 저장소: 레이어와 마스크의 픽셀을 id 로 보관한다.
// 최근에 쓴 것은 캔버스로 들고 있고, 오래된 것은 PNG(Blob)로 줄여 두었다가 필요할 때 다시 푼다.
// 문서(PhotoDoc)는 id 만 가지므로 실행 취소 기록이 가볍다.

interface Entry {
  canvas: HTMLCanvasElement | null;
  blob: Blob | null;
  /** 처음 읽어 온 data: 주소 (파일, AI) */
  dataUrl: string | null;
  width: number;
  height: number;
  loading: Promise<void> | null;
  used: number;
}

const store = new Map<string, Entry>();
let counter = 0;
let clock = 0;
/** 캔버스로 들고 있을 최대 픽셀 수 (약 600MB) */
const BUDGET = 150_000_000;

export function createCanvas(width: number, height: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(width));
  c.height = Math.max(1, Math.round(height));
  return c;
}

export const ctx2d = (c: HTMLCanvasElement) => c.getContext("2d", { willReadFrequently: false })!;

/** 캔버스를 저장소에 넣고 id 를 돌려준다. 넣은 뒤에는 그 캔버스를 바꾸면 안 된다. */
export function putCanvas(canvas: HTMLCanvasElement): string {
  const id = `px${++counter}`;
  store.set(id, { canvas, blob: null, dataUrl: null, width: canvas.width, height: canvas.height, loading: null, used: ++clock });
  // 나중에 메모리를 아끼려고 미리 PNG 로 줄여 둔다.
  setTimeout(() => {
    const e = store.get(id);
    if (e?.canvas && !e.blob) e.canvas.toBlob((b) => (e.blob = b), "image/png");
  }, 1500);
  evict();
  return id;
}

/** data: 주소를 저장소에 넣는다 (파일 열기). 처음 쓸 때 푼다. */
export function putDataUrl(dataUrl: string, width: number, height: number): string {
  const id = `px${++counter}`;
  store.set(id, { canvas: null, blob: null, dataUrl, width, height, loading: null, used: ++clock });
  return id;
}

/** 빈 (투명한) 픽셀 */
export function putBlank(width: number, height: number, fill?: string): string {
  const c = createCanvas(width, height);
  if (fill) {
    const g = ctx2d(c);
    g.fillStyle = fill;
    g.fillRect(0, 0, c.width, c.height);
  }
  return putCanvas(c);
}

/** 그릴 수 있는 캔버스. 아직 안 풀렸으면 null 을 돌려주고, 다 풀리면 onLoad 를 부른다. */
export function pixels(id: string, onLoad?: () => void): HTMLCanvasElement | null {
  const e = store.get(id);
  if (!e) return null;
  e.used = ++clock;
  if (e.canvas) return e.canvas;
  if (!e.loading) {
    e.loading = decode(e).then(() => {
      e.loading = null;
      evict();
    });
  }
  if (onLoad) void e.loading.then(onLoad);
  return null;
}

/** 다 풀릴 때까지 기다린 캔버스 */
export async function pixelsAsync(id: string): Promise<HTMLCanvasElement | null> {
  const ready = pixels(id);
  if (ready) return ready;
  const e = store.get(id);
  if (!e) return null;
  await e.loading;
  return e.canvas;
}

async function decode(e: Entry) {
  const source = e.blob ?? (e.dataUrl ? dataUrlToBlob(e.dataUrl) : null);
  if (!source) return;
  const bmp = await createImageBitmap(source);
  const c = createCanvas(bmp.width, bmp.height);
  ctx2d(c).drawImage(bmp, 0, 0);
  bmp.close();
  e.canvas = c;
}

export const sizeOf = (id: string) => {
  const e = store.get(id);
  return e ? { width: e.width, height: e.height } : { width: 1, height: 1 };
};

/** 고칠 수 있는 복사본 (붓질 시작할 때) */
export function cloneCanvas(src: HTMLCanvasElement) {
  const c = createCanvas(src.width, src.height);
  ctx2d(c).drawImage(src, 0, 0);
  return c;
}

/** 저장할 때: id → data: 주소 */
export async function toDataUrl(id: string): Promise<string> {
  const e = store.get(id);
  if (!e) return "";
  if (e.dataUrl) return e.dataUrl;
  const blob = e.blob ?? (e.canvas ? await new Promise<Blob | null>((r) => e.canvas!.toBlob(r, "image/png")) : null);
  if (!blob) return "";
  e.blob = blob;
  return await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

/** 오래 안 쓴 캔버스를 내려놓는다 (PNG 나 data: 주소가 있는 것만) */
function evict() {
  let total = 0;
  const live = [...store.values()].filter((e) => e.canvas).sort((a, b) => b.used - a.used);
  for (const e of live) {
    total += e.width * e.height;
    if (total > BUDGET && (e.blob || e.dataUrl)) e.canvas = null;
  }
}

/** data: 주소 → Blob (fetch 는 보안 정책(CSP)에 막혀서 직접 푼다) */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(",", 2);
  const type = head.slice(5).split(";")[0] || "application/octet-stream";
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
