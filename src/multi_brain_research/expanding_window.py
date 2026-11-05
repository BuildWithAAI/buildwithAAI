"""Expanding-window paper walk-forward.

Each fold refits the FlyVis readout and refills crow memory from rows whose
outcome window ended before the fold starts, then scores only that fold.
The last fold is the holdout. Horizon and the primary-vote gate are chosen
on the earlier folds. The holdout is not an input to that choice.

No order is built, signed, or sent.
"""
from __future__ import annotations

import sys
from pathlib import Path

from .crow_brain import remember
from .flyvis_market import decisions_from_series, fit_on_rows, load_artifact, score_rows
from .paper_trader import LADDER_HORIZON_MS
from .snapshot_feed import parse_time_ms, resolve_root
from .walk_forward import _book, _iso, _stamped, collect_memory_rows, load_series

FOLD_MS = 4 * 60 * 60 * 1000
MIN_TRAIN_MS = 4 * 60 * 60 * 1000
HOLDOUT_MS = 4 * 60 * 60 * 1000
HORIZONS_MS = (300_000, 3_600_000)
DEFAULT_HORIZON_MS = 300_000
DEFAULT_PRIMARY_VOTE = True
PREVIOUS_WINDOW_START = "2026-11-05T04:00:00+00:00"
PREVIOUS_CUTOFF = "snapshots/2026-11-05/0800.jsonl"
SELECTION_RULE = (
    "On train folds only, among configs with at least one closed trade, "
    "pick the highest pnl after modeled costs. Ties prefer more closes, "
    "then the primary-vote gate on, then the shorter horizon. "
    "The holdout fold is not an input. A policy with no closed train trade "
    "keeps horizon 300000 ms and the primary-vote gate on."
)


def _log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def plan_folds(stamped: list[dict], *, fold_ms: int = FOLD_MS, min_train_ms: int = MIN_TRAIN_MS, holdout_ms: int = HOLDOUT_MS, embargo_ms: int = max(HORIZONS_MS)) -> list[dict]:
    """Clock folds. The last non-empty stretch of `holdout_ms` is the holdout.

    A train fold opens only inside its own window. The last train fold also
    stops opening `embargo_ms` before the holdout, so a candidate horizon can
    finish on prices the holdout does not own. Marks for train folds stop at
    the holdout. An empty stretch is skipped.
    """
    if type(fold_ms) is not int or type(min_train_ms) is not int or type(holdout_ms) is not int or type(embargo_ms) is not int:
        raise ValueError("BAD_WINDOW")
    if fold_ms < 1 or min_train_ms < 1 or holdout_ms < 1 or embargo_ms < 0 or len(stamped) < 2:
        raise ValueError("NEED_FOLDS")
    first = stamped[0]["ms"]
    last = stamped[-1]["ms"]
    if last - first <= min_train_ms + holdout_ms:
        raise ValueError("NEED_FOLDS")
    holdout_line = last - holdout_ms
    holdout_start = next(item["ms"] for item in stamped if item["ms"] >= holdout_line)
    if holdout_start <= first + min_train_ms:
        raise ValueError("NEED_FOLDS")
    folds = []
    cursor = first + min_train_ms
    while True:
        start_item = next((item for item in stamped if item["ms"] >= cursor), None)
        if start_item is None or start_item["ms"] >= holdout_start:
            break
        end_ms = min(start_item["ms"] + fold_ms, holdout_start)
        window = [item for item in stamped if start_item["ms"] <= item["ms"] < end_ms]
        if not window:
            cursor = end_ms
            continue
        folds.append({
            "index": len(folds),
            "role": "train",
            "start_ms": window[0]["ms"],
            "start_ts": window[0]["ts"],
            "end_ms": end_ms,
            "first_file": window[0]["file"],
            "last_file": window[-1]["file"],
            "files": len(window),
            "open_not_after_ms": end_ms,
            "mark_until_ms": holdout_start,
            "embargo_ms": 0,
        })
        if end_ms <= window[0]["ms"]:
            raise RuntimeError("FOLD_STUCK")
        cursor = end_ms
    if not folds:
        raise ValueError("NEED_FOLDS")
    embargo_at = holdout_start - embargo_ms
    last_train = folds[-1]
    last_train["open_not_after_ms"] = min(last_train["open_not_after_ms"], embargo_at)
    last_train["embargo_ms"] = embargo_ms
    holdout_window = [item for item in stamped if item["ms"] >= holdout_start]
    if not holdout_window:
        raise ValueError("NEED_HOLDOUT")
    folds.append({
        "index": len(folds),
        "role": "holdout",
        "start_ms": holdout_window[0]["ms"],
        "start_ts": holdout_window[0]["ts"],
        "end_ms": holdout_window[-1]["ms"] + 1,
        "first_file": holdout_window[0]["file"],
        "last_file": holdout_window[-1]["file"],
        "files": len(holdout_window),
        "open_not_after_ms": holdout_window[-1]["ms"] + 1,
        "mark_until_ms": None,
        "embargo_ms": 0,
    })
    return folds


