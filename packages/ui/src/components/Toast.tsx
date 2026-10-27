import { useCallback, useEffect, useState } from "react";

/** 잠깐 떴다 사라지는 알림. const [toast, notify] = useToast(); 로 쓰고 <Toast message={toast} /> 를 그린다. */
export function useToast(duration = 2500) {
  const [message, setMessage] = useState<{ text: string; key: number } | null>(null);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), duration);
    return () => clearTimeout(timer);
  }, [message, duration]);

  const notify = useCallback((text: string) => setMessage({ text, key: Date.now() }), []);
  return [message, notify] as const;
}

export function Toast({ message }: { message: { text: string; key: number } | null }) {
  if (!message) return null;
  return (
    <div className="suite-toast" key={message.key} role="status">
      {message.text}
    </div>
  );
}
