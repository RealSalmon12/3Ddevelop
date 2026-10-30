// 디스코드 운영 자동화. GitHub Actions 가 실행한다.
//   node tools/discord/ops.mjs remind  매일: Pro 끝나기 3일 전 DM, 유예까지 끝나면 💎 구독자 역할 빼기
//   node tools/discord/ops.mjs weekly  매주 월요일: 🖼️┃작품-자랑 에 이번 주 챌린지, 🧾┃운영-기록 에 주간 보고
//   node tools/discord/ops.mjs promo   버튼으로: 📣┃공지 에 새 영상·소식 올리기 (PROMO_* 환경 변수)
//   node tools/discord/ops.mjs scheduled  매일 저녁: promo-schedule.json 에서 오늘 날짜(한국 시간) 공지를 올리기
//
// 기록은 운영진만 보이는 🧾┃운영-기록 채널에 봇이 남기는 한 줄 표시로 한다 (저장소가 공개라 여기 두지 않는다).
//   `#pro <사용자ID> <끝 날짜> <키 번호>`     키를 보냈을 때 (issue.mjs)
//   `#remind <사용자ID> <끝 날짜>`           만료 알림 DM 을 보냈을 때
//   `#expired <사용자ID> <끝 날짜>`          유예가 끝나 역할을 뺐을 때
//   `#stats <JSON>`                          주간 보고 (다음 주에 늘어난 수를 셀 때 쓴다)
//   `#promo <날짜> <링크>`                   예약 공지를 올렸을 때 (같은 날 두 번 돌아도 한 번만 올린다)
import { readFileSync } from "node:fs";
import { api, guildId, sameName, token } from "./api.mjs";

export const OPS_CHANNEL = "🧾┃운영-기록";
const SHOWCASE_CHANNEL = "🖼️┃작품-자랑";
const NOTICE_CHANNEL = "📣┃공지";
const SUBSCRIBER_ROLE_NAME = "💎 구독자";
const LICENSE_CHANNEL = "🎫┃라이선스-문의";
const REPO = "RealSalmon12/3Ddevelop";
const DAY = 86400000;
/** 앱과 같은 유예 기간 (packages/shell/src/license.ts GRACE_DAYS) */
const GRACE_DAYS = 3;
const REMIND_DAYS = 3;

const APP_NAMES = { hub: "허브", modeler: "바코 빙산", pixel: "바코 눈꽃", photo: "바코 진주", sound: "바코 파도", video: "바코 오로라" };

/** 매주 돌아가며 내는 챌린지. 주 번호로 고른다 */
export const CHALLENGES = [
  { app: "바코 빙산", title: "나만의 로블록스 모자 만들기", tip: "구 하나로 시작해서 조각 모드로 빚어 보세요." },
  { app: "바코 눈꽃", title: "16×16 몬스터 그리기", tip: "좌우 대칭을 켜면 반만 그려도 돼요." },
  { app: "바코 파도", title: "내 게임에 쓸 효과음 3개", tip: "생성 → 게임 효과음 만들기에서 시작해 보세요." },
  { app: "바코 진주", title: "노을 사진 색감 살리기", tip: "이미지 → 조정: 활기, 곡선 S자를 써 보세요." },
  { app: "바코 오로라", title: "15초 쇼츠 만들기", tip: "시퀀스 → 화면 크기: 쇼츠로 바꾸고 시작해요." },
  { app: "바코 빙산", title: "작은 집 꾸미기", tip: "파일 → 예제 열기: 작은 집에 이펙트를 넣어 보세요." },
  { app: "바코 눈꽃", title: "걷는 캐릭터 4프레임 애니메이션", tip: "양파 껍질을 켜면 앞 프레임이 비쳐요." },
  { app: "바코 오로라", title: "자막이 물체를 따라가는 영상", tip: "💎 모션 트래킹: 클립 메뉴에서 켜요." },
];

const day = (d) => d.toISOString().slice(0, 10);
const today = () => new Date(`${day(new Date())}T00:00:00Z`);

