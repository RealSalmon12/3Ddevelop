import path from "node:path";
import { startSuiteApp } from "@suite/shell/main";

startSuiteApp({
  appId: "modeler",
  title: "3D 모델러",
  preloadPath: path.join(__dirname, "preload.cjs"),
  indexHtmlPath: path.join(__dirname, "../dist/index.html"),
});
