import path from "node:path";
import { startSuiteApp } from "@suite/shell/main";

startSuiteApp({
  appId: "modeler",
  title: "바코 빙산",
  preloadPath: path.join(__dirname, "preload.cjs"),
  indexHtmlPath: path.join(__dirname, "../dist/index.html"),
  updates: { repo: "RealSalmon12/3Ddevelop", tagPrefix: "modeler-build-" },
});
