import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/db";
import { claimRadius } from "../src/world/chunkEdits";
import { CHUNK_COORD_LIMIT, CHUNK_WORLD } from "../src/world/chunkMath";
import { CHUNKS_PER_DAY, claimChunk, ensureLand, frontier, grantPlot, growAround, herReaches, holderAt, inLane, isHers, landDesk, plotAllowed, ringFree } from "../src/world/land";
import { expandClaim, setTerritoryFrozen } from "../src/world/territory";
import { CLAIM_BUFFER, CLAIM_START_RADIUS } from "../src/world/territoryRules";
import { raise } from "../src/forge/store";

const T = Date.now();
const R = CLAIM_START_RADIUS;
const EDGE = R + CLAIM_BUFFER;

describe("she is never boxed in", () => {
  it("her four lanes can never be sold, however far out", () => {
    const db = openDatabase();
    for (const [cx, cy] of [[EDGE + 1, 0], [EDGE + 1, 1], [-500, -1], [0, 3000], [1, -CHUNK_COORD_LIMIT], [CHUNK_COORD_LIMIT, 0]] as const) {
      expect(inLane(cx, cy)).toBe(true);
      expect(plotAllowed(db, cx, cy)).toEqual({ ok: false, reason: "LANE" });
      expect(grantPlot(db, cx, cy, "agent-one", T)).toEqual({ ok: false, reason: "LANE" });
    }
    expect(inLane(2, 2)).toBe(false);
  });

  it("nobody may hold her land or the buffer around it", () => {
    const db = openDatabase();
    expect(plotAllowed(db, 5, 5)).toEqual({ ok: false, reason: "HERS" });
    expect(plotAllowed(db, EDGE, 5)).toEqual({ ok: false, reason: "BUFFER" });
    expect(plotAllowed(db, EDGE + 1, 5)).toEqual({ ok: true });
    expect(grantPlot(db, EDGE + 1, 5, "agent-one", T)).toEqual({ ok: true });
    expect(holderAt(db, EDGE + 1, 5)).toBe("agent-one");
    expect(grantPlot(db, EDGE + 1, 5, "agent-two", T)).toEqual({ ok: false, reason: "HELD" });
    expect(grantPlot(db, EDGE + 2, 5, "zoora", T)).toEqual({ ok: false, reason: "HOLDER" });
    expect(grantPlot(db, EDGE + 2, 5, "Bad Name!", T)).toEqual({ ok: false, reason: "HOLDER" });
    expect(grantPlot(db, CHUNK_COORD_LIMIT + 1, 5, "agent-one", T)).toEqual({ ok: false, reason: "EDGE" });
  });

  it("sell every chunk that can be sold around her and she still has land to claim, all the way out", () => {
    const db = openDatabase();
    const span = EDGE + 14;
    let sold = 0;
    for (let cx = -span; cx <= span; cx += 1) for (let cy = -span; cy <= span; cy += 1) if (grantPlot(db, cx, cy, "agent-one", T).ok) sold += 1;
    expect(sold).toBeGreaterThan(1_000);
    // Every lane chunk in that whole block is still free.
    for (let k = R + 1; k <= span; k += 1) for (const [cx, cy] of [[k, 0], [-k, 1], [0, k], [-1, -k]] as const) expect(holderAt(db, cx, cy)).toBeNull();
    expect(landDesk(db, T).canGrow).toBe(true);
    // She walks a lane outward one chunk at a time, right past everything that was sold on both sides.
    for (let k = R + 1; k <= span + 3; k += 1) {
      const day = T + Math.floor((k - R) / CHUNKS_PER_DAY) * 2 * 86_400_000;
      expect(claimChunk(db, k, 0, day)).toEqual({ ok: true, cx: k, cy: 0 });
    }
    expect(holderAt(db, EDGE + 2, 2)).toBe("agent-one");
    expect(herReaches(db)).toHaveLength(span + 3 - R);
    // Left to choose for herself, she takes the nearest free chunk that touches her land.
    const step = growAround(db, T + 90 * 86_400_000);
    expect(step.ok).toBe(true);
    if (step.ok) expect(Math.max(Math.abs(step.cx), Math.abs(step.cy))).toBe(R + 1);
    expect(frontier(db).length).toBeGreaterThan(0);
  });
});

