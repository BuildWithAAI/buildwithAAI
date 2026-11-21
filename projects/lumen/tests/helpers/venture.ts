import type { DatabaseSync } from "node:sqlite";
import { savePlan, setCheck, OWNER_CHECKS, type Plan } from "../../src/economy/plans";
import { decideVenture, launchVenture, proposeVenture, type Venture } from "../../src/economy/ventures";

/** A plan that passes both gates: written, priced, costed by the owner, with a target. */
export const FULL_PLAN: Partial<Plan> = {
  offer: "Her own drawings printed on shirts.",
  customer: "Visitors who want to keep a piece.",
  website: "The merch page, with price and returns.",
  social: "One post per drawing, marked automated.",
  shipping: "The printer posts it. Flat charge added.",
  operations: "The printer prints. She draws.",
  risks: "A print may look worse than the drawing.",
  stopRule: "Stop if nothing sells in the time given.",
  priceCents: 2_500,
  unitCostCents: 1_250,
  unitCostSource: "owner",
  targetUnits: 10,
  startup: [],
  budgetAskCents: 0,
  daysAsk: 30,
};

export const READY = { printerSet: true, artHostSet: true, cardSet: true, salesOpen: true, approvedProducts: 1 };

export function proposeWithPlan(db: DatabaseSync, input: { id: string; name: string; kind: string; by?: "zoora" | "owner" }, now: number, plan: Partial<Plan> = FULL_PLAN): Venture {
  const venture = proposeVenture(db, { id: input.id, name: input.name, kind: input.kind, by: input.by ?? "zoora" }, now);
  savePlan(db, input.id, plan, "owner", now);
  return venture;
}

/** Proposed, planned, approved, every day-one item done, and launched. */
export function launched(db: DatabaseSync, id: string, kind: string, budgetCents: number, days: number, now: number): Venture {
  proposeWithPlan(db, { id, name: id.replace(/-/g, " "), kind }, now);
  decideVenture(db, id, "approved", { budgetCents, days }, now);
  for (const item of OWNER_CHECKS) setCheck(db, id, item.key, true, now);
  return launchVenture(db, id, READY, now);
}
