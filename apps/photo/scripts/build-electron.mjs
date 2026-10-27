// Electron 메인 프로세스와 preload 를 하나의 파일로 묶는다.
import { build } from "esbuild";

export async function buildElectron({ dev = false } = {}) {
  const common = {
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
    sourcemap: dev,
    logLevel: "warning",
  };
  await Promise.all([
    build({ ...common, entryPoints: ["electron/main.ts"], outfile: "dist-electron/main.cjs" }),
    build({ ...common, entryPoints: ["electron/preload.ts"], outfile: "dist-electron/preload.cjs" }),
  ]);
}

if (process.argv[1]?.endsWith("build-electron.mjs")) {
  await buildElectron();
}
