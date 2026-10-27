// 렌더러(화면)와 메인 프로세스 사이의 약속. 모든 앱이 같은 모양의 window.suite 를 받는다.

export interface AIRequest {
  /** 어느 앱에서 보낸 요청인지 (예: "modeler") */
  app: string;
  /** 사용자가 입력한 문장 */
  prompt: string;
  /** 앱이 함께 보내는 현재 상태 (예: 장면에 있는 오브젝트 목록) */
  context?: unknown;
}

export type AIResponse =
  | { ok: true; text: string }
  | { ok: false; reason: "not-configured" | "error"; message: string };

export interface FileFilter {
  /** 파일 종류 이름 (예: "3D 모델러 프로젝트") */
  name: string;
  /** 점 없는 확장자 (예: ["nmodel"]) */
  extensions: string[];
}

export interface SaveFileRequest {
  /** 이미 저장한 적 있는 경로. 있으면 묻지 않고 바로 덮어쓴다. */
  path?: string;
  defaultName: string;
  filters: FileFilter[];
  data: string | Uint8Array;
}

export type SaveFileResult = { ok: true; path: string } | { ok: false; reason: "canceled" | "error"; message?: string };

export interface OpenFileRequest {
  filters: FileFilter[];
}

export type OpenFileResult =
  | { ok: true; path: string; text: string }
  | { ok: false; reason: "canceled" | "error"; message?: string };

export interface SuiteBridge {
  appId: string;
  platform: string;
  ai: {
    ask(request: AIRequest): Promise<AIResponse>;
  };
  window: {
    /** 저장하지 않은 변경이 있으면 true. 창을 닫을 때 한 번 더 물어본다. */
    setDirty(dirty: boolean): void;
  };
  files: {
    save(request: SaveFileRequest): Promise<SaveFileResult>;
    open(request: OpenFileRequest): Promise<OpenFileResult>;
  };
}

export const IPC = {
  aiAsk: "suite:ai-ask",
  fileSave: "suite:file-save",
  fileOpen: "suite:file-open",
  setDirty: "suite:set-dirty",
} as const;

declare global {
  interface Window {
    /** Electron 밖(브라우저 미리보기)에서는 없을 수 있다. */
    suite?: SuiteBridge;
  }
}
