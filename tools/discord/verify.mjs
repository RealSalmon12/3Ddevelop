// ✅ 인증 처리: 인증 채널의 안내 글에 ✅ 를 누른 사람에게 🐾 멤버 역할을 주고, 누른 ✅ 는 치운다.
// ‘디스코드 인증 처리’ 워크플로가 5분마다 실행한다 (.github/workflows/discord-verify.yml).
import { pathToFileURL } from "node:url";
import { api, guildId, sameName, token } from "./api.mjs";

export const VERIFY_CHANNEL = "✅┃인증";
export const VERIFY_EMOJI = "✅";
const MEMBER_ROLE = "🐾 멤버";

/** 처리한 사람 수를 돌려준다. */
export async function grantVerified() {
  const me = await api("GET", "/users/@me");
  const [channels, roles] = await Promise.all([api("GET", `/guilds/${guildId}/channels`), api("GET", `/guilds/${guildId}/roles`)]);
  const channel = channels.find((c) => sameName(c.name, VERIFY_CHANNEL));
  const role = roles.find((r) => r.name === MEMBER_ROLE);
  if (!channel || !role) return 0;

  const recent = await api("GET", `/channels/${channel.id}/messages?limit=50`);
  const message = recent.filter((m) => m.author?.id === me.id).at(-1); // 봇이 쓴 가장 오래된 글
  if (!message) return 0;

  const emoji = encodeURIComponent(VERIFY_EMOJI);
  let count = 0;
  let after = "0";
  for (;;) {
    const users = await api("GET", `/channels/${channel.id}/messages/${message.id}/reactions/${emoji}?limit=100&after=${after}`);
    if (users.length === 0) break;
    for (const user of users) {
      if (user.bot) continue;
      try {
        await api("PUT", `/guilds/${guildId}/members/${user.id}/roles/${role.id}`, undefined, "✅ 인증");
        count++;
      } catch (e) {
        // 서버를 이미 나간 사람이면 역할은 못 주지만 ✅ 는 치운다.
        if (e.code !== 10007) throw e;
      }
      await api("DELETE", `/channels/${channel.id}/messages/${message.id}/reactions/${emoji}/${user.id}`);
    }
    if (users.length < 100) break;
    after = users.at(-1).id;
  }
  return count;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!token) {
    console.log("디스코드 봇 토큰이 없어서 건너뛰어요.");
  } else {
    grantVerified()
      .then((n) => console.log(n ? `${n}명을 인증했어요.` : "새로 인증할 사람이 없어요."))
      .catch((e) => {
        console.error(String(e?.message ?? e));
        process.exit(1);
      });
  }
}
