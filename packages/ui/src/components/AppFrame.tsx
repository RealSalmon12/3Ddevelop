import type { ReactNode } from "react";

interface AppFrameProps {
  menubar: ReactNode;
  toolbar?: ReactNode;
  sidebar?: ReactNode;
  statusbar?: ReactNode;
  children: ReactNode;
}

/** 모든 앱이 같은 배치를 쓴다: 위 메뉴, 작업 공간 왼쪽에 떠 있는 도구, 오른쪽 패널, 아래 상태 표시줄. */
export function AppFrame({ menubar, toolbar, sidebar, statusbar, children }: AppFrameProps) {
  return (
    <div className="suite-frame">
      {menubar}
      <div className="suite-body">
        <main className="suite-main">
          {children}
          {toolbar && <div className="suite-dock">{toolbar}</div>}
        </main>
        {sidebar ? <aside className="suite-side">{sidebar}</aside> : <div />}
      </div>
      {statusbar ?? <div />}
    </div>
  );
}
