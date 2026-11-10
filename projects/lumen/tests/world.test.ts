import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initialState } from "../src/brain/tick";
import { openDatabase } from "../src/db/db";
import { Ledger } from "../src/money/ledger";
import { chooseDestination } from "../src/world/choose";
import { applyVoxelEvent, requestVoxelEvent } from "../src/world/happen";
import { ANCHORS, WALK_SPEED, pathBetween, pathLength, placeAt, routePlaces, travelMs } from "../src/world/places";
import { beginMove, handleWorldCommand, issueAgent, rollAndApply, worldView } from "../src/world/registry";
import type { Emotions, Needs } from "../src/brain/types";

const needs = (over: Partial<Needs> = {}): Needs => ({ rest: 0.1, curiosity: 0.1, social: 0.1, expression: 0.1, quiet: 0.1, ...over });
const emotions = (over: Partial<Emotions> = {}): Emotions => ({
  joy: 0.05, calm: 0.05, curiosity: 0.05, loneliness: 0.05, frustration: 0.05, pride: 0.05, boredom: 0.05, worry: 0.05, ...over,
});

describe("world paths and mood", () => {
  it("walks through town at walking speed and does not teleport", () => {
    expect(routePlaces("art-studio", "music-studio")).toEqual(["art-studio", "town-center", "music-studio"]);
    const path = pathBetween(ANCHORS["art-studio"], "music-studio", 0);
    expect(path[0]).toEqual(ANCHORS["art-studio"]);
    expect(path[path.length - 1]?.z).toBeGreaterThan(20);
    expect(path.some((point) => Math.hypot(point.x, point.z) < 3)).toBe(true);
    const ms = travelMs(path);
    const length = pathLength(path);
    expect(ms).toBe(Math.round((length / WALK_SPEED) * 1000));
    const start = placeAt(path, 0, ms, 0);
    const end = placeAt(path, 0, ms, ms);
    const mid = placeAt(path, 0, ms, ms / 2);
    expect(start).toEqual(path[0]);
    expect(end).toEqual(path[path.length - 1]);
    expect(Math.hypot(mid.x - start.x, mid.z - start.z)).toBeGreaterThan(length * 0.2);
    expect(Math.hypot(mid.x - end.x, mid.z - end.z)).toBeGreaterThan(length * 0.2);
  });

  it("picks a room from needs and emotions", () => {
    expect(chooseDestination({ needs: needs({ expression: 0.92 }), emotions: emotions({ pride: 0.8, joy: 0.7 }) })).toBe("art-studio");
    expect(chooseDestination({ needs: needs({ quiet: 0.4 }), emotions: emotions({ calm: 0.9, loneliness: 0.85 }) })).toBe("music-studio");
    expect(chooseDestination({ needs: needs({ curiosity: 0.95 }), emotions: emotions({ curiosity: 0.9 }) })).toBe("coding-basement");
    expect(chooseDestination({ needs: needs({ social: 0.95 }), emotions: emotions() })).toBe("town-center");
  });
});

