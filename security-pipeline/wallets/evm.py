"""EVM approval / delegation audit using only keyless public endpoints.

Discovery:  Blockscout's Etherscan-compatible `getLogs` (keyless) for ERC-20/721 `Approval`,
            `ApprovalForAll`, and Uniswap Permit2 `Approval` events where topic1 == owner.
            Optional: ETHERSCAN_API_KEY env var enables Etherscan V2 for chains without a reachable
            keyless Blockscout (Base, Arbitrum, Polygon, BSC...).
Verification: current on-chain state via eth_call on PublicNode RPC (latest block, no archive needed):
            allowance(owner,spender), isApprovedForAll(owner,operator), Permit2.allowance(owner,token,spender).
Reputation: spender vs. ScamSniffer bad-address list + GoPlus approval_security (keyless) +
            EOA-spender detection (eth_getCode == 0x is a classic drainer pattern).
"""
from __future__ import annotations
import logging, os, re, time
from common import http

log = logging.getLogger("wallets.evm")
T_APPROVAL = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925"
T_APPROVAL_FOR_ALL = "0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31"
T_PERMIT2_APPROVAL = "0xda9fa7c1b00402c17d0161b249b1ab8bbec047c5a52207b9c112deffd817036b"
PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3"
SEL_ALLOWANCE, SEL_ISAPPROVEDALL, SEL_P2_ALLOWANCE = "0xdd62ed3e", "0xe985e9c5", "0x927da105"
SEL_SYMBOL, SEL_DECIMALS = "0x95d89b41", "0x313ce567"
UNLIMITED = 2 ** 255

CHAINS = {
    "ethereum": {"id": 1, "rpc": "https://ethereum-rpc.publicnode.com", "blockscout": "https://eth.blockscout.com"},
    "optimism": {"id": 10, "rpc": "https://optimism-rpc.publicnode.com", "blockscout": "https://optimism.blockscout.com"},
    "gnosis": {"id": 100, "rpc": "https://gnosis-rpc.publicnode.com", "blockscout": "https://gnosis.blockscout.com"},
    "base": {"id": 8453, "rpc": "https://base-rpc.publicnode.com", "blockscout": "https://base.blockscout.com"},
    "arbitrum": {"id": 42161, "rpc": "https://arbitrum-one-rpc.publicnode.com", "blockscout": "https://arbitrum.blockscout.com"},
    "polygon": {"id": 137, "rpc": "https://polygon-bor-rpc.publicnode.com", "blockscout": "https://polygon.blockscout.com"},
    "bsc": {"id": 56, "rpc": "https://bsc-rpc.publicnode.com", "blockscout": None},
}


def _pad(addr: str) -> str:
    return addr.lower().replace("0x", "").rjust(64, "0")


