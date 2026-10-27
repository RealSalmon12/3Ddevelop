// 누구나 스튜디오에 들어 있는 프로그램 목록. 허브 화면과 허브 메인 프로세스가 함께 쓴다.

export const REPO = "RealSalmon12/3Ddevelop";

export interface SuiteApp {
  id: string;
  name: string;
  /** 무엇을 만드는 프로그램인지 한 줄 */
  tagline: string;
  /** 초보자에게 하는 짧은 소개 */
  description: string;
  /** 어떤 유명 프로그램과 비슷한지. 처음 보는 사람이 감을 잡게 한다. */
  likeness: string;
  /** 카드 색 */
  color: string;
  /** GitHub Releases 태그 앞부분. 없으면 아직 준비 중인 프로그램이다. */
  tagPrefix?: string;
  /**
   * 설치 프로그램(NSIS)이 레지스트리에 쓰는 앱 GUID.
   * electron-builder 가 appId(com.nugunastudio.<id>) 로 만드는 UUID v5 와 같아야 한다.
   */
  guid?: string;
  /** 설치 폴더 안 실행 파일 이름 (electron-builder 의 executableName) */
  executable?: string;
}

export const SUITE_APPS: SuiteApp[] = [
  {
    id: "modeler",
    name: "3D 모델러",
    tagline: "3D 모델 만들기",
    description: "도형을 쌓고 늘려서 집, 캐릭터, 소품을 만들어요. 로블록스로 바로 내보낼 수 있어요.",
    likeness: "블렌더처럼",
    color: "#4f8cff",
    tagPrefix: "modeler-build-",
    guid: "76b0cd18-7416-5518-9d77-ab80b18cc206",
    executable: "NugunaModeler.exe",
  },
  {
    id: "pixel",
    name: "픽셀 그림판",
    tagline: "픽셀 그림, 게임 텍스처",
    description: "네모 칸을 하나씩 칠해서 아이콘, 캐릭터, 로블록스 데칼과 텍스처를 그려요.",
    likeness: "포토샵·에이스프라이트처럼",
    color: "#ff5d8f",
    tagPrefix: "pixel-build-",
    guid: "293e5bbe-505b-5d8c-9012-7211e280c0c3",
    executable: "NugunaPixel.exe",
  },
  {
    id: "photo",
    name: "사진 편집기",
    tagline: "사진 꾸미기, 썸네일",
    description: "사진을 자르고 밝기를 고치고 글자를 넣어 썸네일을 만들어요.",
    likeness: "포토샵처럼",
    color: "#38c6d9",
    tagPrefix: "photo-build-",
    guid: "ba1e726c-3302-50f6-a4d8-e9af77d42385",
    executable: "NugunaPhoto.exe",
  },
  {
    id: "sound",
    name: "소리 편집기",
    tagline: "효과음, 배경 음악",
    description: "녹음하고 자르고 이어 붙이고, 버튼 하나로 동전·점프·폭발 같은 게임 효과음을 만들어요.",
    likeness: "오디션처럼",
    color: "#5fd3a0",
    tagPrefix: "sound-build-",
    guid: "22262d3a-24b7-547f-84e0-7943ce5aba1c",
    executable: "NugunaSound.exe",
  },
  {
    id: "video",
    name: "영상 편집기",
    tagline: "짧은 영상, 쇼츠",
    description: "영상을 자르고 자막과 음악을 넣어서 짧은 영상을 만들어요.",
    likeness: "프리미어처럼",
    color: "#ff9f43",
  },
];
