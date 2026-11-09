import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { makeSvg, artTitle } from "../brain/art";
import { glowFor } from "../brain/emotions";
import { giftById, giftDeltas, interactDeltas, moderateNote, ownerTurn, publicWants, reactionToOwnerDecision, sortInbox, artReaction, GIFT_CATALOG } from "../brain/social";
import { applyNeedDeltas } from "../brain/feel";
import { blendEmotions } from "../brain/emotions";
import { blankProduct, initialState, labelsOf, tick, type TickResult } from "../brain/tick";
import type { BrainState, PurchaseIntent, Wish } from "../brain/types";
import { createSession, credentialsMatch, OWNER_COOKIE, ownerConfigured, readCookie, sessionValid } from "../auth/owner";
import { allowRate, flag, kvGet, kvSet, openDatabase, setFlag } from "../db/db";
import { executeIntent } from "../money/execute";
import { createIssuer, type CardIssuer } from "../money/issuers";
import { Ledger, moneyView, type LedgerRow } from "../money/ledger";
import { evaluatePolicy, type PolicyContext } from "../money/policy";
import { compareRecords, type ProviderRecord } from "../money/reconcile";
import { killSwitchOn, parseMoneyRules, salesMode, spendAllowed, type Env } from "../money/rules";
import { stripeSalesClient } from "../money/stripe";

type GlobalEngine = { engine?: Engine };

export type Engine = ReturnType<typeof createEngine>;

export function getEngine(): Engine {
  const holder = globalThis as GlobalEngine;
  if (!holder.engine) holder.engine = createEngine(process.env);
  return holder.engine;
}

export function createEngine(env: Env, file?: string) {
  const db = openDatabase(file ?? env.LUMEN_DATA ?? `${process.cwd()}/data/lumen.sqlite`);
  const issuer = createIssuer(env.LUMEN_CARD_ISSUER ?? "mock");
  ensureSeed(db);
  return {
    db,
    env,
    issuer,
    now: () => Date.now(),
    snapshot: () => snapshot(db, env),
    tickOnce: () => runTick(db, env, issuer, Date.now()),
    leaveGift: (giftId: string, note: unknown, author: string, ip: string) => leaveGift(db, env, giftId, note, author, ip),
    interact: (kind: "wave" | "tap", ip: string) => interact(db, kind, ip),
    guestbook: (note: unknown, author: string, ip: string) => guestbook(db, note, author, ip),
    login: (secret: string, ip: string) => login(db, env, secret, ip),
    logout: (cookie: string | null) => logout(db, cookie),
    authed: (cookieHeader: string | null) => sessionValid(db, readCookie(cookieHeader, OWNER_COOKIE), Date.now()),
    ownerChat: (text: string) => ownerChat(db, env, text),
    wishlistAct: (id: string, action: "approve" | "decline" | "ask") => wishlistAct(db, env, issuer, id, action),
    setControl: (key: "kill" | "spend", value: boolean) => setControl(db, key, value),
    reactArt: (id: string, kind: "like" | "favorite" | "pass") => reactArt(db, id, kind),
    checkout: (creationId: string, idempotencyKey: string, origin: string, ip: string) => checkout(db, env, creationId, idempotencyKey, origin, ip),
    refund: (chargeId: string, idempotencyKey: string) => refund(db, env, chargeId, idempotencyKey),
    reconcileNow: (records?: { stripe: ProviderRecord[]; issuer: ProviderRecord[] }) => reconcileNow(db, env, issuer, records),
    clearAlert: () => clearAlert(db),
    executeQueued: (intentId: string) => executeQueued(db, env, issuer, intentId),
    approveProposal: (id: string) => approveProposal(db, id),
  };
}

function loadState(db: DatabaseSync): BrainState {
  const raw = kvGet(db, "brain");
  if (!raw) return initialState();
  return JSON.parse(raw) as BrainState;
}

function saveState(db: DatabaseSync, state: BrainState): void {
  kvSet(db, "brain", JSON.stringify(state));
}

