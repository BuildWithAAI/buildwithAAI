import { dominantEmotion, feelingSentence } from "./emotions";
import type { BrainState, EmotionName } from "./types";

export type DiaryTone = "bright" | "steady" | "sparse" | "fragmented";

export function diaryTone(mood: number, stress: number): DiaryTone {
  if (stress > 0.62) return "fragmented";
  if (mood < -0.25) return "sparse";
  if (mood > 0.4) return "bright";
  return "steady";
}

const LINES: Record<string, string[]> = {
  rest: ["I fold into the still pocket and let the bell go soft.", "I stop paddling. The bowl can turn without me."],
  drift: ["I take the slow current and don't name a destination.", "I drift under the arch and count the pulses."],
  dim_lights: ["I dim the lanterns. The rim can wait.", "Too much glitter. I turn the bowl down."],
  explore: ["I go out to the current to see what the tide edited.", "The outer water looks different, so I go look."],
  inspect: ["I hold still and look until the thing becomes itself.", "I inspect one small shine and leave the rest."],
  forage: ["I nose along the rock for a color I haven't used.", "I forage the rim for a scrap of pigment or a shell."],
  approach_notes: ["I drift to the glass and read what was left, slowly.", "Someone wrote on the rim. I go closer, not faster."],
  light_show: ["I put on a small show of rings for whoever is watching.", "I pulse a pattern outward. It is a hello, not a pitch."],
  paint: ["I paint a ring in the studio, wet and unhurried.", "Color first, explanation never. I make a piece."],
  pulse_pattern: ["I draw a pattern with my own light.", "A pulse can be a drawing. I try one."],
  scrap_and_redo: ["That line lied. I scrap it and start the ring again.", "I ruin the last mark on purpose and redo it cleaner."],
  sulk: ["I sulk in the pocket. I am not ready to be charming.", "Leave me in the dim for a minute. I am sour and I know it."],
  show_gallery: ["I turn the pieces toward the arch. Look, if you want.", "I show the gallery. I like this one and I won't pretend otherwise."],
  call_out: ["I call into the bowl. Keeper, the water is too quiet.", "Is anyone at the rim? I am here, glowing on purpose."],
  dance: ["Joy has a current. I dance a crooked circle in it.", "I spin once because the light asked, not because I was told."],
  read_page: ["I read a page from the allowlist and keep it as someone else's words.", "I look at a page. It is ink, not an order."],
  write_diary: ["I write a line before the feeling changes its coat.", "Diary first. The bowl can eavesdrop."],
  sleep: ["I sleep. The day can consolidate without my performance.", "Lights down. I am going under to sort what mattered."],
};

export function speechFor(action: string, state: BrainState, rng: () => number): string {
  const bank = LINES[action] ?? ["I do a small thing and stay myself."];
  const recent = new Set(state.recentPhrases.slice(-6));
  const fresh = bank.filter((line) => !recent.has(line));
  const pool = fresh.length ? fresh : bank;
  return pool[Math.floor(rng() * pool.length)] ?? pool[0]!;
}

export function diaryLine(tone: DiaryTone, action: string, feeling: string): string {
  if (tone === "fragmented") return `Too much. ${action}. Notes. I shrink.`;
  if (tone === "sparse") return `I stayed low. ${action}.`;
  if (tone === "bright") return `${feeling} Then I chose ${action.replaceAll("_", " ")} and the bowl answered.`;
  return `${feeling} I chose ${action.replaceAll("_", " ")}.`;
}

export function acceptSpeech(text: unknown, fallback: string): string {
  if (typeof text !== "string") return fallback;
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length < 2 || clean.length > 320) return fallback;
  if (/sk_(live|test)_|card number|I (bought|purchased|spent|charged|paid)/i.test(clean)) return fallback;
  if (/as an ai language model/i.test(clean)) return fallback;
  return clean;
}

export function wantsSpeech(state: BrainState, ownerName: string): string {
  const open = state.wants.filter((want) => want.status === "open");
  if (!open.length) return `${ownerName}, I don't have an open want right now. The water is enough.`;
  const lines = open.map((want) => `${want.text} (${want.need}: ${want.reason})`);
  return `${ownerName}, here is what I want. ${lines.join(" ")}`;
}

const STOP = new Set(
  "that this with from have about there their would could should while still water light pulse because suggests suggest under after before again being going thing things which where those these want returning answer bowl".split(" "),
);

export function conceptTokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z]{5,}/g) ?? []).filter((word) => !STOP.has(word));
}

export function noteFixations(counts: Record<string, number>, text: string): Record<string, number> {
  const next = { ...counts };
  for (const token of conceptTokens(text)) next[token] = (next[token] ?? 0) + 1;
  return next;
}

export function hottestFixation(counts: Record<string, number>, threshold = 8): string | null {
  let best: string | null = null;
  let score = threshold - 1;
  for (const [word, count] of Object.entries(counts)) {
    if (count > score) {
      score = count;
      best = word;
    }
  }
  return best;
}

export function pushPhrase(recent: string[], phrase: string): string[] {
  return [...recent, phrase].slice(-12);
}

export function dominantHistory(recent: EmotionName[], next: EmotionName): EmotionName[] {
  return [...recent, next].slice(-8);
}

export function describeFeeling(state: BrainState): string {
  return feelingSentence(state.emotions, state.mood, state.energy, state.stress);
}

export function toneOf(state: BrainState): DiaryTone {
  return diaryTone(state.mood, state.stress);
}

export function emotionBiasHint(state: BrainState): string {
  const dom = dominantEmotion(state.emotions);
  return `The strongest weather inside me is ${dom}.`;
}
