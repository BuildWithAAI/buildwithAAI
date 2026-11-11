export const NEED_NAMES = ["rest", "curiosity", "social", "expression", "quiet"] as const;
export type NeedName = (typeof NEED_NAMES)[number];
export type Needs = Record<NeedName, number>;

export const EMOTION_NAMES = [
  "joy",
  "calm",
  "curiosity",
  "loneliness",
  "frustration",
  "pride",
  "boredom",
  "worry",
] as const;
export type EmotionName = (typeof EMOTION_NAMES)[number];
export type Emotions = Record<EmotionName, number>;

export type MemoryTier = "short" | "long";
export type MemorySection = "relationship" | "fact" | "important" | "skill";

export type Memory = {
  id: string;
  tier: MemoryTier;
  section: MemorySection;
  text: string;
  salience: number;
  placeId: string | null;
  atMinute: number;
  /** Who produced this line, and which path produced it. Absent on older memories. */
  provenance?: { who: string; what: string };
};

export type Verdict = { subject: string; stance: "like" | "dislike"; weight: number };
export type Attraction = { subject: string; strength: number; updatedMinute: number };
export type Want = {
  id: string;
  text: string;
  need: string;
  reason: string;
  status: "open" | "done" | "abandoned";
  placeId: string | null;
};
export type Carry = { id: string; placeId: string; text: string; status: "open" | "done" };

export type Wish = {
  id: string;
  catalogId: string;
  item: string;
  estimateCents: number | null;
  why: string;
  earnHow: string;
  priority: "low" | "medium" | "high";
  status: "open" | "approved" | "declined" | "asked_more";
  dayKey: string;
  influencedByWeb?: boolean;
};

export type BrainState = {
  placeId: string;
  mood: number;
  energy: number;
  needs: Needs;
  emotions: Emotions;
  stress: number;
  sleepOwed: number;
  asleep: boolean;
  tick: number;
  worldMinute: number;
  lastAction: string;
  lastReason: string;
  recentActions: string[];
  recentPhrases: string[];
  recentDominant: EmotionName[];
  actionCounts: Record<string, number>;
  eventCounts: Record<string, number>;
  giftCounts: Record<string, number>;
  interactAt: Record<string, number>;
  shortTerm: Memory[];
  longTerm: Memory[];
  morningPages: string[];
  addenda: string[];
  verdicts: Verdict[];
  attractions: Attraction[];
  carrying: Carry[];
  wants: Want[];
  wishes: Wish[];
  skills: Record<string, number>;
  fixations: Record<string, number>;
  fixationWantId: string | null;
  sorterAdopted: boolean;
  visitorSeen: string[];
  stormMemory: number;
  unread: number;
  inboxDay: string;
  inboxToday: number;
  droppedToday: number;
  announcementsToday: number;
  announceDay: string;
  activeEvent: { kind: string; text: string; untilMinute: number } | null;
  scheduledKind: string | null;
  observationHash: string;
  ownerDecisions: { approved: number; declined: number };
  thoughtLog: string[];
};

export type Sensors = {
  noise: number;
  brightness: number;
  visitorPresence: number;
  tide: number;
  season: "spring" | "summer" | "autumn" | "winter";
  night: boolean;
  pressure: number;
};

export type FeedItem = {
  kind: "action" | "moment" | "thread" | "event" | "felt" | "looked" | "want" | "did";
  text: string;
  source: "fallback" | "model" | "world" | "visitor" | "owner";
};

export type PurchaseIntent = {
  id: string;
  origin: "needs_loop" | "owner_approved_wishlist";
  merchant: string;
  productType: string;
  amountCents: number;
  reason: string;
  influencedByVisitor: boolean;
  influencedByOwnerChat: boolean;
  influencedByWeb: boolean;
};

export type ListingIntent = {
  id: string;
  creationSeed: number;
  title: string;
  priceCents: number;
  channel: "stripe_checkout";
};

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000;
}

export function clampMood(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.min(1, Math.max(-1, n)) * 10000) / 10000;
}

export function emptyNeeds(value = 0): Needs {
  return { rest: value, curiosity: value, social: value, expression: value, quiet: value };
}

export function emptyEmotions(value = 0): Emotions {
  return {
    joy: value,
    calm: value,
    curiosity: value,
    loneliness: value,
    frustration: value,
    pride: value,
    boredom: value,
    worry: value,
  };
}
