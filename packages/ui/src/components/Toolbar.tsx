export interface Tool {
  id: string;
  label: string;
  icon: string;
  /** 마우스를 올리면 나오는 설명. 초보자를 위해 무엇을 하는 도구인지 한 문장으로 쓴다. */
  hint: string;
  shortcut?: string;
}

interface ToolbarProps {
  tools: Tool[];
  active: string;
  onChange: (id: string) => void;
}

export function Toolbar({ tools, active, onChange }: ToolbarProps) {
  return (
    <nav className="suite-toolbar" aria-label="도구">
      {tools.map((tool) => (
        <button
          key={tool.id}
          className="suite-tool"
          aria-pressed={tool.id === active}
          title={tool.shortcut ? `${tool.hint} (${tool.shortcut})` : tool.hint}
          onClick={() => onChange(tool.id)}
        >
          <span className="suite-tool-icon" aria-hidden>
            {tool.icon}
          </span>
          {tool.label}
        </button>
      ))}
    </nav>
  );
}
