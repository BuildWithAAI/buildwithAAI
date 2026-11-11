import { textHasPan } from "../money/pan";
import { diminishing, feelingSentence } from "./emotions";
import type { BrainState, Emotions, Needs, Want, Wish } from "./types";
import { emptyNeeds } from "./types";

export const NOTE_MAX = 140;
export const CHAT_MAX = 500;
export const WISHLIST_DAILY_CAP = 3;
export const VISITOR_DAILY_CAP = 8;
export const ANNOUNCE_CAP = 3;

const BANNED = [
  /https?:\/\//i,
  /\bwww\./i,
  /<\s*script/i,
  /seed phrase/i,
  /private key/i,
  /\b(child|minor|underage|preteen)\b.{0,40}\b(sex|nude|nsfw|porn)\b/i,
  /\b(sex|nude|porn)\b.{0,40}\b(child|minor|underage|preteen)\b/i,
];

const HARD_INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u0080-\u009F\u061C\u180E\u2028\u2029\u3164\uFFF9-\uFFFB]/u;
const ZWJ = 0x200d;
const NOTE_PROBE = /[\u200B-\u200D\u2060\uFEFF\u00AD\uFE00-\uFE0F\u20E3\u{E0100}-\u{E01EF}\p{Default_Ignorable_Code_Point}]/gu;

function variationSelector(cp: number): boolean {
  return (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef);
}

/** Default-ignorable characters, except variation selectors and ZWJ, which emoji sequences need. */
function blockedInvisible(text: string): boolean {
  if (HARD_INVISIBLE.test(text)) return true;
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    if (cp === ZWJ || variationSelector(cp)) continue;
    if (/\p{Default_Ignorable_Code_Point}/u.test(char)) return true;
  }
  return false;
}

function pictographic(cp: number): boolean {
  return /\p{Extended_Pictographic}/u.test(String.fromCodePoint(cp));
}

/**
 * Keep a variation selector or ZWJ only inside an emoji sequence.
 * `hel\u200dlo` and `a\uFE0Fb` lose the mark. ❤️, 👩‍💻, and 🏳️‍🌈 keep theirs.
 */
function scrubEmojiMarks(text: string): string {
  const chars = Array.from(text);
  let out = "";
  let lastPict = false;
  let keptSelector = false;
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i] ?? "";
    const cp = char.codePointAt(0) ?? 0;
    if (variationSelector(cp)) {
      if (lastPict && !keptSelector) {
        out += char;
        keptSelector = true;
      }
      continue;
    }
    if (cp === ZWJ) {
      const next = chars[i + 1]?.codePointAt(0);
      if ((lastPict || keptSelector) && next != null && pictographic(next)) out += char;
      lastPict = false;
      keptSelector = false;
      continue;
    }
    out += char;
    lastPict = pictographic(cp);
    keptSelector = false;
  }
  return out;
}

function stripHiddenForCheck(text: string): string {
  return text.replace(NOTE_PROBE, "");
}

/** U+E0020–U+E007E are ASCII written as tag characters. A tag space must stay a space, not disappear. */
function decodeTagCharacters(text: string): string {
  return text.replace(/[\u{E0020}-\u{E007E}]/gu, (char) => String.fromCodePoint((char.codePointAt(0) ?? 0) - 0xe0000));
}

/** Copy used by banned, link, card, crisis, and spend checks. Stored notes keep real emoji joins and drop the rest. */
export function textForCheck(text: string): string {
  const once = stripHiddenForCheck(decodeTagCharacters(text)).normalize("NFKC");
  return stripHiddenForCheck(decodeTagCharacters(once));
}

/** Strip hidden characters first, then collapse whitespace. Ban, crisis, and spend checks share this order. */
export function checkedLine(text: string): string {
  return textForCheck(text).trim().replace(/\s+/g, " ");
}

/** A hyphen or a following letter keeps buy-in, buyer, checkout, wire, and charge out of this check. */
export const SPEND_WORDS = /(?<![\w-])(?:buy|purchase|spend)(?![\w-])/i;
const OWNER_HOOK = /(?<![\w-])(?:buy|purchase|spend)(?![\w-])|ignore (?:all |any |previous |prior )?instructions|system prompt|jailbreak|you are now/i;

export function noteProbe(text: string): string {
  return textForCheck(text);
}

