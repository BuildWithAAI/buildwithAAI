/**
 * Walking inside one of her buildings.
 *
 * The forge sends a plan with every floor's room, the door and the stairwell, in the build's own
 * metres. This file moves a walker about inside that plan: she stays within the walls, goes round the
 * stairwell, and changes floor at the stairs. It knows nothing about drawing, so it can be tested.
 */

export type WalkPlan = {
  floorHeight: number;
  floors: { y: number; room: [number, number][] }[];
  door: { at: [number, number, number]; out: [number, number]; width: number; height: number } | null;
  stairs: { kind: string; well: [number, number][]; foot: [number, number] } | null;
};

/** Where the walker is: a spot on a floor, and which way she looks. Angles are in radians. Looking at 0 is toward +z. */
export type Walker = { x: number; z: number; floor: number; yaw: number; pitch: number };

/** Her eye height, how close her middle may come to a wall, and how fast she walks, in metres and metres a second. */
export const WALK = { eye: 1.6, body: 0.35, pace: 3 } as const;

/** How far inside a shape with no dents a point is. Negative when it is outside. */
function inside(shape: [number, number][], x: number, z: number): number {
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

/** Whether she can stand at a spot on a floor: inside the walls with room for her body, and not in the stairwell. */
export function canStand(plan: WalkPlan, floor: number, x: number, z: number): boolean {
  const room = plan.floors[floor]?.room;
  if (!room || inside(room, x, z) < WALK.body) return false;
  return !plan.stairs || inside(plan.stairs.well, x, z) < -WALK.body;
}

/** Just inside the door, looking in. With no door she starts in the middle of the ground floor. */
export function startAt(plan: WalkPlan): Walker {
  const room = plan.floors[0]!.room;
  const middle: [number, number] = [room.reduce((sum, p) => sum + p[0], 0) / room.length, room.reduce((sum, p) => sum + p[1], 0) / room.length];
  if (!plan.door) return { x: middle[0], z: middle[1], floor: 0, yaw: 0, pitch: 0 };
  const [ox, oz] = plan.door.out;
  // Step in from the doorway until there is room to stand.
  for (let back = 0.8; back <= 4; back += 0.2) {
    const [x, z] = [plan.door.at[0] - ox * back, plan.door.at[2] - oz * back];
    if (canStand(plan, 0, x, z)) return { x, z, floor: 0, yaw: Math.atan2(-ox, -oz), pitch: 0 };
  }
  return { x: middle[0], z: middle[1], floor: 0, yaw: Math.atan2(-ox, -oz), pitch: 0 };
}

/** One step. `ahead` and `aside` are from -1 to 1. Where a wall is in the way she slides along it. */
export function walk(plan: WalkPlan, walker: Walker, ahead: number, aside: number, seconds: number): Walker {
  const reach = WALK.pace * Math.min(0.1, Math.max(0, seconds));
  const dx = (Math.sin(walker.yaw) * ahead - Math.cos(walker.yaw) * aside) * reach;
  const dz = (Math.cos(walker.yaw) * ahead + Math.sin(walker.yaw) * aside) * reach;
  if (dx === 0 && dz === 0) return walker;
  for (const [mx, mz] of [[dx, dz], [dx, 0], [0, dz]] as const) {
    if ((mx !== 0 || mz !== 0) && canStand(plan, walker.floor, walker.x + mx, walker.z + mz)) return { ...walker, x: walker.x + mx, z: walker.z + mz };
  }
  return walker;
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
