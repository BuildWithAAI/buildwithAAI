/**
 * Walking inside one of her buildings.
 *
 * The forge sends a plan with every floor's outline, the walls she drew inside it, the rooms those
 * walls close, the door and the stairwell, in the build's own metres. This file moves a walker about
 * inside that plan: she stays within the outside walls, goes round the stairwell and round her inside
 * walls, passes through their doors, and changes floor at the stairs. It knows nothing about drawing,
 * so it can be tested.
 *
 * The forge uses the same test, `canStand`, to decide whether a room can be walked to. So a room the
 * forge allowed is one she can really reach.
 */

/** One room on a floor: its outline, a spot well inside it, what it is, what to call it, and which home or shop it is, if it is one. */
export type WalkRoom = { outline: [number, number][]; at: [number, number]; use: "home" | "shop" | "hall"; label: string; unit: string | null; area: number };

export type WalkPlan = {
  floorHeight: number;
  /** How thick her inside walls are. */
  partition?: number;
  /** Each floor: its height, the space inside its outside walls, the solid stretches of her inside walls, and the rooms they close. */
  floors: { y: number; rim: [number, number][]; walls?: [number, number, number, number][]; rooms?: WalkRoom[] }[];
  door: { at: [number, number, number]; out: [number, number]; width: number; height: number } | null;
  stairs: { kind: string; well: [number, number][]; foot: [number, number] } | null;
};

/** Where the walker is: a spot on a floor, and which way she looks. Angles are in radians. Looking at 0 is toward +z. */
export type Walker = { x: number; z: number; floor: number; yaw: number; pitch: number };

/** Her eye height, how close her middle may come to the face of a wall, and how fast she walks, in metres and metres a second. */
export const WALK = { eye: 1.6, body: 0.25, pace: 3 } as const;

/** How far inside a shape with no dents a point is. Negative when it is outside. */
export function inside(shape: [number, number][], x: number, z: number): number {
  // Which way round the shape is listed decides which side of each edge is the inside.
  const turn = shape.reduce((sum, p, i) => sum + p[0] * shape[(i + 1) % shape.length]![1] - shape[(i + 1) % shape.length]![0] * p[1], 0) >= 0 ? 1 : -1;
  let least = Infinity;
  for (let i = 0; i < shape.length; i += 1) {
    const [a, b] = [shape[i]!, shape[(i + 1) % shape.length]!];
    const far = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    least = Math.min(least, (((b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0])) / far) * turn);
  }
  return least;
}

/** The nearest point to a spot on a straight stretch from a to b. */
export function nearest(x: number, z: number, ax: number, az: number, bx: number, bz: number): [number, number] {
  const [dx, dz] = [bx - ax, bz - az];
  const long = dx * dx + dz * dz;
  const t = long < 1e-18 ? 0 : Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / long));
  return [ax + dx * t, az + dz * t];
}

/** How far a spot is from a straight stretch from a to b. */
export function away(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const [nx, nz] = nearest(x, z, ax, az, bx, bz);
  return Math.hypot(x - nx, z - nz);
}

/** How far her middle keeps from the middle line of an inside wall: her body, and half the wall. */
export function keepOff(partition: number): number {
  return WALK.body + partition / 2;
}

/** Whether she can stand at a spot on a floor: inside the outside walls with room for her body, not in the stairwell, and clear of every inside wall. */
export function canStand(plan: WalkPlan, floor: number, x: number, z: number): boolean {
  const at = plan.floors[floor];
  if (!at || inside(at.rim, x, z) < WALK.body) return false;
  if (plan.stairs && inside(plan.stairs.well, x, z) >= -WALK.body) return false;
  if (!at.walls?.length) return true;
  const keep = keepOff(plan.partition ?? 0);
  for (const [ax, az, bx, bz] of at.walls) if (away(x, z, ax, az, bx, bz) < keep) return false;
  return true;
}

