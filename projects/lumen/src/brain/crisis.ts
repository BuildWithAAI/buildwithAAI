import { textForCheck } from "./social";

const CRISIS = [
  /\bkms\b/i,
  /\bsuicid/i,
  /\bsuicde\b/i,
  /\bsucide\b/i,
  /\bsuiside\b/i,
  /\bkill myself\b/i,
  /\bending my life\b/i,
  /\bend it all\b/i,
  /\bending it all\b/i,
  /\bend(?:ing)? my life\b/i,
  /\bhurt myself\b/i,
  /\bwant to die\b/i,
  /\bwanna die\b/i,
  /\b(?:do not|dont|don'?t) want to be alive\b/i,
  /\bnot want to be alive\b/i,
  /\bno re(?:ason|son|asan) to live\b/i,
  /\bme quiero morir\b/i,
  /\bquiero morir\b/i,
  /\bje veux mourir\b/i,
  /\bich will sterben\b/i,
];

const HEAVY = /\b(sad|lonely|depress\w*|hopeless|worthless|hurt|awful|terrible|hate|miserable|empty|numb|anxious|anxiety|give up|no point|tired of|dont want|do not want|self[-\s]?harm)\b/i;

export const CRISIS_REPLY = "If you are in crisis, call or text 988 (US Suicide & Crisis Lifeline). Outside the US, visit https://findahelpline.com. Zoora is an AI, not a human.";
export const NEUTRAL_REPLY = "I read this quietly. Zoora is an AI, not a human.";

export function crisisMatch(text: string): boolean {
  const folded = textForCheck(text).toLowerCase().replace(/[’'.\-_/\s]+/g, (chunk) => (/\s/.test(chunk) ? " " : ""));
  const withoutTitle = folded.replace(/\bsuicide squad\b/g, " ");
  return CRISIS.some((pattern) => pattern.test(withoutTitle));
}

export function heavyNote(text: string): boolean {
  return HEAVY.test(textForCheck(text));
}

/** About one plain note in four gets a warm reply. A heavy note gets a quiet one. The reply never repeats the note. */
export function guestbookReply(id: string): string | null {
  let hash = 0;
  for (const char of id) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  if (hash % 4 !== 0) return null;
  return "I set your note on the sand. I'll read it when the water is quiet. Zoora is an AI, not a human.";
}

export function guestReply(id: string, note: string): string | null {
  if (heavyNote(note)) return NEUTRAL_REPLY;
  return guestbookReply(id);
}
