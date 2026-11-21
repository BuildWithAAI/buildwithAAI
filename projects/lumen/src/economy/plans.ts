import type { DatabaseSync } from "node:sqlite";
import { inheritTaint, type TaintKind } from "../security/taint";

/**
 * A venture's business plan. Every venture has one, in the same layout.
 *
 * The words say what is sold, to whom, where it is shown, how it is talked about, how it ships, who
 * makes it, what could go wrong and when to stop. The numbers are inputs: a price, a cost for one, the
 * payment fee, what it costs to start and to run for a month, and a target. Everything else is worked
 * out here from those, so a margin or a break-even point is never typed in and never guessed.
 *
 * A cost says where it came from. "estimate" is a guess. "quoted" came from a real priced order.
 * "owner" was confirmed by the owner. A venture cannot launch on an estimate.
 *
 * There are two gates. To be approved and start setting up, the plan must be written and its start-up
 * costs listed. To launch, the dollars must be settled, the margin must be real, and every item on the
 * day-one list must be done.
 */

export const TEXT_FIELDS = ["offer", "customer", "website", "social", "shipping", "operations", "risks", "stopRule"] as const;
export type TextField = (typeof TEXT_FIELDS)[number];
export const FIELD_LABELS: Record<TextField, string> = {
  offer: "What is sold",
  customer: "Who it is for",
  website: "Where it is on the site",
  social: "How it is talked about",
  shipping: "Shipping and returns",
  operations: "Who makes and sends it",
  risks: "What could go wrong",
  stopRule: "When to stop",
};
export type CostSource = "estimate" | "quoted" | "owner";
export type CostLine = { label: string; cents: number };
export type Plan = {
  offer: string;
  customer: string;
  website: string;
  social: string;
  shipping: string;
  operations: string;
  risks: string;
  stopRule: string;
  priceCents: number | null;
  /** What one unit costs to make and send, all in. */
  unitCostCents: number | null;
  unitCostSource: CostSource | null;
  /** What the buyer is charged for shipping on top of the price. */
  shippingChargeCents: number;
  /** The payment company's cut: a share of the sale in hundredths of a percent, plus a fixed amount. */
  feeBasisPoints: number;
  feeFixedCents: number;
  startup: CostLine[];
  monthly: CostLine[];
  /** Units she aims to sell in the first month. */
  targetUnits: number | null;
  budgetAskCents: number;
  daysAsk: number;
};

export const MIN_LAUNCH_MARGIN_PERCENT = 20;
const MAX_CENTS = 100_000_000;

export function blankPlan(): Plan {
  return { offer: "", customer: "", website: "", social: "", shipping: "", operations: "", risks: "", stopRule: "", priceCents: null, unitCostCents: null, unitCostSource: null, shippingChargeCents: 0, feeBasisPoints: 290, feeFixedCents: 30, startup: [], monthly: [], targetUnits: null, budgetAskCents: 0, daysAsk: 30 };
}

function words(text: unknown, max: number): string {
  const value = String(text ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  if (/\d{8,}/.test(value.replace(/[\s-]/g, ""))) throw new Error("ECON_NUMBER_REFUSED");
  return value;
}

function amount(value: unknown, allowNull: boolean): number | null {
  if (value == null || value === "") {
    if (allowNull) return null;
    throw new Error("ECON_PLAN_AMOUNT");
  }
  const cents = Number(value);
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > MAX_CENTS) throw new Error("ECON_PLAN_AMOUNT");
  return cents;
}

function lines(value: unknown): CostLine[] {
  if (!Array.isArray(value) || value.length > 12) throw new Error("ECON_PLAN_LINES");
  return value.map((item) => {
    const label = words((item as CostLine)?.label, 60);
    if (!label) throw new Error("ECON_PLAN_LINES");
    return { label, cents: amount((item as CostLine)?.cents, false)! };
  });
}

/** Checks and tidies a plan. Anything that is not a plan in this exact layout is refused. */
export function cleanPlan(input: Partial<Plan>): Plan {
  const base = blankPlan();
  const source = input.unitCostSource ?? null;
  if (source !== null && source !== "estimate" && source !== "quoted" && source !== "owner") throw new Error("ECON_PLAN_SOURCE");
  const unitCost = amount(input.unitCostCents, true);
  const basis = Number(input.feeBasisPoints ?? base.feeBasisPoints);
  if (!Number.isInteger(basis) || basis < 0 || basis > 3_000) throw new Error("ECON_PLAN_FEE");
  const target = input.targetUnits == null ? null : Number(input.targetUnits);
  if (target !== null && (!Number.isInteger(target) || target < 1 || target > 1_000_000)) throw new Error("ECON_PLAN_TARGET");
  const days = Number(input.daysAsk ?? base.daysAsk);
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("ECON_VENTURE_DAYS");
  const plan = { ...base } as Plan;
  for (const field of TEXT_FIELDS) plan[field] = words(input[field], 400);
  plan.priceCents = amount(input.priceCents, true);
  plan.unitCostCents = unitCost;
  plan.unitCostSource = unitCost == null ? null : source ?? "estimate";
  plan.shippingChargeCents = amount(input.shippingChargeCents ?? 0, false)!;
  plan.feeBasisPoints = basis;
  plan.feeFixedCents = amount(input.feeFixedCents ?? base.feeFixedCents, false)!;
  plan.startup = lines(input.startup ?? []);
  plan.monthly = lines(input.monthly ?? []);
  plan.targetUnits = target;
  plan.budgetAskCents = amount(input.budgetAskCents ?? 0, false)!;
  plan.daysAsk = days;
  return plan;
}

