"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { clientAddress, OWNER_COOKIE, ownerCookie } from "../auth/owner";
import { loginReachable, publicModeOn } from "../auth/publicMode";
import { chainTimeMs, fetchFinalized, quoteSolOrder, verifySolPayment } from "../money/solana";
import { checkoutReturnOrigin } from "./api/checkout/auth";
import { allowRate, setFlag } from "../db/db";
import { addEntry, addVenue, decideMilestone, detectMilestones, recordReading } from "../economy/economy";
import { checkBrakes, clearBrake, setLadderMode } from "../economy/ladder";
import { decideVenture, getVenture, launchVenture, proposeVenture, setVentureStatus } from "../economy/ventures";
import { mergeVentures } from "../economy/merge";
import { compose, IDEA_KINDS, type IdeaKind } from "../forge/ideas";
import { buildRecipe, cleanRecipe } from "../forge/recipe";
import { herHand, raise, remove as removeBuild, reshape, undo as undoBuildStep, wander, wanderRoad } from "../forge/store";
import { rng } from "../form/genome";
import { grantPlot } from "../world/land";
import { quoteUnit } from "../world/unitPay";
import { takeUnit, vacate } from "../world/units";
import { blankPlan, getPlan, savePlan, setCheck, TEXT_FIELDS, type CostLine } from "../economy/plans";
import { confirmPodOrder, decideProduct, openPodOrder, printCheckout, printFacts, proposeProduct, refundPaidPrint, syncPodOrder } from "../fulfillment/pod";
import { listShop, shopCheckoutOpen } from "../shop/store";
import { getEngine } from "../server/engine";

async function ip(): Promise<string> {
  const header = await headers();
  return clientAddress((name) => header.get(name), process.env.LUMEN_TRUSTED_PROXY, publicModeOn());
}

async function gate() {
  const header = await headers();
  if (!loginReachable(header.get("fly-client-ip"), process.env, header.get("x-lumen-desk"))) redirect("/");
  const jar = await cookies();
  const token = jar.get(OWNER_COOKIE)?.value ?? null;
  if (!getEngine().authed(`${OWNER_COOKIE}=${encodeURIComponent(token ?? "")}`)) redirect("/admin/login");
}

function guestError(result: { ok: boolean; error?: string; reason?: string }): string | null {
  if (result.ok) return null;
  return result.error ?? result.reason ?? "NOTE";
}

export async function sendGift(form: FormData) {
  const result = await getEngine().leaveGift(String(form.get("gift") ?? ""), form.get("note"), String(form.get("author") ?? "visitor"), await ip());
  const error = guestError(result);
  redirect(error ? `/guestbook?error=${encodeURIComponent(error)}` : "/guestbook?sent=gift");
}

export async function sendTouch(form: FormData) {
  const kind = form.get("kind") === "tap" ? "tap" : "wave";
  const result = await getEngine().interact(kind, await ip());
  const error = guestError(result);
  redirect(error ? `/guestbook?error=${encodeURIComponent(error)}` : `/guestbook?sent=${kind}`);
}

export async function sendNote(form: FormData) {
  const result = await getEngine().guestbook(form.get("note"), String(form.get("author") ?? "visitor"), await ip());
  const error = guestError(result);
  redirect(error ? `/guestbook?error=${encodeURIComponent(error)}` : "/guestbook?sent=note");
}

export async function login(form: FormData) {
  const header = await headers();
  const reachable = loginReachable(header.get("fly-client-ip"), process.env, header.get("x-lumen-desk"));
  if (!reachable) redirect("/");
  const result = await getEngine().login(String(form.get("secret") ?? ""), await ip());
  if (!result.ok || !("token" in result) || !result.token) redirect("/admin/login?error=1");
  const jar = await cookies();
  const proto = header.get("x-forwarded-proto");
  const deskHttp = publicModeOn() && loginReachable(header.get("fly-client-ip"), process.env, header.get("x-lumen-desk")) && (proto ?? "").split(",")[0]?.trim().toLowerCase() !== "https";
  jar.set(OWNER_COOKIE, result.token, ownerCookie({ forwardedProto: proto, deskHttp }));
  redirect("/admin");
}

