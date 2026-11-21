import { describe, expect, it } from "vitest";
import { actImpulse, restless, settleEmotions } from "../src/brain/emotions";
import { simulate } from "../src/brain/simulate";
import { ACT_MINUTES, blankProduct, EVENT_MINUTES, initialState, mulberry32, tick, type TickInput } from "../src/brain/tick";
import { emptyEmotions } from "../src/brain/types";

function input(over: Partial<TickInput> = {}): TickInput {
  return { nowMs: 1_800_000_000_000, elapsedMs: 8_000, rng: mulberry32(5), killLlm: true, modelConfigured: false, chatTriggered: false, webTextPresent: false, hasNewMessage: false, readAllowlist: [], ownerName: "keeper", product: blankProduct(), ...over };
}

describe("balance", () => {
  it("chooses when an act ends, not on every tick, and lets the world interrupt", async () => {
    let state = (await tick(initialState(), input())).state;
    expect(state.actLeft).toBe(ACT_MINUTES);
    const first = state.tick;
    let choices = 0;
    const ticksPerAct = Math.ceil((ACT_MINUTES * 60_000) / 8_000);
    for (let step = 0; step < ticksPerAct - 1; step += 1) {
      const result = await tick(state, input());
      if (result.audits.some((audit) => audit.kind === "act")) choices += 1;
      state = result.state;
    }
    expect(choices).toBe(0);
    expect(state.tick).toBe(first + ticksPerAct - 1);
    expect((await tick(state, input())).audits.some((audit) => audit.kind === "act")).toBe(true);
    const fresh = (await tick(initialState(), input())).state;
    expect((await tick(fresh, input({ hasNewMessage: true }))).audits.some((audit) => audit.kind === "act")).toBe(true);
    expect((await tick(fresh, input({ forcedEvent: "storm" }))).audits.some((audit) => audit.kind === "act")).toBe(true);
  });

  it("rolls for an ambient event once per stretch of world time, not once per tick", async () => {
    let state = initialState();
    let events = 0;
    const always = () => 0.05;
    const ticks = Math.floor((EVENT_MINUTES * 4 * 60_000) / 8_000);
    for (let step = 0; step < ticks; step += 1) {
      const result = await tick(state, input({ rng: always }));
      events += result.feed.filter((item) => item.kind === "event").length;
      state = { ...result.state, scheduledKind: null };
    }
    expect(events).toBeGreaterThanOrEqual(3);
    expect(events).toBeLessThanOrEqual(5);
  });

  it("settles a feeling toward its signal by the minute and does not run a steady signal to the ceiling", () => {
    let emotions = emptyEmotions();
    for (let minute = 0; minute < 600; minute += 1) emotions = settleEmotions(emotions, { curiosity: 0.2 }, {}, 1);
    expect(emotions.curiosity).toBeCloseTo(0.4, 2);
    const fast = Array.from({ length: 75 }).reduce<ReturnType<typeof emptyEmotions>>((acc) => settleEmotions(acc, { joy: 0.3 }, {}, 8 / 60), emptyEmotions());
    const slow = Array.from({ length: 10 }).reduce<ReturnType<typeof emptyEmotions>>((acc) => settleEmotions(acc, { joy: 0.3 }, {}, 1), emptyEmotions());
    expect(fast.joy).toBeCloseTo(slow.joy, 2);
    expect(actImpulse("paint", 1)).toEqual({ pride: 0.3, joy: 0.12 });
    expect(actImpulse("paint", 0.5).pride).toBe(0.15);
    expect(actImpulse("unknown", 1)).toEqual({});
  });

  it("does not let a rut of boredom feed itself", () => {
    const calm = restless(emptyEmotions(), ["rest", "drift"], ["calm", "calm", "calm", "calm", "calm", "calm"]);
    expect(calm.boredom).toBe(0.05);
    const bored = restless(emptyEmotions(), ["rest", "drift"], ["boredom", "boredom", "boredom", "boredom", "boredom", "boredom"]);
    expect(bored.boredom).toBe(0);
    expect(restless(emptyEmotions(), ["rest", "rest", "rest", "rest"], []).boredom).toBe(0.08);
  });

  it("keeps her needs off the floor and the ceiling and gives her more than one feeling, at the live tick", async () => {
    const run = await simulate({ days: 2, seed: 7, stepMs: 8_000 });
    expect(run.lateNeed).toBeGreaterThan(0.15);
    expect(run.lateNeed).toBeLessThan(0.85);
    const shares = Object.values(run.lateFeelings);
    expect(Math.max(...shares)).toBeLessThan(0.85);
    expect(shares.filter((share) => share >= 0.02).length).toBeGreaterThanOrEqual(3);
    expect(Object.keys(run.lateActions).length).toBeGreaterThanOrEqual(12);
    expect(run.state.energy).toBeGreaterThan(0.05);
  }, 240_000);
});
