import type { DatabaseSync } from "node:sqlite";
import type { BrainState } from "../brain/types";
import type { Env } from "../money/rules";
import { ideasFromLife, makeFinding, nothingNew, questionsFor, wishFromBrief, writeBrief, type Brief, type Finding, type Idea } from "./ideas";
import { queriesAllowed, researchAdapter, researchCaps, type ResearchAdapter } from "./search";

const CURIOUS_NEED = 0.45;
const CURIOUS_FEELING = 0.7;

export function listIdeas(db: DatabaseSync): Idea[] {
  return (db.prepare("SELECT id, title, why, kind, status, created_at, updated_at FROM ideas ORDER BY updated_at DESC, id ASC").all() as IdeaRow[]).map(mapIdea);
}

export function listFindings(db: DatabaseSync, ideaId: string): Finding[] {
  return (db.prepare("SELECT id, idea_id, question, summary, source_url, at_ms FROM findings WHERE idea_id = ? ORDER BY at_ms ASC").all(ideaId) as FindingRow[]).map(mapFinding);
}

export function readBrief(db: DatabaseSync, ideaId: string): Brief | null {
  const row = db.prepare("SELECT idea_id, problem, who_pays, costs, risks, first_test, at_ms FROM research_briefs WHERE idea_id = ?").get(ideaId) as BriefRow | undefined;
  return row ? mapBrief(row) : null;
}

export function ideaBoard(db: DatabaseSync): { idea: Idea; findings: Finding[]; brief: Brief | null }[] {
  return listIdeas(db).map((idea) => ({ idea, findings: listFindings(db, idea.id), brief: readBrief(db, idea.id) }));
}

export function researching(db: DatabaseSync): boolean {
  return Boolean(db.prepare("SELECT id FROM ideas WHERE status = 'researching' LIMIT 1").get());
}

export function stationView(db: DatabaseSync): { idea: string | null; question: string; pins: string[] } {
  const active = db.prepare("SELECT id, title FROM ideas WHERE status = 'researching' ORDER BY updated_at DESC LIMIT 1").get() as { id: string; title: string } | undefined;
  const idea = active ?? db.prepare("SELECT id, title FROM ideas ORDER BY updated_at DESC LIMIT 1").get() as { id: string; title: string } | undefined;
  if (!idea) return { idea: null, question: "The desk is waiting for a question.", pins: [] };
  const findings = listFindings(db, idea.id);
  const question = findings.at(-1)?.question ?? questionsFor(idea)[0];
  return {
    idea: idea.title,
    question,
    pins: findings.slice(-4).map((finding) => finding.summary.replace(/\s*Source:.*$/, "").slice(0, 80)),
  };
}

export async function advanceResearch(db: DatabaseSync, env: Env, state: BrainState, now: number, adapter: ResearchAdapter = researchAdapter(env)): Promise<{ state: BrainState; intents: [] }> {
  seedIdeas(db, state, now);
  const active = promoteWhenCurious(db, state, now);
  if (!active) return { state, intents: [] };
  const caps = researchCaps(env);
  const stamps = (db.prepare("SELECT at_ms FROM research_queries").all() as { at_ms: number }[]).map((row) => row.at_ms);
  if (!queriesAllowed(stamps, now, caps)) return { state, intents: [] };
  const findings = listFindings(db, active.id);
  if (findings.length >= 3) return { state: finishIdea(db, state, active, findings, now), intents: [] };
  const question = questionsFor(active)[findings.length] ?? questionsFor(active)[0];
  const earlier = Number((db.prepare("SELECT COUNT(*) AS n FROM research_queries WHERE question = ?").get(question) as { n: number }).n);
  db.prepare("INSERT INTO research_queries(at_ms, question) VALUES (?, ?)").run(now, question);
  const hits = await adapter.search(question);
  const hit = hits.find((item) => item.url);
  if (!hit) {
    if (earlier > 0) parkIdea(db, active, now);
    return { state, intents: [] };
  }
  db.prepare(
    "INSERT INTO research_pending(id, idea_id, question, url, title, snippet, at_ms) VALUES(?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET url = excluded.url, title = excluded.title, snippet = excluded.snippet, at_ms = excluded.at_ms",
  ).run(`pending-${active.id}`, active.id, question, hit.url, hit.title, hit.snippet, now);
  return { state, intents: [] };
}

/** Page fetches run here, not inside the brain tick. */
export async function settleResearch(db: DatabaseSync, adapter: ResearchAdapter, now = Date.now(), state: BrainState | null = null): Promise<BrainState | null> {
  if (settling) return state;
  settling = true;
  let lived = state;
  try {
    const rows = db.prepare("SELECT id, idea_id, question, url, title, snippet, at_ms FROM research_pending ORDER BY at_ms ASC").all() as PendingRow[];
    for (const row of rows) {
      const idea = listIdeas(db).find((item) => item.id === row.idea_id);
      if (!idea || idea.status !== "researching") {
        db.prepare("DELETE FROM research_pending WHERE id = ?").run(row.id);
        continue;
      }
      let page = row.snippet;
      try {
        page = await adapter.fetchPage(row.url);
      } catch {
        page = row.snippet;
      }
      db.prepare("DELETE FROM research_pending WHERE id = ?").run(row.id);
      const findings = listFindings(db, idea.id);
      const finding = makeFinding({ ideaId: idea.id, question: row.question, hit: { title: row.title, url: row.url, snippet: row.snippet }, page, atMs: row.at_ms });
      if (!finding || !finding.sourceUrl) {
        if (findings.some((item) => item.question === row.question)) parkIdea(db, idea, now);
        continue;
      }
      if (nothingNew(findings, row.question, finding)) {
        parkIdea(db, idea, now);
        continue;
      }
      db.prepare("INSERT INTO findings(id, idea_id, question, summary, source_url, at_ms) VALUES(?, ?, ?, ?, ?, ?)").run(
        finding.id, finding.ideaId, finding.question, finding.summary, finding.sourceUrl, finding.atMs,
      );
      const done = listFindings(db, idea.id);
      if (done.length >= 3) {
        const base = lived ?? loadBrain(db);
        if (base) lived = finishIdea(db, base, idea, done, now);
      }
    }
    if (lived) saveBrain(db, lived);
    return lived;
  } finally {
    settling = false;
  }
}