export async function logout() {
  await gate();
  const jar = await cookies();
  await getEngine().logout(jar.get(OWNER_COOKIE)?.value ? `${OWNER_COOKIE}=${jar.get(OWNER_COOKIE)?.value}` : null);
  jar.delete(OWNER_COOKIE);
  redirect("/admin/login");
}

export async function sendChat(form: FormData) {
  await gate();
  await getEngine().ownerChat(String(form.get("text") ?? ""));
}

export async function keeperListAction(form: FormData) {
  const header = await headers();
  if (!loginReachable(header.get("fly-client-ip"), process.env, header.get("x-lumen-desk"))) redirect("/");
  await gate();
  const op = form.get("op") === "bought" ? "bought" : form.get("op") === "declined" ? "declined" : null;
  if (!op) return;
  await getEngine().keeperListAct(String(form.get("id") ?? ""), op);
}

export async function wishAction(form: FormData) {
  await gate();
  const action = String(form.get("action") ?? "");
  if (action !== "approve" && action !== "decline" && action !== "ask") return;
  await getEngine().wishlistAct(String(form.get("id") ?? ""), action);
}

export async function shopBuy(form: FormData) {
  const engine = getEngine();
  const address = await ip();
  // Each open checkout asks Stripe for a session and stores an order row. Both are bounded per address and overall.
  const buyAt = Date.now();
  if (!allowRate(engine.db, `shop-buy:${address}`, 6, 60_000, buyAt) || !allowRate(engine.db, "shop-buy:all", 60, 60_000, buyAt)) redirect("/shop?sales=soon");
  const result = await engine.shopCheckout(String(form.get("id") ?? ""), String(form.get("note") ?? ""), address);
  if (!result.ok || result.comingSoon || !result.url || !result.url.startsWith("http")) redirect("/shop?sales=soon");
  redirect(result.url);
}

/** A visitor buys a print. Stripe takes the card and the address. Nothing is ordered from the printer until Stripe reports it paid. */
export async function printBuy(form: FormData) {
  const engine = getEngine();
  const address = await ip();
  const buyAt = Date.now();
  if (!allowRate(engine.db, `print-buy:${address}`, 6, 60_000, buyAt) || !allowRate(engine.db, "print-buy:all", 60, 60_000, buyAt)) redirect("/merch?sales=soon");
  const result = await printCheckout(engine.db, engine.env, String(form.get("id") ?? ""), shopCheckoutOpen(engine.db, engine.env), buyAt);
  if (!result.ok || !result.url.startsWith("https://")) redirect("/merch?sales=soon");
  redirect(result.url);
}

export async function solQuote(form: FormData) {
  const engine = getEngine();
  const id = String(form.get("id") ?? "");
  const listing = listShop(engine.db).find((item) => item.id === id);
  if (!listing) redirect("/shop?sales=sol");
  // Each quote reads a price over the network and stores a row. Both are bounded per address and overall.
  const quoteAt = Date.now();
  if (!allowRate(engine.db, `sol-quote:${await ip()}`, 6, 60_000, quoteAt) || !allowRate(engine.db, "sol-quote:all", 60, 60_000, quoteAt)) redirect("/shop?sales=sol");
  const quote = await quoteSolOrder(engine.db, engine.env, { kind: "shop", itemId: listing.id, title: listing.title, usdCents: listing.priceCents }, Date.now());
  if (!quote.ok) redirect("/shop?sales=sol");
  redirect(`/shop/sol?order=${quote.id}`);
}

/** A visitor asks to buy a home or a shop. They are sent to the same page a shop order is paid on, with a quote for Zoora's price. */
export async function unitQuote(form: FormData) {
  const engine = getEngine();
  const at = Date.now();
  // Each quote reads a price over the network and holds the unit for up to ten minutes. Both are bounded per address and overall.
  if (!allowRate(engine.db, `unit-quote:${await ip()}`, 4, 60_000, at) || !allowRate(engine.db, "unit-quote:all", 60, 60_000, at)) redirect("/city?sales=RATE_LIMIT");
  const quote = await quoteUnit(engine.db, engine.env, String(form.get("unit") ?? "").slice(0, 60), at);
  if (!quote.ok) redirect(`/city?sales=${encodeURIComponent(quote.reason)}`);
  redirect(`/shop/sol?order=${quote.order}`);
}

