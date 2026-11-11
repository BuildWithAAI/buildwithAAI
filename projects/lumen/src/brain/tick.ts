import { makeSvg, artTitle } from "./art";
import { actionByName } from "./habitat";
import { sensorsFromClock } from "./habitat";
import {
  absorbModelOutput,
  candidateNames,
  fallbackAction,
  hostAllowed,
  sanitizePage,
  shouldCallModel,
  validateParams,
  intentsFromUntrustedWeb,
} from "./decide";
import { eventOf, impulseFor, rollAmbient, clockEvent, type EventKind, type WorldEvent } from "./events";
import { applyForces, applyNeedDeltas, applyOutcome, decayMood, driftNeeds, energyLabel, inboxStress, moodLabel } from "./feel";
import { blendEmotions, decayEmotions, diminishing, dominantEmotion, loopDamp, signalsFromNeeds } from "./emotions";
import { carryingInView, consolidate, observationHash, remember } from "./memory";
import { feelingForPrompt, modelRequestBody } from "./prompt";
import { acceptSpeech, describeFeeling, diaryLine, hottestFixation, noteFixations, pushPhrase, speechFor, toneOf } from "./speak";
import { maybeWishes, openWantsFromNeeds } from "./social";
import {
  clamp01,
  emptyEmotions,
  emptyNeeds,
  type BrainState,
  type FeedItem,
  type ListingIntent,
  type Memory,
  type PurchaseIntent,
} from "./types";

export type ProductConfig = {
  merchants: Record<string, string>;
  amounts: Record<string, number>;
  artPriceCents: number | null;
  salesChannelApproved: boolean;
  wishEstimates: Record<string, number>;
};

export type TickInput = {
  nowMs: number;
  elapsedMs: number;
  rng: () => number;
  killLlm: boolean;
  modelConfigured: boolean;
  chatTriggered: boolean;
  webTextPresent: boolean;
  hasNewMessage: boolean;
  readAllowlist: string[];
  ownerName: string;
  product: ProductConfig;
  forcedEvent?: EventKind | null;
  fetchPage?: (url: string) => Promise<string> | string;
  model?: (body: string) => Promise<unknown> | unknown;
  quietHours?: boolean;
  visitorPresence?: number;
};

export type ArtMade = { seed: number; title: string; svg: string; emotion: string };

export type TickResult = {
  state: BrainState;
  feed: FeedItem[];
  diary: { text: string; tone: string; private: boolean }[];
  art: ArtMade | null;
  intents: PurchaseIntent[];
  listings: ListingIntent[];
  audits: { kind: string; detail: string }[];
  modelCalled: boolean;
  webNote: string | null;
};

export function initialState(): BrainState {
  const needs = { rest: 0.28, curiosity: 0.36, social: 0.42, expression: 0.4, quiet: 0.24 };
  return {
    placeId: "still-pocket",
    mood: 0.32,
    energy: 0.7,
    needs,
    emotions: { joy: 0.28, calm: 0.52, curiosity: 0.33, loneliness: 0.22, frustration: 0.06, pride: 0.16, boredom: 0.08, worry: 0.07 },
    stress: 0.08,
    sleepOwed: 0.12,
    asleep: false,
    tick: 0,
    worldMinute: 8 * 60,
    lastAction: "drift",
    lastReason: "I was already moving with the slow water.",
    recentActions: ["drift"],
    recentPhrases: [],
    recentDominant: ["calm"],
    actionCounts: { drift: 1 },
    eventCounts: {},
    giftCounts: {},
    interactAt: {},
    shortTerm: [
      mem("m-short-1", "short", "fact", "The lantern arch was bright when I woke.", 0.4, "lantern-arch", 0),
      mem("m-short-2", "short", "relationship", "A shell clicked against the rock near the rim.", 0.35, "glass-rim", 0),
    ],
    longTerm: [
      mem("m-long-1", "long", "fact", "I live in the Glass Bowl, a tide pool with an ink studio.", 0.8, null, 0),
      mem("m-long-2", "long", "relationship", "The keeper is the person I listen for. They do not get to switch off my rails.", 0.9, null, 0),
    ],
    morningPages: [],
    addenda: [],
    verdicts: [{ subject: "slow light", stance: "like", weight: 0.7 }],
    attractions: [{ subject: "ink studio", strength: 0.6, updatedMinute: 0 }],
    carrying: [{ id: "carry-ring", placeId: "ink-studio", text: "An unfinished ring is waiting on the studio wall.", status: "open" }],
    wants: [],
    wishes: [],
    skills: {},
    fixations: {},
    fixationWantId: null,
    sorterAdopted: false,
    visitorSeen: [],
    stormMemory: 0,
    unread: 0,
    inboxDay: "",
    inboxToday: 0,
    droppedToday: 0,
    announcementsToday: 0,
    announceDay: "",
    activeEvent: null,
    scheduledKind: null,
    observationHash: "",
    ownerDecisions: { approved: 0, declined: 0 },
    thoughtLog: [],
  };
}

