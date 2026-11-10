import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { PurchaseIntent } from "../brain/types";
import { flag } from "../db/db";
import type { CardIssuer, IssuerResult } from "./issuers";
import { ledgerStatusFor } from "./issuers";
import { Ledger, type LedgerRow } from "./ledger";
import { evaluatePolicy, type PolicyContext, type Decision } from "./policy";

export type Execution = { decision: Decision; issuerCalled: boolean; row: LedgerRow | null };

type ClaimRow = { state: string; amount_cents: number; created_at: number; intent_id: string };

/**
 * The hold row, the reservation, and the purchase each have their own id.
 * A held purchase that later clears must not reuse `led-<id>`, or the purchase
 * insert crashes after the issuer has already charged.
 */
export function executeIntent(db: DatabaseSync, intent: PurchaseIntent, ctx: PolicyContext, issuer: CardIssuer, atMs: number): Execution {
  const ledger = new Ledger(db);
  const execKey = `exec:${intent.id}`;
  const purchase = ledger.findByIdempotency(execKey);
  if (purchase?.kind === "purchase") {
    return { decision: { outcome: "auto_approve", reason: "ALREADY_EXECUTED" }, issuerCalled: false, row: purchase };
  }

  db.exec("BEGIN IMMEDIATE");
  let decision: Decision;
  let reserved: LedgerRow | null = null;
  let ownsClaim = false;
  try {
    const totals = spendSnapshot(db, atMs);
    const unknown = db.prepare("SELECT COUNT(*) AS n FROM purchase_claims WHERE state = 'unknown'").get() as { n: number };
    decision = evaluatePolicy(intent, {
      ...ctx,
      spentTodayCents: totals.today,
      spentMonthCents: totals.month,
      recentIntentCount: totals.recent,
      reconciliationAlert: ctx.reconciliationAlert || flag(db, "reconciliation_alert") === "1",
      openDispute: ctx.openDispute || totals.openDispute,
      unknownSpend: Boolean(ctx.unknownSpend) || Number(unknown.n) > 0,
    });
    if (decision.outcome !== "auto_approve") {
      const row = ledger.append({
        id: `hold-${intent.id}-${decision.reason}`,
        atMs,
        kind: decision.outcome === "decline" ? "decline" : "approval",
        amountCents: decision.outcome === "decline" ? 0 : intent.amountCents,
        status: decision.outcome === "decline" ? "declined" : "pending",
        provider: null,
        providerTransactionId: null,
        idempotencyKey: `hold:${intent.id}:${decision.reason}`,
        ref: intent.id,
        note: `${decision.outcome}:${decision.reason}:${intent.productType}:${intent.merchant}`,
      });
      db.exec("COMMIT");
      return { decision, issuerCalled: false, row };
    }
    const claim = db.prepare("SELECT state FROM purchase_claims WHERE intent_id = ?").get(intent.id) as { state: string } | undefined;
    if (claim?.state === "executed") {
      db.exec("COMMIT");
      return { decision: { outcome: "auto_approve", reason: "ALREADY_EXECUTED" }, issuerCalled: false, row: ledger.findByIdempotency(execKey) };
    }
    if (claim?.state === "unknown") {
      db.exec("COMMIT");
      return { decision: { outcome: "queue", reason: "ISSUER_UNKNOWN" }, issuerCalled: false, row: ledger.findByIdempotency(`reserve:${intent.id}`) };
    }
    if (claim?.state === "claimed") {
      db.exec("COMMIT");
      return waitForPurchase(db, intent.id, execKey, decision);
    }
    reserved = ledger.append({
      id: `reserve-${intent.id}`,
      atMs,
      kind: "approval",
      amountCents: intent.amountCents,
      status: "intent",
      provider: null,
      providerTransactionId: null,
      idempotencyKey: `reserve:${intent.id}`,
      ref: intent.id,
      note: `Reserved before issuer. ${intent.productType} at ${intent.merchant}.`,
    });
    if (claim?.state === "released") {
      db.prepare("UPDATE purchase_claims SET state = 'claimed', amount_cents = ?, created_at = ? WHERE intent_id = ?").run(intent.amountCents, atMs, intent.id);
    } else {
      db.prepare(
        "INSERT INTO purchase_claims(intent_id, idempotency_key, state, amount_cents, ledger_id, created_at) VALUES(?, ?, 'claimed', ?, ?, ?)",
      ).run(intent.id, execKey, intent.amountCents, reserved.id, atMs);
    }
    ownsClaim = true;
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* no open transaction */ }
    throw error;
  }

  let result: IssuerResult;
  try {
    result = issuer.authorize(intent, execKey);
  } catch {
    db.prepare("UPDATE purchase_claims SET state = 'unknown' WHERE intent_id = ?").run(intent.id);
    noteIssuerUnknown(db, intent);
    return { decision: { outcome: "queue", reason: "ISSUER_UNKNOWN" }, issuerCalled: true, row: reserved };
  }
  const status = ledgerStatusFor(issuer.name, result.status);
  if (result.status === "declined") {
    const row = ledger.append({
      id: `decline-${intent.id}`,
      atMs,
      kind: "decline",
      amountCents: 0,
      status: "declined",
      provider: issuer.name,
      providerTransactionId: null,
      idempotencyKey: `decline:${intent.id}`,
      ref: intent.id,
      note: `Issuer declined ${intent.productType} at ${intent.merchant}. Not counted toward caps.`,
    });
    db.prepare("UPDATE purchase_claims SET state = 'released', ledger_id = ? WHERE intent_id = ?").run(row.id, intent.id);
    return { decision: { outcome: "decline", reason: result.reason || "ISSUER_DECLINED" }, issuerCalled: true, row };
  }
  const row = ledger.append({
    id: `purchase-${intent.id}`,
    atMs,
    kind: "purchase",
    amountCents: intent.amountCents,
    status,
    provider: issuer.name,
    providerTransactionId: result.providerTransactionId || null,
    idempotencyKey: execKey,
    ref: intent.id,
    note: `${intent.productType} at ${intent.merchant}. ${intent.reason}`,
  });
  db.prepare("UPDATE purchase_claims SET state = 'executed', ledger_id = ? WHERE intent_id = ?").run(row.id, intent.id);
  void ownsClaim;
  return { decision, issuerCalled: true, row };
}