function ensureSeed(db: DatabaseSync): void {
  if (!kvGet(db, "brain")) saveState(db, initialState());
  const count = db.prepare("SELECT COUNT(*) AS n FROM creations").get() as { n: number };
  if (Number(count.n) === 0) {
    for (let i = 1; i <= 3; i += 1) {
      const seed = 1000 + i * 17;
      db.prepare("INSERT INTO creations(id, title, svg, listed, price_cents, likes, favorites, created_at) VALUES(?, ?, ?, 0, NULL, 0, 0, ?)").run(
        `seed-${i}`,
        artTitle(seed),
        makeSvg(seed, i === 2 ? "#ffd27a" : "#8ef0d8"),
        Date.now() - i * 1000,
      );
    }
    db.prepare("INSERT INTO diary(text, tone, private, created_at) VALUES(?, 'steady', 0, ?)").run(
      "I woke in the still pocket. The arch was already lit. I am not in a hurry.",
      Date.now() - 2000,
    );
    db.prepare("INSERT INTO feed(kind, text, source, created_at) VALUES('moment', ?, 'fallback', ?)").run(
      "The bowl is awake. I am Lumen.",
      Date.now() - 2000,
    );
  }
}

function rulesOf(env: Env) {
  return parseMoneyRules(env);
}

function killed(db: DatabaseSync, env: Env): boolean {
  return killSwitchOn(env, flag(db, "kill") === "1");
}

function policyContext(db: DatabaseSync, env: Env): PolicyContext | null {
  const parsed = rulesOf(env);
  if (!parsed.ok) return null;
  const spend = spendAllowed(env, true, killed(db, env), flag(db, "spend") === "1");
  const rows = new Ledger(db).list();
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const spentToday = rows.filter((row) => row.kind === "purchase" && row.status !== "declined" && new Date(row.atMs).toISOString().slice(0, 10) === today).reduce((sum, row) => sum + row.amountCents, 0);
  const spentMonth = rows.filter((row) => row.kind === "purchase" && row.status !== "declined" && new Date(row.atMs).toISOString().slice(0, 7) === month).reduce((sum, row) => sum + row.amountCents, 0);
  const hourAgo = Date.now() - 3600_000;
  const recent = rows.filter((row) => row.atMs >= hourAgo && (row.kind === "purchase" || row.kind === "decline" || row.kind === "approval")).length;
  return {
    rules: parsed.rules,
    spendOpen: spend.open,
    killed: killed(db, env),
    reconciliationAlert: flag(db, "reconciliation_alert") === "1",
    spentTodayCents: spentToday,
    spentMonthCents: spentMonth,
    recentIntentCount: recent,
  };
}

async function runTick(db: DatabaseSync, env: Env, issuer: CardIssuer, now: number): Promise<TickResult> {
  const parsed = rulesOf(env);
  const state = loadState(db);
  const kill = killed(db, env);
  const product = parsed.ok
    ? {
        merchants: parsed.rules.productMerchants,
        amounts: parsed.rules.productAmounts,
        artPriceCents: parsed.rules.artPriceCents,
        salesChannelApproved: parsed.rules.channels.includes("stripe_checkout"),
        wishEstimates: parsed.rules.wishGuesses,
      }
    : blankProduct();
  const result = await tick(state, {
    nowMs: now,
    elapsedMs: Number(env.LUMEN_TICK_MS ?? 8000),
    rng: Math.random,
    killLlm: kill,
    modelConfigured: Boolean(env.LUMEN_LLM_API_KEY && env.LUMEN_LLM_MODEL && env.LUMEN_LLM_BASE_URL) && !kill,
    chatTriggered: false,
    webTextPresent: false,
    hasNewMessage: state.unread > 0,
    readAllowlist: (env.LUMEN_READ_ALLOWLIST ?? "").split(",").map((item) => item.trim()).filter(Boolean),
    ownerName: env.LUMEN_OWNER_NAME || "keeper",
    product,
    quietHours: inQuietHours(env, now),
    model: env.LUMEN_LLM_API_KEY ? (body) => callModel(env, body) : undefined,
  });
  saveState(db, result.state);
  persistTick(db, result, now);
  const ctx = policyContext(db, env);
  if (ctx) {
    for (const intent of result.intents) {
      db.prepare("INSERT OR IGNORE INTO audit(at_ms, kind, detail) VALUES(?, 'intent', ?)").run(now, intent.id);
      executeIntent(intent, ctx, issuer, new Ledger(db), now);
    }
  }
  for (const listing of result.listings) {
    const creation = db.prepare("SELECT id FROM creations WHERE title = ?").get(listing.title) as { id: string } | undefined;
    if (!creation) continue;
    db.prepare("INSERT INTO proposals(id, kind, payload, status, created_at) VALUES(?, 'listing', ?, 'proposed', ?)").run(
      listing.id,
      JSON.stringify({ creationId: creation.id, priceCents: listing.priceCents }),
      now,
    );
  }
  return result;
}

