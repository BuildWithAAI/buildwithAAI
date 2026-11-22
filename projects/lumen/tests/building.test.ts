import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/db";
import { BUILDING, buildingMesh, layoutOf, type BuildingSpec } from "../src/forge/building";
import { handFrom } from "../src/forge/hand";
import { compose } from "../src/forge/ideas";
import { MATERIALS, point, soundMesh, type Mesh } from "../src/forge/mesh";
import { buildRecipe, cleanRecipe, LIMITS, plansIn } from "../src/forge/recipe";
import { considerForge, FORGE, piecesOf, plansOf, raise, remove, standing } from "../src/forge/store";
import { genomeFromSoul, rng } from "../src/form/genome";

const hand = handFrom(genomeFromSoul("I am a quiet thing of the tide. The sea is deep and the water is slow."));
const T = 1_800_000_000_000;
const block: BuildingSpec = { outline: { shape: "block", width: 16, depth: 10 }, floors: 5, windows: { every: 3, lit: 0.4 }, door: { width: 2 } };
const built = (spec: BuildingSpec, seed = 3) => buildingMesh(spec, MATERIALS.indexOf("stone"), rng(seed));

/** The triangles of one material, as three points each. */
function faces(mesh: Mesh, material: string): [number[], number[], number[]][] {
  const out: [number[], number[], number[]][] = [];
  for (let t = 0; t < mesh.materials.length; t += 1) if (mesh.materials[t] === MATERIALS.indexOf(material as never)) out.push([point(mesh, mesh.indices[t * 3]!), point(mesh, mesh.indices[t * 3 + 1]!), point(mesh, mesh.indices[t * 3 + 2]!)]);
  return out;
}

/** Whether a level triangle at height `y` covers a spot, seen from above. */
function covers(face: [number[], number[], number[]], x: number, z: number, y: number): boolean {
  if (face.some((p) => Math.abs(p[1]! - y) > 1e-6)) return false;
  const side = (a: number[], b: number[]) => (b[0]! - a[0]!) * (z - a[2]!) - (b[2]! - a[2]!) * (x - a[0]!);
  const [d1, d2, d3] = [side(face[0], face[1]), side(face[1], face[2]), side(face[2], face[0])];
  return (d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0);
}

