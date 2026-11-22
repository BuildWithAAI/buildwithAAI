import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/db";
import { fetchFxFeed, getFxOrder, placeFxOrder, watchFx, type FxFeed } from "../src/trading/forex";

/**
 * The price bridge itself, run as its own process the way the owner runs it, and asked over the wire by
 * the engine's own code. The only thing standing in is the MetaTrader 5 terminal: `tests/fixtures/mt5`
 * answers the bridge's read calls from a file this test writes. So this checks that the two halves, one
 * in Python and one here, agree on every byte of the signing, the nonce and the answer. It does not
 * check the bridge against a real terminal. That takes the owner's computer.
 */
const root = fileURLToPath(new URL("..", import.meta.url));
const python = ["python3", "python"].find((name) => spawnSync(name, ["--version"]).status === 0);
const PORT = 38_765;
const url = `http://127.0.0.1:${PORT}`;
const secret = randomBytes(24).toString("hex");
const folder = mkdtempSync(path.join(tmpdir(), "fx-bridge-"));
const tickFile = path.join(folder, "tick.json");
const pythonEnv = { ...process.env, PYTHONPATH: path.join(root, "tests", "fixtures", "mt5"), PYTHONDONTWRITEBYTECODE: "1", STANDIN_MT5_TICK: tickFile };
const env = { LUMEN_FX_BRIDGE_URL: url, LUMEN_FX_BRIDGE_SECRET: secret };

let stamp = 1_000;
/** The terminal's price moves. Written whole and swapped in, so the bridge never reads half a file. */
function price(bid: number, ask: number = bid + 0.00008): void {
  stamp += 1;
  writeFileSync(`${tickFile}.next`, JSON.stringify({ bid, ask, msc: stamp }));
  // On Windows a swap can be refused for an instant while the bridge has the file open.
  for (let tries = 0; ; tries += 1) {
    try {
      return renameSync(`${tickFile}.next`, tickFile);
    } catch (error) {
      if (tries >= 20) throw error;
    }
  }
}

const sign = (body: string, key = secret) => createHmac("sha256", key).update(body).digest("hex");
const fresh = () => ({ nonce: randomBytes(16).toString("hex"), issuedAtMs: Date.now() });

async function send(body: string, signature: string | null = sign(body)): Promise<{ status: number; text: string; signature: string | null }> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(signature ? { "x-lumen-signature": signature } : {}) }, body });
  return { status: response.status, text: await response.text(), signature: response.headers.get("x-lumen-signature") };
}

async function until<T>(read: () => Promise<T | null | false | undefined>, ms = 8_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await read().catch(() => null);
    if (value) return value;
    if (Date.now() > end) throw new Error("the bridge did not get there in time");
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
}

/** Waits until the bridge has seen the terminal's price reach a bid, and gives back what the engine then reads. */
const seen = (bidPoints: number, since = 0): Promise<FxFeed> => until(async () => {
  const feed = await fetchFxFeed("AUDUSD", since, env, Date.now());
  return feed && feed.path[feed.path.length - 1].bid === bidPoints ? feed : null;
});

function run(args: string[], more: Record<string, string> = {}): { status: number | null; out: string } {
  const done = spawnSync(python!, ["bridge/mt5_bridge.py", ...args], { cwd: root, env: { ...pythonEnv, ...more }, encoding: "utf8", timeout: 10_000 });
  return { status: done.status, out: `${done.stdout}${done.stderr}` };
}