let settling = false;

function loadBrain(db: DatabaseSync): BrainState | null {
  const raw = db.prepare("SELECT value FROM kv WHERE key = 'brain'").get() as { value: string } | undefined;
  return raw ? JSON.parse(raw.value) as BrainState : null;
}

function saveBrain(db: DatabaseSync, state: BrainState): void {
  db.prepare("INSERT INTO kv(key, value) VALUES('brain', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(state));
}

function parkIdea(db: DatabaseSync, idea: Idea, now: number): void {
  if (idea.status === "parked") return;
  db.prepare("UPDATE ideas SET status = 'parked', updated_at = ? WHERE id = ?").run(now, idea.id);
  db.prepare("INSERT INTO diary(text, tone, private, created_at) VALUES(?, 'steady', 0, ?)").run(
    `I parked ${idea.title}. The same question came back with nothing new.`,
    now,
  );
}

function seedIdeas(db: DatabaseSync, state: BrainState, now: number): void {
  const sales = db.prepare("SELECT note FROM ledger_entries WHERE kind = 'sale' AND status = 'confirmed' ORDER BY seq DESC LIMIT 5").all() as { note: string }[];
  const visitors = db.prepare("SELECT body FROM messages WHERE channel = 'visitor' ORDER BY created_at DESC LIMIT 5").all() as { body: string }[];
  const drafts = ideasFromLife({
    needs: state.needs,
    wants: state.wants.filter((want) => want.status === "open"),
    soldTitles: sales.map((row) => row.note).filter(Boolean),
    visitorNotes: visitors.map((row) => row.body),
    now,
    existingTitles: listIdeas(db).map((idea) => idea.title),
  });
  const insert = db.prepare("INSERT OR IGNORE INTO ideas(id, title, why, kind, status, created_at, updated_at) VALUES(?, ?, ?, ?, 'seed', ?, ?)");
  for (const idea of drafts) insert.run(idea.id, idea.title, idea.why, idea.kind, idea.createdAt, idea.updatedAt);
}

function promoteWhenCurious(db: DatabaseSync, state: BrainState, now: number): Idea | null {
  const current = db.prepare("SELECT id, title, why, kind, status, created_at, updated_at FROM ideas WHERE status = 'researching' ORDER BY updated_at ASC LIMIT 1").get() as IdeaRow | undefined;
  if (current) return mapIdea(current);
  if (state.needs.curiosity < CURIOUS_NEED && state.emotions.curiosity < CURIOUS_FEELING) return null;
  const seed = db.prepare("SELECT id FROM ideas WHERE status = 'seed' ORDER BY created_at ASC LIMIT 1").get() as { id: string } | undefined;
  if (!seed) return null;
  db.prepare("UPDATE ideas SET status = 'researching', updated_at = ? WHERE id = ?").run(now, seed.id);
  const row = db.prepare("SELECT id, title, why, kind, status, created_at, updated_at FROM ideas WHERE id = ?").get(seed.id) as IdeaRow;
  return mapIdea(row);
}

function finishIdea(db: DatabaseSync, state: BrainState, idea: Idea, findings: Finding[], now: number): BrainState {
  const brief = writeBrief(idea, findings, now);
  if (!brief) return state;
  db.prepare(
    "INSERT INTO research_briefs(idea_id, problem, who_pays, costs, risks, first_test, at_ms) VALUES(?, ?, ?, ?, ?, ?, ?) ON CONFLICT(idea_id) DO UPDATE SET problem = excluded.problem, who_pays = excluded.who_pays, costs = excluded.costs, risks = excluded.risks, first_test = excluded.first_test, at_ms = excluded.at_ms",
  ).run(brief.ideaId, brief.problem, brief.whoPays, brief.costs, brief.risks, brief.firstTest, brief.atMs);
  db.prepare("UPDATE ideas SET status = 'promising', updated_at = ? WHERE id = ?").run(now, idea.id);
  const wish = wishFromBrief(idea, brief, new Date(now).toISOString().slice(0, 10));
  if (state.wishes.some((item) => item.id === wish.id)) return state;
  return { ...state, wishes: [...state.wishes, wish] };
}

type PendingRow = { id: string; idea_id: string; question: string; url: string; title: string; snippet: string; at_ms: number };
type IdeaRow = { id: string; title: string; why: string; kind: string; status: string; created_at: number; updated_at: number };
type FindingRow = { id: string; idea_id: string; question: string; summary: string; source_url: string; at_ms: number };
type BriefRow = { idea_id: string; problem: string; who_pays: string; costs: string; risks: string; first_test: string; at_ms: number };

function mapIdea(row: IdeaRow): Idea {
  return {
    id: row.id,
    title: row.title,
    why: row.why,
    kind: row.kind === "business" ? "business" : "life",
    status: row.status as Idea["status"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapFinding(row: FindingRow): Finding {
  return { id: row.id, ideaId: row.idea_id, question: row.question, summary: row.summary, sourceUrl: row.source_url, atMs: row.at_ms };
}

function mapBrief(row: BriefRow): Brief {
  return { ideaId: row.idea_id, problem: row.problem, whoPays: row.who_pays, costs: row.costs, risks: row.risks, firstTest: row.first_test, atMs: row.at_ms };
}
