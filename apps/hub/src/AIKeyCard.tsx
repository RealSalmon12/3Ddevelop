import { useEffect, useState } from "react";

/** AI 키는 모든 프로그램이 함께 쓰므로 허브에서 한 번만 넣으면 된다. */
export function AIKeyCard({ notify }: { notify: (message: string) => void }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState("");

  useEffect(() => {
    window.suite?.ai.status().then((s) => setConfigured(s.configured));
  }, []);

  async function save(value: string) {
    if (!window.suite) return notify("AI 키는 설치한 프로그램에서만 넣을 수 있어요.");
    const status = await window.suite.ai.setApiKey(value);
    setConfigured(status.configured);
    setKey("");
    setEditing(false);
    notify(status.configured ? "AI 키를 저장했어요. 모든 프로그램에서 AI 도우미를 쓸 수 있어요." : "AI 키를 지웠어요.");
  }

  return (
    <section className="hub-side-card ai">
      <h2>✨ AI 도우미</h2>
      <p className="hub-ai-state">
        <span className={configured ? "suite-ai-dot on" : "suite-ai-dot"} />
        {configured === null ? "확인하는 중…" : configured ? "연결됨. 모든 프로그램에서 쓸 수 있어요." : "아직 연결하지 않았어요."}
      </p>
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save(key);
          }}
        >
          <p className="hub-small">
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
              value={key}
              autoFocus
              onChange={(e) => setKey(e.target.value)}
            />
            <button className="suite-button">저장</button>
          </div>
          {configured && (
            <button type="button" className="suite-ai-link hub-remove" onClick={() => void save("")}>
              키 지우기
            </button>
          )}
        </form>
      ) : (
        <button className="hub-button ghost" onClick={() => setEditing(true)}>
          {configured ? "키 바꾸기" : "AI 키 넣기"}
        </button>
      )}
      <p className="hub-small">한 번 넣으면 3D 모델러, 픽셀 그림판 모두 같은 키를 써요.</p>
    </section>
  );
}
