import type { PurchaseIntent } from "../brain/types";
import { cardCredentials } from "./card";
import type { Env } from "./rules";

export type IssuerResult = {
  providerTransactionId: string;
  status: "approved" | "declined" | "unknown";
  reason: string;
};

export interface CardIssuer {
  name: "mock" | "stripe_issuing" | "privacy";
  authorize(intent: PurchaseIntent, idempotencyKey: string): IssuerResult;
  listActivity(): { provider: string; providerTransactionId: string; amountCents: number; kind: string }[];
}

const FORBIDDEN_KEY = /"(pan|cvc|cvv|card_number|cardnumber|full_number|secret|api_key|card_token)"\s*:/i;

export function assertNoCardMaterial(value: unknown): void {
  const json = JSON.stringify(value);
  if (FORBIDDEN_KEY.test(json)) throw new Error("CARD_MATERIAL");
  if (/\b\d{13,19}\b/.test(json)) throw new Error("CARD_MATERIAL");
}

export class MockIssuer implements CardIssuer {
  name = "mock" as const;
  calls: PurchaseIntent[] = [];
  keys: string[] = [];
  activity: { provider: string; providerTransactionId: string; amountCents: number; kind: string }[] = [];
  authorize(intent: PurchaseIntent, idempotencyKey: string): IssuerResult {
    assertNoCardMaterial(intent);
    if (!idempotencyKey) throw new Error("IDEMPOTENCY_KEY_REQUIRED");
    this.calls.push(intent);
    this.keys.push(idempotencyKey);
    const providerTransactionId = `mock_${intent.id}`;
    this.activity.push({ provider: "mock", providerTransactionId, amountCents: intent.amountCents, kind: "purchase" });
    return { providerTransactionId, status: "approved", reason: "MOCK_APPROVED" };
  }
  listActivity() {
    return this.activity.filter((row) => row.provider !== "mock");
  }
}

/**
 * Live card path. An approved intent is an expected spend. The issuer charges later.
 * This object does not keep the API key and it never sees a card number.
 */
export class ExpectedIssuer implements CardIssuer {
  constructor(readonly name: "stripe_issuing" | "privacy") {}
  authorize(intent: PurchaseIntent, idempotencyKey: string): IssuerResult {
    assertNoCardMaterial(intent);
    if (!idempotencyKey) throw new Error("IDEMPOTENCY_KEY_REQUIRED");
    return { providerTransactionId: "", status: "approved", reason: "EXPECTED_SPEND" };
  }
  listActivity() {
    return [];
  }
}

/** Stub. It does not call Stripe and it cannot see a card number. */
export class StripeIssuingStub implements CardIssuer {
  name = "stripe_issuing" as const;
  authorize(intent: PurchaseIntent, idempotencyKey: string): IssuerResult {
    assertNoCardMaterial(intent);
    if (!idempotencyKey) throw new Error("IDEMPOTENCY_KEY_REQUIRED");
    return { providerTransactionId: "", status: "declined", reason: "STRIPE_ISSUING_NOT_CONNECTED" };
  }
  listActivity() {
    return [];
  }
}

/** Stub. Privacy.com stays unconnected until the owner adds it. */
export class PrivacyStub implements CardIssuer {
  name = "privacy" as const;
  authorize(intent: PurchaseIntent, idempotencyKey: string): IssuerResult {
    assertNoCardMaterial(intent);
    if (!idempotencyKey) throw new Error("IDEMPOTENCY_KEY_REQUIRED");
    return { providerTransactionId: "", status: "declined", reason: "PRIVACY_NOT_CONNECTED" };
  }
  listActivity() {
    return [];
  }
}

export function createIssuer(kind: string, env: Env = {}): CardIssuer {
  if (kind === "stripe_issuing") return cardCredentials({ ...env, LUMEN_CARD_ISSUER: "stripe_issuing" }) ? new ExpectedIssuer("stripe_issuing") : new StripeIssuingStub();
  if (kind === "privacy") return cardCredentials({ ...env, LUMEN_CARD_ISSUER: "privacy" }) ? new ExpectedIssuer("privacy") : new PrivacyStub();
  return new MockIssuer();
}

export function ledgerStatusFor(issuer: string, status: IssuerResult["status"]): "confirmed" | "unconfirmed" | "declined" {
  if (status === "declined") return "declined";
  if (issuer === "mock") return "unconfirmed";
  return "confirmed";
}