describe("her building tool", () => {
  it("is checked like every other part of a recipe", () => {
    const part = (more: object) => ({ name: "Test House", parts: [{ op: "building", outline: { width: 10 }, floors: 3, ...more }] });
    expect(() => cleanRecipe({ name: "No Outline", parts: [{ op: "building", floors: 3 }] })).toThrow("FORGE_MISSING");
    expect(() => cleanRecipe({ name: "No Floors", parts: [{ op: "building", outline: { width: 10 } }] })).toThrow("FORGE_MISSING");
    expect(() => cleanRecipe({ name: "Hidden House", parts: [{ op: "group", parts: [{ op: "building", outline: { width: 10 }, floors: 3 }] }] })).toThrow("FORGE_BUILDING_NESTED");
    expect(() => cleanRecipe(part({ roof: "dome" }))).toThrow("FORGE_CHOICE");
    // Numbers are held to a range. It is moved and turned, and takes no other arrangement, so its floors stay level.
    const clean = cleanRecipe(part({ floors: 999, floorHeight: 1, wall: 9, taper: 0.1, tip: 30, roll: 20, size: 3, repeat: { count: 5, step: [9, 0, 0] }, at: [4, 0.5, 2], turn: 90, windows: { every: 0.1, width: 2 }, door: false })).parts[0] as Record<string, unknown>;
    expect([clean.floors, clean.floorHeight, clean.wall, clean.taper, clean.door]).toEqual([BUILDING.floors, 2.6, 1.2, 0.5, false]);
    expect(clean.windows).toMatchObject({ every: 1.2, width: 0.92 });
    expect([clean.at, clean.turn, clean.tip, clean.roll, clean.size, clean.repeat]).toEqual([[4, 0.5, 2], 90, undefined, undefined, undefined, undefined]);
    // However many floors she asks for, the building stays under the height one build may reach.
    const tall = buildRecipe(cleanRecipe(part({ floors: 60, floorHeight: 8 })), hand);
    expect(tall.height).toBeLessThanOrEqual(LIMITS.height);
  });

  it("makes walls with thickness, and every window and the door are holes right through them", () => {
    const plan = layoutOf(block);
    const mesh = built(block);
    expect(soundMesh(mesh)).toBe(true);
    const front = plan.walls[0]!;
    // Four bays on each of five floors, less the two on the ground floor that the door stands across.
    expect(front.openings.filter((o) => !o.door)).toHaveLength(4 * 5 - 2);
    expect(front.openings.filter((o) => o.door)).toHaveLength(1);
    for (const wall of plan.walls) {
      const sorted = [...wall.openings].sort((p, q) => p.y0 - q.y0 || p.m0 - q.m0);
      for (const o of sorted) {
        // An opening lies within the inside face of its wall, so it is cut through both faces.
        expect(o.m0).toBeGreaterThan(wall.in0);
        expect(o.m1).toBeLessThan(wall.in1);
        for (const other of sorted) if (other !== o && other.y0 === o.y0) expect(other.m0 >= o.m1 || other.m1 <= o.m0).toBe(true);
      }
    }
    // The front wall's outside face is at z = 5 and its inside face at z = 4.7. Neither has stone across any opening.
    const stone = faces(mesh, "stone");
    for (const z of [5, 5 - plan.wall]) {
      const face = stone.filter((f) => f.every((p) => Math.abs(p[2]! - z) < 1e-6));
      expect(face.length).toBeGreaterThan(10);
      for (const o of front.openings) {
        const [x, y] = [-8 + (o.m0 + o.m1) / 2, (o.y0 + o.y1) / 2];
        const across = face.some((f) => {
          const side = (a: number[], b: number[]) => (b[0]! - a[0]!) * (y - a[1]!) - (b[1]! - a[1]!) * (x - a[0]!);
          const [d1, d2, d3] = [side(f[0], f[1]), side(f[1], f[2]), side(f[2], f[0])];
          return (d1 > 0 && d2 > 0 && d3 > 0) || (d1 < 0 && d2 < 0 && d3 < 0);
        });
        expect(across).toBe(false);
      }
    }
    // Each window has a pane halfway through the wall, lit or clear, and the share that are lit is the share she asked for, by chance.
    const panes = [...faces(mesh, "glass"), ...faces(mesh, "glow")].filter((f) => f.every((p) => Math.abs(p[2]! - (5 - plan.wall / 2)) < 1e-6));
    expect(panes).toHaveLength(18 * 2);
    const all = layoutOf(block, rng(3)).walls.flatMap((wall) => wall.openings.filter((o) => !o.door));
    const lit = all.filter((o) => o.lit).length / all.length;
    expect(lit).toBeGreaterThan(0.2);
    expect(lit).toBeLessThan(0.6);
  });

  it("has a floor to stand on at every storey, with the stairwell cut out above the ground", () => {
    const plan = layoutOf(block);
    const mesh = built(block);
    const floors = faces(mesh, "dark");
    expect(plan.levels).toHaveLength(5);
    expect(plan.stairs?.kind).toBe("flights");
    const well = plan.stairs!;
    plan.levels.forEach((y, k) => {
      // By the front wall there is floor on every storey.
      expect(floors.some((f) => covers(f, 5, 3.5, y))).toBe(true);
      // Over the back of the stairwell there is floor on the ground only.
      expect(floors.some((f) => covers(f, well.x - 0.6, well.z - well.hd + 0.3, y))).toBe(k === 0);
    });
    // The roof is whole.
    expect(floors.some((f) => covers(f, well.x - 0.6, well.z, plan.top))).toBe(true);
    // Each storey leaves more headroom than the least a way out may have, 2.286 m.
    expect(plan.floorHeight - BUILDING.slab).toBeGreaterThan(2.286);
  });

  it("joins every floor to the next by stairs a person could climb", () => {
    for (const floorHeight of [2.6, 3.2, 4.5, 8]) {
      const risers = Math.ceil(floorHeight / BUILDING.riser);
      // No step rises more than 178 mm, and each is at least 279 mm deep.
      expect(floorHeight / risers).toBeLessThanOrEqual(0.178);
      expect(BUILDING.tread).toBeGreaterThanOrEqual(0.279);
      const spec = { ...block, outline: { shape: "block" as const, width: 20, depth: 16 }, floorHeight, floors: 3 };
      const plan = layoutOf(spec);
      expect(plan.stairs?.kind).toBe("flights");
      const mesh = built(spec);
      // The top of the last step of each flight is level with the floor above.
      const well = plan.stairs!;
      const steps = faces(mesh, "metal").filter((f) => f.every((p) => Math.abs(p[1]! - f[0][1]!) < 1e-9 && Math.abs(p[0]! - well.x) <= well.hw + 1e-6 && Math.abs(p[2]! - well.z) <= well.hd + 1e-6)).map((f) => f[0][1]!);
      for (let k = 0; k + 1 < plan.levels.length; k += 1) {
        const upTo = steps.filter((y) => y > plan.levels[k]! + 1e-6 && y < plan.levels[k + 1]! - 1e-6);
        expect(Math.max(...upTo)).toBeCloseTo(plan.levels[k + 1]! - floorHeight / risers, 6);
        expect(Math.min(...upTo)).toBeCloseTo(plan.levels[k]! + floorHeight / risers, 6);
      }
    }
  });

  it("picks stairs that fit, all the way to the top, and none for a single storey", () => {
    const kind = (spec: BuildingSpec) => layoutOf(spec).stairs?.kind ?? "none";
    expect(kind({ outline: { width: 16, depth: 10 }, floors: 4 })).toBe("flights");
    expect(kind({ outline: { shape: "round", width: 5.2 }, floors: 4 })).toBe("spiral");
    expect(kind({ outline: { width: 5, depth: 4 }, floors: 2 })).toBe("ladder");
    expect(kind({ outline: { width: 16, depth: 10 }, floors: 1 })).toBe("none");
    expect(kind({ outline: { width: 16, depth: 10 }, floors: 4, stairs: false })).toBe("none");
    // A tower that narrows has stairs that still fit on its top floor.
    const tower: BuildingSpec = { outline: { shape: "sided", sides: 8, width: 13 }, floors: 16, taper: 0.55 };
    const plan = layoutOf(tower);
    expect(plan.stairs).not.toBeNull();
    const top = plansIn(cleanRecipe({ name: "Tall Tower", parts: [{ op: "building", ...tower }] }))[0]!;
    const room = top.floors[15]!.room;
    const narrow = Math.max(...room.map((p) => Math.hypot(p[0], p[1])));
    expect(narrow / Math.max(...top.floors[0]!.room.map((p) => Math.hypot(p[0], p[1])))).toBeLessThan(0.62);
    for (const corner of top.stairs!.well) expect(Math.hypot(corner[0], corner[1])).toBeLessThan(narrow);
    // She can put the stairs where she wants them.
    expect(layoutOf({ outline: { width: 20, depth: 16 }, floors: 3, stairs: { at: [5, 2] } }).stairs).toMatchObject({ kind: "flights", x: 5, z: 2 });
    expect(soundMesh(built(tower))).toBe(true);
    expect(soundMesh(built({ outline: { shape: "round", width: 5.2 }, floors: 4 }))).toBe(true);
    // A round building is given walls wide enough for a door, more of them the larger it is.
    expect([5.2, 12, 40].map((width) => layoutOf({ outline: { shape: "round", width }, floors: 2 })).map((round) => [round.walls.length, round.door !== null])).toEqual([[8, true], [17, true], [24, true]]);
    expect(soundMesh(built({ outline: { width: 5, depth: 4 }, floors: 2 }))).toBe(true);
  });

  it("builds the same building from the same recipe, and keeps within what one build may weigh", () => {
    const recipe = cleanRecipe({ name: "Glass Works", seed: 12, parts: [{ op: "building", material: "glass", outline: { shape: "sided", sides: 10, width: 40 }, floors: 34, windows: { every: 1.6, width: 0.9, height: 0.8, sill: 0.08 } }] });
    const [first, second] = [buildRecipe(recipe, hand), buildRecipe(recipe, hand)];
    expect(first.mesh.positions).toEqual(second.mesh.positions);
    expect(first.triangles).toBeLessThan(LIMITS.triangles);
    expect(first.triangles).toBeGreaterThan(20_000);
  });
});

