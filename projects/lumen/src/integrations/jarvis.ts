import { createHmac, timingSafeEqual } from "node:crypto";
import { ownerTurn, type ChatTurn } from "../brain/social";
import type { BrainState } from "../brain/types";

export type JarvisEvent = {
  type: "feed" | "mood" | "want" | "wishlist" | "alert" | "sale" | "print";
  text: string;
};

export type JarvisEnv = Record<string, string | undefined>;

export function signJarvis(body: string, secret: string, timestampSec: number): { timestamp: string; signature: string } {
  const timestamp = String(timestampSec);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return { timestamp, signature };
}

export function verifyJarvis(body: string, timestamp: string, signature: string, secret: string, nowMs: number, toleranceSec = 300): boolean {
  if (!body || !timestamp || !signature || !secret || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > toleranceSec) return false;
  const expected = signJarvis(body, secret, Number(timestamp)).signature;
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function jarvisConfigured(env: JarvisEnv): boolean {
  return Boolean(env.LUMEN_JARVIS_TOKEN && env.LUMEN_JARVIS_WEBHOOK_URL && env.LUMEN_JARVIS_WEBHOOK_SECRET);
}

export function jarvisTokenOk(token: string | null, env: JarvisEnv): boolean {
  const expected = env.LUMEN_JARVIS_TOKEN ?? "";
  if (!token || !expected || token.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

/** Same door as the keeper's chat. No intents, no approvals. */
export function jarvisChat(state: BrainState, text: string, ownerName: string): ChatTurn {
  return ownerTurn(state, text, ownerName);
}

export async function publishJarvis(env: JarvisEnv, event: JarvisEvent, fetchImpl: typeof fetch = fetch, nowMs = Date.now()): Promise<{ sent: boolean }> {
  const url = env.LUMEN_JARVIS_WEBHOOK_URL ?? "";
  const secret = env.LUMEN_JARVIS_WEBHOOK_SECRET ?? "";
  if (!url || !secret) return { sent: false };
  const body = JSON.stringify({ type: event.type, text: event.text, atMs: nowMs });
  const signed = signJarvis(body, secret, Math.floor(nowMs / 1000));
  await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-zoora-timestamp": signed.timestamp,
      "x-zoora-signature": signed.signature,
    },
    body,
  });
  return { sent: true };
}