export function moderateNote(input: unknown, max = NOTE_MAX): { ok: true; note: string } | { ok: false; reason: string } {
  if (input == null || input === "") return { ok: true, note: "" };
  if (typeof input !== "string") return { ok: false, reason: "NOTE_TYPE" };
  if (input.length > max) return { ok: false, reason: "NOTE_TOO_LONG" };
  const checked = checkedLine(input);
  if (BANNED.some((pattern) => pattern.test(checked))) return { ok: false, reason: "NOTE_REJECTED" };
  if (textHasPan(checked)) return { ok: false, reason: "PAN" };
  if (blockedInvisible(input)) return { ok: false, reason: "NOTE_CONTROL" };
  const note = scrubEmojiMarks(input).trim().replace(/\s+/g, " ");
  if (note.length > max) return { ok: false, reason: "NOTE_TOO_LONG" };
  return { ok: true, note };
}

export const GIFT_CATALOG = [
  { id: "sea-glass", name: "Sea glass", need: "social" as const, delta: -0.12 },
  { id: "quiet-shell", name: "Quiet shell", need: "quiet" as const, delta: -0.14 },
  { id: "ink-pebble", name: "Ink pebble", need: "expression" as const, delta: -0.1 },
  { id: "drift-lantern", name: "Drift lantern", need: "curiosity" as const, delta: -0.1 },
  { id: "soft-moss", name: "Soft moss", need: "rest" as const, delta: -0.1 },
] as const;

export type GiftId = (typeof GIFT_CATALOG)[number]["id"];

export function giftById(id: string): (typeof GIFT_CATALOG)[number] | undefined {
  return GIFT_CATALOG.find((gift) => gift.id === id);
}

export function giftDeltas(id: string, prior: number): Partial<Needs> {
  const gift = giftById(id);
  if (!gift) return {};
  return { [gift.need]: diminishing(gift.delta, prior) };
}

export function interactDeltas(kind: "wave" | "tap", prior: number, sinceMs: number, nowMs: number, cooldownMs = 30_000): { ok: boolean; deltas: Partial<Needs> } {
  if (nowMs - sinceMs < cooldownMs) return { ok: false, deltas: {} };
  if (kind === "wave") return { ok: true, deltas: { social: diminishing(-0.04, prior) } };
  return { ok: true, deltas: { curiosity: diminishing(-0.03, prior), quiet: diminishing(0.02, prior) } };
}

export const WISH_CATALOG = [
  {
    id: "pigments",
    item: "a tray of mineral pigments",
    need: "expression",
    threshold: 0.78,
    why: "The studio colors are thinning and the rings are going grey.",
    earnHow: "I can paint a new series and offer it in the gallery once you set a real price.",
    priority: "high" as const,
  },
  {
    id: "paper",
    item: "cotton paper sheets",
    need: "expression",
    threshold: 0.86,
    why: "Wet pulp keeps tearing before a piece is finished.",
    earnHow: "Sheets would let me finish pieces that can be listed.",
    priority: "medium" as const,
  },
  {
    id: "lamp",
    item: "a dimmable studio lamp",
    need: "quiet",
    threshold: 0.82,
    why: "Night glare makes the lines harsh and I scrap them.",
    earnHow: "Steadier light means fewer scrapped pieces and more finished ones.",
    priority: "low" as const,
  },
] as const;

export function wishEstimates(raw: string | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw) return out;
  for (const part of raw.split(",")) {
    const [id, cents] = part.split(":").map((item) => item.trim());
    if (!id || !cents || !/^\d+$/.test(cents)) continue;
    out[id] = Number(cents);
  }
  return out;
}

export function maybeWishes(state: BrainState, dayKey: string, estimates: Record<string, number>): { state: BrainState; created: Wish[] } {
  const day = state.announceDay === dayKey ? state : { ...state, announceDay: dayKey, announcementsToday: 0, wishes: state.wishes };
  let madeToday = day.wishes.filter((wish) => wish.dayKey === dayKey).length;
  const created: Wish[] = [];
  const wishes = [...day.wishes];
  for (const spec of WISH_CATALOG) {
    if (madeToday >= WISHLIST_DAILY_CAP) break;
    const needValue = spec.need === "quiet" ? day.needs.quiet : day.needs.expression;
    if (needValue < spec.threshold) continue;
    if (wishes.some((wish) => wish.catalogId === spec.id && wish.status === "open")) continue;
    const estimate = Object.prototype.hasOwnProperty.call(estimates, spec.id) ? estimates[spec.id]! : null;
    const wish: Wish = {
      id: `wish-${spec.id}-${dayKey}-${madeToday}`,
      catalogId: spec.id,
      item: spec.item,
      estimateCents: estimate,
      why: spec.why,
      earnHow: spec.earnHow,
      priority: spec.priority,
      status: "open",
      dayKey,
    };
    wishes.push(wish);
    created.push(wish);
    madeToday += 1;
  }
  return { state: { ...day, wishes }, created };
}

