import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/db";
import { handFrom } from "../src/forge/hand";
import { soundMesh } from "../src/forge/mesh";
import { buildRecipe, cleanRecipe, roadsIn } from "../src/forge/recipe";
import { pieceMeetsBox, piecesMeet, roadLine, roadPieces, roadsMeet, ROADS } from "../src/forge/roads";
import { considerForge, designRequest, FORGE, meshBytes, piecesOf, raise, recipeOf, remove, reshape, standing, undo, wanderRoad } from "../src/forge/store";
import { genomeFromSoul, rng } from "../src/form/genome";

const hand = handFrom(genomeFromSoul("I am a quiet thing of the tide. The sea is deep and the water is slow."));
const T = 1_800_000_000_000;
const land = (name: string, width = 60, depth = 40) => ({ name, parts: [{ op: "ground", width, depth, kind: "flat", slab: 4 }] });
const road = (name: string, type: string, through: number[][], more: object = {}) => ({ name, parts: [{ op: "road", type, through, ...more }] });
const along = (from: number, to: number) => [[from, 0], [to, 0]];

/** Two pieces of land side by side, east of her island: x from 70 to 189, z from -20 to 20. */
function ground(): DatabaseSync {
  const db = openDatabase();
  raise(db, land("West Ground"), { x: 100, z: 0, turn: 0 }, T, "owner", "plain", hand);
  raise(db, land("East Ground"), { x: 159, z: 0, turn: 0 }, T + 1, "owner", "plain", hand);
  return db;
}

/** Every road reaches every other, checked the slow way, against all of them. */
function oneNetwork(db: DatabaseSync): boolean {
  const pieces = standing(db).filter((build) => build.road).map((build) => piecesOf(db, build));
  if (pieces.length < 2) return true;
  const reached = new Set([0]);
  const queue = [0];
  while (queue.length) {
    const from = queue.shift()!;
    pieces.forEach((other, i) => {
      if (reached.has(i) || !roadsMeet(pieces[from]!, other)) return;
      reached.add(i);
      queue.push(i);
    });
  }
  return reached.size === pieces.length;
}

