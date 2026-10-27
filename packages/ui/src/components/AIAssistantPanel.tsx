import { useEffect, useRef, useState } from "react";
import type { AIRequest, AIResponse } from "@suite/shell/bridge";
import { Panel } from "./Panel";

interface Message {
  role: "user" | "assistant" | "error";
  text: string;
  /** AI 와 실제로 주고받은 말인지 (안내 문구나 실패한 질문은 다음 요청에 넣지 않는다) */
  sent?: boolean;
}

interface AIAssistantPanelProps {
  /** 요청을 보낸 앱 (예: "modeler") */
  app: string;
  greeting: string;
  /** 초보자가 눌러볼 수 있는 예시 문장 */
  examples: string[];
  /** 요청과 함께 보낼 현재 작업 상태 */
  getContext?: () => unknown;
  /** 요청과 함께 보여 줄 그림 (예: 지금 사진) */
  getImages?: () => AIRequest["images"];
  /** AI 에게 주는 역할 설명과 답의 모양 */
  system?: string;
  tool?: AIRequest["tool"];
  /**
   * AI 가 답을 주면 앱이 그 답으로 무언가를 한다 (예: 장면에 도형 추가).
   * 문자열을 돌려주면 그것을 대화창에 보여준다.
   */
  onResponse?: (response: { text: string; toolInput?: unknown }) => string | void;
}

/** 대화에 넣어 보낼 최근 메시지 수 */
const HISTORY_LIMIT = 10;

/** 모든 앱 공통 AI 도우미. 글로 부탁하면 메인 프로세스를 거쳐 AI 에게 전달한다. */
export function AIAssistantPanel({ app, greeting, examples, getContext, getImages, system, tool, onResponse }: AIAssistantPanelProps) {
  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", text: greeting }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.suite?.ai.status().then((s) => setConfigured(s.configured));
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, busy]);

  async function send(prompt: string) {
    const text = prompt.trim();
    if (!text || busy) return;
    setInput("");
    const history = messages
      .filter((m): m is Message & { role: "user" | "assistant" } => !!m.sent && m.role !== "error")
      .slice(-HISTORY_LIMIT)
      .map(({ role, text }) => ({ role, text }));
    // 대화는 사용자 차례로 시작해야 한다.
    while (history.length && history[0].role !== "user") history.shift();
    setMessages((m) => [...m, { role: "user", text }]);
    setBusy(true);

    let response: AIResponse;
    try {
      response = window.suite
        ? await window.suite.ai.ask({ app, prompt: text, context: getContext?.(), images: getImages?.(), history, system, tool })
        : { ok: false, reason: "not-configured", message: "AI 도우미는 설치된 프로그램에서만 쓸 수 있어요." };
    } catch (err) {
      response = { ok: false, reason: "error", message: String(err) };
    }

    setBusy(false);
    if (response.ok) {
      let reply: string | void = response.text;
      try {
        reply = onResponse?.({ text: response.text, toolInput: response.toolInput }) ?? response.text;
      } catch (err) {
        setMessages((m) => [...m, { role: "error", text: `AI 답을 적용하지 못했어요. ${String(err)}` }]);
        return;
      }
      setMessages((m) => {
        // 방금 보낸 질문도 대화 기록에 넣는다.
        const next = [...m];
        next[next.length - 1] = { ...next[next.length - 1], sent: true };
        return [...next, { role: "assistant", text: reply || "완료했어요.", sent: true }];
      });
      // 입력창에서 빠져나와야 Ctrl+Z 가 장면 되돌리기로 동작한다.
      (document.activeElement as HTMLElement | null)?.blur();
    } else {
      setMessages((m) => [...m, { role: "error", text: response.message }]);
      if (response.reason === "not-configured") setShowKey(true);
    }
  }

  async function saveKey() {
    if (!window.suite) return;
    const status = await window.suite.ai.setApiKey(keyInput);
    setConfigured(status.configured);
    setKeyInput("");
    setShowKey(false);
    setMessages((m) => [
      ...m,
      { role: "assistant", text: status.configured ? "API 키를 저장했어요. 이제 만들고 싶은 것을 말해 주세요!" : "API 키를 지웠어요." },
    ]);
  }

  return (
    <Panel title="✨ AI 도우미" grow className="ai">
      <div className="suite-ai-toolbar">
        <span className={configured ? "suite-ai-dot on" : "suite-ai-dot"} />
        <span>{configured ? "연결됨" : "API 키가 필요해요"}</span>
        <button className="suite-ai-link" onClick={() => setShowKey(!showKey)}>
          API 키 설정
        </button>
      </div>
      {showKey && (
        <form
          className="suite-ai-key"
          onSubmit={(e) => {
            e.preventDefault();
            saveKey();
          }}
        >
          <p>
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
              console.anthropic.com
            </a>
            에서 만든 키(sk-ant-로 시작)를 붙여 넣어 주세요. 이 컴퓨터에만 암호화해서 저장해요.
          </p>
          <div className="suite-ai-form">
            <input
              className="suite-ai-input"
              type="password"
              placeholder="sk-ant-..."
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
            />
            <button className="suite-button">저장</button>
          </div>
        </form>
      )}
      <div className="suite-ai-log" ref={logRef}>
        {messages.map((m, i) => (
          <div key={i} className={`suite-ai-msg ${m.role}`}>
            {m.text}
          </div>
        ))}
        {busy && <div className="suite-ai-msg assistant">만드는 중… (10초쯤 걸려요)</div>}
      </div>
      {messages.length === 1 && (
        <div className="suite-ai-examples" style={{ marginBottom: 8 }}>
          {examples.map((ex) => (
            <button key={ex} className="suite-ai-example" onClick={() => send(ex)}>
              {ex}
            </button>
          ))}
        </div>
      )}
      <form
        className="suite-ai-form"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          className="suite-ai-input"
          placeholder="무엇을 만들고 싶나요?"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="suite-button" disabled={busy || !input.trim()}>
          보내기
        </button>
      </form>
    </Panel>
  );
}
