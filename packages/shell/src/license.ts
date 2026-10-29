/**
 * 라이선스 키: 판매자가 비밀 열쇠(Ed25519)로 서명한 키를 앱이 공개 열쇠로 확인한다.
 * 서버 없이도 위조를 막고, 키 안에 적힌 기간이 지나면 Pro 기능이 잠긴다.
 * 키는 모든 앱이 같이 쓴다 (appData/NugunaStudio/license.json).
 *
 * 키 모양: BACO-<내용 base64url>.<서명 base64url>
 * 키 만들기는 tools/license/issue.mjs (GitHub Actions ‘라이선스 키 보내기’) 가 한다.
 */
import { app } from "electron";
import { createPublicKey, verify } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LicenseStatus } from "./bridge";

/** 판매자 비밀 열쇠의 짝. 바꾸면 이전 키는 모두 무효가 된다. */
const PUBLIC_KEY = "MCowBQYDK2VwAyEAwEW+TFPUYxhgTwXoPsTtT4YjSwDhINEeT356JK50wrE=";
/** 기간이 끝난 뒤에도 이만큼은 그대로 쓸 수 있다 (결제가 하루 이틀 늦어도 작업이 끊기지 않게) */
const GRACE_DAYS = 3;
const DAY = 24 * 60 * 60 * 1000;

export interface LicensePayload {
  v: 1;
  /** 키 번호 (문의할 때 쓴다) */
  id: string;
  /** 받는 사람 (디스코드 이름) */
  to: string;
  plan: "pro";
  /** 시작, 끝 날짜 (YYYY-MM-DD, 끝 날짜 하루 끝까지) */
  from: string;
  until: string;
}

const file = () => path.join(app.getPath("appData"), "NugunaStudio", "license.json");

const b64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** 키를 읽고 서명을 확인한다. 틀리면 이유를 돌려준다 */
export function parseKey(raw: string): { ok: true; payload: LicensePayload } | { ok: false; reason: string } {
  const key = raw.replace(/\s+/g, "");
  const m = /^BACO-([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(key);
  if (!m) return { ok: false, reason: "키 모양이 아니에요. BACO- 로 시작하는 키 전체를 붙여 넣어 주세요." };
  let ok = false;
  try {
    ok = verify(null, Buffer.from(m[1]), createPublicKey({ key: Buffer.from(PUBLIC_KEY, "base64"), format: "der", type: "spki" }), b64url(m[2]));
  } catch {
    ok = false;
  }
  if (!ok) return { ok: false, reason: "올바른 키가 아니에요. 한 글자라도 빠지거나 바뀌었는지 확인해 주세요." };
  try {
    const payload = JSON.parse(b64url(m[1]).toString("utf8")) as LicensePayload;
    if (payload.v !== 1 || payload.plan !== "pro" || !/^\d{4}-\d{2}-\d{2}$/.test(payload.until)) throw new Error();
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: "이 버전에서 읽을 수 없는 키예요. 앱을 업데이트해 주세요." };
  }
}

interface Saved {
  key: string;
  /** 지금까지 본 가장 늦은 시각 (시계를 되돌려 기간을 늘리는 것 막기) */
  seen: number;
}

async function load(): Promise<Saved | null> {
  try {
    const s = JSON.parse(await readFile(file(), "utf8")) as Saved;
    return typeof s.key === "string" ? s : null;
  } catch {
    return null;
  }
}

async function save(s: Saved) {
  await mkdir(path.dirname(file()), { recursive: true });
  await writeFile(file(), JSON.stringify(s));
}

function statusOf(payload: LicensePayload, now: number): LicenseStatus {
  const end = Date.parse(`${payload.until}T23:59:59Z`);
  const daysLeft = Math.ceil((end - now) / DAY);
  const usable = now <= end + GRACE_DAYS * DAY && now >= Date.parse(`${payload.from}T00:00:00Z`) - DAY;
  return {
    plan: usable ? "pro" : "free",
    id: payload.id,
    to: payload.to,
    from: payload.from,
    until: payload.until,
    daysLeft,
    expired: !usable && now > end,
    grace: usable && now > end,
  };
}

export async function licenseStatus(): Promise<LicenseStatus> {
  const s = await load();
  if (!s) return { plan: "free" };
  const parsed = parseKey(s.key);
  if (!parsed.ok) return { plan: "free", error: parsed.reason };
  const now = Math.max(Date.now(), s.seen);
  if (Date.now() > s.seen) void save({ ...s, seen: Date.now() }).catch(() => {});
  return statusOf(parsed.payload, now);
}

export async function activateLicense(key: string): Promise<LicenseStatus> {
  const parsed = parseKey(key);
  if (!parsed.ok) return { plan: "free", error: parsed.reason };
  const prev = await load();
  const seen = Math.max(Date.now(), prev?.seen ?? 0);
  const st = statusOf(parsed.payload, seen);
  if (st.plan !== "pro") return { ...st, error: st.expired ? `기간이 끝난 키예요 (${parsed.payload.until} 까지). 새 키를 받아 주세요.` : "아직 시작하지 않은 키예요." };
  // 실수로 더 짧은 옛 키를 넣어 남은 기간을 잃지 않게
  const cur = prev && parseKey(prev.key);
  if (cur && cur.ok && cur.payload.until > parsed.payload.until && statusOf(cur.payload, seen).plan === "pro")
    return { ...statusOf(cur.payload, seen), error: `지금 키가 더 오래 가요 (${cur.payload.until} 까지). 이 키는 넣지 않았어요.` };
  await save({ key: key.replace(/\s+/g, ""), seen });
  return st;
}

export async function removeLicense(): Promise<LicenseStatus> {
  await rm(file(), { force: true });
  return { plan: "free" };
}