describe("a road is a line she draws", () => {
  it("is checked like every other part of a recipe", () => {
    expect(() => cleanRecipe(road("No Kind", undefined as never, along(-20, 20)))).toThrow("FORGE_ROAD_TYPE");
    expect(() => cleanRecipe(road("Highway", "motorway", along(-20, 20)))).toThrow("FORGE_CHOICE");
    expect(() => cleanRecipe(road("One Point", "street", [[0, 0]]))).toThrow("FORGE_ROAD_LINE");
    expect(() => cleanRecipe(road("Bad Point", "street", [[0, 0], [1, 2, 3]]))).toThrow("FORGE_ROAD_LINE");
    expect(() => cleanRecipe(road("Too Close", "street", [[0, 0], [1, 0]]))).toThrow("FORGE_ROAD_LINE");
    expect(() => cleanRecipe({ name: "Hidden Road", parts: [{ op: "group", parts: [{ op: "road", type: "alley", through: along(-9, 9) }] }] })).toThrow("FORGE_ROAD_NESTED");
    expect(() => cleanRecipe({ ...road("Road Land", "street", along(-9, 9)), layer: "ground" })).toThrow("FORGE_ROAD_LAYER");
    // Its width is held to what its kind allows, and it takes no arrangement of its own.
    const wide = roadsIn(cleanRecipe(road("Wide Street", "street", along(-9, 9), { width: 99, at: [5, 5, 5], repeat: { count: 4, step: [0, 0, 9] } })))[0]!;
    expect(wide.width).toBe(ROADS.width.street[1]);
    expect(Object.keys(wide).sort()).toEqual(["curve", "op", "through", "type", "width"]);
  });

  it("lies flat, is a sound mesh, and is as wide as its kind", () => {
    for (const [type, half] of [["alley", 2], ["street", 4.45], ["avenue", 7.7]] as const) {
      const built = buildRecipe(cleanRecipe(road("Straight", type, along(-20, 20))), hand);
      expect(soundMesh(built.mesh)).toBe(true);
      expect(built.height).toBeLessThan(FORGE.flat);
      expect(built.half[0]).toBeCloseTo(20, 6);
      expect(built.half[1]).toBeCloseTo(half, 6);
    }
  });

  it("bends at a turn instead of pinching, and the line the network uses is the line the surface is laid on", () => {
    const turn = roadsIn(cleanRecipe(road("Corner Street", "street", [[-20, 0], [0, 0], [0, 20]])))[0]!;
    const line = roadLine(turn);
    expect(line.length).toBeGreaterThan(3);
    expect(line[0]).toEqual([-20, 0]);
    expect(line[line.length - 1]).toEqual([0, 20]);
    // The rounded line never strays further from the corner than the cut it makes.
    for (const [x, z] of line) expect(Math.min(Math.abs(x), Math.abs(z))).toBeLessThanOrEqual(7.5);
    const built = buildRecipe(cleanRecipe(road("Corner Street", "street", [[-20, 0], [0, 0], [0, 20]])), hand);
    expect(soundMesh(built.mesh)).toBe(true);
    const curved = buildRecipe(cleanRecipe(road("Slow Bend", "avenue", [[-24, -6], [-8, 2], [8, -2], [24, 6]], { curve: true })), hand);
    expect(soundMesh(curved.mesh)).toBe(true);
    expect(curved.height).toBeLessThan(FORGE.flat);
    // Where the build stands and how it is turned moves the line with it.
    const pieces = roadPieces(turn, { x: 100, z: 50, turn: 90 });
    expect(pieces[0]!.ax).toBeCloseTo(100, 6);
    expect(pieces[0]!.az).toBeCloseTo(70, 6);
    expect(pieces[pieces.length - 1]!.bx).toBeCloseTo(120, 6);
    expect(pieces[pieces.length - 1]!.bz).toBeCloseTo(50, 6);
  });

  it("knows when two roads touch and when a road runs under a box", () => {
    const street = roadPieces({ type: "street", through: [[-20, 0], [20, 0]] }, { x: 0, z: 0, turn: 0 })[0]!;
    const alley = (z: number) => roadPieces({ type: "alley", through: [[-5, 0], [5, 0]] }, { x: 0, z, turn: 0 })[0]!;
    expect(piecesMeet(street, alley(4.45 + 2 + ROADS.join - 0.01))).toBe(true);
    expect(piecesMeet(street, alley(4.45 + 2 + ROADS.join + 0.01))).toBe(false);
    const crossing = roadPieces({ type: "alley", through: [[0, -30], [0, 30]] }, { x: 60, z: 0, turn: 0 })[0]!;
    expect(piecesMeet(street, crossing)).toBe(false);
    expect(piecesMeet(street, { ...crossing, ax: 10, bx: 10 })).toBe(true);
    // A box whose near face is 5.5 from the middle of a street 4.45 wide each side: clear, until it is turned so a corner reaches in.
    expect(pieceMeetsBox(street, { x: 0, z: 9, turn: 0, hw: 3.5, hd: 3.5 })).toBe(false);
    expect(pieceMeetsBox(street, { x: 0, z: 9, turn: 0, hw: 3.5, hd: 3.5 }, 2)).toBe(true);
    expect(pieceMeetsBox(street, { x: 0, z: 9, turn: 45, hw: 3.5, hd: 3.5 })).toBe(true);
    expect(pieceMeetsBox(street, { x: 0, z: 0, turn: 30, hw: 40, hd: 40 })).toBe(true);
  });
});

