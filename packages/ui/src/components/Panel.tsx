import type { ReactNode } from "react";

interface PanelProps {
  title: string;
  /** 남은 세로 공간을 모두 차지할지 */
  grow?: boolean;
  children: ReactNode;
}

export function Panel({ title, grow, children }: PanelProps) {
  return (
    <section className={grow ? "suite-panel grow" : "suite-panel"}>
      <div className="suite-panel-title">{title}</div>
      <div className="suite-panel-body">{children}</div>
    </section>
  );
}
