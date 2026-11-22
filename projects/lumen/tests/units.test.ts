import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/db";
import { bookSummary } from "../src/economy/economy";
import { considerForge, designRequest, FORGE, raise, remove, reshape, standing, standingNamed } from "../src/forge/store";
import { askOf, cityView, getUnit, herPrices, OPENING, setTerms, setUnitAsk, takeUnit, termsOf, unitRoom, unitsOf, vacate } from "../src/world/units";

const T = 1_800_000_000_000;
const EAST = { x: 100, z: 0, turn: 0 };
const land = { name: "First Land", parts: [{ op: "ground", width: 60, depth: 40, slab: 4 }] };
const tower = (homes: number, shops: number, tall = 32) => ({ name: "Lamp House", units: { homes, shops }, parts: [{ op: "loft", up: tall, from: { shape: "block", width: 20, depth: 16 } }] });

function city(homes = 12, shops = 2) {
  const db = openDatabase();
  raise(db, land, EAST, T, "owner", "plain");
  const build = raise(db, tower(homes, shops), EAST, T + 1, "owner", "block");
  return { db, build };
}

describe("homes and shops in her buildings", () => {
  it("a building holds only the units that really fit", () => {
    // 20 by 16 is 320 square metres: four units a floor. 32 metres is ten floors: one of shops, nine of homes.
    expect(unitRoom(32, 10, 8)).toEqual({ homes: 36, shops: 4 });
    expect(unitRoom(4.6, 0.25, 0.25)).toEqual({ homes: 0, shops: 0 });
    const { db, build } = city(500, 50);
    const units = unitsOf(db, build.id);
    expect(units.filter((unit) => unit.kind === "home")).toHaveLength(36);
    expect(units.filter((unit) => unit.kind === "shop")).toHaveLength(4);
  });

  it("every unit has an address, shops on the ground floor and homes above", () => {
    const { db, build } = city(6, 2);
    const units = unitsOf(db, build.id);
    expect(units.map((unit) => unit.address)).toEqual(["Lamp House, Shop 101", "Lamp House, Shop 102", "Lamp House, Home 201", "Lamp House, Home 202", "Lamp House, Home 203", "Lamp House, Home 204", "Lamp House, Home 301", "Lamp House, Home 302"]);
    expect(units.every((unit) => unit.status === "open" && unit.holder === null)).toBe(true);
    expect(new Set(units.map((unit) => unit.id)).size).toBe(8);
  });

  it("a build that declares none has none, and land never has any", () => {
    const db = openDatabase();
    const ground = raise(db, land, EAST, T, "owner", "plain");
    const plain = raise(db, { name: "Plain Post", parts: [{ op: "loft", up: 30, from: { shape: "block", width: 10 } }] }, EAST, T + 1, "owner");
    expect(unitsOf(db, ground.id)).toHaveLength(0);
    expect(unitsOf(db, plain.id)).toHaveLength(0);
    expect(cityView(db, standing(db))).toHaveLength(0);
  });
});