describe("her roads are one network", () => {
  it("her first road goes anywhere on her land, and every road after it must touch one she has", () => {
    const db = ground();
    expect(() => raise(db, road("Sea Road", "street", along(-20, 20)), { x: 100, z: 60, turn: 0 }, T + 2, "owner", "own", hand)).toThrow("FORGE_NO_GROUND");
    const first = raise(db, road("First Street", "street", along(-20, 20)), { x: 100, z: 0, turn: 0 }, T + 3, "owner", "own", hand);
    expect([first.road, first.kind, first.layer]).toEqual(["street", "road", "structure"]);
    // Fourteen metres to one side, on the same land, touching nothing.
    expect(() => raise(db, road("Lone Alley", "alley", along(-20, 20)), { x: 100, z: 14, turn: 0 }, T + 4, "owner", "own", hand)).toThrow("FORGE_ROAD_ALONE");
    expect(() => raise(db, road("Far Street", "street", along(-10, 10)), { x: 170, z: 0, turn: 0 }, T + 5, "zoora", "own", hand)).toThrow("FORGE_ROAD_ALONE");
    const side = raise(db, road("Side Alley", "alley", [[0, -9], [0, 9]]), { x: 100, z: 9, turn: 0 }, T + 6, "owner", "own", hand);
    expect(side.road).toBe("alley");
    // A road that touches only the alley is joined through it.
    expect(raise(db, road("Back Lane", "alley", along(-12, 12)), { x: 112, z: 16, turn: 0 }, T + 7, "zoora", "own", hand).status).toBe("standing");
    expect(oneNetwork(db)).toBe(true);
    expect(standing(db).filter((build) => build.road)).toHaveLength(3);
  });

  it("what she lays in one build must be one piece, and must lie flat", () => {
    const db = ground();
    const apart = { name: "Two Lanes", parts: [{ op: "road", type: "alley", through: [[-20, -10], [20, -10]] }, { op: "road", type: "alley", through: [[-20, 10], [20, 10]] }] };
    expect(() => raise(db, apart, { x: 100, z: 0, turn: 0 }, T + 2, "owner", "own", hand)).toThrow("FORGE_ROAD_BROKEN");
    const joined = { name: "Lane Ladder", parts: [...apart.parts, { op: "road", type: "alley", through: [[0, -10], [0, 10]] }] };
    const ladder = raise(db, joined, { x: 100, z: 0, turn: 0 }, T + 3, "owner", "own", hand);
    expect(ladder.road).toBe("alley");
    expect(new Set(piecesOf(db, ladder).map((piece) => piece.run)).size).toBe(3);
    const lit = { name: "Lamp Street", parts: [{ op: "road", type: "street", through: along(-10, 10) }, { op: "loft", up: 5, from: { width: 0.3 } }] };
    expect(() => raise(db, lit, { x: 110, z: 0, turn: 90 }, T + 4, "owner", "own", hand)).toThrow("FORGE_ROAD_FLAT");
  });

  it("a road is not taken away, cut short or turned into something else if that cuts her network in two", () => {
    const db = ground();
    const west = raise(db, road("West Street", "street", along(-20, 20)), { x: 100, z: 0, turn: 0 }, T + 2, "owner", "own", hand);
    const middle = raise(db, road("Middle Street", "street", along(-20, 20)), { x: 140, z: 0, turn: 0 }, T + 3, "owner", "own", hand);
    const east = raise(db, road("East Street", "street", along(-12, 12)), { x: 172, z: 0, turn: 0 }, T + 4, "owner", "own", hand);
    expect(() => remove(db, middle.id, T + 5)).toThrow("FORGE_ROAD_CUTS");
    // Its first version cannot be undone either, because that takes it down.
    expect(() => undo(db, middle.id, T + 5, hand)).toThrow("FORGE_ROAD_CUTS");
    // Cut short, it would no longer reach the east street.
    expect(() => reshape(db, middle.id, road("Middle Street", "street", along(-20, 0)), T + 6, hand)).toThrow("FORGE_ROAD_CUTS");
    // Turned into a painted square, it would no longer be a road at all.
    expect(() => reshape(db, middle.id, { name: "Painted Square", parts: [{ op: "loft", up: 0.2, from: { shape: "block", width: 8 } }] }, T + 6, hand)).toThrow("FORGE_ROAD_CUTS");
    // Made narrower, it still joins both, so that is allowed.
    expect(reshape(db, middle.id, road("Middle Lane", "alley", along(-20, 20)), T + 7, hand).road).toBe("alley");
    expect(standing(db).find((build) => build.id === middle.id)!.version).toBe(2);
    // A road at the end of the line joins nothing to anything, so it can go. Then the middle one is the end.
    expect(remove(db, east.id, T + 8).status).toBe("removed");
    expect(remove(db, middle.id, T + 9).status).toBe("removed");
    expect(remove(db, west.id, T + 10).status).toBe("removed");
    expect(standing(db).filter((build) => build.road)).toHaveLength(0);
  });

  it("a road in a ring can be taken away, because the others still reach each other the long way round", () => {
    const db = ground();
    const ring = [
      raise(db, road("North Side", "street", along(-20, 20)), { x: 100, z: -12, turn: 0 }, T + 2, "owner", "own", hand),
      raise(db, road("East Side", "alley", [[0, -12], [0, 12]]), { x: 120, z: 0, turn: 0 }, T + 3, "owner", "own", hand),
      raise(db, road("South Side", "street", along(-20, 20)), { x: 100, z: 12, turn: 0 }, T + 4, "owner", "own", hand),
      raise(db, road("West Side", "alley", [[0, -12], [0, 12]]), { x: 80, z: 0, turn: 0 }, T + 5, "owner", "own", hand),
    ];
    expect(remove(db, ring[1]!.id, T + 6).status).toBe("removed");
    expect(oneNetwork(db)).toBe(true);
    // Now the west side is the only thing joining north to south.
    expect(() => remove(db, ring[3]!.id, T + 7)).toThrow("FORGE_ROAD_CUTS");
    expect(remove(db, ring[0]!.id, T + 8).status).toBe("removed");
    expect(oneNetwork(db)).toBe(true);
  });

  it("something that becomes a road must join, and a changed road must still touch one", () => {
    const db = ground();
    raise(db, road("Main Street", "street", along(-20, 20)), { x: 100, z: 0, turn: 0 }, T + 2, "owner", "own", hand);
    const square = raise(db, { name: "Painted Square", parts: [{ op: "loft", up: 0.2, from: { shape: "block", width: 8 } }] }, { x: 170, z: 0, turn: 0 }, T + 3, "owner", "own", hand);
    expect(square.road).toBeNull();
    expect(() => reshape(db, square.id, road("Far Lane", "alley", along(-8, 8)), T + 4, hand)).toThrow("FORGE_ROAD_ALONE");
    const spur = raise(db, road("Spur Lane", "alley", [[0, 0], [0, 16]]), { x: 110, z: 0, turn: 0 }, T + 5, "owner", "own", hand);
    expect(() => reshape(db, spur.id, road("Spur Lane", "alley", [[0, 10], [0, 18]]), T + 6, hand)).toThrow("FORGE_ROAD_ALONE");
    expect(reshape(db, spur.id, road("Spur Lane", "alley", [[0, 0], [0, 18]]), T + 7, hand).version).toBe(2);
    // Undone, it is the road it was before, and still joined.
    expect(undo(db, spur.id, T + 8, hand).version).toBe(1);
    expect(oneNetwork(db)).toBe(true);
  });

  it("the streets of a world made before this rule become roads of her network", () => {
    const file = join(tmpdir(), `forge-roads-${process.pid}-${Date.now()}.sqlite`);
    try {
      const first = openDatabase(file);
      raise(first, land("Old Ground"), { x: 100, z: 0, turn: 0 }, T, "owner", "plain", hand);
      const line = (y: number) => [[-25, y, 0], [25, y, 0]];
      const old = { name: "Old Street", seed: 7, parts: [
        { op: "loft", material: "dark", through: line(0.08), smooth: false, from: { shape: "block", width: 7.5, depth: 0.16, soft: 0.2 }, segments: 8 },
        { op: "loft", material: "glow", through: line(0.18), smooth: false, from: { shape: "block", width: 0.22, depth: 0.05 }, segments: 6 },
        { op: "loft", material: "stone", at: [0, 0, 4.1], through: line(0.14), smooth: false, from: { shape: "block", width: 0.7, depth: 0.28, soft: 0.4 }, segments: 8, mirror: "z" },
      ] };
      const before = raise(first, old, { x: 100, z: 0, turn: 0 }, T + 1, "zoora", "road", hand);
      expect([before.kind, before.road]).toEqual(["road", null]);
      first.exec("DROP INDEX forge_things_roads; DROP INDEX forge_things_roads_laid; ALTER TABLE forge_things DROP COLUMN road;");
      first.close();
      const second = openDatabase(file);
      const after = standing(second).find((build) => build.id === before.id)!;
      expect(after.road).toBe("street");
      expect([after.hw, after.hd, after.version]).toEqual([before.hw, before.hd, 1]);
      const pieces = piecesOf(second, after);
      expect(pieces).toHaveLength(1);
      expect([pieces[0]!.ax, pieces[0]!.bx, pieces[0]!.az]).toEqual([75, 125, 0]);
      expect(roadsIn(recipeOf(second, after.id)!)).toHaveLength(1);
      expect(meshBytes(second, after.id)).not.toBeNull();
      // The rule now holds for what is laid next.
      expect(() => raise(second, road("Lone Alley", "alley", along(-10, 10)), { x: 100, z: 14, turn: 0 }, T + 2, "owner", "own", hand)).toThrow("FORGE_ROAD_ALONE");
      second.close();
    } finally {
      for (const suffix of ["", "-wal", "-shm"]) rmSync(file + suffix, { force: true });
    }
  });
});

