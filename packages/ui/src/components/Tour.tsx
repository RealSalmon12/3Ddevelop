import { useCallback, useEffect, useLayoutEffect, useState } from "react";

export interface TourStep {
  title: string;
  body: string;
  /** 강조할 화면 요소 (CSS 선택자). 없으면 가운데에 카드만 띄운다. */
  target?: string;
}

/** 안내가 떠 있는 동안 앱 단축키를 쉬게 할 때 쓴다. */
export const isTourOpen = () => !!document.querySelector(".suite-tour");

/** 처음 한 번만 자동으로 보여주는 따라하기 안내. 다시 보려면 start() 를 부른다. */
export function useTour(id: string) {
  const key = `suite-tour-${id}`;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) !== "done";
    } catch {
      return true;
    }
  });
  const finish = useCallback(() => {
    setOpen(false);
    try {
      localStorage.setItem(key, "done");
    } catch {
      // 저장이 안 돼도 이번 실행에서는 닫힌다.
    }
  }, [key]);
  const start = useCallback(() => setOpen(true), []);
  return { open, start, finish };
}

export function Tour({ steps, open, onFinish }: { steps: TourStep[]; open: boolean; onFinish: () => void }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = steps[index];

  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !step?.target) return setRect(null);
    const update = () => setRect(document.querySelector(step.target!)?.getBoundingClientRect() ?? null);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [open, step]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onFinish();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onFinish]);

  if (!open || !step) return null;
  const last = index === steps.length - 1;

  // 카드는 강조한 곳 옆에, 화면 밖으로 나가지 않게 놓는다.
  const cardStyle: React.CSSProperties = rect
    ? {
        left: Math.min(Math.max(rect.left, 16), window.innerWidth - 356),
        top: rect.bottom + 12 + 180 < window.innerHeight ? rect.bottom + 12 : Math.max(rect.top - 192, 16),
      }
    : { left: "50%", top: "50%", transform: "translate(-50%, -50%)" };

  return (
    <div className="suite-tour" role="dialog" aria-label="따라하기 안내">
      {rect ? (
        <div
          className="suite-tour-spot"
          style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }}
        />
      ) : (
        <div className="suite-tour-dim" />
      )}
      <div className="suite-tour-card" style={cardStyle}>
        <div className="suite-tour-count">
          {index + 1} / {steps.length}
        </div>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <div className="suite-tour-buttons">
          <button className="suite-ai-link" onClick={onFinish}>
            건너뛰기
          </button>
          {index > 0 && (
            <button className="suite-tour-back" onClick={() => setIndex(index - 1)}>
              이전
            </button>
          )}
          <button className="suite-button" autoFocus onClick={() => (last ? onFinish() : setIndex(index + 1))}>
            {last ? "시작하기" : "다음"}
          </button>
        </div>
      </div>
    </div>
  );
}
