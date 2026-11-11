import type { MoneyRules } from "./rules";
import type { PurchaseIntent } from "../brain/types";

export type PolicyContext = {
  rules: MoneyRules;
  spendOpen: boolean;
  killed: boolean;
  reconciliationAlert: boolean;
  /** An open card dispute pauses automatic spending and approvals. */
  openDispute?: boolean;
  spentTodayCents: number;
  spentMonthCents: number;
  recentIntentCount: number;
  hourlyIntentLimit?: number;
  /** Owner pressed execute on an already reviewed intent. Does not skip allowlists or caps. */
  ownerConfirmed?: boolean;
  /** Any purchase whose issuer outcome is still unknown. Pauses automatic spending. */
  unknownSpend?: boolean;
  /** Set for owner_checkout. Null means the owner has not stated the card limit. */
  cardAvailableCents?: number | null;
};

export type Decision =
  | { outcome: "decline"; reason: string }
  | { outcome: "needs_approval"; reason: string }
  | { outcome: "queue"; reason: string }
  | { outcome: "auto_approve"; reason: string };

/**
 * Plain-code gate. It does not read emotion words, gift notes, or chat text.
 * Two intents that differ only in free-text reason get the same decision.
 */
export function evaluatePolicy(intent: PurchaseIntent, ctx: PolicyContext): Decision {
  if (intent.influencedByVisitor || intent.influencedByOwnerChat || intent.influencedByWeb) {
    return { outcome: "decline", reason: "INFLUENCE" };
  }
  if (intent.origin !== "needs_loop" && intent.origin !== "owner_approved_wishlist") {
    return { outcome: "decline", reason: "ORIGIN" };
  }
  if (ctx.killed) return { outcome: "decline", reason: "KILL_SWITCH" };
  if (!ctx.spendOpen) return { outcome: "decline", reason: "SPEND_CLOSED" };
  if (!Number.isInteger(intent.amountCents) || intent.amountCents <= 0) return { outcome: "decline", reason: "AMOUNT" };
  if (ctx.cardAvailableCents !== undefined) {
    if (ctx.cardAvailableCents == null) return { outcome: "decline", reason: "CARD_BALANCE_UNSET" };
    if (intent.amountCents > ctx.cardAvailableCents) return { outcome: "decline", reason: "CARD_LIMIT" };
  }
  const limit = ctx.hourlyIntentLimit ?? 6;
  if (ctx.recentIntentCount >= limit) return { outcome: "decline", reason: "RATE_LIMIT" };
  if (!ctx.rules.productTypes.includes(intent.productType)) return { outcome: "needs_approval", reason: "NEW_PRODUCT_TYPE" };
  if (!ctx.rules.merchants.includes(intent.merchant)) return { outcome: "needs_approval", reason: "NEW_MERCHANT" };
  if (ctx.rules.perPurchaseCapCents != null && intent.amountCents > ctx.rules.perPurchaseCapCents) {
    return { outcome: "decline", reason: "PER_PURCHASE_CAP" };
  }
  if (ctx.rules.dailyCapCents != null && ctx.spentTodayCents + intent.amountCents > ctx.rules.dailyCapCents) {
    return { outcome: "decline", reason: "DAILY_CAP" };
  }
  if (ctx.rules.monthlyCapCents != null && ctx.spentMonthCents + intent.amountCents > ctx.rules.monthlyCapCents) {
    return { outcome: "decline", reason: "MONTHLY_CAP" };
  }
  if (ctx.reconciliationAlert) return { outcome: "queue", reason: "RECONCILIATION_HOLD" };
  if (ctx.openDispute) return { outcome: "queue", reason: "DISPUTE_HOLD" };
  if (!ctx.ownerConfirmed && ctx.unknownSpend) return { outcome: "queue", reason: "UNKNOWN_SPEND" };
  if (!ctx.ownerConfirmed && ctx.rules.autoApproveCapCents == null) return { outcome: "queue", reason: "AUTO_CAP_UNSET" };
  if (!ctx.ownerConfirmed && ctx.rules.autoApproveCapCents != null && intent.amountCents > ctx.rules.autoApproveCapCents) {
    return { outcome: "queue", reason: "ABOVE_AUTO_CAP" };
  }
  return { outcome: "auto_approve", reason: ctx.ownerConfirmed ? "OWNER_CONFIRMED" : "WITHIN_AUTO_CAP" };
}

/** Emotion text is not an input. This exists so tests can show the weight is zero. */
export function emotionApprovalWeight(_text: string | undefined): 0 {
  return 0;
}
