import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/db";
import { raise, standingNamed } from "../src/forge/store";
import { randomReference, verifySolPayment, type SolTx } from "../src/money/solana";
import { orderIsFor, quoteUnit } from "../src/world/unitPay";
import { getUnit, herPrices, openUnits, takeUnit, unitsOf } from "../src/world/units";

const T = 1_800_000_000_000;
const EAST = { x: 100, z: 0, turn: 0 };
const land = { name: "First Land", parts: [{ op: "ground", width: 60, depth: 40, slab: 4 }] };
const tower = { name: "Lamp House", units: { homes: 12, shops: 2 }, parts: [{ op: "loft", up: 32, from: { shape: "block", width: 20, depth: 16 } }] };
// A SOL price of $150 makes one dollar 6,666,667 lamports.
const price = async () => Response.json({ solana: { usd: 150 } });
const sig = (letter: string) => letter.repeat(87);

function city() {
  const db = openDatabase();
  raise(db, land, EAST, T, "owner", "plain");
  const build = raise(db, tower, EAST, T + 1, "owner", "block");
  const owner = randomReference();
  const env = { LUMEN_SOL_RECEIVE_ADDRESS: owner, LUMEN_SOL_PRICE_URL: "https://prices.example/sol" };
  const homes = unitsOf(db, build.id).filter((unit) => unit.kind === "home");
  return { db, build, env, owner, homes };
}

/** A finalized payment as the chain reports it: the buyer's wallet first, then the owner's, then the order's reference. */
const paid = (buyer: string, owner: string, reference: string, lamports: number, err: unknown = null): SolTx => ({
  meta: { err, preBalances: [5_000_000_000, 1000, 0], postBalances: [5_000_000_000 - lamports - 5000, 1000 + lamports, 0] },
  transaction: { message: { accountKeys: [buyer, owner, reference] } },
});
const sales = (db: ReturnType<typeof openDatabase>) => db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS cents FROM ledger_entries WHERE kind = 'sale' AND status = 'confirmed'").get() as { n: number; cents: number };
const flags = (db: ReturnType<typeof openDatabase>) => (db.prepare("SELECT reason FROM sol_refund_flags ORDER BY id").all() as { reason: string }[]).map((row) => row.reason);

