import { useEffect } from "react";
import type { PixelDoc } from "./doc/PixelDoc";

const INTERVAL_MS = 20_000;

/**
 * 프로그램이 갑자기 꺼져도 그림을 되살릴 수 있게, 저장하지 않은 그림을 20초마다 디스크에 적어 둔다.
 * 정상적으로 닫거나 파일로 저장하면 지운다.
 */
export function useAutosave(doc: PixelDoc, dirty: boolean, notify: (message: string) => void, onRecovered: () => void) {
  useEffect(() => {
    const autosave = window.suite?.autosave;
    if (!autosave) return;
    let cancelled = false;
    autosave.read().then((saved) => {
      if (cancelled || !saved) return;
      const when = new Date(saved.time).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
      if (window.confirm(`지난번에 프로그램이 저장하지 않은 채로 꺼졌어요 (${when}).\n그때 그림을 다시 불러올까요?`)) {
        try {
          doc.recover(saved.text);
          onRecovered();
          notify("지난 그림을 되살렸어요. 잊지 말고 저장해 주세요 (Ctrl+S).");
        } catch {
          notify("자동 저장본이 망가져서 불러오지 못했어요.");
        }
      }
      void autosave.write(null);
    });
    return () => {
      cancelled = true;
    };
  }, [doc, notify, onRecovered]);

  useEffect(() => {
    const autosave = window.suite?.autosave;
    if (!autosave) return;
    if (!dirty) return void autosave.write(null);
    const timer = setInterval(() => void autosave.write(doc.serialize()), INTERVAL_MS);
    return () => clearInterval(timer);
  }, [doc, dirty]);

  useEffect(() => {
    const clear = () => void window.suite?.autosave.write(null);
    window.addEventListener("pagehide", clear);
    return () => window.removeEventListener("pagehide", clear);
  }, []);
}
