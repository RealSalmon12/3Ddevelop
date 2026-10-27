import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from "electron";
import { rmSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { aiStatus, askAI, setApiKey } from "./ai";
import { checkForUpdate, installUpdate, type UpdateSource } from "./updater";
import {
  IPC,
  type AIRequest,
  type OpenFileRequest,
  type OpenFileResult,
  type SaveFileRequest,
  type SaveFileResult,
} from "./bridge";

export interface SuiteAppOptions {
  /** 앱 고유 ID (예: "modeler"). Windows 작업 표시줄 구분에 쓰인다. */
  appId: string;
  /** 창 제목에 보이는 이름 (예: "3D 모델러") */
  title: string;
  /** 빌드된 preload 파일의 절대 경로 */
  preloadPath: string;
  /** 빌드된 index.html 의 절대 경로 (개발 중에는 VITE_DEV_SERVER_URL 을 쓴다) */
  indexHtmlPath: string;
  backgroundColor?: string;
  /** 창 크기. 없으면 작업용 큰 창 (1440×900). */
  size?: { width: number; height: number; minWidth: number; minHeight: number };
  /** 새 버전을 찾을 곳. 없으면 업데이트 확인은 늘 "최신" 이라고 답한다. */
  updates?: UpdateSource;
}

async function handleSaveFile(event: IpcMainInvokeEvent, request: SaveFileRequest): Promise<SaveFileResult> {
  let filePath = request.path;
  if (!filePath) {
    const win = BrowserWindow.fromWebContents(event.sender)!;
    const result = await dialog.showSaveDialog(win, { defaultPath: request.defaultName, filters: request.filters });
    if (result.canceled || !result.filePath) return { ok: false, reason: "canceled" };
    filePath = result.filePath;
  }
  try {
    await writeFile(filePath, typeof request.data === "string" ? request.data : Buffer.from(request.data));
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, reason: "error", message: String(err) };
  }
}

async function handleOpenFile(event: IpcMainInvokeEvent, request: OpenFileRequest): Promise<OpenFileResult> {
  const win = BrowserWindow.fromWebContents(event.sender)!;
  const result = await dialog.showOpenDialog(win, { filters: request.filters, properties: ["openFile"] });
  const filePath = result.filePaths[0];
  if (result.canceled || !filePath) return { ok: false, reason: "canceled" };
  try {
    return { ok: true, path: filePath, text: await readFile(filePath, request.binary ? "base64" : "utf8") };
  } catch (err) {
    return { ok: false, reason: "error", message: String(err) };
  }
}

function createWindow(options: SuiteAppOptions) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    ...options.size,
    title: options.title,
    backgroundColor: options.backgroundColor ?? "#1d1f23",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => win.show());

  // 저장하지 않은 작업이 있으면 닫기 전에 한 번 더 묻는다.
  let dirty = false;
  ipcMain.on(IPC.setDirty, (event, value: boolean) => {
    if (event.sender === win.webContents) dirty = value;
  });
  win.on("close", (event) => {
    if (!dirty) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: "warning",
      buttons: ["저장하지 않고 닫기", "취소"],
      defaultId: 1,
      cancelId: 1,
      title: options.title,
      message: "저장하지 않은 작업이 있어요.",
      detail: "닫으면 마지막으로 저장한 뒤의 변경 내용이 사라져요.",
    });
    if (choice === 1) event.preventDefault();
  });

  // 외부 링크는 앱 안이 아니라 기본 브라우저로 연다.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(options.indexHtmlPath);
  }
  return win;
}

/** 모든 앱의 Electron 진입점이 호출하는 공통 시작 함수. */
export function startSuiteApp(options: SuiteAppOptions) {
  // Windows 작업 표시줄과 알림에서 앱을 구분하는 ID
  app.setAppUserModelId(`com.suite.${options.appId}`);

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  ipcMain.handle(IPC.aiAsk, (_event, request: AIRequest) => askAI(request));
  ipcMain.handle(IPC.aiStatus, () => aiStatus());
  ipcMain.handle(IPC.aiSetKey, (_event, key: string) => setApiKey(key));
  ipcMain.handle(IPC.fileSave, handleSaveFile);
  ipcMain.handle(IPC.fileOpen, handleOpenFile);
  const autosavePath = () => join(app.getPath("userData"), `autosave-${options.appId}.json`);
  ipcMain.handle(IPC.autosaveRead, async () => {
    try {
      return JSON.parse(await readFile(autosavePath(), "utf8"));
    } catch {
      return null;
    }
  });
  ipcMain.handle(IPC.autosaveWrite, async (_event, text: string | null) => {
    if (text === null) await rm(autosavePath(), { force: true });
    else await writeFile(autosavePath(), JSON.stringify({ time: Date.now(), text }));
  });
  ipcMain.handle(IPC.updateCheck, () =>
    options.updates ? checkForUpdate(options.updates) : { ok: true, current: 0, update: null, dev: true },
  );
  ipcMain.handle(IPC.updateInstall, (event) => installUpdate(BrowserWindow.fromWebContents(event.sender)!));

  app.whenReady().then(() => {
    const win = createWindow(options);
    // 창이 정상적으로 닫히면 자동 저장본은 필요 없다. 앱이 바로 끝나므로 기다리지 않고 지운다.
    win.on("closed", () => rmSync(autosavePath(), { force: true }));
    app.on("second-instance", () => {
      if (win.isMinimized()) win.restore();
      win.focus();
    });
  });

  app.on("window-all-closed", () => app.quit());
}
