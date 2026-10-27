// 허브 화면과 허브 메인 프로세스 사이의 약속. 다른 앱에는 없는 window.hub 를 만든다.
import type { UpdateInfo } from "@suite/shell/bridge";

export interface InstalledApp {
  /** 설치된 빌드 번호. 알 수 없으면 0. */
  build: number;
  exe: string;
}

export interface AppState {
  id: string;
  installed: InstalledApp | null;
  /** 받을 수 있는 가장 새 설치 파일 */
  latest: UpdateInfo | null;
}

export interface HubListResult {
  apps: AppState[];
  /** 새 버전을 확인하지 못했을 때 그 이유 (인터넷이 끊겼을 때 등) */
  problem?: string;
  /** Windows 가 아니라서 설치·실행을 못 할 때 true */
  unsupported?: boolean;
}

export type HubActionResult = { ok: true } | { ok: false; message: string };

export interface HubBridge {
  list(refresh?: boolean): Promise<HubListResult>;
  /** 받는 동안 0~1 진행률을 알려 주고, 조용히 설치까지 마친다. */
  install(id: string, onProgress: (ratio: number) => void): Promise<HubActionResult>;
  launch(id: string): Promise<HubActionResult>;
}

export const HUB_IPC = {
  list: "hub:list",
  install: "hub:install",
  progress: "hub:progress",
  launch: "hub:launch",
} as const;

declare global {
  interface Window {
    hub?: HubBridge;
  }
}