export async function solVerify(form: FormData) {
  const engine = getEngine();
  const orderId = String(form.get("order") ?? "");
  const signature = String(form.get("signature") ?? "").trim();
  const rpc = engine.env.LUMEN_SOL_RPC_URL ?? "";
  // Each check spends one RPC call on a signature the caller chose. Both are bounded per address and overall.
  const verifyAt = Date.now();
  if (!allowRate(engine.db, `sol-verify:${await ip()}`, 10, 60_000, verifyAt) || !allowRate(engine.db, "sol-verify:all", 120, 60_000, verifyAt)) redirect(`/shop/sol?order=${encodeURIComponent(orderId)}&error=RATE_LIMIT`);
  const tx = rpc ? await fetchFinalized(rpc, signature) : null;
  const result = verifySolPayment(engine.db, orderId, signature, tx, Date.now(), { txTime: chainTimeMs(tx) }, engine.env);
  if (!result.ok) redirect(`/shop/sol?order=${orderId}&error=${result.reason}`);
  redirect(`/shop/sol?order=${orderId}&paid=1`);
}

export async function goalDesk(form: FormData) {
  await gate();
  const op = String(form.get("op") ?? "");
  if (op !== "approve" && op !== "revert" && op !== "edit") return;
  await getEngine().goalAct(op, String(form.get("id") ?? ""), String(form.get("text") ?? ""));
}

export async function shopDesk(form: FormData) {
  await gate();
  const op = String(form.get("op") ?? "");
  const allowed = op === "publish" || op === "hide" || op === "retire" || op === "kill" || op === "sales" || op === "approve";
  if (!allowed) return;
  await getEngine().shopAct(op, String(form.get("id") ?? ""), form.get("on") === "1");
}

export async function visitorDesk(form: FormData) {
  await gate();
  if (String(form.get("op") ?? "") !== "revoke") return;
  await getEngine().revokeVisitor(String(form.get("id") ?? ""));
}

export async function creativeAction(form: FormData) {
  await gate();
  const engine = getEngine();
  const op = String(form.get("op") ?? "");
  if (op === "on") engine.setCreative(true);
  if (op === "off") engine.setCreative(false);
  if (op === "freeze-territory") engine.freezeTerritory(true);
  if (op === "thaw-territory") engine.freezeTerritory(false);
  let result: { ok: boolean; reason?: string } | undefined;
  if (op === "hide") result = engine.hideBuild(String(form.get("id") ?? ""));
  if (op === "undo") result = engine.undoBuild(String(form.get("id") ?? ""));
  if (op === "veto-territory") {
    const raw = String(form.get("radius") ?? "").trim();
    if (raw === "") result = engine.vetoTerritory();
    else if (/^-?\d+$/.test(raw)) result = engine.vetoTerritory(Number(raw));
    else result = { ok: false, reason: "RADIUS" };
  }
  if (op === "make-public" || op === "unprivate") {
    const cx = Number(form.get("cx"));
    const cy = Number(form.get("cy"));
    if (Number.isInteger(cx) && Number.isInteger(cy)) result = engine.unprivateChunk(cx, cy);
    else result = { ok: false, reason: "CHUNK" };
  }
  if (op === "reverify-chain") result = engine.reverifyChain();
  if (result && result.ok === false) redirect(`/admin?error=${encodeURIComponent(result.reason ?? "REFUSED")}`);
  redirect(`/admin?done=${encodeURIComponent(op)}`);
}

export async function sceneDesk(form: FormData) {
  await gate();
  const op = String(form.get("op") ?? "");
  if (op === "rollback") await getEngine().rollbackScene();
  if (op === "freeze") await getEngine().freezeScene(true);
  if (op === "unfreeze") await getEngine().freezeScene(false);
}

export async function controlAction(form: FormData) {
  await gate();
  const raw = String(form.get("key") ?? "");
  const key = raw === "spend" || raw === "trading_kill" || raw === "trading_clear" ? raw : "kill";
  await getEngine().setControl(key, form.get("value") === "1");
}

