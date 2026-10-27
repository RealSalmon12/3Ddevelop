import { contextBridge, ipcRenderer } from "electron";
import { exposeSuiteBridge } from "@suite/shell/preload";
import { HUB_IPC, type HubBridge } from "../src/hubBridge";

exposeSuiteBridge("hub");

const hub: HubBridge = {
  list: (refresh) => ipcRenderer.invoke(HUB_IPC.list, refresh),
  install: async (id, onProgress) => {
    const listener = (_event: unknown, p: { id: string; ratio: number }) => p.id === id && onProgress(p.ratio);
    ipcRenderer.on(HUB_IPC.progress, listener);
    try {
      return await ipcRenderer.invoke(HUB_IPC.install, id);
    } finally {
      ipcRenderer.removeListener(HUB_IPC.progress, listener);
    }
  },
  launch: (id) => ipcRenderer.invoke(HUB_IPC.launch, id),
};
contextBridge.exposeInMainWorld("hub", hub);
