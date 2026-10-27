import type { ReactNode } from "react";

interface StatusBarProps {
  /** 지금 무엇을 할 수 있는지 알려주는 안내 문장 */
  hint: string;
  children?: ReactNode;
}

export function StatusBar({ hint, children }: StatusBarProps) {
  return (
    <footer className="suite-statusbar">
      <span className="suite-statusbar-hint">{hint}</span>
      {children}
    </footer>
  );
}