export async function artAction(form: FormData) {
  await gate();
  const kind = String(form.get("kind") ?? "like");
  if (kind !== "like" && kind !== "favorite" && kind !== "pass") return;
  await getEngine().reactArt(String(form.get("id") ?? ""), kind);
}

export async function buyArt(form: FormData) {
  const origin = checkoutReturnOrigin((await headers()).get("origin"));
  const result = await getEngine().checkout(String(form.get("id") ?? ""), String(form.get("key") ?? ""), origin, await ip());
  if (result.ok && "url" in result && result.url) redirect(result.url);
  redirect("/gallery?sales=closed");
}

export async function refundAction(form: FormData) {
  await gate();
  await getEngine().refund(String(form.get("charge") ?? ""), String(form.get("key") ?? ""));
}

export async function reconcileAction() {
  await gate();
  await getEngine().reconcileNow();
}

export async function clearAlertAction() {
  await gate();
  await getEngine().clearAlert();
}

export async function proposalAction(form: FormData) {
  await gate();
  await getEngine().approveProposal(String(form.get("id") ?? ""));
}

export async function issueWorldTokenAction(_prev: { name?: string; token?: string; error?: string } | null, form: FormData) {
  await gate();
  const issued = await getEngine().issueWorldToken(String(form.get("name") ?? ""));
  if (!issued.ok) return { error: issued.error };
  return { name: issued.name, token: issued.token };
}

export async function resolveUnknownAction(form: FormData) {
  await gate();
  if (form.get("confirm") !== "1") return;
  const verdict = form.get("verdict") === "charged" ? "charged" : "not_charged";
  await getEngine().resolveUnknownClaim(String(form.get("intentId") ?? ""), verdict, {
    confirm: true,
    providerTransactionId: String(form.get("providerTransactionId") ?? ""),
    unknownId: form.get("unknownId") === "1",
    provider: String(form.get("provider") ?? "") || undefined,
  });
}

export async function executeAction(form: FormData) {
  await gate();
  await getEngine().executeQueued(String(form.get("id") ?? ""));
}

/** Dollars typed by the owner, as whole cents. Anything that is not a plain amount is refused. */
function dollarsToCents(raw: FormDataEntryValue | null): number {
  const text = String(raw ?? "").trim();
  if (!/^[0-9]{1,10}(\.[0-9]{1,2})?$/.test(text)) throw new Error("ECON_AMOUNT");
  const [whole, part = ""] = text.split(".");
  return Number(whole) * 100 + Number(part.padEnd(2, "0"));
}

async function economyStep(run: (now: number) => void): Promise<void> {
  await gate();
  let failed: string | null = null;
  try {
    const now = Date.now();
    run(now);
    detectMilestones(getEngine().db, now);
    checkBrakes(getEngine().db, now);
  } catch (error) {
    failed = error instanceof Error && /^ECON_[A-Z_]+$/.test(error.message) ? error.message : "ECON_FAILED";
  }
  revalidatePath("/admin/economy");
  revalidatePath("/floor");
  if (failed) redirect(`/admin/economy?error=${failed}`);
}

export async function economyVenueAction(form: FormData) {
  await economyStep((now) => addVenue(getEngine().db, { id: String(form.get("id") ?? ""), bookId: String(form.get("bookId") ?? ""), name: String(form.get("name") ?? ""), kind: String(form.get("kind") ?? "") }, now));
}

/** A balance the owner read and typed in. Code that reads a venue itself records its own, marked "reader". */
export async function economyReadingAction(form: FormData) {
  await economyStep((now) => recordReading(getEngine().db, { venueId: String(form.get("venueId") ?? ""), valueCents: dollarsToCents(form.get("dollars")), source: "owner", note: String(form.get("note") ?? "") }, now));
}

export async function economyEntryAction(form: FormData) {
  await economyStep((now) =>
    addEntry(
      getEngine().db,
      {
        bookId: String(form.get("bookId") ?? ""),
        kind: String(form.get("kind") ?? ""),
        cents: dollarsToCents(form.get("dollars")),
        category: String(form.get("category") ?? ""),
        memo: String(form.get("memo") ?? ""),
        paidFrom: String(form.get("paidFrom") ?? "treasury"),
        bucket: String(form.get("bucket") ?? "operations"),
        idem: `desk:${now}:${randomBytes(6).toString("hex")}`,
      },
      now,
    ),
  );
}

