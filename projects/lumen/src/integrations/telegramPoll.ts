import type { DatabaseSync } from "node:sqlite";
import { createEngine } from "../server/engine";
import type { AlertEnv, TelegramTransport } from "../money/notify";
import { telegramApiTransport } from "../money/notify";
import { moneyLive } from "../money/rules";
import { tradingLive } from "../trading/book";
import { kvGet, kvSet } from "../db/db";
import {
  dispatchOwnerMessage,
  type InboundMessage,
  ownerTelegram,
  pollSafeEnv,
  redactSecrets,
  type TalkBack,
} from "./telegramOwner";

export type TgUpdate = {
  update_id?: number;
  message?: InboundMessage;
  edited_message?: InboundMessage;
};

export type TgCall = (method: string, body: Record<string, unknown>) => Promise<unknown>;

export function telegramCaller(token: string, fetchImpl: typeof fetch = fetch): TgCall {
  return async (method, body) => {
    const url = `https://api.telegram.org/bot${token}/${method}`;
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(method === "getUpdates" ? 35_000 : 10_000),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "telegram request failed";
      throw new Error(redactSecrets(message, [token]));
    }
    if (!response.ok) throw new Error(`telegram ${method} failed (${response.status})`);
    let payload: { ok?: boolean; result?: unknown; description?: string };
    try {
      payload = await response.json() as { ok?: boolean; result?: unknown; description?: string };
    } catch {
      throw new Error(`telegram ${method} failed`);
    }
    if (!payload.ok) throw new Error(redactSecrets(payload.description || `telegram ${method} rejected`, [token]));
    return payload.result;
  };
}

export async function pollStartup(call: TgCall): Promise<void> {
  await call("deleteWebhook", { drop_pending_updates: false });
}

export async function pollCycle(
  db: DatabaseSync,
  env: AlertEnv,
  call: TgCall,
  talk: TalkBack,
  now = Date.now(),
  timeout = 25,
  io: { send?: TelegramTransport; fetch?: typeof fetch } = {},
): Promise<number> {
  const safe = pollSafeEnv(env);
  if (moneyLive(safe) || tradingLive(safe) || safe.LUMEN_SALES_MODE !== "disabled" || safe.LUMEN_SPEND_ENABLED === "true") {
    throw new Error("POLL_MONEY");
  }
  const offset = Number(kvGet(db, "tg_poll_offset") ?? "0");
  const start = Number.isFinite(offset) && offset >= 0 ? Math.floor(offset) : 0;
  const result = await call("getUpdates", { offset: start, timeout, allowed_updates: ["message", "edited_message"] });
  const updates = Array.isArray(result) ? result as TgUpdate[] : [];
  let next = start;
  for (const update of updates) {
    const id = Number(update.update_id);
    if (Number.isFinite(id)) next = Math.max(next, id + 1);
    const inbound = update.edited_message && !update.message ? update.edited_message : update.message;
    if (update.edited_message && !update.message) {
      await dispatchOwnerMessage(db, safe, { ...inbound, edit_date: inbound?.edit_date ?? 1 }, talk, now, io);
    } else {
      await dispatchOwnerMessage(db, safe, inbound, talk, now, io);
    }
    kvSet(db, "tg_poll_offset", String(next));
  }
  kvSet(db, "tg_poll_offset", String(next));
  return next;
}

export async function runTelegramPoll(env: AlertEnv = process.env, hooks: {
  call?: TgCall;
  once?: boolean;
  sleep?: (ms: number) => Promise<void>;
  send?: TelegramTransport;
} = {}): Promise<void> {
  const safe = pollSafeEnv(env);
  const token = safe.LUMEN_TELEGRAM_BOT_TOKEN ?? "";
  if (ownerTelegram(safe).mode !== "live") {
    throw new Error("Polling needs LUMEN_TELEGRAM_BOT_TOKEN and numeric LUMEN_TELEGRAM_OWNER_CHAT_ID and LUMEN_TELEGRAM_OWNER_USER_ID. Nothing was sent.");
  }
  const call = hooks.call ?? telegramCaller(token);
  await pollStartup(call);
  const engine = createEngine(safe);
  const talk: TalkBack = (text) => {
    try {
      const turn = engine.ownerChat(text);
      const reply = "reply" in turn && typeof turn.reply === "string" ? turn.reply : undefined;
      return { ok: Boolean(turn.ok), reply };
    } catch {
      return { ok: false };
    }
  };
  const io = { send: hooks.send ?? telegramApiTransport(), fetch };
  let stop = Boolean(hooks.once);
  if (!hooks.once) {
    process.once("SIGINT", () => { stop = true; });
    process.once("SIGTERM", () => { stop = true; });
  }
  const sleep = hooks.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  do {
    try {
      await pollCycle(engine.db, safe, call, talk, Date.now(), hooks.once ? 0 : 25, io);
    } catch (error) {
      const message = error instanceof Error ? error.message : "poll failed";
      console.error(redactSecrets(message, [token, safe.LUMEN_XAI_API_KEY ?? ""]));
      if (hooks.once) throw new Error(redactSecrets(message, [token, safe.LUMEN_XAI_API_KEY ?? ""]));
      await sleep(3000);
    }
    if (hooks.once) stop = true;
  } while (!stop);
}
