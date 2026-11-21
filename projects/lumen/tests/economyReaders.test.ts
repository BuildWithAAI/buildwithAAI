import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/db";
import { addVenue, bookSummary } from "../src/economy/economy";
import { bybitKeyIsReadOnly, bybitSign, parseWatch, readBybit, readSolWallet, runReaders } from "../src/economy/readers";

const T = 1_800_000_000_000;
const WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const env = { BYBIT_READ_KEY: "key", BYBIT_READ_SECRET: "secret" };

function bybit(info: unknown, equity = "1234.567") {
  const calls: { url: string; sign: string }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, sign: new Headers(init?.headers).get("X-BAPI-SIGN") ?? "" });
    if (url.includes("/v5/user/query-api")) return Response.json({ retCode: 0, result: info });
    return Response.json({ retCode: 0, result: { list: [{ totalEquity: equity }] } });
  }) as typeof fetch;
  return { impl, calls };
}

describe("economy readers", () => {
  it("signs a Bybit request the documented way and reads equity as whole cents", async () => {
    const net = bybit({ readOnly: 1, permissions: { Wallet: [] } });
    expect(await readBybit(env, T, net.impl)).toBe(123_457);
    expect(net.calls[1]!.url).toBe("https://api.bybit.com/v5/account/wallet-balance?accountType=UNIFIED");
    expect(net.calls[1]!.sign).toBe(bybitSign("secret", String(T), "key", "accountType=UNIFIED"));
    expect(net.calls.every((call) => !/order|withdraw|transfer/i.test(call.url))).toBe(true);
  });

  it("refuses a key that can do more than read, before asking for a balance", async () => {
    expect(bybitKeyIsReadOnly({ readOnly: 0, permissions: {} })).toBe(false);
    expect(bybitKeyIsReadOnly({ readOnly: 1, permissions: { Wallet: ["Withdraw"] } })).toBe(false);
    expect(bybitKeyIsReadOnly({ readOnly: 1, permissions: { Wallet: ["AccountTransfer"] } })).toBe(false);
    const net = bybit({ readOnly: 0, permissions: { Spot: ["SpotTrade"] } });
    await expect(readBybit(env, T, net.impl)).rejects.toThrow("BYBIT_KEY_NOT_READ_ONLY");
    expect(net.calls).toHaveLength(1);
    await expect(readBybit({}, T, net.impl)).rejects.toThrow("BYBIT_NOT_SET");
  });

  it("values a watched Solana wallet from its public address: SOL at the price, USDC at a dollar", async () => {
    const impl = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
      expect(body.params[0]).toBe(WALLET);
      if (body.method === "getBalance") return Response.json({ result: { value: 2_500_000_000 } });
      return Response.json({ result: { value: [{ account: { data: { parsed: { info: { tokenAmount: { uiAmount: 40.5 } } } } } }] } });
    }) as typeof fetch;
    expect(await readSolWallet("https://rpc.example", WALLET, 100, impl)).toBe(29_050);
    await expect(readSolWallet("https://rpc.example", "not-an-address", 100, impl)).rejects.toThrow("SOL_ADDRESS");
  });

  it("drops a malformed watch entry and keeps the chain of each good one", () => {
    const eth = "0x52908400098527886E0F7030069857D2E4169EE7";
    const btc = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
    expect(parseWatch(`reserve=sol:${WALLET}, reserve=eth:${eth},reserve=btc:${btc},land=doge:${WALLET}, bad id=sol:${WALLET},reserve=${WALLET},x=eth:${WALLET}`)).toEqual([
      { venueId: "reserve", chain: "sol", address: WALLET },
      { venueId: "reserve", chain: "eth", address: eth },
      { venueId: "reserve", chain: "btc", address: btc },
    ]);
  });

  it("sums every watched address of a venue, and records nothing for the venue if one cannot be read", async () => {
    const eth = "0x52908400098527886E0F7030069857D2E4169EE7";
    const btc = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
    const prices: Record<string, string> = { SOLUSDT: "100", ETHUSDT: "2000", BTCUSDT: "50000", AVAXUSDT: "20" };
    const asked: string[] = [];
    const net = (btcOk: boolean) =>
      (async (url: string, init?: RequestInit) => {
        asked.push(url);
        if (url.includes("/v5/market/tickers")) return Response.json({ retCode: 0, result: { list: [{ lastPrice: prices[new URL(url).searchParams.get("symbol") ?? ""] }] } });
        if (url.startsWith("https://btc.example")) return btcOk ? Response.json({ chain_stats: { funded_txo_sum: 30_000_000, spent_txo_sum: 10_000_000 } }) : new Response("no", { status: 500 });
        const body = JSON.parse(String(init?.body)) as { method: string };
        if (body.method === "eth_getBalance") return Response.json({ result: "0x" + (1_500_000_000_000_000_000n).toString(16) });
        if (body.method === "getBalance") return Response.json({ result: { value: 1_000_000_000 } });
        return Response.json({ result: { value: [] } });
      }) as typeof fetch;
    const settings = { ECON_WATCH: `reserve=sol:${WALLET},reserve=eth:${eth},reserve=btc:${btc}`, LUMEN_SOL_RPC_URL: "https://sol.example", ECON_RPC_ETH: "https://eth.example", ECON_BTC_API: "https://btc.example/api" };
    const db = openDatabase();
    addVenue(db, { id: "reserve", bookId: "company", name: "Cold reserve", kind: "wallet" }, T);
    expect(await runReaders(db, settings, T, net(false))).toEqual([{ venueId: "reserve", ok: false, reason: "BTC_HTTP" }]);
    expect(bookSummary(db, "company", T).treasuryCents).toBe(0);
    expect(await runReaders(db, settings, T, net(true))).toEqual([{ venueId: "reserve", ok: true, reason: "OK" }]);
    // 1 SOL at 100, 1.5 ETH at 2,000, 0.2 BTC at 50,000.
    expect(bookSummary(db, "company", T).treasuryCents).toBe(10_000 + 300_000 + 1_000_000);
    expect(asked.some((url) => url === "https://btc.example/api/address/" + btc)).toBe(true);
    expect(await runReaders(db, { ...settings, ECON_RPC_ETH: "http://eth.example" }, T, net(true))).toEqual([{ venueId: "reserve", ok: false, reason: "EVM_RPC_NOT_SET" }]);
  });

  it("records what it could read as reader readings and leaves a failed venue alone", async () => {
    const db = openDatabase();
    addVenue(db, { id: "bybit", bookId: "company", name: "Trading float", kind: "exchange" }, T);
    addVenue(db, { id: "land", bookId: "land", name: "Land wallet", kind: "wallet" }, T);
    const net = bybit({ readOnly: 1, permissions: {} }, "500");
    const results = await runReaders(db, { ...env, ECON_BYBIT_VENUE: "bybit", ECON_WATCH: `land=sol:${WALLET}` }, T, net.impl);
    expect(results).toEqual([
      { venueId: "bybit", ok: true, reason: "OK" },
      { venueId: "land", ok: false, reason: "SOL_RPC_NOT_SET" },
    ]);
    expect(bookSummary(db, "company", T).treasuryCents).toBe(50_000);
    expect(bookSummary(db, "land", T).treasuryCents).toBe(0);
    expect(db.prepare("SELECT source FROM econ_readings").all()).toEqual([{ source: "reader" }]);
  });
});
