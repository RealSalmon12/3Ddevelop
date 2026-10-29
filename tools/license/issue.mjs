// 바코 스튜디오 Pro 라이선스 키 만들기.
//
// 키 모양: BACO-<내용 base64url>.<서명 base64url>. 내용은 { v, id, to, plan, from, until } JSON 이고,
// 서명은 내용 base64url 글자 그대로에 Ed25519 비밀 열쇠로 한다. 앱은 packages/shell/src/license.ts 의
// 공개 열쇠로 확인한다. 비밀 열쇠는 GitHub 비밀 값 LICENSE_PRIVATE_KEY 에만 둔다 (저장소에 올리지 말 것).
//
// 1) GitHub Actions ‘라이선스 키 보내기’ (보통 이걸 쓴다)
//    DISCORD_USER_ID 사람에게 키를 디스코드 DM 으로 보내고 💎 구독자 역할을 붙인다.
//    저장소가 공개라 실행 기록도 공개된다. 그래서 키는 절대 기록에 찍지 않고 키 번호만 남긴다.
//
// 2) 내 컴퓨터에서 (DM 이 막힌 사람에게 직접 줄 때)
//    node tools/license/issue.mjs --to "이름" --days 31 --key-file 비밀열쇠.txt
//    키를 화면에 찍는다. 이 키를 공개된 곳에 붙여 넣지 말 것.
import { createPrivateKey, createPublicKey, randomBytes, sign, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { api, guildId, token } from "../discord/api.mjs";

// setup.mjs 가 만든 💎 구독자 역할. 이름으로도 찾는다 (역할을 다시 만들었을 때를 위해).
const SUBSCRIBER_ROLE_ID = "1565153015839723670";
const SUBSCRIBER_ROLE_NAME = "💎 구독자";

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const day = (d) => d.toISOString().slice(0, 10);

/** 키 하나를 만든다. start 는 YYYY-MM-DD (없으면 오늘, UTC) */
export function issueKey(privateKeyPem, { to, days = 31, start }) {
  const from = start ? new Date(`${start}T00:00:00Z`) : new Date(`${day(new Date())}T00:00:00Z`);
  if (Number.isNaN(from.getTime())) throw new Error(`시작 날짜를 읽을 수 없어요: ${start}`);
  if (!(days >= 1 && days <= 400)) throw new Error(`기간은 1~400일이어야 해요: ${days}`);
  const until = new Date(from.getTime() + (days - 1) * 86400000);
  const payload = { v: 1, id: randomBytes(4).toString("hex").toUpperCase(), to: String(to).slice(0, 64), plan: "pro", from: day(from), until: day(until) };
  const body = b64url(JSON.stringify(payload));
  const sig = sign(null, Buffer.from(body), createPrivateKey(privateKeyPem));
  return { key: `BACO-${body}.${b64url(sig)}`, payload };
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

// 앱(packages/shell/src/license.ts)에 들어 있는 공개 열쇠와 같아야 한다
const APP_PUBLIC_KEY = "MCowBQYDK2VwAyEAwEW+TFPUYxhgTwXoPsTtT4YjSwDhINEeT356JK50wrE=";

/** 비밀 값이 앱의 공개 열쇠와 짝이 맞는지만 본다 (아무에게도 보내지 않음) */
function checkPair(pem) {
  const { key } = issueKey(pem, { to: "check", days: 1 });
  const [, body, sig] = /^BACO-(.+)\.(.+)$/.exec(key);
  const pub = createPublicKey({ key: Buffer.from(APP_PUBLIC_KEY, "base64"), format: "der", type: "spki" });
  const ok = verify(null, Buffer.from(body), pub, Buffer.from(sig.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
  if (!ok) throw new Error("LICENSE_PRIVATE_KEY 가 앱의 공개 열쇠와 짝이 맞지 않아요. 비밀 값을 파일 내용 그대로 다시 넣어 주세요.");
  console.log("✅ LICENSE_PRIVATE_KEY 가 앱과 짝이 맞아요. 이 열쇠로 만든 키는 앱에서 열려요.");
}

async function sendByDiscord(pem) {
  const userId = (process.env.DISCORD_USER_ID ?? "").trim();
  if (userId === "check") return checkPair(pem);
  if (!/^\d{15,22}$/.test(userId)) throw new Error("디스코드 사용자 ID(숫자)를 넣어 주세요. 디스코드 설정 → 고급 → 개발자 모드를 켜고 사람을 오른쪽 클릭 → ‘사용자 ID 복사’.");
  if (!token) throw new Error("DISCORD_BOT_TOKEN 비밀 값이 없어요.");
  const days = Number(process.env.DAYS || 31);
  const start = (process.env.START ?? "").trim() || undefined;

  const user = await api("GET", `/users/${userId}`);
  const to = user.global_name || user.username;
  const { key, payload } = issueKey(pem, { to, days, start });
  // 혹시 다른 단계가 찍더라도 가려지게
  if (process.env.GITHUB_ACTIONS) console.log(`::add-mask::${key}`);

  const dm = await api("POST", "/users/@me/channels", { recipient_id: userId });
  try {
    await api("POST", `/channels/${dm.id}/messages`, {
      content:
        `💎 **바코 스튜디오 Pro** 라이선스 키예요. 고마워요, ${to} 님!\n\n` +
        "```\n" + key + "\n```\n" +
        `• 기간: **${payload.from} ~ ${payload.until}** (끝나도 3일은 그대로 써요)\n` +
        "• 아무 바코 스튜디오 앱이나 열고 오른쪽 위 **💎 Pro 알아보기** → 키를 통째로 붙여 넣기 → **키 넣기**\n" +
        "• 키 하나로 모든 앱에서 써요. 인터넷이 없어도 돼요.\n" +
        "• 이 키는 나만 써요. 채팅이나 게시판에 올리지 마세요.\n" +
        `• 문의할 때는 키 대신 키 번호 **${payload.id}** 를 알려 주세요.`,
    });
  } catch (e) {
    if (e.code === 50007) throw new Error("이 사람에게 DM 을 보낼 수 없어요 (DM 을 막아 두었거나 서버에 없어요). 서버 멤버 DM 허용을 부탁하거나, 내 컴퓨터에서 --key-file 로 만들어 직접 전해 주세요.");
    throw e;
  }
  console.log(`✅ ${to} 님에게 키를 DM 으로 보냈어요. 키 번호 ${payload.id}, 기간 ${payload.from} ~ ${payload.until}`);

  // 💎 구독자 역할 붙이기 (안 돼도 키는 이미 보냈으니 경고만)
  try {
    const roles = await api("GET", `/guilds/${guildId}/roles`);
    const role = roles.find((r) => r.id === SUBSCRIBER_ROLE_ID) ?? roles.find((r) => r.name === SUBSCRIBER_ROLE_NAME);
    if (!role) throw new Error("💎 구독자 역할을 찾지 못했어요 (‘디스코드 서버 세팅’ 을 먼저 돌려 주세요).");
    await api("PUT", `/guilds/${guildId}/members/${userId}/roles/${role.id}`, undefined, `Pro 라이선스 ${payload.id}`);
    console.log(`✅ ${SUBSCRIBER_ROLE_NAME} 역할을 붙였어요.`);
  } catch (e) {
    console.log(`::warning::역할은 못 붙였어요: ${e.message}`);
  }
}

async function main() {
  const file = arg("key-file");
  const pem = (file ? readFileSync(file, "utf8") : process.env.LICENSE_PRIVATE_KEY ?? "").trim();
  if (!pem.includes("PRIVATE KEY")) throw new Error("비밀 열쇠가 없어요. GitHub 비밀 값 LICENSE_PRIVATE_KEY 를 넣거나 --key-file 로 알려 주세요.");
  if (file) {
    const { key, payload } = issueKey(pem, { to: arg("to") ?? "구독자", days: Number(arg("days") ?? 31), start: arg("start") });
    console.log(`키 번호 ${payload.id} · ${payload.to} · ${payload.from} ~ ${payload.until}\n\n${key}`);
    return;
  }
  await sendByDiscord(pem);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("issue.mjs")) {
  main().catch((e) => {
    console.error(`::error::${e.message}`);
    process.exit(1);
  });
}