async function channelByName(name) {
  const channels = await api("GET", `/guilds/${guildId}/channels`);
  return channels.find((c) => sameName(c.name, name) && c.type !== 4);
}

/** 🧾┃운영-기록 에 한 줄 남긴다. 채널이 없으면 (서버 세팅 전) 조용히 넘어간다 */
export async function logOps(text, marker) {
  const ch = await channelByName(OPS_CHANNEL);
  if (!ch) return console.log(`ℹ️ ${OPS_CHANNEL} 채널이 없어서 기록은 건너뛰어요 (‘디스코드 서버 세팅’ 을 다시 돌려 주세요).`);
  await api("POST", `/channels/${ch.id}/messages`, { content: marker ? `${text}\n\`${marker}\`` : text, allowed_mentions: { parse: [] } });
}

/** 봇이 남긴 표시들을 오래된 것부터 읽는다 (최대 2000개) */
async function readMarks(ch) {
  const me = await api("GET", "/users/@me");
  const all = [];
  let before;
  for (let i = 0; i < 20; i++) {
    const page = await api("GET", `/channels/${ch.id}/messages?limit=100${before ? `&before=${before}` : ""}`);
    all.push(...page);
    if (page.length < 100) break;
    before = page[page.length - 1].id;
  }
  const marks = [];
  for (const m of all.reverse()) {
    if (m.author?.id !== me.id) continue;
    const found = /`#(\w+) ([^`]*)`/.exec(m.content ?? "");
    if (found) marks.push({ kind: found[1], args: found[2].split(" "), raw: found[2] });
  }
  return marks;
}

async function remind() {
  const ch = await channelByName(OPS_CHANNEL);
  if (!ch) return console.log(`${OPS_CHANNEL} 채널이 없어요. ‘디스코드 서버 세팅’ 을 먼저 돌려 주세요.`);
  const marks = await readMarks(ch);
  // 사람마다 가장 늦게 끝나는 키만 본다 (갱신하면 새 키가 덮는다)
  const latest = new Map();
  for (const m of marks.filter((m) => m.kind === "pro")) {
    const [user, until] = m.args;
    if (!latest.has(user) || latest.get(user) < until) latest.set(user, until);
  }
  const done = new Set(marks.filter((m) => m.kind === "remind" || m.kind === "expired").map((m) => `${m.kind} ${m.args[0]} ${m.args[1]}`));
  const now = today().getTime();
  const lounge = await channelByName(LICENSE_CHANNEL);
  const roles = await api("GET", `/guilds/${guildId}/roles`);
  const role = roles.find((r) => r.name === SUBSCRIBER_ROLE_NAME);
  let reminded = 0;
  let expired = 0;
  for (const [user, until] of latest) {
    const end = Date.parse(`${until}T00:00:00Z`);
    const left = Math.round((end - now) / DAY);
    if (left <= REMIND_DAYS && left >= 0 && !done.has(`remind ${user} ${until}`)) {
      try {
        const dm = await api("POST", "/users/@me/channels", { recipient_id: user });
        await api("POST", `/channels/${dm.id}/messages`, {
          content:
            `💎 **바코 스튜디오 Pro** 가 **${until}** 에 끝나요 (끝나도 ${GRACE_DAYS}일은 그대로 써요).\n` +
            `계속 쓰려면 ${lounge ? `<#${lounge.id}>` : LICENSE_CHANNEL} 에 💳 **구매·결제** 태그로 ‘연장할게요’ 라고 글을 남겨 주세요. 자동 결제는 없어서, 연장하지 않으면 그냥 무료판으로 돌아가요. 만든 파일은 그대로 열려요.`,
        });
        await logOps(`⏰ <@${user}> 님에게 Pro 만료 알림 DM 을 보냈어요 (${until} 끝).`, `#remind ${user} ${until}`);
        reminded++;
      } catch (e) {
        await logOps(`⚠️ <@${user}> 님에게 만료 알림 DM 을 못 보냈어요 (${until} 끝). 직접 알려 주세요.`, `#remind ${user} ${until}`);
        console.log(`::warning::DM 실패 ${user}: ${e.message}`);
      }
    }
    if (left < -GRACE_DAYS && !done.has(`expired ${user} ${until}`)) {
      if (role) await api("DELETE", `/guilds/${guildId}/members/${user}/roles/${role.id}`, undefined, `Pro 끝 (${until})`).catch(() => {});
      await logOps(`🔚 <@${user}> 님의 Pro 가 끝나서 (${until} + 유예 ${GRACE_DAYS}일) 💎 구독자 역할을 뺐어요.`, `#expired ${user} ${until}`);
      expired++;
    }
  }
  const active = [...latest.values()].filter((u) => Date.parse(`${u}T00:00:00Z`) + GRACE_DAYS * DAY >= now).length;
  console.log(`✅ 구독 중 ${active}명 · 만료 알림 ${reminded}명 · 역할 뺌 ${expired}명`);
}

