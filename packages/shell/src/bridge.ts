// 렌더러(화면)와 메인 프로세스 사이의 약속. 모든 앱이 같은 모양의 window.suite 를 받는다.

export interface AIRequest {
  /** 어느 앱에서 보낸 요청인지 (예: "modeler") */
  app: string;
  /** 사용자가 입력한 문장 */
  prompt: string;
  /** 앱이 함께 보내는 현재 상태 (예: 장면에 있는 오브젝트 목록) */
  context?: unknown;
  /** 앞서 나눈 대화. "지붕을 더 높게" 처럼 이어서 고칠 때 필요하다. */
  history?: { role: "user" | "assistant"; text: string }[];
  /** 앱이 AI 에게 주는 역할 설명 */
  system?: string;
  /** 함께 보여 줄 그림 (예: 지금 편집 중인 사진). base64, 앞의 data: 부분 없이 */
  images?: { mediaType: "image/jpeg" | "image/png"; data: string }[];
  /** AI 가 반드시 이 모양으로 답하게 한다 (예: 장면 바꾸기 명령) */
  tool?: { name: string; description: string; input_schema: Record<string, unknown> };
}

export type AIResponse =
  | { ok: true; text: string; toolInput?: unknown }
  | { ok: false; reason: "not-configured" | "error"; message: string };

export interface AIStatus {
  configured: boolean;
}

export interface FileFilter {
  /** 파일 종류 이름 (예: "바코 빙산 프로젝트") */
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
  /** 그림처럼 글자가 아닌 파일. true 면 결과의 text 에 base64 로 담아 준다. */
  binary?: boolean;
}

export interface PickFilesRequest {
  filters: FileFilter[];
  /** 여러 개 고르기 */
  multiple?: boolean;
}

export type OpenFileResult =
  | { ok: true; path: string; text: string }
  | { ok: false; reason: "canceled" | "error"; message?: string };

export interface UpdateInfo {
  /** 새 빌드 번호 */
  build: number;
  /** 설치 파일 크기 (바이트) */
  size: number;
  url: string;
  /** 릴리스 페이지 주소 */
  page: string;
}

export type UpdateCheckResult =
  | { ok: true; current: number; update: UpdateInfo | null; dev?: boolean }
  | { ok: false; message: string };

export type UpdateInstallResult = { ok: true } | { ok: false; message: string };

export interface SuiteBridge {
  appId: string;
  platform: string;
  ai: {
    ask(request: AIRequest): Promise<AIResponse>;
    status(): Promise<AIStatus>;
    /** 빈 문자열이면 지운다. */
    setApiKey(key: string): Promise<AIStatus>;
  };
  window: {
    /** 저장하지 않은 변경이 있으면 true. 창을 닫을 때 한 번 더 물어본다. */
    setDirty(dirty: boolean): void;
  };
  /** 갑자기 꺼졌을 때를 위한 자동 저장본. 앱마다 하나씩 디스크에 바로 쓴다. */
  autosave: {
    read(): Promise<{ time: number; text: string } | null>;
    /** null 이면 지운다. */
    write(text: string | null): Promise<void>;
  };
  files: {
    save(request: SaveFileRequest): Promise<SaveFileResult>;
    open(request: OpenFileRequest): Promise<OpenFileResult>;
    /**
     * 파일을 고르기만 하고 경로를 돌려준다 (취소하면 빈 배열). 영상처럼 큰 파일은 내용을 넘기지 않고
     * file:// 주소로 바로 재생한다.
     */
    pick(request: PickFilesRequest): Promise<string[]>;
    /** 폴더를 고른다 (일괄 처리 결과를 둘 곳). 취소하면 null */
    pickFolder(): Promise<string | null>;
    /** 경로의 파일 내용을 읽는다 (소리 파형 그리기처럼 내용이 필요할 때). 없으면 null. */
    read(path: string): Promise<Uint8Array | null>;
    /** 끌어다 놓은 파일의 실제 경로 */
    pathOf(file: File): string;
  };
  updates: {
    check(): Promise<UpdateCheckResult>;
    /** 받는 동안 0~1 진행률을 알려 주고, 성공하면 앱이 닫혔다가 새 버전으로 다시 열린다. */
    install(onProgress: (ratio: number) => void): Promise<UpdateInstallResult>;
  };
}

export const IPC = {
  aiAsk: "suite:ai-ask",
  aiStatus: "suite:ai-status",
  aiSetKey: "suite:ai-set-key",
  fileSave: "suite:file-save",
  fileOpen: "suite:file-open",
  filePick: "suite:file-pick",
  folderPick: "suite:folder-pick",
  fileRead: "suite:file-read",
  setDirty: "suite:set-dirty",
  autosaveRead: "suite:autosave-read",
  autosaveWrite: "suite:autosave-write",
  updateCheck: "suite:update-check",
  updateInstall: "suite:update-install",
  updateProgress: "suite:update-progress",
} as const;

declare global {
  interface Window {
    /** Electron 밖(브라우저 미리보기)에서는 없을 수 있다. */
    suite?: SuiteBridge;
  }
}
