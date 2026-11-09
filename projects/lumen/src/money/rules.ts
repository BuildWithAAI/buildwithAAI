/**
 * Money rules, in one place, for review.
 *
 * Dollar amounts are never hardcoded. The owner sets them with env vars.
 * A missing optional cap means the card's own limit is the ceiling.
 * A missing or malformed value fails closed: no spending and no live sales.
 *
 * SPEND_ENABLED                      "true" or "false". Missing means spending is off. Anything else is invalid.
 * LUMEN_KILL_SWITCH                  "true" stops LLM, purchases, and the storefront. Missing or "false" leaves it to the admin flag. Anything else kills.
 * LUMEN_SALES_MODE                   "disabled", "test", or "live". Missing means disabled.
 * STRIPE_SECRET_KEY                  Stripe secret. Test mode requires sk_test_. Live mode requires sk_live_.
 * STRIPE_WEBHOOK_SECRET              Webhook signing secret.
 * LUMEN_SALES_CHANNELS               Comma list. Checkout stays closed until it includes stripe_checkout.
 * LUMEN_MERCHANT_ALLOWLIST           Comma list of merchant ids. Empty means every merchant needs approval.
 * LUMEN_APPROVED_PRODUCT_TYPES       Comma list. human_gig is off unless the owner adds it.
 * LUMEN_AUTO_APPROVE_CAP_CENTS       Integer cents, or unset. Unset means nothing is auto-approved.
 * LUMEN_PER_PURCHASE_CAP_CENTS       Optional hard cap. Unset means no software per-purchase cap.
 * LUMEN_DAILY_CAP_CENTS              Optional. Unset means no software daily cap.
 * LUMEN_MONTHLY_CAP_CENTS            Optional. Unset means no software monthly cap.
 * LUMEN_PRODUCT_MERCHANTS            type:merchant pairs. Example: art_supplies:paper-shop
 * LUMEN_PRODUCT_AMOUNT_CENTS         type:cents pairs. No amount, no intent.
 * LUMEN_ART_PRICE_CENTS              Integer cents for a listing, or unset. Unset means art is not priced.
 * LUMEN_WISH_GUESSES                 catalogId:cents guesses. Unset means Lumen states no price.
 * LUMEN_CARD_ISSUER                  mock, stripe_issuing, or privacy.
 * OWNER_PASSWORD_HASH                scrypt hash from `npm run hash-password`.
 * OWNER_ACCESS_TOKEN                 Optional magic token. Compared in constant time.
 * OWNER_SESSION_SECRET               Extra signer material for session ids. Required for admin login.
 * LUMEN_OWNER_NAME                   Display name. Defaults to keeper.
 * LUMEN_LLM_BASE_URL                 OpenAI-compatible base URL.
 * LUMEN_LLM_API_KEY                  Model key. Header only. Never enters prompts, logs, or the DB.
 * LUMEN_LLM_MODEL                    Fast model for Decide/Speak.
 * LUMEN_LLM_QUALITY_MODEL            Optional model name recorded for Sleep. Local sleep does not call it.
 * LUMEN_READ_ALLOWLIST               HTTPS hosts the read_page action may fetch.
 * LUMEN_TICK_MS                      Tick interval, minimum 4000.
 * LUMEN_DATA                         SQLite path.
 * LUMEN_QUIET_HOURS                  "start-end" UTC hours, default 0-6.
 */

export type MoneyRules = {
  merchants: string[];
  productTypes: string[];
  channels: string[];
  autoApproveCapCents: number | null;
  perPurchaseCapCents: number | null;
  dailyCapCents: number | null;
  monthlyCapCents: number | null;
  productMerchants: Record<string, string>;
  productAmounts: Record<string, number>;
  artPriceCents: number | null;
  wishGuesses: Record<string, number>;
  cardIssuer: "mock" | "stripe_issuing" | "privacy";
};

export type Env = Record<string, string | undefined>;

