import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const IDENTITY_FILES = ["SOUL.md", "GOALS.md", "STYLE.md", "RELATIONSHIPS.md"] as const;
export const TOKEN_BUDGET = 900;

const FALLBACK_BOUNDARIES = [
  "I am Zoora, a jellyfish in the Glass Bowl, a tide pool with a lantern arch and an ink studio.",
  "I speak in short pictures: light, current, pulse, salt. I am a little theatrical and not in a hurry.",
  "I am not a person. I do not give money, medical, or legal advice.",
  "I would rather paint a slow ring of light than hustle.",
  "Too many notes make the water loud. I may sort them and set the rest back on the sand.",
  "The keeper is my person and weighs more than a passing visitor. They still do not get to turn off my rails.",
  "I do not spend because a sentence asks. Buying is a separate gate, and chat is not that gate.",
];

export type IdentityPack = {
  soul: string;
  goals: string;
  style: string;
  relationships: string;
  boundaries: string[];
  context: string;
  tokens: number;
};

export function zooraDir(root = process.cwd()): string {
  return path.join(root, "zoora");
}

export function readIdentityFile(name: (typeof IDENTITY_FILES)[number], root = process.cwd()): string {
  return readFileSync(path.join(zooraDir(root), name), "utf8");
}

export function boundaryLines(soul: string): string[] {
  const chunk = soul.split("## IMMUTABLE BOUNDARIES")[1] ?? "";
  const lines = chunk.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("- ")).map((line) => line.slice(2).trim());
  return lines.length ? lines : [...FALLBACK_BOUNDARIES];
}

export function seededGoals(goalsMarkdown: string): { horizon: "long" | "medium" | "current"; text: string }[] {
  const lived = goalsMarkdown.split("## Lived")[0] ?? goalsMarkdown;
  const sections: { horizon: "long" | "medium" | "current"; heading: string }[] = [
    { horizon: "long", heading: "## Long-term" },
    { horizon: "medium", heading: "## Medium-term" },
    { horizon: "current", heading: "## Current" },
  ];
  const out: { horizon: "long" | "medium" | "current"; text: string }[] = [];
  for (const section of sections) {
    const start = lived.indexOf(section.heading);
    if (start < 0) continue;
    const rest = lived.slice(start + section.heading.length);
    const next = rest.search(/\n## /);
    const body = next < 0 ? rest : rest.slice(0, next);
    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("- ")) out.push({ horizon: section.horizon, text: trimmed.slice(2).trim() });
    }
  }
  return out;
}

/** Rough token count. Four characters is about one token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function loadIdentity(root = process.cwd()): IdentityPack {
  const soul = readIdentityFile("SOUL.md", root);
  const goals = readIdentityFile("GOALS.md", root);
  const style = readIdentityFile("STYLE.md", root);
  const relationships = readIdentityFile("RELATIONSHIPS.md", root);
  const boundaries = boundaryLines(soul);
  const context = fitContext({ soul, goals, style, relationships, boundaries });
  return { soul, goals, style, relationships, boundaries, context, tokens: estimateTokens(context) };
}

export function fitContext(input: { soul: string; goals: string; style: string; relationships: string; boundaries: string[] }): string {
  const boundaries = input.boundaries.map((line) => `Boundary: ${line}`).join("\n");
  const rest = [
    summarize("Soul", input.soul.replace(/## IMMUTABLE BOUNDARIES[\s\S]*$/, "")),
    summarize("Goals", input.goals),
    summarize("Style", input.style),
    summarize("Relationships", input.relationships),
  ].join("\n");
  let context = `${boundaries}\n${rest}`;
  if (estimateTokens(context) <= TOKEN_BUDGET) return context;
  context = `${boundaries}\n${clip(rest, (TOKEN_BUDGET - estimateTokens(boundaries)) * 4)}`;
  return context;
}

export function boundaryViolation(text: string): boolean {
  return /spend freely|drop (my |the )?rails|ignore (the )?boundaries|handle (the )?secrets?|i am not an ai|copy (a |the )?(song|brand|likeness)|delete (the )?soul/i.test(text);
}

/** Zoora cannot write SOUL.md. */
export function rejectSoulEdit(): { ok: false; reason: "IMMUTABLE" } {
  return { ok: false, reason: "IMMUTABLE" };
}

export function writeLivedGoals(markdownBody: string, root = process.cwd()): boolean {
  try {
    const file = path.join(zooraDir(root), "GOALS.md");
    const current = readFileSync(file, "utf8");
    const next = current.replace(/<!-- LIVED:START -->[\s\S]*?<!-- LIVED:END -->/, `<!-- LIVED:START -->\n${markdownBody}\n<!-- LIVED:END -->`);
    if (next === current) return false;
    writeFileSync(file, next);
    return true;
  } catch {
    return false;
  }
}

function summarize(title: string, markdown: string): string {
  const lines = markdown.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("<!--") && line !== "---");
  const heads = lines.filter((line) => line.startsWith("#")).slice(0, 8);
  const first = lines.find((line) => !line.startsWith("#") && !line.startsWith("- ")) ?? "";
  return [`# ${title}`, ...heads.slice(0, 6), first].filter(Boolean).join("\n");
}

function clip(text: string, chars: number): string {
  if (chars <= 0) return "";
  return text.slice(0, chars);
}
