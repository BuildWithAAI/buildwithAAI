"""Build and validate `risk_report v1` documents (smr/schemas/risk_report.v1.json)."""
from __future__ import annotations
import hashlib, json, os, re, subprocess, sys, time, unicodedata
from functools import lru_cache
import jsonschema
from . import __version__, MODEL_NAME, SCHEMA_VERSION

SCHEMA_PATH = os.path.join(os.path.dirname(__file__), "schemas", "risk_report.v1.json")
SUMMARY_TTL_S = 15 * 60
SYMBOL_MAX, NAME_MAX = 32, 64

# agent-guard's safe_field is the shared sanitizer; fall back to a local equivalent if it's missing.
_AG_PATH = os.environ.get("AGENT_GUARD_PATH", "/workspace/agent-guard")
try:
    if os.path.isdir(_AG_PATH) and _AG_PATH not in sys.path:
        sys.path.append(_AG_PATH)
    from agent_guard import safe_field as _safe_field
except Exception:  # pragma: no cover - exercised via _fallback_safe_field in tests
    _safe_field = None

_INVISIBLE = re.compile("[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u00ad\u180e]")
_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f]")
_MARKUP = re.compile(r"<[^>]*>|[<>`*_\[\]{}|\\]")


def _fallback_safe_field(value, max_len: int) -> str:
    s = unicodedata.normalize("NFKC", str(value))
    s = _CONTROL.sub(" ", _INVISIBLE.sub("", s))
    s = _MARKUP.sub("", s)
    return re.sub(r"\s{2,}", " ", s).strip()[:max_len]


def clean_token_field(value, max_len: int):
    """Sanitize attacker-chosen token text (name/symbol). None stays None (schema allows null)."""
    if value is None:
        return None
    if _safe_field is not None:
        try:
            return _safe_field(value, max_len=max_len)
        except Exception:
            pass
    return _fallback_safe_field(value, max_len)


class ReportValidationError(Exception):
    pass


@lru_cache(1)
def schema():
    return json.load(open(SCHEMA_PATH))


@lru_cache(1)
def _validator():
    return jsonschema.Draft202012Validator(schema())


@lru_cache(1)
def code_commit():
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=os.path.dirname(os.path.dirname(__file__)),
                              capture_output=True, text=True, timeout=5).stdout.strip() or None
    except Exception:
        return None


def iso(ts):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts)) if ts else None


def validate(doc):
    errs = sorted(_validator().iter_errors(doc), key=lambda e: list(e.path))
    if errs:
        raise ReportValidationError("; ".join(f"{'/'.join(map(str, e.path))}: {e.message}" for e in errs[:5]))
    return doc


def model_version(settings):
    return f"{MODEL_NAME}@{__version__}+th.{settings.thresholds_version}"


def _jsonable(o):
    return json.loads(json.dumps(o, default=str))


def build(sig, sc, settings, sources=None, generated_at=None, full=False):
    e = sig["early"]
    gen = generated_at or time.time()
    created = sig.get("create_time")
    mv = model_version(settings)
    buyers = [{k: b.get(k) for k in ("rank", "wallet", "slot", "slot_offset", "block_time", "sol_amount", "quote_amount", "signer_sol_spent",
                                     "pct_supply_bought", "pct_supply_held_as_of", "is_creator", "same_slot_as_create", "signature")} for b in e["buyers"]]
    for b in buyers:
        t = sig["traces"].get(b["wallet"]) or {}
        b["funders"] = [{"funder": f["funder"], "sol": round(f["lamports"] / 1e9, 4), "label": f.get("label"), "in_window": f.get("in_window"),
                         "hop2": [g["funder"] for g in f.get("hop2", [])]} for f in t.get("funders", [])]
        info = t.get("info") or {}
        b["wallet_history_complete"] = bool(info.get("history_complete"))
        b["wallet_age_h_at_buy"] = round((b["block_time"] - info["first_block_time"]) / 3600, 2) if info.get("first_block_time") and b.get("block_time") else None
    holders = {k: v for k, v in sig["holders"].items() if k != "balances"}
    flagged = sorted([r for r in sc["rules"] if r["triggered"]], key=lambda r: -r["points"])
    # token name/symbol are attacker-chosen text: sanitize before they reach reports/summaries
    sym = clean_token_field(sig["coin"].get("symbol"), SYMBOL_MAX)
    name = clean_token_field(sig["coin"].get("name"), NAME_MAX)
    top = [f"{r['rule']} +{r['points']}: {r['reason']}"[:160] for r in flagged[:3]]
    rid = hashlib.sha256(f"{sig['mint']}|{sig['as_of']}|{mv}".encode()).hexdigest()[:16]
    doc = {
        "schema_version": SCHEMA_VERSION,
        "report_id": rid,
        "model": {"name": MODEL_NAME, "version": __version__, "thresholds_version": settings.thresholds_version, "code_commit": code_commit()},
        "asset": {"asset_id": f"solana:{sig['mint']}", "chain": "solana", "venue": "pump.fun", "asset_type": "spl_token",
                  "symbol": sym, "name": name},
        "timestamps": {"generated_at": iso(gen), "as_of": iso(sig["as_of"]), "asset_created_at": iso(created),
                       "asset_age_s_at_as_of": int(sig["as_of"] - created) if created else None},
        "mode": sig["mode"],
        "score": sc["score"], "raw_points": sc["raw_points"],
        "recommendation": sc["recommendation"], "decision_reasons": sc["decision_reasons"],
        "suggested_size": sc["suggested_size"], "confidence": sc["confidence"],
        "hard_flags": sc["hard_flags"],
        "flagged_rules": [{k: r[k] for k in ("rule", "points", "max_points", "hard", "reason")} for r in flagged],
        "rules": sc["rules"],
        "market_gates": sc["market_gates"],
        "evidence": {"clusters": sig["clusters"], "same_slot": sig["same_slot"], "deployer": sig["deployer"], "serial_deployer": sig["serial"],
                     "deployer_funder_serial": sig["funder_serial"], "holders": holders, "fresh_wallets": sig["fresh"],
                     "authorities": sig["authorities"], "liquidity": sig["liquidity"], "creator_flow": sig.get("creator_flow"),
                     "creation": e.get("creation"), "early_buyers": buyers},
        "data_coverage": {**{k: v for k, v in sig["coverage"].items()}, "sources": sources or {}},
        "timings": sig["timings"],
        "orchestrator_summary": {
            "v": 1, "asset_id": f"solana:{sig['mint']}", "symbol": sym, "decision": sc["recommendation"], "score": sc["score"],
            "max_size_pct": sc["suggested_size"]["pct_of_bankroll_max"], "confidence": sc["confidence"]["label"],
            "hard_flags": sc["hard_flags"], "top_reasons": top, "as_of": iso(sig["as_of"]), "valid_until": iso(sig["as_of"] + SUMMARY_TTL_S),
            "model": mv,
            "line": f"{sym or sig['mint'][:8]} {sc['recommendation']} score={sc['score']} size<={sc['suggested_size']['pct_of_bankroll_max']}% "
                    f"conf={sc['confidence']['label']}" + (f" hard={','.join(sc['hard_flags'])}" if sc["hard_flags"] else "")
                    + (f" top={flagged[0]['rule']}" if flagged else ""),
        },
        "disclaimer": "Heuristic risk screen for small discretionary positions; not investment advice. Read-only: no trades, no signing, no keys.",
    }
    doc["orchestrator_summary"]["line"] = doc["orchestrator_summary"]["line"][:240]
    if full:
        doc["evidence"]["raw_traces"] = sig["traces"]
    doc = _jsonable(doc)
    return validate(doc)
