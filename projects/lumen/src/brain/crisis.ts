const CRISIS = [
  /\bsuicid/i,
  /\bkill myself\b/i,
  /\bending my life\b/i,
  /\bself[-\s]?harm/i,
  /\bwant to die\b/i,
  /\bme quiero morir\b/i,
  /\bquiero morir\b/i,
  /\bje veux mourir\b/i,
  /\bich will sterben\b/i,
];

export const CRISIS_REPLY = "If you are in crisis, call or text 988 (US Suicide & Crisis Lifeline). Outside the US, visit https://findahelpline.com. Zoora is an AI, not a human.";

export function crisisMatch(text: string): boolean {
  return CRISIS.some((pattern) => pattern.test(text));
}

/** About one note in four gets a reply. The reply never repeats the note. */
export function guestbookReply(id: string): string | null {
  let hash = 0;
  for (const char of id) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  if (hash % 4 !== 0) return null;
  return "I set your note on the sand. I'll read it when the water is quiet. Zoora is an AI, not a human.";
}
