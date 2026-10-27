// 바코 스튜디오 디스코드 서버를 한 번에 꾸며 주는 도구.
// GitHub Actions 의 ‘디스코드 서버 세팅’ 워크플로가 실행한다 (.github/workflows/discord.yml).
// 직접 돌릴 때: DISCORD_BOT_TOKEN=... node tools/discord/setup.mjs
//
// - 봇 토큰은 GitHub 비밀값(DISCORD_BOT_TOKEN)으로만 받는다. 저장소에 절대 넣지 않는다.
// - 이미 있는 역할·채널은 이름으로 알아보고 건너뛰므로 여러 번 실행해도 괜찮다.
// - 원래 있던 채널은 지우지 않는다.
const DEFAULT_GUILD_ID = "1564532143848300595";
const API = "https://discord.com/api/v10";

// 디스코드 권한 비트
const P = {
  createInvite: 1n << 0n,
  kick: 1n << 1n,
  ban: 1n << 2n,
  addReactions: 1n << 6n,
  viewChannel: 1n << 10n,
  sendMessages: 1n << 11n,
  manageMessages: 1n << 13n,
  embedLinks: 1n << 14n,
  attachFiles: 1n << 15n,
  readHistory: 1n << 16n,
  mentionEveryone: 1n << 17n,
  muteMembers: 1n << 22n,
  moveMembers: 1n << 24n,
  manageNicknames: 1n << 27n,
  manageThreads: 1n << 34n,
  createPublicThreads: 1n << 35n,
  sendInThreads: 1n << 38n,
  moderateMembers: 1n << 40n,
};
const bits = (...list) => list.reduce((a, b) => a | b, 0n).toString();

const TEXT = 0;
const VOICE = 2;
const CATEGORY = 4;
const ANNOUNCEMENT = 5;
const FORUM = 15;

const COLORS = { sunflower: 0xffc83d, lilac: 0xb39dff, mint: 0x5fd3a4, ice: 0x8fd3ff };

const ROLES = [
  {
    key: "staff",
    name: "🦭 운영진",
    color: COLORS.sunflower,
    hoist: true,
    mentionable: true,
    permissions: bits(
      P.kick, P.ban, P.manageMessages, P.manageThreads, P.manageNicknames,
      P.muteMembers, P.moveMembers, P.moderateMembers, P.mentionEveryone,
    ),
  },
  {
    key: "helper",
    name: "🧊 도우미",
    color: COLORS.mint,
    hoist: true,
    mentionable: true,
    permissions: bits(P.manageThreads),
  },
];

const APP_TAGS = [
  { name: "허브", emoji_name: "🦭" },
  { name: "바코 빙산 (3D)", emoji_name: "🧊" },
  { name: "바코 눈꽃 (픽셀)", emoji_name: "❄️" },
  { name: "바코 진주 (사진)", emoji_name: "🦪" },
  { name: "바코 파도 (소리)", emoji_name: "🌊" },
  { name: "바코 오로라 (영상)", emoji_name: "🌌" },
];