export type Figures = {
  startupCents: number;
  monthlyCents: number;
  /** What the buyer pays for one: price plus the shipping charge. */
  takeCents: number | null;
  feeCents: number | null;
  /** What is left from one sale after its cost and the payment fee. */
  unitMarginCents: number | null;
  marginPercent: number | null;
  /** Sales needed to pay back the start-up costs and one month of running costs. */
  breakEvenUnits: number | null;
  monthOneRevenueCents: number | null;
  /** The first month at target, after start-up and running costs. */
  monthOneResultCents: number | null;
  /** The most it can lose in month one if nothing sells: start-up plus one month. */
  worstCaseCents: number;
};

/** Every figure here is arithmetic on the plan's inputs. Nothing is rounded in the plan's favour. */
export function figures(plan: Plan): Figures {
  const startup = plan.startup.reduce((sum, line) => sum + line.cents, 0);
  const monthly = plan.monthly.reduce((sum, line) => sum + line.cents, 0);
  const take = plan.priceCents == null ? null : plan.priceCents + plan.shippingChargeCents;
  const fee = take == null ? null : Math.ceil((take * plan.feeBasisPoints) / 10_000) + plan.feeFixedCents;
  const margin = take == null || fee == null || plan.unitCostCents == null ? null : take - fee - plan.unitCostCents;
  const percent = margin == null || !take ? null : Math.floor((margin * 100) / take);
  const breakEven = margin != null && margin > 0 ? Math.ceil((startup + monthly) / margin) : null;
  const revenue = take == null || plan.targetUnits == null ? null : take * plan.targetUnits;
  const result = margin == null || plan.targetUnits == null ? null : margin * plan.targetUnits - startup - monthly;
  return { startupCents: startup, monthlyCents: monthly, takeCents: take, feeCents: fee, unitMarginCents: margin, marginPercent: percent, breakEvenUnits: breakEven, monthOneRevenueCents: revenue, monthOneResultCents: result, worstCaseCents: startup + monthly };
}

export type Gap = { code: string; say: string };

/** What is still missing for a gate. An empty list means the plan passes it. */
export function planGaps(plan: Plan, gate: "setup" | "launch"): Gap[] {
  const gaps: Gap[] = [];
  for (const field of TEXT_FIELDS) if (plan[field].length < 12) gaps.push({ code: `TEXT_${field.toUpperCase()}`, say: `"${FIELD_LABELS[field]}" is not written.` });
  const sums = figures(plan);
  if (plan.budgetAskCents < sums.worstCaseCents) gaps.push({ code: "BUDGET_ASK", say: "The budget asked for is less than the start-up costs plus one month of running costs." });
  if (gate === "setup") return gaps;
  if (plan.priceCents == null || plan.priceCents <= 0) gaps.push({ code: "PRICE", say: "No price is set." });
  if (plan.unitCostCents == null) gaps.push({ code: "UNIT_COST", say: "The cost of one unit is not known." });
  else if (plan.unitCostSource === "estimate") gaps.push({ code: "UNIT_COST_ESTIMATE", say: "The cost of one unit is still a guess. It needs a real quote, or the owner's word." });
  if (plan.targetUnits == null) gaps.push({ code: "TARGET", say: "No first-month target is set." });
  if (sums.unitMarginCents != null && sums.unitMarginCents <= 0) gaps.push({ code: "MARGIN_NEGATIVE", say: "Each sale loses money." });
  else if (sums.marginPercent != null && sums.marginPercent < MIN_LAUNCH_MARGIN_PERCENT) gaps.push({ code: "MARGIN_THIN", say: `Each sale leaves less than ${MIN_LAUNCH_MARGIN_PERCENT}%.` });
  return gaps;
}

