import type { Needs, Wish } from "../brain/types";
import { isPublicUrl, stripPage, type SearchHit } from "./search";

export type IdeaStatus = "seed" | "researching" | "promising" | "parked";
export type IdeaKind = "business" | "life";

export type Idea = {
  id: string;
  title: string;
  why: string;
  kind: IdeaKind;
  status: IdeaStatus;
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
  now: number;
  existingTitles: string[];
};

/** Pages stay data. They do not move feelings and they do not become intents. */
export function absorbUntrustedPage<E>(html: string, emotions: E): { text: string; intents: []; emotions: E } {
  return { text: stripPage(html), intents: [], emotions };
}

export function questionsFor(idea: { title: string }): [string, string, string] {
  const title = idea.title.replace(/\s+/g, " ").trim().slice(0, 80);
  return [
    `Who would pay for ${title}?`,
    `What would a first test of ${title} cost?`,
    `What risk comes with ${title}?`,
  ];
}

export function makeFinding(input: { ideaId: string; question: string; hit: SearchHit; page: string; atMs: number }): Finding | null {
  if (!isPublicUrl(input.hit.url)) return null;
  const text = stripPage(input.page) || stripPage(input.hit.snippet);
  if (!text) return null;
  const summary = `${text.slice(0, 240)} Source: ${input.hit.url}`.slice(0, 500);
  if (!summary.includes(input.hit.url)) return null;
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
  };
}

export function researchChatReply(ownerName: string, idea: Idea | null, brief: Brief | null): string {
  if (!idea || !brief) return `${ownerName}, I don't have a sourced brief yet. I won't invent a finding.`;
  return `${ownerName}, here's what I found and what I'd like you to buy to try it. ${idea.title}. Problem: ${brief.problem} Who would pay: ${brief.whoPays} Rough costs: ${brief.costs} Risks: ${brief.risks} First test: ${brief.firstTest} That stays a proposal until you approve it. This note does not spend.`;
}

export function ideasFromLife(input: IdeaSignals): Idea[] {
  const known = new Set(input.existingTitles.map((title) => title.toLowerCase()));
  const drafts: { title: string; why: string; kind: IdeaKind }[] = [];
  const sold = input.soldTitles.find((title) => title.trim());
  if (sold) drafts.push({ title: `Another look at ${sold.slice(0, 48)}`, why: "Someone already paid for this piece.", kind: "business" });
  if (input.needs.expression >= 0.7) drafts.push({ title: "A piece someone might want to hold", why: "Expression is high, and the gallery is where that shows.", kind: "business" });
  if (input.needs.curiosity >= 0.55) drafts.push({ title: "What the night water is asking", why: "Curiosity is high enough to sit with one question.", kind: "life" });
  const note = input.visitorNotes.find((line) => line.trim());
  if (note) drafts.push({ title: "A visitor left a thread", why: `A visitor wrote: ${note.replace(/\s+/g, " ").trim().slice(0, 140)}`, kind: "life" });
  const want = input.wants.find((item) => item.text.trim());
  if (want) drafts.push({ title: `Following a want`, why: want.text.replace(/\s+/g, " ").trim().slice(0, 160), kind: "life" });
  const fresh = drafts.filter((draft) => !known.has(draft.title.toLowerCase())).slice(0, 2);
  return fresh.map((draft) => ({
    id: `idea-${slug(draft.title)}`,
    title: draft.title,
    why: draft.why,
    kind: draft.kind,
    status: "seed" as const,
    createdAt: input.now,
    updatedAt: input.now,
  }));
}

function slug(title: string): string {
  const cleaned = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return cleaned || "note";
}