// readOnly: 일반 멤버는 읽기만 하고 운영진만 글을 쓴다.
const LAYOUT = [
  {
    category: "📢 안내",
    channels: [
      { key: "rules", name: "📜┃규칙", type: TEXT, readOnly: true, topic: "꼭 읽어 주세요! 모두가 즐겁게 지내기 위한 약속이에요." },
      { key: "welcome", name: "👋┃처음-오셨나요", type: TEXT, readOnly: true, topic: "바코 스튜디오가 처음이라면 여기부터! 설치 방법과 채널 안내가 있어요." },
      { key: "notice", name: "📣┃공지", type: ANNOUNCEMENT, readOnly: true, topic: "운영진의 공지사항" },
      { key: "updates", name: "🆕┃업데이트", type: ANNOUNCEMENT, readOnly: true, topic: "새 버전이 나오면 자동으로 알려 드려요." },
    ],
  },
  {
    category: "💬 바다코끼리 광장",
    channels: [
      { key: "chat", name: "💬┃자유-대화", type: TEXT, topic: "아무 이야기나 편하게 나눠요." },
      { key: "intro", name: "🙋┃자기소개", type: TEXT, topic: "어떤 걸 만들고 싶은지 소개해 주세요!" },
    ],
  },
  {
    category: "🎨 프로그램별 이야기",
    channels: [
      { name: "🧊┃바코-빙산", type: TEXT, topic: "3D 모델링 프로그램 바코 빙산 이야기 (로블록스 모델, AI 모델링, 꾸미기 효과)" },
      { name: "❄️┃바코-눈꽃", type: TEXT, topic: "픽셀 아트 프로그램 바코 눈꽃 이야기 (로블록스 옷, 아이콘)" },
      { name: "🦪┃바코-진주", type: TEXT, topic: "사진 편집 프로그램 바코 진주 이야기" },
      { name: "🌊┃바코-파도", type: TEXT, topic: "소리 편집 프로그램 바코 파도 이야기" },
      { name: "🌌┃바코-오로라", type: TEXT, topic: "영상 편집 프로그램 바코 오로라 이야기" },
    ],
  },
  {
    category: "🛟 도움 받기",
    channels: [
      {
        key: "help",
        name: "❓┃질문-도움",
        type: FORUM,
        topic: "막히는 게 있으면 글을 하나 올려 주세요. 어떤 프로그램인지 태그를 붙이면 더 빨리 답을 받을 수 있어요. 해결되면 ‘해결됨’ 태그를 달아 주세요!",
        tags: [...APP_TAGS, { name: "해결됨", emoji_name: "✅" }],
      },
      {
        key: "bugs",
        name: "🐛┃버그-제보",
        type: FORUM,
        topic: "이상하게 동작하는 걸 찾으면 알려 주세요. ① 어떤 프로그램 ② 무엇을 했는지 ③ 어떻게 됐는지 ④ 화면 캡처가 있으면 최고예요!",
        tags: [...APP_TAGS, { name: "확인했어요", emoji_name: "👀" }, { name: "고쳤어요", emoji_name: "🛠️" }],
      },
      {
        key: "ideas",
        name: "💡┃기능-제안",
        type: FORUM,
        topic: "‘이런 기능 있으면 좋겠다!’ 하는 걸 올려 주세요. 마음에 드는 제안에는 👍 를 눌러 주세요.",
        tags: [...APP_TAGS, { name: "만드는 중", emoji_name: "🔨" }, { name: "추가됐어요", emoji_name: "🎉" }],
      },
    ],
  },
  {
    category: "🖼️ 작품 전시관",
    channels: [
      { key: "showcase", name: "🖼️┃작품-자랑", type: TEXT, topic: "바코 스튜디오로 만든 작품을 자랑해 주세요! 완성작이 아니어도 좋아요." },
      { key: "wip", name: "🚧┃만드는-중", type: TEXT, topic: "아직 만드는 중인 작품을 보여 주고 의견을 받아 보세요." },
      { key: "roblox", name: "🎮┃로블록스-제작", type: TEXT, topic: "바코 빙산·눈꽃으로 만든 걸 로블록스에 넣는 이야기" },
    ],
  },
  {
    category: "🔊 음성",
    channels: [
      { name: "🔊 같이 작업해요", type: VOICE },
      { name: "🔊 수다방", type: VOICE },
    ],
  },
];

const RULES = [
  "**1. 서로 친절하게 대해 주세요.** 처음 해 보는 사람도 많아요. 모르는 걸 물어보는 건 부끄러운 일이 아니에요.",
  "**2. 욕설, 비하, 괴롭힘은 안 돼요.** 다른 사람의 작품을 깎아내리지 말고, 의견은 부드럽게 말해 주세요.",
  "**3. 질문은 ❓┃질문-도움, 버그는 🐛┃버그-제보에 올려 주세요.** 글 하나에 이야기 하나씩 모이면 답을 찾기 쉬워요.",
  "**4. 남의 작품을 내 것처럼 올리지 마세요.** 다른 사람 작품을 참고했다면 출처를 적어 주세요.",
  "**5. 광고, 도배, 수상한 링크는 금지예요.** 무료 로벅스·니트로 같은 링크는 절대 누르지 마세요.",
  "**6. 개인정보를 지켜요.** 주소, 전화번호, 비밀번호, AI 키(sk-ant-…)는 절대 올리지 마세요.",
  "**7. 모두가 볼 수 있는 곳이에요.** 무섭거나 어른용 내용은 올리지 말아 주세요.",
];

function rulesEmbed() {
  return {
    title: "📜 바코 스튜디오 커뮤니티 규칙",
    color: COLORS.sunflower,
    description: `${RULES.join("\n\n")}\n\n규칙을 어기면 🦭 운영진이 경고하거나 내보낼 수 있어요. 궁금한 건 운영진에게 편하게 물어보세요!`,
  };
}

