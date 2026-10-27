import { useEffect, useMemo, useRef, useState } from "react";
import type { Menu } from "./MenuBar";

export interface Command {
  label: string;
  /** 어느 메뉴에 있는지 (예: "파일") */
  group?: string;
  shortcut?: string;
  onSelect: () => void;
}

/** 메뉴 전체를 검색할 수 있는 명령 목록으로 편다. 꺼진 항목은 뺀다. */
export function menuCommands(menus: Menu[]): Command[] {
  return menus.flatMap((menu) =>
    menu.items
      .filter((item) => !item.disabled && item.onSelect)
      .map((item) => ({ label: item.label, group: menu.label, shortcut: item.shortcut, onSelect: item.onSelect! })),
  );
}

interface CommandSearchProps {
  open: boolean;
  commands: Command[];
  onClose: () => void;
  title?: string;
  placeholder?: string;
  /** 화면 좌표. 주면 그 자리에 작은 메뉴로 뜬다 (예: 마우스 위치의 ‘추가’ 메뉴). */
  at?: { x: number; y: number } | null;
}

/**
 * 블렌더의 F3 검색처럼, 기능 이름을 몇 글자만 쳐서 바로 실행하는 창.
 * 메뉴가 어디 있는지 몰라도 되니 초보자에게도 편하다. 띄어쓰기를 무시하고, 글자가 순서대로만 들어 있으면 찾는다.
 */
export function CommandSearch({ open, commands, onClose, title, placeholder = "무엇을 할까요? 기능 이름을 쳐 보세요", at }: CommandSearchProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const results = useMemo(() => {
    const q = query.replace(/\s+/g, "").toLowerCase();
    if (!q) return commands;
    return commands
      .map((c) => ({ c, score: matchScore(`${c.label}${c.group ?? ""}`.replace(/\s+/g, "").toLowerCase(), q) }))
      .filter((r) => r.score >= 0)
      .sort((a, b) => a.score - b.score)
      .map((r) => r.c);
  }, [commands, query]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.onSelect();
  };

  const style = at
    ? { left: Math.max(8, Math.min(at.x, window.innerWidth - 300)), top: Math.max(8, Math.min(at.y, window.innerHeight - 430)), transform: "none" }
    : undefined;

  return (
    <div className="suite-command-backdrop" onMouseDown={onClose}>
      <div
        className={`suite-command${at ? " at" : ""}`}
        style={style}
        role="dialog"
        aria-label={title ?? "기능 검색"}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {title && <div className="suite-command-title">{title}</div>}
        <input
          ref={inputRef}
          className="suite-command-input"
          value={query}
          placeholder={placeholder}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") setActive((i) => Math.min(i + 1, results.length - 1));
            else if (e.key === "ArrowUp") setActive((i) => Math.max(i - 1, 0));
            else if (e.key === "Enter") run(results[active]);
            else return;
            e.preventDefault();
            e.stopPropagation();
          }}
        />
        <div className="suite-command-list" ref={listRef} role="listbox">
          {results.length === 0 && <div className="suite-command-empty">찾는 기능이 없어요.</div>}
          {results.map((c, i) => (
            <button
              key={`${c.group}/${c.label}`}
              role="option"
              aria-selected={i === active}
              className="suite-command-item"
              onMouseEnter={() => setActive(i)}
              onClick={() => run(c)}
            >
              <span>{c.label}</span>
              {c.group && !at && <span className="suite-command-group">{c.group}</span>}
              {c.shortcut && <kbd>{c.shortcut}</kbd>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 낮을수록 잘 맞는다. 글자가 순서대로 다 없으면 -1. 붙어 있는 글자, 앞쪽에서 맞는 것을 먼저 보여 준다. */
function matchScore(text: string, query: string): number {
  const direct = text.indexOf(query);
  if (direct >= 0) return direct;
  let pos = -1;
  let gaps = 0;
  for (const ch of query) {
    const next = text.indexOf(ch, pos + 1);
    if (next < 0) return -1;
    if (pos >= 0) gaps += next - pos - 1;
    pos = next;
  }
  return 100 + gaps;
}