/** 앱별 설치 파일 다운로드 수 (GitHub Releases) */
async function downloads() {
  const out = {};
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100&page=${page}`, {
      headers: { Accept: "application/vnd.github+json", ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) },
    });
    if (!res.ok) throw new Error(`GitHub Releases 를 못 읽었어요 (${res.status})`);
    const list = await res.json();
    for (const r of list) {
      const app = /^(\w+)-build-\d+$/.exec(r.tag_name)?.[1];
      if (!app) continue;
      out[app] = (out[app] ?? 0) + r.assets.reduce((n, a) => n + (a.name.endsWith(".exe") ? a.download_count : 0), 0);
    }
    if (list.length < 100) break;
  }
  return out;
}

function weekNumber(d = new Date()) {
  return Math.floor((d.getTime() - Date.UTC(2026, 0, 5)) / (7 * DAY));
}

async function weekly() {
  // 1) 이번 주 챌린지
  const c = CHALLENGES[((weekNumber() % CHALLENGES.length) + CHALLENGES.length) % CHALLENGES.length];
  const showcase = await channelByName(SHOWCASE_CHANNEL);
  if (showcase) {
    await api("POST", `/channels/${showcase.id}/messages`, {
      embeds: [
        {
          title: `🏆 이번 주 챌린지: ${c.title}`,
          color: 0xffc83d,
          description:
            `**${c.app}** 로 만들어서 이 채널에 올려 주세요! 완성 못 해도 괜찮아요.\n\n` +
            `💡 팁: ${c.tip}\n\n` +
            "다음 주 월요일까지 올린 작품 중 운영진이 하나를 골라 **💎 Pro 1개월** 을 선물해요.",
        },
      ],
    });
    console.log(`✅ 챌린지 올림: ${c.title}`);
  }

  // 2) 주간 보고 (운영진 채널)
  const ops = await channelByName(OPS_CHANNEL);
  if (!ops) return console.log(`${OPS_CHANNEL} 채널이 없어서 주간 보고는 건너뛰어요.`);
  const marks = await readMarks(ops);
  const prev = marks.filter((m) => m.kind === "stats").map((m) => JSON.parse(m.raw)).pop() ?? {};
  const guild = await api("GET", `/guilds/${guildId}?with_counts=true`);
  const dl = await downloads().catch((e) => (console.log(`::warning::${e.message}`), {}));
  const now = today().getTime();
  const latest = new Map();
  for (const m of marks.filter((m) => m.kind === "pro")) {
    const [user, until] = m.args;
    if (!latest.has(user) || latest.get(user) < until) latest.set(user, until);
  }
  const subs = [...latest.values()].filter((u) => Date.parse(`${u}T00:00:00Z`) + GRACE_DAYS * DAY >= now).length;
  const keysThisWeek = marks.filter((m) => m.kind === "pro").length - (prev.keys ?? 0);
  const stats = { date: day(new Date()), members: guild.approximate_member_count ?? 0, subs, keys: marks.filter((m) => m.kind === "pro").length, dl };
  const diff = (a, b) => (b === undefined ? "" : ` (${a - b >= 0 ? "+" : ""}${a - b})`);
  const dlLines = Object.entries(APP_NAMES)
    .filter(([k]) => dl[k] !== undefined)
    .map(([k, name]) => `• ${name}: ${dl[k]}${diff(dl[k], prev.dl?.[k])}`)
    .join("\n");
  await logOps(
    `📊 **주간 보고** (${stats.date})\n` +
      `• 디스코드 인원: ${stats.members}${diff(stats.members, prev.members)}\n` +
      `• 💎 구독 중: ${subs}명${diff(subs, prev.subs)} · 이번 주 보낸 키: ${Math.max(0, keysThisWeek)}개\n` +
      `**설치 파일 다운로드 (누적)**\n${dlLines || "• (못 읽었어요)"}\n` +
      `이번 주 챌린지: ${c.title}`,
    `#stats ${JSON.stringify(stats)}`,
  );
  console.log("✅ 주간 보고를 올렸어요.");
}

