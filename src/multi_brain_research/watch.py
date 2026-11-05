"""Score snapshot files and open paper positions from the theses that clear the bar.

The default scorer is the giant-brain fusion. A caller can pass another
function in tests. Live orders are not placed.
"""
from __future__ import annotations

import json
from pathlib import Path

from .paper_trader import (
    MAX_HOUR_DROP_PERCENT,
    MIN_LIQUIDITY_USD,
    MIN_MARKET_CAP_USD,
    PaperError,
    close_vanished,
    entry_skip_reasons,
    mark,
    open_position,
    skip_entry,
    state,
)
from .flow_capture import entry_veto_reasons, join_flow_read, load_flow_reads
from .jupiter_capture import join_jupiter_read, jupiter_veto_reasons, load_jupiter_reads
from .holder_capture import join_holder_read, load_holder_reads
from .holder_concentration import thesis_parts
from .snapshot_feed import (
    SnapshotError,
    canonical_pairs,
    files_through,
    load_snapshot,
    observation_from_pair,
    parse_time_ms,
    resolve_root,
    snapshot_files,
)
from .thesis import ThesisError, write_files, write_thesis


def _files(root: Path, cutoff_file: str | None = None) -> list[str]:
    return files_through(snapshot_files(root), cutoff_file)


def _positive_price(value):
    if type(value) is bool or type(value) not in (int, float) or not value > 0:
        return None
    return float(value)


def _crow_gate(signal, *, min_recalled_return, max_crow_distance) -> list[str]:
    """Refuse a paper open from the crow recall that is already on the signal.

    Both gates stay off when the caller passes None. A gate that is on and
    has no numeric recall is a refusal, not a guessed pass.
    """
    if min_recalled_return is None and max_crow_distance is None:
        return []
    crow = signal.get("brains", {}).get("crow") if type(signal) is dict else None
    if type(crow) is not dict:
        crow = {}
    reasons = []
    later = crow.get("recalled_return")
    distance = crow.get("distance")
    later_ok = type(later) in (int, float) and not isinstance(later, bool)
    distance_ok = type(distance) in (int, float) and not isinstance(distance, bool)
    if min_recalled_return is not None and (not later_ok or later < min_recalled_return):
        reasons.append("RECALLED_RETURN_BELOW_MIN" if later_ok else "CROW_RETURN_UNAVAILABLE")
    if max_crow_distance is not None and (not distance_ok or distance > max_crow_distance):
        reasons.append("CROW_DISTANCE_ABOVE_MAX" if distance_ok else "CROW_DISTANCE_UNAVAILABLE")
    return reasons


def _audit(path: Path | None, row: dict) -> None:
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, sort_keys=True) + "\n")


def _point(record: dict, stamp) -> dict:
    return {
        "price_usd": record.get("price_usd"),
        "buys_h1": record.get("buys_h1"),
        "sells_h1": record.get("sells_h1"),
        "liquidity_usd": record.get("liquidity_usd"),
        "ts": stamp,
    }


def _candles_for(candle_dir: Path | None, position: dict):
    if candle_dir is None or type(position.get("pair_address")) is not str:
        return None
    from .pool_ohlcv import load_jsonl
    path = candle_dir / (position["pair_address"] + ".jsonl")
    if not path.is_file():
        return None
    return load_jsonl(path)


