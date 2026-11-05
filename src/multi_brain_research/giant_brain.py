"""Giant Brain v1. Paper signals only.

Fuses three voters through the existing observation coordinator:

* tape — heuristic paper-long support from observed prices, flow, and liquidity
* crow — memory recall, labeled as a heuristic, not a biological model
* fly — pinned FlyVis identity, abstaining until a market readout exists

The coordinator record is the research signal. A numeric fused score is the
mean of the heuristic ballots that actually voted. FlyVis does not invent one.
No order is built, signed, or sent.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

from .brain_input import FEATURE_NAMES, features, paper_long_support
from .consensus import ConsensusPolicy, FeatureSpec, ModuleSpec, PairIdentity, Receipt
from .contracts import Measurement, Snapshot
from .council_roster import roster
from .crow_brain import recall, remember
from .first_brain import graph_file, score_episode
from .fly_brain import describe as fly_status
from .flyvis_market import score_history as fly_score_history
from .holder_concentration import council_input
from .market_sources import from_curve_snapshots, from_pump_events, from_scanner_market
from .paper_log import append, summary
from .receipt_bridge import to_module_output
from .rpc_allow import ALLOWED

HORIZON_MS = 300_000
WRAPPED_SOL = "So11111111111111111111111111111111111111112"
TASK = {"task": "paper_long_support_v1", "horizon_ms": HORIZON_MS, "calibration": "NOT_ESTABLISHED"}
TASK_SHA = hashlib.sha256(json.dumps(TASK, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
FEATURE_SET_SHA = hashlib.sha256(b"giant_brain_feature_m001_v1").hexdigest()


_PIN_CACHE: dict[tuple, str] = {}


def _pin_file(path: Path) -> str:
    stat = path.stat()
    key = (str(path.resolve()), stat.st_mtime_ns, stat.st_size)
    cached = _PIN_CACHE.get(key)
    if cached is not None:
        return cached
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    _PIN_CACHE[key] = digest
    return digest


def _rule(name: str) -> str:
    body = {
        "kind": "UNCALIBRATED_RULE_IDENTITY",
        "rule": name,
        "market_calibration": "NOT_ESTABLISHED",
    }
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _canonical(value) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()
    ).hexdigest()


def _prepare(observation: dict) -> dict:
    if type(observation) is not dict:
        raise ValueError("NO_PRICE")
    kind = observation.get("kind")
    if kind == "scanner_market":
        row = from_scanner_market(observation.get("market") or {}, observation.get("previous"))
    elif kind == "curve_snapshots":
        row = from_curve_snapshots(observation.get("current") or {}, observation.get("previous"))
    elif kind == "pump_trades":
        row = from_pump_events(observation.get("events") or [])
    else:
        row = dict(observation)
    if observation.get("mint"):
        row["mint"] = observation["mint"]
    pool = observation.get("pool") or observation.get("curve")
    if pool:
        row["pool"] = pool
    if observation.get("quote_mint"):
        row["quote_mint"] = observation["quote_mint"]
    return row


def _spec(module_id: str, source_id: str, graph: str, checkpoint: str, encoder: str, readout: str) -> ModuleSpec:
    return ModuleSpec(
        module_id=module_id,
        source_id=source_id,
        graph_sha256=graph,
        checkpoint_sha256=checkpoint,
        encoder_sha256=encoder,
        readout_sha256=readout,
        calibration_sha256=readout,
    )


def _module_output(spec: ModuleSpec, scored: dict, snapshot_sha: str, produced_ms: int):
    receipt = {
        "module_id": spec.module_id,
        "source_id": spec.source_id,
        "graph_sha256": spec.graph_sha256,
        "model_sha256": spec.pipeline_sha256(),
        "task_sha256": TASK_SHA,
        "horizon_ms": HORIZON_MS,
        "prediction_ppm": scored.get("prediction_ppm", scored.get("paper_long_support_ppm")),
        "uncertainty_ppm": scored.get("uncertainty_ppm"),
        "abstain_reason": scored.get("abstain_reason"),
        "action": "NO_EXECUTION",
    }
    if receipt["prediction_ppm"] is None:
        receipt["uncertainty_ppm"] = None
        receipt["abstain_reason"] = scored.get("abstain_reason") or "MISSING_DATA"
    return to_module_output(receipt, snapshot_sha, produced_ms)


def _fly_history(row: dict) -> list[dict]:
    supplied = row.get("fly_history")
    if type(supplied) is list:
        return supplied
    current = {
        "price_usd": row.get("price_quote_per_base", row.get("price_usd")),
        "buys_h1": row.get("buy_quote_atoms"),
        "sells_h1": row.get("sell_quote_atoms"),
        "liquidity_usd": row.get("liquidity_usd", row.get("liquidity_quote")),
    }
    previous = row.get("previous_price")
    if type(previous) not in (int, float) or isinstance(previous, bool) or previous <= 0:
        return [current]
    return [{
        "price_usd": previous,
        "liquidity_usd": row.get("previous_liquidity_usd", row.get("previous_liquidity_quote")),
    }, current]


def _episode(row: dict) -> list[dict] | None:
    supplied = row.get("observations")
    if type(supplied) is list and supplied:
        return supplied
    price = row.get("price_quote_per_base", row.get("price_usd"))
    if type(price) is bool or type(price) not in (int, float) or price <= 0:
        return None
    rows = []
    previous = row.get("previous_price")
    if type(previous) in (int, float) and not isinstance(previous, bool) and previous > 0:
        rows.append({
            "last_trade_price": previous,
            "quote_atoms": row.get("previous_liquidity_quote") or row.get("previous_liquidity_usd") or 1.0,
            "signed_quote_flow": 0.0,
        })
    buy, sell = row.get("buy_quote_atoms"), row.get("sell_quote_atoms")
    flow = (buy - sell) if type(buy) in (int, float) and type(sell) in (int, float) and not isinstance(buy, bool) else 0.0
    rows.append({
        "last_trade_price": price,
        "quote_atoms": row.get("liquidity_quote") or row.get("liquidity_usd") or 1.0,
        "signed_quote_flow": flow,
    })
    return rows


def _hemibrain_vote(row: dict) -> dict:
    path = graph_file()
    episode = _episode(row)
    if path is None or episode is None:
        return {
            "paper_long_support_ppm": None,
            "abstain_reason": "MISSING_DATA",
            "detail": "GRAPH_OR_EPISODE_ABSENT",
            "action": "NO_EXECUTION",
            "execution_allowed": False,
        }
    try:
        scored = score_episode(episode, len(episode) - 1, path)
    except (OSError, ValueError):
        return {
            "paper_long_support_ppm": None,
            "abstain_reason": "MODULE_FAILED",
            "detail": "HEMIBRAIN_SCORE_FAILED",
            "action": "NO_EXECUTION",
            "execution_allowed": False,
        }
    scored["detail"] = scored.get("abstain_reason") or "HEMIBRAIN_FEATURE_LOADER"
    return scored


def _shell(row: dict, reason: str, fly: dict) -> dict:
    return {
        "protocol": "AAI_GIANT_BRAIN_V1",
        "mode": "PAPER",
        "action": "NO_EXECUTION",
        "execution_allowed": False,
        "live_orders": False,
        "market_skill": "NOT_ESTABLISHED",
        "mint": row.get("mint"),
        "fused_score_ppm": None,
        "confidence_ppm": 0,
        "reason": reason,
        "brains": {"flyvis": fly, "crow": None},
        "inputs": {"role": "MARKET_INPUT_NOT_A_VOTE", "detail": reason},
        "fixtures": ["second_brain", "third_brain", "tape_brain"],
        "coordinator": None,
        "provenance": {"fly_graph_sha256": fly.get("graph_sha256"), "fly_checkpoint_sha256": fly.get("checkpoint_sha256")},
    }


def fuse(observation: dict, *, now_ms: int, memory_path: Path | None = None, readout: dict | None = None) -> dict:
    if type(now_ms) is not int or now_ms < 0:
        raise ValueError("INVALID_TIME")
    fly = fly_status()
    row = _prepare(observation)
    try:
        mapped = features(row)
    except ValueError as error:
        return _shell(row, str(error), fly)
    tape_score = paper_long_support(mapped)
    crow_score = recall(mapped["features"], memory_path, now_ms=now_ms)
    fly_vote = fly_score_history(_fly_history(row), readout=readout)
    council = roster()
    hemibrain_vote = _hemibrain_vote(row)
    here = Path(__file__).resolve().parent
    encoder = _pin_file(here / "brain_input.py")
    crow_spec = _spec(
        "crow_memory_v1", "crow_memory", _pin_file(here / "crow_brain.py"), _pin_file(here / "crow_brain.py"),
        encoder, _rule("crow_memory_recall_v1"),
    )
    fly_number = fly_vote.get("paper_long_support_ppm")
    if type(fly_number) is int and type(fly.get("graph_sha256")) is str and type(fly.get("checkpoint_sha256")) is str and type(fly_vote.get("readout_sha256")) is str:
        fly_spec = _spec(
            "flyvis_market_v1",
            "flyvis_reference",
            fly["graph_sha256"],
            fly["checkpoint_sha256"],
            fly_vote["encoder_sha256"],
            fly_vote["readout_sha256"],
        )
    else:
        fly_spec = ModuleSpec(
            module_id="flyvis_market_v1",
            source_id="flyvis_reference",
            graph_sha256=fly["graph_sha256"],
            checkpoint_sha256=fly["checkpoint_sha256"],
            encoder_sha256=None,
            readout_sha256=None,
            calibration_sha256=None,
        )
    signed = mapped["features"]["signed_return"]
    lineage = _canonical({"row": {key: row.get(key) for key in (
        "mint", "pool", "price_quote_per_base", "previous_price", "buy_quote_atoms",
        "sell_quote_atoms", "liquidity_quote", "previous_liquidity_quote", "liquidity_usd",
        "previous_liquidity_usd", "source", "classification",
    )}, "features": mapped["features"]})
    measurement = Measurement(
        feature_id="M-001",
        value=None if signed is None else int(round(signed * 1_000_000)),
        unit="signed_return_ppm",
        classification="DERIVED",
        event_time_ms=now_ms,
        observed_time_ms=now_ms,
        available_time_ms=now_ms,
        source_id="market_tape",
        source_version="giant_v1",
        lineage_sha256=lineage,
        missing_reason=None if signed is not None else "SOURCE_UNAVAILABLE",
    )
    pair = PairIdentity(
        chain="solana",
        network="mainnet",
        venue="pump_fun",
        pool_address=row.get("pool"),
        base_mint=row.get("mint"),
        quote_mint=row.get("quote_mint") or WRAPPED_SOL,
    )
    members = [fly_spec, crow_spec]
    hemibrain_spec = None
    if "hemibrain" in council["members"] and type(hemibrain_vote.get("graph_sha256")) is str:
        hemibrain_spec = _spec(
            "fly_hemibrain_adverse_v1",
            "flyem_hemibrain_v1_2",
            hemibrain_vote["graph_sha256"],
            hemibrain_vote["model_sha256"],
            encoder,
            hemibrain_vote["model_sha256"],
        )
        members.append(hemibrain_spec)
    policy = ConsensusPolicy(
        policy_id="giant_brain_v1",
        classification="UNVALIDATED_RESEARCH",
        modules=tuple(members),
        features=(FeatureSpec("M-001", "signed_return_ppm", "DERIVED"),),
        feature_set_sha256=FEATURE_SET_SHA,
        task_sha256=TASK_SHA,
        horizon_ms=HORIZON_MS,
        buy_threshold_ppm=500_000,
        max_uncertainty_ppm=1_000_000,
        max_observation_age_ms=60_000,
        max_decision_latency_ms=5_000,
    )
    snapshot = Snapshot(
        entity_id=pair.entity_id(),
        decision_time_ms=now_ms,
        feature_set_sha256=FEATURE_SET_SHA,
        max_observation_age_ms=60_000,
        measurements=(measurement,),
    )
    digest = snapshot.sha256()
    crow_output = _module_output(crow_spec, {
        "prediction_ppm": crow_score["paper_long_support_ppm"],
        "uncertainty_ppm": crow_score["uncertainty_ppm"],
        "abstain_reason": crow_score["abstain_reason"],
    }, digest, now_ms + 1)
    from .consensus import ObservationRound
    rnd = ObservationRound(policy, pair, snapshot)
    if fly_spec.missing_components() == ():
        rnd.submit(Receipt(_module_output(fly_spec, {
            "prediction_ppm": fly_number,
            "uncertainty_ppm": fly_vote.get("uncertainty_ppm"),
            "abstain_reason": None,
        }, digest, now_ms + 1), now_ms + 1))
    rnd.submit(Receipt(crow_output, now_ms + 1 if fly_spec.missing_components() else now_ms + 2))
    if hemibrain_spec is not None:
        rnd.submit(Receipt(_module_output(hemibrain_spec, {
            "prediction_ppm": hemibrain_vote.get("paper_long_support_ppm"),
            "uncertainty_ppm": hemibrain_vote.get("uncertainty_ppm"),
            "abstain_reason": hemibrain_vote.get("abstain_reason"),
        }, digest, now_ms + 2), now_ms + 2))
    coordinator = rnd.finalize(now_ms + 3)
    in_vote = hemibrain_spec is not None
    numeric = [fly_number] if type(fly_number) is int else []
    if type(crow_score.get("paper_long_support_ppm")) is int:
        numeric.append(crow_score["paper_long_support_ppm"])
    if in_vote and type(hemibrain_vote.get("paper_long_support_ppm")) is int:
        numeric.append(hemibrain_vote["paper_long_support_ppm"])
    roster_size = len(council["members"])
    fused = None if not numeric else int(round(sum(numeric) / len(numeric)))
    spread = 0 if len(numeric) < 2 else max(numeric) - min(numeric)
    confidence = 0 if not numeric else int((len(numeric) / roster_size) * max(0, 1_000_000 - spread))
    brains = {
        "flyvis": {
            **fly,
            **fly_vote,
            "council_member": True,
            "primary": True,
            "reason": fly_vote.get("detail") or fly.get("reason"),
        },
        "crow": {**crow_score, "council_member": True, "primary": False},
    }
    shadow = {}
    if in_vote:
        brains["hemibrain"] = {**hemibrain_vote, "council_member": True, "primary": False, "in_vote": True, "role": "COUNCIL"}
    else:
        shadow["hemibrain"] = {**hemibrain_vote, "council_member": False, "in_vote": False, "role": "SHADOW"}
    return {
        "protocol": "AAI_GIANT_BRAIN_V1",
        "mode": "PAPER",
        "action": "NO_EXECUTION",
        "execution_allowed": False,
        "live_orders": False,
        "market_skill": "NOT_ESTABLISHED",
        "mint": row.get("mint"),
        "fused_score_ppm": fused,
        "confidence_ppm": confidence,
        "primary": "flyvis",
        "council": list(council["members"]),
        "fixtures": list(council["fixtures"]),
        "inputs": {
            "role": "MARKET_INPUT_NOT_A_VOTE",
            "features": mapped["features"],
            "missing": mapped["missing"],
            "tape_heuristic_ppm": tape_score["prediction_ppm"],
            "tape_role": "TEST_FIXTURE",
            "holder_concentration": council_input(observation.get("holder_concentration"), now_ms),
        },
        "brains": brains,
        "shadow": shadow,
        "coordinator": coordinator,
        "provenance": {
            "observation_sha256": lineage,
            "task_sha256": TASK_SHA,
            "crow_graph_sha256": crow_spec.graph_sha256,
            "crow_pipeline_sha256": crow_spec.pipeline_sha256(),
            "fly_graph_sha256": fly["graph_sha256"],
            "fly_checkpoint_sha256": fly["checkpoint_sha256"],
            "coordinator_record_sha256": coordinator["record_sha256"],
            "feature_names": FEATURE_NAMES,
        },
    }


def _observed_fee_bps(observation: dict):
    fee = observation.get("fee_bps")
    if type(fee) is int and not isinstance(fee, bool) and 0 <= fee <= 10_000:
        return fee
    return None


def _hypothetical(price, nxt, support, fee_bps):
    """One-step paper result. A fee is subtracted only from a long whose capture has fee_bps."""
    if type(price) is bool or type(price) not in (int, float) or not price > 0:
        return None
    if type(nxt) is bool or type(nxt) not in (int, float) or not nxt > 0:
        return None
    change = (nxt - price) / price
    long = type(support) is int and not isinstance(support, bool) and support >= 500_000
    gross = change if long else 0.0
    applied = long and fee_bps is not None
    return {
        "position": "PAPER_LONG" if long else "PAPER_FLAT",
        "subsequent_return": change,
        "paper_pnl_per_unit": gross,
        "paper_pnl_after_fee_per_unit": gross - (fee_bps / 10_000) if applied else gross,
        "fee_bps": fee_bps if applied else None,
        "fees": "APPLIED" if applied else "NOT_APPLIED",
        "fill": "HYPOTHETICAL_NOT_A_VENUE_FILL",
    }


def paper_backtest(observations: list, log_path: Path, memory_path: Path | None = None) -> dict:
    """Replay observations in order and append hypothetical paper pnl. No fills are sent."""
    written = []
    for index, observation in enumerate(observations):
        if type(observation) is not dict or type(observation.get("decision_time_ms")) is not int:
            raise ValueError("INVALID_TIME")
        signal = fuse(observation, now_ms=observation["decision_time_ms"], memory_path=memory_path)
        later_obs = observations[index + 1] if index + 1 < len(observations) else None
        nxt = later_obs.get("price_quote_per_base") if type(later_obs) is dict else None
        hypothetical = _hypothetical(
            observation.get("price_quote_per_base"), nxt, signal.get("fused_score_ppm"), _observed_fee_bps(observation),
        )
        outcome_end = later_obs.get("decision_time_ms") if type(later_obs) is dict else None
        if hypothetical is not None:
            tape_features = (signal.get("inputs") or {}).get("features") or {}
            if (
                memory_path is not None
                and type(outcome_end) is int
                and outcome_end >= observation["decision_time_ms"]
                and all(type(tape_features.get(name)) in (int, float) for name in (
                    "signed_return", "flow_imbalance", "liquidity_change"
                ))
            ):
                remember(memory_path, {
                    "mint": signal.get("mint"),
                    "features": tape_features,
                    "later_return": hypothetical["subsequent_return"],
                    "observation_sha256": signal["provenance"]["observation_sha256"],
                    "outcome_start_ms": observation["decision_time_ms"],
                    "outcome_end_ms": outcome_end,
                    "action": "NO_EXECUTION",
                })
        record = {
            "index": index,
            "mint": signal.get("mint"),
            "fused_score_ppm": signal.get("fused_score_ppm"),
            "confidence_ppm": signal.get("confidence_ppm"),
            "coordinator_signal": None if signal.get("coordinator") is None else signal["coordinator"]["research_signal"],
            "brains": {
                name: {
                    "paper_long_support_ppm": (brain or {}).get("paper_long_support_ppm"),
                    "detail": (brain or {}).get("detail") or (brain or {}).get("reason"),
                }
                for name, brain in signal["brains"].items()
            },
            "hypothetical": hypothetical,
            "action": "NO_EXECUTION",
            "execution_allowed": False,
        }
        append(log_path, record)
        written.append(record)
    report = summary(written)
    report["paper_pnl_per_unit_sum"] = report["pnl_before_fees"]
    return report


def publish_snapshot_log(root: Path, log_path: Path) -> dict:
    """Write one paper log from collected pair series. Crow memory is not filled here."""
    from .flyvis_market import series_from_snapshot_root

    series = series_from_snapshot_root(root)
    if log_path.exists():
        log_path.unlink()
    for mint, points in series.items():
        history = []
        observations = []
        for index, point in enumerate(points):
            history.append({
                "price_usd": point["price_usd"],
                "buys_h1": point.get("buys_h1"),
                "sells_h1": point.get("sells_h1"),
                "liquidity_usd": point.get("liquidity_usd"),
            })
            previous = points[index - 1] if index else None
            observation = {
                "mint": mint,
                "pool": point.get("pair_address"),
                "symbol": point.get("symbol"),
                "dex": point.get("dex"),
                "price_quote_per_base": point["price_usd"],
                "price_usd": point["price_usd"],
                "previous_price": None if previous is None else previous["price_usd"],
                "previous_liquidity_usd": None if previous is None else previous.get("liquidity_usd"),
                "buy_quote_atoms": point.get("buys_h1"),
                "sell_quote_atoms": point.get("sells_h1"),
                "liquidity_usd": point.get("liquidity_usd"),
                "classification": "OBSERVED",
                "source": "dexscreener_pairs",
                "decision_time_ms": point["ts_ms"],
                "fly_history": [dict(item) for item in history[-48:]],
                "action": "NO_EXECUTION",
            }
            fee = point.get("fee_bps")
            if type(fee) is int and not isinstance(fee, bool):
                observation["fee_bps"] = fee
            observations.append(observation)
        if observations:
            paper_backtest(observations, log_path)
    if not log_path.is_file():
        report = summary([])
    else:
        lines = [json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines() if line.strip()]
        report = summary(lines)
    report["mints"] = len(series)
    report["paper_pnl_per_unit_sum"] = report["pnl_before_fees"]
    return report


def source_status() -> dict:
    configured = os.environ.get("GIANT_BRAIN_RPC_URL", "")
    if not configured:
        rpc_state = "PUBLIC_ALLOWLIST_DEFAULT"
    elif configured in ALLOWED:
        rpc_state = "ALLOWLISTED_ENV"
    else:
        rpc_state = "REFUSED_NOT_ALLOWLISTED"
    return {
        "solana_rpc": {"state": rpc_state, "endpoints": sorted(ALLOWED), "key_required": False},
        "helius": {
            "used": False,
            "state": "IGNORED" if os.environ.get("HELIUS_API_KEY") else "KEY_ABSENT",
            "reason": "A keyed endpoint is not on the public allowlist",
        },
        "holder_concentration": {
            "state": "PUBLIC_READ",
            "methods": ["getTokenSupply", "getTokenLargestAccounts", "getMultipleAccounts"],
            "fallback": "https://api.rugcheck.xyz/v1/tokens/{mint}/report",
            "stored": "holder-reads/*.jsonl",
            "time_gate": "read_ts_ms <= decision",
            "key_required": False,
            "in_snapshot": False,
        },
        "pool_trades": {
            "state": "PUBLIC_NO_KEY",
            "endpoint": "https://api.geckoterminal.com/api/v2/networks/solana/pools/{pool}/trades",
            "stored": "pool-trades/*.jsonl",
            "time_gate": "read_ts_ms <= decision",
            "entry_veto_default": False,
            "key_required": False,
        },
        "dexscreener": {"state": "PUBLIC_NO_KEY", "key_required": False},
        "scanner_feed": {"state": "CALLER_SUPPLIED_REPORT", "key_required": False},
        "flyvis": fly_status(),
        "crow": {"state": "HEURISTIC_MEMORY", "biological_model": False, "connectome": "ABSENT"},
        "execution": "PAPER_ONLY",
    }
