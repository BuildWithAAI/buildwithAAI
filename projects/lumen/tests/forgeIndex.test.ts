import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/db";
import { boxesMeet, considerForge, countStanding, FORGE, near, placeCheck, remove, standing, wander } from "../src/forge/store";
import { rng } from "../src/form/genome";

const proud = { calm: 0.1, joy: 0.1, curiosity: 0.1, loneliness: 0, frustration: 0, pride: 0.9, boredom: 0, worry: 0 } as never;

function world(builds: number) {
  const db = openDatabase();
  let now = 1_800_000_000_000;
  for (let k = 0; k < builds; k += 1) {
    now += FORGE.everyMs + (k % 20 === 19 ? 86_400_000 : 0);
    considerForge(db, proud, now);
  }
  return { db, now };
}

describe("the index of where her builds stand", () => {
  it("holds one entry for every standing build and keeps the counts", () => {
    const { db } = world(60);
    const all = standing(db);
    const indexed = db.prepare("SELECT COUNT(*) AS n FROM forge_index").get() as { n: number };
    expect(Number(indexed.n)).toBe(all.length);
    expect(countStanding(db)).toBe(all.length);
    expect(countStanding(db, "ground")).toBe(all.filter((build) => build.layer === "ground").length);
    expect(countStanding(db, "structure")).toBe(all.filter((build) => build.layer === "structure").length);
  });

  it("finds exactly the builds a full read would find near a box", () => {
    const { db } = world(80);
    const all = standing(db);
    const next = rng(7);
    for (let i = 0; i < 200; i += 1) {
      const box = { x: (next() - 0.5) * 500, z: (next() - 0.5) * 500, turn: next() * 360, hw: 2 + next() * 30, hd: 2 + next() * 30 };
      const found = new Set(near(db, box, 2).map((build) => build.id));
      // Everything that truly meets the box within the widest gap any rule uses must be in the lookup.
      for (const build of all) if (boxesMeet(build, box, 1)) expect(found.has(build.id)).toBe(true);
    }
  });

  it("gives the same answer to a placement check as reading the whole world", () => {
    const { db } = world(80);
    const all = standing(db);
    const next = rng(11);
    for (let i = 0; i < 300; i += 1) {
      const layer = next() < 0.3 ? "ground" : "structure";
      const box = { x: (next() - 0.5) * 420, z: (next() - 0.5) * 420, turn: Math.floor(next() * 4) * 90, hw: 3 + next() * 14, hd: 3 + next() * 14 };
      const height = layer === "ground" ? 0.7 : 4 + next() * 60;
      const fast = placeCheck(db, layer, box, height);
      const full = placeCheck(db, layer, box, height, undefined, all);
      expect(fast.ok).toBe(full.ok);
      if (!fast.ok && !full.ok) expect(fast.reason).toBe(full.reason);
    }
  });

  it("forgets a build that is taken down", () => {
    const { db, now } = world(40);
    const tower = standing(db).find((build) => build.layer === "structure")!;
    const before = countStanding(db);
    remove(db, tower.id, now + 1);
    expect(countStanding(db)).toBe(before - 1);
    expect(near(db, tower, 2).some((build) => build.id === tower.id)).toBe(false);
  });

  it("indexes a world that was made before the index existed", () => {
    const file = join(tmpdir(), `forge-index-${process.pid}-${Date.now()}.sqlite`);
    try {
      const first = openDatabase(file);
      let now = 1_800_000_000_000;
      for (let k = 0; k < 30; k += 1) {
        now += FORGE.everyMs + (k % 20 === 19 ? 86_400_000 : 0);
        considerForge(first, proud, now);
      }
      const count = standing(first).length;
      const tower = standing(first).find((build) => build.layer === "structure")!;
      // As if the world had been written by an engine with no index.
      first.exec("DELETE FROM forge_index; DELETE FROM forge_tally;");
      first.close();
      const again = openDatabase(file);
      expect(countStanding(again)).toBe(count);
      expect(near(again, tower, 0).some((build) => build.id === tower.id)).toBe(true);
      expect(wander(again, "structure", [4, 4], 20, rng(3))).not.toBeUndefined();
      again.close();
    } finally {
      for (const suffix of ["", "-wal", "-shm"]) rmSync(file + suffix, { force: true });
    }
  });
});
