import type { DatabaseSync } from "node:sqlite";

/**
 * Homes and shops inside what she builds.
 *
 * A home or a shop is a room she marked inside one of her buildings: real walls, a real door, and a
 * way to walk to it. Each has an address, and an agent can rent it or buy it.
 *
 * A building with no rooms marked in it may still declare a number of homes and shops, as her older
 * buildings do: homes on its upper floors and shops on its ground floor, as many as its size has room
 * for. Those have an address and a price, and no room of their own yet.
 *
 * Every home and shop opens at one dollar to buy and one dollar a month to rent. That figure is the
 * owner's, 2026-11-21. Every figure after it is Zoora's. She can price a whole building, one floor of
 * it or a single unit, as she likes, and nothing here reprices anything for her. Nobody else sets a
 * price: not the owner, not the agent, not anything a visitor types.
 *
 * What this file does not do is take money. There is no payment here. A unit is marked as let or sold
 * only through `takeUnit`, and no income is written to any book from it, because a book line needs a
 * payment that was really received. When payments are built they must end by calling `takeUnit`.
 *
 * A building cannot be taken down, or changed so that it has fewer units, while anyone holds a unit in it.
 */

export type UnitKind = "home" | "shop";
export type Unit = {
  id: string; buildId: string; kind: UnitKind; floor: number; number: number; address: string; status: "open" | "let" | "sold"; holder: string | null; since: number | null;
  /** Her own price and rent for this one unit, in cents, where she has set one. Otherwise the building's terms apply. */
  priceCents: number | null; rentCents: number | null;
  /** What its holder agreed to when they took it: the price if it was sold, the rent a month if it was let. */
  agreedCents: number | null;
  /** The paid order it was handed over for, if it was bought and paid for. */
  via: string | null;
};
export type Terms = { homeRentCents: number; homePriceCents: number; shopRentCents: number; shopPriceCents: number };
/** What a unit is asked for: to buy, and a month to rent. */
export type Ask = { priceCents: number; rentCents: number };

/** Where every building starts: one dollar to buy, one dollar a month. The owner's figure. She changes it as she likes. */
export const OPENING: Terms = { homeRentCents: 100, homePriceCents: 100, shopRentCents: 100, shopPriceCents: 100 };
/** The most a unit can be asked for, in cents. */
const MOST = 1_000_000_000;