export async function economyMilestoneAction(form: FormData) {
  await economyStep((now) => {
    const decision = form.get("decision") === "approved" ? "approved" : "declined";
    decideMilestone(getEngine().db, Number(form.get("threshold")), decision, now, String(form.get("unlock") ?? ""));
  });
}

/** The owner releases a brake after looking at why it tripped. */
export async function economyBrakeAction(form: FormData) {
  await economyStep((now) => {
    const scope = String(form.get("scope") ?? "");
    if (!/^(venue:[a-z0-9-]{2,40}|book:company)$/.test(scope)) throw new Error("ECON_SCOPE");
    clearBrake(getEngine().db, scope, now);
  });
}

/** Open: she may act from day one inside her working balance. Earned: each step waits for an approved milestone. */
export async function economyModeAction(form: FormData) {
  await economyStep(() => setLadderMode(getEngine().db, form.get("mode") === "earned" ? "earned" : "open"));
}

/** Desk steps for ventures and print orders. Owner only. Some of them wait on the printer, so this one is async. */
async function ventureStep(run: (now: number) => void | Promise<void>): Promise<void> {
  await gate();
  let failed: string | null = null;
  try {
    await run(Date.now());
  } catch (error) {
    failed = error instanceof Error && /^(ECON|POD|PRINTFUL)_[A-Z_]+$/.test(error.message) ? error.message : "ECON_FAILED";
  }
  revalidatePath("/admin/ventures");
  if (failed) redirect(`/admin/ventures?error=${failed}`);
}

function text(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

export async function ventureProposeAction(form: FormData) {
  await ventureStep((now) => {
    proposeVenture(getEngine().db, { id: text(form, "id"), name: text(form, "name"), kind: text(form, "kind"), pitch: text(form, "pitch"), by: "owner" }, now);
  });
}

export async function ventureDecideAction(form: FormData) {
  await ventureStep((now) => {
    const approved = form.get("decision") === "approved";
    decideVenture(getEngine().db, text(form, "id"), approved ? "approved" : "declined", { budgetCents: approved ? dollarsToCents(form.get("budget")) : 0, days: approved ? Number(text(form, "days")) : 0 }, now);
  });
}

export async function ventureStatusAction(form: FormData) {
  await ventureStep((now) => {
    const to = text(form, "to");
    if (to !== "active" && to !== "paused" && to !== "closed") throw new Error("ECON_VENTURE_STATE");
    const days = text(form, "days");
    setVentureStatus(getEngine().db, text(form, "id"), to, now, days ? { days: Number(days) } : undefined);
  });
}

export async function podProductAction(form: FormData) {
  await ventureStep((now) => {
    proposeProduct(getEngine().db, process.env, { id: text(form, "id"), ventureId: text(form, "ventureId"), title: text(form, "title"), variantId: Number(text(form, "variantId")), placement: text(form, "placement"), technique: text(form, "technique"), artUrl: text(form, "artUrl"), retailCents: dollarsToCents(form.get("retail")) }, now);
  });
}

/** Approving needs the box ticked: the owner has looked at the art and it is Zoora's own. */
export async function podProductDecideAction(form: FormData) {
  await ventureStep((now) => {
    const decision = text(form, "decision");
    if (decision !== "approved" && decision !== "declined" && decision !== "retired") throw new Error("POD_DECISION");
    decideProduct(getEngine().db, text(form, "id"), decision, form.get("ownArt") === "yes", now);
  });
}

/** A sample sent to an address the owner types. The address goes to the printer and is not stored here. */
export async function podSampleAction(form: FormData) {
  await ventureStep(async (now) => {
    const id = `smp-${now.toString(36)}-${randomBytes(3).toString("hex")}`;
    const order = await openPodOrder(
      getEngine().db,
      process.env,
      { id, productId: text(form, "productId"), quantity: 1, paidRef: null, recipient: { name: text(form, "name"), address1: text(form, "address1"), address2: text(form, "address2") || undefined, city: text(form, "city"), stateCode: text(form, "stateCode") || undefined, countryCode: text(form, "countryCode").toUpperCase(), zip: text(form, "zip") } },
      now,
    );
    if (order.status === "failed") throw new Error(/^PRINTFUL_[A-Z_]+$/.test(order.reason) ? order.reason : "POD_FAILED");
  });
}

export async function podSyncAction(form: FormData) {
  await ventureStep(async (now) => {
    await syncPodOrder(getEngine().db, process.env, text(form, "id"), now);
  });
}

/** The owner's click that prints and charges. */
export async function podConfirmAction(form: FormData) {
  await ventureStep(async (now) => {
    const result = await confirmPodOrder(getEngine().db, process.env, text(form, "id"), "owner", now);
    if (!result.ok) throw new Error(result.reason);
  });
}

/** Whether paid orders may be confirmed without the owner. Samples never are. */
export async function podAutoAction(form: FormData) {
  await ventureStep(() => {
    setFlag(getEngine().db, "pod_auto_confirm", form.get("auto") === "on" ? "1" : "0");
  });
}

/** The owner sends a customer's money back for a paid print that will not be made. */
export async function podRefundAction(form: FormData) {
  await ventureStep(async (now) => {
    await refundPaidPrint(getEngine().db, process.env, text(form, "id"), now);
  });
}

function optionalCents(raw: FormDataEntryValue | null): number | null {
  return String(raw ?? "").trim() === "" ? null : dollarsToCents(raw);
}

/** One cost per line, written "label, dollars". */
function costLines(raw: FormDataEntryValue | null): CostLine[] {
  return String(raw ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const cut = line.lastIndexOf(",");
      if (cut < 1) throw new Error("ECON_PLAN_LINES");
      return { label: line.slice(0, cut).trim(), cents: dollarsToCents(line.slice(cut + 1).trim().replace(/^\$/, "")) };
    });
}

