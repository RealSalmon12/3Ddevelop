import path from "node:path";
import { startSuiteApp } from "@suite/shell/main";

startSuiteApp({
  appId: "pixel",
  title: "도트 아틀리에",
  preloadPath: path.join(__dirname, "preload.cjs"),
  indexHtmlPath: path.join(__dirname, "../dist/index.html"),
  updates: { repo: "RealSalmon12/3Ddevelop", tagPrefix: "pixel-build-" },
});
