import { useEffect } from "react";

export const SIZES = [
  { size: 16, label: "16 × 16", hint: "작은 아이콘, 아이템. 처음이라면 여기서 시작해요" },
  { size: 32, label: "32 × 32", hint: "캐릭터, 몬스터, 조금 더 자세한 아이템" },
  { size: 64, label: "64 × 64", hint: "자세한 그림, 게임 바닥·벽 텍스처" },
  { size: 128, label: "128 × 128", hint: "로블록스 데칼, 큰 텍스처, 티셔츠 그림" },
];

/** 새 그림 크기 고르기 */
export function NewFileDialog({ onPick, onClose }: { onPick: (size: number) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="dialog-dim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label="새 그림">
        <h2>새 그림 크기를 골라요</h2>
        <p>칸이 적을수록 그리기 쉬워요. 나중에 내보낼 때 크게 키울 수 있어요.</p>
        <div className="size-grid">
          {SIZES.map((s) => (
            <button key={s.size} className="size-card" onClick={() => onPick(s.size)}>
              <span className="size-demo" style={{ ["--cells" as string]: Math.min(s.size, 16) }} />
              <b>{s.label}</b>
              <span>{s.hint}</span>
            </button>
          ))}
        </div>
        <div className="dialog-actions">
          <button className="suite-ai-link" onClick={onClose}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
