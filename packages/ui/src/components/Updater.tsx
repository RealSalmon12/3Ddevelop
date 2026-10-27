import { useCallback, useEffect, useRef, useState } from "react";
import type { UpdateInfo } from "@suite/shell/bridge";

type Phase = { kind: "idle" } | { kind: "available"; info: UpdateInfo } | { kind: "downloading"; ratio: number };

/**
 * 새 버전 확인과 설치. 앱을 켜고 잠시 뒤 한 번 조용히 확인하고,
 * 도움말 메뉴의 "업데이트 확인" 은 check(true) 로 결과를 알림으로 보여 준다.
 */
export function useUpdater(notify: (message: string) => void) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const check = useCallback(
    async (manual = false) => {
      const updates = window.suite?.updates;
      if (!updates) return manual && notify("업데이트 확인은 설치한 프로그램에서만 돼요.");
      const result = await updates.check();
      if (!result.ok) return manual && notify(result.message);
      if (result.update) {
        setPhase({ kind: "available", info: result.update });
        if (manual) notify(`새 버전(빌드 ${result.update.build})이 있어요. 오른쪽 위 ‘새 버전’ 버튼을 눌러 주세요.`);
      } else if (manual) {
        notify(result.dev ? "개발 모드라서 업데이트를 확인하지 않아요." : `최신 버전이에요 (빌드 ${result.current}).`);
      }
    },
    [notify],
  );

  useEffect(() => {
    const timer = setTimeout(() => void check(), 4000);
    return () => clearTimeout(timer);
  }, [check]);

  const install = useCallback(async () => {
    const updates = window.suite?.updates;
    if (!updates || phase.kind !== "available") return;
    const info = phase.info;
    setPhase({ kind: "downloading", ratio: 0 });
    const result = await updates.install((ratio) => setPhase({ kind: "downloading", ratio }));
    if (!result.ok) {
      notify(result.message);
      setPhase({ kind: "available", info });
    }
  }, [phase, notify]);

  return { phase, check, install };
}

/** 메뉴바 오른쪽에 새 버전이 있을 때만 나타나는 버튼과 작은 안내 창 */
export function UpdateButton({
  updater,
  hasUnsavedWork,
}: {
  updater: ReturnType<typeof useUpdater>;
  hasUnsavedWork: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { phase } = updater;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current?.contains(e.target as Node) || setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  if (phase.kind === "idle") return null;
  const downloading = phase.kind === "downloading";

  return (
    <div className="suite-update" ref={ref}>
      <button className="suite-menubar-action update" aria-expanded={open} onClick={() => setOpen(!open)}>
        {downloading ? `받는 중 ${Math.round(phase.ratio * 100)}%` : "새 버전"}
      </button>
      {open && (
        <div className="suite-update-card" role="dialog" aria-label="업데이트">
          {downloading ? (
            <>
              <p className="suite-update-title">새 버전을 받고 있어요</p>
              <div className="suite-update-bar">
                <div style={{ width: `${Math.round(phase.ratio * 100)}%` }} />
              </div>
              <p className="suite-update-note">다 받으면 프로그램이 잠깐 닫혔다가 새 버전으로 다시 열려요.</p>
            </>
          ) : (
            <>
              <p className="suite-update-title">새 버전이 나왔어요</p>
              <p className="suite-update-note">
                빌드 {phase.info.build} · {(phase.info.size / 1024 / 1024).toFixed(0)}MB. 설치하는 동안 프로그램이 잠깐 닫혀요.
              </p>
              {hasUnsavedWork && <p className="suite-update-warn">저장하지 않은 작업이 있어요. 먼저 저장해 주세요.</p>}
              <div className="suite-update-actions">
                <a href={phase.info.page} target="_blank" rel="noreferrer">
                  바뀐 점 보기
                </a>
                <button className="suite-update-go" disabled={hasUnsavedWork} onClick={() => void updater.install()}>
                  지금 업데이트
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