function welcomeEmbeds(ids) {
  const ch = (key) => (ids[key] ? `<#${ids[key]}>` : "");
  return [
    {
      title: "👋 바코 스튜디오에 오신 걸 환영해요!",
      color: COLORS.ice,
      description:
        "바코 스튜디오는 처음 해 보는 사람도 쉽게 쓸 수 있는 무료 창작 프로그램 모음이에요. 🦭\n\n" +
        "🧊 **바코 빙산** · 3D 모델링 (로블록스 모델, AI가 만들어 주는 모델)\n" +
        "❄️ **바코 눈꽃** · 픽셀 아트 (로블록스 옷, 아이콘)\n" +
        "🦪 **바코 진주** · 사진 편집\n" +
        "🌊 **바코 파도** · 소리 편집\n" +
        "🌌 **바코 오로라** · 영상 편집",
    },
    {
      title: "⬇️ 설치하는 법 (Windows)",
      color: COLORS.lilac,
      description:
        "1. 아래 링크에서 **바코 스튜디오 허브** 설치 파일(.exe)을 받아요.\n" +
        "2. 받은 파일을 실행하면 허브가 열려요.\n" +
        "3. 허브에서 원하는 프로그램의 **설치** 버튼을 누르면 끝!\n\n" +
        "https://github.com/RealSalmon12/3Ddevelop/releases/latest\n\n" +
        "새 버전이 나오면 프로그램이 알아서 알려 주고, " + ch("updates") + " 채널에도 소식이 올라와요.",
    },
    {
      title: "🧭 어디로 가면 될까요?",
      color: COLORS.mint,
      description: [
        `${ch("rules")} 먼저 규칙을 읽어 주세요`,
        `${ch("intro")} 반갑게 자기소개해요`,
        `${ch("help")} 모르는 게 있으면 질문해요`,
        `${ch("bugs")} 이상한 걸 찾으면 알려 주세요`,
        `${ch("ideas")} 갖고 싶은 기능을 제안해요`,
        `${ch("showcase")} 만든 작품을 자랑해요`,
      ]
        .filter((line) => !line.startsWith(" "))
        .join("\n"),
    },
  ];
}

// ───────────────────────── 디스코드 API ─────────────────────────

let token = "";

