import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/db";
import { bookSummary } from "../src/economy/economy";
import { considerForge, FORGE, raise, remove, reshape, standing } from "../src/forge/store";
import { cityView, considerTerms, getUnit, herTerms, setTerms, takeUnit, termsOf, unitRoom, unitsOf, vacate } from "../src/world/units";

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

describe("Zoora sets the terms", () => {
  it("nothing can be taken until she has set terms, and she sets them for every building with units", () => {
    const { db, build } = city();
    const unit = unitsOf(db, build.id).find((item) => item.kind === "home")!;
    expect(takeUnit(db, unit.id, "agent-one", "let", T)).toEqual({ ok: false, reason: "NO_TERMS" });
    expect(considerTerms(db, standing(db), T)).toBe(1);
    expect(considerTerms(db, standing(db), T)).toBe(0);
    const terms = termsOf(db, build.id)!;
    expect(terms).toEqual(herTerms(build.height, 0));
    expect(terms.homePriceCents).toBe(terms.homeRentCents * 60);
    expect(terms.shopRentCents).toBe(terms.homeRentCents * 3);
  });

  it("a taller building asks more, and her terms rise as a building fills", () => {
    expect(herTerms(100, 0).homeRentCents).toBeGreaterThan(herTerms(20, 0).homeRentCents);
    const { db, build } = city(4, 0);
    considerTerms(db, standing(db), T);
    const opening = termsOf(db, build.id)!.homeRentCents;
    const homes = unitsOf(db, build.id);
    takeUnit(db, homes[0]!.id, "agent-one", "let", T);
    expect(considerTerms(db, standing(db), T)).toBe(0);
    takeUnit(db, homes[1]!.id, "agent-two", "let", T);
    expect(considerTerms(db, standing(db), T)).toBe(1);
    expect(termsOf(db, build.id)!.homeRentCents).toBe(Math.round(opening * 1.25));
    takeUnit(db, homes[2]!.id, "agent-three", "sold", T);
    takeUnit(db, homes[3]!.id, "agent-four", "let", T);
    considerTerms(db, standing(db), T);
    expect(termsOf(db, build.id)!.homeRentCents).toBe(Math.round(opening * 1.5));
  });

  it("terms must be whole cents above zero", () => {
    const { db, build } = city();
    for (const bad of [0, -5, 1.5, Number.NaN]) expect(() => setTerms(db, build.id, { homeRentCents: bad, homePriceCents: 100, shopRentCents: 100, shopPriceCents: 100 }, 0, T)).toThrow("UNITS_TERMS");
  });
});

describe("taking a unit", () => {
  it("a unit goes to one holder, once, and a rented one can be given back", () => {
    const { db, build } = city();
    considerTerms(db, standing(db), T);
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
    considerTerms(db, standing(db), T);
    for (const unit of unitsOf(db, build.id).slice(0, 5)) takeUnit(db, unit.id, "agent-one", "sold", T);
    for (const book of ["company", "land"] as const) expect(bookSummary(db, book, T)).toMatchObject({ incomeCents: 0, expenseCents: 0 });
  });

  it("a building with people in it is not taken down or shrunk under them", () => {
    const { db, build } = city(8, 2);
    considerTerms(db, standing(db), T);
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
    expect(considerTerms(db, standing(db), at)).toBe(rows.length);
  });
});