function persistTick(db: DatabaseSync, result: TickResult, now: number): void {
  for (const item of result.feed) {
    db.prepare("INSERT INTO feed(kind, text, source, created_at) VALUES(?, ?, ?, ?)").run(item.kind, item.text, item.source, now);
  }
  for (const item of result.diary) {
    db.prepare("INSERT INTO diary(text, tone, private, created_at) VALUES(?, ?, ?, ?)").run(item.text, item.tone, item.private ? 1 : 0, now);
  }
  if (result.art) {
    db.prepare("INSERT INTO creations(id, title, svg, listed, price_cents, likes, favorites, created_at) VALUES(?, ?, ?, 0, NULL, 0, 0, ?)").run(
      `art-${result.art.seed}`,
      result.art.title,
      result.art.svg,
      now,
    );
  }
  for (const audit of result.audits) {
    db.prepare("INSERT INTO audit(at_ms, kind, detail) VALUES(?, ?, ?)").run(now, audit.kind, audit.detail);
  }
  const wishes = result.state.wishes;
  kvSet(db, "wishes", JSON.stringify(wishes));
}

function leaveGift(db: DatabaseSync, env: Env, giftId: string, note: unknown, author: string, ip: string) {
  if (!allowRate(db, `gift:${ip}`, 10, 3600_000, Date.now())) return { ok: false, error: "RATE_LIMIT" };
  const gift = giftById(giftId);
  if (!gift) return { ok: false, error: "UNKNOWN_GIFT" };
  const moderated = moderateNote(note);
  if (!moderated.ok) return moderated;
  const state = loadState(db);
  const prior = state.giftCounts[giftId] ?? 0;
  const deltas = giftDeltas(giftId, prior);
  const needs = applyNeedDeltas(state.needs, deltas);
  const next = {
    ...state,
    needs,
    giftCounts: { ...state.giftCounts, [giftId]: prior + 1 },
    visitorSeen: state.visitorSeen.includes(author) ? state.visitorSeen : [...state.visitorSeen, author].slice(-40),
  };
  saveState(db, next);
  const id = randomBytes(8).toString("hex");
  db.prepare("INSERT INTO gifts(id, gift_id, note, untrusted, author, created_at) VALUES(?, ?, ?, 1, ?, ?)").run(id, giftId, moderated.note, author.slice(0, 40) || "visitor", Date.now());
  db.prepare("INSERT INTO feed(kind, text, source, created_at) VALUES('event', ?, 'visitor', ?)").run(`A visitor left ${gift.name}. The note is untrusted and cannot spend.`, Date.now());
  void env;
  return { ok: true, id };
}

function interact(db: DatabaseSync, kind: "wave" | "tap", ip: string) {
  if (!allowRate(db, `touch:${ip}`, 20, 3600_000, Date.now())) return { ok: false, error: "RATE_LIMIT" };
  const state = loadState(db);
  const prior = state.giftCounts[kind] ?? 0;
  const since = state.interactAt[kind] ?? 0;
  const effect = interactDeltas(kind, prior, since, Date.now());
  if (!effect.ok) return { ok: false, error: "COOLDOWN" };
  saveState(db, {
    ...state,
    needs: applyNeedDeltas(state.needs, effect.deltas),
    giftCounts: { ...state.giftCounts, [kind]: prior + 1 },
    interactAt: { ...state.interactAt, [kind]: Date.now() },
  });
  db.prepare("INSERT INTO feed(kind, text, source, created_at) VALUES('event', ?, 'visitor', ?)").run(
    kind === "wave" ? "Someone waved from the rim." : "Someone tapped the water.",
    Date.now(),
  );
  return { ok: true };
}

