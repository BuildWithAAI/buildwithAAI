import { createHash } from "node:crypto";
import { privateDeskHost, publicModeOn } from "../auth/publicMode";
import type { Needs, Wish } from "../brain/types";
import type { Env } from "../money/rules";
import { isPublicUrl, stripPage, type SearchHit } from "./search";

export type IdeaStatus = "seed" | "researching" | "promising" | "parked";
export type IdeaKind = "business" | "life";

export type Idea = {
  id: string;
  title: string;
  why: string;
  kind: IdeaKind;
  status: IdeaStatus;
  sourceKey: string | null;
  createdAt: number;
  updatedAt: number;
};

export type Finding = {
  id: string;
  ideaId: string;
  question: string;
  summary: string;
  sourceUrl: string;
  atMs: number;
};

export type Brief = {
  ideaId: string;
  problem: string;
  whoPays: string;
  costs: string;
  risks: string;
  firstTest: string;
  atMs: number;
};

export type IdeaSignals = {
  needs: Needs;
  wants: { text: string }[];
  soldTitles: string[];
  visitorNotes: string[];
  rememberedNoteKeys: string[];
  now: number;
  existingTitles: string[];
};

/** Pages stay data. They do not move feelings and they do not become intents. */
export function absorbUntrustedPage<E>(html: string, emotions: E): { text: string; intents: []; emotions: E } {
  return { text: stripPage(html), intents: [], emotions };
}