def config_id(cfg: dict) -> str:
    gate = "on" if cfg["require_primary_vote"] else "off"
    return f"{cfg['exit_policy']}|horizon_ms={cfg['horizon_ms']}|primary={gate}"


def candidate_configs(horizons_ms: tuple[int, ...]) -> list[dict]:
    configs = []
    for horizon in horizons_ms:
        if type(horizon) is not int or horizon < 1:
            raise ValueError("HORIZON")
        for gate in (True, False):
            configs.append({
                "exit_policy": "single_target",
                "horizon_ms": horizon,
                "require_primary_vote": gate,
            })
    for gate in (True, False):
        configs.append({
            "exit_policy": "ladder_e",
            "horizon_ms": LADDER_HORIZON_MS,
            "require_primary_vote": gate,
        })
    return configs


def choose_config(candidates: list[dict], *, default_horizon: int) -> dict:
    """Pick from train-fold aggregates. Callers must not pass the holdout."""
    eligible = [
        row for row in candidates
        if row.get("closed", 0) > 0 and type(row.get("pnl_after_costs")) in (int, float) and not isinstance(row.get("pnl_after_costs"), bool)
    ]
    if not eligible:
        return {
            "id": None,
            "horizon_ms": default_horizon,
            "require_primary_vote": DEFAULT_PRIMARY_VOTE,
            "exit_policy": candidates[0]["exit_policy"] if candidates else None,
            "closed": 0,
            "pnl_after_costs": None,
            "reason": "NO_CLOSED_TRAIN_TRADES",
            "selected_on": "train_folds",
        }

    def rank(row: dict):
        return (
            row["pnl_after_costs"],
            row["closed"],
            1 if row["require_primary_vote"] else 0,
            -row["horizon_ms"],
        )

    best = max(eligible, key=rank)
    return {
        "id": best.get("id"),
        "exit_policy": best["exit_policy"],
        "horizon_ms": best["horizon_ms"],
        "require_primary_vote": best["require_primary_vote"],
        "closed": best["closed"],
        "pnl_after_costs": best["pnl_after_costs"],
        "reason": "MAX_TRAIN_PNL_AFTER_COSTS",
        "selected_on": "train_folds",
    }


def _number(value) -> bool:
    return type(value) in (int, float) and not isinstance(value, bool)


def aggregate_books(books: list[dict]) -> dict:
    trades = []
    for book in books:
        trades.extend(book.get("trades") or [])
    costs = [trade["pnl_after_costs_usd"] for trade in trades if _number(trade.get("pnl_after_costs_usd"))]
    raw = [trade["pnl_usd"] for trade in trades if _number(trade.get("pnl_usd"))]
    wins = [value for value in costs if value > 0]
    losses = [value for value in costs if value < 0]
    raw_wins = [value for value in raw if value > 0]
    return {
        "folds": len(books),
        "theses": sum(book.get("theses") or 0 for book in books),
        "opened": sum(book.get("opened") or 0 for book in books),
        "closed": sum(book.get("closed") or 0 for book in books),
        "still_open": sum(book.get("open") or 0 for book in books),
        "entry_skipped": sum(book.get("entry_skipped") or 0 for book in books),
        "vanished": sum(book.get("vanished") or 0 for book in books),
        "priced_closes": len(raw),
        "win_rate": None if not raw else len(raw_wins) / len(raw),
        "win_rate_after_costs": None if not costs else len(wins) / len(costs),
        "pnl_before_fees": None if not raw else sum(raw),
        "pnl_after_costs": None if not costs else sum(costs),
        "avg_win": None if not wins else sum(wins) / len(wins),
        "avg_loss": None if not losses else sum(losses) / len(losses),
        "profit_factor": 0.0 if losses and not wins else (None if not losses else sum(wins) / abs(sum(losses))),
        "execution_allowed": False,
        "live_orders": False,
    }


