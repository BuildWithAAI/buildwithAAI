import { timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { flag, kvGet, kvSet, setFlag } from "../db/db";
import type { AlertEnv, TelegramTransport } from "../money/notify";
import { telegramApiTransport } from "../money/notify";
import { chicagoDay, setCreativeEnabled } from "../world/creative";

export const TELEGRAM_TYPES = ["build", "diary", "research", "summary", "alert"] as const;
export type TelegramType = (typeof TELEGRAM_TYPES)[number];
export const TELEGRAM_THROTTLE_MS = 30 * 60_000;
export const TELEGRAM_BODY_MAX = 8 * 1024;

export type OwnerTelegram = { mode: "live" | "mock"; chatId: string; secretSet: boolean };

/** Token and chat id stay out of logs. Unset means mock. */
export function ownerTelegram(env: AlertEnv): OwnerTelegram {
  const token = env.LUMEN_TELEGRAM_BOT_TOKEN ?? "";
  const chatId = env.LUMEN_TELEGRAM_OWNER_CHAT_ID ?? "";
  if (!token || !chatId) return { mode: "mock", chatId: "", secretSet: Boolean(env.LUMEN_TELEGRAM_WEBHOOK_SECRET) };
  return { mode: "live", chatId, secretSet: Boolean(env.LUMEN_TELEGRAM_WEBHOOK_SECRET) };
}

export function telegramToggle(db: DatabaseSync, type: TelegramType): boolean {
  return flag(db, `tg_${type}`, "1") === "1";
}

export function setTelegramToggle(db: DatabaseSync, type: TelegramType, on: boolean): void {
  if (!TELEGRAM_TYPES.includes(type)) return;
  setFlag(db, `tg_${type}`, on ? "1" : "0");
}

export function chicagoHour(ms: number): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  return Number(parts.find((part) => part.type === "hour")?.value ?? "0");
}

/** 23:00 through 06:59 America/Chicago. */
export function inQuietHours(ms: number): boolean {
  const hour = chicagoHour(ms);
  return hour >= 23 || hour < 7;
}

export function queueOwnerMessage(
  db: DatabaseSync,
  env: AlertEnv,
  type: TelegramType,
  text: string,
  now: number,
  io: { send?: TelegramTransport } = {},
): { status: "sent" | "mock" | "throttled" | "quiet" | "off" } {
  if (!telegramToggle(db, type)) return record(db, type, text, "off", now);
  if (type !== "alert" && inQuietHours(now)) return record(db, type, text, "quiet", now);
  if (type !== "alert") {
    const last = Number(kvGet(db, "tg_last_owner") ?? "0");
    if (Number.isFinite(last) && last > 0 && now - last < TELEGRAM_THROTTLE_MS) return record(db, type, text, "throttled", now);
  }
  const config = ownerTelegram(env);
  const status = config.mode === "live" ? "sent" : "mock";
  record(db, type, text, status, now);
  if (type !== "alert") kvSet(db, "tg_last_owner", String(now));
  if (config.mode === "live") {
    const send = io.send ?? telegramApiTransport();
    send({ token: env.LUMEN_TELEGRAM_BOT_TOKEN ?? "", chatId: env.LUMEN_TELEGRAM_OWNER_CHAT_ID ?? "", text: text.slice(0, 500) });
  }
  return { status };
}

export type TalkBack = (text: string) => { ok: boolean; reply?: string };

