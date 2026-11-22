import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/db";
import { fetchFxBars, fetchFxFeed, getFxOrder, placeFxOrder, watchFx, type FxFeed } from "../src/trading/forex";

/**
 * The bridge itself, run as its own process the way the owner runs it, and asked over the wire, by raw
 * requests and by the engine's own code.
 *
 * What stands in is MetaTrader 5: `tests/fixtures/mt5` answers the bridge's calls from files this test
 * writes, keeps a small book of orders, and writes down every request the bridge sends it. So this checks
 * the whole of the bridge's side, and that the two halves, one in Python and one here, agree. It does not
 * check the bridge against a real terminal or a real broker. That takes the owner's computer, and
 * `--check` and `--prove` are that run.
 */
const root = fileURLToPath(new URL("..", import.meta.url));
const python = ["python3", "python"].find((name) => spawnSync(name, ["--version"]).status === 0);
const PORT = 38_765;
const url = `http://127.0.0.1:${PORT}`;
const secret = randomBytes(24).toString("hex");
const folder = mkdtempSync(path.join(tmpdir(), "fx-bridge-"));
const file = (name: string) => path.join(folder, name);
const tickFile = file("tick.json");
const barsFile = file("bars.json");
const pythonEnv = { ...process.env, PYTHONPATH: path.join(root, "tests", "fixtures", "mt5"), PYTHONDONTWRITEBYTECODE: "1", STANDIN_MT5_TICK: tickFile, STANDIN_MT5_BARS: barsFile };
const served = { STANDIN_MT5_CONTROL: file("control.json"), STANDIN_MT5_BOOK: file("book.json"), LUMEN_FX_BRIDGE_JOURNAL: file("journal.json"), STANDIN_MT5_ACCOUNT: "2" };
const env = { LUMEN_FX_BRIDGE_URL: url, LUMEN_FX_BRIDGE_SECRET: secret };

function swap(target: string, text: string): void {
  writeFileSync(`${target}.next`, text);
  // On Windows a swap can be refused for an instant while the bridge has the file open.
  for (let tries = 0; ; tries += 1) {
    try {
      return renameSync(`${target}.next`, target);
    } catch (error) {
      if (tries >= 20) throw error;
    }
  }
}

let stamp = 1_000;
/** The terminal's price moves. Written whole and swapped in, so the bridge never reads half a file. */
function price(bid: number, ask: number = bid + 0.00008, target = tickFile): void {
  stamp += 1;
  swap(target, JSON.stringify({ bid, ask, msc: stamp }));
}

/**
 * The terminal's price history, as MetaTrader gives it: for each bar its opening time by the broker's
 * clock, in seconds, then open, high, low and close as prices, the tick count and the spread.
 */
const HOUR = 3_600;
const monday = Date.UTC(2026, 10, 16) / 1000;
const hourly = Array.from({ length: 8 }, (_, i) => [monday + i * HOUR, 0.65 + i * 0.0001, 0.6503 + i * 0.0001, 0.6498 + i * 0.0001, 0.6501 + i * 0.0001, 100 + i, 8]);
const daily = Array.from({ length: 6 }, (_, i) => [monday + i * 24 * HOUR, 0.64 + i * 0.001, 0.645 + i * 0.001, 0.638 + i * 0.001, 0.641 + i * 0.001, 5_000 + i, 9]);
const history = (frames: Record<string, number[][]> = { H1: hourly, D1: daily }, target = barsFile) => swap(target, JSON.stringify(frames));

/** What the stand-in broker is told to do differently from now on. */
const broker = (control: Record<string, unknown> = {}, target = served.STANDIN_MT5_CONTROL) => swap(target, JSON.stringify(control));

type Sent = { call: string; request: Record<string, unknown> };
type Book = { sent: Sent[]; orders: Record<string, unknown>[]; positions: Record<string, unknown>[]; deals: Record<string, unknown>[] };
/** Everything the bridge has sent the broker, and what the broker holds. */
const book = (target = served.STANDIN_MT5_BOOK): Book => (existsSync(target) ? (JSON.parse(readFileSync(target, "utf8")) as Book) : { sent: [], orders: [], positions: [], deals: [] });
const orderSends = () => book().sent.filter((item) => item.call === "order_send");

const sign = (body: string, key = secret) => createHmac("sha256", key).update(body).digest("hex");
const fresh = () => ({ nonce: randomBytes(16).toString("hex"), issuedAtMs: Date.now() });
const newId = () => `fx-${randomBytes(4).toString("hex")}`;

async function send(body: string, signature: string | null = sign(body)): Promise<{ status: number; text: string; signature: string | null }> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(signature ? { "x-lumen-signature": signature } : {}) }, body });
  return { status: response.status, text: await response.text(), signature: response.headers.get("x-lumen-signature") };
}

/** One signed question, the way the engine asks it. The answer has to be signed and carry the question's nonce. */
async function ask(instruction: string, fields: Record<string, unknown> = {}): Promise<{ status: number; json: Record<string, unknown> }> {
  const question = { instruction, ...fields, ...fresh() };
  const answer = await send(JSON.stringify(question));
  const json = JSON.parse(answer.text) as Record<string, unknown>;
  expect(answer.signature).toBe(sign(answer.text));
  expect(json.nonce).toBe(question.nonce);
  return { status: answer.status, json };
}

/** A buy at 0.65000 with the book's stop and a target, as the engine sends it. */
const buy = (over: Record<string, unknown> = {}) => ({ id: newId(), pair: "AUDUSD", side: "buy", centiLots: 1, limit: 65_000, stop: 64_700, target: 65_600, lossCents: 300, ...over });
const sell = (over: Record<string, unknown> = {}) => buy({ side: "sell", limit: 65_500, stop: 65_800, target: 65_000, ...over });

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