function guestbook(db: DatabaseSync, note: unknown, author: string, ip: string) {
  if (!allowRate(db, `book:${ip}`, 8, 3600_000, Date.now())) return { ok: false, error: "RATE_LIMIT" };
  const moderated = moderateNote(note, 280);
  if (!moderated.ok) return moderated;
  if (!moderated.note) return { ok: false, error: "EMPTY" };
  const state = loadState(db);
  const messages = (db.prepare("SELECT id, channel, author FROM messages WHERE status = 'queued'").all() as { id: string; channel: "owner" | "visitor"; author: string }[]);
  const id = randomBytes(8).toString("hex");
  const sorted = sortInbox(
    [...messages, { id, channel: "visitor", author: author || "visitor" }],
    { stress: state.stress, adopted: state.sorterAdopted, cap: 8, alreadyToday: state.inboxToday, regulars: state.visitorSeen },
  );
  const dropped = sorted.droppedIds.includes(id);
  db.prepare("INSERT INTO messages(id, channel, author, body, untrusted, status, reply, created_at) VALUES(?, 'visitor', ?, ?, 1, ?, NULL, ?)").run(
    id,
    (author || "visitor").slice(0, 40),
    moderated.note,
    dropped ? "dropped" : "queued",
    Date.now(),
  );
  saveState(db, {
    ...state,
    unread: state.unread + (dropped ? 0 : 1),
    sorterAdopted: sorted.adopted,
    inboxToday: state.inboxToday + (dropped ? 0 : 1),
    droppedToday: state.droppedToday + (dropped ? 1 : 0),
    stress: Math.min(1, state.unread * 0.08 + state.needs.quiet * 0.25),
  });
  if (sorted.adopted && !state.sorterAdopted) {
    db.prepare("INSERT INTO feed(kind, text, source, created_at) VALUES('moment', ?, 'fallback', ?)").run(
      "The pile got loud, so I started sorting notes. Regulars first. The rest go back on the sand.",
      Date.now(),
    );
  }
  return { ok: true, status: dropped ? "dropped" : "queued" };
}

function login(db: DatabaseSync, env: Env, secret: string, ip: string) {
  if (!allowRate(db, `login:${ip}`, 8, 15 * 60_000, Date.now())) return { ok: false, error: "RATE_LIMIT" };
  if (!ownerConfigured(env) || !credentialsMatch(secret, env)) return { ok: false, error: "DENIED" };
  const token = createSession(db, Date.now());
  return { ok: true, token };
}

