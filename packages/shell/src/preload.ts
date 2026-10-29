import { contextBridge, ipcRenderer, webUtils } from "electron";
import { IPC, type AIRequest, type OpenFileRequest, type PickFilesRequest, type SaveFileRequest, type SuiteBridge } from "./bridge";

/** 각 앱의 preload 에서 한 줄로 호출한다. */
export function exposeSuiteBridge(appId: string) {
  const bridge: SuiteBridge = {
    appId,
    platform: process.platform,
    ai: {
      ask: (request: AIRequest) => ipcRenderer.invoke(IPC.aiAsk, request),
      status: () => ipcRenderer.invoke(IPC.aiStatus),
      setApiKey: (key: string) => ipcRenderer.invoke(IPC.aiSetKey, key),
    },
    window: {
      setDirty: (dirty: boolean) => ipcRenderer.send(IPC.setDirty, dirty),
    },
    autosave: {
      read: () => ipcRenderer.invoke(IPC.autosaveRead),
      write: (text: string | null) => ipcRenderer.invoke(IPC.autosaveWrite, text),
    },
    files: {
      save: (request: SaveFileRequest) => ipcRenderer.invoke(IPC.fileSave, request),
      open: (request: OpenFileRequest) => ipcRenderer.invoke(IPC.fileOpen, request),
      pick: (request: PickFilesRequest) => ipcRenderer.invoke(IPC.filePick, request),
      pickFolder: () => ipcRenderer.invoke(IPC.folderPick),
      read: (path: string) => ipcRenderer.invoke(IPC.fileRead, path),
      pathOf: (file: File) => webUtils.getPathForFile(file),
    },
    license: {
      status: () => ipcRenderer.invoke(IPC.licenseStatus),
      activate: (key: string) => ipcRenderer.invoke(IPC.licenseActivate, key),
      remove: () => ipcRenderer.invoke(IPC.licenseRemove),
    },
    updates: {
      check: () => ipcRenderer.invoke(IPC.updateCheck),
      install: async (onProgress: (ratio: number) => void) => {
        const listener = (_event: unknown, ratio: number) => onProgress(ratio);
        ipcRenderer.on(IPC.updateProgress, listener);
        try {
          return await ipcRenderer.invoke(IPC.updateInstall);
        } finally {
          ipcRenderer.removeListener(IPC.updateProgress, listener);
        }
      },
    },
  };
  contextBridge.exposeInMainWorld("suite", bridge);
}
