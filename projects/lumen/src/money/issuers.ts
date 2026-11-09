import type { PurchaseIntent } from "../brain/types";

export type IssuerResult = {
  providerTransactionId: string;
  status: "approved" | "declined";
  reason: string;
};

export interface CardIssuer {
  name: "mock" | "stripe_issuing" | "privacy";
  authorize(intent: PurchaseIntent): IssuerResult;
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
  activity: { provider: string; providerTransactionId: string; amountCents: number; kind: string }[] = [];
  authorize(intent: PurchaseIntent): IssuerResult {
    assertNoCardMaterial(intent);
    this.calls.push(intent);
    const providerTransactionId = `mock_${intent.id}`;
    this.activity.push({ provider: "mock", providerTransactionId, amountCents: intent.amountCents, kind: "purchase" });
    return { providerTransactionId, status: "approved", reason: "MOCK_APPROVED" };
  }
  listActivity() {
    return this.activity.filter((row) => row.provider !== "mock");
  }
}

/** Stub. It does not call Stripe and it cannot see a card number. */
export class StripeIssuingStub implements CardIssuer {
  name = "stripe_issuing" as const;
  authorize(intent: PurchaseIntent): IssuerResult {
    assertNoCardMaterial(intent);
    return { providerTransactionId: "", status: "declined", reason: "STRIPE_ISSUING_NOT_CONNECTED" };
  }
  listActivity() {
    return [];
  }
}

/** Stub. Privacy.com stays unconnected until the owner adds it. */
export class PrivacyStub implements CardIssuer {
  name = "privacy" as const;
  authorize(intent: PurchaseIntent): IssuerResult {
    assertNoCardMaterial(intent);
    return { providerTransactionId: "", status: "declined", reason: "PRIVACY_NOT_CONNECTED" };
  }
  listActivity() {
    return [];
  }
}

export function createIssuer(kind: string): CardIssuer {
  if (kind === "stripe_issuing") return new StripeIssuingStub();
  if (kind === "privacy") return new PrivacyStub();
  return new MockIssuer();
}

export function ledgerStatusFor(issuer: string, status: IssuerResult["status"]): "confirmed" | "unconfirmed" | "declined" {
  if (status === "declined") return "declined";
  if (issuer === "mock") return "unconfirmed";
  return "confirmed";
}