def _pool_readout(parts: list[dict]) -> dict:
    used = [part for part in parts if part and part.get("n")]
    count = sum(part["n"] for part in used)
    if count == 0:
        return {
            "n": 0,
            "correct": 0,
            "positives": 0,
            "accuracy": None,
            "majority_class_accuracy": None,
            "beats_majority_class": None,
            "up_calls": 0,
            "log_loss": None,
            "ppm_min": None,
            "ppm_max": None,
        }
    correct = sum(part["correct"] for part in used)
    positives = sum(part["positives"] for part in used)
    accuracy = correct / count
    majority = max(positives, count - positives) / count
    weighed = [part for part in used if _number(part.get("log_loss"))]
    loss = None if not weighed else sum(part["log_loss"] * part["n"] for part in weighed) / sum(part["n"] for part in weighed)
    lows = [part["ppm_min"] for part in used if part.get("ppm_min") is not None]
    highs = [part["ppm_max"] for part in used if part.get("ppm_max") is not None]
    return {
        "n": count,
        "correct": correct,
        "positives": positives,
        "accuracy": accuracy,
        "majority_class_accuracy": majority,
        "beats_majority_class": accuracy > majority,
        "up_calls": sum(part.get("up_calls") or 0 for part in used),
        "log_loss": loss,
        "ppm_min": None if not lows else min(lows),
        "ppm_max": None if not highs else max(highs),
    }


def _statement(pooled: dict) -> str:
    if not pooled.get("n"):
        return "The refit readout had no out-of-sample decisions."
    if pooled.get("beats_majority_class") is True:
        return "The refit readout beats the majority class out of sample."
    return "The refit readout does not beat the majority class out of sample."


def _write_memory(path: Path, rows: list[dict]) -> None:
    if path.exists():
        path.unlink()
    path.parent.mkdir(parents=True, exist_ok=True)
    for record in rows:
        remember(path, record)
    if not rows:
        path.write_text("", encoding="utf-8")


def _train_rows(decisions: list[dict], before_ms: int) -> list[dict]:
    rows = [
        row for row in decisions
        if type(row.get("outcome_end_ms")) is int and type(row.get("ts_ms")) is int and row["outcome_end_ms"] < before_ms
    ]
    if any(row["outcome_end_ms"] >= before_ms for row in rows):
        raise RuntimeError("FOLD_LEAKED")
    return rows


def _oos_rows(decisions: list[dict], fold: dict) -> list[dict]:
    label_until = fold["end_ms"] if fold["mark_until_ms"] is None else fold["mark_until_ms"]
    rows = []
    for row in decisions:
        if type(row.get("ts_ms")) is not int or type(row.get("outcome_end_ms")) is not int:
            continue
        if row["ts_ms"] < fold["start_ms"] or row["ts_ms"] >= fold["end_ms"]:
            continue
        if row["outcome_end_ms"] < fold["start_ms"] or row["outcome_end_ms"] >= label_until:
            continue
        rows.append(row)
    return rows


