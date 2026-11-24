"""risk points -> decision tier -> size multiplier; and the risk_decision document builder/validator."""
from __future__ import annotations
import datetime as dt, json, os
from .. import __version__

SKIP_SCORE, REDUCED_SCORE = 60, 30          # same defaults as smr
TIER_MULT = {"NORMAL": 1.0, "REDUCED": 0.5, "SKIP": 0.0}
ORCH_KEYS = ["v", "asset_id", "symbol", "decision", "score", "max_size_pct", "confidence", "hard_flags",
             "top_reasons", "as_of", "valid_until", "model", "line"]
MODEL = f"aai-risk@{__version__}"
DISCLAIMER = ("Risk-hygiene output only (sizing, liquidity, volatility, exposure, guardrails). It is not a "
              "trading signal and makes no claim of edge. aai-core is read-only: it never places orders, "
              "holds keys, or signs anything.")
SCHEMA_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "schemas", "risk_decision.v1.json")


def iso(ts: float | None) -> str | None:
    return None if ts is None else dt.datetime.fromtimestamp(int(ts), dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def reason(code, points, severity, detail, hard=False) -> dict:
    return {"code": code, "points": int(max(0, min(100, points))), "severity": "hard" if hard else severity, "detail": str(detail)[:300]}


def decide(reasons: list[dict]) -> tuple[int, str, list[str]]:
    score = min(100, sum(r["points"] for r in reasons))
    hard = [r["code"] for r in reasons if r["severity"] == "hard"]
    if hard or score >= SKIP_SCORE:
        return (max(score, SKIP_SCORE) if hard else score), "SKIP", hard
    return score, ("REDUCED" if score >= REDUCED_SCORE else "NORMAL"), hard


def top_reasons(reasons: list[dict], n=3) -> list[str]:
    rs = sorted([r for r in reasons if r["points"] > 0 or r["severity"] == "hard"], key=lambda r: (r["severity"] != "hard", -r["points"]))
    return [f"{r['code']} +{r['points']}: {r['detail']}"[:160] for r in rs[:n]]


def line(symbol, decision, score, max_size_pct, confidence, reasons) -> str:
    top = top_reasons(reasons, 1)
    t = top[0].split(" ")[0] if top else "none"
    return f"{symbol} {decision} score={score} risk<={max_size_pct}% conf={confidence} top={t}"[:240]


def orchestrator_view(d: dict) -> dict:
    """Project a risk_decision onto smr's orchestrator_summary v1 keys (what older hub code reads)."""
    return {k: d[k] for k in ORCH_KEYS}


_validator = None


def validate(d: dict) -> list[str]:
    global _validator
    import jsonschema
    if _validator is None:
        s = json.load(open(SCHEMA_PATH))
        _validator = jsonschema.Draft202012Validator(s)
    return [f"{'/'.join(map(str, e.path))}: {e.message}"[:300] for e in _validator.iter_errors(d)]
