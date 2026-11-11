"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientAddress, OWNER_COOKIE, ownerCookie } from "../auth/owner";
import { loginReachable, publicModeOn } from "../auth/publicMode";
import { chainTimeMs, fetchFinalized, quoteSolOrder, verifySolPayment } from "../money/solana";
import { listShop } from "../shop/store";
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
  const result = await getEngine().shopCheckout(String(form.get("id") ?? ""), String(form.get("note") ?? ""), await ip());
  if (!result.ok || result.comingSoon || !result.url || !result.url.startsWith("http")) redirect("/shop?sales=soon");
  redirect(result.url);
}

export async function solQuote(form: FormData) {
  const engine = getEngine();
  const id = String(form.get("id") ?? "");
  const listing = listShop(engine.db).find((item) => item.id === id);
  if (!listing) redirect("/shop?sales=sol");
  const quote = await quoteSolOrder(engine.db, engine.env, { kind: "shop", itemId: listing.id, title: listing.title, usdCents: listing.priceCents }, Date.now());
  if (!quote.ok) redirect("/shop?sales=sol");
  redirect(`/shop/sol?order=${quote.id}`);
}

export async function solVerify(form: FormData) {
  const engine = getEngine();
  const orderId = String(form.get("order") ?? "");
  const signature = String(form.get("signature") ?? "").trim();
  const rpc = engine.env.LUMEN_SOL_RPC_URL ?? "";
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
  const origin = (await headers()).get("origin") ?? "http://localhost:3000";
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