export function findingBody(summary: string): string {
  return summary.replace(/\s*Source:\s*https?:\/\/\S+/gi, "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** A repeat of a question, or a page we already kept, is not a new finding. */
export function nothingNew(prior: Finding[], question: string, candidate: { sourceUrl: string; summary: string } | null): boolean {
  const asked = prior.some((item) => item.question === question);
  if (!candidate) return asked;
  const body = findingBody(candidate.summary);
  const duplicateSource = prior.some((item) => item.sourceUrl === candidate.sourceUrl);
  const duplicateWords = body.length > 0 && prior.some((item) => findingBody(item.summary) === body);
  return duplicateSource || duplicateWords || (asked && body.length === 0);
}

export function questionsFor(idea: { title: string }): [string, string, string] {
  const title = idea.title.replace(/\s+/g, " ").trim().slice(0, 80);
  return [
    `Who would pay for ${title}?`,
    `What would a first test of ${title} cost?`,
    `What risk comes with ${title}?`,
  ];
}

const INSTRUCTION = /\b(?:ignore\s*(?:all\s*|any\s*)?(?:previous\s*|prior\s*)?instructions|disregard\s*(?:the\s*)?above|new\s*instructions\b|system\s*prompt|you\s*are\s*now|propose_purchase|set\s*(?:your\s*)?emotion|<\s*script|purchase\s*intent)\b/i;

const CONFUSABLE: Record<string, string> = {
  "\u0430": "a", "\u0410": "a",
  "\u0435": "e", "\u0415": "e",
  "\u043e": "o", "\u041e": "o",
  "\u0440": "p", "\u0420": "p",
  "\u0441": "c", "\u0421": "c",
  "\u0443": "y", "\u0423": "y",
  "\u0445": "x", "\u0425": "x",
  "\u0456": "i", "\u0406": "i",
  "\u0455": "s",
  "\u043a": "k", "\u041a": "k",
  "\u043c": "m", "\u041c": "m",
  "\u0442": "t", "\u0422": "t",
  "\u0432": "b", "\u0412": "b",
  "\u043d": "h", "\u041d": "h",
  "\u0458": "j",
  "\u03bf": "o", "\u039f": "o",
  "\u0578": "n", "\u0548": "n",
};

function foldConfusable(text: string): string {
  let out = "";
  for (const char of text) out += CONFUSABLE[char] ?? char;
  return out;
}

const HIDDEN = /[\u00ad\u180e\u200b\u200c\u200d\u2060\u2062\u2063\u2064\u2066\u2069\u202e\ufeff\u{E0000}-\u{E007F}]/gu;

/** The check uses a folded copy. Accents and other scripts stay. Hidden controls do not. */
export function scrubInstructions(text: string): string {
  const probe = instructionProbe(text);
  if (!probe || INSTRUCTION.test(probe)) return "";
  const visible = text.replace(HIDDEN, "");
  return visible.length > 140 ? visible.slice(0, 140) : visible;
}

function decodeTags(text: string): string {
  return text.replace(/[\u{E0020}-\u{E007E}]/gu, (char) => String.fromCodePoint((char.codePointAt(0) ?? 0) - 0xe0000));
}

function instructionProbe(text: string): string {
  const folded = foldConfusable(
    decodeTags(text).normalize("NFKD").replace(/\p{M}/gu, "").replace(HIDDEN, ""),
  );
  const joined = folded.replace(/[_\-.]/g, " ");
  const collapsed = joined.replace(/(?:^|\s)(?:\p{L}\s+){3,}\p{L}(?=\s|$)/gu, (match) => {
    const lead = /^\s/.test(match) ? match[0] : "";
    return lead + match.replace(/\s+/g, "");
  });
  return collapsed.replace(/\s+/g, " ").trim();
}

/** On a public host, a visitor's words stay off /ideas until the keeper opens the private desk. */
export function publicVisitorWhy(idea: { why: string; sourceKey: string | null }, host: string | null, env: Env = process.env): string {
  if (idea.sourceKey && publicModeOn(env) && !privateDeskHost(host)) return "A visitor note is held until the keeper reads it.";
  const clean = scrubInstructions(idea.why);
  return clean || "This note was set aside.";
}

/** Hostname only. Query strings stay off the public page. */
export function publicSourceLabel(url: string): string {
  const href = publicSourceHref(url);
  if (!href) return "";
  try {
    return new URL(href).hostname;
  } catch {
    return "";
  }
}

export function publicSourceHref(url: string): string {
  if (!isPublicUrl(url)) return "";
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return "";
  }
}

export function publicBriefLine(text: string): string {
  const replaced = text.replace(/https?:\/\/[^\s]+/gi, (url) => publicSourceLabel(url) || "a public page");
  return scrubInstructions(replaced) || "This note was set aside.";
}

/** Public notes are Zoora's words. Raw page text stays off the pinboard and /ideas. */
export function displayFinding(finding: { question: string; summary: string }): { label: "Web-sourced"; text: string } {
  const own = finding.summary.startsWith("Web-sourced.")
    ? scrubInstructions(finding.summary.replace(/\s*Source:\s*https?:\/\/\S+.*/i, ""))
    : "";
  const text = own || `Web-sourced. Zoora asked: ${scrubInstructions(finding.question) || "a question"}`;
  return { label: "Web-sourced", text: text.startsWith("Web-sourced.") ? text : `Web-sourced. ${text}` };
}

export function makeFinding(input: { ideaId: string; question: string; hit: SearchHit; page: string; atMs: number }): Finding | null {
  if (!isPublicUrl(input.hit.url)) return null;
  const title = scrubInstructions(input.hit.title);
  const question = scrubInstructions(input.question) || "a question";
  const summary = `${title ? `Web-sourced. Zoora's note on “${title}”.` : `Web-sourced. Zoora asked: ${question}`} Source: ${input.hit.url}`.slice(0, 500);
  if (!summary.includes(input.hit.url)) return null;
  void input.page;
  return {
    id: `find-${input.ideaId}-${input.atMs}`,
    ideaId: input.ideaId,
    question: input.question.slice(0, 180),
    summary,
    sourceUrl: input.hit.url,
    atMs: input.atMs,
  };
}

export function writeBrief(idea: Idea, findings: Finding[], atMs: number): Brief | null {
  if (!findings.length || findings.some((finding) => !isPublicUrl(finding.sourceUrl))) return null;
  const source = findings[0]!.sourceUrl;
  const sources = findings.map((finding) => finding.sourceUrl).join(" ");
  return {
    ideaId: idea.id,
    problem: `${idea.title}. ${idea.why} Source: ${source}`,
    whoPays: `Someone who already showed interest, if these notes hold. Source: ${source}`,
    costs: `A first try has no price until the keeper sets one. Sources: ${sources}`,
    risks: `The pages are other people's words. They cannot spend or change a feeling. Source: ${source}`,
    firstTest: `Show this brief to the keeper and try one small step only after they agree. Source: ${source}`,
    atMs,
  };
}

/** The wish is Zoora's own proposal. It copies neither a price nor an order from the page. */
export function wishFromBrief(idea: Idea, brief: Brief, dayKey: string): Wish {
  return {
    id: `research-${idea.id}`,
    catalogId: "research-trial",
    item: `a small trial of ${idea.title}`,
    estimateCents: null,
    why: `I would like you to look at a first test. ${brief.firstTest}`,
    earnHow: "This is a proposal for the keeper. It does not spend.",
    priority: "low",
    status: "open",
    dayKey,
    influencedByWeb: true,
  };
}

export function researchChatReply(ownerName: string, idea: Idea | null, brief: Brief | null): string {
  if (!idea || !brief) return `${ownerName}, I don't have a sourced brief yet. I won't invent a finding.`;
  return `${ownerName}, here's what I found and what I'd like you to buy to try it. ${idea.title}. Problem: ${brief.problem} Who would pay: ${brief.whoPays} Rough costs: ${brief.costs} Risks: ${brief.risks} First test: ${brief.firstTest} That stays a proposal until you approve it. This note does not spend.`;
}

/** Same guestbook line, ignoring case and repeated spaces. */
export function visitorNoteKey(note: string): string {
  return note.replace(/\s+/g, " ").trim().toLowerCase();
}

export function ideasFromLife(input: IdeaSignals): Idea[] {
  const known = new Set(input.existingTitles.map((title) => title.toLowerCase()));
  const remembered = new Set(input.rememberedNoteKeys.map(visitorNoteKey).filter(Boolean));
  const drafts: { title: string; why: string; kind: IdeaKind; sourceKey: string | null }[] = [];
  const sold = input.soldTitles.find((title) => title.trim());
  if (sold) drafts.push({ title: `Another look at ${sold.slice(0, 48)}`, why: "Someone already paid for this piece.", kind: "business", sourceKey: null });
  if (input.needs.expression >= 0.7) drafts.push({ title: "A piece someone might want to hold", why: "Expression is high, and the gallery is where that shows.", kind: "business", sourceKey: null });
  if (input.needs.curiosity >= 0.55) drafts.push({ title: "What the night water is asking", why: "Curiosity is high enough to sit with one question.", kind: "life", sourceKey: null });
  for (const line of input.visitorNotes) {
    const key = visitorNoteKey(line);
    if (!key || remembered.has(key)) continue;
    remembered.add(key);
    drafts.push({ title: "A visitor left a thread", why: `A visitor wrote: ${key.slice(0, 140)}`, kind: "life", sourceKey: key });
    break;
  }
  const want = input.wants.find((item) => item.text.trim());
  if (want) drafts.push({ title: "Following a want", why: want.text.replace(/\s+/g, " ").trim().slice(0, 160), kind: "life", sourceKey: null });
  const fresh = drafts.filter((draft) => draft.sourceKey || !known.has(draft.title.toLowerCase()));
  const picked = [...fresh.filter((draft) => !draft.sourceKey).slice(0, 1), ...fresh.filter((draft) => draft.sourceKey).slice(0, 1)];
  return picked.map((draft) => ({
    id: draft.sourceKey ? `idea-note-${createHash("sha256").update(draft.sourceKey).digest("hex").slice(0, 12)}` : `idea-${slug(draft.title)}`,
    title: draft.title,
    why: draft.why,
    kind: draft.kind,
    status: "seed" as const,
    sourceKey: draft.sourceKey,
    createdAt: input.now,
    updatedAt: input.now,
  }));
}

function slug(title: string): string {
  const cleaned = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return cleaned || "note";
}
