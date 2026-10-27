import type { Tool } from "@suite/ui";

export type ToolId = "pencil" | "eraser" | "fill" | "picker" | "line" | "rect" | "ellipse" | "move";

export const TOOLS: (Tool & { id: ToolId })[] = [
  { id: "pencil", label: "연필", icon: "✎", hint: "칸을 하나씩 칠해요. 오른쪽 버튼으로 누르면 지워요", shortcut: "B" },
  { id: "eraser", label: "지우개", icon: "⌫", hint: "칠한 칸을 지워서 투명하게 만들어요", shortcut: "E" },
  { id: "fill", label: "채우기", icon: "🪣", hint: "같은 색으로 이어진 곳을 한 번에 칠해요", shortcut: "G" },
  { id: "picker", label: "스포이트", icon: "💧", hint: "그림에서 색을 콕 집어 가져와요 (Alt 를 누른 채 클릭해도 돼요)", shortcut: "I" },
  { id: "line", label: "직선", icon: "╱", hint: "끌어서 곧은 선을 그어요", shortcut: "L" },
  { id: "rect", label: "네모", icon: "▢", hint: "끌어서 네모를 그려요", shortcut: "U" },
  { id: "ellipse", label: "동그라미", icon: "◯", hint: "끌어서 동그라미를 그려요", shortcut: "O" },
  { id: "move", label: "옮기기", icon: "✥", hint: "지금 레이어의 그림을 통째로 끌어서 옮겨요", shortcut: "V" },
];

export const TOOL_KEYS: Record<string, ToolId> = Object.fromEntries(
  TOOLS.map((t) => [t.shortcut!.toLowerCase(), t.id]),
) as Record<string, ToolId>;

export const HINTS: Record<ToolId, string> = {
  pencil: "왼쪽 클릭: 칠하기 · 오른쪽 클릭: 지우기 · 휠: 확대/축소 · Space+끌기 또는 휠 버튼 끌기: 화면 옮기기",
  eraser: "끌어서 지워요 · [ ] 키로 크기 바꾸기 · 휠: 확대/축소",
  fill: "클릭한 곳과 같은 색으로 이어진 곳을 모두 칠해요",
  picker: "그림을 클릭하면 그 색을 골라요",
  line: "끌어서 곧은 선 · [ ] 키로 굵기 바꾸기",
  rect: "끌어서 네모 · 위의 ‘속 채우기’를 켜면 꽉 찬 네모",
  ellipse: "끌어서 동그라미 · 위의 ‘속 채우기’를 켜면 꽉 찬 동그라미",
  move: "끌어서 지금 레이어를 옮겨요. 캔버스 밖으로 나간 부분은 잘려요",
};

export interface ToolOptions {
  tool: ToolId;
  color: string;
  /** 붓 크기 (칸) */
  size: number;
  /** 좌우 대칭으로 함께 그리기 */
  mirror: boolean;
  /** 네모, 동그라미 속 채우기 */
  filled: boolean;
  grid: boolean;
}

/** 글자를 입력하는 칸에 있으면 단축키를 쓰지 않는다. 체크박스나 색 고르기 칸은 괜찮다. */
export const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLTextAreaElement ||
  (target instanceof HTMLInputElement && ["text", "password", "search", "number"].includes(target.type));
