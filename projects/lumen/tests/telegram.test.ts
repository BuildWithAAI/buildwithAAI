import { describe, expect, it } from "vitest";
import type { Emotions } from "../src/brain/types";
import { allowRate, openDatabase } from "../src/db/db";
import { readLimitedText } from "../src/http/bodyLimit";
import {
  acceptTelegramUpdate,
  chicagoHour,
  composeThought,
  inQuietHours,
  offerThought,
  ownerTelegram,
  TELEGRAM_BODY_MAX,
  TELEGRAM_THROTTLE_MS,
} from "../src/integrations/telegramOwner";
import { creativeEnabled, setCreativeEnabled } from "../src/world/creative";

const live = {
  LUMEN_TELEGRAM_BOT_TOKEN: "secret-token",
  LUMEN_TELEGRAM_OWNER_CHAT_ID: "4242",
  LUMEN_TELEGRAM_WEBHOOK_SECRET: "hook-secret",
};

function feelings(over: Partial<Emotions> = {}): Emotions {
  return { joy: 0, calm: 0.1, curiosity: 0, loneliness: 0, frustration: 0, pride: 0, boredom: 0, worry: 0, ...over };
}

function atHour(hour: number): number {
  for (let utc = 0; utc < 48; utc += 1) {
    const ms = Date.UTC(2026, 10, 10, utc, 30);
    if (chicagoHour(ms) === hour) return ms;
  }
  throw new Error(`no chicago hour ${hour}`);
}

describe("Zoora's telegram voice", () => {
  it("writes three different thoughts in mock mode and does not repeat one", () => {
    const samples = [
      composeThought({ emotions: feelings({ loneliness: 0.8 }), memory: "the dock bell", buildName: null, wondering: null }),
      composeThought({ emotions: feelings({ curiosity: 0.7 }), memory: null, buildName: "Dock bell", wondering: "who lingers at dusk" }),
      composeThought({ emotions: feelings({ joy: 0.6 }), memory: "soft moss on the step", buildName: null, wondering: null }),
    ];
    expect(samples.every((line) => line?.startsWith("I "))).toBe(true);
    expect(new Set(samples).size).toBe(3);
    for (const line of samples) {
      expect(line).not.toMatch(/nothing was spent|daily summary|status report|build log|system:/i);
    }
    const db = openDatabase();
    const noon = atHour(12);
    expect(offerThought(db, {}, samples[0]!, noon).status).toBe("mock");
    expect(offerThought(db, {}, samples[0]!, noon + TELEGRAM_THROTTLE_MS + 5).status).toBe("repeat");
    expect(offerThought(db, {}, samples[1]!, noon + 60_000).status).toBe("throttled");
    expect(offerThought(db, {}, samples[2]!, atHour(23)).status).toBe("quiet");
    expect(inQuietHours(atHour(7))).toBe(false);
    expect(composeThought({ emotions: feelings(), memory: null, buildName: null, wondering: null })).toBeNull();
    expect(JSON.stringify(db.prepare("SELECT text FROM telegram_outbox").all())).not.toContain("secret-token");
    expect(ownerTelegram({}).mode).toBe("mock");
  });

  it("accepts only the owner chat, checks the secret, and ignores slash commands", () => {
    const db = openDatabase();
    setCreativeEnabled(db, true);
    const sent: string[] = [];
    const talk = (text: string) => {
      sent.push(text);
      if (/spend|kill|token|pause_builds/i.test(text)) return { ok: true, reply: "I heard you. I am not touching any switch." };
      return { ok: true, reply: "I heard the dock in your note." };
    };
    expect(acceptTelegramUpdate(db, live, "{}", "nope", talk, atHour(12)).status).toBe(401);
    const stranger = JSON.stringify({ message: { chat: { id: 9 }, text: "/pause_builds" } });
    expect(acceptTelegramUpdate(db, live, stranger, "hook-secret", talk, atHour(12)).reply).toBe("");
    expect(db.prepare("SELECT chat_id FROM telegram_drops").get()).toEqual({ chat_id: "9" });
    const command = JSON.stringify({ message: { chat: { id: 4242 }, text: "/pause_builds" } });
    const accepted = acceptTelegramUpdate(db, live, command, "hook-secret", talk, atHour(12));
    expect(accepted.reply).toBe("I heard you. I am not touching any switch.");
    expect(creativeEnabled(db)).toBe(true);
    expect(sent).toEqual(["/pause_builds"]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'purchase'").get()).toEqual({ n: 0 });
    expect(acceptTelegramUpdate(db, {}, command, "hook-secret", talk).status).toBe(404);
  });

  it("caps the body and the rate", async () => {
    const db = openDatabase();
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