export function ensurePlans(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS econ_venture_plans (venture_id TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS econ_venture_checks (venture_id TEXT NOT NULL, key TEXT NOT NULL, done_at INTEGER NOT NULL, PRIMARY KEY(venture_id, key));
  `);
}

export function getPlan(db: DatabaseSync, ventureId: string): Plan | null {
  ensurePlans(db);
  const row = db.prepare("SELECT body FROM econ_venture_plans WHERE venture_id = ?").get(ventureId) as { body: string } | undefined;
  if (!row) return null;
  try {
    return cleanPlan(JSON.parse(row.body) as Partial<Plan>);
  } catch {
    return null;
  }
}

/** Saves the plan whole. If anything behind the words came from outside, the venture is marked for good. */
export function savePlan(db: DatabaseSync, ventureId: string, input: Partial<Plan>, by: "zoora" | "owner", now: number, behind?: { kind: TaintKind; ref: string }[]): Plan {
  ensurePlans(db);
  if (by !== "zoora" && by !== "owner") throw new Error("ECON_VENTURE_BY");
  const plan = cleanPlan(input);
  // She may guess a cost. Only a real quote or the owner can settle one.
  if (by === "zoora" && plan.unitCostSource !== null) plan.unitCostSource = "estimate";
  db.prepare("INSERT INTO econ_venture_plans(venture_id, body, updated_at, updated_by) VALUES(?, ?, ?, ?) ON CONFLICT(venture_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at, updated_by = excluded.updated_by, version = version + 1").run(ventureId, JSON.stringify(plan), now, by);
  if (behind?.length) inheritTaint(db, behind, { kind: "venture", ref: ventureId }, now);
  return plan;
}

/** A real priced order settles what one unit costs. A cost the owner confirmed is left alone. */
export function noteQuote(db: DatabaseSync, ventureId: string, unitCostCents: number, now: number): void {
  const plan = getPlan(db, ventureId);
  if (!plan || plan.unitCostSource === "owner" || !Number.isSafeInteger(unitCostCents) || unitCostCents <= 0) return;
  savePlan(db, ventureId, { ...plan, unitCostCents, unitCostSource: "quoted" }, "owner", now);
}

/** The day-one list. Some items the code can see for itself. The rest the owner ticks after looking. */
export const OWNER_CHECKS: { key: string; say: string }[] = [
  { key: "website", say: "Its page is live on the site and shows the price, shipping and returns." },
  { key: "social", say: "Its social account is ready, and says it is automated and by whom." },
  { key: "shipping", say: "Shipping and returns are settled, or nothing ships." },
];

/** What the code can see about a venture's tools. The caller gathers these, so this file needs no other. */
export type Facts = { kind: string; printerSet: boolean; artHostSet: boolean; cardSet: boolean; salesOpen: boolean; approvedProducts: number };
export type CheckItem = { key: string; say: string; by: "code" | "owner"; done: boolean };

export function setCheck(db: DatabaseSync, ventureId: string, key: string, done: boolean, now: number): void {
  ensurePlans(db);
  if (!OWNER_CHECKS.some((item) => item.key === key)) throw new Error("ECON_CHECK");
  if (done) db.prepare("INSERT OR IGNORE INTO econ_venture_checks(venture_id, key, done_at) VALUES(?, ?, ?)").run(ventureId, key, now);
  else db.prepare("DELETE FROM econ_venture_checks WHERE venture_id = ? AND key = ?").run(ventureId, key);
}

export type Readiness = { ready: boolean; items: CheckItem[]; gaps: Gap[] };

export function readiness(db: DatabaseSync, ventureId: string, facts: Facts): Readiness {
  ensurePlans(db);
  const plan = getPlan(db, ventureId);
  const gaps = plan ? planGaps(plan, "launch") : [{ code: "NO_PLAN", say: "There is no plan." }];
  const ticked = new Set((db.prepare("SELECT key FROM econ_venture_checks WHERE venture_id = ?").all(ventureId) as { key: string }[]).map((row) => row.key));
  const items: CheckItem[] = [{ key: "plan", say: "The plan is complete and its dollars are settled.", by: "code", done: gaps.length === 0 }];
  if (facts.kind === "prints") {
    items.push(
      { key: "printer", say: "The print company is connected.", by: "code", done: facts.printerSet },
      { key: "art-host", say: "There is a host her art is sent from.", by: "code", done: facts.artHostSet },
      { key: "product", say: "At least one product is approved.", by: "code", done: facts.approvedProducts > 0 },
    );
  }
  if (["prints", "shop", "white-label", "art"].includes(facts.kind)) {
    items.push({ key: "card", say: "Card payments are connected.", by: "code", done: facts.cardSet }, { key: "sales", say: "Sales are switched on.", by: "code", done: facts.salesOpen });
  }
  for (const item of OWNER_CHECKS) items.push({ key: item.key, say: item.say, by: "owner", done: ticked.has(item.key) });
  return { ready: items.every((item) => item.done), items, gaps };
}