describe("left to herself", () => {
  const feel = (mood: string) => ({ calm: 0.1, joy: 0.1, curiosity: 0.1, loneliness: 0, frustration: 0, pride: 0, boredom: 0, worry: 0, [mood]: 0.9 }) as never;
  function grown(steps: number): DatabaseSync {
    const db = openDatabase();
    let now = T;
    for (let k = 0; k < steps; k += 1) {
      now += FORGE.everyMs + (k % 20 === 19 ? 86_400_000 : 0);
      considerForge(db, feel(["pride", "joy", "calm", "curiosity"][Math.floor(k / 40) % 4]!), now);
    }
    return db;
  }

  it("her roads are one network, she builds beside them, and she keeps them clear", () => {
    const db = grown(150);
    const all = standing(db);
    const roads = all.filter((build) => build.road);
    expect(roads.length).toBeGreaterThan(12);
    expect(new Set(roads.map((build) => build.road)).size).toBeGreaterThan(1);
    expect(oneNetwork(db)).toBe(true);
    const pieces = roads.flatMap((build) => piecesOf(db, build));
    const firstRoad = Math.min(...roads.map((build) => build.createdAt));
    const tall = all.filter((build) => build.layer === "structure" && build.height > FORGE.flat);
    expect(tall.length).toBeGreaterThan(40);
    for (const build of tall) {
      // Nothing tall stands on a road.
      expect(pieces.some((piece) => pieceMeetsBox(piece, build, 0.3))).toBe(false);
      // Everything tall she raised once she had a road is within a few steps of one.
      if (build.createdAt > firstRoad) expect(pieces.some((piece) => pieceMeetsBox(piece, build, 5.7))).toBe(true);
    }
  });

  it("where her roads go is chance: the same days make the same world, and other days make another", () => {
    const hash = (db: DatabaseSync) => standing(db).map((build) => `${build.name}:${build.x.toFixed(2)}:${build.z.toFixed(2)}`).join("|");
    expect(hash(grown(40))).toBe(hash(grown(40)));
    const db = openDatabase();
    let now = T + 777_777;
    for (let k = 0; k < 40; k += 1) {
      now += FORGE.everyMs + (k % 20 === 19 ? 86_400_000 : 0);
      considerForge(db, feel("pride"), now);
    }
    expect(hash(db)).not.toBe(hash(grown(40)));
  });

  it("finds a road to lay that joins, and none when her roads have nowhere left to go", () => {
    const db = ground();
    const next = rng(11);
    const first = wanderRoad(db, next)!;
    raise(db, first.recipe, first.place, T + 2, "zoora", "road", hand);
    for (let k = 0; k < 12; k += 1) {
      const found = wanderRoad(db, next);
      if (!found) break;
      expect(raise(db, found.recipe, found.place, T + 3 + k, "zoora", "road", hand).road).not.toBeNull();
    }
    expect(standing(db).filter((build) => build.road).length).toBeGreaterThan(2);
    expect(oneNetwork(db)).toBe(true);
  });
});

