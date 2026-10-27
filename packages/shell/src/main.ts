import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import {
  IPC,
  type AIRequest,
  type AIResponse,
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
}

/** AI 요청 처리. 실제 모델 연결은 AI 모델링 단계에서 이 함수만 바꾸면 된다. */
async function handleAIRequest(_request: AIRequest): Promise<AIResponse> {
  return {
    ok: false,
    reason: "not-configured",
    message: "AI 기능은 아직 준비 중이에요. 곧 글로 설명하면 모델을 만들어 주는 기능이 들어갈 거예요.",
  };
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
    return { ok: true, path: filePath, text: await readFile(filePath, "utf8") };
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

  ipcMain.handle(IPC.aiAsk, (_event, request: AIRequest) => handleAIRequest(request));
  ipcMain.handle(IPC.fileSave, handleSaveFile);
  ipcMain.handle(IPC.fileOpen, handleOpenFile);

  app.whenReady().then(() => {
    const win = createWindow(options);
    app.on("second-instance", () => {
      if (win.isMinimized()) win.restore();
      win.focus();
    });
  });

  app.on("window-all-closed", () => app.quit());
}