/** Moves the price and waits for the bridge to have seen it. */
async function market(bid: number): Promise<void> {
  price(bid);
  await seen(Math.round(bid * 100_000));
}

const standing = (id: string, status: string) => until(async () => {
  const answer = await ask("state", { id });
  return answer.json.status === status ? answer.json : null;
});

function run(args: string[], more: Record<string, string> = {}): { status: number | null; out: string } {
  const done = spawnSync(python!, ["bridge/mt5_bridge.py", ...args], { cwd: root, env: { ...pythonEnv, LUMEN_FX_CHECK_SECONDS: "0.3", LUMEN_FX_BRIDGE_JOURNAL: file(`journal-${randomBytes(3).toString("hex")}.json`), ...more }, encoding: "utf8", timeout: 12_000 });
  return { status: done.status, out: `${done.stdout}${done.stderr}` };
}

describe.skipIf(!python)("the bridge, run as its own process", () => {
  let child: ChildProcess | undefined;
  let printed = "";

  async function start(): Promise<void> {
    child = spawn(python!, ["bridge/mt5_bridge.py"], { cwd: root, env: { ...pythonEnv, ...served, LUMEN_FX_BRIDGE_SECRET: secret, LUMEN_FX_BRIDGE_PORT: String(PORT), PYTHONUNBUFFERED: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout?.on("data", (chunk) => (printed += String(chunk)));
    child.stderr?.on("data", (chunk) => (printed += String(chunk)));
    // It is up once it answers at all. With no price change seen yet, its answer is that it has no price.
    await until(async () => (await send(JSON.stringify({ instruction: "quote", pair: "AUDUSD", ...fresh() }))).status === 503);
  }

  beforeAll(async () => {
    price(0.651);
    broker();
    history();
    await start();
  });

  afterAll(() => {
    child?.kill();
    rmSync(folder, { recursive: true, force: true });
  });

  it("has no market order in it, no changing of a stop or a target, no closing of a trade, and no login", () => {
    const source = readFileSync(path.join(root, "bridge", "mt5_bridge.py"), "utf8");
    for (const never of [/TRADE_ACTION_(DEAL|SLTP|MODIFY|CLOSE_BY)/, /ORDER_TYPE_(BUY|SELL)_STOP/, /\.login\s*\(/, /password\s*=/i, /order_send_async|order_close/]) expect(source).not.toMatch(never);
    // Every call it makes into the terminal is one of these.
    const calls = [...source.matchAll(/mt5\.([a-z_]+)\(/g)].map((match) => match[1]);
    expect([...new Set(calls)].sort()).toEqual(["account_info", "copy_rates_from_pos", "history_deals_get", "history_orders_get", "initialize", "last_error", "order_calc_profit", "order_check", "order_send", "orders_get", "positions_get", "shutdown", "symbol_info", "symbol_info_tick", "symbol_select", "symbols_get", "terminal_info"]);
    // An order is sent from two places only: one places a waiting limit order, the other pulls one. Each names its action outright.
    const actions = [...source.matchAll(/"action":\s*number\((?:self\.)?mt5,\s*"([A-Z_]+)"\)/g)].map((match) => match[1]);
    expect(new Set(actions)).toEqual(new Set(["TRADE_ACTION_PENDING", "TRADE_ACTION_REMOVE"]));
    expect(source.match(/"action":/g)).toHaveLength(actions.length);
    expect(printed).toContain("REAL account. AUDUSD as AUDUSD.s. LIVE: her orders go to the broker, 0.01 lot each.");
  });

  it("prints what the terminal shows and what it says to an order like hers, and sends nothing", () => {
    const quiet = { STANDIN_MT5_BOOK: file("check-book.json") };
    const good = run(["--check"], quiet);
    expect(good.status).toBe(0);
    expect(good.out).toContain("account: DEMO on StandIn-Demo, ending 321");
    // A broker's pair with a suffix is found, and the one that can be traded is chosen over the one that cannot.
    expect(good.out).toContain("AUDUSD is called AUDUSD.s here. Other names seen: AUDUSD+");
    expect(good.out).toContain("digits 5, one lot 100000 AUD, lots from 0.01 in steps of 0.01");
    expect(good.out).toContain("on 0.01 lot one pip is 10.00 cents here, so 30 pips is 3.00 USD");
    expect(good.out).toContain("last price: bid 0.65100, ask 0.65108, spread 0.8 pips");
    expect(good.out).toContain("watched for 0.3 seconds: the price did not change");
    expect(good.out).toContain("programs may trade: terminal yes, account yes, account by program yes");
    expect(good.out).toContain("trading by Python switched off in the terminal: no. Closing oldest first only: no");
    expect(good.out).toContain("orders allowed: market, limit, stop, stop-limit, stop loss, take profit, close by (127)");
    expect(good.out).toContain("the owner's rule held by this bridge: 0.01 lot a trade, no more than 3.00 lost at its stop");
    // The terminal's own arithmetic for her stop, and its own word on an order like hers.
    expect(good.out).toContain("the terminal's own sum for a loss of 30.0 pips on 0.01 lot: -3.00 USD");
    expect(good.out).toContain("asked whether it would take a 0.01-lot buy limit with a stop and a target: yes (0 Done). Nothing was sent.");
    // Her research reads the broker's own history. The check reads a few bars of it and says what it got.
    expect(good.out).toContain("history, D1 bars: 5 read. The newest opens at 2026-11-21 00:00 by the broker's clock.");
    expect(good.out).toContain("history, H1 bars: 5 read. The newest opens at 2026-11-16 07:00 by the broker's clock.");
    expect(good.out).toContain("check: ok");
    // The account number is not printed, so the print can be pasted anywhere.
    expect(good.out).not.toContain("87654321");
    // It asked the terminal to check an order and sent none.
    expect(book(quiet.STANDIN_MT5_BOOK).sent.map((item) => item.call)).toEqual(["order_check"]);

    // A fresh terminal: the pair is not in Market Watch, so it has no price and a blank pip value. The check adds it and reads it again.
    const hidden = run(["--check"], { STANDIN_MT5_HIDDEN: "1" });
    expect(hidden.status).toBe(0);
    expect(hidden.out).toContain("last price: bid 0.65100, ask 0.65108");
    expect(hidden.out).toContain("so 30 pips is 3.00 USD");

    // A broker whose lot is a tenth the size: the terminal's own sum is not the rule's, and the check says so.
    const small = run(["--check"], { STANDIN_MT5_CONTRACT: "10000" });
    expect(small.status).toBe(1);
    expect(small.out).toContain("the terminal's own sum for a loss of 300.0 pips on 0.01 lot: -3.00 USD");
    expect(small.out).toContain("THIS IS NOT what her book assumes");
    // A terminal that will not let a program trade.
    const off = file("off.json");
    broker({ algo_off: true, reject_check: 10027 }, off);
    const shut = run(["--check"], { STANDIN_MT5_CONTROL: off });
    expect(shut.status).toBe(1);
    expect(shut.out).toContain("programs may trade: terminal NO");
    expect(shut.out).toContain("asked whether it would take a 0.01-lot buy limit with a stop and a target: NO (10027 Rejected by the test)");
    // A terminal that gives no history: her research would have nothing to read, and the check says so.
    const blank = file("blank.json");
    broker({ no_history: true }, blank);
    const empty = run(["--check"], { STANDIN_MT5_CONTROL: blank });
    expect(empty.status).toBe(1);
    expect(empty.out).toContain("history, D1 bars: NONE GIVEN");
    expect(empty.out).toContain("check: something above needs a look");
    // The owner's own figures, if he has set them.
    expect(run(["--check"], { LUMEN_FX_LOTS: "0.02", LUMEN_FX_RISK_USD: "5" }).out).toContain("0.02 lot a trade, no more than 5.00 lost at its stop");
    expect(run(["--check"], { STANDIN_MT5_ACCOUNT: "2" }).out).toContain("account: REAL on StandIn-Demo");
    const down = run(["--check"], { STANDIN_MT5_DOWN: "1" });
    expect(down.status).toBe(2);
    expect(down.out).toContain("Could not attach to a MetaTrader 5 terminal");
    // With no secret it does not start. With a record of what was sent that cannot be read, it does not start either.
    const bare = run([], { LUMEN_FX_BRIDGE_PORT: String(PORT + 1) });
    expect([bare.status, bare.out.includes("Nothing was started")]).toEqual([2, true]);
    writeFileSync(file("torn.json"), "{ not a journal");
    const torn = run([], { LUMEN_FX_BRIDGE_PORT: String(PORT + 1), LUMEN_FX_BRIDGE_SECRET: secret, LUMEN_FX_BRIDGE_JOURNAL: file("torn.json") });
    expect([torn.status, torn.out.includes("cannot be read")]).toEqual([2, true]);
  }, 60_000);

  it("proves the road with one real order that cannot fill: placed, read back, not sent twice, pulled", () => {
    const own = { STANDIN_MT5_BOOK: file("prove-book.json"), STANDIN_MT5_CONTROL: file("prove-control.json") };
    broker({}, own.STANDIN_MT5_CONTROL);
    const proved = run(["--prove"], own);
    expect(proved.status).toBe(0);
    expect(proved.out).toContain("1. placing a real 0.01-lot buy limit at 0.62100, 300 pips under the market, stop 0.61800, target 0.62400");
    expect(proved.out).toContain("the broker holds it: ticket");
    expect(proved.out).toContain("2. asked to place the same order again: it was not sent twice");
    expect(proved.out).toContain("3. pulling it: pulled");
    expect(proved.out).toContain("4. her orders left at the broker in AUDUSD.s: 0");
    expect(proved.out).toContain("prove: ok. The road her orders take works on this account.");
    const left = book(own.STANDIN_MT5_BOOK);
    expect(left.sent.map((item) => `${item.call}:${item.request.action}`)).toEqual(["order_check:5", "order_send:5", "order_send:8"]);
    expect([left.orders, left.positions]).toEqual([[], []]);

    // When the terminal will not let a program trade, it says so and nothing is placed.
    broker({ python_off: true }, own.STANDIN_MT5_CONTROL);
    const shut = run(["--prove"], { ...own, STANDIN_MT5_BOOK: file("prove-shut.json") });
    expect(shut.status).toBe(1);
    expect(shut.out).toContain('NOT PLACED: {"ok": false, "reason": "TRADING_OFF"}');
    expect(book(file("prove-shut.json")).sent).toEqual([]);
    // When the order cannot be pulled, it says which ticket to look at.
    broker({ remove_fails: true }, own.STANDIN_MT5_CONTROL);
    const held = run(["--prove"], { ...own, STANDIN_MT5_BOOK: file("prove-held.json") });
    expect(held.status).toBe(1);
    expect(held.out).toMatch(/3\. pulling it: NOT PULLED: .* Look at ticket \d+ in the terminal\./);
  }, 60_000);

  it("watches the price for a few seconds and says whether the market is moving", async () => {
    const own = file("check.json");
    price(0.651, 0.65108, own);
    const watching = spawn(python!, ["bridge/mt5_bridge.py", "--check"], { cwd: root, env: { ...pythonEnv, STANDIN_MT5_TICK: own, LUMEN_FX_CHECK_SECONDS: "2", PYTHONUNBUFFERED: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    watching.stdout?.on("data", (chunk) => (out += String(chunk)));
    const ended = new Promise<number | null>((resolve) => watching.on("close", resolve));
    // The price moves while it watches. Each price carries the broker's clock, which here is two hours ahead of this computer's.
    for (let step = 2; step < 14; step += 1) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      swap(own, JSON.stringify({ bid: 0.651 + step / 100_000, ask: 0.65108 + step / 100_000, msc: Date.now() + 2 * HOUR * 1000 }));
    }
    expect(await ended).toBe(0);
    const changed = /watched for 2\.0 seconds: the price changed (\d+) times\. The market is open/.exec(out);
    expect(changed).not.toBeNull();
    expect(Number(changed![1])).toBeGreaterThanOrEqual(2);
    expect(out).toContain("the broker's clock: +2 hours from UTC. Its bars are stamped in that clock.");
  });

  it("lets nobody in who is not the engine, and lets a request in once", async () => {
    const body = () => JSON.stringify({ instruction: "place", ...buy(), ...fresh() });
    expect((await send(body(), null)).status).toBe(401);
    expect((await send(body(), sign(body(), "another secret"))).status).toBe(401);
    expect((await send(body(), "ünsigned")).status).toBe(401);
    // Signed, but sent two minutes ago by this computer's clock.
    const old = JSON.stringify({ instruction: "place", ...buy(), nonce: randomBytes(16).toString("hex"), issuedAtMs: Date.now() - 120_000 });
    expect((await send(old)).status).toBe(401);
    expect((await send(JSON.stringify({ instruction: "place", ...buy(), issuedAtMs: Date.now() }))).status).toBe(401);
    // The same signed request a second time is a replay.
    const once = JSON.stringify({ instruction: "quote", pair: "AUDUSD", ...fresh() });
    expect((await send(once)).status).not.toBe(401);
    expect((await send(once)).status).toBe(401);
    expect((await send("x".repeat(3_000))).status).toBe(400);
    expect((await fetch(url)).status).not.toBe(200);
    // A refusal to a stranger says nothing and is not signed. And none of those orders went anywhere.
    const stranger = await send(body(), null);
    expect([stranger.text, stranger.signature]).toEqual(["", null]);
    expect(book().sent).toEqual([]);
  });

  it("gives no price until it has seen the price change, then every change in order, under the terminal's own name", async () => {
    // The price it found when it started could be days old with the market shut, so it is not passed on.
    const before = await ask("quote", { pair: "AUDUSD" });
    expect([before.status, before.json.reason]).toEqual([503, "NO_PRICE"]);
    expect(await fetchFxFeed("AUDUSD", 0, env, Date.now())).toBeNull();
    const started = Date.now();
    price(0.6511);
    await seen(65_110);
    price(0.6512);
    await seen(65_120);
    price(0.6513, 0.65141);
    const feed = await seen(65_130);
    expect(feed).toMatchObject({ pair: "AUDUSD", account: "real", stopsLevel: 0 });
    expect(feed.path.map((step) => [step.bid, step.ask])).toEqual([[65_110, 65_118], [65_120, 65_128], [65_130, 65_141]]);
    // Each change carries this computer's time, not the terminal's.
    for (const step of feed.path) expect(step.at).toBeGreaterThanOrEqual(started);
    expect((await fetchFxFeed("AUDUSD", feed.path[0].at, env, Date.now()))!.path.map((step) => step.bid)).toEqual([65_120, 65_130]);
    expect((await fetchFxFeed("AUDUSD", feed.path[2].at, env, Date.now()))!.path.map((step) => step.bid)).toEqual([65_130]);
    expect((await ask("quote", { pair: "AUDUSD" })).json).toMatchObject({ ok: true, pair: "AUDUSD", symbol: "AUDUSD.s", digits: 5, contract: 100_000, account: "real" });
    expect((await ask("quote", { pair: "EURUSD" })).json).toMatchObject({ ok: false, reason: "PAIR" });
    // The engine does not believe an answer under another secret.
    expect(await fetchFxFeed("AUDUSD", 0, { ...env, LUMEN_FX_BRIDGE_SECRET: "x".repeat(40) }, Date.now())).toBeNull();
  });

  it("places her order at the broker exactly as sent, reads it back, and never sends it twice", async () => {
    await market(0.651);
    const order = buy();
    const placed = await ask("place", order);
    expect(placed.status).toBe(200);
    expect(placed.json).toMatchObject({ ok: true, id: order.id, status: "resting", account: "real", side: "buy", centiLots: 1, limit: 65_000, stop: 64_700, target: 65_600, ticket: expect.stringMatching(/^\d+$/) });
    // What the broker was sent, whole: a waiting buy limit, her size, her price, with its stop and its target in the same request.
    const want = { action: 5, symbol: "AUDUSD.s", volume: 0.01, type: 2, price: 0.65, sl: 0.647, tp: 0.656, deviation: 0, magic: 20_261_122, comment: `zoora ${order.id}`, type_time: 0, type_filling: 2 };
    expect(book().sent).toEqual([{ call: "order_check", request: want }, { call: "order_send", request: want }]);
    expect(book().orders).toEqual([expect.objectContaining({ ticket: Number(placed.json.ticket), type: 2, volume_initial: 0.01, price_open: 0.65, sl: 0.647, tp: 0.656, magic: 20_261_122, comment: `zoora ${order.id}` })]);
    // Asked to place the same order again, it says where that order stands and sends nothing.
    const again = await ask("place", order);
    expect(again.json).toMatchObject({ ok: true, status: "resting", ticket: placed.json.ticket });
    expect(orderSends()).toHaveLength(1);
    // One order of hers in a pair at a time, whatever it is asked.
    expect((await ask("place", buy({ limit: 64_900, stop: 64_600, target: 65_500 }))).json).toMatchObject({ ok: false, reason: "ALREADY" });
    expect((await ask("state", { id: order.id })).json).toMatchObject({ ok: true, status: "resting" });
    // Pulled, it is gone from the broker, and it is remembered as pulled.
    expect((await ask("cancel", { id: order.id })).json).toMatchObject({ ok: true, status: "cancelled" });
    expect(book().orders).toEqual([]);
    expect(orderSends().map((item) => item.request)).toEqual([want, { action: 8, order: Number(placed.json.ticket) }]);
    expect((await ask("state", { id: order.id })).json).toMatchObject({ status: "cancelled" });
    expect((await ask("state", { id: newId() })).json).toMatchObject({ ok: true, status: "none" });
    // Its record of what it sent holds the order and no secret.
    const journal = readFileSync(served.LUMEN_FX_BRIDGE_JOURNAL, "utf8");
    expect(JSON.parse(journal)[order.id]).toMatchObject({ state: "cancelled", ticket: Number(placed.json.ticket), limit: 65_000, stop: 64_700, target: 65_600, account: "real" });
    expect(journal).not.toContain(secret);
  });

  it("refuses an order that is not the owner's rule or that the terminal will not have, and sends nothing", async () => {
    await market(0.651);
    const before = orderSends().length;
    const refused = async (order: Record<string, unknown>, reason: string, control: Record<string, unknown> = {}, more: Record<string, unknown> = {}) => {
      broker(control);
      const answer = await ask("place", order);
      expect([answer.status, answer.json]).toEqual([409, expect.objectContaining({ ok: false, reason, ...more })]);
      expect(orderSends()).toHaveLength(before);
    };
    // The owner's rule, held by the bridge too: his size and no other, and no more lost at the stop than he said.
    await refused(buy({ centiLots: 2 }), "LOTS", {}, { allowed: 1 });
    await refused(buy({ centiLots: 100, stop: 64_997, lossCents: 300 }), "LOTS");
    await refused(buy({ stop: 64_600, lossCents: 400 }), "RISK", {}, { allowedCents: 300 });
    // The terminal's own sum for the loss at her stop has to be what she said it was.
    await refused(buy({ lossCents: 200 }), "RISK", {}, { terminalCents: 300 });
    await refused(buy({ stop: 64_900, lossCents: 300 }), "RISK", {}, { terminalCents: 100 });
    // A limit order waits at a better price than the market. The ask is 0.65108.
    await refused(buy({ limit: 65_108, stop: 64_808, target: 65_700 }), "FX_LIMIT", {}, { bid: 65_100, ask: 65_108 });
    await refused(sell({ limit: 65_100, stop: 65_400, target: 64_600 }), "FX_LIMIT");
    await refused(buy({ limit: 65_050 }), "FX_LIMIT", { stops_level: 100 });
    for (const levels of [{ stop: 65_300 }, { target: 64_900 }, { limit: 0 }, { limit: 65_000.5 }, { stop: "64700" }, { lossCents: -300 }]) await refused(buy(levels), "LEVELS");
    await refused(buy({ id: "fx-1" }), "ID");
    await refused(buy({ pair: "EURUSD" }), "PAIR");
    await refused(buy({ side: "long" }), "SIDE");
    // A terminal or an account that is not open to a program's orders.
    await refused(buy(), "TERMINAL", { offline: true });
    await refused(buy(), "TRADING_OFF", { algo_off: true });
    await refused(buy(), "TRADING_OFF", { python_off: true });
    await refused(buy(), "ACCOUNT_OFF", { account_off: true });
    await refused(buy(), "ACCOUNT_OFF", { expert_off: true });
    await refused(buy(), "NETTING", { netting: true });
    await refused(buy(), "CURRENCY", { currency: "EUR" }, { currency: "EUR" });
    // A broker that does not allow a limit order with a stop and a target on this pair.
    await refused(buy(), "ORDER_KIND", { order_mode: 3 });
    // The terminal's own check says no, and its reason is passed on.
    await refused(buy(), "BROKER_10019", { reject_check: 10019 }, { brokerSays: "Rejected by the test" });
    await refused(buy(), "BROKER_10030", { refuse_all_filling: true });
    await refused(buy(), "SUM", { no_sum: true });
    await refused(buy(), "CHECK", { check_silent: true });
    broker();
    expect(book().orders).toEqual([]);
  }, 60_000);

  it("tries the other ways of filling when the broker will not have the first, and takes USDT for dollars", async () => {
    await market(0.651);
    broker({ refuse_return: true, currency: "USDx" });
    const order = buy();
    expect((await ask("place", order)).json).toMatchObject({ ok: true, status: "resting" });
    const tried = book().sent.filter((item) => item.request.comment === `zoora ${order.id}`);
    expect(tried.map((item) => `${item.call}:${item.request.type_filling}`)).toEqual(["order_check:2", "order_check:1", "order_send:1"]);
    broker();
    expect((await ask("cancel", { id: order.id })).json).toMatchObject({ status: "cancelled" });
  });

  it("takes the broker's no for a no, remembers it, and does not ask again", async () => {
    await market(0.651);
    broker({ reject_send: 10006 });
    const order = buy();
    const answer = await ask("place", order);
    expect([answer.status, answer.json]).toEqual([409, expect.objectContaining({ ok: false, reason: "BROKER_10006", brokerSays: "Rejected by the test" })]);
    broker();
    const sends = orderSends().length;
    expect((await ask("state", { id: order.id })).json).toMatchObject({ ok: true, status: "refused", reason: "BROKER_10006" });
    expect((await ask("place", order)).json).toMatchObject({ status: "refused" });
    expect(orderSends()).toHaveLength(sends);
    expect(book().orders).toEqual([]);
  });

  it("pulls an order the broker holds with another stop than was sent, and says so loudly if it cannot", async () => {
    await market(0.651);
    broker({ drop_stop: true });
    const order = buy();
    const answer = await ask("place", order);
    expect([answer.status, answer.json]).toEqual([409, expect.objectContaining({ ok: false, reason: "READBACK", what: "stop" })]);
    expect(book().orders).toEqual([]);
    expect(printed).toContain(`ORDER ${order.id} READ BACK WRONG (stop). It was pulled.`);
    expect((await ask("state", { id: order.id })).json).toMatchObject({ status: "cancelled" });

    broker({ drop_stop: true, remove_fails: true });
    const stuck = buy();
    const held = await ask("place", stuck);
    expect(held.json).toMatchObject({ ok: false, reason: "READBACK_STUCK", what: "stop", ticket: expect.stringMatching(/^\d+$/) });
    expect(printed).toContain(`IT COULD NOT BE PULLED. Look at ticket ${held.json.ticket} in the terminal.`);
    // It is still at the broker, the bridge still knows where, and it can be pulled once the broker allows.
    expect(book().orders).toHaveLength(1);
    broker();
    expect((await ask("state", { id: stuck.id })).json).toMatchObject({ status: "resting", ticket: held.json.ticket });
    expect((await ask("cancel", { id: stuck.id })).json).toMatchObject({ status: "cancelled" });
    expect(book().orders).toEqual([]);
  });

  it("finds an order the broker took when the terminal gave no answer, and never sends one twice", async () => {
    await market(0.651);
    // The trade server took it and the answer was lost. The bridge finds it at the broker by its note.
    broker({ answer_lost: true });
    const taken = buy();
    expect((await ask("place", taken)).json).toMatchObject({ ok: true, status: "resting", ticket: expect.stringMatching(/^\d+$/) });
    expect(orderSends().filter((item) => item.request.comment === `zoora ${taken.id}`)).toHaveLength(1);
    broker();
    expect((await ask("cancel", { id: taken.id })).json).toMatchObject({ status: "cancelled" });
    // A yes with no ticket in it is treated the same way.
    broker({ no_ticket: true });
    const bare = buy();
    expect((await ask("place", bare)).json).toMatchObject({ ok: true, status: "resting" });
    broker();
    expect((await ask("cancel", { id: bare.id })).json).toMatchObject({ status: "cancelled" });
    // It never reached the trade server. Nobody knows that yet, so it is not sent again: asked again, the bridge says it does not know.
    broker({ lost: true });
    const lost = buy();
    const answer = await ask("place", lost);
    expect([answer.status, answer.json]).toEqual([409, expect.objectContaining({ ok: false, reason: "UNKNOWN" })]);
    broker();
    expect((await ask("state", { id: lost.id })).json).toMatchObject({ ok: true, status: "unknown" });
    expect((await ask("place", lost)).json).toMatchObject({ status: "unknown" });
    expect(orderSends().filter((item) => item.request.comment === `zoora ${lost.id}`)).toHaveLength(1);
    expect(book().orders).toEqual([]);
  });

  it("follows a trade from her order to its stop, its target, or a close by hand, in the broker's own figures", async () => {
    await market(0.651);
    const long = buy();
    await ask("place", long);
    // The ask comes down to her limit. The broker fills her, and the trade carries her stop and her target.
    await market(0.6499);
    expect(await standing(long.id, "open")).toMatchObject({ fill: 65_000 });
    expect(book().positions).toEqual([expect.objectContaining({ type: 0, volume: 0.01, price_open: 0.65, sl: 0.647, tp: 0.656 })]);
    // An open trade is not pulled, and nothing is sent to close it.
    const sends = orderSends().length;
    expect((await ask("cancel", { id: long.id })).json).toMatchObject({ status: "open" });
    expect(orderSends()).toHaveLength(sends);
    // The market falls through her stop. The broker closes it there and takes two cents.
    broker({ commission: -0.02 });
    await market(0.647);
    expect(await standing(long.id, "closed")).toMatchObject({ fill: 65_000, exit: 64_700, exitWhy: "stop", resultCents: -302, costCents: -2 });
    broker();

    // A sale, filled on the bid and taken at her target on the ask.
    await market(0.652);
    const short = sell();
    expect((await ask("place", short)).json).toMatchObject({ ok: true, status: "resting", stop: 65_800 });
    await market(0.6551);
    await standing(short.id, "open");
    await market(0.6499);
    expect(await standing(short.id, "closed")).toMatchObject({ fill: 65_500, exit: 65_000, exitWhy: "target", resultCents: 500, costCents: 0 });

    // A jump straight through her stop: the broker closes at the price there is, and that is the figure.
    await market(0.651);
    const gapped = buy();
    await ask("place", gapped);
    await market(0.6499);
    await standing(gapped.id, "open");
    await market(0.6465);
    expect(await standing(gapped.id, "closed")).toMatchObject({ exit: 64_650, exitWhy: "stop", resultCents: -350 });

    // The owner closes one himself in the terminal. It is neither her stop nor her target, and it is told as that.
    await market(0.651);
    const byHand = buy();
    await ask("place", byHand);
    await market(0.6499);
    await standing(byHand.id, "open");
    await market(0.6512);
    broker({ close_by_hand: true });
    expect(await standing(byHand.id, "closed")).toMatchObject({ exit: 65_120, exitWhy: "other", resultCents: 120 });
    broker();
    expect([book().orders, book().positions]).toEqual([[], []]);
    // In all of it the only things ever sent to the broker were waiting limit orders and their removal.
    expect(new Set(orderSends().map((item) => item.request.action))).toEqual(new Set([5, 8]));
  }, 60_000);

  it("carries her live order from the engine's own code to the broker and back", async () => {
    const db = openDatabase();
    await market(0.651);
    const placed = await placeFxOrder(db, env, { pair: "AUDUSD", side: "buy", limit: "0.65000", target: "0.65600", thesis: "the price has held this level three times this week", influencedByVisitor: false, influencedByWeb: false, influencedByTelegram: false }, Date.now());
    expect(placed).toMatchObject({ ok: true, mode: "live", status: "resting", stop: "0.64700", ticket: expect.stringMatching(/^\d+$/) });
    const id = (placed as { id: string }).id;
    expect(book().orders).toEqual([expect.objectContaining({ price_open: 0.65, sl: 0.647, tp: 0.656, volume_initial: 0.01, comment: `zoora ${id}` })]);
    const none = { filled: 0, stopped: 0, taken: 0, closed: 0, cancelled: 0 };
    expect(await watchFx(db, env, Date.now())).toEqual(none);
    // Her price comes and then her target, between two looks of the engine. The broker did both, with the engine doing nothing.
    await market(0.6499);
    await market(0.6561);
    expect(await watchFx(db, env, Date.now())).toEqual({ ...none, filled: 1, taken: 1 });
    expect(getFxOrder(db, id)).toMatchObject({ mode: "live", status: "closed", fill: "0.65000", exit: "0.65600", exitWhy: "target", resultCents: 600 });
    expect((db.prepare("SELECT note FROM ledger_entries WHERE idempotency_key = ?").get(`fx:${id}:exit`) as { note: string }).note).toBe("LIVE AUDUSD closed at 0.65600, at its target. Result +$6.00, the broker's figure. Not advice.");

    // A limit at the market is refused by the bridge against the live price, and nothing is left behind.
    await market(0.651);
    const through = await placeFxOrder(db, env, { pair: "AUDUSD", side: "buy", limit: "0.65200", target: "0.65800", thesis: "a limit that is not a limit at all", influencedByVisitor: false, influencedByWeb: false, influencedByTelegram: false }, Date.now());
    expect(through).toMatchObject({ ok: false, reason: "FX_LIMIT" });
    expect(book().orders).toEqual([]);
    // The kill switch pulls her waiting order from the broker.
    const waiting = await placeFxOrder(db, env, { pair: "AUDUSD", side: "sell", limit: "0.65500", target: "0.65000", thesis: "sellers have held this level all week", influencedByVisitor: false, influencedByWeb: false, influencedByTelegram: false }, Date.now());
    expect(waiting).toMatchObject({ ok: true, status: "resting", stop: "0.65800" });
    expect(book().orders).toHaveLength(1);
    expect(await watchFx(db, { ...env, LUMEN_KILL_SWITCH: "true" }, Date.now())).toEqual({ ...none, cancelled: 1 });
    expect(book().orders).toEqual([]);
  }, 60_000);

  it("after a restart knows what it sent, and does not send it again", async () => {
    await market(0.651);
    const order = buy();
    expect((await ask("place", order)).json).toMatchObject({ ok: true, status: "resting" });
    const ticket = JSON.parse(readFileSync(served.LUMEN_FX_BRIDGE_JOURNAL, "utf8"))[order.id].ticket as number;
    child?.kill();
    await new Promise((resolve) => child?.once("close", resolve));
    rmSync(served.STANDIN_MT5_BOOK, { force: true });
    await start();
    // The stand-in broker forgets everything when it stops, which a real one does not. The bridge's own record does not:
    // asked to place that order again, it looks for the ticket it wrote down and sends nothing.
    const again = await ask("place", order);
    expect(again.json).toMatchObject({ ok: true, id: order.id, ticket: String(ticket) });
    expect(orderSends()).toEqual([]);
  }, 30_000);
  it("gives her the broker's own price history to research from, and sends the broker nothing", async () => {
    history();
    broker();
    const sentBefore = book().sent.length;
    const bars = (fields: Record<string, unknown>) => ask("bars", fields);
    const first = await until(async () => {
      const answer = await bars({ pair: "AUDUSD", frame: "H1", count: 3 });
      return answer.status === 200 ? answer : null;
    });
    // The three newest hourly bars, oldest first, in points. The bridge was just started and has seen no believable clock, so it claims none.
    expect(first.json).toEqual({
      ok: true, pair: "AUDUSD", digits: 5, frame: "H1", account: "real", aheadMinutes: null, nonce: expect.any(String),
      bars: [
        [monday + 5 * HOUR, 65_050, 65_080, 65_030, 65_060, 105, 8],
        [monday + 6 * HOUR, 65_060, 65_090, 65_040, 65_070, 106, 8],
        [monday + 7 * HOUR, 65_070, 65_100, 65_050, 65_080, 107, 8],
      ],
    });
    // Asked for more than there is, it gives what there is.
    expect(((await bars({ pair: "AUDUSD", frame: "D1", count: 500 })).json.bars as number[][]).map((bar) => bar[0])).toEqual(daily.map((bar) => bar[0]));
    // The engine's own reader, through the same door.
    expect(await fetchFxBars("AUDUSD", "H1", 2, env, Date.now())).toEqual({
      pair: "AUDUSD", frame: "H1", account: "real", aheadMinutes: null,
      bars: [
        { at: monday + 6 * HOUR, open: 65_060, high: 65_090, low: 65_040, close: 65_070, ticks: 106, spread: 8 },
        { at: monday + 7 * HOUR, open: 65_070, high: 65_100, low: 65_050, close: 65_080, ticks: 107, spread: 8 },
      ],
    });
    // What is not on her list is not read: another pair, another length of bar, or a count that is not a count.
    const refused: [Record<string, unknown>, string][] = [
      [{ pair: "EURUSD", frame: "H1", count: 3 }, "PAIR"],
      [{ pair: "AUDUSD", frame: "M1", count: 3 }, "FRAME"],
      [{ pair: "AUDUSD", frame: "TIMEFRAME_H1", count: 3 }, "FRAME"],
      [{ pair: "AUDUSD", frame: "H1" }, "COUNT"],
      [{ pair: "AUDUSD", frame: "H1", count: 0 }, "COUNT"],
      [{ pair: "AUDUSD", frame: "H1", count: 501 }, "COUNT"],
      [{ pair: "AUDUSD", frame: "H1", count: "3" }, "COUNT"],
      [{ pair: "AUDUSD", frame: "H1", count: true }, "COUNT"],
      [{ pair: "AUDUSD", frame: "H1", count: 2.5 }, "COUNT"],
      // The terminal has no four-hour bars in this test.
      [{ pair: "AUDUSD", frame: "H4", count: 3 }, "NO_HISTORY"],
    ];
    for (const [fields, reason] of refused) {
      const answer = await bars(fields);
      expect([answer.status, answer.json.reason, fields]).toEqual([409, reason, fields]);
    }
    // MetaTrader gives rows with named columns. Rows without names are read by position, and rows given newest first are put in order.
    broker({ plain_rows: true, newest_first: true });
    expect(((await bars({ pair: "AUDUSD", frame: "H1", count: 3 })).json.bars as number[][])).toEqual(first.json.bars);
    // A terminal that gives more bars than were asked for: she gets the newest of them, and no more than she asked.
    broker({ too_many: true });
    expect(((await bars({ pair: "AUDUSD", frame: "H1", count: 3 })).json.bars as number[][])).toEqual(first.json.bars);
    // A terminal that gives nothing, or an empty answer: she has no history, and the engine reads that as none.
    for (const control of [{ no_history: true }, { empty_history: true }]) {
      broker(control);
      const answer = await bars({ pair: "AUDUSD", frame: "H1", count: 3 });
      expect([answer.status, answer.json.reason]).toEqual([409, "NO_HISTORY"]);
      expect(await fetchFxBars("AUDUSD", "H1", 3, env, Date.now())).toBeNull();
    }
    broker();
    // A bar whose high is under its close, or two bars with one time: nothing is guessed, the whole answer is refused.
    history({ H1: [...hourly.slice(0, 7), [monday + 7 * HOUR, 0.6507, 0.6506, 0.6505, 0.6508, 107, 8]] });
    expect((await bars({ pair: "AUDUSD", frame: "H1", count: 3 })).json).toMatchObject({ ok: false, reason: "HISTORY" });
    history({ H1: [...hourly.slice(0, 7), hourly[6]] });
    expect((await bars({ pair: "AUDUSD", frame: "H1", count: 3 })).json).toMatchObject({ ok: false, reason: "HISTORY" });
    expect(await fetchFxBars("AUDUSD", "H1", 3, env, Date.now())).toBeNull();
    history();
    // A broker whose AUDUSD has three digits is not the pair her arithmetic knows. Its history is not turned into her points.
    broker({ digits: 3 });
    const odd = await until(async () => {
      const answer = await bars({ pair: "AUDUSD", frame: "H1", count: 3 });
      return answer.json.reason === "SPEC" ? answer : null;
    });
    expect(odd.json).toMatchObject({ ok: false, reason: "SPEC", digits: 3 });
    broker();
    await until(async () => (await bars({ pair: "AUDUSD", frame: "H1", count: 3 })).status === 200);
    // A price whose clock is fifteen hours from this computer's is no time zone on earth. It is seen as a price and not believed as a clock.
    swap(tickFile, JSON.stringify({ bid: 0.6513, ask: 0.65138, msc: Date.now() + 15 * HOUR * 1000 }));
    await seen(65_130);
    expect((await bars({ pair: "AUDUSD", frame: "H1", count: 1 })).json.aheadMinutes).toBeNull();
    // A live price shows how far the broker's clock is from UTC: here three hours ahead. From then on the bridge says so.
    swap(tickFile, JSON.stringify({ bid: 0.6514, ask: 0.65148, msc: Date.now() + 3 * HOUR * 1000 }));
    const clocked = await until(async () => {
      const answer = await bars({ pair: "AUDUSD", frame: "H1", count: 1 });
      return answer.json.aheadMinutes === 180 ? answer : null;
    });
    expect(clocked.json.bars).toEqual([[monday + 7 * HOUR, 65_070, 65_100, 65_050, 65_080, 107, 8]]);
    // A price whose clock is seven minutes off a quarter hour is not a time zone. It is not believed, and the last good reading stands.
    swap(tickFile, JSON.stringify({ bid: 0.6515, ask: 0.65158, msc: Date.now() + 3 * HOUR * 1000 + 22 * 60_000 }));
    await seen(65_150);
    expect((await fetchFxBars("AUDUSD", "D1", 2, env, Date.now()))!.aheadMinutes).toBe(180);
    // Through all of it the broker was sent nothing: not an order, not a check of one.
    expect(book().sent.length).toBe(sentBefore);
  }, 30_000);
});