async function api(method, path, body, reason) {
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

// 디스코드가 이름을 살짝 바꿔 저장할 수 있어서(소문자, 띄어쓰기→-, 이모지 꼬리표) 비교할 때 맞춰 준다.
const norm = (name) => name.replace(/\uFE0F/g, "").toLowerCase().replace(/[\s-]+/g, "-");
const sameName = (a, b) => norm(a) === norm(b);

const say = (msg) => console.log(msg);
const done = (msg) => console.log(`  ✅ ${msg}`);
const skip = (msg) => console.log(`  ⏭️  ${msg} (이미 있어요)`);

async function main() {
  say("\n🦭 바코 스튜디오 디스코드 서버 세팅\n");
  token = (process.env.DISCORD_BOT_TOKEN ?? "").trim();
  const guildId = (process.env.DISCORD_GUILD_ID ?? "").trim() || DEFAULT_GUILD_ID;
  if (!token) {
    say("❌ 봇 토큰이 없어요. GitHub 저장소 Settings → Secrets and variables → Actions 에 DISCORD_BOT_TOKEN 을 저장해 주세요.");
    process.exit(1);
  }

  let app;
  try {
    app = await api("GET", "/oauth2/applications/@me");
  } catch (e) {
    if (e.status === 401) {
      say("\n❌ 토큰이 맞지 않아요. 디스코드 개발자 페이지의 Bot 메뉴에서 ‘Reset Token’으로 새 토큰을 받아 다시 해 보세요.");
      process.exit(1);
    }
    throw e;
  }

  // 봇이 아직 서버에 없으면 초대 링크를 알려 주고 멈춘다.
  let guild;
  try {
    guild = await api("GET", `/guilds/${guildId}`);
  } catch (e) {
    if (e.status !== 403 && e.status !== 404) throw e;
    const invite = `https://discord.com/oauth2/authorize?client_id=${app.id}&scope=bot&permissions=8&guild_id=${guildId}&disable_guild_select=true`;
    say("❌ 봇이 아직 서버에 없어요. 아래 링크를 브라우저에서 열고 ‘승인’을 누른 뒤 다시 실행해 주세요:\n");
    say(`   ${invite}\n`);
    process.exit(1);
  }
  say(`\n서버 ‘${guild.name}’ 에 세팅을 시작해요.\n`);

  // ── 역할 ──
  say("역할 만들기");
  const roles = await api("GET", `/guilds/${guildId}/roles`);
  const roleIds = {};
  for (const role of ROLES) {
    const found = roles.find((r) => r.name === role.name);
    if (found) {
      roleIds[role.key] = found.id;
      skip(role.name);
      continue;
    }
    const { key, ...body } = role;
    const created = await api("POST", `/guilds/${guildId}/roles`, body, "바코 스튜디오 세팅");
    roleIds[key] = created.id;
    done(role.name);
  }

  // ── 채널 ──
  const everyone = guildId; // @everyone 역할 ID는 서버 ID와 같다.
  const readOnly = [
    { id: everyone, type: 0, allow: bits(P.viewChannel, P.readHistory, P.addReactions), deny: bits(P.sendMessages, P.createPublicThreads, P.sendInThreads) },
    { id: roleIds.staff, type: 0, allow: bits(P.sendMessages, P.embedLinks, P.attachFiles, P.mentionEveryone), deny: "0" },
    { id: app.bot?.id ?? app.id, type: 1, allow: bits(P.viewChannel, P.sendMessages, P.embedLinks, P.manageMessages), deny: "0" },
  ];

  let channels = await api("GET", `/guilds/${guildId}/channels`);
  const ids = {};
  for (const group of LAYOUT) {
    say(`채널 만들기 · ${group.category}`);
    let category = channels.find((c) => c.type === CATEGORY && sameName(c.name, group.category));
    if (category) skip(group.category);
    else {
      category = await api("POST", `/guilds/${guildId}/channels`, { name: group.category, type: CATEGORY }, "바코 스튜디오 세팅");
      channels.push(category);
      done(group.category);
    }
    for (const spec of group.channels) {
      let channel = channels.find((c) => sameName(c.name, spec.name) && c.type !== CATEGORY);
      if (channel) {
        skip(spec.name);
      } else {
        const body = {
          name: spec.name,
          type: spec.type,
          parent_id: category.id,
          ...(spec.topic && spec.type !== VOICE ? { topic: spec.topic } : {}),
          ...(spec.readOnly ? { permission_overwrites: readOnly } : {}),
          ...(spec.tags ? { available_tags: spec.tags } : {}),
        };
        try {
          channel = await api("POST", `/guilds/${guildId}/channels`, body, "바코 스튜디오 세팅");
        } catch (e) {
          // 공지 채널·포럼은 ‘커뮤니티 서버’에서만 될 때가 있다. 그럴 땐 보통 채팅 채널로 만든다.
          if (spec.type !== ANNOUNCEMENT && spec.type !== FORUM) throw e;
          const { available_tags, ...rest } = body;
          channel = await api("POST", `/guilds/${guildId}/channels`, { ...rest, type: TEXT }, "바코 스튜디오 세팅");
          say(`  ℹ️  ${spec.name} 은(는) 이 서버에서 ${spec.type === FORUM ? "포럼" : "공지 채널"}을 못 만들어서 보통 채팅 채널로 만들었어요.`);
        }
        channels.push(channel);
        done(spec.name);
      }
      if (spec.key) ids[spec.key] = channel.id;
    }
  }

  // ── 규칙·환영 글 ──
  say("안내 글 올리기");
  const me = await api("GET", "/users/@me");
  async function postOnce(channelKey, label, payload) {
    const id = ids[channelKey];
    const recent = await api("GET", `/channels/${id}/messages?limit=50`);
    if (recent.some((m) => m.author?.id === me.id)) return skip(label);
    const msg = await api("POST", `/channels/${id}/messages`, payload);
    await api("PUT", `/channels/${id}/pins/${msg.id}`).catch(() => {});
    done(label);
  }
  await postOnce("rules", "규칙", { embeds: [rulesEmbed()] });
  await postOnce("welcome", "환영 안내", { embeds: welcomeEmbeds(ids) });

  // ── 초대 링크 ──
  const invite = await api("POST", `/channels/${ids.welcome}/invites`, { max_age: 0, max_uses: 0, unique: false }, "바코 스튜디오 세팅");

  say("\n🎉 다 됐어요!\n");
  say(`초대 링크: https://discord.gg/${invite.code}`);
  say("새 버전이 나오면 🆕┃업데이트 채널에 자동으로 알림이 올라가요.");
  say("원래 있던 ‘일반’ 같은 채널은 그대로 뒀어요. 필요 없으면 디스코드에서 지워도 돼요.\n");
}

main().catch((e) => {
  console.error("\n❌ 문제가 생겼어요. 아래 내용을 Claude에게 보여 주세요:\n");
  console.error(String(e?.message ?? e));
  process.exit(1);
});
