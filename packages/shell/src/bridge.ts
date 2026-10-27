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

export interface SuiteBridge {
  appId: string;
  platform: string;
  ai: {
    ask(request: AIRequest): Promise<AIResponse>;
  };
}

export const IPC = {
  aiAsk: "suite:ai-ask",
} as const;

declare global {
  interface Window {
    /** Electron 밖(브라우저 미리보기)에서는 없을 수 있다. */
    suite?: SuiteBridge;
  }
}
