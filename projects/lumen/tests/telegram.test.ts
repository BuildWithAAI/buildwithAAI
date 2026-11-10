import { describe, expect, it } from "vitest";
import type { Emotions } from "../src/brain/types";
import { allowRate, kvGet, kvSet, openDatabase, setFlag } from "../src/db/db";
import { readLimitedText } from "../src/http/bodyLimit";
import {
  acceptTelegramUpdate,
  chicagoHour,
  COMMANDS_ONLY_REPLY,
  commandReply,
  composeThought,
  inQuietHours,
  knownCommand,
  offerThought,
  numericTelegramId,
  ownerTelegram,
  ownerUpdateAllowed,
  pollSafeEnv,
  readVoiceFacts,
  redactSecrets,
  speakWithGrok,
  TELEGRAM_BODY_MAX,
  TELEGRAM_COMMANDS,
  TELEGRAM_THROTTLE_MS,
} from "../src/integrations/telegramOwner";
import { pollCycle, pollStartup, runTelegramPoll, telegramCaller } from "../src/integrations/telegramPoll";
import { moneyLive } from "../src/money/rules";
import { shopCheckoutOpen } from "../src/shop/store";
import { tradingLive } from "../src/trading/book";
import { initialState } from "../src/brain/tick";
import { creativeEnabled, setCreativeEnabled } from "../src/world/creative";
import { BOT_COMMANDS, setMyCommands } from "../scripts/telegram-set-commands.mjs";
import { forbiddenPollKeys, launchPoll, minimalPollEnv, pollEnvAllowed, preparePollEnv, removePollBundle } from "../scripts/telegram-poll.mjs";

const live = {
  LUMEN_TELEGRAM_BOT_TOKEN: "secret-token",
  LUMEN_TELEGRAM_OWNER_CHAT_ID: "4242",
  LUMEN_TELEGRAM_OWNER_USER_ID: "77",
  LUMEN_TELEGRAM_WEBHOOK_SECRET: "hook-secret",
};

