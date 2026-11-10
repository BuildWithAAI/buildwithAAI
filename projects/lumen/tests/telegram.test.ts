import { describe, expect, it } from "vitest";
import { allowRate, openDatabase } from "../src/db/db";
import { readLimitedText } from "../src/http/bodyLimit";
import {
  acceptTelegramUpdate,
  chicagoHour,
  commandReply,
  inQuietHours,
  ownerTelegram,
  queueOwnerMessage,
  setTelegramToggle,
  TELEGRAM_BODY_MAX,
  TELEGRAM_THROTTLE_MS,
} from "../src/integrations/telegramOwner";

const live = {
  LUMEN_TELEGRAM_BOT_TOKEN: "secret-token",
  LUMEN_TELEGRAM_OWNER_CHAT_ID: "4242",
  LUMEN_TELEGRAM_WEBHOOK_SECRET: "hook-secret",
};

function atHour(hour: number): number {
  for (let utc = 0; utc < 48; utc += 1) {
    const ms = Date.UTC(2026, 10, 10, utc, 30);
    if (chicagoHour(ms) === hour) return ms;
  }
  throw new Error(`no chicago hour ${hour}`);
}

describe("owner telegram", () => {
  it("stays in mock mode until both secrets are set", () => {
    expect(ownerTelegram({}).mode).toBe("mock");
    expect(ownerTelegram({ LUMEN_TELEGRAM_BOT_TOKEN: "x" }).mode).toBe("mock");
    expect(ownerTelegram(live).mode).toBe("live");
    const db = openDatabase();
    expect(queueOwnerMessage(db, {}, "build", "A bench.", atHour(12)).status).toBe("mock");
    expect(JSON.stringify(db.prepare("SELECT text FROM telegram_outbox").all())).not.toContain("secret-token");
  });

  it("accepts only the owner chat and checks the webhook secret", () => {
    const db = openDatabase();
    const sent: string[] = [];
    const talk = (text: string) => {
      sent.push(text);
      return { ok: true, reply: "heard" };
    };
    const send = () => { sent.push("wire"); };
    expect(acceptTelegramUpdate(db, live, "{}", "nope", talk, atHour(12), { send }).status).toBe(401);
    expect(sent).toEqual([]);
    const stranger = JSON.stringify({ message: { chat: { id: 9 }, text: "hello" } });
    expect(acceptTelegramUpdate(db, live, stranger, "hook-secret", talk, atHour(12), { send }).reply).toBe("");
    expect(db.prepare("SELECT chat_id FROM telegram_drops").get()).toEqual({ chat_id: "9" });
    expect(sent).toEqual([]);
    const owner = JSON.stringify({ message: { chat: { id: 4242 }, text: "the dock is bright" } });
    const accepted = acceptTelegramUpdate(db, live, owner, "hook-secret", talk, atHour(12), { send });
    expect(accepted.status).toBe(200);
    expect(accepted.reply).toBe("heard");
    expect(sent).toContain("the dock is bright");
    expect(acceptTelegramUpdate(db, {}, owner, "hook-secret", talk).status).toBe(404);
  });

  it("throttles notes, keeps quiet hours, and lets alerts through", () => {
    const db = openDatabase();
    const noon = atHour(12);
    const night = atHour(23);
    expect(inQuietHours(night)).toBe(true);
    expect(inQuietHours(atHour(7))).toBe(false);
    expect(queueOwnerMessage(db, {}, "build", "first", noon).status).toBe("mock");
    expect(queueOwnerMessage(db, {}, "diary", "second", noon + 60_000).status).toBe("throttled");
    expect(queueOwnerMessage(db, {}, "research", "later", noon + TELEGRAM_THROTTLE_MS + 1).status).toBe("mock");
    expect(queueOwnerMessage(db, {}, "summary", "asleep", night).status).toBe("quiet");
    expect(queueOwnerMessage(db, {}, "alert", "Ledger chain broken", night).status).toBe("mock");
    setTelegramToggle(db, "build", false);
    expect(queueOwnerMessage(db, {}, "build", "no", noon + TELEGRAM_THROTTLE_MS * 3).status).toBe("off");
  });

  it("refuses spend commands and caps the body", async () => {
    const db = openDatabase();
    const talked: string[] = [];
    expect(commandReply(db, "/spend 40", (text) => { talked.push(text); return { ok: true, reply: "no" }; })).toContain("can't change spending");
    expect(commandReply(db, "/approve the wish", () => { throw new Error("spend"); })).toContain("can't change spending");
    expect(commandReply(db, "/pause_builds", () => ({ ok: true, reply: "no" }))).toContain("paused");
    expect(talked).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'purchase'").get()).toEqual({ n: 0 });
    for (let i = 0; i < 30; i += 1) expect(allowRate(db, "telegram:203.0.113.5", 30, 60_000, 1)).toBe(true);
    expect(allowRate(db, "telegram:203.0.113.5", 30, 60_000, 1)).toBe(false);
    const chunks = Array.from({ length: 20 }, () => new Uint8Array(1000));
    let index = 0;
    const body = new ReadableStream({
      pull(controller) {
        const next = chunks[index];
        index += 1;
        if (!next) controller.close();
        else controller.enqueue(next);
      },
    });
    const request = new Request("http://app/api/telegram/webhook", { method: "POST", body, duplex: "half" });
    expect(await readLimitedText(request, TELEGRAM_BODY_MAX)).toMatchObject({ ok: false, status: 413 });
  });
});