def replay(root: Path, ledger: Path, theses_dir: Path, *, threshold_ppm: int = 600_000, limit: int = 25, score=None, not_before_ms: int | None = None, not_after_ms: int | None = None, cutoff_file: str | None = None, candle_dir: Path | None = None, exit_policy: str = "ladder_e", entry_floor: bool = True, gap_fill: bool = True, min_liquidity_usd: float = MIN_LIQUIDITY_USD, min_market_cap_usd: float = MIN_MARKET_CAP_USD, max_hour_drop_percent: float = MAX_HOUR_DROP_PERCENT, use_holder_reads: bool = True, use_entry_veto: bool = False, retain_universe: bool = False, min_recalled_return: float | None = None, max_crow_distance: float | None = None, require_primary_vote: bool = False, audit_path: Path | None = None, horizon_ms: int = 300_000, open_not_after_ms: int | None = None, use_jupiter_reads: bool = True, use_jupiter_veto: bool = False) -> dict:
    """Score snapshot pairs and mark paper exits.

    `retain_universe` keeps every mint that appears, including after it falls
    out of the volume ranking or leaves later files. An open position whose
    mint is absent is closed at the last positive print. A mint that never
    had one stays `NOT_OBSERVED` and does not get a made-up price. `limit`
    still ranks by `volume_h1` when the universe is not retained.
    """
    root = resolve_root(root)
    if min_recalled_return is not None and (type(min_recalled_return) is bool or type(min_recalled_return) not in (int, float)):
        raise ValueError("RECALLED_RETURN")
    if max_crow_distance is not None and (type(max_crow_distance) is bool or type(max_crow_distance) not in (int, float)):
        raise ValueError("CROW_DISTANCE")
    if not_after_ms is not None and type(not_after_ms) is not int:
        raise ValueError("INVALID_TIME")
    if type(horizon_ms) is not int or horizon_ms < 1:
        raise ValueError("HORIZON")
    if open_not_after_ms is not None and type(open_not_after_ms) is not int:
        raise ValueError("INVALID_TIME")
    holder_index = load_holder_reads(root) if use_holder_reads else {}
    flow_index = load_flow_reads(root)
    jupiter_index = load_jupiter_reads(root) if use_jupiter_reads else {}
    holder_joined = holder_clear = holder_raised = holder_not_observed = 0
    flow_joined = flow_available = flow_not_observed = 0
    jupiter_joined = jupiter_available = jupiter_not_observed = 0
    if score is None:
        from .giant_brain import fuse

        def score(observation, now_ms):
            return fuse(observation, now_ms=now_ms)

    opened = closed = skipped = entry_skipped = 0
    scored = abstained = vanished = not_observed_exits = 0
    skip_reasons: dict[str, int] = {}
    seen: dict[str, dict] = {}
    history: dict[str, list[dict]] = {}
    appeared: set[str] = set()
    priced_mints: set[str] = set()
    for relative in _files(root, cutoff_file):
        records = load_snapshot(root, relative)
        file_ms = None
        for record in records:
            stamp = record.get("ts") or record.get("fetched_at")
            if type(stamp) is not str:
                continue
            try:
                stamp_ms = parse_time_ms(stamp)
            except SnapshotError:
                continue
            if file_ms is None or stamp_ms < file_ms:
                file_ms = stamp_ms
        if not_after_ms is not None and file_ms is not None and file_ms >= not_after_ms:
            continue
        for record in records:
            mint = record.get("token_address")
            if type(mint) is str and mint:
                appeared.add(mint)
        pairs = list(canonical_pairs(records).values())
        pairs.sort(key=lambda row: row.get("volume_h1") or 0, reverse=True)
        selected = pairs if retain_universe else pairs[:limit]
        present: set[str] = set()
        for record in selected:
            stamp = record.get("ts") or record.get("fetched_at")
            try:
                now_ms = parse_time_ms(stamp)
            except SnapshotError:
                skipped += 1
                continue
            price = _positive_price(record.get("price_usd"))
            mint = record.get("token_address")
            if type(mint) is str and mint:
                present.add(mint)
            if price is None:
                skipped += 1
                continue
            if type(mint) is str:
                priced_mints.add(mint)
            prior = seen.get(mint) if type(mint) is str else None
            trail = list(history.get(mint, [])) if type(mint) is str else []
            trail.append(_point(record, stamp))
            thesis_id = None
            for position in state(ledger)["open"].values():
                if position["mint"] == mint and type(record.get("price_usd")) in (int, float):
                    try:
                        result = mark(
                            ledger, position["thesis_id"], mark_price_usd=record["price_usd"], now_ms=now_ms,
                            candles=_candles_for(candle_dir, position),
                        )
                    except PaperError:
                        skipped += 1
                        continue
                    if result.get("type") == "CLOSE":
                        closed += 1
                    thesis_id = position["thesis_id"]
            if type(mint) is str:
                history[mint] = trail
                seen[mint] = record
            if thesis_id is not None or (not_before_ms is not None and now_ms < not_before_ms):
                continue
            if open_not_after_ms is not None and now_ms >= open_not_after_ms:
                continue
            try:
                observation = observation_from_pair(record, prior)
                observation["fly_history"] = trail
                joined = join_holder_read(holder_index.get(mint, []), now_ms) if type(mint) is str else None
                pool = record.get("pair_address")
                flow = join_flow_read(flow_index.get(mint, []), now_ms, pool if type(pool) is str else None) if type(mint) is str else None
                jupiter = join_jupiter_read(jupiter_index.get(mint, []), now_ms) if type(mint) is str else None
                if jupiter is not None:
                    observation["jupiter_tokens"] = jupiter
                    jupiter_joined += 1
                    if jupiter.get("status") == "AVAILABLE":
                        jupiter_available += 1
                    elif jupiter.get("status") == "NOT_OBSERVED":
                        jupiter_not_observed += 1
                if flow is not None:
                    flow_joined += 1
                    if flow.get("status") == "AVAILABLE":
                        flow_available += 1
                    elif flow.get("status") == "NOT_OBSERVED":
                        flow_not_observed += 1
                scored_record = record
                if joined is not None:
                    observation["holder_concentration"] = joined
                    scored_record = dict(record)
                    scored_record["holder_concentration"] = joined
                    holder_joined += 1
                    flag, _summary = thesis_parts(joined, now_ms)
                    if flag["status"] == "CLEAR":
                        holder_clear += 1
                    elif flag["status"] == "RAISED":
                        holder_raised += 1
                    elif joined.get("status") == "NOT_OBSERVED":
                        holder_not_observed += 1
                signal = score(observation, now_ms)
                thesis = write_thesis(signal, scored_record, now_ms=now_ms, threshold_ppm=threshold_ppm, horizon_ms=horizon_ms)
            except (SnapshotError, ThesisError, ValueError):
                skipped += 1
                continue
            scored += 1
            fused = signal.get("fused_score_ppm") if type(signal) is dict else None
            coordinator = (signal.get("coordinator") or {}) if type(signal) is dict else {}
            if type(fused) is not int or (type(coordinator) is dict and coordinator.get("research_signal") == "ABSTAIN"):
                abstained += 1
            decision = "BELOW_THRESHOLD"
            reasons = []
            evidence = None
            if thesis is not None:
                write_files(theses_dir, thesis)
                decision = "THESIS"
                if entry_floor:
                    reasons.extend(entry_skip_reasons(
                        record, min_liquidity_usd=min_liquidity_usd, min_market_cap_usd=min_market_cap_usd,
                        max_hour_drop_percent=max_hour_drop_percent,
                    ))
                if use_entry_veto:
                    veto_reasons, evidence = entry_veto_reasons(joined if type(mint) is str else None, flow if type(mint) is str else None, now_ms)
                    reasons.extend(veto_reasons)
                if use_jupiter_veto:
                    jupiter_reasons, jupiter_evidence = jupiter_veto_reasons(jupiter if type(mint) is str else None, now_ms)
                    reasons.extend(jupiter_reasons)
                    if jupiter_evidence:
                        evidence = dict(evidence or {})
                        evidence.update(jupiter_evidence)
                reasons.extend(_crow_gate(
                    signal, min_recalled_return=min_recalled_return, max_crow_distance=max_crow_distance,
                ))
                if require_primary_vote:
                    brains = signal.get("brains") if type(signal) is dict else None
                    fly = brains.get("flyvis") if type(brains) is dict else None
                    primary = fly.get("paper_long_support_ppm") if type(fly) is dict else None
                    if type(primary) is not int:
                        reasons.append("PRIMARY_ABSTAINED")
                if reasons:
                    skip_entry(
                        ledger, thesis, record, reasons, min_liquidity_usd=min_liquidity_usd,
                        min_market_cap_usd=min_market_cap_usd, max_hour_drop_percent=max_hour_drop_percent,
                        evidence=evidence,
                    )
                    entry_skipped += 1
                    decision = "SKIP"
                    for reason in reasons:
                        skip_reasons[reason] = skip_reasons.get(reason, 0) + 1
                else:
                    try:
                        flag = record.get("instant_graduation")
                        opened_row = open_position(
                            ledger, thesis, mark_price_usd=record["price_usd"], now_ms=now_ms, notional_usd=100,
                            exit_policy=exit_policy,
                            instant_graduation=flag if type(flag) is bool else None,
                            gap_fill=gap_fill,
                        )
                    except PaperError:
                        skipped += 1
                        decision = "OPEN_FAILED"
                        opened_row = None
                    else:
                        if not opened_row.get("replayed"):
                            opened += 1
                            decision = "OPEN"
                        else:
                            decision = "REPLAYED"
            if audit_path is not None and type(signal) is dict:
                crow = signal.get("brains", {}).get("crow") if type(signal.get("brains")) is dict else None
                fly = signal.get("brains", {}).get("flyvis") if type(signal.get("brains")) is dict else None
                created = record.get("pair_created_at_ms")
                _audit(audit_path, {
                    "mint": mint,
                    "symbol": record.get("symbol"),
                    "now_ms": now_ms,
                    "decision": decision,
                    "reasons": reasons,
                    "fused_score_ppm": signal.get("fused_score_ppm"),
                    "coordinator_signal": coordinator.get("research_signal") if type(coordinator) is dict else None,
                    "crow_ppm": None if type(crow) is not dict else crow.get("paper_long_support_ppm"),
                    "recalled_return": None if type(crow) is not dict else crow.get("recalled_return"),
                    "distance": None if type(crow) is not dict else crow.get("distance"),
                    "crow_detail": None if type(crow) is not dict else crow.get("detail"),
                    "fly_ppm": None if type(fly) is not dict else fly.get("paper_long_support_ppm"),
                    "price_usd": price,
                    "price_change_h1": record.get("price_change_h1"),
                    "liquidity_usd": record.get("liquidity_usd"),
                    "volume_h1": record.get("volume_h1"),
                    "market_cap": record.get("market_cap"),
                    "buys_h1": record.get("buys_h1"),
                    "sells_h1": record.get("sells_h1"),
                    "pair_age_ms": None if type(created) is not int else now_ms - created,
                    "action": "NO_EXECUTION",
                    "execution_allowed": False,
                    "live_orders": False,
                })
        if retain_universe and file_ms is not None:
            for position in list(state(ledger)["open"].values()):
                mint = position.get("mint")
                if type(mint) is not str or mint in present:
                    continue
                last = seen.get(mint)
                last_price = None
                last_ms = None
                if type(last) is dict:
                    last_price = _positive_price(last.get("price_usd"))
                    stamp = last.get("ts") or last.get("fetched_at")
                    if type(stamp) is str:
                        try:
                            last_ms = parse_time_ms(stamp)
                        except SnapshotError:
                            last_ms = None
                try:
                    result = close_vanished(
                        ledger, position["thesis_id"], now_ms=file_ms,
                        last_price=last_price, last_price_ms=last_ms,
                    )
                except PaperError:
                    skipped += 1
                    continue
                if result.get("reason") == "VANISHED":
                    closed += 1
                    vanished += 1
                elif result.get("reason") == "NOT_OBSERVED":
                    not_observed_exits += 1
    return {
        "opened": opened,
        "closed": closed,
        "skipped": skipped,
        "entry_skipped": entry_skipped,
        "skip_reasons": skip_reasons,
        "scored": scored,
        "abstained": abstained,
        "abstention_rate": None if scored == 0 else abstained / scored,
        "holder_joined": holder_joined,
        "holder_clear": holder_clear,
        "holder_raised": holder_raised,
        "holder_not_observed": holder_not_observed,
        "flow_joined": flow_joined,
        "flow_available": flow_available,
        "flow_not_observed": flow_not_observed,
        "jupiter_joined": jupiter_joined,
        "jupiter_available": jupiter_available,
        "jupiter_not_observed": jupiter_not_observed,
        "entry_veto": use_entry_veto,
        "jupiter_veto": use_jupiter_veto,
        "retain_universe": retain_universe,
        "cutoff_file": cutoff_file,
        "not_after_ms": not_after_ms,
        "min_recalled_return": min_recalled_return,
        "max_crow_distance": max_crow_distance,
        "require_primary_vote": require_primary_vote,
        "horizon_ms": horizon_ms,
        "open_not_after_ms": open_not_after_ms,
        "universe_mints": len(appeared),
        "priced_mints": len(priced_mints),
        "never_priced": len(appeared - priced_mints),
        "vanished": vanished,
        "not_observed_exits": not_observed_exits,
        "mode": "PAPER",
        "action": "NO_EXECUTION",
        "execution_allowed": False,
        "live_orders": False,
    }