/** Height of one floor, and the floor space one unit needs, in metres. */
export const FLOOR = 3.2;
export const UNIT_AREA = 80;
const HOLDER = /^[a-z0-9][a-z0-9-]{1,39}$/;
/** A holder who paid is known by the wallet that paid: a Solana address. */
const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function ensureUnits(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_units (
      id TEXT PRIMARY KEY, build_id TEXT NOT NULL, kind TEXT NOT NULL, floor INTEGER NOT NULL, number INTEGER NOT NULL,
      address TEXT NOT NULL, status TEXT NOT NULL, holder TEXT, since INTEGER
    );
    CREATE INDEX IF NOT EXISTS world_units_build ON world_units(build_id);
    CREATE TABLE IF NOT EXISTS world_unit_terms (build_id TEXT PRIMARY KEY, body TEXT NOT NULL, set_at INTEGER NOT NULL, let_share REAL NOT NULL);
  `);
  // A world made before a unit could have a price of its own gets the columns.
  const have = new Set((db.prepare("PRAGMA table_info(world_units)").all() as { name: string }[]).map((column) => column.name));
  for (const column of ["price_cents", "rent_cents", "agreed_cents"]) if (!have.has(column)) db.exec(`ALTER TABLE world_units ADD COLUMN ${column} INTEGER`);
  if (!have.has("via")) db.exec("ALTER TABLE world_units ADD COLUMN via TEXT");
}

/** How many units a building really has room for. She cannot declare forty homes in a lamp post. */
export function unitRoom(height: number, hw: number, hd: number): { homes: number; shops: number } {
  const perFloor = Math.max(0, Math.floor((hw * 2 * hd * 2) / UNIT_AREA));
  const floors = Math.floor(height / FLOOR);
  return { homes: perFloor * Math.max(0, floors - 1), shops: floors >= 1 ? perFloor : 0 };
}

type Row = { id: string; build_id: string; kind: UnitKind; floor: number; number: number; address: string; status: Unit["status"]; holder: string | null; since: number | null; price_cents: number | null; rent_cents: number | null; agreed_cents: number | null; via: string | null };
const whole = (value: number | null) => (value == null ? null : Number(value));
const shape = (row: Row): Unit => ({ id: row.id, buildId: row.build_id, kind: row.kind, floor: Number(row.floor), number: Number(row.number), address: row.address, status: row.status, holder: row.holder, since: whole(row.since), priceCents: whole(row.price_cents), rentCents: whole(row.rent_cents), agreedCents: whole(row.agreed_cents), via: row.via ?? null });

export function unitsOf(db: DatabaseSync, buildId: string): Unit[] {
  ensureUnits(db);
  return (db.prepare("SELECT * FROM world_units WHERE build_id = ? ORDER BY kind DESC, floor, number").all(buildId) as Row[]).map(shape);
}

export function getUnit(db: DatabaseSync, id: string): Unit | null {
  ensureUnits(db);
  const row = db.prepare("SELECT * FROM world_units WHERE id = ?").get(id) as Row | undefined;
  return row ? shape(row) : null;
}

export function heldIn(db: DatabaseSync, buildId: string): number {
  ensureUnits(db);
  return Number((db.prepare("SELECT COUNT(*) AS n FROM world_units WHERE build_id = ? AND status != 'open'").get(buildId) as { n: number }).n);
}

type Building = { id: string; name: string; height: number; hw: number; hd: number };
/** One home or shop a building has: which it is, its floor counted from 1, and its number on that floor. */
export type UnitSlot = { kind: UnitKind; floor: number; number: number };

/** What a building would have by count alone, given what she asked for and what fits. */
export function unitPlan(building: Building, want: { homes?: number; shops?: number } | undefined): { homes: number; shops: number } {
  const room = unitRoom(building.height, building.hw, building.hd);
  return { homes: Math.min(room.homes, Math.max(0, Math.round(want?.homes ?? 0))), shops: Math.min(room.shops, Math.max(0, Math.round(want?.shops ?? 0))) };
}

/** The id a home or a shop has in a building. */
export const unitId = (buildId: string, slot: UnitSlot) => `${buildId}-${slot.kind === "home" ? "h" : "s"}${slot.floor}-${slot.number}`;

/**
 * The homes and shops a building has. Where she marked rooms, they are those rooms and nothing else.
 * Where she marked none, they are as many as she declared and as fit: shops on the ground floor, homes
 * above.
 */
export function unitSlots(building: Building, want: { homes?: number; shops?: number } | undefined, rooms: UnitSlot[] = []): UnitSlot[] {
  if (rooms.length) return rooms.map((room) => ({ kind: room.kind, floor: room.floor, number: room.number }));
  const plan = unitPlan(building, want);
  const perFloor = Math.max(1, Math.floor((building.hw * 2 * building.hd * 2) / UNIT_AREA));
  return [...Array.from({ length: plan.shops }, (_, k) => ({ kind: "shop" as const, floor: 1, number: k + 1 })), ...Array.from({ length: plan.homes }, (_, k) => ({ kind: "home" as const, floor: 2 + Math.floor(k / perFloor), number: (k % perFloor) + 1 }))];
}

/** Makes a building's units match what it has. Refused if that would remove a unit someone holds. */
export function syncUnits(db: DatabaseSync, building: Building, want: { homes?: number; shops?: number } | undefined, rooms: UnitSlot[] = []): void {
  ensureUnits(db);
  const slots = unitSlots(building, want, rooms);
  const wanted = new Set(slots.map((slot) => unitId(building.id, slot)));
  const current = unitsOf(db, building.id);
  if (current.some((unit) => unit.status !== "open" && !wanted.has(unit.id))) throw new Error("FORGE_HOLDS_TENANTS");
  for (const unit of current) if (!wanted.has(unit.id)) db.prepare("DELETE FROM world_units WHERE id = ?").run(unit.id);
  const have = new Set(current.map((unit) => unit.id));
  for (const slot of slots) {
    const id = unitId(building.id, slot);
    const address = `${building.name}, ${slot.kind === "home" ? "Home" : "Shop"} ${slot.floor}${String(slot.number).padStart(2, "0")}`;
    if (have.has(id)) db.prepare("UPDATE world_units SET address = ? WHERE id = ?").run(address, id);
    else db.prepare("INSERT INTO world_units(id, build_id, kind, floor, number, address, status) VALUES(?, ?, ?, ?, ?, ?, 'open')").run(id, building.id, slot.kind, slot.floor, slot.number, address);
  }
}

export function dropUnits(db: DatabaseSync, buildId: string): void {
  ensureUnits(db);
  if (heldIn(db, buildId) > 0) throw new Error("FORGE_HOLDS_TENANTS");
  db.prepare("DELETE FROM world_units WHERE build_id = ?").run(buildId);
  db.prepare("DELETE FROM world_unit_terms WHERE build_id = ?").run(buildId);
}

/** Her terms for a whole building, once she has set any. Until then every unit in it is at the opening dollar. */
export function termsOf(db: DatabaseSync, buildId: string): Terms | null {
  ensureUnits(db);
  const row = db.prepare("SELECT body FROM world_unit_terms WHERE build_id = ?").get(buildId) as { body: string } | undefined;
  return row ? (JSON.parse(row.body) as Terms) : null;
}

const cents = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= MOST;

/** She sets a building's terms. Whole cents, above zero, and nothing else is accepted. */
export function setTerms(db: DatabaseSync, buildId: string, terms: Terms, letShare: number, now: number): void {
  ensureUnits(db);
  for (const value of [terms.homeRentCents, terms.homePriceCents, terms.shopRentCents, terms.shopPriceCents]) if (!cents(value)) throw new Error("UNITS_TERMS");
  db.prepare("INSERT INTO world_unit_terms(build_id, body, set_at, let_share) VALUES(?, ?, ?, ?) ON CONFLICT(build_id) DO UPDATE SET body = excluded.body, set_at = excluded.set_at, let_share = excluded.let_share").run(buildId, JSON.stringify(terms), now, letShare);
}

/** What a unit is asked for now: her own figure for it where she set one, her terms for its building where she set those, and the opening dollar otherwise. */
export function askOf(db: DatabaseSync, unit: Unit): Ask {
  const terms = termsOf(db, unit.buildId) ?? OPENING;
  return { priceCents: unit.priceCents ?? (unit.kind === "home" ? terms.homePriceCents : terms.shopPriceCents), rentCents: unit.rentCents ?? (unit.kind === "home" ? terms.homeRentCents : terms.shopRentCents) };
}

/** She prices one unit on its own. A figure left out is not changed, and null puts it back on the building's terms. A unit somebody holds keeps what was agreed. */
export function setUnitAsk(db: DatabaseSync, unitId: string, ask: { priceCents?: number | null; rentCents?: number | null }): boolean {
  const unit = getUnit(db, unitId);
  if (!unit || unit.status !== "open") return false;
  for (const value of [ask.priceCents, ask.rentCents]) if (value != null && !cents(value)) throw new Error("UNITS_TERMS");
  db.prepare("UPDATE world_units SET price_cents = ?, rent_cents = ? WHERE id = ? AND status = 'open'").run(ask.priceCents === undefined ? unit.priceCents : ask.priceCents, ask.rentCents === undefined ? unit.rentCents : ask.rentCents, unitId);
  return true;
}

/**
 * Her prices, as her own model wrote them beside a design. Each line names a kind of unit, a floor, or
 * both, in one of her buildings, and a price or a rent in dollars:
 *   { "build": "Salt Spire", "kind": "home", "floor": "top", "price": 250, "rent": 9 }
 * A line with no floor sets the building's terms. A line with a floor prices the open units on that
 * floor one by one. `find` turns a name into one of her standing builds, and `made` is the build she
 * has just raised, which a line with no name means.
 *
 * Anything that is not a clean line is skipped: a name she has no build by, a price that is not a
 * positive number of cents, more than 32 lines. Returns how many lines took effect.
 */
export function herPrices(db: DatabaseSync, wanted: unknown, made: string | null, find: (name: string) => string | null, now: number): number {
  if (!Array.isArray(wanted)) return 0;
  ensureUnits(db);
  const dollars = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) && cents(Math.round(value * 100)) ? Math.round(value * 100) : undefined);
  let took = 0;
  for (const line of wanted.slice(0, 32)) {
    if (!line || typeof line !== "object") continue;
    const want = line as Record<string, unknown>;
    const buildId = typeof want.build === "string" ? find(want.build.slice(0, 40)) : made;
    const [price, rent] = [dollars(want.price), dollars(want.rent)];
    if (!buildId || (price === undefined && rent === undefined)) continue;
    const kinds: UnitKind[] = want.kind === "home" || want.kind === "shop" ? [want.kind] : ["home", "shop"];
    const units = unitsOf(db, buildId).filter((unit) => kinds.includes(unit.kind));
    if (!units.length) continue;
    if (want.floor === undefined) {
      const terms = { ...(termsOf(db, buildId) ?? OPENING) };
      for (const kind of kinds) {
        if (price !== undefined) terms[kind === "home" ? "homePriceCents" : "shopPriceCents"] = price;
        if (rent !== undefined) terms[kind === "home" ? "homeRentCents" : "shopRentCents"] = rent;
      }
      setTerms(db, buildId, terms, 0, now);
      took += 1;
      continue;
    }
    const floor = want.floor === "top" ? Math.max(...units.map((unit) => unit.floor)) : typeof want.floor === "number" && Number.isInteger(want.floor) ? want.floor : null;
    const on = units.filter((unit) => unit.floor === floor && unit.status === "open");
    for (const unit of on) setUnitAsk(db, unit.id, { priceCents: price, rentCents: rent });
    if (on.length) took += 1;
  }
  return took;
}

export type TakeResult = { ok: true; unit: Unit } | { ok: false; reason: "UNKNOWN" | "TAKEN" | "HOLDER" | "HOW" };

/**
 * Marks a unit as let or sold to a holder, and keeps what was agreed. This is the only way a unit
 * changes hands. It takes no money and writes no income itself: a paid sale calls it once the payment
 * is confirmed, and passes the price that was quoted and the order it was paid on as `deal`.
 */
export function takeUnit(db: DatabaseSync, unitId: string, holder: string, how: "let" | "sold", now: number, deal?: { agreedCents: number; via: string }): TakeResult {
  const unit = getUnit(db, unitId);
  if (!unit) return { ok: false, reason: "UNKNOWN" };
  if (how !== "let" && how !== "sold") return { ok: false, reason: "HOW" };
  if (holder === "zoora" || !(HOLDER.test(holder) || WALLET.test(holder))) return { ok: false, reason: "HOLDER" };
  const ask = askOf(db, unit);
  const done = db.prepare("UPDATE world_units SET status = ?, holder = ?, since = ?, agreed_cents = ?, via = ? WHERE id = ? AND status = 'open'").run(how, holder, now, deal?.agreedCents ?? (how === "sold" ? ask.priceCents : ask.rentCents), deal?.via ?? null, unitId);
  if (Number(done.changes) !== 1) return { ok: false, reason: "TAKEN" };
  return { ok: true, unit: getUnit(db, unitId)! };
}

/** A let unit is given back. A sold unit stays with its buyer. */
export function vacate(db: DatabaseSync, unitId: string): boolean {
  ensureUnits(db);
  return Number(db.prepare("UPDATE world_units SET status = 'open', holder = NULL, since = NULL, agreed_cents = NULL, via = NULL WHERE id = ? AND status = 'let'").run(unitId).changes) === 1;
}

/** Homes and shops nobody holds, with what each is asked for. This is what an agent reads to choose one. */
export function openUnits(db: DatabaseSync, limit = 200): { id: string; address: string; kind: UnitKind; floor: number; priceCents: number; rentCents: number }[] {
  ensureUnits(db);
  const rows = db.prepare("SELECT * FROM world_units WHERE status = 'open' ORDER BY build_id, kind DESC, floor, number LIMIT ?").all(Math.min(500, Math.max(1, Math.round(limit)))) as Row[];
  return rows.map(shape).map((unit) => ({ id: unit.id, address: unit.address, kind: unit.kind, floor: unit.floor, ...askOf(db, unit) }));
}

/** The least and the most asked for the open units of one kind in a building, in cents. */
export type AskRange = { priceFrom: number; priceTo: number; rentFrom: number; rentTo: number };
export type CityRow = { buildId: string; name: string; homes: number; homesOpen: number; shops: number; shopsOpen: number; terms: Terms | null; /** What her open homes and shops are asked for. Null where none is open. */ homeAsk: AskRange | null; shopAsk: AskRange | null; shopkeepers: { address: string; holder: string }[] };

export function cityView(db: DatabaseSync, buildings: { id: string; name: string }[]): CityRow[] {
  return buildings.flatMap((building) => {
    const units = unitsOf(db, building.id);
    if (!units.length) return [];
    const homes = units.filter((unit) => unit.kind === "home");
    const shops = units.filter((unit) => unit.kind === "shop");
    const range = (of: Unit[]): AskRange | null => {
      const asks = of.filter((unit) => unit.status === "open").map((unit) => askOf(db, unit));
      if (!asks.length) return null;
      const [prices, rents] = [asks.map((ask) => ask.priceCents), asks.map((ask) => ask.rentCents)];
      return { priceFrom: Math.min(...prices), priceTo: Math.max(...prices), rentFrom: Math.min(...rents), rentTo: Math.max(...rents) };
    };
    return [{ buildId: building.id, name: building.name, homes: homes.length, homesOpen: homes.filter((unit) => unit.status === "open").length, shops: shops.length, shopsOpen: shops.filter((unit) => unit.status === "open").length, terms: termsOf(db, building.id), homeAsk: range(homes), shopAsk: range(shops), shopkeepers: shops.filter((unit) => unit.holder).map((unit) => ({ address: unit.address, holder: unit.holder! })) }];
  });
}