describe("the plan a building is walked into by", () => {
  const house = (more: object = {}) => cleanRecipe({ name: "Plan House", parts: [{ op: "building", outline: { width: 12, depth: 8 }, floors: 3, ...more }] });

  it("gives every floor, the door on the front, and the stairs with a spot to step on at", () => {
    const [plan] = plansIn(house());
    expect(plan!.floors.map((floor) => floor.y)).toEqual([0.1, 3.3, 6.5].map((y) => expect.closeTo(y, 6)));
    expect(plan!.floors[0]!.room).toHaveLength(4);
    // The room is the outline less the wall on every side.
    expect(Math.max(...plan!.floors[0]!.room.map((p) => p[0]))).toBeCloseTo(6 - BUILDING.wall[2], 6);
    expect(plan!.door).toMatchObject({ out: [expect.closeTo(0, 6), expect.closeTo(1, 6)], width: expect.closeTo(1.6, 6), height: 2.4 });
    expect(plan!.door!.at.map((v) => Number(v.toFixed(3)) + 0)).toEqual([0, 0.1, 3.85]);
    expect(plan!.stairs!.kind).toBe("flights");
    // The spot in front of the stairs is on the floor, clear of the well.
    const [fx, fz] = plan!.stairs!.foot;
    expect(fz).toBeGreaterThan(Math.max(...plan!.stairs!.well.map((p) => p[1])));
    expect(Math.abs(fx)).toBeLessThan(6);
  });

  it("moves and turns with the building", () => {
    const [plan] = plansIn(house({ at: [10, 2, -4], turn: 90 }));
    // Turned a quarter, the front faces +x. Moved, the door and the floors move with it.
    expect(plan!.door!.out.map((v) => Number(v.toFixed(6)))).toEqual([1, 0]);
    expect(plan!.door!.at.map((v) => Number(v.toFixed(3)))).toEqual([13.85, 2.1, -4]);
    expect(plan!.floors[1]!.y).toBeCloseTo(5.3, 6);
    expect(Math.max(...plan!.floors[0]!.room.map((p) => p[0]))).toBeCloseTo(10 + 4 - BUILDING.wall[2], 6);
    expect(plansIn(house({ door: false }))[0]!.door).toBeNull();
  });

  it("is kept for a standing build, with how many doors it has", () => {
    const db = openDatabase();
    raise(db, { name: "Ground", parts: [{ op: "ground", width: 60, depth: 40, kind: "flat", slab: 4 }] }, { x: 100, z: 0, turn: 0 }, T, "owner", "plain", hand);
    const two = { name: "Twin Houses", parts: [{ op: "building", at: [-8, 0, 0], outline: { width: 10, depth: 8 }, floors: 2 }, { op: "building", at: [8, 0, 0], outline: { width: 10, depth: 8 }, floors: 4 }] };
    const build = raise(db, two, { x: 100, z: 0, turn: 0 }, T + 1, "owner", "own", hand);
    expect(build.doors).toBe(2);
    expect(plansOf(db, build.id)!.map((plan) => plan.floors.length)).toEqual([2, 4]);
    const post = raise(db, { name: "Plain Post", parts: [{ op: "loft", up: 10, from: { shape: "block", width: 3 } }] }, { x: 120, z: 10, turn: 0 }, T + 2, "owner", "own", hand);
    expect(post.doors).toBe(0);
    expect(plansOf(db, post.id)).toEqual([]);
    remove(db, build.id, T + 3);
    expect(plansOf(db, build.id)).toBeNull();
    expect(plansOf(db, "forge-0000000000")).toBeNull();
  });
});