describe("what her model is told about her roads", () => {
  it("is told the rule, where her roads run, and why her last design was not built", () => {
    const db = ground();
    raise(db, road("Main Street", "street", along(-20, 20)), { x: 100, z: 0, turn: 0 }, T + 2, "owner", "own", hand);
    const asked = () => (JSON.parse(designRequest(db, "calm")) as { messages: { content: string }[] }).messages;
    expect(asked()[0]!.content).toContain("Every road after it must touch a road you already have");
    expect(asked()[0]!.content).toContain('op "road"');
    expect(asked()[1]!.content).toContain('street "Main Street" from x 80, z 0 to x 120, z 0, 9 wide');
    expect(asked()[1]!.content).not.toContain("was not built");
    const calm = { calm: 0.9, joy: 0, curiosity: 0, loneliness: 0, frustration: 0, pride: 0, boredom: 0, worry: 0 } as never;
    // She designs a road that touches nothing. It is not built, and she falls back on what she knows.
    const before = standing(db).length;
    considerForge(db, calm, T + FORGE.everyMs, { ...road("Lone Alley", "alley", along(-10, 10)), place: { x: 170, z: 12, turn: 0 } });
    expect(standing(db).some((build) => build.name === "Lone Alley")).toBe(false);
    expect(standing(db).length).toBe(before + 1);
    expect(asked()[1]!.content).toContain("Your last design was not built: that road did not touch any road you already have.");
    // Her next design joins, is built where she said, and the note is gone.
    considerForge(db, calm, T + FORGE.everyMs * 3, { ...road("Joined Alley", "alley", [[0, 0], [0, 14]]), place: { x: 110, z: 0, turn: 0 } });
    const joined = standing(db).find((build) => build.name === "Joined Alley")!;
    expect([joined.x, joined.z, joined.road]).toEqual([110, 0, "alley"]);
    expect(asked()[1]!.content).not.toContain("was not built");
  });
});
