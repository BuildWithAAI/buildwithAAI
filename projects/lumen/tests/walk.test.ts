import { describe, expect, it } from "vitest";
import { cleanRecipe, plansIn } from "../src/forge/recipe";
import { canStand, changeFloor, eyeOf, look, nearestDoor, startAt, walk, WALK, type WalkPlan } from "../src/world/walk";

const planOf = (more: object = {}): WalkPlan => plansIn(cleanRecipe({ name: "Walk House", parts: [{ op: "building", outline: { width: 16, depth: 10 }, floors: 3, ...more }] }))[0]!;

describe("walking inside one of her buildings", () => {
  it("starts just inside the door, looking in", () => {
    const plan = planOf();
    const start = startAt(plan);
    expect(start.floor).toBe(0);
    expect(canStand(plan, 0, start.x, start.z)).toBe(true);
    // The door is on the front, which faces +z, so she is a step back from it and looks toward -z.
    expect(start.z).toBeLessThan(plan.door!.at[2]);
    expect(plan.door!.at[2] - start.z).toBeLessThan(1.5);
    const view = eyeOf(plan, start);
    expect(view.eye[1]).toBeCloseTo(0.1 + WALK.eye, 6);
    expect(view.toward[2]).toBeLessThan(view.eye[2]);
    expect(view.toward[0]).toBeCloseTo(view.eye[0], 6);
  });

  it("keeps her inside the walls, and slides her along a wall she walks into", () => {
    const plan = planOf();
    let walker = { ...startAt(plan), x: 5, z: 3, yaw: Math.PI / 2 - 0.4 };
    // Walking toward the right-hand wall at a slant for ten seconds: she is stopped by it and carried along it.
    for (let k = 0; k < 200; k += 1) walker = walk(plan, walker, 1, 0, 0.05);
    const wallAt = 8 - 0.3;
    expect(walker.x).toBeLessThanOrEqual(wallAt - WALK.body + 1e-9);
    expect(walker.x).toBeGreaterThan(wallAt - WALK.body - 0.2);
    expect(walker.z).toBeGreaterThan(3.5);
    expect(canStand(plan, 0, walker.x, walker.z)).toBe(true);
    // A step is never longer than a tenth of a second's walk, however long the frame took.
    const far = walk(plan, { ...startAt(plan), x: 0, z: 3, yaw: Math.PI / 2 }, 1, 0, 60);
    expect(far.x).toBeCloseTo(WALK.pace * 0.1, 6);
    // Standing still, nothing changes.
    expect(walk(plan, walker, 0, 0, 0.05)).toBe(walker);
  });

  it("goes round the stairwell, never through it, on every floor", () => {
    const plan = planOf();
    const well = plan.stairs!.well;
    const middle = [well.reduce((sum, p) => sum + p[0], 0) / 4, well.reduce((sum, p) => sum + p[1], 0) / 4];
    for (let floor = 0; floor < 3; floor += 1) {
      expect(canStand(plan, floor, middle[0]!, middle[1]!)).toBe(false);
      let walker = { x: plan.stairs!.foot[0], z: plan.stairs!.foot[1], floor, yaw: Math.PI, pitch: 0 };
      expect(canStand(plan, floor, walker.x, walker.z)).toBe(true);
      // Walking straight at the stairs from in front of them, she stops at their edge.
      for (let k = 0; k < 100; k += 1) walker = walk(plan, walker, 1, 0, 0.05);
      expect(walker.z).toBeGreaterThan(Math.max(...well.map((p) => p[1])) + WALK.body - 1e-9);
    }
  });

  it("changes floor at the stairs, and only where there is a floor to go to", () => {
    const plan = planOf();
    const start = startAt(plan);
    expect(changeFloor(plan, start, -1)).toBeNull();
    const up = changeFloor(plan, start, 1)!;
    expect([up.floor, up.x, up.z]).toEqual([1, plan.stairs!.foot[0], plan.stairs!.foot[1]]);
    expect(eyeOf(plan, up).eye[1]).toBeCloseTo(0.1 + 3.2 + WALK.eye, 6);
    // She arrives with her back to the stairs.
    expect(eyeOf(plan, up).toward[2]).toBeGreaterThan(up.z);
    const top = changeFloor(plan, up, 1)!;
    expect(top.floor).toBe(2);
    expect(changeFloor(plan, top, 1)).toBeNull();
    expect(changeFloor(plan, top, -1)!.floor).toBe(1);
    // A building with one floor, or with no stairs, has nowhere to go.
    expect(changeFloor(planOf({ floors: 1 }), start, 1)).toBeNull();
    expect(changeFloor(planOf({ stairs: false }), start, 1)).toBeNull();
  });

  it("looks about no further than a person can", () => {
    const walker = startAt(planOf());
    expect(look(walker, 0.5, 9).pitch).toBe(1.3);
    expect(look(walker, 0.5, -9).pitch).toBe(-1.3);
    expect(look(walker, 0.5, 0).yaw).toBeCloseTo(walker.yaw + 0.5, 9);
  });

  it("works the same when the building is moved and turned inside its build", () => {
    const plan = planOf({ at: [10, 2, -4], turn: 90 });
    const start = startAt(plan);
    expect(canStand(plan, 0, start.x, start.z)).toBe(true);
    // Its front now faces +x, so she stands a step inside that wall and looks toward -x.
    expect(start.x).toBeLessThan(plan.door!.at[0]);
    expect(eyeOf(plan, start).toward[0]).toBeLessThan(start.x);
    expect(eyeOf(plan, start).eye[1]).toBeCloseTo(2.1 + WALK.eye, 6);
    let walker = start;
    for (let k = 0; k < 400; k += 1) walker = walk(plan, walker, 1, 0.3, 0.05);
    expect(canStand(plan, 0, walker.x, walker.z)).toBe(true);
  });

  it("goes in by the door nearest where she tapped", () => {
    const plans = plansIn(cleanRecipe({ name: "Twin Houses", parts: [{ op: "building", at: [-8, 0, 0], outline: { width: 10, depth: 8 }, floors: 2 }, { op: "building", at: [8, 0, 0], outline: { width: 10, depth: 8 }, floors: 4 }, { op: "building", at: [0, 0, -14], outline: { width: 6, depth: 4 }, floors: 1, door: false }] }));
    expect(nearestDoor(plans, -9, 6)!.floors).toHaveLength(2);
    expect(nearestDoor(plans, 5, 0)!.floors).toHaveLength(4);
    expect(nearestDoor([plans[2]!], 0, 0)).toBeNull();
  });
});
