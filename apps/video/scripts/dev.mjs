// 개발 모드: 화면은 Vite 개발 서버에서 바로 고쳐지고, Electron 창이 그 화면을 띄운다.
import { spawn } from "node:child_process";
import { createServer } from "vite";
import electron from "electron";
import { buildElectron } from "./build-electron.mjs";

const server = await createServer();
await server.listen();
const url = server.resolvedUrls.local[0];

await buildElectron({ dev: true });

const child = spawn(electron, ["."], {
  stdio: "inherit",
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});
child.on("close", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