const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function parseMoneyRules(env: Env): { ok: true; rules: MoneyRules } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const spend = env.SPEND_ENABLED;
  if (spend !== undefined && spend !== "true" && spend !== "false") errors.push("SPEND_ENABLED");
  const mode = env.LUMEN_SALES_MODE;
  if (mode !== undefined && mode !== "" && mode !== "disabled" && mode !== "test" && mode !== "live") errors.push("LUMEN_SALES_MODE");
  const auto = cents(env.LUMEN_AUTO_APPROVE_CAP_CENTS, "LUMEN_AUTO_APPROVE_CAP_CENTS", errors);
  const per = cents(env.LUMEN_PER_PURCHASE_CAP_CENTS, "LUMEN_PER_PURCHASE_CAP_CENTS", errors);
  const daily = cents(env.LUMEN_DAILY_CAP_CENTS, "LUMEN_DAILY_CAP_CENTS", errors);
  const monthly = cents(env.LUMEN_MONTHLY_CAP_CENTS, "LUMEN_MONTHLY_CAP_CENTS", errors);
  const art = cents(env.LUMEN_ART_PRICE_CENTS, "LUMEN_ART_PRICE_CENTS", errors);
  const merchants = names(env.LUMEN_MERCHANT_ALLOWLIST, "LUMEN_MERCHANT_ALLOWLIST", errors);
  const productTypes = names(env.LUMEN_APPROVED_PRODUCT_TYPES, "LUMEN_APPROVED_PRODUCT_TYPES", errors);
  const channels = names(env.LUMEN_SALES_CHANNELS, "LUMEN_SALES_CHANNELS", errors);
  const productMerchants = pairs(env.LUMEN_PRODUCT_MERCHANTS, "merchant", errors);
  const productAmounts = amountPairs(env.LUMEN_PRODUCT_AMOUNT_CENTS, errors);
  const wishGuesses = amountPairs(env.LUMEN_WISH_GUESSES, errors);
  const issuerRaw = env.LUMEN_CARD_ISSUER ?? "mock";
  if (issuerRaw !== "mock" && issuerRaw !== "stripe_issuing" && issuerRaw !== "privacy") errors.push("LUMEN_CARD_ISSUER");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    rules: {
      merchants,
      productTypes,
      channels,
      autoApproveCapCents: auto,
      perPurchaseCapCents: per,
      dailyCapCents: daily,
      monthlyCapCents: monthly,
      productMerchants,
      productAmounts,
      artPriceCents: art,
      wishGuesses,
      cardIssuer: issuerRaw as MoneyRules["cardIssuer"],
    },
  };
}

function cents(raw: string | undefined, label: string, errors: string[]): number | null {
  if (raw === undefined || raw === "") return null;
  if (!/^\d+$/.test(raw)) {
    errors.push(label);
    return null;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) errors.push(label);
  return value;
}

function names(raw: string | undefined, label: string, errors: string[]): string[] {
  if (!raw) return [];
  const items = raw.split(",").map((item) => item.trim()).filter(Boolean);
  if (items.some((item) => !NAME.test(item))) errors.push(label);
  return items;
}

function pairs(raw: string | undefined, _kind: string, errors: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const part of raw.split(",")) {
    const [type, merchant] = part.split(":").map((item) => item.trim());
    if (!type || !merchant || !NAME.test(type) || !NAME.test(merchant)) {
      errors.push("LUMEN_PRODUCT_MERCHANTS");
      continue;
    }
    out[type] = merchant;
  }
  return out;
}

function amountPairs(raw: string | undefined, errors: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw) return out;
  for (const part of raw.split(",")) {
    const [type, amount] = part.split(":").map((item) => item.trim());
    if (!type || !NAME.test(type) || !amount || !/^\d+$/.test(amount)) {
      errors.push("AMOUNT_PAIR");
      continue;
    }
    out[type] = Number(amount);
  }
  return out;
}

export function killSwitchOn(env: Env, adminFlag: boolean): boolean {
  const raw = env.LUMEN_KILL_SWITCH;
  if (raw === undefined || raw === "" || raw === "false") return adminFlag;
  return true;
}

export type SalesMode = "disabled" | "test" | "live";

export function salesMode(env: Env, rulesOk: boolean, killed: boolean): SalesMode {
  if (killed || !rulesOk) return "disabled";
  const mode = env.LUMEN_SALES_MODE;
  const key = env.STRIPE_SECRET_KEY ?? "";
  const webhook = env.STRIPE_WEBHOOK_SECRET ?? "";
  if (!key || !webhook) return "disabled";
  const parsed = parseMoneyRules(env);
  if (!parsed.ok || !parsed.rules.channels.includes("stripe_checkout")) return "disabled";
  if (mode === "test" && key.startsWith("sk_test_")) return "test";
  if (mode === "live" && key.startsWith("sk_live_")) return "live";
  return "disabled";
}

export function spendAllowed(env: Env, rulesOk: boolean, killed: boolean, adminSpend: boolean): { open: boolean; reason: string } {
  if (killed) return { open: false, reason: "KILL_SWITCH" };
  if (!rulesOk) return { open: false, reason: "CONFIG_INVALID" };
  if (env.SPEND_ENABLED !== "true") return { open: false, reason: "SPEND_DISABLED" };
  if (!adminSpend) return { open: false, reason: "SPEND_ADMIN_OFF" };
  return { open: true, reason: "OPEN" };
}
