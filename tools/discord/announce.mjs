// 새 설치 파일이 Releases 에 올라가면 디스코드 🆕┃업데이트 채널에 알린다.
// build.yml 의 ‘디스코드에 알리기’ 단계에서 실행한다. 토큰이 없으면 아무것도 안 하고 끝난다.
import { api, guildId, token } from "./api.mjs";

const UPDATES_CHANNEL = "🆕┃업데이트";
const { APP_TITLE, BUILD, RELEASE_URL } = process.env;

async function main() {
  if (!token) return console.log("디스코드 봇 토큰이 없어서 알림은 건너뛰어요.");
  const channels = await api("GET", `/guilds/${guildId}/channels`);
  const channel = channels.find((c) => c.name.replace(/\uFE0F/g, "") === UPDATES_CHANNEL);
  if (!channel) return console.log(`디스코드에 ${UPDATES_CHANNEL} 채널이 없어서 알림은 건너뛰어요.`);
  const msg = await api("POST", `/channels/${channel.id}/messages`, {
    embeds: [
      {
        title: `🆕 ${APP_TITLE} 새 버전이 나왔어요! (빌드 ${BUILD})`,
        url: RELEASE_URL,
        color: 0xffc83d,
        description:
          "이미 설치했다면 프로그램을 켤 때 나오는 **업데이트** 버튼이나 허브에서 바로 새 버전으로 바꿀 수 있어요.\n" +
          `처음이라면 [여기](${RELEASE_URL})에서 설치 파일을 받으세요.`,
      },
    ],
  });
  // 공지 채널이면 다른 서버에서 팔로우한 사람에게도 보이도록 발행한다.
  if (channel.type === 5) await api("POST", `/channels/${channel.id}/messages/${msg.id}/crosspost`).catch(() => {});
  console.log("디스코드에 알렸어요.");
}

// 알림이 실패해도 설치 파일 만들기는 실패로 치지 않는다.
main().catch((e) => console.log(`디스코드 알림 실패: ${e.message}`));
