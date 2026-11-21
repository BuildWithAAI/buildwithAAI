import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/db";
import { bookSummary, decideMilestone, detectMilestones, addVenue, recordReading } from "../src/economy/economy";
import { setLadderMode } from "../src/economy/ladder";
import { decideVenture, expireVentures, getVenture, proposeVenture, scorecard, setVentureStatus, ventureLine, ventureSpendAllowed } from "../src/economy/ventures";
import { markTainted } from "../src/security/taint";
import { FULL_PLAN, launched, proposeWithPlan } from "./helpers/venture";
import { savePlan } from "../src/economy/plans";

const T = 1_800_000_000_000;
const DAY = 86_400_000;

function running(budgetCents = 5_000, days = 30) {
  const db = openDatabase();
  launched(db, "tide-prints", "prints", budgetCents, days, T);
  return db;
}

describe("venture desk", () => {
  it("a proposal opens nothing until the owner approves it with a budget and a time limit", () => {
    const db = openDatabase();
    const proposed = proposeVenture(db, { id: "tide-prints", name: "Tide prints", kind: "prints", by: "zoora" }, T);
    expect(proposed.status).toBe("proposed");
    expect(ventureSpendAllowed(db, "tide-prints", 100, T)).toEqual({ ok: false, reason: "NOT_ACTIVE" });
    expect(() => decideVenture(db, "tide-prints", "approved", { budgetCents: 5_000, days: 30 }, T)).toThrow("ECON_PLAN_INCOMPLETE");
    savePlan(db, "tide-prints", FULL_PLAN, "owner", T);
    const approved = decideVenture(db, "tide-prints", "approved", { budgetCents: 5_000, days: 30 }, T);
    expect(approved.status).toBe("setup");
    expect(approved.deadlineMs).toBe(T + 30 * DAY);
    expect(() => decideVenture(db, "tide-prints", "approved", { budgetCents: 9_000, days: 30 }, T)).toThrow("ECON_VENTURE_STATE");
  });

  it("refuses bad ids, kinds, terms, duplicates and account numbers in the name", () => {
    const db = openDatabase();
    expect(() => proposeVenture(db, { id: "X", name: "a", kind: "prints", by: "zoora" }, T)).toThrow("ECON_VENTURE_ID");
    expect(() => proposeVenture(db, { id: "ok-id", name: "a", kind: "casino", by: "zoora" }, T)).toThrow("ECON_VENTURE_KIND");
    expect(() => proposeVenture(db, { id: "ok-id", name: "acct 1234 5678 9012", kind: "shop", by: "zoora" }, T)).toThrow("ECON_NUMBER_REFUSED");
    proposeVenture(db, { id: "ok-id", name: "Shop", kind: "shop", by: "owner" }, T);
    expect(() => proposeVenture(db, { id: "ok-id", name: "Shop again", kind: "shop", by: "owner" }, T)).toThrow("ECON_VENTURE_EXISTS");
    expect(() => decideVenture(db, "ok-id", "approved", { budgetCents: -1, days: 30 }, T)).toThrow("ECON_AMOUNT");
    expect(() => decideVenture(db, "ok-id", "approved", { budgetCents: 100, days: 0 }, T)).toThrow("ECON_VENTURE_DAYS");
    expect(() => decideVenture(db, "ok-id", "approved", { budgetCents: 100, days: 366 }, T)).toThrow("ECON_VENTURE_DAYS");
    expect(decideVenture(db, "ok-id", "declined", { budgetCents: 0, days: 0 }, T).status).toBe("declined");
  });

  it("the budget is what it may lose: income earns back room to spend", () => {
    const db = running(5_000);
    expect(ventureSpendAllowed(db, "tide-prints", 5_000, T).ok).toBe(true);
    expect(ventureSpendAllowed(db, "tide-prints", 5_001, T)).toEqual({ ok: false, reason: "BUDGET" });
    ventureLine(db, "tide-prints", { kind: "expense", cents: 4_000, category: "sample", idem: "line-1" }, T);
    expect(ventureSpendAllowed(db, "tide-prints", 1_001, T)).toEqual({ ok: false, reason: "BUDGET" });
    ventureLine(db, "tide-prints", { kind: "income", cents: 3_000, category: "prints", idem: "line-2" }, T);
    expect(ventureSpendAllowed(db, "tide-prints", 4_000, T).ok).toBe(true);
    const card = scorecard(db, "tide-prints", T);
    expect(card).toMatchObject({ incomeCents: 3_000, expenseCents: 4_000, netCents: -1_000, budgetLeftCents: 4_000, daysLeft: 30, returnPercent: -25, tainted: false });
  });

  it("a line is written once, and lands in the venture's own book", () => {
    const db = running();
    expect(ventureLine(db, "tide-prints", { kind: "income", cents: 2_500, category: "prints", idem: "sale-1" }, T).added).toBe(true);
    expect(ventureLine(db, "tide-prints", { kind: "income", cents: 2_500, category: "prints", idem: "sale-1" }, T).added).toBe(false);
    expect(scorecard(db, "tide-prints", T).incomeCents).toBe(2_500);
    expect(bookSummary(db, "company", T).incomeCents).toBe(2_500);
    proposeWithPlan(db, { id: "first-plots", name: "First plots", kind: "land" }, T);
    decideVenture(db, "first-plots", "approved", { budgetCents: 0, days: 10 }, T);
    ventureLine(db, "first-plots", { kind: "income", cents: 9_000, category: "plots", idem: "plot-1" }, T);
    expect(bookSummary(db, "land", T).incomeCents).toBe(9_000);
    expect(bookSummary(db, "company", T).incomeCents).toBe(2_500);
  });

  it("a failed line leaves nothing half written", () => {
    const db = running();
    expect(() => ventureLine(db, "tide-prints", { kind: "expense", cents: 0, category: "sample", idem: "zero-1" }, T)).toThrow("ECON_AMOUNT");
    expect(scorecard(db, "tide-prints", T).expenseCents).toBe(0);
    expect(ventureLine(db, "tide-prints", { kind: "expense", cents: 100, category: "sample", idem: "good-1" }, T).added).toBe(true);
  });

  it("stops at its time limit, and resuming needs new time", () => {
    const db = running(5_000, 7);
    expect(ventureSpendAllowed(db, "tide-prints", 100, T + 7 * DAY)).toEqual({ ok: false, reason: "EXPIRED" });
    expect(expireVentures(db, T + 6 * DAY)).toEqual([]);
    expect(expireVentures(db, T + 7 * DAY)).toEqual(["tide-prints"]);
    expect(getVenture(db, "tide-prints")?.status).toBe("paused");
    expect(() => setVentureStatus(db, "tide-prints", "active", T + 8 * DAY)).toThrow("ECON_VENTURE_DAYS");
    const again = setVentureStatus(db, "tide-prints", "active", T + 8 * DAY, { days: 14 });
    expect(again.status).toBe("active");
    expect(again.deadlineMs).toBe(T + 22 * DAY);
    expect(setVentureStatus(db, "tide-prints", "closed", T + 9 * DAY).status).toBe("closed");
    expect(() => setVentureStatus(db, "tide-prints", "active", T + 9 * DAY, { days: 5 })).toThrow("ECON_VENTURE_STATE");
  });

  it("a venture made from outside text is marked for good and cannot spend by itself", () => {
    const db = openDatabase();
    markTainted(db, "idea", "idea-9", "x", T, "a reply");
    proposeVenture(db, { id: "reply-idea", name: "Reply idea", kind: "shop", by: "zoora", behind: [{ kind: "idea", ref: "idea-9" }] }, T);
    savePlan(db, "reply-idea", FULL_PLAN, "owner", T);
    decideVenture(db, "reply-idea", "approved", { budgetCents: 5_000, days: 30 }, T);
    expect(ventureSpendAllowed(db, "reply-idea", 100, T)).toEqual({ ok: false, reason: "TAINTED" });
    expect(scorecard(db, "reply-idea", T).tainted).toBe(true);
  });

  it("on the earned ladder, the budget and the number running are held to what was earned", () => {
    const db = openDatabase();
    setLadderMode(db, "earned");
    proposeWithPlan(db, { id: "one-a", name: "One", kind: "prints" }, T);
    proposeWithPlan(db, { id: "two-b", name: "Two", kind: "shop" }, T);
    expect(() => decideVenture(db, "one-a", "approved", { budgetCents: 100, days: 30 }, T)).toThrow("ECON_VENTURE_CAP");
    expect(decideVenture(db, "one-a", "approved", { budgetCents: 0, days: 30 }, T).status).toBe("setup");
    expect(() => decideVenture(db, "two-b", "approved", { budgetCents: 0, days: 30 }, T)).toThrow("ECON_VENTURE_LIMIT");
    addVenue(db, { id: "shop", bookId: "company", name: "Shop payouts", kind: "shop" }, T);
    recordReading(db, { venueId: "shop", valueCents: 100_000, source: "owner" }, T);
    detectMilestones(db, T);
    decideMilestone(db, 50_000, "approved", T);
    decideMilestone(db, 100_000, "approved", T);
    expect(() => decideVenture(db, "two-b", "approved", { budgetCents: 2_501, days: 30 }, T)).toThrow("ECON_VENTURE_CAP");
    expect(decideVenture(db, "two-b", "approved", { budgetCents: 2_500, days: 30 }, T).status).toBe("setup");
  });

  it("in open mode the owner's budget stands", () => {
    const db = openDatabase();
    proposeWithPlan(db, { id: "one-a", name: "One", kind: "prints" }, T);
    expect(decideVenture(db, "one-a", "approved", { budgetCents: 10_000, days: 30 }, T).budgetCents).toBe(10_000);
  });
});
