import { publicModeOn } from "../auth/publicMode";
import { cardCredentials } from "./card";

/**
 * Money rules, in one place, for review.
 *
 * Dollar amounts are never hardcoded. The owner sets them with env vars.
 * A missing optional cap means the card's own limit is the ceiling.
 * A missing or malformed value fails closed: no spending and no live sales.
 *
 * LUMEN_SPEND_ENABLED                Exact "true" plus an issuing key that is not the sales key. A sales key does not turn spending on.
 * LUMEN_SALES_ENABLED                Exact "true" plus sk_live_ and the webhook secret. Keys alone do not open live sales.
 * SPEND_ENABLED                      Legacy parse only. "true" or "false". Anything else is invalid. It does not open spending.
 * SALES_ENABLED                      Legacy parse only. It does not open live sales.
 * MINT_ENABLED                       "true" or "false". Missing is on when MINT_SIGNER_URL is set. This process never holds the mint key.
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
 * REQUIRE_HARD_CAPS_WHEN_SPENDING    One constant in this file. False keeps those three caps optional.
 * LUMEN_PRODUCT_MERCHANTS            type:merchant pairs. Example: art_supplies:paper-shop
 * LUMEN_PRODUCT_AMOUNT_CENTS         type:cents pairs. No amount, no intent.
 * LUMEN_ART_PRICE_CENTS              Integer cents for a listing, or unset. Unset means art is not priced.
 * LUMEN_WISH_GUESSES                 catalogId:cents guesses. Unset means Zoora states no price.
 * LUMEN_CARD_ISSUER                  mock, stripe_issuing, privacy, or owner_checkout.
 * LUMEN_CARD_AVAILABLE_USD           Owner-updated card balance or limit. Unset means owner_checkout cannot spend.
 * OWNER_PASSWORD_HASH                scrypt hash from `npm run hash-password`.
 * OWNER_ACCESS_TOKEN                 Optional magic token. Compared in constant time.
 * OWNER_SESSION_SECRET               Extra signer material for session ids. Required for admin login.
 * LUMEN_OWNER_NAME                   Display name. Defaults to keeper.
 * LUMEN_LLM_BASE_URL                 OpenAI-compatible base URL.
 * LUMEN_LLM_API_KEY                  Model key. Header only. Never enters prompts, logs, or the DB.
 * LUMEN_LLM_MODEL                    Fast model for Decide/Speak.
 * LUMEN_LLM_QUALITY_MODEL            Optional model name recorded for Sleep. Local sleep does not call it.
 * LUMEN_READ_ALLOWLIST               HTTPS hosts the read_page action may fetch.
 * LUMEN_SEARCH_PROVIDER             mock (default) or brave. Missing key uses mock.
 * LUMEN_SEARCH_API_KEY              Search key. It is not sent when fetching a page.
 * LUMEN_RESEARCH_HOUR_MAX           Optional. Cannot raise the code cap of 4 queries an hour.
 * LUMEN_RESEARCH_DAY_MAX            Optional. Cannot raise the code cap of 12 queries a day.
 * LUMEN_TICK_MS                      Tick interval, minimum 4000.
 * LUMEN_DATA                         SQLite path.
 * LUMEN_QUIET_HOURS                  "start-end" UTC hours, default 0-6.
 * LUMEN_PUBLIC_MODE                  "true" is the public site and closes the desk login. It is not the money switch.
 * LUMEN_MONEY_LIVE                   Exact "true" lets spend, live sales, minting, Solana Pay, and live trading run while the public login stays closed. Unset keeps that money off on the public site.
 * LUMEN_LISTING_MAX_USD              Optional dollar cap for a listing Zoora publishes. Unset means no cap. A bad value closes new prices.
 * LUMEN_TRUSTED_PROXY                none, fly, forwarded, cloudflare (CF-Connecting-IP), or ngrok.
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
  cardIssuer: "mock" | "stripe_issuing" | "privacy" | "owner_checkout";
};

export type Env = Record<string, string | undefined>;

const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/**
 * One-line owner switch. False: an unset per-purchase, daily, or monthly cap means
 * the card's own limit is the ceiling. True: spending stays closed until all three
 * are set. Dollar amounts always come from env, never from this file.
 */
export const REQUIRE_HARD_CAPS_WHEN_SPENDING = false;

