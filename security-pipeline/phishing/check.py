"""Phishing / scam checker for URLs, domains, and token contracts. Keyless public data only.

  python -m phishing.check url https://bybit-login.com/verify
  python -m phishing.check url bybit.com
  python -m phishing.check token <solana-mint>                 # RugCheck + GoPlus (Solana)
  python -m phishing.check token 0x... --chain ethereum        # GoPlus token security (EVM)

Domain verdict combines: exact match to your legit list, MetaMask eth-phishing-detect (blacklist +
fuzzylist + whitelist), ScamSniffer public blacklist (published with a ~7-day delay), GoPlus phishing_site,
lookalike analysis (punycode/homoglyph skeleton, edit distance, brand-in-label, brand-as-subdomain),
and domain age via RDAP (rdap.org bootstrap).
"""
from __future__ import annotations
import argparse, json, re, sys, unicodedata
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import tldextract  # noqa: E402
from common import config, http, logs  # noqa: E402

MM_CONFIG = "https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json"
SS_DOMAINS = "https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/domains.json"
_extract = tldextract.TLDExtract(cache_dir=str(Path(__file__).resolve().parent.parent / "data" / "tldcache"))

HOMOGLYPHS = str.maketrans({"0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g",
                            "і": "i", "о": "o", "а": "a", "е": "e", "р": "p", "с": "c", "у": "y", "х": "x",
                            "ı": "i", "ӏ": "l", "ɡ": "g", "ԁ": "d", "ո": "n", "ս": "u", "ν": "v", "к": "k"})
LURE_WORDS = r"(login|signin|sign-in|verify|verification|secure|security|support|help|wallet|connect|claim|airdrop|reward|bonus|unlock|restore|recovery|sync|validate|kyc|refund|compensation|official|app|web|auth|account|update|migrat\w*|bridge|rectify|dapp)"


def levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def skeleton(label: str) -> str:
    s = unicodedata.normalize("NFKC", label.lower()).translate(HOMOGLYPHS)
    s = s.replace("rn", "m").replace("vv", "w").replace("cl", "d")
    return re.sub(r"[^a-z]", "", s)


def host_of(target: str) -> str:
    t = target.strip()
    if "://" not in t:
        t = "http://" + t
    from urllib.parse import urlsplit
    h = (urlsplit(t).hostname or "").lower().rstrip(".")
    try:
        if any(p.startswith("xn--") for p in h.split(".")):
            h = h.encode().decode("idna")
    except Exception:
        pass
    return h


def legit_domains(exposure: dict) -> list[str]:
    out = set(exposure.get("legit_domains") or [])
    for e in exposure.get("entities", []):
        out |= set(e.get("domains") or [])
    return sorted(out)


def rdap_age_days(domain: str) -> tuple[float | None, str | None]:
    try:
        j = http.get_json(f"https://rdap.org/domain/{domain}", timeout=20, allow_redirects=True)
        for ev in j.get("events", []):
            if ev.get("eventAction") == "registration":
                dt = datetime.fromisoformat(ev["eventDate"].replace("Z", "+00:00"))
                return (datetime.now(timezone.utc) - dt).total_seconds() / 86400, ev["eventDate"]
        return None, "no registration event in RDAP"
    except Exception as e:
        code = getattr(getattr(e, "response", None), "status_code", None)
        if code == 404:
            return None, "not found in RDAP (unregistered, or registry has no RDAP record)"
        return None, f"RDAP unavailable: {type(e).__name__} {code or ''}".strip()


