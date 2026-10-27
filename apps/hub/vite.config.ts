import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // 설치된 프로그램은 file:// 로 화면을 열기 때문에 상대 경로가 필요하다.
  base: "./",
  // 데스크톱 앱이라 파일 하나가 커도 괜찮다.
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  server: { port: 5174, strictPort: true },
});
