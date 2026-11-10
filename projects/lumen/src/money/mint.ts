import type { Env } from "./rules";

/**
 * Minting talks to a signer the owner runs. This process never reads a private key.
 * Mainnet is the only network. There is no devnet stage.
 */
export function mintSwitch(env: Env, killed = false): { open: boolean; reason: string } {
  if (killed || env.MINT_KILL === "true") return { open: false, reason: "MINT_KILL" };
  if (env.MINT_PRIVATE_KEY || env.SOLANA_PRIVATE_KEY || env.MINT_KEYPAIR) return { open: false, reason: "KEY_MUST_STAY_IN_SIGNER" };
  if (env.MINT_ENABLED === "false") return { open: false, reason: "MINT_OFF" };
  if (env.MINT_ENABLED !== undefined && env.MINT_ENABLED !== "" && env.MINT_ENABLED !== "true") return { open: false, reason: "CONFIG_INVALID" };
  const url = env.MINT_SIGNER_URL ?? "";
  if (!url.startsWith("https://")) return { open: false, reason: "MINT_SIGNER_MISSING" };
  return { open: true, reason: "OPEN" };
}

export type MintRequest = { name: string; uri: string };

/** Ask the signer to mint one piece. The body is an allowlisted instruction and carries no key. */
export async function requestMint(env: Env, input: MintRequest, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; signature: string } | { ok: false; reason: string }> {
  const gate = mintSwitch(env);
  if (!gate.open) return { ok: false, reason: gate.reason };
  const response = await fetchImpl(env.MINT_SIGNER_URL ?? "", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ instruction: "mint_one", network: "mainnet", name: input.name.slice(0, 80), uri: input.uri.slice(0, 200) }),
  });
  if (!response.ok) return { ok: false, reason: "SIGNER_REFUSED" };
  const json = (await response.json()) as { signature?: string };
  if (!json.signature) return { ok: false, reason: "SIGNER_REFUSED" };
  return { ok: true, signature: json.signature };
}
