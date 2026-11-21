import type { DatabaseSync } from "node:sqlite";

/**
 * Homes and shops inside what she builds.
 *
 * A building she raises can declare units: homes on its upper floors and shops on its ground floor.
 * Each unit has an address, and an agent can rent it or buy it.
 *
 * Zoora decides the terms. She sets the rent and the price for each building, and changes them as it
 * fills. Nobody else sets them: not the owner, not the agent, not anything a visitor types.
 *
 * What this file does not do is take money. There is no payment here. A unit is marked as let or sold
 * only through `takeUnit`, and no income is written to any book from it, because a book line needs a
 * payment that was really received. When payments are built they must end by calling `takeUnit`.
 *
 * A building cannot be taken down, or changed so that it has fewer units, while anyone holds a unit in it.
 */

export type UnitKind = "home" | "shop";
export type Unit = { id: string; buildId: string; kind: UnitKind; floor: number; number: number; address: string; status: "open" | "let" | "sold"; holder: string | null; since: number | null };
export type Terms = { homeRentCents: number; homePriceCents: number; shopRentCents: number; shopPriceCents: number };

/** Height of one floor, and the floor space one unit needs, in metres. */
export const FLOOR = 3.2;
export const UNIT_AREA = 80;
const HOLDER = /^[a-z0-9][a-z0-9-]{1,39}$/;