function ownerPacket(text: string, message: Record<string, unknown> = {}) {
  return JSON.stringify({
    message: {
      chat: { id: 4242, type: "private" },
      from: { id: 77 },
      text,
      ...message,
    },
  });
}

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

  it("accepts only the owner chat, checks the secret, and treats an unknown command as talk", async () => {
    const db = openDatabase();
    setCreativeEnabled(db, true);
    const sent: string[] = [];
    const talk = (text: string) => {
      sent.push(text);
      if (/spend|kill|token|pause_builds/i.test(text)) return { ok: true, reply: "I heard you. I am not touching any switch." };
      return { ok: true, reply: "I heard the dock in your note." };
    };
    expect((await acceptTelegramUpdate(db, live, "{}", "nope", talk, atHour(12))).status).toBe(401);
    const stranger = JSON.stringify({ message: { chat: { id: 9 }, text: "/pause_builds" } });
    expect((await acceptTelegramUpdate(db, live, stranger, "hook-secret", talk, atHour(12))).reply).toBe("");
    expect(db.prepare("SELECT chat_id FROM telegram_drops").get()).toEqual({ chat_id: "9" });
    const command = ownerPacket("/pause_builds");
    const accepted = await acceptTelegramUpdate(db, { ...live, LUMEN_TELEGRAM_COMMANDS_ONLY: "false" }, command, "hook-secret", talk, atHour(12));
    expect(accepted.reply).toBe("I heard you. I am not touching any switch.");
    expect(creativeEnabled(db)).toBe(true);
    expect(sent).toEqual(["/pause_builds"]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'purchase'").get()).toEqual({ n: 0 });
    expect((await acceptTelegramUpdate(db, {}, command, "hook-secret", talk)).status).toBe(404);
  });

  it("answers owner commands from real state and does not spend or flip a switch", async () => {
    const db = openDatabase();
    const state = initialState();
    state.placeId = "art-studio";
    state.tick = 4;
    kvSet(db, "brain", JSON.stringify(state));
    kvSet(db, "world_scene", JSON.stringify({
      palette: "lantern",
      sky: "gold",
      weather: "mist",
      decoration: "lanterns",
      gardenStage: 2,
      galleryIds: [],
      why: "I picked the lantern light because the water feels bright.",
      atMs: 10,
    }));
    setFlag(db, "kill", "0");
    setFlag(db, "spend", "1");
    setCreativeEnabled(db, true);
    db.prepare("INSERT INTO shop_listings(id, shop_id, kind, title, description, price_cents, status, scope, turnaround_hours, file_body, version, created_at, updated_at) VALUES('list-1', 'shop', 'art', 'Ring', 'A ring', 500, 'published', 'original', 24, '', 1, 1, 1)").run();
    const beforeBrain = kvGet(db, "brain");
    const sent: string[] = [];
    const talk = (text: string) => {
      sent.push(text);
      setFlag(db, "kill", "1");
      return { ok: true, reply: "I would have touched a switch." };
    };
    const noon = atHour(12);
    const mood = await acceptTelegramUpdate(db, live, ownerPacket("/mood@ZooraJellyfishBot"), "hook-secret", talk, noon);
    expect(mood.reply).toBe(commandReply("mood", readVoiceFacts(db, live)));
    expect(mood.reply).toMatch(/^I feel /);
    expect(knownCommand("/pause_builds")).toBeNull();
    const stranger = await acceptTelegramUpdate(db, live, JSON.stringify({ message: { chat: { id: 9 }, text: "/status" } }), "hook-secret", talk, noon);
    expect(stranger.reply).toBe("");
    const status = await acceptTelegramUpdate(db, live, ownerPacket("/status"), "hook-secret", talk, noon);
    expect(status.reply).toContain("Live money is off.");
    expect(status.reply).toContain("local data, not production");
    expect(status.reply).toContain("I do not have a balance");
    expect(status.reply).toContain("The shop checkout is closed.");
    expect(status.reply).toContain("The Saloon is paper only.");
    expect(status.reply).not.toMatch(/\$\s?\d/);
    const world = await acceptTelegramUpdate(db, live, ownerPacket("/world"), "hook-secret", talk, noon);
    expect(world.reply).toContain("Art Studio");
    expect(world.reply).toContain("lantern palette");
    expect(world.reply).toContain("stage 2");
    const help = await acceptTelegramUpdate(db, live, ownerPacket("/help"), "hook-secret", talk, noon);
    expect(help.reply).toContain("/needs");
    expect(help.reply).toContain("will not spend");
    const needs = await acceptTelegramUpdate(db, live, ownerPacket("/needs"), "hook-secret", talk, noon);
    expect(needs.reply).toContain("curiosity 0.36");
    expect(sent).toEqual([]);
    expect(kvGet(db, "brain")).toBe(beforeBrain);
    expect(creativeEnabled(db)).toBe(true);
    expect(db.prepare("SELECT value FROM flags WHERE key = 'kill'").get()).toEqual({ value: "0" });
    expect(db.prepare("SELECT value FROM flags WHERE key = 'spend'").get()).toEqual({ value: "1" });
    expect(db.prepare("SELECT price_cents FROM shop_listings WHERE id = 'list-1'").get()).toEqual({ price_cents: 500 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM shop_orders").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'purchase'").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM messages").get()).toEqual({ n: 0 });
    expect(JSON.stringify(db.prepare("SELECT text FROM telegram_outbox").all())).not.toContain("secret-token");
    const quiet = await acceptTelegramUpdate(db, live, ownerPacket("/mood"), "hook-secret", talk, atHour(23), { send: () => undefined });
    expect(quiet.reply).toMatch(/^I feel /);
    expect(offerThought(db, live, "A separate thought.", atHour(23)).status).toBe("quiet");
  });

  it("uses a canned line without an xAI key and Grok only for talk", async () => {
    const db = openDatabase();
    kvSet(db, "brain", JSON.stringify(initialState()));
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(String(url));
      const body = String(init?.body ?? "");
      expect(body).not.toContain("xai-test-key-123456");
      expect(body).not.toContain("secret-token");
      expect(String(init?.headers && JSON.stringify(init.headers))).not.toContain("secret-token");
      return new Response(JSON.stringify({ choices: [{ message: { content: "The dock bell is soft tonight." } }] }), { status: 200 });
    }) as typeof fetch;
    const withKey = { ...live, LUMEN_XAI_API_KEY: "xai-test-key-123456", LUMEN_TELEGRAM_COMMANDS_ONLY: "false" };
    const talked = await acceptTelegramUpdate(db, withKey, ownerPacket("hello from the dock"), "hook-secret", () => ({ ok: true, reply: "I heard the dock in your note." }), atHour(12), { fetch: fetchImpl, send: () => undefined });
    expect(talked.reply).toBe("The dock bell is soft tonight.");
    expect(calls).toEqual(["https://api.x.ai/v1/chat/completions"]);
    calls.length = 0;
    const commanded = await acceptTelegramUpdate(db, withKey, ownerPacket("/mood"), "hook-secret", () => ({ ok: true, reply: "should not be used" }), atHour(12), { fetch: fetchImpl, send: () => undefined });
    expect(commanded.reply).toMatch(/^I feel /);
    expect(calls).toEqual([]);
    const invented = await speakWithGrok(withKey, readVoiceFacts(db, withKey), "hi", "canned line", (async () => new Response(JSON.stringify({ choices: [{ message: { content: "Your balance is $40." } }] }), { status: 200 })) as typeof fetch);
    expect(invented).toBe("canned line");
    const plain = await speakWithGrok(live, readVoiceFacts(db, live), "hi", "canned line", fetchImpl);
    expect(plain).toBe("canned line");
    expect(JSON.stringify(db.prepare("SELECT text FROM telegram_outbox").all())).not.toMatch(/xai-test-key-123456|secret-token/);
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

  it("stops owner commands after thirty in a minute, before talk", async () => {
    const db = openDatabase();
    kvSet(db, "brain", JSON.stringify(initialState()));
    let talks = 0;
    const talk = () => {
      talks += 1;
      setFlag(db, "kill", "1");
      return { ok: true, reply: "I would have touched a switch." };
    };
    const noon = atHour(12);
    for (let i = 0; i < 30; i += 1) {
      const reply = await acceptTelegramUpdate(db, live, ownerPacket("/mood"), "hook-secret", talk, noon);
      expect(reply.reply).toMatch(/^I feel /);
    }
    const blocked = await acceptTelegramUpdate(db, live, ownerPacket("/pause_builds"), "hook-secret", talk, noon);
    expect(blocked.reply).toBe("");
    expect(talks).toBe(0);
    expect(db.prepare("SELECT value FROM flags WHERE key = 'kill'").get()).toBeUndefined();
    expect(db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'purchase'").get()).toEqual({ n: 0 });
  });

  it("polls with money forced off, drops other chats, and redacts the token", async () => {
    const hostile = {
      ...live,
      LUMEN_MONEY_LIVE: "true",
      LUMEN_TRADING_LIVE: "true",
      LUMEN_SALES_MODE: "live",
      LUMEN_SALES_ENABLED: "true",
      LUMEN_SPEND_ENABLED: "true",
      MINT_ENABLED: "true",
      STRIPE_SECRET_KEY: "sk_live_not_real",
      STRIPE_WEBHOOK_SECRET: "whsec_test",
      LUMEN_DATA: ":memory:",
    };
    const safe = pollSafeEnv(hostile);
    expect(moneyLive(safe)).toBe(false);
    expect(tradingLive(safe)).toBe(false);
    expect(safe.LUMEN_SALES_MODE).toBe("disabled");
    expect(safe.MINT_ENABLED).toBe("false");
    expect(shopCheckoutOpen(openDatabase(), safe)).toBe(false);
    expect(redactSecrets("https://api.telegram.org/botsecret-token/getUpdates", ["secret-token"])).not.toContain("secret-token");
    const db = openDatabase();
    kvSet(db, "brain", JSON.stringify(initialState()));
    const talked: string[] = [];
    const startup: string[] = [];
    await pollStartup(async (method, body) => {
      startup.push(`${method}:${JSON.stringify(body)}`);
      return true;
    });
    expect(startup[0]).toContain("\"drop_pending_updates\":false");
    const sent: string[] = [];
    const next = await pollCycle(db, hostile, async (method, body) => {
      expect(method).toBe("getUpdates");
      expect(body.timeout).toBe(0);
      expect(body.offset).toBe(0);
      return [
        { update_id: 4, message: { chat: { id: 9, type: "private" }, from: { id: 77 }, text: "/mood" } },
        { update_id: 5, message: { chat: { id: 4242, type: "private" }, from: { id: 77 }, text: "/status" } },
        { update_id: 6, message: { chat: { id: 4242, type: "group" }, from: { id: 77 }, text: "/not-a-command" } },
      ];
    }, (text) => {
      talked.push(text);
      return { ok: true, reply: "I heard that as talk." };
    }, atHour(12), 0, { send: (message) => sent.push(message.text) });
    expect(next).toBe(7);
    expect(talked).toEqual([]);
    expect(sent.join(" ")).toContain("Live money is off");
    expect(sent.join(" ")).toContain("The Saloon is paper only.");
    expect(sent.join(" ")).not.toMatch(/\$\s?\d/);
    expect(db.prepare("SELECT chat_id FROM telegram_drops").get()).toEqual({ chat_id: "9" });
    expect(kvGet(db, "tg_poll_offset")).toBe("7");
    const caller = telegramCaller("secret-token", (async () => {
      throw new Error("failed https://api.telegram.org/botsecret-token/getUpdates");
    }) as typeof fetch);
    await expect(caller("getUpdates", {})).rejects.toThrow(/\[redacted\]/);
    await expect(caller("getUpdates", {})).rejects.not.toThrow(/secret-token/);
    const replies: string[] = [];
    await runTelegramPoll(hostile, {
      once: true,
      send: (message) => replies.push(message.text),
      call: async (method) => {
        if (method === "deleteWebhook") return true;
        return [{ update_id: 1, message: { chat: { id: "4242", type: "private" }, from: { id: 77 }, text: "/status" } }];
      },
    });
    await expect(runTelegramPoll({ LUMEN_DATA: ":memory:" }, { once: true, call: async () => true })).rejects.toThrow(/Nothing was sent/);
    expect(replies[0]).toContain("Live money is off");
    expect(replies[0]).toContain("checkout is closed");
    expect(replies.join(" ")).not.toContain("secret-token");
  });

  it("sets the command menu without printing the token", async () => {
    expect(BOT_COMMANDS.map((item: { command: string }) => item.command)).toEqual([...TELEGRAM_COMMANDS]);
    const token = "123456789:AA-secret-token";
    const errors: string[] = [];
    let seen = "";
    const ok = await setMyCommands({
      token,
      fetchImpl: async (url: string, init?: { body?: string }) => {
        seen = String(url);
        const body = JSON.parse(String(init?.body));
        expect(body.commands.map((item: { command: string }) => item.command)).toEqual([...TELEGRAM_COMMANDS]);
        return { ok: true, status: 200 };
      },
      writeError: (line: string) => errors.push(line),
    });
    expect(ok).toBe(0);
    expect(seen).toContain(token);
    expect(errors).toEqual([]);
    const failed = await setMyCommands({
      token,
      fetchImpl: async () => {
        throw new Error(`connect https://api.telegram.org/bot${token}/setMyCommands`);
      },
      writeError: (line: string) => errors.push(line),
    });
    expect(failed).toBe(1);
    expect(errors.join(" ")).not.toContain(token);
    expect(errors.join(" ")).toContain("[redacted]");
    const env = { LUMEN_MONEY_LIVE: "true", LUMEN_TRADING_LIVE: "true", LUMEN_SALES_MODE: "live", LUMEN_SPEND_ENABLED: "true", MINT_ENABLED: "true", STRIPE_SECRET_KEY: "sk_live_x", LUMEN_TELEGRAM_BOT_TOKEN: token };
    expect(preparePollEnv({ LUMEN_TELEGRAM_MODE: "webhook" })).toBe(false);
    const logged: string[] = [];
    let ran = false;
    const code = await launchPoll({
      env,
      run: async () => {
        ran = true;
      },
      writeError: (line: string) => logged.push(line),
    });
    expect(code).toBe(1);
    expect(ran).toBe(false);
    expect(logged.join(" ")).toContain("Refusing to poll");
    expect(logged.join(" ")).not.toContain(token);
    expect(logged.join(" ")).not.toContain("sk_live");
  });

  it("accepts only a private message from the owner user in the owner chat", async () => {
    const db = openDatabase();
    const talk = () => ({ ok: true, reply: "talk" });
    const noon = atHour(12);
    const group = await acceptTelegramUpdate(db, live, ownerPacket("/mood", { chat: { id: 4242, type: "group" }, from: { id: 77 } }), "hook-secret", talk, noon);
    expect(group.reply).toBe("");
    const forwarded = await acceptTelegramUpdate(db, live, ownerPacket("/mood", { forward_origin: { type: "user" } }), "hook-secret", talk, noon);
    expect(forwarded.reply).toBe("");
    const edited = await acceptTelegramUpdate(db, live, JSON.stringify({ edited_message: { chat: { id: 4242, type: "private" }, from: { id: 77 }, text: "/mood", edit_date: 5 } }), "hook-secret", talk, noon);
    expect(edited.reply).toBe("");
    const missing = await acceptTelegramUpdate(db, { ...live, LUMEN_TELEGRAM_OWNER_USER_ID: "" }, ownerPacket("/mood"), "hook-secret", talk, noon);
    expect(missing.reply).toBe("");
    expect(db.prepare("SELECT COUNT(*) AS n FROM messages").get()).toEqual({ n: 0 });
    const kept = await acceptTelegramUpdate(db, live, ownerPacket("/help"), "hook-secret", talk, noon);
    expect(kept.reply).toContain("/status");
  });

  it("does not store plain text or call xAI when commands-only is the default", async () => {
    const db = openDatabase();
    kvSet(db, "brain", JSON.stringify(initialState()));
    const before = kvGet(db, "brain");
    let called = 0;
    const fetchImpl = (async () => {
      called += 1;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const env = { ...live, LUMEN_XAI_API_KEY: "xai-test-key-123456" };
    const reply = await acceptTelegramUpdate(db, env, ownerPacket("hello from the dock"), "hook-secret", () => {
      throw new Error("talk");
    }, atHour(12), { fetch: fetchImpl, send: () => undefined });
    expect(reply.reply).toBe(COMMANDS_ONLY_REPLY);
    expect(called).toBe(0);
    expect(kvGet(db, "brain")).toBe(before);
    expect(db.prepare("SELECT COUNT(*) AS n FROM messages").get()).toEqual({ n: 0 });
    const minimal = minimalPollEnv({
      PATH: "/usr/bin",
      HOME: "/tmp/secret-home",
      STRIPE_SECRET_KEY: "sk_live_nope",
      LUMEN_MINT_SIGNER_SECRET: "mint",
      LUMEN_TELEGRAM_BOT_TOKEN: "secret-token",
      LUMEN_TELEGRAM_OWNER_CHAT_ID: "4242",
      LUMEN_TELEGRAM_OWNER_USER_ID: "77",
    });
    expect(Object.keys(minimal).sort()).toEqual(["LUMEN_DATA", "LUMEN_TELEGRAM_BOT_TOKEN", "LUMEN_TELEGRAM_MODE", "LUMEN_TELEGRAM_OWNER_CHAT_ID", "LUMEN_TELEGRAM_OWNER_USER_ID", "NODE_ENV", "PATH", "TZ"]);
    expect(JSON.stringify(minimal)).not.toContain("sk_live");
    expect(forbiddenPollKeys({ STRIPE_WEBHOOK_SECRET: "whsec", LUMEN_PRIVACY_KEY: "p", PATH: "/bin" }).sort()).toEqual(["LUMEN_PRIVACY_KEY", "STRIPE_WEBHOOK_SECRET"]);
    const dir = `${process.cwd()}/data/tg-bundle-test`;
    const file = `${dir}/poll.mjs`;
    const { mkdirSync, writeFileSync, existsSync } = await import("node:fs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, "bundle");
    removePollBundle(file);
    expect(existsSync(file)).toBe(false);
    expect(existsSync(dir)).toBe(false);
    expect(numericTelegramId("77")).toBe(true);
    expect(numericTelegramId("4242")).toBe(true);
    expect(numericTelegramId("")).toBe(false);
    expect(numericTelegramId("77abc")).toBe(false);
    expect(numericTelegramId("0")).toBe(false);
    expect(ownerTelegram({ ...live, LUMEN_TELEGRAM_OWNER_USER_ID: "77" }).mode).toBe("live");
    expect(ownerTelegram({ ...live, LUMEN_TELEGRAM_OWNER_USER_ID: "" }).mode).toBe("mock");
    expect(ownerTelegram({ ...live, LUMEN_TELEGRAM_OWNER_CHAT_ID: "chat" }).mode).toBe("mock");
    expect(ownerUpdateAllowed({ ...live, LUMEN_TELEGRAM_OWNER_USER_ID: "user" }, { chat: { id: 4242, type: "private" }, from: { id: "user" }, text: "/help" })).toBe(false);
    const clean = minimalPollEnv({
      PATH: "/usr/bin",
      LUMEN_TELEGRAM_BOT_TOKEN: "secret-token",
      LUMEN_TELEGRAM_OWNER_CHAT_ID: "4242",
      LUMEN_TELEGRAM_OWNER_USER_ID: "77",
    });
    expect(pollEnvAllowed(clean)).toBe(true);
    expect(pollEnvAllowed({ ...clean, HOME: "/tmp" })).toBe(false);
    const { LUMEN_DATA: _dropped, ...missing } = clean;
    expect(pollEnvAllowed(missing)).toBe(false);
    expect(forbiddenPollKeys({
      stripe_secret_key: "sk",
      LUMEN_STRIPE_KEY: "x",
      MY_PRIVATE_KEY: "k",
      CARD_ISSUER: "stripe",
      OTHER_TOKEN: "t",
      LUMEN_TELEGRAM_BOT_TOKEN: "secret-token",
    }).sort()).toEqual(["CARD_ISSUER", "LUMEN_STRIPE_KEY", "MY_PRIVATE_KEY", "OTHER_TOKEN", "stripe_secret_key"]);
  });
});
