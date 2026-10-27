import type { Tool } from "@suite/ui";

export type ToolId = "pencil" | "eraser" | "fill" | "picker" | "line" | "rect" | "ellipse" | "select" | "wand" | "move" | "shade" | "gradient" | "text";

export const TOOLS: (Tool & { id: ToolId })[] = [
  { id: "pencil", label: "연필", icon: "✎", hint: "칸을 하나씩 칠해요. 오른쪽 버튼으로 누르면 지워요", shortcut: "B" },
  { id: "eraser", label: "지우개", icon: "⌫", hint: "칠한 칸을 지워서 투명하게 만들어요", shortcut: "E" },
  { id: "shade", label: "명암 붓", icon: "◐", hint: "지나간 칸의 색을 팔레트에서 한 칸 밝게(왼쪽) 또는 어둡게(오른쪽 버튼) 바꿔요", shortcut: "D" },
  { id: "fill", label: "채우기", icon: "🪣", hint: "같은 색으로 이어진 곳을 한 번에 칠해요", shortcut: "G" },
  { id: "gradient", label: "그라디언트", icon: "▤", hint: "끌어서 전경색에서 배경색으로 바뀌는 그라디언트를 칠해요 (바이어 디더링)", shortcut: "N" },
  { id: "picker", label: "스포이트", icon: "💧", hint: "그림에서 색을 콕 집어 가져와요 (Alt 를 누른 채 클릭해도 돼요)", shortcut: "I" },
  { id: "line", label: "직선", icon: "╱", hint: "끌어서 곧은 선을 그어요 (Shift: 45도 단위)", shortcut: "L" },
  { id: "rect", label: "네모", icon: "▢", hint: "끌어서 네모를 그려요 (Shift: 정사각형)", shortcut: "U" },
  { id: "ellipse", label: "동그라미", icon: "◯", hint: "끌어서 동그라미를 그려요 (Shift: 정원)", shortcut: "O" },
  { id: "text", label: "글자", icon: "T", hint: "아래 도구 설정에 쓴 글자를 그림에 찍어요", shortcut: "T" },
  { id: "select", label: "네모 선택", icon: "⬚", hint: "끌어서 고를 곳을 정해요 (Shift: 더하기, Alt: 빼기)", shortcut: "M" },
  { id: "wand", label: "자동 선택", icon: "✨", hint: "같은 색으로 이어진 칸을 한 번에 골라요", shortcut: "W" },
  { id: "move", label: "옮기기", icon: "✥", hint: "고른 부분(없으면 레이어 전체)을 끌어서 옮겨요. 방향키로 한 칸씩", shortcut: "V" },
];

export const TOOL_KEYS: Record<string, ToolId> = Object.fromEntries(
  TOOLS.map((t) => [t.shortcut!.toLowerCase(), t.id]),
) as Record<string, ToolId>;

export const HINTS: Record<ToolId, string> = {
  pencil: "왼쪽: 칠하기 · 오른쪽: 지우기 · Shift+클릭: 마지막 점에서 직선 · 휠: 확대 · Space+끌기: 화면 옮기기",
  eraser: "끌어서 지워요 · [ ] 키로 크기 바꾸기 · 휠: 확대/축소",
  shade: "왼쪽: 팔레트에서 한 칸 밝게 · 오른쪽: 한 칸 어둡게 · 팔레트 순서가 밝기 순서일 때 가장 좋아요",
  fill: "클릭한 곳과 같은 색으로 이어진 곳을 칠해요 · ‘이어진 곳만’을 끄면 같은 색을 모두 바꿔요",
  picker: "그림을 클릭하면 그 색을 골라요",
  line: "끌어서 곧은 선 · Shift: 45도 단위 · [ ] 키로 굵기 바꾸기",
  rect: "끌어서 네모 · Shift: 정사각형 · ‘속 채우기’를 켜면 꽉 찬 네모",
  ellipse: "끌어서 동그라미 · Shift: 정원 · ‘속 채우기’를 켜면 꽉 찬 동그라미",
  gradient: "끌기: 전경색 → 배경색 · 오른쪽 끌기: 전경색 → 투명 · 고른 곳이 있으면 그 안에만 · Shift: 45도",
  text: "클릭한 채로 끌어서 자리를 정하고 놓으면 찍혀요 · 글자, 크기, 굵게는 도구 설정에서 · 한글은 크기 12 이상이 또렷해요",
  select: "끌어서 고르기 · Shift: 더하기 · Alt: 빼기 · Ctrl+D: 고르기 풀기 · Delete: 지우기 · Ctrl+C/V: 복사/붙여넣기",
  wand: "클릭: 같은 색 영역 고르기 · Shift: 더하기 · Alt: 빼기",
  move: "끌어서 옮기기 · 방향키: 한 칸 · Shift+방향키: 8칸",
};

export type Symmetry = "none" | "x" | "y" | "both";

export interface ToolOptions {
  tool: ToolId;
  color: string;
  /** 배경색 (그라디언트 끝 색) */
  secondary: string;
  gradient: "linear" | "radial";
  /** 그라디언트를 두 색 바이어 무늬로 (끄면 사이 색을 섞는다) */
  gradientDither: boolean;
  text: string;
  textSize: number;
  textBold: boolean;
  /** 붓 크기 (칸) */
  size: number;
  symmetry: Symmetry;
  /** 네모, 동그라미 속 채우기 */
  filled: boolean;
  grid: boolean;
  /** 채우기·자동 선택이 이어진 곳만 */
  contiguous: boolean;
  /** 꺾인 곳의 군더더기 칸을 없애는 연필 (픽셀 퍼펙트) */
  pixelPerfect: boolean;
  /** 바둑판 무늬로 칠하기 (디더링) */
  dither: boolean;
  /** 타일 모드: 그림이 사방으로 이어져 보이고, 끝을 넘어 칠하면 반대편에 칠해진다 */
  tile: boolean;
  /** 앞뒤 프레임을 흐리게 보여 주기 */
  onion: boolean;
}

/** 글자를 입력하는 칸에 있으면 단축키를 쓰지 않는다. 체크박스나 색 고르기 칸은 괜찮다. */
export const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLInputElement && ["text", "password", "search", "number"].includes(target.type));
