import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { kvGet, kvSet } from "../db/db";
import type { BrainState } from "../brain/types";
import { Ledger } from "../money/ledger";
import { scrubInstructions } from "../research/ideas";

export type PieceKind = "art" | "song" | "build";

export type ProvenanceRow = {
  pieceKind: PieceKind;
  pieceId: string;
  diaryId: number | null;
  mood: Record<string, number> | null;
  memoryIds: string[];
  goalId: string | null;
  researchId: string | null;
  visitorText: string | null;
  atMs: number;
};

/** Server-written sources for a new piece. Missing sources stay null. Visitor text is stored only when the caller already flagged it. */
export function recordProvenance(db: DatabaseSync, input: { pieceKind: PieceKind; pieceId: string; atMs: number; flaggedVisitorText?: string | null; mind?: boolean }): ProvenanceRow {
  const diary = db.prepare("SELECT id FROM diary ORDER BY id DESC LIMIT 1").get() as { id: number } | undefined;
  const goal = db.prepare("SELECT id FROM zoora_goals WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1").get() as { id: string } | undefined;
  const research = db.prepare("SELECT id FROM findings ORDER BY at_ms DESC LIMIT 1").get() as { id: string } | undefined;
  const brain = input.mind === false ? null : readBrain(db);
  const mood = brain?.emotions ?? null;
  const memoryIds = (brain?.longTerm ?? []).map((item) => item.id).filter(Boolean);
  const visitorText = input.flaggedVisitorText ? scrubInstructions(input.flaggedVisitorText) || null : null;
  const row: ProvenanceRow = {
    pieceKind: input.pieceKind,
    pieceId: input.pieceId,
    diaryId: diary?.id ?? null,
    mood,
    memoryIds,
    goalId: goal?.id ?? null,
    researchId: research?.id ?? null,
    visitorText,
    atMs: input.atMs,
  };
  db.prepare(
    `INSERT INTO provenance(piece_kind, piece_id, diary_id, mood_json, memory_ids, goal_id, research_id, visitor_text, at_ms)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.pieceKind,
    row.pieceId,
    row.diaryId,
    row.mood ? JSON.stringify(row.mood) : null,
    JSON.stringify(row.memoryIds),
    row.goalId,
    row.researchId,
    row.visitorText,
    row.atMs,
  );
  recordPieceHash(db, row.pieceKind, row.pieceId, row.atMs);
  return row;
}

export function contentHashOf(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

/** The stored body of a piece. Songs keep their own copy because the stand holds only the latest tune. */
export function storedPieceBody(db: DatabaseSync, pieceKind: PieceKind, pieceId: string): string | null {
  if (pieceKind === "art") {
    const row = db.prepare("SELECT svg FROM creations WHERE id = ?").get(pieceId) as { svg: string } | undefined;
    return row?.svg ?? null;
  }
  if (pieceKind === "song") return kvGet(db, `song-body:${pieceId}`);
  const row = db.prepare("SELECT kind, title, why, place_id, params FROM world_builds WHERE id = ?").get(pieceId) as {
    kind: string; title: string; why: string; place_id: string; params: string;
  } | undefined;
  if (!row) return null;
  return JSON.stringify({ kind: row.kind, title: row.title, why: row.why, placeId: row.place_id, params: row.params });
}

export function rememberSongBody(db: DatabaseSync, pieceId: string, body: string): void {
  kvSet(db, `song-body:${pieceId}`, body);
}

export function pieceContentMatches(db: DatabaseSync, pieceKind: PieceKind, pieceId: string): boolean {
  const body = storedPieceBody(db, pieceKind, pieceId);
  if (body == null) return false;
  const row = new Ledger(db).findByIdempotency(`piece:${pieceKind}:${pieceId}`);
  return row?.contentHash === contentHashOf(body);
}

function recordPieceHash(db: DatabaseSync, pieceKind: PieceKind, pieceId: string, atMs: number): void {
  const body = storedPieceBody(db, pieceKind, pieceId);
  if (body == null) return;
  new Ledger(db).append({
    id: `piece-${pieceKind}-${pieceId}`,
    atMs,
    kind: "audit",
    amountCents: 0,
    status: "confirmed",
    idempotencyKey: `piece:${pieceKind}:${pieceId}`,
    ref: `${pieceKind}:${pieceId}`,
    note: `content ${pieceKind}`,
    contentHash: contentHashOf(body),
  });
}

export function readProvenance(db: DatabaseSync, pieceKind: PieceKind, pieceId: string): ProvenanceRow | null {
  const row = db.prepare("SELECT piece_kind, piece_id, diary_id, mood_json, memory_ids, goal_id, research_id, visitor_text, at_ms FROM provenance WHERE piece_kind = ? AND piece_id = ?").get(pieceKind, pieceId) as {
    piece_kind: PieceKind; piece_id: string; diary_id: number | null; mood_json: string | null; memory_ids: string; goal_id: string | null; research_id: string | null; visitor_text: string | null; at_ms: number;
  } | undefined;
  if (!row) return null;
  return {
    pieceKind: row.piece_kind,
    pieceId: row.piece_id,
    diaryId: row.diary_id,
    mood: row.mood_json ? JSON.parse(row.mood_json) as Record<string, number> : null,
    memoryIds: JSON.parse(row.memory_ids) as string[],
    goalId: row.goal_id,
    researchId: row.research_id,
    visitorText: row.visitor_text,
    atMs: row.at_ms,
  };
}

function readBrain(db: DatabaseSync): BrainState | null {
  const raw = kvGet(db, "brain");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BrainState;
  } catch {
    return null;
  }
}
