import type { ReactNode } from "react";

interface PanelProps {
  title: string;
  /** 남은 세로 공간을 모두 차지할지 */
  grow?: boolean;
  className?: string;
  children: ReactNode;
}

export function Panel({ title, grow, className, children }: PanelProps) {
  return (
    <section className={["suite-panel", grow && "grow", className].filter(Boolean).join(" ")}>
      <div className="suite-panel-title">{title}</div>
      <div className="suite-panel-body">{children}</div>
    </section>
  );
}
