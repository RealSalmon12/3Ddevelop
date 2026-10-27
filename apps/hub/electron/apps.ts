import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { UpdateInfo } from "@suite/shell/bridge";
import { buildFromVersion, downloadInstaller, fetchReleases, latestFor, type GitHubRelease } from "@suite/shell/updater";
import { REPO, SUITE_APPS, type SuiteApp } from "../src/catalog";
import { HUB_IPC, type AppState, type HubActionResult, type HubListResult, type InstalledApp } from "../src/hubBridge";

const installable = SUITE_APPS.filter((a): a is SuiteApp & Required<Pick<SuiteApp, "tagPrefix" | "guid" | "executable">> =>
  Boolean(a.tagPrefix && a.guid && a.executable),
);

/** PowerShell 을 창 없이 실행한다. 한글 경로가 깨지지 않게 UTF-8 로 받는다. */
function powershell(script: string): Promise<string> {
  const encoded = Buffer.from(`[Console]::OutputEncoding=(New-Object System.Text.UTF8Encoding $false)\n${script}`, "utf16le").toString("base64");
  return new Promise((resolve, reject) =>
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { windowsHide: true, timeout: 15_000 },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    ),
  );
}

/**
 * 설치 프로그램이 레지스트리에 남긴 설치 폴더와 버전을 읽는다.
 * 사용자 혼자 쓰게 설치했으면 HKCU, 모든 사용자용이면 HKLM 에 있다.
 */
async function findInstalled(): Promise<Record<string, InstalledApp>> {
  const guids = installable.map((a) => `'${a.guid}'`).join(",");
  const script = `
$out=@{}
foreach($g in @(${guids})){
  foreach($h in @('HKCU','HKLM')){
    $loc=(Get-ItemProperty -LiteralPath "$($h):\\Software\\$g" -ErrorAction SilentlyContinue).InstallLocation
    if($loc){
      $ver=(Get-ItemProperty -LiteralPath "$($h):\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\$g" -ErrorAction SilentlyContinue).DisplayVersion
      $out[$g]=@{loc="$loc";ver="$ver"}
      break
    }
  }
}
ConvertTo-Json $out -Compress`;
  let registry: Record<string, { loc: string; ver: string }> = {};
  try {
    registry = JSON.parse((await powershell(script)).replace(/^\uFEFF/, "").trim() || "{}");
  } catch {
    // 레지스트리를 못 읽어도 기본 설치 폴더는 살펴본다.
  }
  const found: Record<string, InstalledApp> = {};
  for (const app of installable) {
    const entry = registry[app.guid];
    const programs = process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs");
    const folders = [entry?.loc, programs && join(programs, app.name), ...(programs ? (app.oldFolders ?? []).map((f) => join(programs, f)) : [])];
    const exe = folders.filter(Boolean).map((f) => join(f!, app.executable)).find((p) => existsSync(p));
    if (exe) found[app.id] = { exe, build: entry ? buildFromVersion(entry.ver) : 0 };
  }
  return found;
}

let releaseCache: { time: number; releases: GitHubRelease[] } | null = null;
const latest: Record<string, UpdateInfo | null> = {};
const installedCache: Record<string, InstalledApp> = {};

async function list(_event: IpcMainInvokeEvent, refresh = false): Promise<HubListResult> {
  const windows = process.platform === "win32";
  let problem: string | undefined;
  try {
    if (refresh || !releaseCache || Date.now() - releaseCache.time > 60_000) {
      releaseCache = { time: Date.now(), releases: await fetchReleases(REPO) };
    }
  } catch (err) {
    problem = `새 버전을 확인하지 못했어요. 인터넷 연결을 확인해 주세요. (${err instanceof Error ? err.message : String(err)})`;
  }
  const installed = windows ? await findInstalled() : {};
  for (const key of Object.keys(installedCache)) delete installedCache[key];
  Object.assign(installedCache, installed);

  const apps: AppState[] = installable.map((app) => {
    latest[app.id] = releaseCache ? latestFor(releaseCache.releases, app.tagPrefix) : null;
    return { id: app.id, installed: installed[app.id] ?? null, latest: latest[app.id] };
  });
  return { apps, problem, unsupported: !windows };
}

const installing = new Set<string>();

async function install(event: IpcMainInvokeEvent, id: string): Promise<HubActionResult> {
  if (process.platform !== "win32") return { ok: false, message: "설치는 Windows 에서만 돼요." };
  const info = latest[id];
  if (!info) return { ok: false, message: "아직 받을 수 있는 설치 파일이 없어요. 목록을 새로 고쳐 주세요." };
  if (installing.has(id)) return { ok: false, message: "이미 설치하고 있어요." };
  installing.add(id);
  try {
    const file = await downloadInstaller(info, `nuguna-${id}`, (ratio) =>
      event.sender.send(HUB_IPC.progress, { id, ratio }),
    );
    // /S: 묻지 않고 설치. 프로그램이 열려 있으면 설치 프로그램이 닫는다.
    const code = await new Promise<number | null>((resolve) => {
      const child = spawn(file, ["/S"], { windowsHide: true, stdio: "ignore" });
      child.on("error", () => resolve(-1));
      child.on("exit", (exitCode) => resolve(exitCode));
    });
    await rm(file, { force: true }).catch(() => undefined);
    if (code !== 0) return { ok: false, message: `설치하지 못했어요 (오류 ${code}). 다시 시도해 주세요.` };
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  } finally {
    installing.delete(id);
  }
}

async function launch(_event: IpcMainInvokeEvent, id: string): Promise<HubActionResult> {
  const exe = installedCache[id]?.exe;
  if (!exe || !existsSync(exe)) return { ok: false, message: "설치된 프로그램을 찾지 못했어요. 다시 설치해 주세요." };
  try {
    spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: `열지 못했어요. (${String(err)})` };
  }
}

export function registerHubIpc() {
  ipcMain.handle(HUB_IPC.list, list);
  ipcMain.handle(HUB_IPC.install, install);
  ipcMain.handle(HUB_IPC.launch, launch);
}
