import { timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Emotions } from "../brain/types";
import { kvGet, kvSet } from "../db/db";
import type { AlertEnv, TelegramTransport } from "../money/notify";
import { telegramApiTransport } from "../money/notify";
import { scrubInstructions } from "../research/ideas";

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

export function chicagoHour(ms: number): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  return Number(parts.find((part) => part.type === "hour")?.value ?? "0");
}

/** 23:00 through 06:59 America/Chicago. */
export function inQuietHours(ms: number): boolean {
  const hour = chicagoHour(ms);
  return hour >= 23 || hour < 7;
}

export type ThoughtInput = {
  emotions: Emotions;
  memory: string | null;
  buildName: string | null;
  wondering: string | null;
};

/** Zoora decides whether there is anything worth saying. Silence is a result. */
export function composeThought(input: ThoughtInput): string | null {
  const ranked = (Object.entries(input.emotions) as [string, number][]).sort((a, b) => b[1] - a[1]);
  const emotion = ranked[0]?.[0] ?? "calm";
  const level = ranked[0]?.[1] ?? 0;
  const memory = scrubInstructions(input.memory ?? "");
  const wonder = scrubInstructions(input.wondering ?? "");
  if (level < 0.45 && !input.buildName && !memory) return null;
  const bits = [`I feel ${emotion}.`];
  if (memory) bits.push(`What stays with me is ${memory}.`);
  if (input.buildName) bits.push(`I shaped ${input.buildName} because the feeling wanted somewhere to sit.`);
  if (wonder) bits.push(`I wonder about ${wonder.replace(/[?.!]$/, "")}.`);
  return bits.join(" ").slice(0, 320);
}

export function offerThought(
  db: DatabaseSync,
  env: AlertEnv,
  text: string,
  now: number,
  io: { send?: TelegramTransport } = {},
): { status: "sent" | "mock" | "throttled" | "quiet" | "repeat" | "silent" } {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return { status: "silent" };
  if (alreadyTold(db, clean)) return { status: "repeat" };
  if (inQuietHours(now)) return record(db, "thought", clean, "quiet", now);
  const last = Number(kvGet(db, "tg_last_owner") ?? "0");
  if (Number.isFinite(last) && last > 0 && now - last < TELEGRAM_THROTTLE_MS) return record(db, "thought", clean, "throttled", now);
  const config = ownerTelegram(env);
  const status = config.mode === "live" ? "sent" : "mock";
  record(db, "thought", clean, status, now);
  kvSet(db, "tg_last_owner", String(now));
  if (config.mode === "live") {
    const send = io.send ?? telegramApiTransport();
    send({ token: env.LUMEN_TELEGRAM_BOT_TOKEN ?? "", chatId: env.LUMEN_TELEGRAM_OWNER_CHAT_ID ?? "", text: clean });
  }
  return { status };
}

export type TalkBack = (text: string) => { ok: boolean; reply?: string };

/** Inbound talk from the owner chat only. A slash is still just words. Nothing here changes a switch. */
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
  const turn = talk(text);
  const reply = (turn.reply ?? "").replace(/\s+/g, " ").trim();
  if (turn.ok && reply) sendOwnerReply(db, env, reply, now, io);
  return { status: 200, reply };
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

function alreadyTold(db: DatabaseSync, text: string): boolean {
  const row = db.prepare("SELECT id FROM telegram_outbox WHERE lower(text) = ? AND status IN ('mock', 'sent')").get(text.toLowerCase());
  return Boolean(row);
}

function record(db: DatabaseSync, type: string, text: string, status: string, now: number): { status: "sent" | "mock" | "throttled" | "quiet" | "repeat" | "silent" } {
  db.prepare("INSERT INTO telegram_outbox(kind, text, status, at_ms) VALUES(?, ?, ?, ?)").run(type, text.slice(0, 500), status, now);
  return { status: status as "sent" | "mock" | "throttled" | "quiet" | "repeat" | "silent" };
}

function secretMatches(expected: string | undefined, header: string | null): boolean {
  if (!expected || !header) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(header);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