def _readout_block(train: list[dict], oos: list[dict], frozen) -> dict:
    fitted = fit_on_rows(train)
    if oos and fitted["train_outcome_end_max_ms"] >= min(row["ts_ms"] for row in oos):
        raise RuntimeError("FOLD_LEAKED")
    refit = score_rows(oos, fitted["weights"], fitted["bias"])
    frozen_score = None
    if frozen is not None and len(frozen.get("weights") or []) == len(fitted["weights"]):
        frozen_score = score_rows(oos, frozen["weights"], frozen["bias"])
    return {
        "train_rows": fitted["train_rows"],
        "train_end_ts": fitted["train_end_ts"],
        "train_outcome_end_max_ms": fitted["train_outcome_end_max_ms"],
        "readout_sha256": fitted["readout_sha256"],
        "weights": fitted["weights"],
        "bias": fitted["bias"],
        "jupiter_features": fitted.get("jupiter_features") is True,
        "network_forward_pass": False,
        "oos": refit,
        "frozen_artifact_oos": frozen_score,
        "execution_allowed": False,
    }


def _book_summary(book: dict) -> dict:
    """Drop nothing the ledger needs. Thesis files are not part of this dict."""
    return book


def _fit_and_score_book(root, work, series, fold, cfg, *, fitted, memory, cutoff_file, limit, threshold_ppm, use_holder_reads, candle_dir, score_cache, use_jupiter_reads: bool = True, use_jupiter_veto: bool = False):
    dest = work / config_id(cfg).replace("|", "__")
    book = _book(
        root, dest, series, memory=memory, not_before_ms=fold["start_ms"],
        limit=limit, threshold_ppm=threshold_ppm, candle_dir=candle_dir,
        exit_policy=cfg["exit_policy"], retain_universe=True, cutoff_file=cutoff_file,
        not_after_ms=fold["mark_until_ms"], require_primary_vote=cfg["require_primary_vote"],
        horizon_ms=cfg["horizon_ms"], open_not_after_ms=fold["open_not_after_ms"],
        readout=fitted, score_cache=score_cache, use_holder_reads=use_holder_reads,
        use_jupiter_reads=use_jupiter_reads, use_jupiter_veto=use_jupiter_veto,
    )
    theses = dest / "theses"
    if theses.exists():
        for path in theses.glob("*"):
            if path.is_file():
                path.unlink()
    opened_late = [
        trade for trade in book["trades"]
        if type(trade.get("opened_ms")) is int and trade["opened_ms"] >= fold["open_not_after_ms"]
    ]
    if opened_late:
        raise RuntimeError("FOLD_OPENED_LATE")
    return book