def check_domain(target: str, exposure: dict | None = None, online: bool = True) -> dict:
    exposure = exposure or config.exposure()
    host = host_of(target)
    ext = _extract(host)
    reg = ".".join(p for p in (ext.domain, ext.suffix) if p) or host
    legit = legit_domains(exposure)
    signals, score = [], 0
    res = {"input": target, "host": host, "registrable_domain": reg}
    if reg in legit or host in legit:
        res.update(verdict="LEGIT (on your allowlist)", risk_score=0, signals=["exact match to configured legit domain"])
        return res
    if host.startswith("xn--") or any(ord(c) > 127 for c in host):
        signals.append("internationalized (non-ASCII/punycode) domain - homograph risk"); score += 30
    # lookalike analysis vs each legit brand label
    lab = ext.domain or ""
    sk = skeleton(lab)
    sub = ext.subdomain or ""
    seen_brands = set()
    for d in legit:
        e2 = _extract(d)
        brand = e2.domain
        if len(brand) < 3 or brand in {"app", "explorer"} or brand in seen_brands:
            continue
        seen_brands.add(brand)
        bsk = skeleton(brand)
        if lab == brand and ext.suffix != e2.suffix:
            signals.append(f"same brand '{brand}' on different TLD .{ext.suffix} (legit: {d})"); score += 45
        elif sk == bsk and lab != brand:
            signals.append(f"homoglyph lookalike of {d} ('{lab}' ~ '{brand}')"); score += 60
        elif len(brand) >= 4 and 0 < levenshtein(sk, bsk) <= (1 if len(brand) <= 5 else 2):
            signals.append(f"typosquat of {d} (edit distance {levenshtein(sk, bsk)})"); score += 55
        elif len(brand) >= 4 and brand in lab and lab != brand:
            lure = re.search(LURE_WORDS, lab)
            signals.append(f"contains brand '{brand}'" + (f" plus lure word '{lure.group(0)}'" if lure else "") + f" (legit: {d})")
            score += 50 if lure else 35
        if len(brand) >= 4 and re.search(rf"(^|[.-]){re.escape(brand)}([.-]|$)", sub) and reg != d:
            signals.append(f"brand '{brand}' used as SUBDOMAIN of unrelated domain {reg}"); score += 50
    if re.search(LURE_WORDS, host) and score:
        score += 5
    if ext.suffix in {"xyz", "top", "click", "link", "pages.dev", "vercel.app", "netlify.app", "run", "icu", "buzz", "fun", "live", "site", "online", "shop", "lol", "app"}:
        signals.append(f"high-abuse TLD/host .{ext.suffix}"); score += 10
    res["lists"] = {}
    if online:
        try:
            mm = http.cached_json(MM_CONFIG, max_age_s=6 * 3600)
            bl = set(mm.get("blacklist", []))
            wl = set(mm.get("whitelist", []))
            hit = next((h for h in (host, reg) if h in bl), None)
            res["lists"]["metamask_blacklist"] = bool(hit)
            if hit:
                signals.append(f"listed in MetaMask eth-phishing-detect blacklist ({hit})"); score += 100
            if host in wl or reg in wl:
                res["lists"]["metamask_whitelist"] = True
                signals.append("on MetaMask whitelist (explicitly not phishing)"); score -= 40
            for fz in mm.get("fuzzylist", []):
                fb = fz.split(".")[0]
                if reg != fz and reg not in wl and 0 < levenshtein(lab, fb) <= mm.get("tolerance", 1) + 1 and len(lab) > 3:
                    signals.append(f"MetaMask fuzzylist proximity to {fz}"); score += 30
        except Exception as e:
            res["lists"]["metamask_error"] = str(e)
        try:
            ss = http.cached_json(SS_DOMAINS, max_age_s=6 * 3600)
            ss_set = ss if isinstance(ss, set) else set(ss)
            hit = next((h for h in (host, reg, host.removeprefix("www.")) if h in ss_set), None)
            res["lists"]["scamsniffer"] = bool(hit)
            if hit:
                signals.append(f"listed in ScamSniffer blacklist ({hit})"); score += 100
        except Exception as e:
            res["lists"]["scamsniffer_error"] = str(e)
        try:
            gp = http.get_json(f"https://api.gopluslabs.io/api/v1/phishing_site?url={host}", timeout=20)
            flag = (gp.get("result") or {}).get("phishing_site")
            res["lists"]["goplus_phishing_site"] = flag
            if flag == 1:
                signals.append("GoPlus phishing_site = 1"); score += 100
        except Exception as e:
            res["lists"]["goplus_error"] = str(e)
        age, info = rdap_age_days(reg)
        res["domain_age_days"] = round(age, 1) if age is not None else None
        res["registered"] = info if age is not None else None
        if age is None:
            res["rdap_note"] = info
        elif age < 30:
            signals.append(f"domain registered {age:.0f} days ago"); score += 35
        elif age < 180:
            signals.append(f"domain is young ({age:.0f} days)"); score += 15
    score = max(0, min(100, score))
    verdict = ("DANGEROUS - do not connect a wallet or log in" if score >= 70 else
               "SUSPICIOUS - verify via your bookmarked official URL" if score >= 35 else
               "NO KNOWN RISK SIGNALS (not a guarantee)")
    res.update(verdict=verdict, risk_score=score, signals=signals)
    return res