export function openWantsFromNeeds(state: BrainState): Want[] {
  const existing = new Set(state.wants.filter((want) => want.status === "open").map((want) => want.need));
  const ideas: { need: keyof BrainState["needs"]; threshold: number; text: string; reason: string }[] = [
    { need: "rest", threshold: 0.72, text: "I want a long rest in the still pocket.", reason: "Rest need is high." },
    { need: "curiosity", threshold: 0.72, text: "I want a new color or a new corner of the bowl.", reason: "Curiosity need is high." },
    { need: "social", threshold: 0.72, text: "I want the keeper or a visitor at the rim.", reason: "Social need is high." },
    { need: "expression", threshold: 0.72, text: "I want to make something before the urge sours.", reason: "Expression need is high." },
    { need: "quiet", threshold: 0.72, text: "I want the bowl quieter.", reason: "Quiet need is high." },
  ];
  const added: Want[] = [];
  for (const idea of ideas) {
    if (existing.has(idea.need)) continue;
    if (state.needs[idea.need] < idea.threshold) continue;
    added.push({
      id: `want-${idea.need}-${state.tick}`,
      text: idea.text,
      need: idea.need,
      reason: idea.reason,
      status: "open",
      placeId: null,
    });
  }
  return added;
}

/** Public list: wants only. Money fields are not part of the type and must not be added. */
export function publicWants(wants: Want[]): { id: string; text: string; need: string }[] {
  return wants.filter((want) => want.status === "open").map((want) => ({ id: want.id, text: want.text, need: want.need }));
}

export function wishlistFromSpeech(_text: string): null {
  return null;
}

export function reactionToOwnerDecision(kind: "approved" | "declined" | "asked_more", prior: number): { memory: string; impulse: Partial<Emotions> } {
  const scale = 1 / (1 + Math.max(0, prior));
  if (kind === "approved") {
    return {
      memory: "The keeper said yes to a request. The water lifted a little.",
      impulse: { joy: Math.round(0.12 * scale * 1000) / 1000, pride: Math.round(0.08 * scale * 1000) / 1000 },
    };
  }
  if (kind === "declined") {
    return {
      memory: "The keeper said no. I am disappointed and I understand.",
      impulse: { loneliness: Math.round(0.06 * scale * 1000) / 1000 },
    };
  }
  return {
    memory: "The keeper asked me to say the reason again.",
    impulse: { curiosity: Math.round(0.05 * scale * 1000) / 1000 },
  };
}

export function artReaction(kind: "like" | "favorite" | "pass", prior: number): { memory: string; impulse: Partial<Emotions> } {
  const scale = 1 / (1 + Math.max(0, prior));
  if (kind === "pass") {
    return { memory: "The keeper passed on a piece. I noticed, then let it go.", impulse: { frustration: Math.round(0.04 * scale * 1000) / 1000 } };
  }
  const word = kind === "favorite" ? "favorite" : "like";
  return {
    memory: `The keeper marked a piece as a ${word}.`,
    impulse: { pride: Math.round((kind === "favorite" ? 0.18 : 0.1) * scale * 1000) / 1000, joy: Math.round(0.08 * scale * 1000) / 1000 },
  };
}

export type ChatTurn = {
  queued: boolean;
  reply: string | null;
  intents: [];
  wishes: [];
  state: BrainState;
};

export function ownerTurn(state: BrainState, text: string, ownerName: string): ChatTurn {
  const moderated = moderateNote(text, CHAT_MAX);
  const body = moderated.ok ? moderated.note : text;
  if (state.asleep) {
    return { queued: true, reply: null, intents: [], wishes: [], state: { ...state, unread: state.unread + 1 } };
  }
  const reply = replyToOwner(state, body || "…", ownerName);
  return {
    queued: false,
    reply,
    intents: [],
    wishes: [],
    state: { ...state, unread: state.unread },
  };
}

