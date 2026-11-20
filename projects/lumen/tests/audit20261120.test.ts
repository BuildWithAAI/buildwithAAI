import { describe, expect, it } from "vitest";
import { allowPage, PAGE_LIMIT_CAP, pageLimitSize, resetPageLimits } from "../src/auth/pageLimit";
import { mintSwitch, requestMint } from "../src/money/mint";
import { SIGNER_FRESH_MS, signerFresh, signerFreshness, signerHeaders } from "../src/money/signerAuth";

describe("audit 2026-11-20", () => {
  const base = { MINT_SIGNER_URL: "https://signer.example", LUMEN_MINT_SIGNER_SECRET: "mint-secret" };

  it("keeps minting closed until MINT_ENABLED is exactly true", () => {
    expect(mintSwitch(base)).toEqual({ open: false, reason: "MINT_OFF" });
    expect(mintSwitch({ ...base, MINT_ENABLED: "" }).open).toBe(false);
    expect(mintSwitch({ ...base, MINT_ENABLED: "TRUE" }).open).toBe(false);
    expect(mintSwitch({ ...base, MINT_ENABLED: "true" }).open).toBe(true);
  });

  it("closes minting on a mistyped network instead of falling through to mainnet", () => {
    expect(mintSwitch({ ...base, MINT_ENABLED: "true", LUMEN_MINT_NETWORK: "devnt" }).reason).toBe("CONFIG_INVALID");
    expect(mintSwitch({ ...base, MINT_ENABLED: "true", LUMEN_MINT_NETWORK: "devnet" }).open).toBe(true);
    expect(mintSwitch({ ...base, MINT_ENABLED: "true", LUMEN_MINT_NETWORK: "mainnet" }).open).toBe(true);
  });

  it("signs a different body for two identical mint requests", async () => {
    const seen: { body: string; signature: string }[] = [];
    const send = async (_url: unknown, init?: RequestInit) => {
      seen.push({ body: String(init?.body ?? ""), signature: new Headers(init?.headers).get("x-lumen-signature") ?? "" });
      return Response.json({ signature: "sig" });
    };
    const env = { ...base, MINT_ENABLED: "true" };
    await requestMint(env, { name: "Dock bell", uri: "https://zoora.ai/piece/1" }, send as typeof fetch);
    await requestMint(env, { name: "Dock bell", uri: "https://zoora.ai/piece/1" }, send as typeof fetch);
    expect(seen).toHaveLength(2);
    expect(seen[0]!.signature).not.toBe(seen[1]!.signature);
    expect(seen[0]!.signature).toBe(signerHeaders("mint-secret", seen[0]!.body)?.["x-lumen-signature"]);
  });

  it("lets the signer refuse a replayed or stale request", () => {
    const now = 1_800_000_000_000;
    const body = JSON.stringify({ instruction: "swap", ...signerFreshness(now) });
    const used = new Set<string>();
    const seen = (nonce: string) => {
      if (used.has(nonce)) return true;
      used.add(nonce);
      return false;
    };
    expect(signerFresh(body, now, seen)).toBe(true);
    expect(signerFresh(body, now, seen)).toBe(false);
    const late = JSON.stringify({ instruction: "swap", ...signerFreshness(now) });
    expect(signerFresh(late, now + SIGNER_FRESH_MS + 1, () => false)).toBe(false);
    expect(signerFresh(JSON.stringify({ instruction: "swap" }), now, () => false)).toBe(false);
    expect(signerFresh("not json", now, () => false)).toBe(false);
  });

  it("caps the page limiter so invented addresses cannot grow it without end", () => {
    resetPageLimits();
    const now = 1_800_000_000_000;
    for (let i = 0; i < PAGE_LIMIT_CAP + 500; i += 1) allowPage(`10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`, now);
    expect(pageLimitSize()).toBe(PAGE_LIMIT_CAP);
    resetPageLimits();
  });
});
