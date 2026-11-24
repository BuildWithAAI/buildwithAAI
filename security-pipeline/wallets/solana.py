"""Solana wallet audit via the public mainnet RPC (keyless).

Checks:
  * SPL Token + Token-2022 accounts with an active `delegate` (the Solana equivalent of an ERC-20
    approval - drainers ask you to `approve` a delegate, then sweep later).
  * Token accounts whose `closeAuthority` is someone else, and frozen accounts.
  * Wallet account ownership: a normal wallet is owned by the System Program. Phishing kits that
    trick users into signing `assign` reassign the account to an attacker program -> CRITICAL.
  * Recent transaction counterparties vs. your denylist / public lists.
"""
from __future__ import annotations
import logging, os, time
from common import http

log = logging.getLogger("wallets.solana")
RPC = os.environ.get("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com")
TOKEN_PROGRAMS = {"spl-token": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                  "token-2022": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"}
SYSTEM_PROGRAM = "11111111111111111111111111111111"


def rpc(method: str, params: list, retries: int = 4):
    for i in range(retries):
        r = http.post_json(RPC, {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, timeout=40)
        if "error" in r:
            if r["error"].get("code") in (429, -32005) and i < retries - 1:
                time.sleep(2 * (i + 1)); continue
            raise RuntimeError(f"solana rpc {method}: {r['error']}")
        return r["result"]


def audit_address(owner: str, bad: set[str], recent_tx: int = 15) -> tuple[list[dict], list[str]]:
    findings, errors = [], []
    try:
        acct = rpc("getAccountInfo", [owner, {"encoding": "jsonParsed"}])
        v = acct.get("value") if acct else None
        if v is None:
            findings.append({"chain": "solana", "address": owner, "kind": "account_missing", "tier": "INFO",
                             "title": "Solana: wallet account not found on-chain (unfunded/closed)", "detail": {}})
        elif v.get("owner") != SYSTEM_PROGRAM:
            findings.append({"chain": "solana", "address": owner, "kind": "account_owner_changed", "tier": "CRITICAL",
                             "title": f"Solana: wallet account owned by program {v.get('owner')} (not System Program) - possible 'assign' phishing takeover",
                             "detail": {"owner_program": v.get("owner")}})
    except Exception as e:
        errors.append(f"solana getAccountInfo: {e}")
    n_accounts = 0
    for prog_name, prog in TOKEN_PROGRAMS.items():
        try:
            res = rpc("getTokenAccountsByOwner", [owner, {"programId": prog}, {"encoding": "jsonParsed"}])
        except Exception as e:
            errors.append(f"solana {prog_name} accounts: {e}"); continue
        for ta in res.get("value", []):
            n_accounts += 1
            info = ta["account"]["data"]["parsed"]["info"]
            mint, amt = info.get("mint"), info.get("tokenAmount", {})
            if info.get("delegate"):
                d_amt = (info.get("delegatedAmount") or {}).get("uiAmount")
                tier = "CRITICAL" if info["delegate"] in bad else "HIGH"
                findings.append({"chain": "solana", "address": owner, "kind": "token_delegate", "tier": tier,
                                 "title": f"Solana: token account for mint {mint[:8]}... has delegate {info['delegate']} (can move {d_amt})",
                                 "detail": {"token_account": ta["pubkey"], "mint": mint, "delegate": info["delegate"],
                                            "delegated_amount": d_amt, "balance": amt.get("uiAmount"), "program": prog_name,
                                            "fix": "Revoke with your wallet's token-revoke feature or `spl-token revoke <ACCOUNT>`."}})
            ca = info.get("closeAuthority")
            if ca and ca != owner:
                findings.append({"chain": "solana", "address": owner, "kind": "foreign_close_authority", "tier": "WATCH",
                                 "title": f"Solana: token account {ta['pubkey'][:8]}... close authority is {ca}",
                                 "detail": {"token_account": ta["pubkey"], "mint": mint, "close_authority": ca}})
            if info.get("state") == "frozen" and (amt.get("uiAmount") or 0) > 0:
                findings.append({"chain": "solana", "address": owner, "kind": "frozen_token_account", "tier": "INFO",
                                 "title": f"Solana: frozen token account for mint {mint[:8]}... (mint freeze authority used - common in honeypot memecoins)",
                                 "detail": {"token_account": ta["pubkey"], "mint": mint, "balance": amt.get("uiAmount")}})
    log.info("solana %s: %d token accounts scanned", owner, n_accounts)
    if recent_tx and bad:
        try:
            sigs = rpc("getSignaturesForAddress", [owner, {"limit": recent_tx}])
            for s in sigs:
                tx = rpc("getTransaction", [s["signature"], {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0}])
                time.sleep(0.25)
                if not tx:
                    continue
                keys = [k["pubkey"] if isinstance(k, dict) else k for k in tx["transaction"]["message"]["accountKeys"]]
                hits = [k for k in keys if k in bad and k != owner]
                for h in hits:
                    findings.append({"chain": "solana", "address": owner, "kind": "bad_counterparty", "tier": "CRITICAL",
                                     "title": f"Solana: transaction touched known-bad address {h}",
                                     "detail": {"signature": s["signature"], "counterparty": h}})
        except Exception as e:
            errors.append(f"solana recent tx scan: {e}")
    return findings, errors
