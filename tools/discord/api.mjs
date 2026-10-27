// 디스코드 REST API 를 부르는 작은 도우미. setup / verify / announce 가 같이 쓴다.
export const API = "https://discord.com/api/v10";
export const DEFAULT_GUILD_ID = "1564532143848300595";

export const token = (process.env.DISCORD_BOT_TOKEN ?? "").trim();
export const guildId = (process.env.DISCORD_GUILD_ID ?? "").trim() || DEFAULT_GUILD_ID;

// 디스코드가 이름을 살짝 바꿔 저장할 수 있어서(소문자, 띄어쓰기→-, 이모지 꼬리표) 비교할 때 맞춰 준다.
const norm = (name) => name.replace(/️/g, "").toLowerCase().replace(/[\s-]+/g, "-");
export const sameName = (a, b) => norm(a) === norm(b);

export async function api(method, path, body, reason) {
  for (;;) {
    const res = await fetch(API + path, {
      method,
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "BacoStudioSetup (https://github.com/RealSalmon12/3Ddevelop, 1.0)",
        ...(reason ? { "X-Audit-Log-Reason": encodeURIComponent(reason) } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429) {
      const data = await res.json().catch(() => ({}));
      await new Promise((r) => setTimeout(r, Math.ceil((data.retry_after ?? 1) * 1000) + 100));
      continue;
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
      err.status = res.status;
      err.code = data?.code;
      throw err;
    }
    return data;
  }
}