export function hardCapGap(rules: MoneyRules, requireHardCaps = REQUIRE_HARD_CAPS_WHEN_SPENDING): string | null {
  if (!requireHardCaps) return null;
  if (rules.perPurchaseCapCents == null) return "PER_PURCHASE_CAP_REQUIRED";
  if (rules.dailyCapCents == null) return "DAILY_CAP_REQUIRED";
  if (rules.monthlyCapCents == null) return "MONTHLY_CAP_REQUIRED";
  const auto = rules.autoApproveCapCents;
  const per = rules.perPurchaseCapCents;
  const daily = rules.dailyCapCents;
  const monthly = rules.monthlyCapCents;
  if (auto != null && per != null && auto > per) return "AUTO_CAP_ABOVE_PER_PURCHASE";
  if (per != null && daily != null && per > daily) return "PER_PURCHASE_ABOVE_DAILY";
  if (daily != null && monthly != null && daily > monthly) return "DAILY_ABOVE_MONTHLY";
  return null;
}

export function parseMoneyRules(env: Env): { ok: true; rules: MoneyRules } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  for (const key of ["SPEND_ENABLED", "SALES_ENABLED", "MINT_ENABLED"]) {
    const value = env[key];
    if (value !== undefined && value !== "" && value !== "true" && value !== "false") errors.push(key);
  }
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
  if (issuerRaw !== "mock" && issuerRaw !== "stripe_issuing" && issuerRaw !== "privacy" && issuerRaw !== "owner_checkout") errors.push("LUMEN_CARD_ISSUER");
  const available = cardAvailableCents(env);
  if (env.LUMEN_CARD_AVAILABLE_USD !== undefined && env.LUMEN_CARD_AVAILABLE_USD !== "" && available == null) errors.push("LUMEN_CARD_AVAILABLE_USD");
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

/** Dollars the owner last set. Missing or malformed is null. This does not invent a balance. */
export function cardAvailableCents(env: Env): number | null {
  const raw = (env.LUMEN_CARD_AVAILABLE_USD ?? "").trim();
  if (!raw) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const [whole, frac = ""] = raw.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0) return null;
  return cents;
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

/** Live money on the public site. This does not open the desk login. */
export function moneyLive(env: Env = process.env): boolean {
  return env.LUMEN_MONEY_LIVE === "true";
}

/** Public mode keeps money off until LUMEN_MONEY_LIVE is set. The login check stays separate. */
export function publicMoneyClosed(env: Env = process.env): boolean {
  return publicModeOn(env) && !moneyLive(env);
}

export function killSwitchOn(env: Env, adminFlag: boolean): boolean {
  const raw = env.LUMEN_KILL_SWITCH;
  if (raw === undefined || raw === "" || raw === "false") return adminFlag;
  return true;
}

export type SalesMode = "disabled" | "test" | "live";

export function salesCredentials(env: Env): boolean {
  const key = env.STRIPE_SECRET_KEY ?? "";
  return key.startsWith("sk_live_") && Boolean(env.STRIPE_WEBHOOK_SECRET);
}

export function salesMode(env: Env, rulesOk: boolean, killed: boolean): SalesMode {
  if (publicMoneyClosed(env) || killed || !rulesOk) return "disabled";
  if (env.LUMEN_SALES_MODE === "disabled") return "disabled";
  const mode = env.LUMEN_SALES_MODE;
  const key = env.STRIPE_SECRET_KEY ?? "";
  const webhook = env.STRIPE_WEBHOOK_SECRET ?? "";
  if (!key || !webhook) return "disabled";
  const parsed = parseMoneyRules(env);
  if (!parsed.ok) return "disabled";
  const channel = parsed.rules.channels.includes("stripe_checkout") || parsed.rules.channels.length === 0;
  if (!channel) return "disabled";
  if (mode === "test" && key.startsWith("sk_test_")) return "test";
  if (env.LUMEN_SALES_ENABLED === "true" && key.startsWith("sk_live_")) return "live";
  return "disabled";
}

export function spendSwitchOn(env: Env): boolean {
  if (publicMoneyClosed(env)) return false;
  return env.LUMEN_SPEND_ENABLED === "true" && cardCredentials(env);
}

export function spendAllowed(env: Env, rulesOk: boolean, killed: boolean, adminSpend: boolean): { open: boolean; reason: string } {
  if (publicMoneyClosed(env)) return { open: false, reason: "PUBLIC_MODE" };
  if (killed) return { open: false, reason: "KILL_SWITCH" };
  if (!rulesOk) return { open: false, reason: "CONFIG_INVALID" };
  if (!spendSwitchOn(env)) return { open: false, reason: "SPEND_DISABLED" };
  if (!adminSpend) return { open: false, reason: "SPEND_ADMIN_OFF" };
  if (REQUIRE_HARD_CAPS_WHEN_SPENDING) {
    const parsed = parseMoneyRules(env);
    if (!parsed.ok) return { open: false, reason: "CONFIG_INVALID" };
    const gap = hardCapGap(parsed.rules, true);
    if (gap) return { open: false, reason: gap };
  }
  return { open: true, reason: "OPEN" };
}
