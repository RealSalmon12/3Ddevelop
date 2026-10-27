import path from "node:path";
import { startSuiteApp } from "@suite/shell/main";
import { registerHubIpc } from "./apps";

registerHubIpc();

startSuiteApp({
  appId: "hub",
  title: "누구나 스튜디오",
  preloadPath: path.join(__dirname, "preload.cjs"),
  indexHtmlPath: path.join(__dirname, "../dist/index.html"),
  size: { width: 1180, height: 760, minWidth: 900, minHeight: 600 },
  updates: { repo: "RealSalmon12/3Ddevelop", tagPrefix: "hub-build-" },
});
