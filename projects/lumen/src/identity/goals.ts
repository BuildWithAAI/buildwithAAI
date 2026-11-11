import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { scrubInstructions } from "../research/ideas";
import { boundaryViolation, seededGoals, writeLivedGoals, type IdentityPack } from "./load";

export type GoalRow = {
  id: string;
  horizon: "long" | "medium" | "current";
  text: string;
  status: "proposed" | "active" | "completed" | "retired";
  source: "owner" | "zoora";
  version: number;
  created_at: number;
  updated_at: number;
};

const DAY = 24 * 60 * 60 * 1000;

export function seedOwnerGoals(db: DatabaseSync, pack: IdentityPack, now: number): void {
  const count = db.prepare("SELECT COUNT(*) AS n FROM zoora_goals").get() as { n: number };
  if (Number(count.n) > 0) return;
  for (const goal of seededGoals(pack.goals)) {
    const id = `goal-${randomBytes(4).toString("hex")}`;
    db.prepare("INSERT INTO zoora_goals(id, horizon, text, status, source, version, created_at, updated_at) VALUES(?, ?, ?, 'active', 'owner', 1, ?, ?)").run(id, goal.horizon, goal.text, now, now);
    history(db, id, "seed", goal.text, "active", now);
  }
}

export function listGoals(db: DatabaseSync): GoalRow[] {
  return db.prepare("SELECT id, horizon, text, status, source, version, created_at, updated_at FROM zoora_goals ORDER BY created_at ASC").all() as GoalRow[];
}

export function activeGoalText(db: DatabaseSync): string | null {
  const row = db.prepare("SELECT text FROM zoora_goals WHERE status = 'active' AND horizon = 'current' ORDER BY updated_at DESC LIMIT 1").get() as { text: string } | undefined;
  return row?.text ?? null;
}

export function proposeGoal(db: DatabaseSync, input: { text: string; horizon: GoalRow["horizon"]; source: "zoora" | "visitor" | "owner"; influenced?: boolean; rawVisitor?: string }, now: number): { ok: true; id: string } | { ok: false; reason: string } {
  if (input.source === "visitor") return { ok: false, reason: "VISITOR" };
  const clean = scrubInstructions(input.text);
  if (!clean) return { ok: false, reason: "EMPTY" };
  if (input.rawVisitor && clean.includes(input.rawVisitor)) return { ok: false, reason: "VISITOR" };
  if (boundaryViolation(clean)) return { ok: false, reason: "BOUNDARY" };
  if (input.source === "zoora") {
    const since = now - DAY;
    const recent = db.prepare("SELECT COUNT(*) AS n FROM zoora_goal_history WHERE action = 'propose' AND at_ms >= ?").get(since) as { n: number };
    if (Number(recent.n) >= 1) return { ok: false, reason: "RATE" };
  }
  const id = `goal-${randomBytes(4).toString("hex")}`;
  const status = input.source === "owner" ? "active" : "proposed";
  db.prepare("INSERT INTO zoora_goals(id, horizon, text, status, source, version, created_at, updated_at) VALUES(?, ?, ?, ?, ?, 1, ?, ?)").run(id, input.horizon, clean, status, input.source, now, now);
  history(db, id, input.source === "zoora" ? "propose" : "seed", clean, status, now);
  exportLived(db);
  return { ok: true, id };
}

export function approveGoal(db: DatabaseSync, id: string, now: number): { ok: boolean; reason?: string } {
  const row = goal(db, id);
  if (!row || row.status !== "proposed") return { ok: false, reason: "MISSING" };
  db.prepare("UPDATE zoora_goals SET status = 'active', version = version + 1, updated_at = ? WHERE id = ?").run(now, id);
  history(db, id, "approve", row.text, "active", now);
  exportLived(db);
  return { ok: true };
}

export function revertGoal(db: DatabaseSync, id: string, now: number): { ok: boolean; reason?: string } {
  const row = goal(db, id);
  if (!row) return { ok: false, reason: "MISSING" };
  const prior = db.prepare("SELECT text, status FROM zoora_goal_history WHERE goal_id = ? AND action != 'revert' ORDER BY id DESC LIMIT 1 OFFSET 1").get(id) as { text: string; status: string } | undefined;
  const text = prior?.text ?? row.text;
  const status = row.source === "zoora" && row.status === "proposed" ? "retired" : (prior?.status ?? "active");
  db.prepare("UPDATE zoora_goals SET text = ?, status = ?, version = version + 1, updated_at = ? WHERE id = ?").run(text, status, now, id);
  history(db, id, "revert", text, status, now);
  exportLived(db);
  return { ok: true };
}

export function editOwnerGoal(db: DatabaseSync, id: string, text: string, now: number): { ok: boolean; reason?: string } {
  const row = goal(db, id);
  if (!row || row.source !== "owner") return { ok: false, reason: "OWNER_ONLY" };
  const clean = scrubInstructions(text);
  if (!clean || boundaryViolation(clean)) return { ok: false, reason: "BOUNDARY" };
  db.prepare("UPDATE zoora_goals SET text = ?, version = version + 1, updated_at = ? WHERE id = ?").run(clean, now, id);
  history(db, id, "edit", clean, row.status, now);
  exportLived(db);
  return { ok: true };
}

export function goalHistory(db: DatabaseSync, id: string): { action: string; text: string; status: string; atMs: number }[] {
  const rows = db.prepare("SELECT action, text, status, at_ms FROM zoora_goal_history WHERE goal_id = ? ORDER BY id ASC").all(id) as { action: string; text: string; status: string; at_ms: number }[];
  return rows.map((row) => ({ action: row.action, text: row.text, status: row.status, atMs: row.at_ms }));
}

export function reflectOnGoals(db: DatabaseSync, feeling: string, now: number): string | null {
  const last = db.prepare("SELECT at_ms FROM zoora_goal_history WHERE action = 'reflect' ORDER BY id DESC LIMIT 1").get() as { at_ms: number } | undefined;
  const day = chicagoDay(now);
  if (last && chicagoDay(Number(last.at_ms)) === day) return null;
  const current = activeGoalText(db);
  const line = current
    ? `I looked at my goal, ${current} ${feeling}`
    : `I looked for a goal and the water was still. ${feeling}`;
  const id = db.prepare("SELECT id FROM zoora_goals WHERE status = 'active' LIMIT 1").get() as { id: string } | undefined;
  history(db, id?.id ?? "none", "reflect", line, "active", now);
  db.prepare("INSERT INTO diary(text, tone, private, created_at) VALUES(?, 'steady', 0, ?)").run(line, now);
  return line;
}

export function livedGoalMarkdown(db: DatabaseSync): string {
  const rows = listGoals(db).filter((item) => item.status === "active" || item.status === "proposed");
  if (!rows.length) return "No lived goals yet.";
  return rows.map((item) => `- ${item.horizon}: ${item.text} (${item.status})`).join("\n");
}

function exportLived(db: DatabaseSync): void {
  if (process.env.VITEST) return;
  writeLivedGoals(livedGoalMarkdown(db));
}

function goal(db: DatabaseSync, id: string): GoalRow | undefined {
  return db.prepare("SELECT id, horizon, text, status, source, version, created_at, updated_at FROM zoora_goals WHERE id = ?").get(id) as GoalRow | undefined;
}

function history(db: DatabaseSync, goalId: string, action: string, text: string, status: string, now: number): void {
  db.prepare("INSERT INTO zoora_goal_history(goal_id, action, text, status, at_ms) VALUES(?, ?, ?, ?, ?)").run(goalId, action, text.slice(0, 280), status, now);
}

function chicagoDay(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}