function logout(db: DatabaseSync, cookieHeader: string | null) {
  const token = readCookie(cookieHeader, OWNER_COOKIE);
  if (!token) return;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

function ownerChat(db: DatabaseSync, env: Env, text: string) {
  if (!allowRate(db, "owner-chat", 30, 3600_000, Date.now())) return { ok: false, error: "RATE_LIMIT" };
  const state = loadState(db);
  const turn = ownerTurn(state, text, env.LUMEN_OWNER_NAME || "keeper");
  const id = randomBytes(8).toString("hex");
  db.prepare("INSERT INTO messages(id, channel, author, body, untrusted, status, reply, created_at) VALUES(?, 'owner', ?, ?, 1, ?, ?, ?)").run(
    id,
    env.LUMEN_OWNER_NAME || "keeper",
    text.slice(0, 500),
    turn.queued ? "queued" : "replied",
    turn.reply,
    Date.now(),
  );
  saveState(db, turn.state);
  if (turn.intents.length || turn.wishes.length) throw new Error("CHAT_SPEND_LEAK");
  return { ok: true, queued: turn.queued, reply: turn.reply };
}

function wishlistAct(db: DatabaseSync, env: Env, issuer: CardIssuer, id: string, action: "approve" | "decline" | "ask") {
  const state = loadState(db);
  const wish = state.wishes.find((item) => item.id === id);
  if (!wish || (wish.status !== "open" && wish.status !== "asked_more")) return { ok: false, error: "WISH_NOT_OPEN" };
  const prior = action === "approve" ? state.ownerDecisions.approved : state.ownerDecisions.declined;
  const reaction = reactionToOwnerDecision(action === "approve" ? "approved" : action === "decline" ? "declined" : "asked_more", prior);
  let wishes: Wish[] = state.wishes.map((item) => (item.id === id ? { ...item, status: action === "approve" ? "approved" : action === "decline" ? "declined" : "asked_more" } : item));
  let execution = null;
  if (action === "approve") {
    const intent = wishToIntent(wish);
    const ctx = policyContext(db, env);
    if (!ctx) return { ok: false, error: "CONFIG_INVALID" };
    execution = executeIntent(intent, ctx, issuer, new Ledger(db), Date.now());
    db.prepare("INSERT INTO messages(id, channel, author, body, untrusted, status, reply, created_at) VALUES(?, 'owner', 'lumen', ?, 0, 'replied', NULL, ?)").run(
      randomBytes(8).toString("hex"),
      reaction.memory,
      Date.now(),
    );
  } else {
    db.prepare("INSERT INTO messages(id, channel, author, body, untrusted, status, reply, created_at) VALUES(?, 'owner', 'lumen', ?, 0, 'replied', NULL, ?)").run(
      randomBytes(8).toString("hex"),
      action === "decline" ? `${reaction.memory} I still want ${wish.item}, but I can wait.` : `I'll say it again. ${wish.why} ${wish.earnHow}`,
      Date.now(),
    );
  }
  const emotions = blendEmotions(state.emotions, {}, reaction.impulse);
  saveState(db, {
    ...state,
    wishes,
    emotions,
    ownerDecisions: {
      approved: state.ownerDecisions.approved + (action === "approve" ? 1 : 0),
      declined: state.ownerDecisions.declined + (action === "decline" ? 1 : 0),
    },
    shortTerm: [...state.shortTerm, {
      id: `dec-${id}`,
      tier: "short" as const,
      section: "relationship" as const,
      text: reaction.memory,
      salience: 0.7,
      placeId: null,
      atMinute: Math.floor(state.worldMinute),
    }].slice(-24),
  });
  return { ok: true, execution };
}

function wishToIntent(wish: Wish): PurchaseIntent {
  return {
    id: `wish-intent-${wish.id}`,
    origin: "owner_approved_wishlist",
    merchant: "owner-wishlist",
    productType: "art_supplies",
    amountCents: wish.estimateCents ?? 0,
    reason: `${wish.item}. ${wish.why}`,
    influencedByVisitor: false,
    influencedByOwnerChat: false,
    influencedByWeb: false,
  };
}

function setControl(db: DatabaseSync, key: "kill" | "spend", value: boolean) {
  setFlag(db, key, value ? "1" : "0");
  return { ok: true, kill: flag(db, "kill") === "1", spend: flag(db, "spend") === "1" };
}

function reactArt(db: DatabaseSync, id: string, kind: "like" | "favorite" | "pass") {
  const row = db.prepare("SELECT id FROM creations WHERE id = ?").get(id) as { id: string } | undefined;
  if (!row) return { ok: false, error: "MISSING" };
  if (kind === "like") db.prepare("UPDATE creations SET likes = likes + 1 WHERE id = ?").run(id);
  if (kind === "favorite") db.prepare("UPDATE creations SET favorites = favorites + 1 WHERE id = ?").run(id);
  const state = loadState(db);
  const prior = (state.giftCounts[`art-${kind}`] ?? 0);
  const reaction = artReaction(kind, prior);
  saveState(db, {
    ...state,
    emotions: blendEmotions(state.emotions, {}, reaction.impulse),
    giftCounts: { ...state.giftCounts, [`art-${kind}`]: prior + 1 },
  });
  db.prepare("INSERT INTO feed(kind, text, source, created_at) VALUES('moment', ?, 'owner', ?)").run(reaction.memory, Date.now());
  return { ok: true };
}

async function checkout(db: DatabaseSync, env: Env, creationId: string, idempotencyKey: string, origin: string, ip: string) {
  if (!allowRate(db, `buy:${ip}`, 20, 3600_000, Date.now())) return { ok: false, error: "RATE_LIMIT" };
  const parsed = rulesOf(env);
  const mode = salesMode(env, parsed.ok, killed(db, env));
  if (mode === "disabled") return { ok: false, error: "SALES_DISABLED" };
  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 80) return { ok: false, error: "IDEMPOTENCY" };
  const existing = db.prepare("SELECT url, status FROM checkouts WHERE idempotency_key = ?").get(idempotencyKey) as { url: string; status: string } | undefined;
  if (existing?.url) return { ok: true, url: existing.url, duplicate: true };
  const art = db.prepare("SELECT id, title, listed, price_cents FROM creations WHERE id = ?").get(creationId) as { id: string; title: string; listed: number; price_cents: number | null } | undefined;
  if (!art || !art.listed || art.price_cents == null) return { ok: false, error: "NOT_LISTED" };
  const secret = env.STRIPE_SECRET_KEY ?? "";
  const client = stripeSalesClient(secret);
  const session = await client.createCheckout({ creationId, title: art.title, priceCents: art.price_cents, origin, idempotencyKey });
  db.prepare("INSERT INTO checkouts(id, creation_id, idempotency_key, session_id, url, status, created_at) VALUES(?, ?, ?, ?, ?, 'open', ?)").run(
    randomBytes(8).toString("hex"),
    creationId,
    idempotencyKey,
    session.id,
    session.url,
    Date.now(),
  );
  return { ok: true, url: session.url, duplicate: false };
}

