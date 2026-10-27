import { contextBridge, ipcRenderer } from "electron";
import { IPC, type AIRequest, type OpenFileRequest, type SaveFileRequest, type SuiteBridge } from "./bridge";

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
    files: {
      save: (request: SaveFileRequest) => ipcRenderer.invoke(IPC.fileSave, request),
      open: (request: OpenFileRequest) => ipcRenderer.invoke(IPC.fileOpen, request),
    },
  };
  contextBridge.exposeInMainWorld("suite", bridge);
}
