import type { PurchaseIntent } from "../brain/types";
import type { CardIssuer } from "./issuers";
import { ledgerStatusFor } from "./issuers";
import { Ledger, type LedgerRow } from "./ledger";
import { evaluatePolicy, type PolicyContext, type Decision } from "./policy";

export type Execution = { decision: Decision; issuerCalled: boolean; row: LedgerRow };

export function executeIntent(intent: PurchaseIntent, ctx: PolicyContext, issuer: CardIssuer, ledger: Ledger, atMs: number): Execution {
  const decision = evaluatePolicy(intent, ctx);
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
    return { decision, issuerCalled: false, row };
  }
  const result = issuer.authorize(intent);
  const status = ledgerStatusFor(issuer.name, result.status);
  const row = ledger.append({
    id: `led-${intent.id}`,
    atMs,
    kind: result.status === "declined" ? "decline" : "purchase",
    amountCents: result.status === "declined" ? 0 : intent.amountCents,
    status,
    provider: issuer.name,
    providerTransactionId: result.providerTransactionId || null,
    idempotencyKey: `intent:${intent.id}`,
    ref: intent.id,
    note: `${intent.productType} at ${intent.merchant}. ${intent.reason}`,
  });
  return { decision, issuerCalled: true, row };
}