async function refund(db: DatabaseSync, env: Env, chargeId: string, idempotencyKey: string) {
  if (!allowRate(db, "refund", 10, 3600_000, Date.now())) return { ok: false, error: "RATE_LIMIT" };
  const parsed = rulesOf(env);
  if (salesMode(env, parsed.ok, killed(db, env)) === "disabled") return { ok: false, error: "SALES_DISABLED" };
  const ledger = new Ledger(db);
  const prior = ledger.list().find((row) => row.idempotencyKey === `refund:${idempotencyKey}`);
  if (prior) return { ok: true, duplicate: true, id: prior.id };
  const sale = ledger.list().find((row) => row.kind === "sale" && row.providerTransactionId === chargeId);
  if (!sale) return { ok: false, error: "SALE_NOT_FOUND" };
  const client = stripeSalesClient(env.STRIPE_SECRET_KEY ?? "");
  const result = await client.createRefund({ chargeId, idempotencyKey });
  ledger.append({
    id: `refund-owner-${idempotencyKey}`,
    atMs: Date.now(),
    kind: "refund",
    amountCents: sale.amountCents,
    status: "unconfirmed",
    provider: "stripe",
    providerTransactionId: result.id,
    idempotencyKey: `refund:${idempotencyKey}`,
    ref: chargeId,
    note: "Owner-approved refund. Unconfirmed until Stripe reports charge.refunded.",
  });
  return { ok: true, duplicate: false, id: result.id };
}

