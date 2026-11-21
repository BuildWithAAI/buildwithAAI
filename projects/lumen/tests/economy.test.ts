import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/db";
import { addEntry, addVenue, bookSummary, decideMilestone, detectMilestones, milestones, proof, recordReading, splitIncome, STALE_MS } from "../src/economy/economy";

const T = 1_800_000_000_000;

function seeded() {
  const db = openDatabase();
  addVenue(db, { id: "main-exchange", bookId: "company", name: "Main exchange", kind: "exchange" }, T);
  addVenue(db, { id: "shop", bookId: "company", name: "Shop payouts", kind: "shop" }, T);
  addVenue(db, { id: "land-wallet", bookId: "land", name: "Land wallet", kind: "wallet" }, T);
  return db;
}

describe("economy", () => {
  it("splits income 65, 25, 10 in whole cents that always add up", () => {
    expect(splitIncome(10_000)).toEqual({ reserve: 6_500, hardware: 2_500, operations: 1_000 });
    for (const amount of [1, 3, 99, 101, 12_345]) {
      const part = splitIncome(amount);
      expect(part.reserve + part.hardware + part.operations).toBe(amount);
    }
  });

  it("measures what was earned: readings, less deposits, less costs paid from outside", () => {
    const db = seeded();
    addEntry(db, { bookId: "company", kind: "deposit", cents: 20_000, category: "seed", idem: "dep-1" }, T);
    addEntry(db, { bookId: "company", kind: "expense", cents: 3_000, category: "model", paidFrom: "outside", idem: "exp-1" }, T);
    addEntry(db, { bookId: "company", kind: "expense", cents: 1_000, category: "fees", idem: "exp-2" }, T);
    recordReading(db, { venueId: "main-exchange", valueCents: 60_000, source: "reader" }, T);
    recordReading(db, { venueId: "shop", valueCents: 15_000, source: "owner" }, T);
    const summary = bookSummary(db, "company", T);
    expect(summary.treasuryCents).toBe(75_000);
    expect(summary.earnedCents).toBe(75_000 - 20_000 - 3_000);
    expect(summary.outsideExpenseCents).toBe(3_000);
  });

  it("uses the latest reading and drops a venue nobody has read lately", () => {
    const db = seeded();
    recordReading(db, { venueId: "main-exchange", valueCents: 90_000, source: "reader" }, T);
    recordReading(db, { venueId: "main-exchange", valueCents: 40_000, source: "reader" }, T + 1);
    recordReading(db, { venueId: "shop", valueCents: 10_000, source: "owner" }, T);
    expect(bookSummary(db, "company", T + 2).treasuryCents).toBe(50_000);
    const later = bookSummary(db, "company", T + STALE_MS + 5);
    expect(later.treasuryCents).toBe(0);
    expect(later.staleVenues).toBe(2);
  });

  it("keeps the land book apart from the company book", () => {
    const db = seeded();
    addEntry(db, { bookId: "land", kind: "income", cents: 80_000, category: "plot", idem: "plot-1" }, T);
    recordReading(db, { venueId: "land-wallet", valueCents: 80_000, source: "reader" }, T);
    expect(bookSummary(db, "company", T).treasuryCents).toBe(0);
    expect(bookSummary(db, "land", T).incomeCents).toBe(80_000);
    expect(detectMilestones(db, T)).toEqual([]);
  });

  it("records one line for one idem and refuses numbers that look like an account", () => {
    const db = seeded();
    const line = { bookId: "company", kind: "income", cents: 5_000, category: "art", idem: "sale-1" };
    expect(addEntry(db, line, T).added).toBe(true);
    expect(addEntry(db, line, T).added).toBe(false);
    expect(bookSummary(db, "company", T).incomeCents).toBe(5_000);
    expect(() => addEntry(db, { ...line, idem: "sale-2", memo: "acct 1234 5678 9012" }, T)).toThrow("ECON_NUMBER_REFUSED");
    expect(() => addVenue(db, { id: "x1", bookId: "company", name: "UID 123456789", kind: "exchange" }, T)).toThrow("ECON_NUMBER_REFUSED");
    expect(() => addEntry(db, { ...line, idem: "sale-3", cents: -5 }, T)).toThrow("ECON_AMOUNT");
    expect(() => addEntry(db, { ...line, idem: "sale-4", bookId: "other" }, T)).toThrow("ECON_BOOK");
  });

  it("spends from the bucket named and shows a bucket that was overspent", () => {
    const db = seeded();
    addEntry(db, { bookId: "company", kind: "income", cents: 10_000, category: "art", idem: "inc-1" }, T);
    addEntry(db, { bookId: "company", kind: "expense", cents: 1_500, category: "hosting", idem: "exp-a" }, T);
    addEntry(db, { bookId: "company", kind: "expense", cents: 2_000, category: "storage", bucket: "hardware", idem: "exp-b" }, T);
    expect(bookSummary(db, "company", T).buckets).toEqual({ reserve: 6_500, hardware: 500, operations: -500 });
  });

  it("files a milestone once, keeps it when the treasury falls, and opens nothing until the owner decides", () => {
    const db = seeded();
    recordReading(db, { venueId: "main-exchange", valueCents: 120_000, source: "reader" }, T);
    expect(detectMilestones(db, T)).toEqual([50_000, 100_000]);
    expect(detectMilestones(db, T + 1)).toEqual([]);
    recordReading(db, { venueId: "main-exchange", valueCents: 10_000, source: "reader" }, T + 2);
    expect(detectMilestones(db, T + 3)).toEqual([]);
    expect(milestones(db).slice(0, 3).map((row) => row.status)).toEqual(["reached", "reached", "ahead"]);
    expect(decideMilestone(db, 250_000, "approved", T + 4)).toBe(false);
    expect(decideMilestone(db, 50_000, "approved", T + 4, "Open the print shop.")).toBe(true);
    expect(decideMilestone(db, 50_000, "declined", T + 5)).toBe(false);
    expect(milestones(db)[0]).toMatchObject({ status: "approved", unlock: "Open the print shop." });
  });

  it("shows totals by kind of venue on the proof panel and no names, ids or memos", () => {
    const db = seeded();
    addEntry(db, { bookId: "company", kind: "income", cents: 9_000, category: "art", memo: "private memo", idem: "inc-9" }, T);
    recordReading(db, { venueId: "main-exchange", valueCents: 9_000, source: "reader", note: "private note" }, T);
    const text = JSON.stringify(proof(db, T));
    expect(text).toContain("\"exchange\"");
    for (const hidden of ["main-exchange", "Main exchange", "private memo", "private note"]) expect(text).not.toContain(hidden);
    expect(proof(db, T).milestones).toHaveLength(11);
  });
});
