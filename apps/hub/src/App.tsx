import { useCallback, useEffect, useState } from "react";
import { MenuBar, SUITE_NAME, Toast, UpdateButton, useToast, useUpdater, type Menu } from "@suite/ui";
import { SUITE_APPS, type SuiteApp } from "./catalog";
import type { AppState, HubListResult } from "./hubBridge";
import hubIcon from "./icons/hub.png";
import modelerIcon from "./icons/modeler.png";
import photoIcon from "./icons/photo.png";
import pixelIcon from "./icons/pixel.png";
import soundIcon from "./icons/sound.png";
import { AIKeyCard } from "./AIKeyCard";

const ICONS: Record<string, string> = { modeler: modelerIcon, pixel: pixelIcon, photo: photoIcon, sound: soundIcon };

type Busy = { id: string; ratio: number };

export function App() {
  const [toast, notify] = useToast(5000);
  const updater = useUpdater(notify);
  const [state, setState] = useState<HubListResult | null>(null);
  const [busy, setBusy] = useState<Busy | null>(null);

  const refresh = useCallback(
    async (force = false) => {
      if (!window.hub) return setState({ apps: [], unsupported: true });
      setState(await window.hub.list(force));
    },
    [],
  );

  useEffect(() => {
    void refresh();
    // 다른 창에서 설치하거나 지웠을 수도 있으니 창으로 돌아올 때 다시 살펴본다.
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  async function install(app: SuiteApp, update: boolean) {
    if (!window.hub || busy) return;
    setBusy({ id: app.id, ratio: 0 });
    const result = await window.hub.install(app.id, (ratio) => setBusy({ id: app.id, ratio }));
    setBusy(null);
    if (!result.ok) return notify(result.message);
    notify(update ? `${app.name}을(를) 새 버전으로 바꿨어요.` : `${app.name}을(를) 설치했어요. ‘열기’를 눌러 시작해 보세요!`);
    await refresh();
  }

  async function launch(app: SuiteApp) {
    const result = await window.hub?.launch(app.id);
    if (result && !result.ok) notify(result.message);
    else notify(`${app.name}을(를) 여는 중이에요…`);
  }

  const menus: Menu[] = [
    {
      label: "보기",
      items: [{ label: "목록 새로 고침", shortcut: "F5", onSelect: () => void refresh(true) }],
    },
    {
      label: "도움말",
      items: [
        { label: "업데이트 확인", onSelect: () => void updater.check(true) },
        {
          label: "모든 설치 파일 보기 (GitHub)",
          onSelect: () => window.open("https://github.com/RealSalmon12/3Ddevelop/releases"),
        },
      ],
    },
  ];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F5") {
        e.preventDefault();
        void refresh(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [refresh]);

  const ready = SUITE_APPS.filter((a) => a.tagPrefix);
  const coming = SUITE_APPS.filter((a) => !a.tagPrefix);

  return (
    <div className="hub">
      <MenuBar appName={SUITE_NAME} menus={menus} actions={<UpdateButton updater={updater} hasUnsavedWork={false} />} />
      <div className="hub-body">
        <main className="hub-main">
          <header className="hub-hero">
            <img src={hubIcon} alt="" className="hub-hero-logo" />
            <div>
              <h1>무엇을 만들어 볼까요?</h1>
              <p>처음이어도 괜찮아요. 프로그램을 골라 설치하고 바로 열어 보세요. 모두 같은 화면 구성과 같은 AI 도우미를 써요.</p>
            </div>
          </header>

          {state?.problem && <p className="hub-note warn">{state.problem}</p>}
          {state?.unsupported && (
            <p className="hub-note">이 컴퓨터에서는 설치와 실행을 할 수 없어요. Windows 에 설치한 허브에서 써 주세요.</p>
          )}

          <h2 className="hub-section">내 프로그램</h2>
          <div className="hub-grid">
            {ready.map((app) => (
              <AppCard
                key={app.id}
                app={app}
                state={state?.apps.find((s) => s.id === app.id)}
                loading={!state}
                busy={busy}
                onInstall={(update) => void install(app, update)}
                onLaunch={() => void launch(app)}
              />
            ))}
          </div>

          <h2 className="hub-section">곧 나와요</h2>
          <div className="hub-grid">
            {coming.map((app) => (
              <article key={app.id} className="hub-card soon" style={{ ["--app" as string]: app.color }}>
                <div className="hub-card-icon letter">{app.name[0]}</div>
                <div className="hub-card-text">
                  <h3>
                    {app.name} <span className="hub-chip">{app.likeness}</span>
                  </h3>
                  <p>{app.description}</p>
                </div>
                <div className="hub-card-actions">
                  <span className="hub-status">준비 중</span>
                </div>
              </article>
            ))}
          </div>
        </main>

        <aside className="hub-side">
          <AIKeyCard notify={notify} />
          <section className="hub-side-card">
            <h2>처음이라면 이렇게</h2>
            <ol className="hub-steps">
              <li>만들고 싶은 것에 맞는 프로그램의 <b>설치</b>를 눌러요.</li>
              <li>다 되면 <b>열기</b>를 눌러요. 처음 열면 1분짜리 따라하기 안내가 나와요.</li>
              <li>막히면 오른쪽 <b>✨ AI 도우미</b>에게 글로 부탁해요.</li>
              <li>새 버전이 나오면 여기 노란 <b>업데이트</b> 버튼이 생겨요.</li>
            </ol>
          </section>
        </aside>
      </div>
      <Toast message={toast} />
    </div>
  );
}

function AppCard({
  app,
  state,
  loading,
  busy,
  onInstall,
  onLaunch,
}: {
  app: SuiteApp;
  state: AppState | undefined;
  loading: boolean;
  busy: Busy | null;
  onInstall: (update: boolean) => void;
  onLaunch: () => void;
}) {
  const installed = state?.installed;
  const latest = state?.latest;
  const hasUpdate = !!(installed && latest && installed.build > 0 && latest.build > installed.build);
  const mine = busy?.id === app.id;

  let status: string;
  if (loading) status = "확인하는 중…";
  else if (mine) status = busy!.ratio < 1 ? `받는 중 ${Math.round(busy!.ratio * 100)}%` : "설치하는 중…";
  else if (hasUpdate) status = `새 버전이 있어요 (빌드 ${installed!.build} → ${latest!.build})`;
  else if (installed) status = installed.build ? `설치됨 · 빌드 ${installed.build}` : "설치됨";
  else if (latest) status = `설치 파일 ${Math.max(1, Math.round(latest.size / 1024 / 1024))}MB`;
  else status = "아직 설치 파일이 없어요";

  return (
    <article className="hub-card" style={{ ["--app" as string]: app.color }}>
      <img className="hub-card-icon" src={ICONS[app.id]} alt="" />
      <div className="hub-card-text">
        <h3>
          {app.name} <span className="hub-chip">{app.likeness}</span>
        </h3>
        <p>{app.description}</p>
      </div>
      <div className="hub-card-actions">
        <span className={hasUpdate ? "hub-status new" : installed ? "hub-status ok" : "hub-status"}>{status}</span>
        {mine && (
          <div className="hub-progress">
            <div style={{ width: `${Math.round(busy!.ratio * 100)}%` }} />
          </div>
        )}
        <div className="hub-buttons">
          {hasUpdate && (
            <button className="hub-button update" disabled={!!busy} onClick={() => onInstall(true)} title="열려 있으면 잠깐 닫혔다가 새 버전이 돼요">
              업데이트
            </button>
          )}
          {installed ? (
            <button className="hub-button open" disabled={mine} onClick={onLaunch}>
              열기
            </button>
          ) : (
            <button className="hub-button" disabled={!latest || !!busy} onClick={() => onInstall(false)}>
              설치
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