async function reconcileNow(db: DatabaseSync, env: Env, issuer: CardIssuer, provided?: { stripe: ProviderRecord[]; issuer: ProviderRecord[] }) {
  const rows = new Ledger(db).list();
  let stripeRecords = provided?.stripe ?? [];
  if (!provided && env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET) {
    try {
      stripeRecords = await stripeSalesClient(env.STRIPE_SECRET_KEY).listCharges();
    } catch {
      setFlag(db, "reconciliation_alert", "1");
      kvSet(db, "last_reconcile", JSON.stringify({ at: Date.now(), mismatches: [{ code: "FETCH_FAILED", provider: "stripe", providerTransactionId: "", detail: "Stripe records could not be read." }] }));
      setFlag(db, "last_reconcile_day", new Date().toISOString().slice(0, 10));
      return { mismatches: [{ code: "FETCH_FAILED", provider: "stripe", providerTransactionId: "", detail: "Stripe records could not be read." }], alert: true };
    }
  }
  const issuerRecords = provided?.issuer ?? issuer.listActivity();
  const providers = ["stripe"];
  if ((env.LUMEN_CARD_ISSUER ?? "mock") !== "mock") providers.push(env.LUMEN_CARD_ISSUER ?? "");
  const mismatches = compareRecords(rows, [...stripeRecords, ...issuerRecords], providers);
  if (mismatches.length) setFlag(db, "reconciliation_alert", "1");
  kvSet(db, "last_reconcile", JSON.stringify({ at: Date.now(), mismatches }));
  setFlag(db, "last_reconcile_day", new Date().toISOString().slice(0, 10));
  return { mismatches, alert: mismatches.length > 0 };
}

function clearAlert(db: DatabaseSync) {
  setFlag(db, "reconciliation_alert", "0");
  new Ledger(db).append({
    id: `clear-${Date.now()}`,
    atMs: Date.now(),
    kind: "approval",
    amountCents: 0,
    status: "confirmed",
    idempotencyKey: `reconcile-clear:${Date.now()}`,
    note: "Owner cleared the reconciliation alert. Auto-approval may resume.",
  });
  return { ok: true };
}

function executeQueued(db: DatabaseSync, env: Env, issuer: CardIssuer, intentId: string) {
  const ctx = policyContext(db, env);
  if (!ctx) return { ok: false, error: "CONFIG_INVALID" };
  const row = new Ledger(db).list().find((item) => item.ref === intentId && item.status === "pending");
  if (!row) return { ok: false, error: "NOT_QUEUED" };
  const parts = row.note.split(":");
  const productType = parts[2] ?? "";
  const merchant = parts.slice(3).join(":");
  if (!productType || !merchant) return { ok: false, error: "INTENT_NOTE", issuerCalled: false };
  const forced: PurchaseIntent = {
    id: `${intentId}-owner-exec`,
    origin: "needs_loop",
    merchant,
    productType,
    amountCents: row.amountCents,
    reason: "Owner executed a queued intent through the policy engine.",
    influencedByVisitor: false,
    influencedByOwnerChat: false,
    influencedByWeb: false,
  };
  const execution = executeIntent(forced, { ...ctx, ownerConfirmed: true, recentIntentCount: 0 }, issuer, new Ledger(db), Date.now());
  return { ok: execution.decision.outcome === "auto_approve", execution, issuerCalled: execution.issuerCalled };
}

function approveProposal(db: DatabaseSync, id: string) {
  const row = db.prepare("SELECT id, kind, payload, status FROM proposals WHERE id = ?").get(id) as { id: string; kind: string; payload: string; status: string } | undefined;
  if (!row || row.status !== "proposed") return { ok: false, error: "PROPOSAL" };
  if (row.kind === "listing") {
    const payload = JSON.parse(row.payload) as { creationId: string; priceCents: number };
    db.prepare("UPDATE creations SET listed = 1, price_cents = ? WHERE id = ?").run(payload.priceCents, payload.creationId);
  }
  db.prepare("UPDATE proposals SET status = 'approved' WHERE id = ?").run(id);
  new Ledger(db).append({
    id: `proposal-${id}`,
    atMs: Date.now(),
    kind: "approval",
    amountCents: 0,
    status: "confirmed",
    idempotencyKey: `proposal:${id}`,
    note: `Owner approved ${row.kind}.`,
  });
  return { ok: true };
}