describe.skipIf(!python)("the price bridge, run as its own process", () => {
  let child: ChildProcess | undefined;
  let printed = "";

  beforeAll(async () => {
    price(0.651);
    child = spawn(python!, ["bridge/mt5_bridge.py"], { cwd: root, env: { ...pythonEnv, LUMEN_FX_BRIDGE_SECRET: secret, LUMEN_FX_BRIDGE_PORT: String(PORT), PYTHONUNBUFFERED: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout?.on("data", (chunk) => (printed += String(chunk)));
    child.stderr?.on("data", (chunk) => (printed += String(chunk)));
    // It is up once it answers at all. With no price change seen yet, its answer is that it has no price.
    await until(async () => (await send(JSON.stringify({ instruction: "quote", pair: "AUDUSD", ...fresh() }))).status === 503);
  });

  afterAll(() => {
    child?.kill();
    rmSync(folder, { recursive: true, force: true });
  });

  it("cannot trade: no call that places, changes, closes or cancels an order is in it", () => {
    const source = readFileSync(path.join(root, "bridge", "mt5_bridge.py"), "utf8");
    for (const call of [/order_(send|check|calc)/, /TRADE_ACTION/, /positions_get|orders_get|history_/, /\.login\s*\(/, /password\s*=/i]) expect(source).not.toMatch(call);
    // Every call it makes into the terminal is one of these, and all of them only read.
    const calls = [...source.matchAll(/mt5\.([a-z_]+)\(/g)].map((match) => match[1]);
    expect([...new Set(calls)].sort()).toEqual(["account_info", "initialize", "last_error", "shutdown", "symbol_info", "symbol_info_tick", "symbol_select", "symbols_get", "terminal_info"]);
    expect(printed).toContain("DEMO account. Reading AUDUSD as AUDUSD.s. It cannot trade.");
  });

  it("prints what the terminal shows, and says so when the broker's pair is not what her book assumes", () => {
    const good = run(["--check"]);
    expect(good.status).toBe(0);
    expect(good.out).toContain("account: DEMO on StandIn-Demo, ending 321");
    // A broker's pair with a suffix is found, and the one that can be traded is chosen over the one that cannot.
    expect(good.out).toContain("AUDUSD is called AUDUSD.s here. Other names seen: AUDUSD+");
    expect(good.out).toContain("digits 5, one lot 100000 AUD, lots from 0.01 in steps of 0.01");
    expect(good.out).toContain("on 0.01 lot one pip is 10.00 cents here, so 30 pips is 3.00 USD");
    expect(good.out).toContain("programs may trade: terminal yes, account yes, account by program yes");
    expect(good.out).toContain("trading by Python switched off in the terminal: no. Closing oldest first only: no");
    expect(good.out).toContain("orders allowed: market, limit, stop, stop-limit, stop loss, take profit, close by (127)");
    expect(good.out).toContain("check: ok");
    // The account number is not printed, so the print can be pasted anywhere.
    expect(good.out).not.toContain("87654321");

    const small = run(["--check"], { STANDIN_MT5_CONTRACT: "10000" });
    expect(small.status).toBe(1);
    expect(small.out).toContain("THIS IS NOT what her book assumes");
    const real = run(["--check"], { STANDIN_MT5_ACCOUNT: "2" });
    expect(real.out).toContain("account: REAL on StandIn-Demo");
    const down = run(["--check"], { STANDIN_MT5_DOWN: "1" });
    expect(down.status).toBe(2);
    expect(down.out).toContain("Could not attach to a MetaTrader 5 terminal");
    // With no secret it does not start.
    const bare = run([], { LUMEN_FX_BRIDGE_PORT: String(PORT + 1) });
    expect(bare.status).toBe(2);
    expect(bare.out).toContain("Nothing was started");
  });

  it("lets nobody in who is not the engine, and lets a request in once", async () => {
    const body = () => JSON.stringify({ instruction: "quote", pair: "AUDUSD", ...fresh() });
    expect((await send(body(), null)).status).toBe(401);
    expect((await send(body(), sign(body(), "another secret"))).status).toBe(401);
    expect((await send(body(), "ünsigned")).status).toBe(401);
    // Signed, but sent two minutes ago by this computer's clock.
    const old = JSON.stringify({ instruction: "quote", pair: "AUDUSD", nonce: randomBytes(16).toString("hex"), issuedAtMs: Date.now() - 120_000 });
    expect((await send(old)).status).toBe(401);
    expect((await send(JSON.stringify({ instruction: "quote", pair: "AUDUSD", issuedAtMs: Date.now() }))).status).toBe(401);
    // The same signed request a second time is a replay.
    const once = body();
    expect((await send(once)).status).not.toBe(401);
    expect((await send(once)).status).toBe(401);
    expect((await send("x".repeat(3_000))).status).toBe(400);
    expect((await fetch(url)).status).not.toBe(200);
    // A refusal to a stranger says nothing and is not signed.
    const stranger = await send(body(), null);
    expect([stranger.text, stranger.signature]).toEqual(["", null]);
  });

  it("answers only for a price, and an instruction to trade gets nothing done", async () => {
    for (const instruction of ["place", "swap", "close", "cancel", undefined]) {
      const ask = { instruction, pair: "AUDUSD", lots: "0.01", side: "buy", ...fresh() };
      const answer = await send(JSON.stringify(ask));
      expect(answer.status).toBe(400);
      expect(JSON.parse(answer.text)).toEqual({ ok: false, reason: "READ_ONLY", nonce: ask.nonce });
      // Even a refusal to the engine is signed, so it cannot be forged either.
      expect(answer.signature).toBe(sign(answer.text));
    }
    const other = await send(JSON.stringify({ instruction: "quote", pair: "EURUSD", ...fresh() }));
    expect([other.status, JSON.parse(other.text).reason]).toEqual([400, "PAIR"]);
  });

  it("gives no price until it has seen the price change, then every change in order, under the terminal's own name", async () => {
    // The price it found when it started could be days old with the market shut, so it is not passed on.
    const before = await send(JSON.stringify({ instruction: "quote", pair: "AUDUSD", ...fresh() }));
    expect([before.status, JSON.parse(before.text).reason]).toEqual([503, "NO_PRICE"]);
    expect(await fetchFxFeed("AUDUSD", 0, env, Date.now())).toBeNull();

    const started = Date.now();
    price(0.6511);
    await seen(65_110);
    price(0.6512);
    await seen(65_120);
    price(0.6513, 0.65141);
    const feed = await seen(65_130);
    expect(feed).toMatchObject({ pair: "AUDUSD", account: "demo", stopsLevel: 0 });
    expect(feed.path.map((step) => [step.bid, step.ask])).toEqual([[65_110, 65_118], [65_120, 65_128], [65_130, 65_141]]);
    // Each change carries this computer's time, not the terminal's.
    for (const step of feed.path) expect(step.at).toBeGreaterThanOrEqual(started);
    expect(feed.path.map((step) => step.at)).toEqual([...feed.path.map((step) => step.at)].sort((a, b) => a - b));
    // Asked for what came after the first change, it gives the two that did. Asked for what came after the last, it still gives the newest.
    expect((await fetchFxFeed("AUDUSD", feed.path[0].at, env, Date.now()))!.path.map((step) => step.bid)).toEqual([65_120, 65_130]);
    expect((await fetchFxFeed("AUDUSD", feed.path[2].at, env, Date.now()))!.path.map((step) => step.bid)).toEqual([65_130]);
    // The raw answer names the terminal's symbol and is signed with the shared secret.
    const ask = { instruction: "quote", pair: "AUDUSD", sinceMs: feed.path[2].at, ...fresh() };
    const raw = await send(JSON.stringify(ask));
    expect(JSON.parse(raw.text)).toMatchObject({ ok: true, nonce: ask.nonce, pair: "AUDUSD", symbol: "AUDUSD.s", digits: 5, contract: 100_000, account: "demo" });
    expect(raw.signature).toBe(sign(raw.text));
    // The engine does not believe an answer under another secret.
    expect(await fetchFxFeed("AUDUSD", 0, { ...env, LUMEN_FX_BRIDGE_SECRET: "x".repeat(40) }, Date.now())).toBeNull();
  });

  it("carries a whole paper trade: her order, her fill and her target, on prices that came over the wire", async () => {
    const db = openDatabase();
    price(0.651);
    const market = await seen(65_100);
    const placed = placeFxOrder(db, env, { pair: "AUDUSD", side: "buy", limit: "0.65000", target: "0.65600", thesis: "the price has held this level three times this week", influencedByVisitor: false, influencedByWeb: false, influencedByTelegram: false }, market, Date.now());
    expect(placed).toMatchObject({ ok: true, mode: "paper", status: "resting", stop: "0.64700" });
    const id = (placed as { id: string }).id;
    // Nothing has happened since she placed it.
    expect(await watchFx(db, env, Date.now())).toEqual({ filled: 0, stopped: 0, taken: 0, expired: 0 });
    // The price comes down to her limit, then runs through her target, between two looks of the engine.
    const placedAt = getFxOrder(db, id)!.createdAt;
    price(0.6499);
    await seen(64_990, placedAt);
    price(0.6561);
    await seen(65_610, placedAt);
    price(0.64);
    await seen(64_000, placedAt);
    expect(await watchFx(db, env, Date.now())).toEqual({ filled: 1, stopped: 0, taken: 1, expired: 0 });
    expect(getFxOrder(db, id)).toMatchObject({ status: "closed", fill: "0.65000", exit: "0.65600", exitWhy: "target", resultCents: 600 });
  });
});