def expanding_walk_forward(root: Path, work: Path, *, limit: int = 25, threshold_ppm: int = 600_000, candle_dir: Path | None = None, cutoff_file: str | None = None, use_holder_reads: bool = True, fold_ms: int = FOLD_MS, min_train_ms: int = MIN_TRAIN_MS, holdout_ms: int = HOLDOUT_MS, horizons_ms: tuple[int, ...] = HORIZONS_MS, use_jupiter_readout: bool = False, use_jupiter_veto: bool = False) -> dict:
    """Refit before every fold and score that fold out of sample."""
    root = resolve_root(root)
    work.mkdir(parents=True, exist_ok=True)
    embargo_ms = max(horizons_ms)
    stamped = _stamped(root, cutoff_file, None)
    if not stamped:
        raise ValueError("NO_SNAPSHOTS")
    frozen_name = stamped[-1]["file"]
    folds = plan_folds(stamped, fold_ms=fold_ms, min_train_ms=min_train_ms, holdout_ms=holdout_ms, embargo_ms=embargo_ms)
    _log(f"snapshots {len(stamped)} {stamped[0]['file']} -> {frozen_name}")
    for fold in folds:
        _log(f"fold {fold['index']} {fold['role']} {fold['start_ts']} files {fold['files']}")
    series = load_series(root, [item["file"] for item in stamped])
    _log("decisions")
    jupiter_reads = None
    if use_jupiter_readout:
        from .jupiter_capture import load_jupiter_reads
        jupiter_reads = load_jupiter_reads(root)
    decisions = decisions_from_series(series, jupiter_reads)
    for row in decisions:
        row.pop("trace", None)
    _log(f"decisions {len(decisions)}")
    memory_rows = collect_memory_rows(root, stamped)
    _log(f"memory rows {len(memory_rows)}")
    frozen = load_artifact()
    configs = candidate_configs(tuple(horizons_ms))
    fold_reports = []
    for fold in folds:
        _log(f"score fold {fold['index']} {fold['role']}")
        train = _train_rows(decisions, fold["start_ms"])
        oos = _oos_rows(decisions, fold)
        if any(row["outcome_end_ms"] >= fold["start_ms"] for row in train):
            raise RuntimeError("FOLD_LEAKED")
        if any(row["ts_ms"] < fold["start_ms"] for row in oos):
            raise RuntimeError("FOLD_LEAKED")
        readout = _readout_block(train, oos, frozen)
        if readout["train_outcome_end_max_ms"] >= fold["start_ms"]:
            raise RuntimeError("FOLD_LEAKED")
        eligible_memory = [row for row in memory_rows if row["outcome_end_ms"] < fold["start_ms"]]
        memory_end = None if not eligible_memory else max(row["outcome_end_ms"] for row in eligible_memory)
        if memory_end is not None and memory_end >= fold["start_ms"]:
            raise RuntimeError("FOLD_LEAKED")
        fold_dir = work / f"fold-{fold['index']:02d}"
        memory_path = fold_dir / "crow.jsonl"
        _write_memory(memory_path, eligible_memory)
        cache: dict = {}
        books = {}
        voting = {
            "protocol": "AAI_FLYVIS_MARKET_READOUT_V1",
            "weights": readout["weights"],
            "bias": readout["bias"],
            "readout_sha256": readout["readout_sha256"],
            "network_forward_pass": False,
            "jupiter_features": readout.get("jupiter_features") is True,
        }
        for cfg in configs:
            _log(f"  {config_id(cfg)}")
            book = _fit_and_score_book(
                root, fold_dir, series, fold, cfg,
                fitted=voting, memory=memory_path, cutoff_file=frozen_name, limit=limit,
                threshold_ppm=threshold_ppm, use_holder_reads=use_holder_reads,
                candle_dir=candle_dir, score_cache=cache,
                use_jupiter_reads=True, use_jupiter_veto=use_jupiter_veto,
            )
            books[config_id(cfg)] = _book_summary(book)
        fold_reports.append({
            **{key: fold[key] for key in (
                "index", "role", "start_ms", "start_ts", "end_ms", "first_file", "last_file",
                "files", "open_not_after_ms", "mark_until_ms", "embargo_ms",
            )},
            "memory_rows": len(eligible_memory),
            "memory_outcome_end_max_ms": memory_end,
            "memory_outcome_end_max_ts": None if memory_end is None else _iso(memory_end),
            "readout": readout,
            "books": books,
            "execution_allowed": False,
            "live_orders": False,
        })
    by_config = {}
    for cfg in configs:
        key = config_id(cfg)
        train_books = [fold["books"][key] for fold in fold_reports if fold["role"] == "train"]
        holdout_books = [fold["books"][key] for fold in fold_reports if fold["role"] == "holdout"]
        by_config[key] = {
            **cfg,
            "id": key,
            "train": aggregate_books(train_books),
            "holdout": aggregate_books(holdout_books),
            "all_folds": aggregate_books(train_books + holdout_books),
        }
    selection = {}
    for policy, default_horizon in (("single_target", DEFAULT_HORIZON_MS), ("ladder_e", LADDER_HORIZON_MS)):
        inputs = []
        for key, block in by_config.items():
            if block["exit_policy"] != policy:
                continue
            inputs.append({
                "id": key,
                "role": "train",
                "exit_policy": policy,
                "horizon_ms": block["horizon_ms"],
                "require_primary_vote": block["require_primary_vote"],
                "closed": block["train"]["closed"],
                "pnl_after_costs": block["train"]["pnl_after_costs"],
            })
        chosen = choose_config(inputs, default_horizon=default_horizon)
        if chosen["id"] is None:
            matched = [
                key for key, block in by_config.items()
                if block["exit_policy"] == policy and block["horizon_ms"] == chosen["horizon_ms"] and block["require_primary_vote"] == chosen["require_primary_vote"]
            ]
            chosen["id"] = matched[0] if matched else None
        selection[policy] = {"inputs": inputs, "chosen": chosen}
    oos_parts = [fold["readout"]["oos"] for fold in fold_reports]
    train_parts = [fold["readout"]["oos"] for fold in fold_reports if fold["role"] == "train"]
    holdout_parts = [fold["readout"]["oos"] for fold in fold_reports if fold["role"] == "holdout"]
    pooled = _pool_readout(oos_parts)
    frozen_parts = [fold["readout"]["frozen_artifact_oos"] for fold in fold_reports]
    previous = _previous_window(
        root, work / "previous-window", stamped, series, decisions, memory_rows,
        limit=limit, threshold_ppm=threshold_ppm,
        use_holder_reads=use_holder_reads, candle_dir=candle_dir, selection=selection,
    )
    chosen_single = selection["single_target"]["chosen"]["id"]
    chosen_ladder = selection["ladder_e"]["chosen"]["id"]
    return {
        "protocol": "AAI_GIANT_BRAIN_EXPANDING_WINDOW_V1",
        "mode": "PAPER",
        "action": "NO_EXECUTION",
        "execution_allowed": False,
        "live_orders": False,
        "selection_rule": SELECTION_RULE,
        "threshold_ppm": threshold_ppm,
        "limit": limit,
        "retain_universe": True,
        "entry_floor": True,
        "entry_veto": False,
        "jupiter_readout": use_jupiter_readout,
        "jupiter_veto": use_jupiter_veto,
        "use_holder_reads": use_holder_reads,
        "candle_dir": None if candle_dir is None else str(candle_dir),
        "fold_ms": fold_ms,
        "min_train_ms": min_train_ms,
        "holdout_ms": holdout_ms,
        "embargo_ms": embargo_ms,
        "horizons_ms": list(horizons_ms),
        "ladder_horizon_ms": LADDER_HORIZON_MS,
        "cost_model": "single_target restates pnl with a 1% fee and 0.5% slippage per side; ladder_e applies that fee and slippage in the fill",
        "voters": {
            "flyvis": "refit on decisions whose outcome_end_ms is before the fold start",
            "crow": "refilled from rows whose outcome_end_ms is before the fold start",
            "frozen_artifact_used_for_paper_votes": False,
            "frozen_artifact_sha256": None if frozen is None else frozen.get("readout_sha256"),
            "holder_reads": "joined at the decision when read_ts_ms is at or before it; not a readout label",
            "pool_trades": "joined at the decision when read_ts_ms is at or before it; the entry veto stays off",
            "jupiter_tokens": "joined when read_ts_ms is at or before the decision; the readout suffix and the Jupiter veto stay off unless this run turned them on",
        },
        "snapshot_files": len(stamped),
        "first_file": stamped[0]["file"],
        "first_ts": stamped[0]["ts"],
        "last_file": frozen_name,
        "last_ts": stamped[-1]["ts"],
        "cutoff_file": frozen_name,
        "decision_rows": len(decisions),
        "memory_rows_all": len(memory_rows),
        "folds": fold_reports,
        "configs": by_config,
        "selection": selection,
        "readout_oos": {
            "statement": _statement(pooled),
            "all_folds": pooled,
            "train_folds": _pool_readout(train_parts),
            "holdout": _pool_readout(holdout_parts),
            "frozen_artifact_all_folds": _pool_readout([part for part in frozen_parts if part]),
        },
        "headline": {
            "readout_statement": _statement(pooled),
            "readout_oos": pooled,
            "readout_holdout": _pool_readout(holdout_parts),
            "single_target": None if chosen_single is None else {
                "id": chosen_single,
                "train": by_config[chosen_single]["train"],
                "holdout": by_config[chosen_single]["holdout"],
                "all_folds": by_config[chosen_single]["all_folds"],
            },
            "ladder_e": None if chosen_ladder is None else {
                "id": chosen_ladder,
                "train": by_config[chosen_ladder]["train"],
                "holdout": by_config[chosen_ladder]["holdout"],
                "all_folds": by_config[chosen_ladder]["all_folds"],
            },
            "single_target_horizon_300000_primary_on": by_config.get("single_target|horizon_ms=300000|primary=on"),
            "single_target_horizon_3600000_primary_on": by_config.get("single_target|horizon_ms=3600000|primary=on"),
        },
        "previous_gated_window": previous,
    }