describe("an agent buys a home", () => {
  it("is quoted her price in SOL, to the owner's wallet, with a reference of its own", async () => {
    const { db, env, owner, homes } = city();
    expect(openUnits(db)).toHaveLength(14);
    expect(openUnits(db)[2]).toEqual({ id: homes[0]!.id, address: "Lamp House, Home 201", kind: "home", floor: 2, priceCents: 100, rentCents: 100 });
    const quote = await quoteUnit(db, env, homes[0]!.id, T, price);
    expect(quote).toMatchObject({ ok: true, unit: homes[0]!.id, address: "Lamp House, Home 201", priceCents: 100, payTo: owner, lamports: "6666667", expiresAt: T + 600_000 });
    if (!quote.ok) return;
    expect(quote.reference).not.toBe(owner);
    expect(quote.url).toContain(`solana:${owner}`);
    expect(quote.url).toContain(quote.reference);
    expect(orderIsFor(db, quote.order, homes[0]!.id)).toBe(true);
    expect(orderIsFor(db, quote.order, homes[1]!.id)).toBe(false);
    // Asking is not buying: the unit is still open and nothing is in the books.
    expect(getUnit(db, homes[0]!.id)!.status).toBe("open");
    expect(sales(db).n).toBe(0);
  });

  it("only one buyer is asked to pay for a unit at a time", async () => {
    const { db, env, homes } = city();
    expect((await quoteUnit(db, env, homes[0]!.id, T, price)).ok).toBe(true);
    expect(await quoteUnit(db, env, homes[0]!.id, T + 1000, price)).toEqual({ ok: false, reason: "HELD" });
    // Another unit can be quoted meanwhile, and this one again once the first quote has run out.
    expect((await quoteUnit(db, env, homes[1]!.id, T + 1000, price)).ok).toBe(true);
    expect((await quoteUnit(db, env, homes[0]!.id, T + 600_001, price)).ok).toBe(true);
    expect(await quoteUnit(db, env, "forge-0000000000-h2-1", T, price)).toEqual({ ok: false, reason: "UNKNOWN" });
    takeUnit(db, homes[2]!.id, "agent-one", "sold", T);
    expect(await quoteUnit(db, env, homes[2]!.id, T, price)).toEqual({ ok: false, reason: "TAKEN" });
    // With no wallet set, or no price to be had, nobody is quoted.
    expect(await quoteUnit(db, { ...env, LUMEN_SOL_RECEIVE_ADDRESS: "" }, homes[3]!.id, T, price)).toEqual({ ok: false, reason: "NO_ADDRESS" });
    expect(await quoteUnit(db, env, homes[3]!.id, T, async () => new Response("down", { status: 503 }))).toEqual({ ok: false, reason: "NO_PRICE" });
  });

  it("a finalized payment hands the unit to the wallet that paid, at the quoted price, and writes one sale", async () => {
    const { db, env, owner, homes } = city();
    const buyer = randomReference();
    const quote = await quoteUnit(db, env, homes[0]!.id, T, price);
    if (!quote.ok) throw new Error(quote.reason);
    expect(verifySolPayment(db, quote.order, sig("B"), paid(buyer, owner, quote.reference, 6_666_667), T + 30_000, { txTime: T + 20_000 }, env)).toEqual({ ok: true, token: null });
    expect(getUnit(db, homes[0]!.id)).toMatchObject({ status: "sold", holder: buyer, since: T + 30_000, agreedCents: 100, via: quote.order });
    expect(sales(db)).toEqual({ n: 1, cents: 100 });
    expect(flags(db)).toEqual([]);
    expect(openUnits(db)).toHaveLength(13);
    // The same payment cannot buy a second unit, and the unit cannot be quoted again.
    const second = await quoteUnit(db, env, homes[1]!.id, T + 40_000, price);
    if (!second.ok) throw new Error(second.reason);
    expect(verifySolPayment(db, second.order, sig("B"), paid(buyer, owner, quote.reference, 6_666_667), T + 50_000, { txTime: T + 45_000 }, env)).toEqual({ ok: false, reason: "REUSED" });
    expect(getUnit(db, homes[1]!.id)!.status).toBe("open");
    expect(await quoteUnit(db, env, homes[0]!.id, T + 700_000, price)).toEqual({ ok: false, reason: "TAKEN" });
  });

  it("pays the price she set, as it stood when the quote was made", async () => {
    const { db, env, owner, homes } = city();
    const find = (name: string) => standingNamed(db, name)?.id ?? null;
    herPrices(db, [{ build: "Lamp House", kind: "home", floor: "top", price: 250 }], null, find, T);
    const penthouse = homes[11]!;
    const quote = await quoteUnit(db, env, penthouse.id, T, price);
    expect(quote).toMatchObject({ ok: true, priceCents: 25000, lamports: "1666666667" });
    if (!quote.ok) return;
    // She raises it while the buyer is paying. The buyer pays what was quoted.
    herPrices(db, [{ build: "Lamp House", kind: "home", floor: "top", price: 900 }], null, find, T + 1000);
    const buyer = randomReference();
    expect(verifySolPayment(db, quote.order, sig("C"), paid(buyer, owner, quote.reference, 1_666_666_667), T + 60_000, { txTime: T + 50_000 }, env).ok).toBe(true);
    expect(getUnit(db, penthouse.id)).toMatchObject({ status: "sold", holder: buyer, agreedCents: 25000 });
    expect(sales(db)).toEqual({ n: 1, cents: 25000 });
  });

  it("a payment that does not check out changes nothing", async () => {
    const { db, env, owner, homes } = city();
    const buyer = randomReference();
    const quote = await quoteUnit(db, env, homes[0]!.id, T, price);
    if (!quote.ok) throw new Error(quote.reason);
    const at = { txTime: T + 20_000 };
    expect(verifySolPayment(db, quote.order, sig("D"), null, T + 30_000, undefined, env)).toEqual({ ok: false, reason: "UNFINALIZED" });
    expect(verifySolPayment(db, quote.order, sig("D"), paid(buyer, owner, quote.reference, 6_666_667, { InstructionError: [0, "Custom"] }), T + 30_000, at, env)).toEqual({ ok: false, reason: "FAILED" });
    expect(verifySolPayment(db, quote.order, sig("D"), paid(buyer, owner, quote.reference, 6_000_000), T + 30_000, at, env)).toEqual({ ok: false, reason: "UNDERPAID" });
    expect(verifySolPayment(db, quote.order, sig("D"), paid(buyer, randomReference(), quote.reference, 6_666_667), T + 30_000, at, env)).toEqual({ ok: false, reason: "RECIPIENT" });
    expect(verifySolPayment(db, quote.order, sig("D"), paid(buyer, owner, randomReference(), 6_666_667), T + 30_000, at, env)).toEqual({ ok: false, reason: "REFERENCE" });
    expect(verifySolPayment(db, quote.order, "not a signature", paid(buyer, owner, quote.reference, 6_666_667), T + 30_000, at, env)).toEqual({ ok: false, reason: "SIGNATURE" });
    expect(verifySolPayment(db, "sol-00000000", sig("D"), paid(buyer, owner, quote.reference, 6_666_667), T + 30_000, at, env)).toEqual({ ok: false, reason: "MISSING" });
    expect(getUnit(db, homes[0]!.id)).toMatchObject({ status: "open", holder: null, agreedCents: null, via: null });
    expect(sales(db).n).toBe(0);
    expect(flags(db)).toEqual([]);
    // The kill switch stops a quote and a check alike.
    expect(await quoteUnit(db, { ...env, LUMEN_KILL_SWITCH: "true" }, homes[1]!.id, T, price)).toEqual({ ok: false, reason: "KILL_SWITCH" });
    expect(verifySolPayment(db, quote.order, sig("D"), paid(buyer, owner, quote.reference, 6_666_667), T + 30_000, at, { ...env, LUMEN_KILL_SWITCH: "true" })).toEqual({ ok: false, reason: "KILL_SWITCH" });
  });

  it("a real payment for a unit that can no longer be handed over is flagged to go back, and nothing is sold", async () => {
    const { db, env, owner, homes } = city();
    const buyer = randomReference();
    const quote = await quoteUnit(db, env, homes[0]!.id, T, price);
    if (!quote.ok) throw new Error(quote.reason);
    // The owner records the unit as someone else's by hand while the buyer is paying.
    takeUnit(db, homes[0]!.id, "agent-one", "sold", T + 5000);
    expect(verifySolPayment(db, quote.order, sig("E"), paid(buyer, owner, quote.reference, 6_666_667), T + 30_000, { txTime: T + 20_000 }, env)).toEqual({ ok: false, reason: "REFUND" });
    expect(getUnit(db, homes[0]!.id)).toMatchObject({ status: "sold", holder: "agent-one", via: null });
    expect(flags(db)).toEqual(["UNIT"]);
    expect(sales(db).n).toBe(0);
    expect(db.prepare("SELECT status FROM sol_orders WHERE id = ?").get(quote.order)).toEqual({ status: "refund_due" });
    // A payment that lands after the quote ran out is flagged the same way, and the unit stays open.
    const late = await quoteUnit(db, env, homes[1]!.id, T, price);
    if (!late.ok) throw new Error(late.reason);
    expect(verifySolPayment(db, late.order, sig("F"), paid(buyer, owner, late.reference, 6_666_667), T + 900_000, { txTime: T + 800_000 }, env)).toEqual({ ok: false, reason: "REFUND" });
    expect(getUnit(db, homes[1]!.id)!.status).toBe("open");
    expect(flags(db)).toEqual(["UNIT", "LATE"]);
  });

  it("a check that stopped halfway is finished by the next one, without a second sale or a refund", async () => {
    const { db, env, owner, homes } = city();
    const buyer = randomReference();
    const quote = await quoteUnit(db, env, homes[0]!.id, T, price);
    if (!quote.ok) throw new Error(quote.reason);
    // The unit was handed over on this order, and then the engine stopped before the order was marked paid.
    takeUnit(db, homes[0]!.id, buyer, "sold", T + 30_000, { agreedCents: 100, via: quote.order });
    expect(verifySolPayment(db, quote.order, sig("G"), paid(buyer, owner, quote.reference, 6_666_667), T + 31_000, { txTime: T + 20_000 }, env)).toEqual({ ok: true, token: null });
    expect(getUnit(db, homes[0]!.id)).toMatchObject({ status: "sold", holder: buyer, since: T + 30_000 });
    expect(sales(db)).toEqual({ n: 1, cents: 100 });
    expect(flags(db)).toEqual([]);
    // A second real payment on the same order is flagged to go back.
    expect(verifySolPayment(db, quote.order, sig("H"), paid(buyer, owner, quote.reference, 6_666_667), T + 40_000, { txTime: T + 35_000 }, env)).toEqual({ ok: false, reason: "SECOND" });
    expect(flags(db)).toEqual(["SECOND"]);
    expect(sales(db).n).toBe(1);
  });

  it("a holder is a short name the owner wrote or the wallet that paid, and never her", () => {
    const { db, homes } = city();
    expect(takeUnit(db, homes[0]!.id, randomReference(), "sold", T).ok).toBe(true);
    for (const bad of ["zoora", "Bad Name!", "0OIl".repeat(10), "a".repeat(60), ""]) expect(takeUnit(db, homes[1]!.id, bad, "sold", T)).toEqual({ ok: false, reason: "HOLDER" });
  });
});