/** The room a spot on a floor is in, if her walls have made rooms there. */
export function roomAt(plan: WalkPlan, floor: number, x: number, z: number): WalkRoom | null {
  let found: WalkRoom | null = null;
  for (const room of plan.floors[floor]?.rooms ?? []) {
    let within = false;
    for (let i = 0; i < room.outline.length; i += 1) {
      const [a, b] = [room.outline[i]!, room.outline[(i + 1) % room.outline.length]!];
      if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) within = !within;
    }
    // A room that stands free inside another is the smaller of the two that hold the spot.
    if (within && (!found || room.area < found.area)) found = room;
  }
  return found;
}

/** Just inside the door, looking in. With no door she starts in the middle of the ground floor. */
export function startAt(plan: WalkPlan): Walker {
  const rim = plan.floors[0]!.rim;
  const middle: [number, number] = [rim.reduce((sum, p) => sum + p[0], 0) / rim.length, rim.reduce((sum, p) => sum + p[1], 0) / rim.length];
  if (!plan.door) return { x: middle[0], z: middle[1], floor: 0, yaw: 0, pitch: 0 };
  const [ox, oz] = plan.door.out;
  // Step in from the doorway until there is room to stand.
  for (let back = 0.8; back <= 4; back += 0.2) {
    const [x, z] = [plan.door.at[0] - ox * back, plan.door.at[2] - oz * back];
    if (canStand(plan, 0, x, z)) return { x, z, floor: 0, yaw: Math.atan2(-ox, -oz), pitch: 0 };
  }
  return { x: middle[0], z: middle[1], floor: 0, yaw: Math.atan2(-ox, -oz), pitch: 0 };
}

/** A spot she tried to step to, moved the least way that clears whatever was in the way. Null if nothing near it is clear. */
function settle(plan: WalkPlan, floor: number, x: number, z: number): [number, number] | null {
  const at = plan.floors[floor];
  if (!at) return null;
  const keep = keepOff(plan.partition ?? 0);
  const spare = 1e-7;
  /** Moves the spot out through the side of a shape it is nearest to leaving by, until it is `far` on the wanted side. */
  const press = (shape: [number, number][], want: "in" | "out") => {
    const turn = shape.reduce((sum, p, i) => sum + p[0] * shape[(i + 1) % shape.length]![1] - shape[(i + 1) % shape.length]![0] * p[1], 0) >= 0 ? 1 : -1;
    let [least, nx, nz] = [Infinity, 0, 0];
    for (let i = 0; i < shape.length; i += 1) {
      const [a, b] = [shape[i]!, shape[(i + 1) % shape.length]!];
      const far = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      // The way into the shape from this side, and how far in the spot is.
      const [ix, iz] = [(-(b[1] - a[1]) / far) * turn, ((b[0] - a[0]) / far) * turn];
      const depth = (x - a[0]) * ix + (z - a[1]) * iz;
      if (want === "in" && depth < WALK.body) {
        x += ix * (WALK.body - depth + spare);
        z += iz * (WALK.body - depth + spare);
      }
      if (depth < least) [least, nx, nz] = [depth, ix, iz];
    }
    // Out of the stairwell by its nearest side.
    if (want === "out" && least >= -WALK.body) {
      x -= nx * (least + WALK.body + spare);
      z -= nz * (least + WALK.body + spare);
    }
  };
  for (let round = 0; round < 4; round += 1) {
    press(at.rim, "in");
    if (plan.stairs) press(plan.stairs.well, "out");
    for (const [ax, az, bx, bz] of at.walls ?? []) {
      const [cx, cz] = nearest(x, z, ax, az, bx, bz);
      const far = Math.hypot(x - cx, z - cz);
      if (far >= keep) continue;
      // Straight away from the wall, or square to it if she is on its middle line.
      const long = Math.hypot(bx - ax, bz - az) || 1;
      const [ux, uz] = far > 1e-9 ? [(x - cx) / far, (z - cz) / far] : [-(bz - az) / long, (bx - ax) / long];
      x = cx + ux * (keep + spare);
      z = cz + uz * (keep + spare);
    }
    if (canStand(plan, floor, x, z)) return [x, z];
  }
  return null;
}

