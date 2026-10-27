import { useEffect } from "react";
import type { ModelerScene } from "./ModelerScene";

const INTERVAL_MS = 20_000;

/**
 * 프로그램이 갑자기 꺼져도 작업을 되살릴 수 있게, 저장하지 않은 장면을 20초마다 디스크에 적어 둔다.
 * 정상적으로 닫거나 파일로 저장하면 지운다. 그래서 다음에 켰을 때 남아 있다면 비정상 종료였다는 뜻이다.
 */
export function useAutosave(model: ModelerScene, dirty: boolean, notify: (message: string) => void) {
  // 켤 때 한 번: 남은 자동 저장본이 있으면 되살릴지 묻는다.
  useEffect(() => {
    const autosave = window.suite?.autosave;
    if (!autosave) return;
    let cancelled = false;
    autosave.read().then((saved) => {
      if (cancelled || !saved) return;
      const when = new Date(saved.time).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
      if (window.confirm(`지난번에 프로그램이 저장하지 않은 채로 꺼졌어요 (${when}).\n그때 작업을 다시 불러올까요?`)) {
        try {
          model.recover(saved.text);
          notify("지난 작업을 되살렸어요. 잊지 말고 저장해 주세요 (Ctrl+S).");
        } catch {
          notify("자동 저장본이 망가져서 불러오지 못했어요.");
        }
      }
      void autosave.write(null);
    });
    return () => {
      cancelled = true;
    };
  }, [model, notify]);

  useEffect(() => {
    const autosave = window.suite?.autosave;
    if (!autosave) return;
    if (!dirty) return void autosave.write(null);
    const timer = setInterval(() => void autosave.write(model.serialize()), INTERVAL_MS);
    return () => clearInterval(timer);
  }, [model, dirty]);

  // 정상적으로 닫힐 때 (저장하지 않고 닫기를 고른 경우 포함) 는 되살릴 필요가 없다.
  useEffect(() => {
    const clear = () => void window.suite?.autosave.write(null);
    window.addEventListener("pagehide", clear);
    return () => window.removeEventListener("pagehide", clear);
  }, []);
}
