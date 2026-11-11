import { CRISIS_REPLY, NEUTRAL_REPLY } from "../brain/crisis";

const SAND = "I set your note on the sand. I'll read it when the water is quiet. Zoora is an AI, not a human.";
const CRISIS_BUBBLE = "If you are in crisis, call or text 988. Zoora is an AI, not a human.";
const FALLBACK = "I'm drifting in the bowl.";

const BLOCKED = /https?:\/\/|\bwww\.|sk_|seed phrase|private key|\bwallet\b|0x[a-fA-F0-9]{8,}|\b(spend|checkout|buy now|wire|mint)\b/i;

export type ThoughtInput = {
  activity: string | null;
  diary: string | null;
  sceneWhy: string | null;
  wish: string | null;
  guestReply: string | null;
};

/** A guestbook reply is shown only when it is one of Zoora's own canned lines. */
export function bubbleGuestReply(reply: string | null | undefined): string | null {
  if (!reply) return null;
  if (reply === CRISIS_REPLY) return CRISIS_BUBBLE;
  if (reply === NEUTRAL_REPLY) return NEUTRAL_REPLY;
  if (reply === SAND) return "I set a note on the sand. I'll read it when the water is quiet.";
  return null;
}

export function sanitizeThought(text: string | null | undefined): string | null {
  if (typeof text !== "string") return null;
  const clean = text.replace(/\s+/g, " ").replace(/[\u0000-\u001F]/g, "").trim();
  if (clean.length < 2 || clean.length > 180) return null;
  if (BLOCKED.test(clean)) return null;
  return clean;
}

/** Lines from her own state. A visitor's words are not an input. */
export function thoughtLines(input: ThoughtInput): string[] {
  const guest = bubbleGuestReply(input.guestReply);
  const lines = [input.activity, input.diary, input.sceneWhy, input.wish, guest]
    .map((line) => sanitizeThought(line))
    .filter((line): line is string => Boolean(line));
  const unique = [...new Set(lines)];
  return unique.length ? unique.slice(0, 5) : [FALLBACK];
}
