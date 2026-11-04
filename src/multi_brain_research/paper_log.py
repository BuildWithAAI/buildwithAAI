"""Paper-trading log. Records hypothetical outcomes. Sends nothing."""
from __future__ import annotations

import json
from pathlib import Path

_FORBIDDEN = {"private_key", "seed_phrase", "sendTransaction", "wallet_secret"}


def _forbidden(value) -> bool:
    if type(value) is dict:
        if _FORBIDDEN & set(value) or value.get("execution_allowed") is True:
            return True
        return any(_forbidden(item) for item in value.values())
    if type(value) is list:
        return any(_forbidden(item) for item in value)
    return False


def append(path: Path, record: dict) -> None:
    if type(record) is not dict or record.get("action") != "NO_EXECUTION" or _forbidden(record):
        raise ValueError("PAPER_ONLY")
    path.parent.mkdir(parents=True, exist_ok=True)
    line = {**record, "mode": "PAPER", "execution_allowed": False, "live_orders": False}
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(line, sort_keys=True) + "\n")


def summary(records: list) -> dict:
    """Hit rate, abstention, and pnl before fees. This is not a calibration."""
    if type(records) is not list:
        raise ValueError("PAPER_ONLY")
    abstained = longs = hits = priced = fees_applied = 0
    gross = net = 0.0
    for row in records:
        if (type(row) is not dict or row.get("action") not in (None, "NO_EXECUTION")
                or row.get("execution_allowed") is True or row.get("live_orders") is True or _forbidden(row)):
            raise ValueError("PAPER_ONLY")
        if row.get("coordinator_signal") == "ABSTAIN" or type(row.get("fused_score_ppm")) is not int:
            abstained += 1
        hypo = row.get("hypothetical")
        if type(hypo) is not dict:
            continue
        pnl = hypo.get("paper_pnl_per_unit")
        if type(pnl) is bool or type(pnl) not in (int, float):
            continue
        priced += 1
        gross += pnl
        after = hypo.get("paper_pnl_after_fee_per_unit")
        net += after if type(after) in (int, float) and type(after) is not bool else pnl
        if hypo.get("fees") == "APPLIED":
            fees_applied += 1
        if hypo.get("position") == "PAPER_LONG":
            longs += 1
            change = hypo.get("subsequent_return")
            if type(change) in (int, float) and type(change) is not bool and change > 0:
                hits += 1
    rows = len(records)
    return {
        "rows": rows,
        "abstained": abstained,
        "abstention_rate": None if rows == 0 else abstained / rows,
        "paper_longs": longs,
        "hits": hits,
        "hit_rate": None if longs == 0 else hits / longs,
        "priced_rows": priced,
        "pnl_before_fees": None if priced == 0 else gross,
        "fees": "NOT_APPLIED" if fees_applied == 0 else "APPLIED_WHERE_PRESENT",
        "fees_applied_rows": fees_applied,
        "pnl_after_observed_fees": None if priced == 0 or fees_applied == 0 else net,
        "calibrated": False,
        "mode": "PAPER",
        "action": "NO_EXECUTION",
        "execution_allowed": False,
        "live_orders": False,
    }
