import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/db";
import { addEntry, addVenue, decideMilestone, detectMilestones, recordReading } from "../src/economy/economy";
import { BASE_CAPS, brakes, checkBrakes, clearBrake, currentCaps, ladderAutoCap, liveTradeAllowed } from "../src/economy/ladder";

const T = 1_800_000_000_000;

function withTreasury(dollars: number) {
  const db = openDatabase();
  addVenue(db, { id: "float", bookId: "company", name: "Trading float", kind: "exchange" }, T);
  addVenue(db, { id: "cold", bookId: "company", name: "Cold reserve", kind: "wallet" }, T);
  recordReading(db, { venueId: "float", valueCents: dollars * 100, source: "reader" }, T);
  detectMilestones(db, T);
  return db;
}

describe("ladder and brakes", () => {
  it("grants nothing for a milestone that was reached but not approved", () => {
    const db = withTreasury(6_000);
    expect(currentCaps(db)).toEqual(BASE_CAPS);
    expect(liveTradeAllowed(db, 100)).toEqual({ ok: false, reason: "LADDER" });
    expect(ladderAutoCap(db, 5_000)).toBeNull();
  });

  it("opens what the highest approved milestone grants, and a declined one grants nothing", () => {
    const db = withTreasury(6_000);
    decideMilestone(db, 100_000, "approved", T);
    expect(currentCaps(db).selfSpendCents).toBe(1_000);
    expect(currentCaps(db).trading).toBe("off");
    decideMilestone(db, 250_000, "approved", T);
    expect(currentCaps(db).trading).toBe("paper");
    expect(liveTradeAllowed(db, 100)).toEqual({ ok: false, reason: "LADDER" });
    decideMilestone(db, 500_000, "declined", T);
    expect(currentCaps(db).trading).toBe("paper");
  });

  it("caps a live trade at the size the ladder grants", () => {
    const db = withTreasury(6_000);
    for (const threshold of [50_000, 100_000, 250_000, 500_000]) decideMilestone(db, threshold, "approved", T);
    expect(liveTradeAllowed(db, 5_000)).toEqual({ ok: true });
    expect(liveTradeAllowed(db, 5_001)).toEqual({ ok: false, reason: "LADDER_CAP" });
  });

  it("lets a setting tighten the self-approve cap and never widen it", () => {
    const db = withTreasury(1_200);
    decideMilestone(db, 100_000, "approved", T);
    expect(ladderAutoCap(db, 400)).toBe(400);
    expect(ladderAutoCap(db, 50_000)).toBe(1_000);
    expect(ladderAutoCap(db, null)).toBeNull();
  });

  it("trips a venue brake at 20 percent below its high, stops live trading, and holds until the owner releases it", () => {
    const db = withTreasury(6_000);
    for (const threshold of [50_000, 100_000, 250_000, 500_000]) decideMilestone(db, threshold, "approved", T);
    expect(checkBrakes(db, T)).toEqual([]);
    recordReading(db, { venueId: "float", valueCents: 500_000, source: "reader" }, T + 1);
    expect(checkBrakes(db, T + 1)).toEqual([]);
    recordReading(db, { venueId: "float", valueCents: 470_000, source: "reader" }, T + 2);
    const tripped = checkBrakes(db, T + 2);
    expect(tripped.map((brake) => brake.scope)).toEqual(["venue:float"]);
    expect(liveTradeAllowed(db, 100)).toEqual({ ok: false, reason: "BRAKE" });
    recordReading(db, { venueId: "float", valueCents: 600_000, source: "reader" }, T + 3);
    expect(checkBrakes(db, T + 3)).toEqual([]);
    expect(liveTradeAllowed(db, 100)).toEqual({ ok: false, reason: "BRAKE" });
    expect(clearBrake(db, "venue:float", T + 4)).toBe(true);
    expect(brakes(db)).toEqual([]);
    expect(liveTradeAllowed(db, 100)).toEqual({ ok: true });
    expect(clearBrake(db, "venue:float", T + 5)).toBe(false);
  });

  it("does not read an owner withdrawal that is in the books as a loss, and does not judge a cold wallet as a trading venue", () => {
    const db = withTreasury(10_000);
    recordReading(db, { venueId: "cold", valueCents: 2_000_000, source: "reader" }, T);
    expect(checkBrakes(db, T)).toEqual([]);
    addEntry(db, { bookId: "company", kind: "withdrawal", cents: 500_000, category: "owner", idem: "wd-1" }, T + 1);
    recordReading(db, { venueId: "cold", valueCents: 1_500_000, source: "reader" }, T + 1);
    expect(checkBrakes(db, T + 1)).toEqual([]);
    recordReading(db, { venueId: "cold", valueCents: 400_000, source: "reader" }, T + 2);
    expect(checkBrakes(db, T + 2).map((brake) => brake.scope)).toEqual(["book:company"]);
  });
});
