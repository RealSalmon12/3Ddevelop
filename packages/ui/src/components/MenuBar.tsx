import { useEffect, useRef, useState, type ReactNode } from "react";
import { SUITE_NAME } from "../brand";
import { LicenseBadge } from "./License";

export interface MenuItem {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onSelect?: () => void;
}

export interface Menu {
  label: string;
  items: MenuItem[];
}

interface MenuBarProps {
  appName: string;
  menus: Menu[];
  /** 메뉴 오른쪽 끝에 놓을 버튼들 (예: AI 도우미 켜기) */
  actions?: ReactNode;
}

export function MenuBar({ appName, menus, actions }: MenuBarProps) {
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open === null) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="suite-menubar" ref={ref}>
      <span className="suite-menubar-brand" title={SUITE_NAME}>
        <Logo />
        {appName}
      </span>
      {menus.map((menu, i) => (
        <div className="suite-menu" key={menu.label}>
          <button
            className="suite-menu-button"
            aria-expanded={open === i}
            onClick={() => setOpen(open === i ? null : i)}
            onMouseEnter={() => open !== null && setOpen(i)}
          >
            {menu.label}
          </button>
          {open === i && (
            <div className="suite-menu-list" role="menu">
              {menu.items.map((item) => (
                <button
                  key={item.label}
                  className="suite-menu-item"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => {
                    setOpen(null);
                    item.onSelect?.();
                  }}
                >
                  <span>{item.label}</span>
                  {item.shortcut && <kbd>{item.shortcut}</kbd>}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      <div className="suite-menubar-spacer" />
      <LicenseBadge />
      {actions}
    </div>
  );
}

/** 제품군 로고: 해바라기 노랑 윗면을 가진 작은 정육면체 */
function Logo() {
  return (
    <svg className="suite-menubar-logo" viewBox="0 0 24 24" aria-hidden>
      <path d="M12 2.5 21 7.5 12 12.5 3 7.5Z" fill="#ffc83d" />
      <path d="M3 7.5 12 12.5V22L3 17Z" fill="#b39dff" />
      <path d="M21 7.5 12 12.5V22L21 17Z" fill="#6f5fd1" />
    </svg>
  );
}