def check_token(addr: str, chain: str = "solana") -> dict:
    out = {"input": addr, "chain": chain, "sources": {}}
    if chain == "solana":
        try:
            rc = http.get_json(f"https://api.rugcheck.xyz/v1/tokens/{addr}/report/summary", timeout=25)
            out["sources"]["rugcheck"] = {"score": rc.get("score"), "score_normalised": rc.get("score_normalised"),
                                          "risks": [(r.get("level"), r.get("name"), r.get("description")) for r in rc.get("risks", [])],
                                          "lp_locked_pct": rc.get("lpLockedPct"), "token_program": rc.get("tokenProgram")}
        except Exception as e:
            out["sources"]["rugcheck"] = {"error": str(e)}
        try:
            gp = http.get_json(f"https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses={addr}", timeout=25)
            r = (gp.get("result") or {}).get(addr) or {}
            pick = {k: (r.get(k) or {}).get("status") if isinstance(r.get(k), dict) else r.get(k)
                    for k in ("mintable", "freezable", "closable", "balance_mutable_authority", "transfer_fee_upgradable",
                              "non_transferable", "default_account_state", "trusted_token")}
            out["sources"]["goplus_solana"] = pick
        except Exception as e:
            out["sources"]["goplus_solana"] = {"error": str(e)}
        flags = []
        gp = out["sources"].get("goplus_solana", {})
        if gp.get("mintable") == "1": flags.append("mint authority active (supply can be inflated)")
        if gp.get("freezable") == "1": flags.append("freeze authority active (your tokens can be frozen = honeypot risk)")
        if gp.get("balance_mutable_authority") == "1": flags.append("balance mutable authority (Token-2022 permanent delegate style)")
        rc = out["sources"].get("rugcheck", {})
        for lvl, name, _ in rc.get("risks", []) or []:
            if lvl == "danger": flags.append(f"RugCheck danger: {name}")
        out["flags"] = flags
        out["verdict"] = "HIGH RISK" if any(("freeze" in f or "danger" in f or "mutable" in f) for f in flags) else \
                         "CAUTION" if flags else "no major red flags found by these checks"
    else:
        from wallets.evm import CHAINS
        cid = CHAINS.get(chain, {}).get("id", 1)
        try:
            gp = http.get_json(f"https://api.gopluslabs.io/api/v1/token_security/{cid}?contract_addresses={addr}", timeout=25)
            r = (gp.get("result") or {}).get(addr.lower()) or {}
            keys = ("token_name", "token_symbol", "is_honeypot", "buy_tax", "sell_tax", "cannot_sell_all", "is_mintable",
                    "owner_change_balance", "hidden_owner", "selfdestruct", "is_blacklisted", "transfer_pausable",
                    "is_proxy", "is_open_source", "trust_list", "holder_count")
            out["sources"]["goplus"] = {k: r.get(k) for k in keys}
            bad = [k for k in ("is_honeypot", "cannot_sell_all", "owner_change_balance", "hidden_owner", "selfdestruct") if r.get(k) == "1"]
            out["flags"] = bad
            if bad and r.get("trust_list") == "1":
                out["verdict"] = f"TRUSTED-LIST token with centralized issuer controls ({', '.join(bad)}) - normal for e.g. fiat stablecoins"
            else:
                out["verdict"] = "HIGH RISK" if bad else ("CAUTION" if r.get("is_open_source") == "0" else "no major red flags found by GoPlus")
        except Exception as e:
            out["sources"]["goplus"] = {"error": str(e)}
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest="cmd", required=True)
    u = sp.add_parser("url"); u.add_argument("target", nargs="+"); u.add_argument("--offline", action="store_true")
    t = sp.add_parser("token"); t.add_argument("address"); t.add_argument("--chain", default=None)
    a = ap.parse_args()
    logs.setup(False)
    if a.cmd == "url":
        exp = config.exposure()
        print(json.dumps([check_domain(x, exp, online=not a.offline) for x in a.target], indent=2, ensure_ascii=False))
    else:
        chain = a.chain or ("ethereum" if a.address.startswith("0x") else "solana")
        print(json.dumps(check_token(a.address, chain), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
