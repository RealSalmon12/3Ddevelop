import { app, safeStorage } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AIRequest, AIResponse, AIStatus } from "./bridge";

// 제품군의 모든 앱이 같은 AI 설정을 함께 쓴다.
const MODEL = "claude-sonnet-5-5";
const API_URL = "https://api.anthropic.com/v1/messages";

const keyFile = () => path.join(app.getPath("userData"), "..", "nuguna-studio-ai.json");

let cachedKey: string | null | undefined;

/** API 키는 Windows 계정으로 암호화해서 저장한다. */
async function loadKey(): Promise<string | null> {
  if (cachedKey !== undefined) return cachedKey;
  try {
    const { key } = JSON.parse(await readFile(keyFile(), "utf8")) as { key: string };
    cachedKey = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(Buffer.from(key, "base64"))
      : Buffer.from(key, "base64").toString("utf8");
  } catch {
    cachedKey = null;
  }
  return cachedKey;
}

export async function setApiKey(key: string): Promise<AIStatus> {
  const trimmed = key.trim();
  const stored = !trimmed
    ? ""
    : safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(trimmed).toString("base64")
      : Buffer.from(trimmed, "utf8").toString("base64");
  await writeFile(keyFile(), JSON.stringify({ key: stored }));
  cachedKey = trimmed || null;
  return { configured: !!cachedKey };
}

export async function aiStatus(): Promise<AIStatus> {
  return { configured: !!(await loadKey()) };
}

export async function askAI(request: AIRequest): Promise<AIResponse> {
  const key = await loadKey();
  if (!key) {
    return {
      ok: false,
      reason: "not-configured",
      message: "AI 를 쓰려면 먼저 Anthropic API 키를 넣어 주세요. 패널 위의 ‘API 키 설정’을 눌러요.",
    };
  }

  const messages = [
    ...(request.history ?? []).map((m) => ({ role: m.role, content: m.text })),
    {
      role: "user" as const,
      content:
        request.context === undefined
          ? request.prompt
          : `현재 상태:\n${JSON.stringify(request.context)}\n\n요청: ${request.prompt}`,
    },
  ];

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8000,
        system: request.system,
        messages,
        ...(request.tool && { tools: [request.tool], tool_choice: { type: "tool", name: request.tool.name } }),
      }),
    });
    const body = (await res.json()) as {
      content?: ({ type: "text"; text: string } | { type: "tool_use"; input: unknown })[];
      error?: { message: string };
    };
    if (!res.ok) {
      const message =
        res.status === 401
          ? "API 키가 맞지 않아요. ‘API 키 설정’에서 다시 넣어 주세요."
          : res.status === 429
            ? "요청이 너무 많아요. 잠시 뒤에 다시 해 주세요."
            : `AI 요청이 실패했어요. (${res.status}) ${body.error?.message ?? ""}`;
      return { ok: false, reason: res.status === 401 ? "not-configured" : "error", message };
    }

    const text = body.content?.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n") ?? "";
    const toolInput = body.content?.find((c) => c.type === "tool_use") as { input: unknown } | undefined;
    return { ok: true, text, toolInput: toolInput?.input };
  } catch (err) {
    return { ok: false, reason: "error", message: `인터넷 연결을 확인해 주세요. (${String(err)})` };
  }
}