/** Inbound owner talk. Other chats are dropped and logged. Commands cannot spend. */
export function acceptTelegramUpdate(
  db: DatabaseSync,
  env: AlertEnv,
  raw: string,
  secretHeader: string | null,
  talk: TalkBack,
  now = Date.now(),
  io: { send?: TelegramTransport } = {},
): { status: number; reply: string } {
  const config = ownerTelegram(env);
  if (config.mode !== "live") return { status: 404, reply: "" };
  if (!secretMatches(env.LUMEN_TELEGRAM_WEBHOOK_SECRET, secretHeader)) return { status: 401, reply: "" };
  let update: { message?: { chat?: { id?: number | string }; text?: string } } = {};
  try {
    update = JSON.parse(raw) as typeof update;
  } catch {
    return { status: 400, reply: "" };
  }
  const chatId = String(update.message?.chat?.id ?? "");
  if (!chatId || chatId !== config.chatId) {
    db.prepare("INSERT INTO telegram_drops(chat_id, at_ms) VALUES(?, ?)").run(chatId || "missing", now);
    return { status: 200, reply: "" };
  }
  const text = (update.message?.text ?? "").trim().slice(0, 500);
  const reply = commandReply(db, text, talk);
  sendOwnerReply(db, env, reply, now, io);
  return { status: 200, reply };
}

export function commandReply(db: DatabaseSync, text: string, talk: TalkBack): string {
  if (text === "/status") return "Zoora is on the island. Creative building does not spend.";
  if (text === "/diary") {
    const row = db.prepare("SELECT text FROM diary WHERE private = 0 ORDER BY id DESC LIMIT 1").get() as { text: string } | undefined;
    return row?.text ?? "The diary is still quiet.";
  }
  if (text === "/pause_builds") {
    setCreativeEnabled(db, false);
    return "Creative building is paused.";
  }
  if (/^\/(approve|spend|kill|token|secret|flag|admin)\b/i.test(text)) return "I can't change spending, the kill switch, or tokens from a message.";
  const turn = talk(text);
  if (!turn.ok) return "I heard you, and I did not spend.";
  return turn.reply ?? "I heard you.";
}

export function sendOwnerReply(db: DatabaseSync, env: AlertEnv, text: string, now: number, io: { send?: TelegramTransport } = {}): void {
  const config = ownerTelegram(env);
  const status = config.mode === "live" ? "sent" : "mock";
  record(db, "reply", text, status, now);
  if (config.mode === "live") {
    const send = io.send ?? telegramApiTransport();
    send({ token: env.LUMEN_TELEGRAM_BOT_TOKEN ?? "", chatId: config.chatId, text: text.slice(0, 500) });
  }
}

export function maybeResearchNote(db: DatabaseSync, env: AlertEnv, now: number, io: { send?: TelegramTransport } = {}): void {
  const idea = db.prepare("SELECT id, title FROM ideas WHERE status = 'promising' ORDER BY updated_at DESC LIMIT 1").get() as { id: string; title: string } | undefined;
  if (!idea || kvGet(db, `tg_research:${idea.id}`)) return;
  const result = queueOwnerMessage(db, env, "research", `Zoora finished an idea: ${idea.title}. Nothing was spent.`, now, io);
  if (result.status === "sent" || result.status === "mock") kvSet(db, `tg_research:${idea.id}`, "1");
}

export function maybeDailySummary(db: DatabaseSync, env: AlertEnv, text: string, now: number, io: { send?: TelegramTransport } = {}): void {
  if (chicagoHour(now) < 8 || inQuietHours(now)) return;
  const day = chicagoDay(now);
  if (kvGet(db, `tg_summary:${day}`)) return;
  const result = queueOwnerMessage(db, env, "summary", text, now, io);
  if (result.status === "sent" || result.status === "mock") kvSet(db, `tg_summary:${day}`, "1");
}

function record(db: DatabaseSync, type: string, text: string, status: string, now: number): { status: "sent" | "mock" | "throttled" | "quiet" | "off" } {
  db.prepare("INSERT INTO telegram_outbox(kind, text, status, at_ms) VALUES(?, ?, ?, ?)").run(type, text.slice(0, 500), status, now);
  return { status: status as "sent" | "mock" | "throttled" | "quiet" | "off" };
}

function secretMatches(expected: string | undefined, header: string | null): boolean {
  if (!expected || !header) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(header);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
