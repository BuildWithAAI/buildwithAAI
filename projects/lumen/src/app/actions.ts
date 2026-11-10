"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientAddress, OWNER_COOKIE } from "../auth/owner";
import { publicModeOn } from "../auth/publicMode";
import { getEngine } from "../server/engine";

async function ip(): Promise<string> {
  const header = await headers();
  return clientAddress((name) => header.get(name), process.env.LUMEN_TRUSTED_PROXY, publicModeOn());
}

async function gate() {
  const jar = await cookies();
  const token = jar.get(OWNER_COOKIE)?.value ?? null;
  if (!getEngine().authed(`${OWNER_COOKIE}=${encodeURIComponent(token ?? "")}`)) redirect("/admin/login");
}

export async function sendGift(form: FormData) {
  const engine = getEngine();
  await engine.leaveGift(String(form.get("gift") ?? ""), form.get("note"), String(form.get("author") ?? "visitor"), await ip());
}

export async function sendTouch(form: FormData) {
  const kind = form.get("kind") === "tap" ? "tap" : "wave";
  await getEngine().interact(kind, await ip());
}

export async function sendNote(form: FormData) {
  await getEngine().guestbook(form.get("note"), String(form.get("author") ?? "visitor"), await ip());
}

export async function login(form: FormData) {
  const result = await getEngine().login(String(form.get("secret") ?? ""), await ip());
  if (!result.ok || !("token" in result) || !result.token) redirect("/admin/login?error=1");
  const jar = await cookies();
  jar.set(OWNER_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  redirect("/admin");
}

export async function logout() {
  const jar = await cookies();
  await getEngine().logout(jar.get(OWNER_COOKIE)?.value ? `${OWNER_COOKIE}=${jar.get(OWNER_COOKIE)?.value}` : null);
  jar.delete(OWNER_COOKIE);
  redirect("/admin/login");
}

export async function sendChat(form: FormData) {
  await gate();
  await getEngine().ownerChat(String(form.get("text") ?? ""));
}

export async function wishAction(form: FormData) {
  await gate();
  const action = String(form.get("action") ?? "");
  if (action !== "approve" && action !== "decline" && action !== "ask") return;
  await getEngine().wishlistAct(String(form.get("id") ?? ""), action);
}

export async function creativeAction(form: FormData) {
  await gate();
  const engine = getEngine();
  const op = String(form.get("op") ?? "");
  if (op === "on") engine.setCreative(true);
  if (op === "off") engine.setCreative(false);
  if (op === "hide") engine.hideBuild(String(form.get("id") ?? ""));
  if (op === "undo") engine.undoBuild(String(form.get("id") ?? ""));
}

export async function controlAction(form: FormData) {
  await gate();
  const key = form.get("key") === "spend" ? "spend" : "kill";
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