def rpc(chain: str, method: str, params: list):
    r = http.post_json(CHAINS[chain]["rpc"], {"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    if "error" in r:
        raise RuntimeError(f"{chain} rpc {method}: {r['error']}")
    return r["result"]


def eth_call(chain: str, to: str, data: str) -> str:
    return rpc(chain, "eth_call", [{"to": to, "data": data}, "latest"])


def rpc_batch(chain: str, calls: list, chunk: int = 40) -> list:
    """JSON-RPC batch; results aligned with `calls` (None on per-call error)."""
    out: list = [None] * len(calls)
    for i in range(0, len(calls), chunk):
        part = calls[i:i + chunk]
        payload = [{"jsonrpc": "2.0", "id": i + j, "method": m, "params": p} for j, (m, p) in enumerate(part)]
        for attempt in range(3):
            try:
                resp = http.post_json(CHAINS[chain]["rpc"], payload, timeout=60)
                if isinstance(resp, dict):
                    raise RuntimeError(resp.get("error"))
                for r in resp:
                    if "result" in r:
                        out[r["id"]] = r["result"]
                break
            except Exception as e:
                if attempt == 2:
                    log.warning("%s batch rpc failed: %s", chain, e)
                time.sleep(1.5 * (attempt + 1))
    return out


def batch_calls(chain: str, pairs: list) -> list:
    return rpc_batch(chain, [("eth_call", [{"to": to, "data": data}, "latest"]) for to, data in pairs])


def _decode_symbol(r, fallback: str) -> str:
    try:
        if r and len(r) >= 194:
            ln = int(r[66:130], 16)
            return bytes.fromhex(r[130:130 + ln * 2]).decode(errors="ignore").strip() or fallback
        if r and len(r) == 66:
            return bytes.fromhex(r[2:]).rstrip(b"\0").decode(errors="ignore").strip() or fallback
    except Exception:
        pass
    return fallback


GOPLUS_CAP = 150
SPAM_SYM = re.compile(r"(https?:|www\.|\.(com|io|net|org|xyz|site|app|top|vip|club|live)\b|claim|visit|reward|airdrop|voucher|\$\s?\d)", re.I)


def _known_spenders() -> dict:
    import yaml
    from pathlib import Path
    p = Path(__file__).with_name("known_spenders.yaml")
    return {k.lower(): v for k, v in (yaml.safe_load(p.read_text()) or {}).items()}


def _get_logs(chain: str, topic0: str, owner: str, address: str | None = None) -> list[dict]:
    """Paginated keyless log discovery. Raises if no explorer path is available."""
    cfg = CHAINS[chain]
    key = os.environ.get("ETHERSCAN_API_KEY")
    bases = []
    if cfg.get("blockscout"):
        bases.append(("blockscout", cfg["blockscout"] + "/api"))
    if key:
        bases.append(("etherscan", f"https://api.etherscan.io/v2/api?chainid={cfg['id']}&apikey={key}"))
    last_err = None
    for kind, base in bases:
        try:
            out, from_block = [], 0
            for _ in range(20):  # up to 20k logs
                sep = "&" if "?" in base else "?"
                url = (f"{base}{sep}module=logs&action=getLogs&fromBlock={from_block}&toBlock=latest"
                       f"&topic0={topic0}&topic1=0x{_pad(owner)}&topic0_1_opr=and")
                if address:
                    url += f"&address={address}"
                j = http.get_json(url, timeout=60)
                res = j.get("result")
                if not isinstance(res, list):
                    if "No records" in str(j.get("message", "")) or res in (None, []):
                        break
                    raise RuntimeError(f"{kind}: {j.get('message')} {str(res)[:120]}")
                out.extend(res)
                if len(res) < 1000:
                    break
                from_block = int(res[-1]["blockNumber"], 16) + 1
                time.sleep(0.3)
            return out
        except Exception as e:
            last_err = f"{kind}: {e}"
            log.debug("log discovery via %s failed on %s: %s", kind, chain, e)
    raise RuntimeError(last_err or f"no keyless explorer for {chain}; set ETHERSCAN_API_KEY to enable")


def _goplus_spender(chain: str, spender: str) -> dict:
    try:
        j = http.get_json(f"https://api.gopluslabs.io/api/v1/approval_security/{CHAINS[chain]['id']}?contract_addresses={spender}", timeout=20)
        return j.get("result") or {}
    except Exception as e:
        return {"error": str(e)}


def audit_address(owner: str, chains: list[str], bad: set[str]) -> tuple[list[dict], list[str]]:
    owner = owner.lower()
    findings, errors = [], []
    for chain in chains:
        if chain not in CHAINS:
            errors.append(f"{chain}: unsupported chain"); continue
        try:
            logs20 = _get_logs(chain, T_APPROVAL, owner)
            logs_all = _get_logs(chain, T_APPROVAL_FOR_ALL, owner)
            logs_p2 = _get_logs(chain, T_PERMIT2_APPROVAL, owner, address=PERMIT2)
        except Exception as e:
            errors.append(f"{chain}: approval discovery unavailable ({e})"); continue
        pairs20 = {(l["address"].lower(), "0x" + l["topics"][2][-40:]) for l in logs20
                   if len([t for t in l["topics"] if t]) == 3}
        pairs_all = {(l["address"].lower(), "0x" + l["topics"][2][-40:]) for l in logs_all}
        pairs_p2 = {("0x" + l["topics"][2][-40:], "0x" + l["topics"][3][-40:]) for l in logs_p2}
        log.info("%s %s: %d erc20 pairs, %d operator pairs, %d permit2 pairs to verify", chain, owner,
                 len(pairs20), len(pairs_all), len(pairs_p2))
        known = _known_spenders()
        rep_cache: dict[str, dict] = {}

        live: list[tuple] = []   # (kind, token, spender, amount, extra)
        p20 = sorted(pairs20)
        res = batch_calls(chain, [(t, SEL_ALLOWANCE + _pad(owner) + _pad(sp)) for t, sp in p20])
        for (t, sp), r in zip(p20, res):
            try:
                v = int(r, 16) if r and r != "0x" else 0
            except ValueError:
                v = 0
            if v > 0:
                live.append(("erc20", t, sp, v, {}))
        pall = sorted(pairs_all)
        res = batch_calls(chain, [(c, SEL_ISAPPROVEDALL + _pad(owner) + _pad(op)) for c, op in pall])
        for (c, op), r in zip(pall, res):
            try:
                if r and r != "0x" and int(r, 16) == 1:
                    live.append(("operator", c, op, None, {}))
            except ValueError:
                pass
        pp2 = sorted(pairs_p2)
        res = batch_calls(chain, [(PERMIT2, SEL_P2_ALLOWANCE + _pad(owner) + _pad(t) + _pad(sp)) for t, sp in pp2])
        for (t, sp), r in zip(pp2, res):
            if not r or len(r) < 130:
                continue
            amount, expiration = int(r[2:66], 16), int(r[66:130], 16)
            if amount > 0 and expiration > time.time():
                live.append(("permit2", t, sp, amount if amount < 2 ** 160 - 1 else UNLIMITED,
                             {"expires_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(expiration))}))
        tokens = sorted({x[1] for x in live if x[0] != "operator"})
        syms = batch_calls(chain, [(t, SEL_SYMBOL) for t in tokens])
        decs = batch_calls(chain, [(t, SEL_DECIMALS) for t in tokens])
        meta = {}
        for t, sy, de in zip(tokens, syms, decs):
            try:
                d = int(de, 16) if de and de != "0x" else None
            except ValueError:
                d = None
            meta[t] = (_decode_symbol(sy, t[:10]), d if d is not None and d < 80 else None)
        # reputation for all live spenders: batched getCode + parallel GoPlus (capped)
        spenders = sorted({x[2] for x in live})
        codes = rpc_batch(chain, [("eth_getCode", [sp, "latest"]) for sp in spenders])
        need_gp = [sp for sp in spenders if not known.get(sp) and sp not in bad][:GOPLUS_CAP]
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(6) as ex:
            gps = dict(zip(need_gp, ex.map(lambda sp: _goplus_spender(chain, sp), need_gp)))
        if len(spenders) > GOPLUS_CAP:
            errors.append(f"{chain}: {len(spenders)} live spenders; GoPlus reputation checked for first {GOPLUS_CAP} only")
        rep_cache = {}
        for sp, code in zip(spenders, codes):
            gp = gps.get(sp, {})
            rep_cache[sp] = {"is_eoa": code in ("0x", "0x0"), "code_lookup_failed": code is None,
                             "in_bad_list": sp in bad, "well_known": known.get(sp),
                             "goplus": {k: gp.get(k) for k in ("contract_name", "tag", "trust_list", "doubt_list",
                                                                 "malicious_behavior", "is_open_source") if k in gp}}
        for kind, token, spender, amount_raw, extra in live:
            rep = rep_cache[spender]
            sym, dec = meta.get(token, (token[:10], None))
            unlimited = amount_raw is not None and amount_raw >= UNLIMITED
            gp = rep["goplus"]
            flagged = bool(gp.get("malicious_behavior")) or gp.get("doubt_list") == 1
            spam = bool(SPAM_SYM.search(sym or ""))
            risky = rep["in_bad_list"] or (rep["is_eoa"] and not rep["code_lookup_failed"]) or (flagged and not rep["well_known"])
            trusted = gp.get("trust_list") == 1 or bool(rep["well_known"])
            broad = unlimited or kind == "operator"
            tier = ("CRITICAL" if risky and not spam else "HIGH" if broad and not trusted and not spam
                    else "WATCH" if broad and not spam else "INFO")
            why = [w for w, c in (("spender in known-bad list", rep["in_bad_list"]),
                                  ("spender is an EOA (not a contract) - classic drainer pattern", rep["is_eoa"]),
                                  (f"GoPlus flags spender: {gp.get('malicious_behavior')}", flagged and not rep["well_known"]),
                                  ("token looks like a spam/phishing token (URL or 'claim' in symbol) - likely a spoofed Approval event; do NOT interact with it", spam),
                                  ("unlimited amount", unlimited),
                                  ("operator can move ALL items in collection", kind == "operator"),
                                  (f"well-known spender: {rep['well_known']}", bool(rep["well_known"]))) if c]
            amt = None if amount_raw is None else ("unlimited" if unlimited else
                                                   (amount_raw / 10 ** dec if dec is not None else amount_raw))
            label = rep["well_known"] or gp.get("contract_name") or spender
            findings.append({"chain": chain, "address": owner, "kind": f"approval_{kind}", "tier": tier,
                             "title": f"{chain}: {sym} {kind} approval -> {label} ({amt if amt is not None else 'all items'})",
                             "detail": {"token": token, "symbol": sym, "spender": spender, "amount": amt, "why": why,
                                        "reputation": rep, **extra,
                                        "revoke": f"https://revoke.cash/address/{owner}?chainId={CHAINS[chain]['id']}"}})
        # interactions with known-bad addresses (last 200 txs + token transfers)
        try:
            findings += _bad_interactions(chain, owner, bad)
        except Exception as e:
            errors.append(f"{chain}: interaction scan failed ({e})")
    return findings, errors


def _bad_interactions(chain: str, owner: str, bad: set[str]) -> list[dict]:
    base = CHAINS[chain].get("blockscout")
    if not base:
        return []
    out, seen_out = [], set()
    txs = http.get_json(f"{base}/api?module=account&action=txlist&address={owner}&sort=desc&page=1&offset=200", timeout=60).get("result") or []
    tts = http.get_json(f"{base}/api?module=account&action=tokentx&address={owner}&sort=desc&page=1&offset=200", timeout=60).get("result") or []
    if not isinstance(txs, list): txs = []
    if not isinstance(tts, list): tts = []
    for t in txs + tts:
        for cp in (t.get("to", ""), t.get("from", "")):
            cp = (cp or "").lower()
            if cp and cp != owner and cp in bad:
                out.append({"chain": chain, "address": owner, "kind": "bad_counterparty", "tier": "CRITICAL",
                            "title": f"{chain}: interaction with known-bad address {cp}",
                            "detail": {"counterparty": cp, "tx": t.get("hash"), "list": "ScamSniffer/denylist"}})
        if (t.get("from") or "").lower() == owner:
            seen_out.add((t.get("to") or "").lower())
    # address-poisoning: inbound token transfers from look-alikes of addresses you've sent to
    for t in tts:
        frm = (t.get("from") or "").lower()
        if frm == owner or frm in seen_out:
            continue
        for real in seen_out:
            if real and frm[:6] == real[:6] and frm[-4:] == real[-4:] and frm != real:
                out.append({"chain": chain, "address": owner, "kind": "address_poisoning", "tier": "HIGH",
                            "title": f"{chain}: possible address-poisoning transfer from {frm} (mimics {real})",
                            "detail": {"poison": frm, "mimics": real, "tx": t.get("hash"),
                                       "advice": "Never copy recipient addresses from transaction history."}})
                break
    return out
