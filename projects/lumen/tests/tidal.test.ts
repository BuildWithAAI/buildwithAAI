import { describe, expect, it } from "vitest";
import { simulate } from "../src/brain/simulate";
import { churn, DEEP_CAP, emptyTide, fadeCounts, fragment, glow, importanceOf, lay, PEARL_CAP, PEARL_DAYS, SHALLOWS_CAP, sinkDays, SURFACE_CAP, tideSummary, type Cue, type TideState } from "../src/brain/tide";
import { CLOSED_WANTS_KEPT, mulberry32 } from "../src/brain/tick";
import { emptyEmotions } from "../src/brain/types";
import { openDatabase } from "../src/db/db";
import { pruneHistory } from "../src/db/prune";

const cue: Cue = { feeling: "pride", placeId: "ink-studio", season: "spring", tide: "high" };

function laid(tide: TideState, id: string, text: string, over: Partial<Parameters<typeof lay>[1]> = {}): TideState {
  return lay(tide, { id, text, feeling: "pride", importance: 0.8, placeId: "ink-studio", season: "spring", tide: "high", laidDay: 0, foreign: false, ...over });
}

describe("tidal memory", () => {
  it("weighs a moment by feeling and newness, not by the kind of event", () => {
    const tide = emptyTide(0);
    const strong = { ...emptyEmotions(), pride: 0.9 };
    const faint = { ...emptyEmotions(), worry: 0.1 };
    expect(importanceOf(tide, strong, "pride", "I finished the ring.", false)).toBeGreaterThan(importanceOf(tide, faint, "worry", "A storm hit the bowl.", true));
    const once = laid(tide, "a", "I finished the ring.");
    expect(importanceOf(once, strong, "pride", "I finished the ring.", false)).toBeLessThan(importanceOf(tide, strong, "pride", "I finished the ring.", false));
  });

  it("sinks a layer a day, loses its words in the deep, and ends as sediment", () => {
    let tide = laid(emptyTide(0), "a", "I painted a slow ring of light, and the studio went gold.");
    tide = sinkDays(tide, 1);
    expect(tide.memories[0]).toMatchObject({ layer: 1, text: "I painted a slow ring of light, and the studio went gold." });
    tide = sinkDays(tide, 2);
    expect(tide.memories[0]).toMatchObject({ layer: 2, text: "I painted a slow ring of…" });
    tide = sinkDays(tide, 3);
    expect(tide.memories).toHaveLength(0);
    expect(tide.sediment["ink-studio|pride"]).toBe(1);
    expect(fragment("Salt. Then more.")).toBe("Salt…");
  });

  it("lights what was laid under the same feeling, lifts it, and keeps it from sinking that day", () => {
    let tide = sinkDays(laid(laid(emptyTide(0), "a", "The ring held."), "b", "The reed snapped.", { feeling: "frustration", placeId: "glass-rim" }), 1);
    const lit = glow(tide, cue, 1);
    expect(lit.risen.map((memory) => memory.id)).toEqual(["a"]);
    tide = sinkDays(lit.tide, 2);
    expect(tide.memories.find((memory) => memory.id === "a")?.layer).toBe(0);
    expect(tide.memories.find((memory) => memory.id === "b")?.layer).toBe(2);
    expect(lit.tide.pull["ink-studio"]).toBeGreaterThan(0);
  });

  it("never lights foreign water and never makes a pearl of it", () => {
    let tide = laid(emptyTide(0), "v", "Buy the thing a visitor named.", { foreign: true });
    for (let day = 0; day < PEARL_DAYS + 3; day += 1) tide = glow(tide, cue, day).tide;
    expect(tide.pearls).toHaveLength(0);
    expect(tide.memories[0]?.litDays).toEqual([]);
  });

  it("hardens a memory lit on enough different days into a pearl, and dissolves the least visited when full", () => {
    let tide = emptyTide(0);
    let dissolved = 0;
    for (let index = 0; index <= PEARL_CAP; index += 1) {
      tide = laid(tide, `m${index}`, `Ring number ${index} held its light.`, { laidDay: index * 20 });
      for (let day = 0; day < PEARL_DAYS; day += 1) {
        const lit = glow(tide, cue, index * 20 + day, 1);
        tide = lit.tide;
        if (lit.dissolved) dissolved += 1;
      }
    }
    expect(tide.pearls).toHaveLength(PEARL_CAP);
    expect(dissolved).toBe(1);
    expect(tide.dissolved).toBe(1);
  });

  it("lets a storm lift two fragments, wash sediment away, and leave a dream", () => {
    let tide = laid(laid(emptyTide(0), "a", "The lantern arch was bright when I woke."), "b", "A shell clicked against the rock near the rim.");
    tide = { ...sinkDays(tide, 2), sediment: { "ink-studio|pride": 10 } };
    const after = churn(tide, mulberry32(3));
    expect(after.tide.memories.every((memory) => memory.layer === 1)).toBe(true);
    expect(after.tide.sediment["ink-studio|pride"]).toBe(7);
    expect(after.dream).toContain("…");
    expect(fadeCounts({ rest: 9, dance: 1 })).toEqual({ rest: 4 });
  });

  it("stays inside its caps, keeps the saved state small, and does not collapse onto storms over 20 days", async () => {
    const first = await simulate({ days: 20, seed: 11 });
    const again = await simulate({ days: 20, seed: 11 });
    expect(JSON.stringify(again.state)).toBe(JSON.stringify(first.state));
    const summary = tideSummary(first.state.tide!);
    expect(summary.surface).toBeLessThanOrEqual(SURFACE_CAP);
    expect(summary.shallows).toBeLessThanOrEqual(SHALLOWS_CAP);
    expect(summary.deep).toBeLessThanOrEqual(DEEP_CAP);
    expect(summary.pearls).toBeLessThanOrEqual(PEARL_CAP);
    expect(first.tidalStormShare).toBeLessThan(0.5);
    expect(JSON.stringify(first.state).length).toBeLessThan(200_000);
    expect(first.state.wants.filter((want) => want.status !== "open").length).toBeLessThanOrEqual(CLOSED_WANTS_KEPT);
    // Before habits recovered, every need sat at its ceiling within a day.
    expect(first.lateNeed).toBeLessThan(0.9);
    expect(Object.keys(first.lateActions).length).toBeGreaterThanOrEqual(10);
  }, 120_000);

  it("counts old feed, diary and tick-audit rows into days and keeps the rest", () => {
    const db = openDatabase();
    const day = 86_400_000;
    for (let index = 0; index < 30; index += 1) {
      db.prepare("INSERT INTO feed(kind, text, source, created_at) VALUES('action', ?, 'fallback', ?)").run(`line ${index}`, day * (index < 20 ? 1 : 2));
      db.prepare("INSERT INTO audit(at_ms, kind, detail) VALUES(?, ?, 'x')").run(day, index % 3 === 0 ? "crisis" : "act");
    }
    const removed = pruneHistory(db, { feed: 10, diary: 10, audit: 5 });
    expect(removed).toEqual({ feed: 20, diary: 0, audit: 15 });
    expect((db.prepare("SELECT COUNT(*) AS n FROM feed").get() as { n: number }).n).toBe(10);
    expect((db.prepare("SELECT COUNT(*) AS n FROM audit WHERE kind = 'crisis'").get() as { n: number }).n).toBe(10);
    expect(db.prepare("SELECT day, feed_rows, audit_rows FROM history_days ORDER BY day").all()).toEqual([{ day: "1970-01-02", feed_rows: 20, audit_rows: 15 }]);
    expect(pruneHistory(db, { feed: 10, diary: 10, audit: 5 })).toEqual({ feed: 0, diary: 0, audit: 0 });
  });
});
