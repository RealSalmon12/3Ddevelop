import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { LicenseStatus } from "@suite/shell/bridge";
import { PRO_URL, SUITE_NAME } from "../brand";

/**
 * 바코 스튜디오 Pro: 키 하나로 모든 앱의 전문가 기능을 연다.
 * 키 확인은 메인 프로세스(license.ts)가 하고, 화면은 여기 상태만 본다.
 */
interface State {
  status: LicenseStatus;
  loaded: boolean;
  /** 열려 있는 라이선스 창. feature 는 잠긴 기능을 누르다 열렸을 때 그 이름 */
  dialog: { feature?: string } | null;
}

let state: State = { status: { plan: "free" }, loaded: false, dialog: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export async function refreshLicense() {
  const s = await window.suite?.license?.status().catch(() => null);
  set({ status: s ?? state.status, loaded: true });
}

/** 지금 Pro 인지 (이벤트 처리 안에서 바로 쓰기) */
export const isPro = () => state.status.plan === "pro";

/**
 * Pro 기능 입구에서 부른다. Pro 가 아니면 안내 창을 열고 false.
 * 예: `if (!requirePro("타일맵 편집기")) return;`
 */
export function requirePro(feature: string): boolean {
  if (isPro()) return true;
  set({ dialog: { feature } });
  return false;
}

export const openLicense = () => set({ dialog: {} });

export function useLicense() {
  const s = useSyncExternalStore(subscribe, () => state);
  return { ...s.status, loaded: s.loaded, pro: s.status.plan === "pro" };
}

/** Pro 로 열리는 것 (안내 창에 보여 준다) */
const PRO_FEATURES: [string, string][] = [
  ["바코 빙산", "뼈대(리깅)와 포즈, 움직이는 캐릭터 GLB 내보내기"],
  ["바코 오로라", "그래프 에디터, 모션 트래킹, 프레임 정확한 내보내기"],
  ["바코 진주", "액션 녹화와 폴더 일괄 처리"],
  ["바코 파도", "여러 소리 파일 일괄 처리와 라우드니스 맞추기"],
  ["바코 눈꽃", "타일맵 편집기 (Tiled·CSV 내보내기)"],
];

/** 메뉴바 오른쪽의 Pro 배지. 누르면 라이선스 창이 열린다 */
export function LicenseBadge() {
  const lic = useLicense();
  const dialog = useSyncExternalStore(subscribe, () => state.dialog);

  useEffect(() => {
    if (!state.loaded) void refreshLicense();
    // 다른 앱에서 키를 넣었거나 기간이 지났을 수 있으니 창으로 돌아올 때와 한 시간마다 다시 본다
    const onFocus = () => void refreshLicense();
    window.addEventListener("focus", onFocus);
    const timer = setInterval(onFocus, 60 * 60 * 1000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(timer);
    };
  }, []);

  const soon = lic.pro && (lic.grace || (lic.daysLeft ?? 99) <= 5);
  const label = !lic.pro ? (lic.expired ? "Pro 기간 끝남" : "💎 Pro 알아보기") : lic.grace ? "💎 Pro · 갱신 필요" : soon ? `💎 Pro · ${lic.daysLeft}일 남음` : "💎 Pro";
  return (
    <>
      <button
        className={`suite-menubar-action license ${lic.pro ? "pro" : "free"}${soon || lic.expired ? " warn" : ""}`}
        title={lic.pro ? `${SUITE_NAME} Pro · ${lic.until} 까지` : `무료판이에요. Pro 로 전문가 기능을 열 수 있어요.`}
        onClick={openLicense}
      >
        {label}
      </button>
      {dialog && createPortal(<LicenseDialog feature={dialog.feature} onClose={() => set({ dialog: null })} />, document.body)}
    </>
  );
}

function LicenseDialog({ feature, onClose }: { feature?: string; onClose: () => void }) {
  const lic = useLicense();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const bridge = window.suite?.license;

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, [onClose]);

  const activate = async () => {
    if (!bridge || !key.trim()) return;
    setBusy(true);
    setError(null);
    const s = await bridge.activate(key).catch((e) => ({ plan: "free" as const, error: String(e) }));
    setBusy(false);
    if (s.error) return setError(s.error);
    set({ status: s });
    setKey("");
    setDone(true);
  };

  const remove = async () => {
    if (!bridge || !confirm("이 컴퓨터에서 키를 뺄까요? 무료판으로 돌아가요. 키를 다시 넣으면 그대로 열려요.")) return;
    set({ status: await bridge.remove() });
    setDone(false);
  };

  return (
    <div className="suite-license-dim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="suite-license" role="dialog" aria-label="라이선스">
        <div className="suite-license-head">
          <span className="suite-license-gem" aria-hidden>
            💎
          </span>
          <div>
            <h2>{SUITE_NAME} Pro</h2>
            <p>키 하나로 다섯 앱의 전문가 기능이 모두 열려요.</p>
          </div>
        </div>

        {feature && !lic.pro && (
          <p className="suite-license-lock">
            🔒 <b>{feature}</b> 은(는) Pro 기능이에요. 무료판에서도 만든 파일은 모두 열고 저장할 수 있어요.
          </p>
        )}

        {lic.pro ? (
          <div className={`suite-license-status ok${lic.grace ? " warn" : ""}`}>
            <b>{done ? "🎉 Pro 가 열렸어요!" : "Pro 사용 중"}</b>
            <span>
              {lic.to ? `${lic.to} 님 · ` : ""}
              {lic.until} 까지
              {lic.grace ? " (기간이 끝났어요. 며칠 안에 새 키를 넣어 주세요)" : (lic.daysLeft ?? 0) <= 5 ? ` (${lic.daysLeft}일 남음)` : ""}
            </span>
            <small>키 번호 {lic.id}</small>
          </div>
        ) : lic.expired ? (
          <div className="suite-license-status warn">
            <b>Pro 기간이 끝났어요 ({lic.until})</b>
            <span>새 키를 넣으면 바로 다시 열려요. 작업한 파일은 그대로예요.</span>
          </div>
        ) : null}

        <ul className="suite-license-features">
          {PRO_FEATURES.map(([app, what]) => (
            <li key={app}>
              <b>{app}</b>
              <span>{what}</span>
            </li>
          ))}
        </ul>

        {bridge ? (
          <div className="suite-license-key">
            <label htmlFor="suite-license-input">{lic.pro ? "새 키로 바꾸기 (다음 달 키)" : "라이선스 키"}</label>
            <textarea
              id="suite-license-input"
              rows={3}
              spellCheck={false}
              placeholder="BACO- 로 시작하는 키를 통째로 붙여 넣어 주세요"
              value={key}
              onChange={(e) => (setKey(e.target.value), setError(null))}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void activate();
                }
              }}
            />
            {error && <p className="suite-license-error">{error}</p>}
          </div>
        ) : (
          <p className="suite-license-error">키 넣기는 설치한 프로그램에서만 돼요.</p>
        )}

        <div className="suite-license-actions">
          {lic.id && (
            <button className="suite-license-link" onClick={() => void remove()}>
              이 컴퓨터에서 키 빼기
            </button>
          )}
          <span className="spacer" />
          {!lic.pro && (
            <button className="suite-button ghost" onClick={() => window.open(PRO_URL)}>
              구독하러 가기 (디스코드)
            </button>
          )}
          {bridge && (
            <button className="suite-button" disabled={busy || !key.trim()} onClick={() => void activate()}>
              {busy ? "확인 중…" : "키 넣기"}
            </button>
          )}
          <button className="suite-button ghost" onClick={onClose}>
            {lic.pro ? "닫기" : "나중에"}
          </button>
        </div>
        <p className="suite-license-note">키는 인터넷 없이 이 컴퓨터에서 확인해요. 매달 디스코드 DM 으로 새 키를 보내 드려요.</p>
      </div>
    </div>
  );
}
