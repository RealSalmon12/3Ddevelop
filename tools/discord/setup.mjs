// 바코 스튜디오 디스코드 서버를 한 번에 꾸며 주는 도구.
// GitHub Actions 의 ‘디스코드 서버 세팅’ 워크플로가 실행한다 (.github/workflows/discord.yml).
// 직접 돌릴 때: DISCORD_BOT_TOKEN=... node tools/discord/setup.mjs
//
// - 봇 토큰은 GitHub 비밀값(DISCORD_BOT_TOKEN)으로만 받는다. 저장소에 절대 넣지 않는다.
// - 이미 있는 역할·채널은 이름으로 알아보고 건너뛰므로 여러 번 실행해도 괜찮다.
// - 안내·사용법 글은 다시 실행하면 지금 내용으로 고쳐진다.
// - REMOVED_CHANNELS 에 적은 채널만 지우고, 원래 있던 다른 채널은 건드리지 않는다.
import { readFile } from "node:fs/promises";
import { api, guildId, sameName, token } from "./api.mjs";
import { GUIDES } from "./guides.mjs";
import { VERIFY_CHANNEL, VERIFY_EMOJI, grantVerified } from "./verify.mjs";

// 서버 주인이 정한 이름. 바꾸고 싶으면 여기만 고치면 된다.
const SERVER_NAME = "바코 커뮤니티";
const BOT_NAME = "바코";
const ICON = new URL("./assets/walrus.png", import.meta.url);

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
  {
    // ✅ 인증을 하면 받는 역할. 이 역할이 있어야 대부분의 채널이 보인다.
    key: "member",
    name: "🐾 멤버",
    color: COLORS.ice,
    hoist: false,
    mentionable: false,
    permissions: bits(P.viewChannel, P.readHistory),
  },
  {
    // 💎 Pro 를 산 사람. 앱이 ‘디스코드로 로그인’ 할 때 이 역할이 있는지 보고 Pro 기능을 연다.
    // 이름을 바꾸면 앱 쪽 확인도 같이 바꿔야 한다. 역할 ID 는 세팅 기록 맨 아래에 나온다.
    key: "subscriber",
    name: "💎 구독자",
    color: 0x4fc3ff,
    hoist: true,
    mentionable: false,
    permissions: "0",
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
// public: 인증하기 전에도 보인다. 나머지 채널은 🐾 멤버 역할이 있어야 보인다.
const LAYOUT = [
  {
    category: "📢 안내",
    channels: [
      { key: "verify", name: VERIFY_CHANNEL, type: TEXT, readOnly: true, public: true, topic: "✅ 를 눌러야 서버의 모든 채널이 열려요!" },
      { key: "rules", name: "📜┃규칙", type: TEXT, readOnly: true, public: true, topic: "꼭 읽어 주세요! 모두가 즐겁게 지내기 위한 약속이에요." },
      { key: "welcome", name: "👋┃처음-오셨나요", type: TEXT, readOnly: true, public: true, topic: "바코 스튜디오가 처음이라면 여기부터! 설치 방법과 채널 안내가 있어요." },
      { key: "notice", name: "📣┃공지", type: ANNOUNCEMENT, readOnly: true, topic: "운영진의 공지사항" },
      { key: "updates", name: "🆕┃업데이트", type: ANNOUNCEMENT, readOnly: true, topic: "새 버전이 나오면 자동으로 알려 드려요." },
    ],
  },
  {
    category: "📖 사용법",
    channels: [
      { key: "guide-start", guide: "start", name: "📖┃시작하기", type: TEXT, readOnly: true, topic: "설치, AI 도우미, 업데이트, 공통 단축키" },
      { key: "guide-modeler", guide: "modeler", name: "📖┃빙산-사용법", type: TEXT, readOnly: true, topic: "바코 빙산 (3D 모델링) 사용법" },
      { key: "guide-pixel", guide: "pixel", name: "📖┃눈꽃-사용법", type: TEXT, readOnly: true, topic: "바코 눈꽃 (픽셀 그림) 사용법" },
      { key: "guide-photo", guide: "photo", name: "📖┃진주-사용법", type: TEXT, readOnly: true, topic: "바코 진주 (사진 꾸미기) 사용법" },
      { key: "guide-sound", guide: "sound", name: "📖┃파도-사용법", type: TEXT, readOnly: true, topic: "바코 파도 (효과음, 소리 편집) 사용법" },
      { key: "guide-video", guide: "video", name: "📖┃오로라-사용법", type: TEXT, readOnly: true, topic: "바코 오로라 (영상 편집) 사용법" },
    ],
  },
  {
    category: "💎 Pro",
    channels: [
      { key: "pro", name: "💎┃pro-안내", type: TEXT, readOnly: true, topic: "무료와 Pro 의 차이, Pro 를 사는 법, 앱에서 켜는 법" },
      {
        key: "license-help",
        name: "🎫┃라이선스-문의",
        type: FORUM,
        topic: "구매, 디스코드 로그인, Pro 가 안 켜질 때 여기에 글을 올려 주세요. 결제 영수증이나 카드 번호 같은 개인정보는 올리지 말고 운영진에게 DM 으로 보내 주세요.",
        tags: [
          { name: "구매·결제", emoji_name: "💳" },
          { name: "로그인이 안 돼요", emoji_name: "🔑" },
          { name: "Pro 가 안 켜져요", emoji_name: "💎" },
          { name: "기타", emoji_name: "💬" },
          { name: "해결됨", emoji_name: "✅" },
        ],
      },
      { key: "lounge", name: "💎┃구독자-라운지", type: TEXT, subscribersOnly: true, topic: "💎 구독자만 보이는 곳. Pro 템플릿·프리셋 소식과 먼저 써 보기" },
    ],
  },
  {
    category: "💬 바다코끼리 광장",
    channels: [{ key: "chat", name: "💬┃자유-대화", type: TEXT, topic: "아무 이야기나 편하게 나눠요." }],
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

// 예전에 만들었다가 없애기로 한 채널
const REMOVED_CHANNELS = ["🙋┃자기소개"];

const RULES = [
  "**1. 서로 친절하게 대해 주세요.** 처음 해 보는 사람도 많아요. 모르는 걸 물어보는 건 부끄러운 일이 아니에요.",
  "**2. 욕설, 비하, 괴롭힘은 안 돼요.** 다른 사람의 작품을 깎아내리지 말고, 의견은 부드럽게 말해 주세요.",
  "**3. 질문은 ❓┃질문-도움, 버그는 🐛┃버그-제보에 올려 주세요.** 글 하나에 이야기 하나씩 모이면 답을 찾기 쉬워요.",
  "**4. 남의 작품을 내 것처럼 올리지 마세요.** 다른 사람 작품을 참고했다면 출처를 적어 주세요.",
  "**5. 광고, 도배, 수상한 링크는 금지예요.** 무료 로벅스·니트로 같은 링크는 절대 누르지 마세요.",
  "**6. 개인정보를 지켜요.** 주소, 전화번호, 비밀번호, AI 키(sk-ant-…)는 절대 올리지 마세요.",
  "**7. 모두가 볼 수 있는 곳이에요.** 무섭거나 어른용 내용은 올리지 말아 주세요.",
];

const ch = (ids, key) => (ids[key] ? `<#${ids[key]}>` : "");

function verifyMessages(ids) {
  return [
    [
      {
        title: "✅ 인증하고 들어오기",
        color: COLORS.mint,
        description:
          `바코 스튜디오 커뮤니티에 오신 걸 환영해요! 🦭\n\n` +
          `**1.** ${ch(ids, "rules")} 에서 규칙을 읽어 주세요.\n` +
          `**2.** 이 글 아래의 ${VERIFY_EMOJI} 를 눌러 주세요.\n` +
          `**3.** 잠시 뒤(보통 5~10분 안에) 🐾 멤버 역할이 생기고 모든 채널이 열려요. 처리되면 누른 ${VERIFY_EMOJI} 는 사라져요.\n\n` +
          `채널이 열리면 이전 대화도 모두 볼 수 있어요.`,
      },
    ],
  ];
}

function rulesMessages() {
  return [
    [
      {
        title: "📜 바코 스튜디오 커뮤니티 규칙",
        color: COLORS.sunflower,
        description: `${RULES.join("\n\n")}\n\n규칙을 어기면 🦭 운영진이 경고하거나 내보낼 수 있어요. 궁금한 건 운영진에게 편하게 물어보세요!`,
      },
    ],
  ];
}

function welcomeMessages(ids) {
  const lines = [
    [ids.verify, `${ch(ids, "verify")} ${VERIFY_EMOJI} 를 눌러 서버에 들어와요`],
    [ids.rules, `${ch(ids, "rules")} 규칙을 읽어요`],
    [ids["guide-start"], `${ch(ids, "guide-start")} 설치하는 법과 프로그램별 사용법을 봐요`],
    [ids.help, `${ch(ids, "help")} 모르는 게 있으면 질문해요`],
    [ids.bugs, `${ch(ids, "bugs")} 이상한 걸 찾으면 알려 주세요`],
    [ids.ideas, `${ch(ids, "ideas")} 갖고 싶은 기능을 제안해요`],
    [ids.showcase, `${ch(ids, "showcase")} 만든 작품을 자랑해요`],
    [ids.pro, `${ch(ids, "pro")} 💎 Pro 가 뭔지, 어떻게 켜는지 봐요`],
  ];
  return [
    [
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
          "새 버전이 나오면 프로그램이 알아서 알려 주고, " + ch(ids, "updates") + " 채널에도 소식이 올라와요.",
      },
      {
        title: "🧭 어디로 가면 될까요?",
        color: COLORS.mint,
        description: lines.filter(([id]) => id).map(([, text]) => text).join("\n"),
      },
    ],
  ];
}

// 가격과 사는 곳이 정해지면 여기를 고치고 세팅을 다시 돌린다.
const PRO_PURCHASE = "가격과 사는 방법은 곧 📣┃공지 에서 알려 드릴게요. 궁금한 점은 🎫┃라이선스-문의 에 남겨 주세요.";

function proMessages(ids) {
  return [
    [
      {
        title: "💎 바코 스튜디오 Pro",
        color: 0x4fc3ff,
        description:
          "바코 스튜디오는 **무료로도 충분히** 만들고 내보낼 수 있어요. Pro 는 게임·영상을 본격적으로 만드는 사람을 위한 전문가 기능을 열어 줘요.",
        fields: [
          {
            name: "🆓 무료",
            value: "• 모든 프로그램의 기본 편집\n• 저장과 내보내기 (로블록스용 포함)\n• AI 도우미 (내 API 키로)",
          },
          {
            name: "💎 Pro",
            value:
              "• 🧊 빙산: 뼈대(리깅), 자동 가중치, 포즈·애니메이션\n" +
              "• 🌌 오로라: 그래프 에디터, 모션 트래킹, 정확 내보내기\n" +
              "• 🦪 진주: 액션 기록과 일괄 처리\n" +
              "• 🌊 파도: 일괄 처리 (여러 파일 한 번에, 소리 크기 맞추기)\n" +
              "• ❄️ 눈꽃: 타일맵 편집기 (Tiled 내보내기)\n" +
              "• Pro 템플릿·프리셋 팩, " + ch(ids, "lounge") + " 입장",
          },
        ],
      },
      {
        title: "🔑 Pro 켜는 법",
        color: COLORS.mint,
        description:
          "**1.** Pro 를 사면 이 서버에서 **💎 구독자** 역할을 받아요.\n" +
          "**2.** 앱에서 **디스코드로 로그인** 을 눌러요. 브라우저가 열리면 ‘승인’ 을 눌러 주세요.\n" +
          "**3.** 앱이 💎 구독자 역할을 확인하면 Pro 기능이 바로 열려요.\n\n" +
          "• 따로 입력하는 키는 없어요. 디스코드 계정으로만 확인해요.\n" +
          "• 일주일에 한 번 인터넷으로 다시 확인해요. 역할이 없어지면 Pro 기능이 다시 잠겨요.\n" +
          "• 이 서버를 나가면 역할도 사라지니 서버에 계속 있어 주세요.",
      },
      {
        title: "💳 사는 법",
        color: COLORS.sunflower,
        description: PRO_PURCHASE,
      },
      {
        title: "⚠️ 조심하세요",
        color: 0xff6b6b,
        description:
          "운영진은 **절대 먼저 DM 으로 결제를 요구하지 않아요.** 디스코드 비밀번호, 토큰, 카드 번호를 달라는 사람은 사기예요. 이상한 메시지는 🦭 운영진에게 알려 주세요.",
      },
    ],
  ];
}

function guideMessages(key) {
  const guide = GUIDES[key];
  return guide.messages.map((embeds) => embeds.map((e) => ({ color: guide.color, ...e })));
}

// ───────────────────────── 실행 ─────────────────────────

const say = (msg) => console.log(msg);
const done = (msg) => console.log(`  ✅ ${msg}`);
const skip = (msg) => console.log(`  ⏭️  ${msg} (이미 있어요)`);

async function main() {
  say("\n🦭 바코 스튜디오 디스코드 서버 세팅\n");
  if (!token) {
    say("❌ 봇 토큰이 없어요. GitHub 저장소 Settings → Secrets and variables → Actions 에 DISCORD_BOT_TOKEN 을 저장해 주세요.");
    process.exit(1);
  }

  let app;
  try {
    app = await api("GET", "/oauth2/applications/@me");
  } catch (e) {
    if (e.status === 401) {
      say("\n❌ 토큰이 맞지 않아요. 디스코드 개발자 페이지의 Bot 메뉴에서 ‘Reset Token’으로 새 토큰을 받아 다시 저장해 주세요.");
      process.exit(1);
    }
    throw e;
  }
  const me = await api("GET", "/users/@me");

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
  say(`서버 ‘${guild.name}’ 에 세팅을 시작해요.\n`);

  // ── 서버·봇 프로필 ──
  say("프로필 꾸미기");
  const icon = `data:image/png;base64,${(await readFile(ICON)).toString("base64")}`;
  await api("PATCH", `/guilds/${guildId}`, { name: SERVER_NAME, icon, default_message_notifications: 1 }, "바코 스튜디오 세팅");
  done(`서버 이름 ‘${SERVER_NAME}’, 바다코끼리 아이콘, 알림은 @멘션만`);
  try {
    const patch = { avatar: icon, ...(me.username !== BOT_NAME ? { username: BOT_NAME } : {}) };
    await api("PATCH", "/users/@me", patch);
    done(`봇 이름 ‘${BOT_NAME}’, 바다코끼리 프로필 사진`);
  } catch (e) {
    // 봇 이름·사진은 한 시간에 몇 번만 바꿀 수 있다. 못 바꿔도 나머지는 계속한다.
    say(`  ℹ️  봇 프로필은 이번에 못 바꿨어요 (${e.status}). 나중에 다시 실행하면 돼요.`);
  }

  // ── 역할 ──
  say("역할 만들기");
  const roles = await api("GET", `/guilds/${guildId}/roles`);
  const roleIds = {};
  let memberRoleIsNew = false;
  for (const role of ROLES) {
    const { key, ...body } = role;
    const found = roles.find((r) => r.name === role.name);
    if (found) {
      roleIds[key] = found.id;
      // 권한이 바뀌었을 수 있으니 맞춰 둔다.
      if (found.permissions !== body.permissions) await api("PATCH", `/guilds/${guildId}/roles/${found.id}`, { permissions: body.permissions });
      skip(role.name);
      continue;
    }
    const created = await api("POST", `/guilds/${guildId}/roles`, body, "바코 스튜디오 세팅");
    roleIds[key] = created.id;
    if (key === "member") memberRoleIsNew = true;
    done(role.name);
  }

  // 처음 문을 잠그기 전에, 이미 서버에 있던 사람들은 멤버로 넣어 준다.
  if (memberRoleIsNew) {
    try {
      const members = await api("GET", `/guilds/${guildId}/members?limit=1000`);
      let count = 0;
      for (const m of members) {
        if (m.user?.bot || m.roles.includes(roleIds.member)) continue;
        await api("PUT", `/guilds/${guildId}/members/${m.user.id}/roles/${roleIds.member}`, undefined, "이미 있던 멤버");
        count++;
      }
      done(`이미 있던 ${count}명에게 🐾 멤버 역할`);
    } catch {
      say("  ℹ️  이미 있던 사람 목록을 못 읽었어요. 그분들도 ✅ 를 한 번 눌러 주면 돼요.");
    }
  }

  // @everyone(인증 안 한 사람)은 채널을 못 보고, 볼 수 있게 되면 이전 메시지도 읽을 수 있게 한다.
  const everyone = roles.find((r) => r.id === guildId);
  const everyonePerms = ((BigInt(everyone.permissions) & ~P.viewChannel) | P.readHistory).toString();
  if (everyone.permissions !== everyonePerms) {
    await api("PATCH", `/guilds/${guildId}/roles/${guildId}`, { permissions: everyonePerms }, "✅ 인증해야 채널이 보이게");
  }
  done("인증 전에는 안내 채널만 보이게, 들어오면 이전 메시지도 보이게");

  // ── 채널 ──
  const readOnlyFor = (spec) => [
    {
      id: guildId,
      type: 0,
      allow: spec.public ? bits(P.viewChannel, P.readHistory, P.addReactions) : bits(P.readHistory, P.addReactions),
      deny: bits(P.sendMessages, P.createPublicThreads, P.sendInThreads),
    },
    { id: roleIds.staff, type: 0, allow: bits(P.sendMessages, P.embedLinks, P.attachFiles, P.mentionEveryone), deny: "0" },
    { id: me.id, type: 1, allow: bits(P.viewChannel, P.sendMessages, P.embedLinks, P.manageMessages, P.addReactions), deny: "0" },
  ];

  // 💎 구독자만 보이는 채널
  const subscribersOnlyFor = () => [
    { id: guildId, type: 0, allow: "0", deny: bits(P.viewChannel) },
    { id: roleIds.member, type: 0, allow: "0", deny: bits(P.viewChannel) },
    { id: roleIds.subscriber, type: 0, allow: bits(P.viewChannel, P.readHistory, P.sendMessages), deny: "0" },
    { id: roleIds.staff, type: 0, allow: bits(P.viewChannel, P.readHistory, P.sendMessages), deny: "0" },
    { id: me.id, type: 1, allow: bits(P.viewChannel, P.sendMessages, P.embedLinks), deny: "0" },
  ];
  const overwritesFor = (spec) =>
    spec.readOnly ? { permission_overwrites: readOnlyFor(spec) } : spec.subscribersOnly ? { permission_overwrites: subscribersOnlyFor() } : {};

  let channels = await api("GET", `/guilds/${guildId}/channels`);
  const ids = {};
  const order = [];
  for (const group of LAYOUT) {
    say(`채널 만들기 · ${group.category}`);
    let category = channels.find((c) => c.type === CATEGORY && sameName(c.name, group.category));
    if (category) skip(group.category);
    else {
      category = await api("POST", `/guilds/${guildId}/channels`, { name: group.category, type: CATEGORY }, "바코 스튜디오 세팅");
      channels.push(category);
      done(group.category);
    }
    order.push(category);
    for (const spec of group.channels) {
      let channel = channels.find((c) => sameName(c.name, spec.name) && c.type !== CATEGORY);
      if (channel) {
        const patch = { parent_id: category.id, ...overwritesFor(spec) };
        channel = await api("PATCH", `/channels/${channel.id}`, patch, "바코 스튜디오 세팅");
        skip(spec.name);
      } else {
        const body = {
          name: spec.name,
          type: spec.type,
          parent_id: category.id,
          ...(spec.topic && spec.type !== VOICE ? { topic: spec.topic } : {}),
          ...overwritesFor(spec),
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
      order.push(channel);
      if (spec.key) ids[spec.key] = channel.id;
    }
  }

  say("필요 없는 채널 지우기");
  for (const name of REMOVED_CHANNELS) {
    const channel = channels.find((c) => sameName(c.name, name) && c.type !== CATEGORY);
    if (!channel) continue;
    await api("DELETE", `/channels/${channel.id}`, undefined, "바코 스튜디오 세팅");
    done(`${name} 지움`);
  }

  // LAYOUT 순서대로 줄 세운다. (원래 있던 다른 채널은 맨 아래로 간다)
  await api(
    "PATCH",
    `/guilds/${guildId}/channels`,
    order.map((c, i) => ({ id: c.id, position: i })),
  );
  done("채널 순서 정리");

  // ── 안내·사용법 글 ──
  say("안내 글 올리기");
  // 봇이 쓴 글이 있으면 고치고, 모자라면 새로 올리고, 남으면 지운다.
  async function upsertMessages(channelKey, label, messages, { pin = true } = {}) {
    const id = ids[channelKey];
    const recent = await api("GET", `/channels/${id}/messages?limit=50`);
    const mine = recent.filter((m) => m.author?.id === me.id).reverse();
    const sent = [];
    for (const [i, embeds] of messages.entries()) {
      if (mine[i]) sent.push(await api("PATCH", `/channels/${id}/messages/${mine[i].id}`, { content: "", embeds }));
      else {
        const msg = await api("POST", `/channels/${id}/messages`, { embeds });
        if (pin && i === 0) await api("PUT", `/channels/${id}/pins/${msg.id}`).catch(() => {});
        sent.push(msg);
      }
    }
    for (const extra of mine.slice(messages.length)) await api("DELETE", `/channels/${id}/messages/${extra.id}`);
    done(label);
    return sent;
  }
  const [verifyMsg] = await upsertMessages("verify", "✅ 인증 안내", verifyMessages(ids));
  await api("PUT", `/channels/${ids.verify}/messages/${verifyMsg.id}/reactions/${encodeURIComponent(VERIFY_EMOJI)}/@me`);
  await upsertMessages("rules", "규칙", rulesMessages());
  await upsertMessages("welcome", "환영 안내", welcomeMessages(ids));
  await upsertMessages("pro", "💎 Pro 안내", proMessages(ids));
  for (const group of LAYOUT) {
    for (const spec of group.channels) {
      if (spec.guide) await upsertMessages(spec.key, `${spec.name} 사용법`, guideMessages(spec.guide), { pin: false });
    }
  }

  // 세팅하는 사이에 ✅ 를 누른 사람이 있으면 바로 처리한다.
  const granted = await grantVerified();
  if (granted) done(`✅ 누른 ${granted}명에게 🐾 멤버 역할`);

  // ── 초대 링크 ──
  const invite = await api("POST", `/channels/${ids.welcome}/invites`, { max_age: 0, max_uses: 0, unique: false }, "바코 스튜디오 세팅");

  say("\n🎉 다 됐어요!\n");
  say(`초대 링크: https://discord.gg/${invite.code}`);
  say("새 버전이 나오면 🆕┃업데이트 채널에 자동으로 알림이 올라가요.");
  say("✅ 인증은 ‘디스코드 인증 처리’ 워크플로가 5분마다 처리해요.\n");
  say("역할 ID (앱에 넣을 때 쓰세요):");
  for (const role of ROLES) say(`  ${role.name}: ${roleIds[role.key]}`);
  say("");
}

main().catch((e) => {
  console.error("\n❌ 문제가 생겼어요. 아래 내용을 Claude에게 보여 주세요:\n");
  console.error(String(e?.message ?? e));
  process.exit(1);
});