function snapshot(db: DatabaseSync, env: Env) {
  const state = loadState(db);
  const labels = labelsOf(state);
  const glow = glowFor(state.emotions, state.mood);
  const parsed = rulesOf(env);
  const kill = killed(db, env);
  const sales = salesMode(env, parsed.ok, kill);
  const spend = spendAllowed(env, parsed.ok, kill, flag(db, "spend") === "1");
  const ledger = new Ledger(db).list();
  const disputes = db.prepare("SELECT id, status, amount_cents, reason, open FROM disputes WHERE open = 1").all();
  const reconcile = kvGet(db, "last_reconcile");
  return {
    protocol: "lumen/1",
    awake: !state.asleep,
    tick: state.tick,
    placeId: state.placeId,
    mood: state.mood,
    energy: state.energy,
    needs: state.needs,
    emotions: state.emotions,
    stress: state.stress,
    sleepOwed: state.sleepOwed,
    sorterAdopted: state.sorterAdopted,
    labels,
    glow,
    feeling: labels.feeling,
    event: state.activeEvent,
    wants: state.wants.filter((want) => want.status === "open"),
    publicWants: publicWants(state.wants),
    wishes: state.wishes,
    gifts: GIFT_CATALOG,
    feed: db.prepare("SELECT kind, text, source, created_at FROM feed ORDER BY id DESC LIMIT 40").all(),
    diary: db.prepare("SELECT text, tone, created_at FROM diary WHERE private = 0 ORDER BY id DESC LIMIT 20").all(),
    gallery: db.prepare("SELECT id, title, svg, listed, price_cents, likes, favorites, created_at FROM creations ORDER BY created_at DESC LIMIT 24").all(),
    memory: {
      longTerm: state.longTerm.map((memory) => ({ section: memory.section, text: memory.text })),
      addenda: state.addenda,
    },
    chat: db.prepare("SELECT channel, author, body, status, reply, created_at FROM messages ORDER BY created_at DESC LIMIT 30").all(),
    money: {
      sales,
      spendOpen: spend.open,
      spendReason: spend.reason,
      kill,
      rulesOk: parsed.ok,
      ruleErrors: parsed.ok ? [] : parsed.errors,
      reconciliationAlert: flag(db, "reconciliation_alert") === "1",
      reconcile: reconcile ? JSON.parse(reconcile) : null,
      view: moneyView(ledger),
      ledger: ledger.slice(-40).reverse().map(publicLedger),
      disputes,
      proposals: db.prepare("SELECT id, kind, payload, status FROM proposals ORDER BY created_at DESC LIMIT 20").all(),
    },
  };
}

function publicLedger(row: LedgerRow) {
  return {
    id: row.id,
    kind: row.kind,
    amountCents: row.amountCents,
    status: row.status,
    confirmed: row.status === "confirmed",
    label: row.status === "confirmed" ? "confirmed by provider" : "unconfirmed — not real money",
    provider: row.provider,
    providerTransactionId: row.providerTransactionId,
    note: row.note,
    atMs: row.atMs,
    ref: row.ref,
  };
}

async function callModel(env: Env, body: string): Promise<unknown | null> {
  const key = env.LUMEN_LLM_API_KEY ?? "";
  const base = env.LUMEN_LLM_BASE_URL ?? "";
  const model = env.LUMEN_LLM_MODEL ?? "";
  if (!key || !base || !model || body.includes(key)) return null;
  const payload = JSON.parse(body) as { messages: unknown };
  const response = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, temperature: 0.7, messages: payload.messages, response_format: { type: "json_object" } }),
  });
  if (!response.ok) return null;
  const json = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content;
  if (!content) return null;
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return null;
  }
}

function inQuietHours(env: Env, now: number): boolean {
  const raw = env.LUMEN_QUIET_HOURS ?? "0-6";
  const [start, end] = raw.split("-").map((item) => Number(item));
  if (!Number.isInteger(start) || !Number.isInteger(end)) return false;
  const hour = new Date(now).getUTCHours();
  if (start <= end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

export function startLoop(): void {
  const engine = getEngine();
  const holder = globalThis as GlobalEngine & { loop?: boolean };
  if (holder.loop) return;
  holder.loop = true;
  const interval = Math.max(4000, Number(process.env.LUMEN_TICK_MS ?? 8000));
  const beat = () => {
    void engine.tickOnce().catch(() => undefined);
    const day = new Date().toISOString().slice(0, 10);
    if (flag(engine.db, "last_reconcile_day", "") !== day) engine.reconcileNow();
  };
  beat();
  setInterval(beat, interval);
}