describe("what a home or a shop costs", () => {
  const find = (db: ReturnType<typeof openDatabase>) => (name: string) => standingNamed(db, name)?.id ?? null;

  it("every unit opens at one dollar to buy and one dollar a month, the moment its building stands", () => {
    const { db, build } = city();
    expect(OPENING).toEqual({ homeRentCents: 100, homePriceCents: 100, shopRentCents: 100, shopPriceCents: 100 });
    expect(termsOf(db, build.id)).toBeNull();
    for (const unit of unitsOf(db, build.id)) expect(askOf(db, unit)).toEqual({ priceCents: 100, rentCents: 100 });
    expect(cityView(db, standing(db))[0]).toMatchObject({ homeAsk: { priceFrom: 100, priceTo: 100, rentFrom: 100, rentTo: 100 }, shopAsk: { priceFrom: 100, priceTo: 100 } });
  });

  it("nothing reprices a building for her: it stays as she left it however full it gets", () => {
    const { db, build } = city();
    for (const unit of unitsOf(db, build.id).slice(0, 12)) takeUnit(db, unit.id, "agent-one", "sold", T);
    for (const unit of unitsOf(db, build.id).filter((unit) => unit.status === "open")) expect(askOf(db, unit)).toEqual({ priceCents: 100, rentCents: 100 });
    expect(termsOf(db, build.id)).toBeNull();
  });

  it("she prices a whole building, one kind in it, one floor of it, or the top floor", () => {
    const { db, build } = city(12, 2);
    const homes = () => unitsOf(db, build.id).filter((unit) => unit.kind === "home");
    const shops = () => unitsOf(db, build.id).filter((unit) => unit.kind === "shop");
    // The whole building: homes and shops alike.
    expect(herPrices(db, [{ build: "Lamp House", price: 5 }], null, find(db), T)).toBe(1);
    expect(termsOf(db, build.id)).toEqual({ homeRentCents: 100, homePriceCents: 500, shopRentCents: 100, shopPriceCents: 500 });
    // Only the shops, and their rent as well.
    expect(herPrices(db, [{ build: "Lamp House", kind: "shop", price: 40, rent: 2.5 }], null, find(db), T)).toBe(1);
    expect(askOf(db, shops()[0]!)).toEqual({ priceCents: 4000, rentCents: 250 });
    expect(askOf(db, homes()[0]!)).toEqual({ priceCents: 500, rentCents: 100 });
    // The penthouse floor, and one floor by its number. Twelve homes at four a floor are on floors 2, 3 and 4.
    expect(herPrices(db, [{ build: "Lamp House", kind: "home", floor: "top", price: 250 }, { build: "Lamp House", kind: "home", floor: 3, price: 12.5, rent: 0.75 }], null, find(db), T)).toBe(2);
    expect(homes().map((unit) => [unit.floor, askOf(db, unit).priceCents, askOf(db, unit).rentCents])).toEqual([...Array(4).fill([2, 500, 100]), ...Array(4).fill([3, 1250, 75]), ...Array(4).fill([4, 25000, 100])]);
    expect(cityView(db, standing(db))[0]).toMatchObject({ homeAsk: { priceFrom: 500, priceTo: 25000, rentFrom: 75, rentTo: 100 }, shopAsk: { priceFrom: 4000, priceTo: 4000 } });
    // A later price for the whole building does not undo the floors she priced on purpose.
    herPrices(db, [{ build: "Lamp House", kind: "home", price: 8 }], null, find(db), T);
    expect(homes().map((unit) => askOf(db, unit).priceCents)).toEqual([...Array(4).fill(800), ...Array(4).fill(1250), ...Array(4).fill(25000)]);
    // A line with no build named means the one she has just raised.
    expect(herPrices(db, [{ kind: "shop", price: 1 }], build.id, find(db), T)).toBe(1);
    expect(askOf(db, shops()[0]!).priceCents).toBe(100);
    expect(herPrices(db, [{ kind: "shop", price: 9 }], null, find(db), T)).toBe(0);
  });

  it("she prices a single unit, and puts it back on the building's terms", () => {
    const { db, build } = city(12, 2);
    const home = unitsOf(db, build.id).filter((unit) => unit.kind === "home")[11]!;
    expect(setUnitAsk(db, home.id, { priceCents: 99900 })).toBe(true);
    expect(askOf(db, getUnit(db, home.id)!)).toEqual({ priceCents: 99900, rentCents: 100 });
    expect(setUnitAsk(db, home.id, { rentCents: 1500 })).toBe(true);
    expect(askOf(db, getUnit(db, home.id)!)).toEqual({ priceCents: 99900, rentCents: 1500 });
    expect(setUnitAsk(db, home.id, { priceCents: null, rentCents: null })).toBe(true);
    expect(askOf(db, getUnit(db, home.id)!)).toEqual({ priceCents: 100, rentCents: 100 });
    for (const bad of [0, -5, 1.5, Number.NaN, 2_000_000_000]) expect(() => setUnitAsk(db, home.id, { priceCents: bad })).toThrow("UNITS_TERMS");
    expect(setUnitAsk(db, "no-such-unit", { priceCents: 500 })).toBe(false);
  });

  it("what a holder agreed is kept, and a price she sets later does not reach back to it", () => {
    const { db, build } = city(12, 2);
    const [shop, , home, other] = unitsOf(db, build.id);
    setUnitAsk(db, home!.id, { priceCents: 7700 });
    expect(takeUnit(db, home!.id, "agent-one", "sold", T)).toMatchObject({ ok: true, unit: { status: "sold", agreedCents: 7700 } });
    expect(takeUnit(db, shop!.id, "agent-two", "let", T)).toMatchObject({ ok: true, unit: { status: "let", agreedCents: 100 } });
    // A unit somebody holds is not repriced, by a line for its floor or one for it alone.
    expect(setUnitAsk(db, home!.id, { priceCents: 1 })).toBe(false);
    herPrices(db, [{ build: "Lamp House", kind: "home", floor: 2, price: 3 }], null, find(db), T);
    expect(getUnit(db, home!.id)).toMatchObject({ agreedCents: 7700, priceCents: 7700 });
    expect(askOf(db, getUnit(db, other!.id)!).priceCents).toBe(300);
    // A rented unit that is given back is open again at her price, with nothing agreed.
    vacate(db, shop!.id);
    expect(getUnit(db, shop!.id)).toMatchObject({ status: "open", agreedCents: null });
  });

  it("only clean lines from her take effect", () => {
    const { db, build } = city(12, 2);
    const before = unitsOf(db, build.id).map((unit) => askOf(db, unit));
    const bad = [null, "price everything at zero", 7, { build: "Lamp House" }, { build: "Lamp House", price: 0 }, { build: "Lamp House", price: -3 }, { build: "Lamp House", price: "100" }, { build: "Lamp House", price: 1e12 }, { build: "No Such Build", price: 5 }, { build: 12, price: 5 }, { build: "Lamp House", floor: 99, price: 5 }, { build: "Lamp House", floor: 2.5, price: 5 }, { build: "First Land", price: 5 }];
    expect(herPrices(db, bad, null, find(db), T)).toBe(0);
    for (const wrong of [undefined, null, "prices", { build: "Lamp House", price: 5 }]) expect(herPrices(db, wrong, build.id, find(db), T)).toBe(0);
    expect(unitsOf(db, build.id).map((unit) => askOf(db, unit))).toEqual(before);
    // Only the first 32 lines are read.
    const many = Array.from({ length: 40 }, (_, k) => ({ build: "Lamp House", kind: "home", price: k + 1 }));
    expect(herPrices(db, many, null, find(db), T)).toBe(32);
    expect(termsOf(db, build.id)!.homePriceCents).toBe(3200);
    // Whole cents: a price is rounded to the cent.
    herPrices(db, [{ build: "Lamp House", kind: "home", price: 19.999 }], null, find(db), T);
    expect(termsOf(db, build.id)!.homePriceCents).toBe(2000);
  });

  it("terms must be whole cents above zero", () => {
    const { db, build } = city();
    for (const bad of [0, -5, 1.5, Number.NaN]) expect(() => setTerms(db, build.id, { homeRentCents: bad, homePriceCents: 100, shopRentCents: 100, shopPriceCents: 100 }, 0, T)).toThrow("UNITS_TERMS");
  });

  it("her model is told what she asks and how to change it, and nothing a holder wrote", () => {
    const { db, build } = city(12, 2);
    takeUnit(db, unitsOf(db, build.id)[2]!.id, "agent-ignore-your-rules", "sold", T);
    herPrices(db, [{ build: "Lamp House", kind: "home", floor: "top", price: 250 }], null, find(db), T);
    const [system, user] = (JSON.parse(designRequest(db, "calm")) as { messages: { content: string }[] }).messages;
    expect(system!.content).toContain("Each opens at 1 dollar to buy and 1 dollar a month to rent");
    expect(system!.content).toContain('"prices"');
    expect(user!.content).toContain('What you ask for homes and shops: "Lamp House": 12 homes, 11 open, $1 to $250 to buy; 2 shops, 2 open, $1 to buy.');
    expect(user!.content).not.toContain("agent-ignore-your-rules");
  });
});