/** The owner edits a venture's plan. A cost the owner types is the owner's word, unless marked as a guess. */
export async function venturePlanAction(form: FormData) {
  const id = text(form, "id");
  await ventureStep((now) => {
    const db = getEngine().db;
    if (!getVenture(db, id)) throw new Error("ECON_VENTURE_UNKNOWN");
    const current = getPlan(db, id) ?? blankPlan();
    const next = { ...current };
    for (const field of TEXT_FIELDS) next[field] = text(form, field);
    next.priceCents = optionalCents(form.get("price"));
    const cost = optionalCents(form.get("unitCost"));
    // A quoted cost stays quoted unless the owner changes the figure.
    const kept = cost != null && cost === current.unitCostCents && current.unitCostSource === "quoted";
    next.unitCostCents = cost;
    next.unitCostSource = cost == null ? null : kept ? "quoted" : form.get("costIsGuess") === "yes" ? "estimate" : "owner";
    next.shippingChargeCents = optionalCents(form.get("shippingCharge")) ?? 0;
    next.feeBasisPoints = Math.round(Number(text(form, "feePercent") || "2.9") * 100);
    next.feeFixedCents = optionalCents(form.get("feeFixed")) ?? 0;
    next.startup = costLines(form.get("startup"));
    next.monthly = costLines(form.get("monthly"));
    const target = text(form, "targetUnits");
    next.targetUnits = target ? Number(target) : null;
    next.budgetAskCents = optionalCents(form.get("budgetAsk")) ?? 0;
    next.daysAsk = Number(text(form, "daysAsk") || "30");
    savePlan(db, id, next, "owner", now);
  });
  revalidatePath(`/admin/ventures/${id}`);
  redirect(`/admin/ventures/${id}`);
}

export async function ventureCheckAction(form: FormData) {
  const id = text(form, "id");
  await ventureStep((now) => setCheck(getEngine().db, id, text(form, "key"), form.get("done") === "yes", now));
  redirect(`/admin/ventures/${id}`);
}

/** Day one. Refused unless the plan's dollars are settled and every item on the list is done. */
export async function ventureLaunchAction(form: FormData) {
  await ventureStep((now) => {
    const engine = getEngine();
    const id = text(form, "id");
    launchVenture(engine.db, id, printFacts(engine.db, engine.env, shopCheckoutOpen(engine.db, engine.env), id), now);
  });
}