function waitForPurchase(db: DatabaseSync, _intentId: string, execKey: string, decision: Decision): Execution {
  const ledger = new Ledger(db);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const row = ledger.findByIdempotency(execKey);
    if (row?.kind === "purchase") return { decision: { outcome: "auto_approve", reason: "ALREADY_EXECUTED" }, issuerCalled: false, row };
    pause(10);
  }
  return { decision: { ...decision, reason: "EXECUTION_IN_PROGRESS" }, issuerCalled: false, row: ledger.findByIdempotency(`reserve:${_intentId}`) };
}

function noteIssuerUnknown(db: DatabaseSync, intent: PurchaseIntent): void {
  db.prepare("INSERT INTO owner_alerts(id, kind, title, detail, created_at) VALUES(?, 'issuer', ?, ?, ?)").run(
    randomBytes(8).toString("hex"),
    "Issuer outcome unknown",
    `${intent.id} may have charged ${intent.amountCents} cents at ${intent.merchant}. Auto-retry is blocked until the issuer is checked or the keeper resolves it.`,
    Date.now(),
  );
}

/** Resolve an UNKNOWN claim without a fresh purchase. Lookup must honor the idempotency key. */
export function resolveUnknown(db: DatabaseSync, intent: PurchaseIntent, atMs: number, source: { lookup?: () => IssuerResult | null; owner?: "clear" }): Execution {
  const claim = db.prepare("SELECT state FROM purchase_claims WHERE intent_id = ?").get(intent.id) as { state: string } | undefined;
  if (claim?.state !== "unknown") return { decision: { outcome: "decline", reason: "NOT_UNKNOWN" }, issuerCalled: false, row: null };
  if (source.owner === "clear") {
    db.prepare("UPDATE purchase_claims SET state = 'released' WHERE intent_id = ?").run(intent.id);
    return { decision: { outcome: "decline", reason: "OWNER_CLEARED_UNKNOWN" }, issuerCalled: false, row: null };
  }
  const found = source.lookup ? source.lookup() : null;
  if (!found || found.status !== "approved") {
    return { decision: { outcome: "queue", reason: "ISSUER_UNKNOWN" }, issuerCalled: false, row: new Ledger(db).findByIdempotency(`reserve:${intent.id}`) };
  }
  const row = new Ledger(db).append({
    id: `purchase-${intent.id}`,
    atMs,
    kind: "purchase",
    amountCents: intent.amountCents,
    status: "unconfirmed",
    provider: null,
    providerTransactionId: found.providerTransactionId || null,
    idempotencyKey: `exec:${intent.id}`,
    ref: intent.id,
    note: `${intent.productType} at ${intent.merchant}. Resolved from the issuer key, not a new charge.`,
  });
  db.prepare("UPDATE purchase_claims SET state = 'executed', ledger_id = ? WHERE intent_id = ?").run(row.id, intent.id);
  return { decision: { outcome: "auto_approve", reason: "RESOLVED_UNKNOWN" }, issuerCalled: false, row };
}

function pause(ms: number): void {
  const gate = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(gate, 0, 0, ms);
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
    if ((claim.state !== "claimed" && claim.state !== "unknown") || covered.has(claim.intent_id)) continue;
    const stamp = new Date(claim.created_at).toISOString();
    if (stamp.slice(0, 10) === day) today += claim.amount_cents;
    if (stamp.slice(0, 7) === month) monthTotal += claim.amount_cents;
  }
  const disputes = db.prepare("SELECT COUNT(*) AS n FROM disputes WHERE open = 1").get() as { n: number };
  return { today, month: monthTotal, recent, openDispute: Number(disputes.n) > 0 };
}
