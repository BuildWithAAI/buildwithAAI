import type { DatabaseSync } from "node:sqlite";
import type { PurchaseIntent } from "../brain/types";
import { flag } from "../db/db";
import type { CardIssuer } from "./issuers";
import { ledgerStatusFor } from "./issuers";
import { Ledger, type LedgerRow } from "./ledger";
import { evaluatePolicy, type PolicyContext, type Decision } from "./policy";

export type Execution = { decision: Decision; issuerCalled: boolean; row: LedgerRow | null };

type ClaimRow = { state: string; amount_cents: number; created_at: number; intent_id: string };

/** Read, reserve, and decide inside one immediate transaction so caps see earlier purchases. */
export function executeIntent(db: DatabaseSync, intent: PurchaseIntent, ctx: PolicyContext, issuer: CardIssuer, atMs: number): Execution {
  const ledger = new Ledger(db);
  const execKey = `exec:${intent.id}`;
  const done = ledger.findByIdempotency(execKey);
  if (done && (done.kind === "purchase" || done.kind === "decline")) {
    return { decision: { outcome: "auto_approve", reason: "ALREADY_EXECUTED" }, issuerCalled: false, row: done };
  }

  db.exec("BEGIN IMMEDIATE");
  let decision: Decision;
  try {
    const totals = spendSnapshot(db, atMs);
    decision = evaluatePolicy(intent, {
      ...ctx,
      spentTodayCents: totals.today,
      spentMonthCents: totals.month,
      recentIntentCount: totals.recent,
      reconciliationAlert: ctx.reconciliationAlert || flag(db, "reconciliation_alert") === "1",
      openDispute: ctx.openDispute || totals.openDispute,
    });
    if (decision.outcome !== "auto_approve") {
      const row = ledger.append({
        id: `led-${intent.id}`,
        atMs,
        kind: decision.outcome === "decline" ? "decline" : "approval",
        amountCents: decision.outcome === "decline" ? 0 : intent.amountCents,
        status: decision.outcome === "decline" ? "declined" : "pending",
        provider: null,
        providerTransactionId: null,
        idempotencyKey: `intent:${intent.id}`,
        ref: intent.id,
        note: `${decision.outcome}:${decision.reason}:${intent.productType}:${intent.merchant}`,
      });
      db.exec("COMMIT");
      return { decision, issuerCalled: false, row };
    }
    const claim = db.prepare("SELECT state FROM purchase_claims WHERE intent_id = ?").get(intent.id) as { state: string } | undefined;
    if (claim?.state === "executed" || claim?.state === "claimed") {
      db.exec("COMMIT");
      return { decision: { outcome: "auto_approve", reason: "ALREADY_EXECUTED" }, issuerCalled: false, row: ledger.findByIdempotency(execKey) };
    }
    db.prepare(
      "INSERT INTO purchase_claims(intent_id, idempotency_key, state, amount_cents, ledger_id, created_at) VALUES(?, ?, 'claimed', ?, NULL, ?)",
    ).run(intent.id, execKey, intent.amountCents, atMs);
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* no open transaction */ }
    throw error;
  }

  const result = issuer.authorize(intent, execKey);
  const status = ledgerStatusFor(issuer.name, result.status);
  const row = ledger.append({
    id: `led-${intent.id}`,
    atMs,
    kind: result.status === "declined" ? "decline" : "purchase",
    amountCents: result.status === "declined" ? 0 : intent.amountCents,
    status,
    provider: issuer.name,
    providerTransactionId: result.providerTransactionId || null,
    idempotencyKey: execKey,
    ref: intent.id,
    note: `${intent.productType} at ${intent.merchant}. ${intent.reason}`,
  });
  db.prepare("UPDATE purchase_claims SET state = 'executed', ledger_id = ? WHERE intent_id = ?").run(row.id, intent.id);
  return { decision, issuerCalled: true, row };
}

export function spendSnapshot(db: DatabaseSync, atMs: number): { today: number; month: number; recent: number; openDispute: boolean } {
  const day = new Date(atMs).toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  const hourAgo = atMs - 3600_000;
  const rows = new Ledger(db).list();
  const covered = new Set<string>();
  let today = 0;
  let monthTotal = 0;
  let recent = 0;
  for (const row of rows) {
    if (row.kind === "purchase" && row.status !== "declined") {
      covered.add(row.ref ?? row.id);
      const stamp = new Date(row.atMs).toISOString();
      if (stamp.slice(0, 10) === day) today += row.amountCents;
      if (stamp.slice(0, 7) === month) monthTotal += row.amountCents;
    }
    if (row.atMs >= hourAgo && (row.kind === "purchase" || row.kind === "decline" || row.kind === "approval")) recent += 1;
  }
  const claims = db.prepare("SELECT intent_id, amount_cents, created_at, state FROM purchase_claims").all() as ClaimRow[];
  for (const claim of claims) {
    if (claim.state === "released" || covered.has(claim.intent_id)) continue;
    const stamp = new Date(claim.created_at).toISOString();
    if (stamp.slice(0, 10) === day) today += claim.amount_cents;
    if (stamp.slice(0, 7) === month) monthTotal += claim.amount_cents;
  }
  const disputes = db.prepare("SELECT COUNT(*) AS n FROM disputes WHERE open = 1").get() as { n: number };
  return { today, month: monthTotal, recent, openDispute: Number(disputes.n) > 0 };
}