def _previous_window(root, work, stamped, series, decisions, memory_rows, *, limit, threshold_ppm, use_holder_reads, candle_dir, selection) -> dict | None:
    """Rescore the 04:00–08:00 UTC clock with voters fit only before 04:00.

    This is a comparison with the earlier gated holdout. It is not a selection input.
    """
    names = [item["file"] for item in stamped]
    plain = [name[:-3] if name.endswith(".gz") else name for name in names]
    if PREVIOUS_CUTOFF not in names and PREVIOUS_CUTOFF not in plain:
        return None
    start_ms = parse_time_ms(PREVIOUS_WINDOW_START)
    if stamped[0]["ms"] >= start_ms or stamped[-1]["ms"] < start_ms:
        return None
    train = _train_rows(decisions, start_ms)
    if len(train) < 4 or max(row["outcome_end_ms"] for row in train) >= start_ms:
        raise RuntimeError("FOLD_LEAKED")
    fitted = fit_on_rows(train)
    if fitted["train_outcome_end_max_ms"] >= start_ms:
        raise RuntimeError("FOLD_LEAKED")
    eligible = [row for row in memory_rows if row["outcome_end_ms"] < start_ms]
    if eligible and max(row["outcome_end_ms"] for row in eligible) >= start_ms:
        raise RuntimeError("FOLD_LEAKED")
    memory = work / "crow.jsonl"
    _write_memory(memory, eligible)
    historical = {
        "exit_policy": "single_target",
        "horizon_ms": DEFAULT_HORIZON_MS,
        "require_primary_vote": True,
    }
    wanted = [historical]
    chosen = selection["single_target"]["chosen"]
    if chosen.get("exit_policy") == "single_target" and type(chosen.get("horizon_ms")) is int:
        extra = {
            "exit_policy": "single_target",
            "horizon_ms": chosen["horizon_ms"],
            "require_primary_vote": bool(chosen["require_primary_vote"]),
        }
        if config_id(extra) != config_id(historical):
            wanted.append(extra)
    for gate in (True, False):
        ladder_cfg = {
            "exit_policy": "ladder_e",
            "horizon_ms": LADDER_HORIZON_MS,
            "require_primary_vote": gate,
        }
        if selection["ladder_e"]["chosen"].get("require_primary_vote") is gate or gate is True:
            wanted.append(ladder_cfg)
    books = {}
    cache: dict = {}
    fold = {
        "start_ms": start_ms,
        "open_not_after_ms": None,
        "mark_until_ms": None,
    }
    # open_not_after None would be rejected by the fold helper. Score through _book directly.
    del fold
    for cfg in wanted:
        _log(f"previous window {config_id(cfg)}")
        dest = work / config_id(cfg).replace("|", "__")
        book = _book(
            root, dest, series, memory=memory, not_before_ms=start_ms,
            limit=limit, threshold_ppm=threshold_ppm, candle_dir=candle_dir,
            exit_policy=cfg["exit_policy"], retain_universe=True, cutoff_file=PREVIOUS_CUTOFF,
            not_after_ms=None, require_primary_vote=cfg["require_primary_vote"],
            horizon_ms=cfg["horizon_ms"], open_not_after_ms=None,
            readout=fitted, score_cache=cache, use_holder_reads=use_holder_reads,
        )
        books[config_id(cfg)] = book
    return {
        "note": "Same clock as the gated holdout from 2026-11-05T04:00:00Z through snapshots/2026-11-05/0800.jsonl. Voters use only outcomes that ended before that open. Not used to choose the horizon or the gate.",
        "open_not_before_ts": PREVIOUS_WINDOW_START,
        "cutoff_file": PREVIOUS_CUTOFF,
        "memory_rows": len(eligible),
        "memory_outcome_end_max_ms": None if not eligible else max(row["outcome_end_ms"] for row in eligible),
        "readout_train_rows": fitted["train_rows"],
        "readout_train_outcome_end_max_ms": fitted["train_outcome_end_max_ms"],
        "readout_sha256": fitted["readout_sha256"],
        "selected_on": "not_used",
        "books": books,
        "execution_allowed": False,
        "live_orders": False,
    }