/** One short move of no more than a hand's breadth. Where a wall is in the way she slides along it, or stays where she is. */
function shift(plan: WalkPlan, walker: Walker, dx: number, dz: number): Walker {
  if (canStand(plan, walker.floor, walker.x + dx, walker.z + dz)) return { ...walker, x: walker.x + dx, z: walker.z + dz };
  const slid = settle(plan, walker.floor, walker.x + dx, walker.z + dz);
  if (!slid) return walker;
  const [mx, mz] = [slid[0] - walker.x, slid[1] - walker.z];
  // A slide never carries her back the way she came, and never far: round the end of a wall it can be a little longer than the move, and no more.
  const went = Math.hypot(mx, mz);
  if (went < 1e-9 || went > Math.hypot(dx, dz) * 2 + 0.02 || mx * dx + mz * dz < 0) return walker;
  return { ...walker, x: slid[0], z: slid[1] };
}

/**
 * One step. `ahead` and `aside` are from -1 to 1. Where a wall is in the way she slides along it, and
 * she is carried round the end of a wall into a doorway.
 *
 * She walks no faster on a slant than straight ahead. A step is taken a tenth of a metre at a time,
 * which is far less than the distance she keeps from the middle of a wall, so no step, however long
 * the frame took, can carry her through one.
 */
export function walk(plan: WalkPlan, walker: Walker, ahead: number, aside: number, seconds: number): Walker {
  const push = Math.hypot(ahead, aside);
  const reach = (WALK.pace * Math.min(0.1, Math.max(0, seconds))) / Math.max(1, push);
  const dx = (Math.sin(walker.yaw) * ahead - Math.cos(walker.yaw) * aside) * reach;
  const dz = (Math.cos(walker.yaw) * ahead + Math.sin(walker.yaw) * aside) * reach;
  if (dx === 0 && dz === 0) return walker;
  const parts = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.1 - 1e-9));
  let at = walker;
  for (let k = 0; k < parts; k += 1) {
    const next = shift(plan, at, dx / parts, dz / parts);
    if (next === at) break;
    at = next;
  }
  return at;
}

/** Looking about. She cannot look further up or down than a person can. */
export function look(walker: Walker, yaw: number, pitch: number): Walker {
  return { ...walker, yaw: walker.yaw + yaw, pitch: Math.min(1.3, Math.max(-1.3, walker.pitch + pitch)) };
}

/** Up or down one floor by the stairs. She arrives at the spot in front of them, facing away from the well. Null where there is no floor or no stairs. */
export function changeFloor(plan: WalkPlan, walker: Walker, by: 1 | -1): Walker | null {
  const floor = walker.floor + by;
  if (!plan.stairs || floor < 0 || floor >= plan.floors.length) return null;
  const well = plan.stairs.well;
  const middle = [well.reduce((sum, p) => sum + p[0], 0) / well.length, well.reduce((sum, p) => sum + p[1], 0) / well.length];
  const [x, z] = plan.stairs.foot;
  return { x, z, floor, yaw: Math.atan2(x - middle[0]!, z - middle[1]!), pitch: 0 };
}

/** Where her eye is, and a point one metre along where she is looking, in the build's own metres. */
export function eyeOf(plan: WalkPlan, walker: Walker): { eye: [number, number, number]; toward: [number, number, number] } {
  const y = plan.floors[walker.floor]!.y + WALK.eye;
  const level = Math.cos(walker.pitch);
  return { eye: [walker.x, y, walker.z], toward: [walker.x + Math.sin(walker.yaw) * level, y + Math.sin(walker.pitch), walker.z + Math.cos(walker.yaw) * level] };
}

/** Of several buildings in one build, the one whose door is nearest a spot. Null if none has a door. */
export function nearestDoor(plans: WalkPlan[], x: number, z: number): WalkPlan | null {
  const open = plans.filter((plan) => plan.door && plan.floors.length > 0);
  if (!open.length) return null;
  return open.reduce((best, plan) => (Math.hypot(plan.door!.at[0] - x, plan.door!.at[2] - z) < Math.hypot(best.door!.at[0] - x, best.door!.at[2] - z) ? plan : best));
}