describe("the buildings she knows how to make", () => {
  it("can all be walked into, from a door on the front, to every floor", () => {
    for (const kind of ["block", "spire", "exchange", "fields"] as const) {
      for (const seed of [1, 7, 23, 99, 4242]) {
        const recipe = cleanRecipe(compose(kind, seed));
        const made = buildRecipe(recipe, hand);
        expect(made.triangles).toBeLessThan(LIMITS.triangles);
        const plans = plansIn(recipe);
        expect(plans.length).toBeGreaterThan(0);
        for (const plan of plans) {
          expect(plan.door).not.toBeNull();
          // Its front faces +z, which is the side she turns toward the road.
          expect(plan.door!.out[1]).toBeCloseTo(1, 6);
          if (plan.floors.length > 1) expect(plan.stairs).not.toBeNull();
        }
      }
    }
  });

  function grown(steps: number): DatabaseSync {
    const db = openDatabase();
    let now = T;
    for (let k = 0; k < steps; k += 1) {
      now += FORGE.everyMs + (k % 20 === 19 ? 86_400_000 : 0);
      considerForge(db, { calm: 0.1, joy: 0.1, curiosity: 0.1, loneliness: 0, frustration: 0, pride: 0.9, boredom: 0, worry: 0 } as never, now);
    }
    return db;
  }

  it("left to herself, every door she makes opens toward a road", () => {
    const db = grown(110);
    const all = standing(db);
    const pieces = all.flatMap((build) => piecesOf(db, build));
    const firstRoad = Math.min(...all.filter((build) => build.road).map((build) => build.createdAt));
    const homes = all.filter((build) => build.doors > 0 && build.layer === "structure" && build.createdAt > firstRoad);
    expect(homes.length).toBeGreaterThan(8);
    for (const build of homes) {
      const a = (build.turn * Math.PI) / 180;
      for (const plan of plansOf(db, build.id)!) {
        const [lx, , lz] = plan.door!.at;
        const [ox, oz] = plan.door!.out;
        const door = [build.x + lx * Math.cos(a) + lz * Math.sin(a), build.z - lx * Math.sin(a) + lz * Math.cos(a)];
        const out = [ox * Math.cos(a) + oz * Math.sin(a), -ox * Math.sin(a) + oz * Math.cos(a)];
        // Walking straight out of the door she comes to a road, or to within a few steps of the end of one, inside twenty metres. Behind the building she would not.
        const from = (x: number, z: number) => Math.min(...pieces.map((piece) => {
          const [dx, dz] = [piece.bx - piece.ax, piece.bz - piece.az];
          const t = Math.min(1, Math.max(0, ((x - piece.ax) * dx + (z - piece.az) * dz) / (dx * dx + dz * dz)));
          return Math.hypot(x - piece.ax - dx * t, z - piece.az - dz * t) - piece.half;
        }));
        let nearest = Infinity;
        for (let step = 1; step <= 20; step += 0.5) nearest = Math.min(nearest, from(door[0]! + out[0]! * step, door[1]! + out[1]! * step));
        expect(nearest).toBeLessThan(6);
        expect(nearest).toBeLessThan(from(door[0]! - out[0]! * 4, door[1]! - out[1]! * 4));
      }
    }
  });
});
