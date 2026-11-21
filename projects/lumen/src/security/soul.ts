import { createHash } from "node:crypto";
import { readIdentityFile } from "../identity/load";

/**
 * Her soul file is written by the owner. If the owner pins its hash in LUMEN_SOUL_SHA256, the engine checks
 * the file against it and does not run on a file that differs. With no pin set there is nothing to compare
 * against, and the check passes.
 */
export function soulHash(read: () => string = () => readIdentityFile("SOUL.md")): string {
  return createHash("sha256").update(read().replace(/\r\n/g, "\n")).digest("hex");
}

export type SoulCheck = { ok: true; pinned: boolean } | { ok: false; reason: "SOUL_CHANGED" | "SOUL_UNREADABLE" | "SOUL_PIN_INVALID" };

export function soulIntact(env: Record<string, string | undefined>, read?: () => string): SoulCheck {
  const pin = (env.LUMEN_SOUL_SHA256 ?? "").trim().toLowerCase();
  if (!pin) return { ok: true, pinned: false };
  if (!/^[0-9a-f]{64}$/.test(pin)) return { ok: false, reason: "SOUL_PIN_INVALID" };
  let actual: string;
  try {
    actual = soulHash(read);
  } catch {
    return { ok: false, reason: "SOUL_UNREADABLE" };
  }
  return actual === pin ? { ok: true, pinned: true } : { ok: false, reason: "SOUL_CHANGED" };
}
