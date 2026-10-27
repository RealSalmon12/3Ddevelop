export interface Tool {
  id: string;
  label: string;
  icon: string;
  /** 마우스를 올리면 나오는 설명. 초보자를 위해 무엇을 하는 도구인지 한 문장으로 쓴다. */
  hint: string;
  shortcut?: string;
}

/** 누르면 바로 한 번 실행되는 버튼 (예: 돌출) */
export interface ToolAction extends Omit<Tool, "id"> {
  onRun: () => void;
  disabled?: boolean;
}

interface ToolbarProps {
  tools: Tool[];
  active: string;
  onChange: (id: string) => void;
  /** 도구 아래에 구분선과 함께 놓는 실행 버튼들 */
  actions?: { title: string; items: ToolAction[] };
}

const tooltip = (t: { hint: string; shortcut?: string }) => (t.shortcut ? `${t.hint} (${t.shortcut})` : t.hint);

export function Toolbar({ tools, active, onChange, actions }: ToolbarProps) {
  return (
    <nav className="suite-toolbar" aria-label="도구">
      {tools.map((tool) => (
        <button
          key={tool.id}
          className="suite-tool"
          aria-pressed={tool.id === active}
          title={tooltip(tool)}
          onClick={() => onChange(tool.id)}
        >
          <span className="suite-tool-icon" aria-hidden>
            {tool.icon}
          </span>
          {tool.label}
        </button>
      ))}
      {actions && (
        <>
          <div className="suite-toolbar-divider">{actions.title}</div>
          {actions.items.map((action) => (
            <button
              key={action.label}
              className="suite-tool"
              title={tooltip(action)}
              disabled={action.disabled}
              onClick={action.onRun}
            >
              <span className="suite-tool-icon" aria-hidden>
                {action.icon}
              </span>
              {action.label}
            </button>
          ))}
        </>
      )}
    </nav>
  );
}
