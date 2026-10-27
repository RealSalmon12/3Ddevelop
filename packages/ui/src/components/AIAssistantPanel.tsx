import { useEffect, useRef, useState } from "react";
import type { AIResponse } from "@suite/shell/bridge";
import { Panel } from "./Panel";

interface Message {
  role: "user" | "assistant" | "error";
  text: string;
}

interface AIAssistantPanelProps {
  /** 요청을 보낸 앱 (예: "modeler") */
  app: string;
  greeting: string;
  /** 초보자가 눌러볼 수 있는 예시 문장 */
  examples: string[];
  /** 요청과 함께 보낼 현재 작업 상태 */
  getContext?: () => unknown;
  /** AI 가 답을 주면 앱이 그 답으로 무언가를 할 수 있다 (예: 장면에 도형 추가) */
  onResponse?: (text: string) => void;
}

/** 모든 앱 공통 AI 도우미. 글로 부탁하면 메인 프로세스를 거쳐 AI 에게 전달한다. */
export function AIAssistantPanel({ app, greeting, examples, getContext, onResponse }: AIAssistantPanelProps) {
  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", text: greeting }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  async function send(prompt: string) {
    const text = prompt.trim();
    if (!text || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    setBusy(true);

    let response: AIResponse;
    try {
      response = window.suite
        ? await window.suite.ai.ask({ app, prompt: text, context: getContext?.() })
        : { ok: false, reason: "not-configured", message: "AI 도우미는 설치된 프로그램에서만 쓸 수 있어요." };
    } catch (err) {
      response = { ok: false, reason: "error", message: String(err) };
    }

    setBusy(false);
    if (response.ok) {
      setMessages((m) => [...m, { role: "assistant", text: response.text }]);
      onResponse?.(response.text);
    } else {
      setMessages((m) => [...m, { role: "error", text: response.message }]);
    }
  }

  return (
    <Panel title="✨ AI 도우미" grow>
      <div className="suite-ai-log" ref={logRef}>
        {messages.map((m, i) => (
          <div key={i} className={`suite-ai-msg ${m.role}`}>
            {m.text}
          </div>
        ))}
        {busy && <div className="suite-ai-msg assistant">생각하는 중…</div>}
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