async function postNotice({ title, url = "", text = "", everyone = false }) {
  if (!title) throw new Error("제목을 넣어 주세요.");
  if (url && !/^https:\/\//.test(url)) throw new Error("링크는 https:// 로 시작해야 해요.");
  const ch = await channelByName(NOTICE_CHANNEL);
  if (!ch) throw new Error(`${NOTICE_CHANNEL} 채널이 없어요.`);
  const msg = await api("POST", `/channels/${ch.id}/messages`, {
    content: [everyone ? "@everyone" : "", url].filter(Boolean).join("\n") || undefined,
    embeds: [{ title, ...(url ? { url } : {}), color: 0xb39dff, description: text || undefined }],
    allowed_mentions: { parse: everyone ? ["everyone"] : [] },
  });
  if (ch.type === 5) await api("POST", `/channels/${ch.id}/messages/${msg.id}/crosspost`).catch(() => {});
  console.log(`✅ ${NOTICE_CHANNEL} 에 올렸어요: ${title}`);
}

async function promo() {
  await postNotice({
    title: (process.env.PROMO_TITLE ?? "").trim(),
    url: (process.env.PROMO_URL ?? "").trim(),
    text: (process.env.PROMO_TEXT ?? "").trim(),
    everyone: process.env.PROMO_PING === "true",
  });
}

async function scheduled() {
  const list = JSON.parse(readFileSync(new URL("./promo-schedule.json", import.meta.url), "utf8"));
  const kstToday = day(new Date(Date.now() + 9 * 3600000));
  const due = list.filter((p) => p.date === kstToday);
  if (!due.length) return console.log(`ℹ️ ${kstToday} 에 올릴 예약 공지가 없어요.`);
  const ops = await channelByName(OPS_CHANNEL);
  const done = new Set(ops ? (await readMarks(ops)).filter((m) => m.kind === "promo").map((m) => m.raw) : []);
  for (const p of due) {
    const key = `${p.date} ${p.url}`;
    if (done.has(key)) {
      console.log(`ℹ️ 이미 올렸어요: ${p.title}`);
      continue;
    }
    await postNotice(p);
    await logOps(`📣 예약 공지: ${p.title}`, `#promo ${key}`);
  }
}

const COMMANDS = { remind, weekly, promo, scheduled };

if (process.argv[1]?.endsWith("ops.mjs")) {
  const cmd = COMMANDS[process.argv[2]];
  if (!cmd) {
    console.error(`사용법: node tools/discord/ops.mjs ${Object.keys(COMMANDS).join("|")}`);
    process.exit(1);
  }
  if (!token) {
    console.log("DISCORD_BOT_TOKEN 이 없어서 건너뛰어요.");
    process.exit(0);
  }
  cmd().catch((e) => {
    console.error(`::error::${e.message}`);
    process.exit(1);
  });
}
