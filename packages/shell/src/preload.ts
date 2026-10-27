import { contextBridge, ipcRenderer } from "electron";
import { IPC, type AIRequest, type SuiteBridge } from "./bridge";

/** 각 앱의 preload 에서 한 줄로 호출한다. */
export function exposeSuiteBridge(appId: string) {
  const bridge: SuiteBridge = {
    appId,
    platform: process.platform,
    ai: {
      ask: (request: AIRequest) => ipcRenderer.invoke(IPC.aiAsk, request),
    },
  };
  contextBridge.exposeInMainWorld("suite", bridge);
}
