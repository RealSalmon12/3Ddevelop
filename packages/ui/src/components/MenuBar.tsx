import { useEffect, useRef, useState, type ReactNode } from "react";
import { SUITE_NAME } from "../brand";

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
      {actions}
    </div>
  );
}
