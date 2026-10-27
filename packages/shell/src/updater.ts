import { app, BrowserWindow, net } from "electron";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { IPC, type UpdateCheckResult, type UpdateInfo, type UpdateInstallResult } from "./bridge";

export interface UpdateSource {
  /** GitHub 저장소 (예: "RealSalmon12/3Ddevelop") */
  repo: string;
  /** 이 앱의 릴리스 태그 앞부분 (예: "modeler-build-"). 뒤에 붙는 숫자가 빌드 번호다. */
  tagPrefix: string;
}

export interface GitHubRelease {
  tag_name: string;
  html_url: string;
  draft: boolean;
  assets: { name: string; size: number; browser_download_url: string }[];
}

/** 설치된 앱의 빌드 번호. CI 가 버전을 0.1.<빌드 번호> 로 정해서 만든다. 개발 중이면 0. */
export function currentBuild(): number {
  if (!app.isPackaged) return 0;
  return buildFromVersion(app.getVersion());
}

/** "0.1.23" → 23 */
export const buildFromVersion = (version: string) => Number(version.split(".")[2]) || 0;

/** 저장소의 최근 릴리스. 제품군의 모든 앱이 한 저장소에 태그 앞부분만 달리해서 올린다. */
export async function fetchReleases(repo: string): Promise<GitHubRelease[]> {
  const res = await net.fetch(`https://api.github.com/repos/${repo}/releases?per_page=100`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`업데이트 서버가 응답하지 않아요 (${res.status}).`);
  return (await res.json()) as GitHubRelease[];
}

/** 릴리스 목록에서 이 앱의 가장 새 설치 파일 */
export function latestFor(releases: GitHubRelease[], tagPrefix: string): UpdateInfo | null {
  const best = releases
    .filter((r) => !r.draft && r.tag_name.startsWith(tagPrefix))
    .map((r) => ({ r, build: Number(r.tag_name.slice(tagPrefix.length)) || 0 }))
    .sort((a, b) => b.build - a.build)[0];
  const asset = best?.r.assets.find((a) => a.name.toLowerCase().endsWith(".exe"));
  return best && asset ? { build: best.build, size: asset.size, url: asset.browser_download_url, page: best.r.html_url } : null;
}

let latest: UpdateInfo | null = null;

export async function checkForUpdate(source: UpdateSource): Promise<UpdateCheckResult> {
  const current = currentBuild();
  if (!app.isPackaged) return { ok: true, current, update: null, dev: true };
  let releases: GitHubRelease[];
  try {
    releases = await fetchReleases(source.repo);
  } catch (err) {
    const message = String(err instanceof Error ? err.message : err);
    return { ok: false, message: message.startsWith("업데이트") ? message : `인터넷 연결을 확인해 주세요. (${message})` };
  }
  const found = latestFor(releases, source.tagPrefix);
  latest = found && found.build > current ? found : null;
  return { ok: true, current, update: latest };
}

/** 설치 파일을 임시 폴더에 받는다. 실패하면 메시지를 던진다. */
export async function downloadInstaller(info: UpdateInfo, name: string, onProgress: (ratio: number) => void): Promise<string> {
  const target = join(app.getPath("temp"), `${name}-${info.build}.exe`);
  try {
    const res = await net.fetch(info.url);
    if (!res.ok || !res.body) throw new Error(`내려받지 못했어요 (${res.status}).`);
    const total = Number(res.headers.get("content-length")) || info.size;
    const file = createWriteStream(target);
    const reader = res.body.getReader();
    let received = 0;
    let lastSent = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (!file.write(value)) await new Promise<void>((resolve) => file.once("drain", () => resolve()));
      if (received - lastSent > 512 * 1024 || received === total) {
        lastSent = received;
        onProgress(total ? received / total : 0);
      }
    }
    await new Promise<void>((resolve, reject) => file.end((err?: Error | null) => (err ? reject(err) : resolve())));
    if (total && received < total) throw new Error("내려받다가 끊겼어요. 다시 시도해 주세요.");
    return target;
  } catch (err) {
    await rm(target, { force: true });
    const message = String(err instanceof Error ? err.message : err);
    throw new Error(message.startsWith("내려받") ? message : `내려받지 못했어요. 인터넷 연결을 확인해 주세요. (${message})`);
  }
}

/** 새 설치 파일을 받아서 조용히 설치하고, 설치가 끝나면 앱을 다시 연다. */
export async function installUpdate(win: BrowserWindow): Promise<UpdateInstallResult> {
  if (!latest) return { ok: false, message: "받을 새 버전이 없어요. 먼저 업데이트를 확인해 주세요." };
  if (process.platform !== "win32") return { ok: false, message: "자동 설치는 Windows 에서만 돼요." };
  let target: string;
  try {
    target = await downloadInstaller(latest, "nuguna-update", (ratio) => win.webContents.send(IPC.updateProgress, ratio));
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }

  // /S: 묻지 않고 설치, --force-run: 설치가 끝나면 앱을 다시 실행
  spawn(target, ["/S", "--force-run"], { detached: true, stdio: "ignore" }).unref();
  // 저장 확인은 화면 쪽에서 이미 했으므로 닫기 경고 없이 바로 끝낸다.
  setTimeout(() => app.exit(0), 300);
  return { ok: true };
}
