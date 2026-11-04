"""Structured paper thesis for one scored token.

Every market number is copied from the observation or from a named rule
applied to those numbers. Holder concentration is unavailable unless a
holder read taken at or before the decision is attached. An optional
narrative is kept only when every number in it already appears in the thesis.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path

from .holder_concentration import thesis_parts

REQUIRED = (
    "protocol", "thesis_id", "mint", "symbol", "pair", "score_ppm", "threshold_ppm",
    "bull_case", "bear_case", "brains", "risk_flags", "proposal", "horizon_ms",
    "confidence_ppm", "provenance", "observed", "markdown", "narrative_source",
    "mode", "action", "execution_allowed",
)
RULE_STOP_FLOOR = 0.05
RULE_STOP_CAP = 0.40
RULE_TP_R = 2.0
RULE_THIN_LIQUIDITY_USD = 25_000.0
RULE_YOUNG_PAIR_MS = 86_400_000
RULE_VOLUME_TO_LIQUIDITY = 8.0
RULE_MOVE_PERCENT = 80.0
_NUMBER = re.compile(r"(?<![A-Za-z0-9.])(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?![A-Za-z0-9])")


class ThesisError(ValueError):
    pass


def _num(value):
    if type(value) is bool or type(value) not in (int, float):
        return None
    return float(value)


def _walk_numbers(value):
    if type(value) is bool:
        return
    if type(value) in (int, float):
        yield float(value)
        return
    if type(value) is dict:
        for item in value.values():
            yield from _walk_numbers(item)
        return
    if type(value) is list:
        for item in value:
            yield from _walk_numbers(item)


def numbers_allowed(text: str, thesis: dict) -> bool:
    allowed = list(_walk_numbers(thesis))
    for match in _NUMBER.finditer(text):
        number = float(match.group(1))
        if not any(abs(number - item) <= 1e-6 + 1e-6 * abs(item) for item in allowed):
            return False
    return True


def _case(side: str, points: list[dict]) -> list[dict]:
    return [{"side": side, "claim": point["claim"], "evidence": point["evidence"]} for point in points]


def _flags(observed: dict, holder_flag: dict) -> list[dict]:
    liquidity = _num(observed.get("liquidity_usd"))
    volume = _num(observed.get("volume_h1"))
    change = _num(observed.get("price_change_h1"))
    age = observed.get("pair_age_ms")
    flags = []
    if liquidity is None:
        flags.append({"flag": "LIQUIDITY", "status": "UNAVAILABLE", "observed": None})
    elif liquidity < RULE_THIN_LIQUIDITY_USD:
        flags.append({"flag": "LIQUIDITY", "status": "RAISED", "observed": liquidity, "rule_usd": RULE_THIN_LIQUIDITY_USD})
    else:
        flags.append({"flag": "LIQUIDITY", "status": "CLEAR", "observed": liquidity, "rule_usd": RULE_THIN_LIQUIDITY_USD})
    flags.append(holder_flag)
    if type(age) is not int:
        flags.append({"flag": "PAIR_AGE", "status": "UNAVAILABLE", "observed": None})
    elif age < 0:
        flags.append({"flag": "PAIR_AGE", "status": "RAISED", "observed": age, "reason": "FUTURE_OR_CLOCK_SKEW"})
    elif age < RULE_YOUNG_PAIR_MS:
        flags.append({"flag": "PAIR_AGE", "status": "RAISED", "observed": age, "rule_ms": RULE_YOUNG_PAIR_MS})
    else:
        flags.append({"flag": "PAIR_AGE", "status": "CLEAR", "observed": age, "rule_ms": RULE_YOUNG_PAIR_MS})
    anomaly = False
    if liquidity is not None and liquidity > 0 and volume is not None and volume > RULE_VOLUME_TO_LIQUIDITY * liquidity:
        anomaly = True
    if change is not None and abs(change) >= RULE_MOVE_PERCENT:
        anomaly = True
    if volume is None and change is None:
        flags.append({"flag": "VOLUME_ANOMALY", "status": "UNAVAILABLE", "observed": None})
    else:
        flags.append({
            "flag": "VOLUME_ANOMALY",
            "status": "RAISED" if anomaly else "CLEAR",
            "observed": {"volume_h1": volume, "liquidity_usd": liquidity, "price_change_h1": change},
            "rule_volume_multiple": RULE_VOLUME_TO_LIQUIDITY,
            "rule_move_percent": RULE_MOVE_PERCENT,
        })
    return flags


def _proposal(price: float, change) -> dict:
    rule = {
        "stop_floor": RULE_STOP_FLOOR,
        "stop_cap": RULE_STOP_CAP,
        "take_profit_r": RULE_TP_R,
        "label": "RULE_CONSTANT_NOT_AN_OBSERVED_QUOTE",
    }
    if change is None:
        return {
            "entry_price_usd": price,
            "stop_price_usd": None,
            "take_profit_price_usd": None,
            "reason": "MISSING_OBSERVED_MOVE",
            "rule_constants": rule,
            "not_an_order": True,
        }
    distance = min(RULE_STOP_CAP, max(RULE_STOP_FLOOR, abs(change) / 100))
    return {
        "entry_price_usd": price,
        "stop_price_usd": price * (1 - distance),
        "take_profit_price_usd": price * (1 + RULE_TP_R * distance),
        "distance": distance,
        "reason": "OBSERVED_PRICE_AND_ABS_H1_MOVE",
        "rule_constants": rule,
        "not_an_order": True,
    }


def _points(observed: dict) -> tuple[list[dict], list[dict]]:
    bull, bear = [], []
    change = _num(observed.get("price_change_h1"))
    buys, sells = _num(observed.get("buys_h1")), _num(observed.get("sells_h1"))
    liquidity = _num(observed.get("liquidity_usd"))
    if change is not None and change > 0:
        bull.append({"claim": "Hourly price change is positive.", "evidence": {"price_change_h1": change}})
    if change is not None and change < 0:
        bear.append({"claim": "Hourly price change is negative.", "evidence": {"price_change_h1": change}})
    if buys is not None and sells is not None and buys > sells:
        bull.append({"claim": "Hourly buys exceed sells.", "evidence": {"buys_h1": buys, "sells_h1": sells}})
    if buys is not None and sells is not None and sells > buys:
        bear.append({"claim": "Hourly sells exceed buys.", "evidence": {"buys_h1": buys, "sells_h1": sells}})
    if liquidity is not None and liquidity >= RULE_THIN_LIQUIDITY_USD:
        bull.append({"claim": "Reported liquidity is at least the thin-liquidity rule.", "evidence": {"liquidity_usd": liquidity, "rule_usd": RULE_THIN_LIQUIDITY_USD}})
    if liquidity is not None and liquidity < RULE_THIN_LIQUIDITY_USD:
        bear.append({"claim": "Reported liquidity is under the thin-liquidity rule.", "evidence": {"liquidity_usd": liquidity, "rule_usd": RULE_THIN_LIQUIDITY_USD}})
    return bull, bear


def _markdown(thesis: dict) -> str:
    pair = thesis["pair"]
    lines = [
        f"# {thesis['symbol'] or 'token'}",
        "",
        f"Score {thesis['score_ppm']} ppm. Confidence {thesis['confidence_ppm']} ppm. Horizon {thesis['horizon_ms']} ms.",
        f"Pair venue {pair.get('dex') or 'unknown'}.",
        "",
        "## Observed",
    ]
    for key, value in thesis["observed"].items():
        lines.append(f"- {key}: {json.dumps(value, sort_keys=True)}")
    lines.extend(["", "## Bull"])
    if thesis["bull_case"]:
        lines.extend(f"- {point['claim']} Evidence {json.dumps(point['evidence'], sort_keys=True)}." for point in thesis["bull_case"])
    else:
        lines.append("- No bull point was supported by the observed fields.")
    lines.extend(["", "## Bear"])
    if thesis["bear_case"]:
        lines.extend(f"- {point['claim']} Evidence {json.dumps(point['evidence'], sort_keys=True)}." for point in thesis["bear_case"])
    else:
        lines.append("- No bear point was supported by the observed fields.")
    lines.extend(["", "## Brains"])
    for name, brain in thesis["brains"].items():
        lines.append(f"- {name}: {json.dumps(brain, sort_keys=True)}")
    lines.extend(["", "## Risks"])
    for flag in thesis["risk_flags"]:
        lines.append(f"- {flag['flag']} {flag['status']}: {json.dumps({k: v for k, v in flag.items() if k not in ('flag', 'status')}, sort_keys=True)}")
    proposal = thesis["proposal"]
    lines.extend([
        "",
        "## Proposal",
        f"Entry {json.dumps(proposal['entry_price_usd'])}. Stop {json.dumps(proposal['stop_price_usd'])}. Take profit {json.dumps(proposal['take_profit_price_usd'])}.",
        "This is a paper proposal, not an order.",
    ])
    return "\n".join(lines) + "\n"


def _brain_view(signal: dict) -> dict:
    brains = signal.get("brains") if type(signal.get("brains")) is dict else {}
    view = {}
    for name, brain in brains.items():
        if type(brain) is not dict:
            continue
        view[name] = {
            "paper_long_support_ppm": brain.get("paper_long_support_ppm"),
            "detail": brain.get("detail") or brain.get("reason"),
            "executed": brain.get("executed"),
            "council_member": brain.get("council_member", True),
            "role": brain.get("role"),
            "shadow": brain.get("shadow"),
            "primary": brain.get("primary"),
            "in_vote": brain.get("in_vote", True),
            "network_forward_pass": brain.get("network_forward_pass"),
        }
    for name, brain in (signal.get("shadow") or {}).items():
        if type(brain) is not dict:
            continue
        view[name] = {
            "paper_long_support_ppm": brain.get("paper_long_support_ppm"),
            "detail": brain.get("detail") or brain.get("reason"),
            "council_member": False,
            "role": "SHADOW",
            "shadow": True,
            "in_vote": False,
        }
    return view


def validate_thesis(thesis: dict) -> dict:
    if type(thesis) is not dict or any(key not in thesis for key in REQUIRED):
        raise ThesisError("THESIS_SCHEMA")
    if thesis["protocol"] != "AAI_GIANT_BRAIN_THESIS_V1" or thesis["action"] != "NO_EXECUTION" or thesis["execution_allowed"] is not False or thesis["mode"] != "PAPER":
        raise ThesisError("THESIS_SCHEMA")
    if type(thesis["score_ppm"]) is not int or type(thesis["threshold_ppm"]) is not int or thesis["score_ppm"] < thesis["threshold_ppm"]:
        raise ThesisError("THESIS_SCHEMA")
    if type(thesis["bull_case"]) is not list or type(thesis["bear_case"]) is not list or type(thesis["risk_flags"]) is not list:
        raise ThesisError("THESIS_SCHEMA")
    flags = {item.get("flag") for item in thesis["risk_flags"]}
    if flags != {"LIQUIDITY", "HOLDER_CONCENTRATION", "PAIR_AGE", "VOLUME_ANOMALY"}:
        raise ThesisError("THESIS_SCHEMA")
    proposal = thesis["proposal"]
    if type(proposal) is not dict or proposal.get("not_an_order") is not True or _num(proposal.get("entry_price_usd")) is None:
        raise ThesisError("THESIS_SCHEMA")
    if not numbers_allowed(thesis["markdown"], thesis):
        raise ThesisError("UNSOURCED_NUMBER")
    if thesis.get("narrative") and not numbers_allowed(thesis["narrative"], thesis):
        raise ThesisError("UNSOURCED_NUMBER")
    return thesis


def write_thesis(signal: dict, record: dict, *, now_ms: int, threshold_ppm: int = 600_000, horizon_ms: int = 300_000, narrative: str | None = None) -> dict | None:
    if type(signal) is not dict or type(record) is not dict or type(now_ms) is not int or type(threshold_ppm) is not int:
        raise ThesisError("THESIS_INPUT")
    score = signal.get("fused_score_ppm")
    if type(score) is not int or score < threshold_ppm:
        return None
    price = _num(record.get("price_usd", record.get("price_quote_per_base")))
    if price is None or price <= 0:
        raise ThesisError("NO_PRICE")
    created = record.get("pair_created_at_ms")
    age = None if type(created) is not int else now_ms - created
    observed = {
        "price_usd": price,
        "liquidity_usd": _num(record.get("liquidity_usd")),
        "volume_h1": _num(record.get("volume_h1")),
        "price_change_h1": _num(record.get("price_change_h1")),
        "buys_h1": _num(record.get("buys_h1", record.get("buy_quote_atoms"))),
        "sells_h1": _num(record.get("sells_h1", record.get("sell_quote_atoms"))),
        "pair_age_ms": age,
    }
    holder_flag, holder_summary = thesis_parts(record.get("holder_concentration"), now_ms)
    observed["holder_concentration"] = holder_summary
    bull, bear = _points(observed)
    if holder_flag["status"] in ("CLEAR", "RAISED") and type(holder_summary) is dict:
        evidence = {
            "compared_share_ppm": holder_summary["compared_share_ppm"],
            "rule_top10_share_ppm": holder_flag["rule_top10_share_ppm"],
        }
        point = {
            "claim": "Top-10 holder share is under the concentration rule." if holder_flag["status"] == "CLEAR" else "Top-10 holder share meets the concentration rule.",
            "evidence": evidence,
        }
        (bull if holder_flag["status"] == "CLEAR" else bear).append(point)
    provenance = {
        "observation_sha256": (signal.get("provenance") or {}).get("observation_sha256"),
        "source": record.get("source"),
        "fetched_at": record.get("fetched_at") or record.get("ts"),
        "pair_address": record.get("pair_address") or record.get("pool"),
        "dex": record.get("dex"),
    }
    if type(record.get("holder_concentration")) is dict:
        provenance["holder_endpoint"] = holder_flag.get("endpoint")
        provenance["holder_fetched_at_ms"] = holder_flag.get("fetched_at_ms")
        provenance["holder_supply_slot"] = holder_flag.get("supply_slot")
        provenance["holder_largest_slot"] = holder_flag.get("largest_slot")
    body = {
        "protocol": "AAI_GIANT_BRAIN_THESIS_V1",
        "mint": record.get("token_address") or record.get("mint") or signal.get("mint"),
        "symbol": record.get("symbol"),
        "pair": {
            "pair_address": provenance["pair_address"],
            "dex": provenance["dex"],
            "quote": "USD",
        },
        "score_ppm": score,
        "threshold_ppm": threshold_ppm,
        "bull_case": _case("bull", bull),
        "bear_case": _case("bear", bear),
        "brains": _brain_view(signal),
        "risk_flags": _flags(observed, holder_flag),
        "proposal": _proposal(price, observed["price_change_h1"]),
        "horizon_ms": horizon_ms,
        "confidence_ppm": signal.get("confidence_ppm") if type(signal.get("confidence_ppm")) is int else 0,
        "provenance": provenance,
        "observed": observed,
        "mode": "PAPER",
        "action": "NO_EXECUTION",
        "execution_allowed": False,
        "live_orders": False,
    }
    identity = {key: body[key] for key in ("mint", "pair", "score_ppm", "observed", "provenance", "horizon_ms")}
    body["thesis_id"] = hashlib.sha256(json.dumps(identity, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()
    body["markdown"] = ""
    body["narrative_source"] = "DETERMINISTIC_FIELDS"
    body["markdown"] = _markdown(body)
    if narrative is None:
        narrative = narrative_from_env(body)
    if narrative:
        if numbers_allowed(narrative, body):
            body["narrative"] = narrative
            body["narrative_source"] = "MODEL_PHRASING_NUMBERS_CHECKED"
        else:
            body["narrative"] = body["markdown"]
            body["narrative_source"] = "NARRATIVE_REJECTED_UNSOURCED_NUMBER"
    else:
        body["narrative"] = body["markdown"]
    return validate_thesis(body)


def narrative_from_env(thesis: dict) -> str | None:
    """Phrase with the repo's model provider only when a key is configured.

    The returned text is still checked by write_thesis. No key means no call.
    """
    if not os.environ.get("ZOORA_MODEL_API_KEY") or not os.environ.get("ZOORA_MODEL_PROVIDER") or not os.environ.get("ZOORA_MODEL_NAME"):
        return None
    try:
        from zoora_platform.providers import ModelProvider
    except ImportError:
        return None
    try:
        result = ModelProvider().generate(
            "Rewrite this thesis in plain sentences. Use only numbers that already appear in the JSON. Do not add prices, percentages, or counts.\n"
            + json.dumps({key: thesis[key] for key in ("symbol", "observed", "bull_case", "bear_case", "proposal")}, sort_keys=True)
        )
    except Exception:
        return None
    text = result.get("text") if type(result) is dict else None
    return text if type(text) is str else None


def write_files(directory: Path, thesis: dict) -> tuple[Path, Path]:
    validate_thesis(thesis)
    directory.mkdir(parents=True, exist_ok=True)
    json_path = directory / (thesis["thesis_id"] + ".json")
    markdown_path = directory / (thesis["thesis_id"] + ".md")
    json_path.write_text(json.dumps(thesis, sort_keys=True) + "\n", encoding="utf-8")
    markdown_path.write_text(thesis["markdown"], encoding="utf-8")
    return json_path, markdown_path