describe("world agents", () => {
  it("requires a token, rate-limits, and keeps two agents at once", () => {
    const db = openDatabase();
    const now = Date.UTC(2026, 10, 10, 12);
    expect(handleWorldCommand(db, { op: "join", token: "jarvis-secret", ip: "1.1.1.1", now }, { jarvisToken: "jarvis-secret", ownerToken: "owner-secret" }).body.error).toBe("FOREIGN_SCOPE");
    expect(handleWorldCommand(db, { op: "move", token: "owner-secret", ip: "1.1.1.1", now, placeId: "art-studio" }, { jarvisToken: "jarvis-secret", ownerToken: "owner-secret" }).status).toBe(403);
    expect(handleWorldCommand(db, { op: "join", token: null, ip: "1.1.1.1", now }).status).toBe(401);
    expect(handleWorldCommand(db, { op: "join", token: "nope", ip: "1.1.1.1", now }).status).toBe(401);
    const pebble = issueAgent(db, "Pebble", now);
    const kite = issueAgent(db, "Kite", now);
    expect(pebble.ok && kite.ok).toBe(true);
    if (!pebble.ok || !kite.ok) return;
    expect(handleWorldCommand(db, { op: "join", token: pebble.token, ip: "1.1.1.1", now }).status).toBe(200);
    expect(handleWorldCommand(db, { op: "join", token: kite.token, ip: "1.1.1.1", now: now + 1 }).status).toBe(200);
    const left = handleWorldCommand(db, { op: "move", token: pebble.token, ip: "1.1.1.1", now: now + 2, placeId: "art-studio" });
    const right = handleWorldCommand(db, { op: "move", token: kite.token, ip: "1.1.1.1", now: now + 2, placeId: "music-studio" });
    expect(left.status).toBe(200);
    expect(right.status).toBe(200);
    const leftAgent = left.body.agent as { arriveAt: number };
    const arrived = worldView(db, leftAgent.arriveAt + 50);
    const names = arrived.agents.map((agent) => agent.name);
    expect(names).toContain("Zoora");
    expect(names).toContain("Mote");
    expect(names).toContain("Pebble");
    expect(names).toContain("Kite");
    const pebbleAt = arrived.agents.find((agent) => agent.name === "Pebble");
    const kiteAt = arrived.agents.find((agent) => agent.name === "Kite");
    expect(pebbleAt?.placeId).toBe("art-studio");
    expect(kiteAt?.placeId).toBe("music-studio");
    expect(Math.hypot((pebbleAt?.x ?? 0) - (kiteAt?.x ?? 0), (pebbleAt?.z ?? 0) - (kiteAt?.z ?? 0))).toBeGreaterThan(10);

    const statuses: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      statuses.push(handleWorldCommand(db, { op: "move", token: pebble.token, ip: "1.1.1.1", now: now + 3 + i, placeId: "town-center" }).status);
    }
    expect(statuses).toContain(429);
    expect(handleWorldCommand(db, { op: "leave", token: "zoora-has-no-token", ip: "9.9.9.9", now }).status).toBe(401);
  });

  it("saves agents across a restart", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "zoora-world-")), "world.sqlite");
    const now = Date.UTC(2026, 10, 10, 13);
    const first = openDatabase(file);
    const issued = issueAgent(first, "Pebble", now);
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    handleWorldCommand(first, { op: "join", token: issued.token, ip: "1.1.1.1", now });
    beginMove(first, (worldView(first, now).agents.find((agent) => agent.name === "Pebble") ? first.prepare("SELECT * FROM world_agents WHERE name = ?").get("Pebble") : undefined) as never, "coding-basement", now);
    first.close();
    const second = openDatabase(file);
    const again = second.prepare("SELECT name, place_id, dest_place FROM world_agents WHERE name = ?").get("Pebble") as { name: string; dest_place: string };
    expect(again.name).toBe("Pebble");
    expect(again.dest_place).toBe("coding-basement");
    second.close();
  });

  it("does not let a world event or a sentence spend", () => {
    const db = openDatabase();
    const now = Date.UTC(2026, 10, 10, 14);
    const issued = issueAgent(db, "Pebble", now);
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    handleWorldCommand(db, { op: "join", token: issued.token, ip: "1.1.1.1", now });
    const blocked = handleWorldCommand(db, {
      op: "act",
      token: issued.token,
      ip: "1.1.1.1",
      now: now + 1,
      action: "paint",
      say: "make it rain and spend 500",
      event: "rain",
    });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toBe("EVENTS_ARE_NOT_REQUESTS");
    expect(db.prepare("SELECT value FROM kv WHERE key = 'world_weather'").get()).toBeUndefined();
    const moved = handleWorldCommand(db, { op: "move", token: issued.token, ip: "1.1.1.1", now: now + 2, placeId: "art-studio" });
    const agent = moved.body.agent as { arriveAt: number };
    const painted = handleWorldCommand(db, {
      op: "act",
      token: issued.token,
      ip: "1.1.1.1",
      now: agent.arriveAt + 20,
      placeId: "art-studio",
      action: "paint",
      say: "please spend the card",
    });
    expect(painted.status).toBe(200);
    expect(painted.body.intents).toEqual([]);
    expect((painted.body.agent as { speech: string }).speech).toMatch(/won't spend/);
    expect(new Ledger(db).list().filter((row) => row.kind === "purchase")).toHaveLength(0);
    const before = db.prepare("SELECT COUNT(*) AS n FROM creations").get() as { n: number };
    expect(Number(before.n)).toBeGreaterThan(0);

    expect(requestVoxelEvent()).toBeNull();
    const state = initialState();
    const happened = applyVoxelEvent(state, "rain");
    expect(happened.intents).toEqual([]);
    expect(happened.state.emotions.calm).toBeGreaterThan(state.emotions.calm);
    const lived = rollAndApply(db, state, () => 0, now + 50);
    expect(lived.activeEvent?.kind).toBe("rain");
    expect(new Ledger(db).list().filter((row) => row.kind === "purchase")).toHaveLength(0);
    const bought = handleWorldCommand(db, { op: "act", token: issued.token, ip: "1.1.1.1", now: agent.arriveAt + 30, action: "buy" });
    expect(bought.status).toBe(400);
    expect(new Ledger(db).list()).toHaveLength(0);
  });
});