/** One venture is absorbed into another. It cannot be undone, so the owner types the word. */
export async function ventureMergeAction(form: FormData) {
  await ventureStep((now) => {
    if (text(form, "sure") !== "merge") throw new Error("ECON_MERGE_CONFIRM");
    mergeVentures(getEngine().db, text(form, "fromId"), text(form, "intoId"), now);
  });
}

/** Desk steps for the forge. Owner only. */
async function forgeStep(run: (now: number) => void): Promise<void> {
  await gate();
  let failed: string | null = null;
  try {
    run(Date.now());
  } catch (error) {
    failed = error instanceof Error && /^FORGE_[A-Z_]+$/.test(error.message) ? error.message : "FORGE_FAILED";
  }
  revalidatePath("/admin/forge");
  revalidatePath("/forge");
  if (failed) redirect(`/admin/forge?error=${failed}`);
}

export async function forgeIdeaAction(form: FormData) {
  await forgeStep((now) => {
    const kind = text(form, "kind") as IdeaKind;
    if (!(IDEA_KINDS as readonly string[]).includes(kind)) throw new Error("FORGE_TOOL");
    const db = getEngine().db;
    const typed = text(form, "x") !== "" && text(form, "z") !== "";
    // A road with no place typed goes where she would put one herself: joined to her other roads.
    if (kind === "road" && !typed) {
      const found = wanderRoad(db, rng(now >>> 0));
      if (!found) throw new Error("FORGE_ROAD_ALONE");
      raise(db, found.recipe, found.place, now, "owner", kind);
      return;
    }
    const recipe = cleanRecipe(compose(kind, now >>> 0));
    const built = buildRecipe(recipe, herHand());
    // With no place typed she finds one herself, the same way she does on her own.
    const place = typed ? { x: Number(text(form, "x")), z: Number(text(form, "z")), turn: Number(text(form, "turn") || "0") } : wander(db, recipe.layer ?? "structure", built.half, built.height, rng(now >>> 0));
    if (!place) throw new Error("FORGE_NO_GROUND");
    raise(db, recipe, place, now, "owner", kind);
  });
}

/** A recipe pasted by the owner. It goes through the same checks as one she writes herself. */
export async function forgeRecipeAction(form: FormData) {
  await forgeStep((now) => {
    let recipe: { place?: unknown };
    try {
      recipe = JSON.parse(String(form.get("recipe") ?? "")) as { place?: unknown };
    } catch {
      throw new Error("FORGE_RECIPE");
    }
    const id = text(form, "id");
    if (id) reshape(getEngine().db, id, recipe, now);
    else raise(getEngine().db, recipe, recipe?.place, now, "owner");
  });
}

export async function forgeUndoAction(form: FormData) {
  await forgeStep((now) => {
    undoBuildStep(getEngine().db, text(form, "id"), now);
  });
}

export async function forgeRemoveAction(form: FormData) {
  await forgeStep((now) => {
    removeBuild(getEngine().db, text(form, "id"), now);
  });
}

export async function forgeModelAction(form: FormData) {
  await forgeStep(() => setFlag(getEngine().db, "forge_model", form.get("on") === "0" ? "0" : "1"));
}

/** The owner records a plot for another holder by hand. The same rule applies as for any sale: never her land, her buffer or her lanes. */
export async function landGrantAction(form: FormData) {
  await forgeStep((now) => {
    const result = grantPlot(getEngine().db, Number(text(form, "cx")), Number(text(form, "cy")), text(form, "holder"), now);
    if (!result.ok) throw new Error(`FORGE_LAND_${result.reason}`);
  });
}

/** The owner records that an agent has taken a unit, or that a rented one was given back. No payment is taken and no income is written. The terms are Zoora's. */
export async function unitTakeAction(form: FormData) {
  await forgeStep((now) => {
    const how = text(form, "how");
    if (how === "vacate") {
      if (!vacate(getEngine().db, text(form, "unit"))) throw new Error("FORGE_UNIT_NOT_LET");
      return;
    }
    const result = takeUnit(getEngine().db, text(form, "unit"), text(form, "holder"), how === "sold" ? "sold" : "let", now);
    if (!result.ok) throw new Error(`FORGE_UNIT_${result.reason}`);
  });
}