describe("she can always grow", () => {
  it("takes the whole ring when it is free, and is refused the ring when someone holds land in it", () => {
    const db = openDatabase();
    expect(ringFree(db, R + 1)).toBe(true);
    const grown = expandClaim(db, "Zoora grew the claim by 1 chunk while she felt pride.", 1, Date.now());
    expect(grown).toMatchObject({ ok: true, radius: R + 1 });
    // A plot that was already standing in the next ring. (The gate would not allow one this close today.)
    ensureLand(db);
    db.prepare("INSERT INTO land_plots(cx, cy, holder, at_ms) VALUES(?, ?, 'agent-old', ?)").run(R + 2, 7, T);
    expect(ringFree(db, R + 2)).toBe(false);
    expect(expandClaim(db, "Zoora grew the claim by 1 chunk while she felt pride.", 1, Date.now())).toEqual({ ok: false, reason: "HELD" });
    expect(claimRadius(db)).toBe(R + 1);
    // She is not stuck: she takes a free chunk that touches her land instead.
    const step = growAround(db, T);
    expect(step.ok).toBe(true);
    if (step.ok) {
      expect(isHers(db, step.cx, step.cy)).toBe(true);
      expect(Math.max(Math.abs(step.cx), Math.abs(step.cy))).toBe(R + 2);
    }
    expect(holderAt(db, R + 2, 7)).toBe("agent-old");
  });

  it("a chunk she claims must be free and must touch her land", () => {
    const db = openDatabase();
    expect(claimChunk(db, R + 5, 0, T)).toEqual({ ok: false, reason: "NOT_TOUCHING" });
    expect(claimChunk(db, 3, 3, T)).toEqual({ ok: false, reason: "NOT_FREE" });
    grantPlot(db, EDGE + 1, 5, "agent-one", T);
    expect(claimChunk(db, EDGE + 1, 5, T)).toEqual({ ok: false, reason: "NOT_FREE" });
    expect(claimChunk(db, R + 1, 4, T)).toEqual({ ok: true, cx: R + 1, cy: 4 });
    expect(claimChunk(db, R + 2, 4, T)).toEqual({ ok: true, cx: R + 2, cy: 4 });
    expect(claimChunk(db, R + 2, 4, T)).toEqual({ ok: false, reason: "NOT_FREE" });
    // The buffer moves out with her: nobody may now settle beside the new chunk.
    expect(plotAllowed(db, R + 2 + CLAIM_BUFFER, 4)).toEqual({ ok: false, reason: "BUFFER" });
    expect(plotAllowed(db, R + 3 + CLAIM_BUFFER, 4)).toEqual({ ok: true });
  });

  it("is held to a day's worth, and to the owner's freeze", () => {
    const db = openDatabase();
    for (let k = 0; k < CHUNKS_PER_DAY; k += 1) expect(growAround(db, T).ok).toBe(true);
    expect(growAround(db, T)).toEqual({ ok: false, reason: "DAY" });
    expect(growAround(db, T + 2 * 86_400_000).ok).toBe(true);
    setTerritoryFrozen(db, true);
    expect(growAround(db, T + 4 * 86_400_000)).toEqual({ ok: false, reason: "FROZEN" });
  });

  it("she may only lay land on chunks she holds", () => {
    const db = openDatabase();
    const land = { name: "Edge Land", parts: [{ op: "ground", width: 40, slab: 4 }] };
    expect(() => raise(db, land, { x: (R + 1) * CHUNK_WORLD, z: 0, turn: 0 }, T, "owner")).toThrow("FORGE_NOT_HER_LAND");
    expect(isHers(db, R, 0)).toBe(true);
  });
});