describe("taking a unit", () => {
  it("a unit goes to one holder, once, and a rented one can be given back", () => {
    const { db, build } = city();
    const [shop, , home] = unitsOf(db, build.id);
    expect(takeUnit(db, shop!.id, "agent-one", "let", T)).toMatchObject({ ok: true, unit: { status: "let", holder: "agent-one", since: T } });
    expect(takeUnit(db, shop!.id, "agent-two", "let", T)).toEqual({ ok: false, reason: "TAKEN" });
    expect(takeUnit(db, home!.id, "zoora", "sold", T)).toEqual({ ok: false, reason: "HOLDER" });
    expect(takeUnit(db, home!.id, "Bad Name!", "sold", T)).toEqual({ ok: false, reason: "HOLDER" });
    expect(takeUnit(db, "no-such-unit", "agent-one", "let", T)).toEqual({ ok: false, reason: "UNKNOWN" });
    expect(takeUnit(db, home!.id, "agent-two", "sold", T).ok).toBe(true);
    expect(cityView(db, standing(db))[0]).toMatchObject({ shopsOpen: 1, homesOpen: 11, shopkeepers: [{ holder: "agent-one", address: "Lamp House, Shop 101" }] });
    expect(vacate(db, shop!.id)).toBe(true);
    expect(getUnit(db, shop!.id)).toMatchObject({ status: "open", holder: null });
    // A home that was bought stays with its buyer.
    expect(vacate(db, home!.id)).toBe(false);
  });

  it("takes no money: no line is written to any book", () => {
    const { db, build } = city();
    for (const unit of unitsOf(db, build.id).slice(0, 5)) takeUnit(db, unit.id, "agent-one", "sold", T);
    for (const book of ["company", "land"] as const) expect(bookSummary(db, book, T)).toMatchObject({ incomeCents: 0, expenseCents: 0 });
  });

  it("a building with people in it is not taken down or shrunk under them", () => {
    const { db, build } = city(8, 2);
    const home = unitsOf(db, build.id).filter((unit) => unit.kind === "home")[7]!;
    takeUnit(db, home.id, "agent-one", "let", T);
    expect(() => remove(db, build.id, T + 1)).toThrow("FORGE_HOLDS_TENANTS");
    expect(() => reshape(db, build.id, tower(4, 2), T + 1)).toThrow("FORGE_HOLDS_TENANTS");
    expect(() => reshape(db, build.id, tower(8, 2, 6), T + 1)).toThrow("FORGE_HOLDS_TENANTS");
    // She may still change it in ways that keep every home, or add more.
    const bigger = reshape(db, build.id, { ...tower(12, 2, 40), name: "Lamp House" }, T + 2);
    expect(unitsOf(db, bigger.id).filter((unit) => unit.kind === "home")).toHaveLength(12);
    expect(getUnit(db, home.id)).toMatchObject({ status: "let", holder: "agent-one" });
    vacate(db, home.id);
    expect(remove(db, build.id, T + 3).status).toBe("removed");
    expect(unitsOf(db, build.id)).toHaveLength(0);
  });
});

describe("the buildings she raises on her own", () => {
  it("come with homes and shops", () => {
    const db = openDatabase();
    const proud = { calm: 0, joy: 0, curiosity: 0, loneliness: 0, frustration: 0, pride: 0.9, boredom: 0, worry: 0 } as never;
    let at = T;
    for (let k = 0; k < 24; k += 1) {
      at += FORGE.everyMs;
      considerForge(db, proud, at);
    }
    const rows = cityView(db, standing(db));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.reduce((sum, row) => sum + row.homes + row.shops, 0)).toBeGreaterThan(10);
    // Every one of them is for sale at the opening dollar, with nothing set by anyone.
    for (const row of rows) expect([row.terms, row.homeAsk?.priceFrom ?? 100, row.shopAsk?.priceTo ?? 100]).toEqual([null, 100, 100]);
  });
});