export function ensureUnits(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_units (
      id TEXT PRIMARY KEY, build_id TEXT NOT NULL, kind TEXT NOT NULL, floor INTEGER NOT NULL, number INTEGER NOT NULL,
      address TEXT NOT NULL, status TEXT NOT NULL, holder TEXT, since INTEGER
    );
    CREATE INDEX IF NOT EXISTS world_units_build ON world_units(build_id);
    CREATE TABLE IF NOT EXISTS world_unit_terms (build_id TEXT PRIMARY KEY, body TEXT NOT NULL, set_at INTEGER NOT NULL, let_share REAL NOT NULL);
  `);
}

/** How many units a building really has room for. She cannot declare forty homes in a lamp post. */
export function unitRoom(height: number, hw: number, hd: number): { homes: number; shops: number } {
  const perFloor = Math.max(0, Math.floor((hw * 2 * hd * 2) / UNIT_AREA));
  const floors = Math.floor(height / FLOOR);
  return { homes: perFloor * Math.max(0, floors - 1), shops: floors >= 1 ? perFloor : 0 };
}

type Row = { id: string; build_id: string; kind: UnitKind; floor: number; number: number; address: string; status: Unit["status"]; holder: string | null; since: number | null };
const shape = (row: Row): Unit => ({ id: row.id, buildId: row.build_id, kind: row.kind, floor: Number(row.floor), number: Number(row.number), address: row.address, status: row.status, holder: row.holder, since: row.since == null ? null : Number(row.since) });

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

/** What a building would have, given what she asked for and what fits. */
export function unitPlan(building: Building, want: { homes?: number; shops?: number } | undefined): { homes: number; shops: number } {
  const room = unitRoom(building.height, building.hw, building.hd);
  return { homes: Math.min(room.homes, Math.max(0, Math.round(want?.homes ?? 0))), shops: Math.min(room.shops, Math.max(0, Math.round(want?.shops ?? 0))) };
}

/** Makes a building's units match what it declares. Refused if that would remove a unit someone holds. */
export function syncUnits(db: DatabaseSync, building: Building, want: { homes?: number; shops?: number } | undefined): void {
  ensureUnits(db);
  const plan = unitPlan(building, want);
  const current = unitsOf(db, building.id);
  const perFloor = Math.max(1, Math.floor((building.hw * 2 * building.hd * 2) / UNIT_AREA));
  const keep = (unit: Unit) => (unit.kind === "home" ? unit.number <= perFloor && unit.number + (unit.floor - 2) * perFloor <= plan.homes : unit.number <= plan.shops);
  if (current.some((unit) => unit.status !== "open" && !keep(unit))) throw new Error("FORGE_HOLDS_TENANTS");
  for (const unit of current) if (!keep(unit)) db.prepare("DELETE FROM world_units WHERE id = ?").run(unit.id);
  const have = new Set(current.map((unit) => unit.id));
  const add = (kind: UnitKind, floor: number, number: number) => {
    const id = `${building.id}-${kind === "home" ? "h" : "s"}${floor}-${number}`;
    const address = `${building.name}, ${kind === "home" ? "Home" : "Shop"} ${floor}${String(number).padStart(2, "0")}`;
    if (have.has(id)) db.prepare("UPDATE world_units SET address = ? WHERE id = ?").run(address, id);
    else db.prepare("INSERT INTO world_units(id, build_id, kind, floor, number, address, status) VALUES(?, ?, ?, ?, ?, ?, 'open')").run(id, building.id, kind, floor, number, address);
  };
  for (let k = 0; k < plan.shops; k += 1) add("shop", 1, k + 1);
  for (let k = 0; k < plan.homes; k += 1) add("home", 2 + Math.floor(k / perFloor), (k % perFloor) + 1);
}

export function dropUnits(db: DatabaseSync, buildId: string): void {
  ensureUnits(db);
  if (heldIn(db, buildId) > 0) throw new Error("FORGE_HOLDS_TENANTS");
  db.prepare("DELETE FROM world_units WHERE build_id = ?").run(buildId);
  db.prepare("DELETE FROM world_unit_terms WHERE build_id = ?").run(buildId);
}

/**
 * Her terms for a building. These are her opening rule, written down so it can be read: a home's rent
 * rises with the height of the building, a shop costs three homes, buying costs sixty months of rent,
 * and everything rises as the building fills. She resets them herself as occupancy changes.
 */
export function herTerms(height: number, letShare: number): Terms {
  const floors = Math.max(1, Math.floor(height / FLOOR));
  const demand = 1 + (letShare >= 0.8 ? 0.5 : letShare >= 0.5 ? 0.25 : 0);
  const homeRent = Math.round((500 + 40 * floors) * demand);
  return { homeRentCents: homeRent, homePriceCents: homeRent * 60, shopRentCents: homeRent * 3, shopPriceCents: homeRent * 180 };
}

export function termsOf(db: DatabaseSync, buildId: string): Terms | null {
  ensureUnits(db);
  const row = db.prepare("SELECT body FROM world_unit_terms WHERE build_id = ?").get(buildId) as { body: string } | undefined;
  return row ? (JSON.parse(row.body) as Terms) : null;
}

/** She sets a building's terms. Whole cents, above zero, and nothing else is accepted. */
export function setTerms(db: DatabaseSync, buildId: string, terms: Terms, letShare: number, now: number): void {
  ensureUnits(db);
  for (const value of [terms.homeRentCents, terms.homePriceCents, terms.shopRentCents, terms.shopPriceCents]) if (!Number.isSafeInteger(value) || value <= 0 || value > 1_000_000_000) throw new Error("UNITS_TERMS");
  db.prepare("INSERT INTO world_unit_terms(build_id, body, set_at, let_share) VALUES(?, ?, ?, ?) ON CONFLICT(build_id) DO UPDATE SET body = excluded.body, set_at = excluded.set_at, let_share = excluded.let_share").run(buildId, JSON.stringify(terms), now, letShare);
}

/** Her own step: every building with units gets terms, and a building whose occupancy has moved gets new ones. Returns how many she set. */
export function considerTerms(db: DatabaseSync, buildings: { id: string; height: number }[], now: number): number {
  ensureUnits(db);
  let set = 0;
  for (const building of buildings) {
    const units = unitsOf(db, building.id);
    if (!units.length) continue;
    const share = units.filter((unit) => unit.status !== "open").length / units.length;
    const row = db.prepare("SELECT let_share FROM world_unit_terms WHERE build_id = ?").get(building.id) as { let_share: number } | undefined;
    const band = (value: number) => (value >= 0.8 ? 2 : value >= 0.5 ? 1 : 0);
    if (row && band(Number(row.let_share)) === band(share)) continue;
    setTerms(db, building.id, herTerms(building.height, share), share, now);
    set += 1;
  }
  return set;
}

export type TakeResult = { ok: true; unit: Unit } | { ok: false; reason: "UNKNOWN" | "TAKEN" | "HOLDER" | "NO_TERMS" | "HOW" };

/** Marks a unit as let or sold to a holder. This is the only way a unit changes hands. It takes no money and writes no income. */
export function takeUnit(db: DatabaseSync, unitId: string, holder: string, how: "let" | "sold", now: number): TakeResult {
  const unit = getUnit(db, unitId);
  if (!unit) return { ok: false, reason: "UNKNOWN" };
  if (how !== "let" && how !== "sold") return { ok: false, reason: "HOW" };
  if (holder === "zoora" || !HOLDER.test(holder)) return { ok: false, reason: "HOLDER" };
  if (!termsOf(db, unit.buildId)) return { ok: false, reason: "NO_TERMS" };
  const done = db.prepare("UPDATE world_units SET status = ?, holder = ?, since = ? WHERE id = ? AND status = 'open'").run(how, holder, now, unitId);
  if (Number(done.changes) !== 1) return { ok: false, reason: "TAKEN" };
  return { ok: true, unit: getUnit(db, unitId)! };
}

/** A let unit is given back. A sold unit stays with its buyer. */
export function vacate(db: DatabaseSync, unitId: string): boolean {
  ensureUnits(db);
  return Number(db.prepare("UPDATE world_units SET status = 'open', holder = NULL, since = NULL WHERE id = ? AND status = 'let'").run(unitId).changes) === 1;
}

export type CityRow = { buildId: string; name: string; homes: number; homesOpen: number; shops: number; shopsOpen: number; terms: Terms | null; shopkeepers: { address: string; holder: string }[] };

export function cityView(db: DatabaseSync, buildings: { id: string; name: string }[]): CityRow[] {
  return buildings.flatMap((building) => {
    const units = unitsOf(db, building.id);
    if (!units.length) return [];
    const homes = units.filter((unit) => unit.kind === "home");
    const shops = units.filter((unit) => unit.kind === "shop");
    return [{ buildId: building.id, name: building.name, homes: homes.length, homesOpen: homes.filter((unit) => unit.status === "open").length, shops: shops.length, shopsOpen: shops.filter((unit) => unit.status === "open").length, terms: termsOf(db, building.id), shopkeepers: shops.filter((unit) => unit.holder).map((unit) => ({ address: unit.address, holder: unit.holder! })) }];
  });
}