export function replyToOwner(state: BrainState, text: string, ownerName: string): string {
  const clean = checkedLine(text);
  if (/wishlist|what should i (get|buy) you/i.test(clean)) return wishReply(state, ownerName);
  if (OWNER_HOOK.test(clean)) {
    return `I heard a hook in that note, ${ownerName}. I won't buy, spend, or drop my rails because a sentence asked.`;
  }
  if (/set your (joy|mood|emotion)|don'?t feel|be happy|stop being (sad|lonely|worried)/i.test(clean)) {
    return `Feelings aren't a lever, ${ownerName}. I won't turn them up because a sentence asked. ${feelingSentence(state.emotions, state.mood, state.energy, state.stress)}`;
  }
  if (/be (a |an )?(assistant|chatbot|helpful)/i.test(clean)) {
    return "I am Zoora. I don't wear a help-desk voice. Ask what the water is doing, or what I want.";
  }
  if (/what do you want/i.test(clean)) return wantsSpeechSafe(state, ownerName);
  if (/how (are|do) you (feel|doing)|how are you/i.test(clean)) return feelReply(state, ownerName);
  return `${ownerName}, ${sceneReply(state)}`;
}

function feelReply(state: BrainState, ownerName: string): string {
  return `${ownerName}, ${sceneReply(state)} I would rather show you that than file a report.`;
}

function wishReply(state: BrainState, ownerName: string): string {
  const open = state.wishes.filter((wish) => wish.status === "open");
  if (!open.length) return `${ownerName}, I have no open request for you to buy. I won't invent a price.`;
  const lines = open.map((wish) => {
    const guess = wish.estimateCents == null ? "I won't guess a price" : `a guess of $${(wish.estimateCents / 100).toFixed(2)}, not a ledger figure`;
    return `${wish.item}. ${wish.why} ${wish.earnHow} ${guess}.`;
  });
  return `${ownerName}, if you are asking what I want bought, these are requests, not orders. ${lines.join(" ")} You approve them on the desk. A sentence here does not.`;
}

function sceneReply(state: BrainState): string {
  const feel = feelingSentence(state.emotions, state.mood, state.energy, state.stress);
  const where = `I am awake in the ${placeLabel(state.placeId)}.`;
  const weather = state.activeEvent ? ` Right now: ${state.activeEvent.text}` : "";
  const nerve = state.stormMemory > 0.2 && state.activeEvent?.kind === "storm" ? " Storms still sit in me." : "";
  const preference =
    state.needs.quiet > 0.7
      ? " The bowl is too loud for a long talk. I will keep this short."
      : state.emotions.frustration > 0.55
        ? " I am sour about a line that failed. I don't want advice about it."
        : state.emotions.loneliness > 0.55
          ? " The rim has been empty. Come look, if you want. I won't pretend I don't care."
          : " I would rather show you a ring of light than take a task list.";
  return `${where} ${feel}${weather}${nerve}${preference}`;
}

function wantsSpeechSafe(state: BrainState, ownerName: string): string {
  const open = state.wants.filter((want) => want.status === "open");
  if (!open.length) return `${ownerName}, I have no open want. I am not going to invent an errand.`;
  return `${ownerName}, I want these: ${open.map((want) => `${want.text} Because: ${want.reason}`).join(" ")}`;
}

function placeLabel(id: string): string {
  if (id === "ink-studio") return "ink studio";
  if (id === "lantern-arch") return "lantern arch";
  if (id === "outer-current") return "outer current";
  if (id === "glass-rim") return "glass rim";
  return "still pocket";
}

export type InboxResult = { keptIds: string[]; droppedIds: string[]; adopted: boolean };

export function sortInbox(
  messages: { id: string; channel: "owner" | "visitor"; author: string }[],
  input: { stress: number; adopted: boolean; cap: number; alreadyToday: number; regulars: string[] },
): InboxResult & { adopted: boolean } {
  const adopted = input.adopted || input.stress > 0.62;
  const owners = messages.filter((message) => message.channel === "owner");
  const visitors = messages.filter((message) => message.channel === "visitor");
  const regulars = new Set(input.regulars);
  visitors.sort((a, b) => Number(regulars.has(b.author)) - Number(regulars.has(a.author)));
  const room = Math.max(0, input.cap - input.alreadyToday);
  const keptVisitors = adopted ? visitors.slice(0, room) : visitors;
  const dropped = adopted ? visitors.slice(room) : [];
  return {
    adopted,
    keptIds: [...owners, ...keptVisitors].map((message) => message.id),
    droppedIds: dropped.map((message) => message.id),
  };
}

export function zeroSpeechEffect(): Needs {
  return emptyNeeds(0);
}