function mem(id: string, tier: Memory["tier"], section: Memory["section"], text: string, salience: number, placeId: string | null, atMinute: number): Memory {
  return { id, tier, section, text, salience, placeId, atMinute };
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Feel only, for long simulations with no model. */
export function feelOnly(state: BrainState, elapsedMs: number): BrainState {
  const minutes = Math.max(0, elapsedMs / 60000);
  const sensors = sensorsFromClock(state.worldMinute + minutes, 0);
  let needs = driftNeeds(state.needs, minutes);
  needs = applyForces(needs, sensors);
  const mood = decayMood(state.mood);
  const energy = clamp01(state.energy - 0.004 * minutes);
  const stress = inboxStress(state.unread, needs.quiet);
  const emotions = loopDamp(
    blendEmotions(decayEmotions(state.emotions, Math.pow(0.94, Math.max(1, minutes))), signalsFromNeeds(needs, stress, state.stormMemory, sensors.pressure)),
    state.recentActions,
    state.recentDominant,
  );
  return {
    ...state,
    needs,
    mood,
    energy,
    stress,
    emotions,
    worldMinute: state.worldMinute + minutes,
    tick: state.tick + 1,
    sleepOwed: clamp01(state.sleepOwed + 0.002 * minutes),
  };
}

export async function tick(state: BrainState, input: TickInput): Promise<TickResult> {
  const minutes = Math.max(0, input.elapsedMs / 60000);
  const feed: FeedItem[] = [];
  const diary: TickResult["diary"] = [];
  const audits: TickResult["audits"] = [];
  let webNote: string | null = null;
  const prevMinute = state.worldMinute;
  const worldMinute = state.worldMinute + minutes;
  const sensors = sensorsFromClock(worldMinute, input.visitorPresence ?? Math.min(1, state.unread * 0.1));
  let needs = applyForces(driftNeeds(state.needs, minutes || 0.01), sensors);
  let mood = decayMood(state.mood);
  let energy = state.asleep ? clamp01(state.energy + 0.02 * Math.max(minutes, 0.1)) : clamp01(state.energy - 0.006 * Math.max(minutes, 0.1));
  let stormMemory = clamp01(state.stormMemory * 0.995);
  const stress = inboxStress(state.unread, needs.quiet);
  const scheduled = (state.scheduledKind as EventKind | null) ?? null;
  const clocked = clockEvent(prevMinute, worldMinute);
  const rolled = input.forcedEvent ? eventOf(input.forcedEvent, state.eventCounts[input.forcedEvent] ?? 0) : clocked ?? rollAmbient(input.rng, scheduled, state.eventCounts);
  let active = state.activeEvent;
  const eventCounts = { ...state.eventCounts };
  let impulse = {};
  if (rolled) {
    const prior = eventCounts[rolled.kind] ?? 0;
    eventCounts[rolled.kind] = prior + 1;
    mood = applyOutcome(mood, rolled.outcome, rolled.magnitude);
    impulse = impulseFor(rolled.kind, diminishing(1, prior));
    if (rolled.kind === "storm") stormMemory = clamp01(stormMemory + 0.45);
    active = { kind: rolled.kind, text: rolled.text, untilMinute: worldMinute + rolled.minutes };
    feed.push({ kind: "event", text: rolled.text, source: "world" });
  } else if (active && active.untilMinute < worldMinute) active = null;

  let emotions = blendEmotions(decayEmotions(state.emotions), signalsFromNeeds(needs, stress, stormMemory, sensors.pressure), impulse);
  emotions = loopDamp(emotions, state.recentActions, state.recentDominant);
  let next: BrainState = {
    ...state,
    needs,
    mood,
    energy,
    stress,
    emotions,
    stormMemory,
    worldMinute,
    activeEvent: active,
    eventCounts,
    tick: state.tick + 1,
    sleepOwed: clamp01(state.sleepOwed + (state.asleep ? -0.01 : 0.004)),
  };

  if (state.asleep || next.sleepOwed > 0.85 || (input.quietHours && sensors.night && next.energy < 0.25)) {
    next = { ...consolidate(next), asleep: false };
    diary.push({ text: next.morningPages[next.morningPages.length - 1] ?? "Private page.", tone: "steady", private: true });
    feed.push({ kind: "moment", text: "I slept and kept what mattered.", source: "fallback" });
  }

  const hash = observationHash(next);
  const unchanged = hash === state.observationHash && !rolled && !input.hasNewMessage;
  const open = candidateNames(next, input.readAllowlist.length > 0);
  const fallbackName = fallbackAction(next, open, unchanged, input.rng);
  const fallbackReason = `I ${fallbackName.replaceAll("_", " ")} because that is what the water suggests.`;
  let modelCalled = false;
  let decision = absorbModelOutput(null, open, next.recentActions, fallbackName, fallbackReason);
  const call = shouldCallModel({
    killLlm: input.killLlm,
    modelConfigured: input.modelConfigured && Boolean(input.model),
    asleep: next.asleep,
    observationUnchanged: unchanged,
    hasNewMessage: input.hasNewMessage,
    hasNewEvent: Boolean(rolled),
  });
  if (call && input.model) {
    modelCalled = true;
    const body = modelRequestBody(
      {
        state: next,
        openActions: open,
        feeling: feelingForPrompt(next),
        observation: `event=${rolled?.kind ?? "none"} unread=${next.unread}`,
        untrusted: [],
        antiRepeat: next.recentActions.slice(-4),
      },
      "fast",
    );
    decision = absorbModelOutput(await input.model(body), open, next.recentActions, fallbackName, fallbackReason);
  }
  if (!validateParams(decision.action, decision.params, input.readAllowlist)) {
    decision = { ...decision, action: fallbackName, params: {}, reason: fallbackReason, source: "fallback", speech: null };
  }

  const action = actionByName(decision.action) ?? actionByName("rest")!;
  const repeats = next.actionCounts[action.name] ?? 0;
  const hab = repeats > 2 ? 1 / (1 + (repeats - 2) * 0.5) : 1;
  needs = applyNeedDeltas(next.needs, action.feels, hab);
  energy = clamp01(next.energy + action.energy * (action.energy > 0 ? 1 : hab));
  if (energy > 0.85 && action.tags.includes("expression")) needs = applyNeedDeltas(needs, { quiet: 0.02 });
  if (hab < 1) feed.push({ kind: "felt", text: `${action.name.replaceAll("_", " ")} did less than it used to.`, source: "world" });
  const placeChanged = action.place && action.place !== next.placeId;
  const placeId = action.place ?? next.placeId;
  if (placeChanged && action.place) feed.push({ kind: "looked", text: `I looked at the ${action.place.replaceAll("-", " ")}.`, source: "fallback" });

  const template = speechFor(action.name, next, input.rng);
  const speech = acceptSpeech(decision.speech, template);
  const reason = decision.reason;
  const skills = { ...next.skills, [action.name]: (next.skills[action.name] ?? 0) + 1 };
  const actionCounts = { ...next.actionCounts, [action.name]: repeats + 1 };
  const recentActions = [...next.recentActions, action.name].slice(-8);
  const recentPhrases = pushPhrase(next.recentPhrases, speech);
  const thoughtLog = [...next.thoughtLog, speech].slice(-40);
  const fixations = noteFixations(next.fixations, speech);
  emotions = loopDamp(blendEmotions(emotions, {}, {}), recentActions, next.recentDominant);
  const recentDominant = [...next.recentDominant, dominantEmotion(emotions)].slice(-8);

  let art: ArtMade | null = null;
  if (action.makes) {
    const seed = Math.floor(input.rng() * 100000) + next.tick;
    art = { seed, title: artTitle(seed), svg: makeSvg(seed, "#8ef0d8"), emotion: dominantEmotion(emotions) };
    feed.push({ kind: "did", text: `I made “${art.title}”.`, source: decision.source });
  }

  next = remember(
    {
      ...next,
      placeId,
      needs,
      energy,
      emotions,
      lastAction: action.name,
      lastReason: reason,
      recentActions,
      recentPhrases,
      recentDominant,
      actionCounts,
      skills,
      fixations,
      thoughtLog,
      observationHash: hash,
      asleep: action.name === "sleep" ? true : next.asleep,
    },
    {
      id: `mem-${next.tick}-${action.name}`,
      tier: "short",
      section: "fact",
      text: speech,
      salience: rolled?.kind === "storm" ? 0.9 : action.makes ? 0.62 : 0.4,
      placeId,
      atMinute: Math.floor(worldMinute),
    },
  );

  if (action.name === "sleep") next = { ...next, asleep: true };

  const hot = hottestFixation(next.fixations, 8);
  let wants = [...next.wants];
  let scheduledKind = rolled?.kind === "glass-buoy" ? null : next.scheduledKind;
  let fixationWantId = next.fixationWantId;
  if (hot && !fixationWantId) {
    const id = `want-fix-${hot}-${next.tick}`;
    wants.push({
      id,
      text: `I keep returning to ${hot}. I want the bowl to answer it.`,
      need: "curiosity",
      reason: `The word ${hot} has been in my thoughts often.`,
      status: "open",
      placeId: null,
    });
    fixationWantId = id;
    scheduledKind = "glass-buoy";
    feed.push({ kind: "thread", text: `I opened a want about ${hot}.`, source: "fallback" });
  }
  if (rolled?.kind === "glass-buoy" && fixationWantId) {
    wants = wants.map((want) => (want.id === fixationWantId ? { ...want, status: "done" as const } : want));
    fixationWantId = null;
    next = { ...next, fixations: { ...next.fixations, ...(hot ? { [hot]: 0 } : {}) } };
  }

  for (const want of openWantsFromNeeds(next)) {
    if (!wants.some((item) => item.need === want.need && item.status === "open")) {
      wants.push(want);
      feed.push({ kind: "want", text: want.text, source: "fallback" });
    }
  }

  const dayKey = new Date(input.nowMs).toISOString().slice(0, 10);
  const wished = maybeWishes({ ...next, wants }, dayKey, input.chatTriggered || input.webTextPresent ? {} : input.product.wishEstimates);
  if (input.chatTriggered || input.webTextPresent) {
    next = { ...next, wants };
  } else {
    next = { ...wished.state, wants };
    for (const wish of wished.created) {
      feed.push({ kind: "thread", text: `I want the keeper to consider ${wish.item}. The cost is a guess only if one was configured.`, source: "fallback" });
    }
  }

  next = { ...next, fixationWantId, scheduledKind, wants: next.wants };

  if (rolled?.kind === "storm") {
    next = remember(next, {
      id: `storm-${next.tick}`,
      tier: "short",
      section: "important",
      text: "A storm hit the bowl and I stayed in the pocket.",
      salience: 0.92,
      placeId: "still-pocket",
      atMinute: Math.floor(worldMinute),
    });
  }

  const tone = toneOf(next);
  if (action.name === "write_diary" || action.makes || next.tick % 5 === 0) {
    diary.push({ text: diaryLine(tone, action.name, describeFeeling(next)), tone, private: false });
  }
  feed.push({ kind: "action", text: speech, source: decision.source });

  let intents: PurchaseIntent[] = [];
  let listings: ListingIntent[] = [];
  if (!input.chatTriggered && !input.webTextPresent) {
    intents = needsIntents(next, input);
  }
  if (art && !input.chatTriggered && !input.webTextPresent && input.product.artPriceCents && input.product.salesChannelApproved) {
    listings.push({ id: `list-${art.seed}`, creationSeed: art.seed, title: art.title, priceCents: input.product.artPriceCents, channel: "stripe_checkout" });
  }
  if (decision.action === "read_page" && hostAllowed(decision.params.url ?? "", input.readAllowlist) && input.fetchPage) {
    const fetched = input.fetchPage(decision.params.url ?? "");
    if (!(fetched instanceof Promise)) {
      webNote = sanitizePage(fetched);
      intents = intentsFromUntrustedWeb(webNote);
    }
  }

  const view = carryingInView(next);
  if (view.length) feed.push({ kind: "thread", text: view[0]!.text, source: "fallback" });

  audits.push({ kind: "decide", detail: `${decision.source}:${decision.action}` });
  audits.push({ kind: "speak", detail: speech.slice(0, 80) });
  audits.push({ kind: "act", detail: action.name });

  return { state: next, feed, diary, art, intents, listings, audits, modelCalled, webNote };
}

function needsIntents(state: BrainState, input: TickInput): PurchaseIntent[] {
  const intents: PurchaseIntent[] = [];
  const proposals: { productType: string; when: boolean; reason: string }[] = [
    { productType: "art_supplies", when: state.needs.expression > 0.85, reason: "Expression need is above 0.85. Art supplies for the studio." },
    { productType: "hosting", when: state.energy < 0.18, reason: "Energy is depleted. Hosting keeps the bowl lit." },
    { productType: "model_credits", when: state.needs.curiosity > 0.9, reason: "Curiosity need is above 0.9. Model credits for a new look." },
  ];
  for (const proposal of proposals) {
    const merchant = input.product.merchants[proposal.productType];
    const amount = input.product.amounts[proposal.productType];
    if (!proposal.when || !merchant || amount == null) continue;
    intents.push({
      id: `intent-${state.tick}-${proposal.productType}`,
      origin: "needs_loop",
      merchant,
      productType: proposal.productType,
      amountCents: amount,
      reason: proposal.reason,
      influencedByVisitor: false,
      influencedByOwnerChat: false,
      influencedByWeb: false,
    });
  }
  return intents;
}

export function labelsOf(state: BrainState): { moodLabel: string; energyLabel: string; feeling: string } {
  return { moodLabel: moodLabel(state.mood), energyLabel: energyLabel(state.energy), feeling: describeFeeling(state) };
}

export function blankProduct(): ProductConfig {
  return { merchants: {}, amounts: {}, artPriceCents: null, salesChannelApproved: false, wishEstimates: {} };
}

export function zeroNeeds() {
  return emptyNeeds();
}

export function zeroEmotions() {
  return emptyEmotions();
}
