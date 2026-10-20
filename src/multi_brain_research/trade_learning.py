"""AAI.fun: transaction-atomic trade observations to a fitted research readout."""
from __future__ import annotations

from collections import defaultdict
from fractions import Fraction
from pathlib import Path
import random

from ..solana_research import coin_evidence as ev
from . import training_lab as lab
from . import neural_features as neural

TASK = "FUTURE_OBSERVED_TRADE_PRICE_DIRECTION_NOT_EXECUTABLE_RETURN_V1"
FEATURES = ("return_one", "return_three", "relative_quote_volume", "signed_quote_flow", "elapsed_slots")
UNITS = {"features": "DIMENSIONLESS_TRADE_FEATURES_V1",
         "target_horizon": "LATER_MARKET_TRANSACTION_OBSERVATIONS",
         "availability": "TRANSACTION_ATOMIC_LEDGER_REPLAY_NOT_LIVE_LATENCY"}
PIPELINE = {"kind": "CAUSAL_TRANSACTION_TRADE_CONTROL_V1", "features": list(FEATURES),
            "observation": "ONE_MARKET_PER_COMPLETE_TRANSACTION", "biological_core": "NOT_USED"}


def build_dataset(archives):
    lab.require(type(archives) is list and 1 <= len(archives) <= 8, "SOURCE_ARCHIVE_BOUND")
    sources, episodes, signatures, end = [], [], set(), -1
    archives = sorted(archives, key=lambda a: (a["requested_start_slot"], a["requested_end_slot"]))
    classification = archives[0]["classification"]
    lab.require(classification in ("RPC_CAPTURE", "SYNTHETIC_FIXTURE"), "SOURCE_CLASSIFICATION")
    for archive in archives:
        lab.require(archive["classification"] == classification, "MIXED_SYNTHETIC_AND_RECORDED_SOURCES")
        tape = ev.reconstruct(archive)
        start, finish = tape["requested_start_slot"], tape["requested_end_slot"]
        lab.require(start > end, "OVERLAPPING_SOURCE_WINDOWS")
        end = finish
        current_signatures = {row["signature"] for row in tape["transactions"]}
        lab.require(not signatures & current_signatures, "DUPLICATE_SOURCE_TRANSACTION")
        signatures.update(current_signatures)
        source_pin = ev.digest(archive)
        sources.append({"archive_sha256": source_pin, "start_slot": start, "end_slot": finish,
                        "skipped_slots": tape["skipped_slots"], "trade_count": len(tape["trades"]),
                        "transaction_count": len(tape["transactions"]),
                        "failed_transaction_count": tape["failed_transaction_count"],
                        "other_or_unmapped_cpi_events": tape["other_or_unmapped_cpi_events"]})
        markets = defaultdict(list)
        for trade in tape["trades"]:
            markets[(trade["pool"], trade["base_mint"], trade["quote_mint"])].append(trade)
        for market, trades in sorted(markets.items()):
            pool, base, quote = market
            rows = []
            for trade in trades:
                order = [trade["slot"], trade["transaction_index"]]
                amount = trade["quote_atoms"]
                signed = amount if trade["side"] == "BUY" else -amount
                if rows and rows[-1]["order"] == order:
                    row = rows[-1]
                    lab.require(row["signature"] == trade["signature"], "ATOMIC_TRANSACTION_CONFLICT")
                    row["base_volume_atoms"] += trade["base_atoms"]
                    row["quote_volume_atoms"] += amount
                    row["signed_quote_atoms"] += signed
                    row["trade_count"] += 1
                    row["last_price"] = ev.fraction(ev.price(trade))
                else:
                    rows.append({"order": order, "signature": trade["signature"],
                                 "block_time": trade["block_time"], "base_volume_atoms": trade["base_atoms"],
                                 "quote_volume_atoms": amount, "signed_quote_atoms": signed,
                                 "trade_count": 1, "last_price": ev.fraction(ev.price(trade))})
            episodes.append({"episode_id": "ep_" + lab.digest([start, finish, *market])[:20],
                             "asset_group_sha256": lab.digest([ev.MAINNET_GENESIS, base]),
                             "source_archive_sha256": source_pin, "pool": pool,
                             "base_mint": base, "quote_mint": quote,
                             "base_decimals": trades[0]["base_decimals"],
                             "quote_decimals": trades[0]["quote_decimals"], "observations": rows})
    data = {"protocol": "AAI_OBSERVED_TRADE_DATASET_V1", "classification": classification,
            "decoder_policy_sha256": lab.digest(ev.POLICY), "sources": sources, "episodes": episodes}
    validate_dataset(data)
    return data


def validate_dataset(data):
    lab.exact(data, ("protocol", "classification", "decoder_policy_sha256", "sources", "episodes"))
    lab.require(data["protocol"] == "AAI_OBSERVED_TRADE_DATASET_V1"
                and data["classification"] in ("RPC_CAPTURE", "SYNTHETIC_FIXTURE")
                and data["decoder_policy_sha256"] == lab.digest(ev.POLICY), "TRADE_DATASET_PROTOCOL")
    lab.require(type(data["sources"]) is list and 1 <= len(data["sources"]) <= 8, "SOURCE_ARCHIVE_BOUND")
    source_map, previous = {}, -1
    for source in data["sources"]:
        lab.exact(source, ("archive_sha256", "start_slot", "end_slot", "skipped_slots",
                          "trade_count", "transaction_count", "failed_transaction_count",
                          "other_or_unmapped_cpi_events"))
        pin = lab.pin(source["archive_sha256"])
        start, end = ev.integer(source["start_slot"]), ev.integer(source["end_slot"])
        lab.require(start > previous and 0 <= end - start < 4 and pin not in source_map,
                    "OVERLAPPING_OR_DUPLICATE_SOURCE")
        previous = end
        skipped = source["skipped_slots"]
        lab.require(type(skipped) is list and len(skipped) <= 4
                    and all(type(s) is int and start <= s <= end for s in skipped)
                    and skipped == sorted(set(skipped)), "SKIPPED_SLOT_CONTRACT")
        for field in ("trade_count", "transaction_count", "failed_transaction_count", "other_or_unmapped_cpi_events"):
            ev.integer(source[field])
        source_map[pin] = source
    lab.require(type(data["episodes"]) is list and len(data["episodes"]) <= 512, "TRADE_EPISODE_BOUND")
    result, seen_markets, decimals, count = {}, set(), {}, 0
    trade_totals = defaultdict(int)
    for episode in data["episodes"]:
        lab.exact(episode, ("episode_id", "asset_group_sha256", "source_archive_sha256", "pool",
                            "base_mint", "quote_mint", "base_decimals", "quote_decimals", "observations"))
        key = lab.name(episode["episode_id"])
        source = source_map.get(episode["source_archive_sha256"])
        lab.require(source is not None and key not in result, "INVALID_EPISODE_SOURCE_OR_ID")
        market = tuple(ev.key(episode[field]) for field in ("pool", "base_mint", "quote_mint"))
        lab.require(market[1] != market[2], "SAME_BASE_AND_QUOTE")
        identity = (episode["source_archive_sha256"], *market)
        lab.require(identity not in seen_markets, "DUPLICATE_MARKET_EPISODE")
        seen_markets.add(identity)
        lab.require(episode["asset_group_sha256"] == lab.digest([ev.MAINNET_GENESIS, market[1]]),
                    "ASSET_GROUP_IDENTITY_MISMATCH")
        for field, mint in (("base_decimals", market[1]), ("quote_decimals", market[2])):
            value = ev.integer(episode[field], 0, 18)
            lab.require(mint not in decimals or decimals[mint] == value, "MINT_DECIMALS_CONFLICT")
            decimals[mint] = value
        rows = episode["observations"]
        lab.require(type(rows) is list and 1 <= len(rows) <= 4096, "OBSERVATION_BOUND")
        count += len(rows)
        lab.require(count <= 8192, "TRADE_DATASET_BOUND")
        last, signatures = (-1, -1), set()
        for row in rows:
            lab.exact(row, ("order", "signature", "block_time", "base_volume_atoms", "quote_volume_atoms",
                            "signed_quote_atoms", "trade_count", "last_price"))
            order = row["order"]
            lab.require(type(order) is list and len(order) == 2, "LEDGER_ORDER")
            slot, index = ev.integer(order[0]), ev.integer(order[1], 0, 9999)
            lab.require((slot, index) > last and source["start_slot"] <= slot <= source["end_slot"]
                        and slot not in source["skipped_slots"], "NONCAUSAL_TRANSACTION_ORDER")
            signature = ev.key(row["signature"], 64)
            lab.require(signature not in signatures, "DUPLICATE_MARKET_TRANSACTION")
            signatures.add(signature)
            if row["block_time"] is not None:
                ev.integer(row["block_time"], 0, 2**63 - 1)
            ev.integer(row["base_volume_atoms"], 1, 2**128 - 1)
            volume = ev.integer(row["quote_volume_atoms"], 1, 2**128 - 1)
            ev.integer(row["signed_quote_atoms"], -volume, volume)
            trade_totals[episode["source_archive_sha256"]] += ev.integer(row["trade_count"], 1, 8192)
            lab.exact(row["last_price"], ("numerator", "denominator"))
            ev.integer(row["last_price"]["numerator"], 1, 2**128 - 1)
            ev.integer(row["last_price"]["denominator"], 1, 2**128 - 1)
            last = slot, index
        result[key] = episode
    for source_pin, source in source_map.items():
        lab.require(trade_totals[source_pin] == source["trade_count"], "SOURCE_TRADE_COUNT_MISMATCH")
    return result


def quoted_price(row):
    return Fraction(row["last_price"]["numerator"], row["last_price"]["denominator"])


def features(episode, index):
    rows = episode["observations"]
    lab.integer(index, 0, len(rows) - 1)
    current = rows[index]
    prior = rows[max(0, index - 1)]
    older = rows[max(0, index - 3)]
    now = quoted_price(current)
    volumes = [row["quote_volume_atoms"] for row in rows[max(0, index - 3):index]]
    average = sum(volumes) / len(volumes) if volumes else current["quote_volume_atoms"]
    volume = current["quote_volume_atoms"]
    def clip(value):
        return max(-1.0, min(1.0, float(value)))
    return [clip(20 * (now / quoted_price(prior) - 1)),
            clip(10 * (now / quoted_price(older) - 1)),
            clip((volume - average) / (volume + average)),
            current["signed_quote_atoms"] / volume,
            min(1.0, (current["order"][0] - prior["order"][0]) / 16)]


def assessment(data):
    episodes = validate_dataset(data)
    observations = sum(len(e["observations"]) for e in episodes.values())
    groups = len({e["asset_group_sha256"] for e in episodes.values()})
    pairs = sum(max(0, len(e["observations"]) - 1) for e in episodes.values())
    return {"protocol": "AAI_TRADE_SOURCE_ASSESSMENT_V1", "classification": data["classification"],
            "source_count": len(data["sources"]), "asset_group_count": groups,
            "episode_count": len(episodes), "transaction_observations": observations,
            "candidate_next_transaction_pairs": pairs,
            "status": "PLAN_REQUIRED" if groups >= 3 and pairs >= 12 else "INSUFFICIENT_COHORT",
            "training_ready": False, "training_performed": False,
            "historical_observer_availability_known": False, "execution_quotes_available": False,
            "market_validation_established": False, "live_execution_allowed": False}


def validate_plan(data, plan):
    lab.exact(plan, ("protocol", "dataset_sha256", "horizon_transactions", "max_horizon_slots",
                     "shuffle_seed", "alias_salt", "splits", "epochs", "learning_rate", "l2"))
    lab.require(plan["protocol"] == "AAI_TRADE_READOUT_PLAN_V1"
                and plan["dataset_sha256"] == lab.digest(data), "TRADE_PLAN_DATASET_PIN")
    lab.integer(plan["horizon_transactions"], 1, 64)
    lab.integer(plan["max_horizon_slots"], 1, 4096)
    lab.integer(plan["shuffle_seed"], 0, 2**32 - 1)
    lab.pin(plan["alias_salt"])
    lab.integer(plan["epochs"], 1, 2000)
    lab.finite(plan["learning_rate"], 0.00001, 1)
    lab.finite(plan["l2"], 0, 1)
    lab.exact(plan["splits"], lab.PARTS)
    episodes = validate_dataset(data)
    assigned, groups = set(), {}
    for part in lab.PARTS:
        members = plan["splits"][part]
        lab.require(type(members) is list and 1 <= len(members) <= 512, "EMPTY_TRADE_SPLIT")
        groups[part] = set()
        for key in members:
            lab.require(type(key) is str and key in episodes and key not in assigned, "INVALID_TRADE_SPLIT")
            assigned.add(key)
            groups[part].add(episodes[key]["asset_group_sha256"])
    lab.require(assigned == set(episodes), "UNASSIGNED_TRADE_EPISODE")
    for left, right in (("train", "validation"), ("train", "test"), ("validation", "test")):
        lab.require(not groups[left] & groups[right], "ASSET_GROUP_LEAKAGE")
        end = max(episodes[key]["observations"][-1]["order"][0] for key in plan["splits"][left])
        start = min(episodes[key]["observations"][0]["order"][0] for key in plan["splits"][right])
        lab.require(end + plan["max_horizon_slots"] < start, "TRADE_CHRONOLOGY_OR_HORIZON_GAP")
    return episodes


def examples(data, plan, bundle=None):
    episodes = validate_plan(data, plan)
    exported = None if bundle is None else neural.validate_bundle(bundle, data, PIPELINE)
    result = {}
    for part in lab.PARTS:
        keys = list(plan["splits"][part])
        random.Random(plan["shuffle_seed"] + lab.PARTS.index(part)).shuffle(keys)
        result[part] = []
        for key in keys:
            episode = episodes[key]
            rows = episode["observations"]
            for index, row in enumerate(rows):
                target = index + plan["horizon_transactions"]
                if target >= len(rows) or rows[target]["order"][0] - row["order"][0] > plan["max_horizon_slots"]:
                    continue
                result[part].append({"episode_id": key, "index": index, "target_index": target,
                    "x": features(episode, index) if exported is None else list(exported[key][index]),
                    "y": int(quoted_price(rows[target]) > quoted_price(row))})
    return result


def fit(data, plan, bundle=None):
    partitions = examples(data, plan, bundle)
    pipeline = PIPELINE if bundle is None else bundle["pipeline"]
    initial, state, before, scored, baseline = lab.fit_parameters(partitions, plan)
    metadata = {"protocol": "AAI_TRADE_LOGISTIC_READOUT_V1", "task": TASK,
                "dataset_sha256": lab.digest(data), "plan_sha256": lab.digest(plan),
                "pipeline_sha256": lab.digest(pipeline),
                "units": UNITS if bundle is None else {**UNITS, "features": pipeline["activity_units"]},
                "live_execution_allowed": False, "calibration": "NOT_ESTABLISHED"}
    if bundle is not None:
        metadata["feature_export_sha256"] = lab.digest(bundle)
    model = {**metadata, **state}
    report = {"protocol": "AAI_TRADE_READOUT_REPORT_V1", "classification": data["classification"],
              "task": TASK, "pipeline": pipeline, "initial_model_sha256": lab.digest({**metadata, **initial}),
              "model_sha256": lab.digest(model), "readout_parameters_changed": initial != state,
              "initial_train_metrics": before, "metrics": scored, "train_prior_baseline": baseline,
              "training_performed": True, "trained_components": ["LOGISTIC_READOUT"],
              "biological_core_used": bundle is not None, "biological_core_weights_updated": False,
              "historical_observer_availability_known": False, "execution_quotes_available": False,
              "execution_attestation": "NOT_ESTABLISHED", "calibration": "NOT_ESTABLISHED",
              "profitability": "NOT_EVALUATED", "market_validation_established": False,
              "live_execution_allowed": False}
    if bundle is not None:
        report["feature_execution_attestation"] = "NOT_ESTABLISHED"
        report["neural_reexecution_performed_by_readout_verifier"] = False
    return model, report


def observation(episode, index, plan, bundle=None):
    row = episode["observations"][index]
    return {"alias": "sim_" + lab.digest([plan["alias_salt"], episode["base_mint"]])[:16],
            "episode_alias": "run_" + lab.digest([plan["alias_salt"], episode["episode_id"]])[:16],
            "sequence": index, "order": list(row["order"]),
            "features": features(episode, index) if bundle is None
            else list(bundle["features"][episode["episode_id"]][index])}


def public_trace(data, plan, model, bundle=None):
    episodes = validate_plan(data, plan)
    if bundle is not None:
        neural.validate_bundle(bundle, data, PIPELINE)
        lab.require(model.get("feature_export_sha256") == lab.digest(bundle), "NEURAL_MODEL_EXPORT_BINDING")
    else:
        lab.require("feature_export_sha256" not in model, "NEURAL_EXPORT_REQUIRED")
    pipeline = PIPELINE if bundle is None else bundle["pipeline"]
    lab.require(model["pipeline_sha256"] == lab.digest(pipeline), "TRADE_PIPELINE_BINDING")
    lab.require(model["dataset_sha256"] == lab.digest(data)
                and model["plan_sha256"] == lab.digest(plan), "TRADE_MODEL_INPUT_BINDING")
    examples_by_key = defaultdict(dict)
    for row in examples(data, plan, bundle)["test"]:
        examples_by_key[row["episode_id"]][row["index"]] = row
    keys = list(plan["splits"]["test"])
    random.Random(plan["shuffle_seed"] + 2).shuffle(keys)
    events = []
    for key in keys:
        episode, due = episodes[key], defaultdict(list)
        for index in range(len(episode["observations"])):
            visible = observation(episode, index, plan, bundle)
            events.append({"type": "OBSERVATION", **visible})
            for original in due.pop(index, []):
                events.append({"type": "OUTCOME", "alias": visible["alias"],
                               "episode_alias": visible["episode_alias"], "sequence": index,
                               "decision_sequence": original["index"], "label": original["y"]})
            # Always predict, including the end of an episode with no future label.
            events.append({"type": "PREDICTION", "alias": visible["alias"],
                           "episode_alias": visible["episode_alias"], "sequence": index,
                           "probability_ppm": round(lab.probability(model, visible["features"]) * 1_000_000),
                           "action": "NO_EXECUTION", "calibration": "NOT_ESTABLISHED"})
            original = examples_by_key[key].get(index)
            if original is not None:
                due[original["target_index"]].append(original)
    linked, previous = [], "0" * 64
    for event in events:
        item = {"previous_sha256": previous, "event": event}
        previous = lab.digest(item)
        linked.append({**item, "sha256": previous})
    return {"protocol": "AAI_TRADE_PREDICTION_TRACE_V1", "product": "AAI.fun",
            "classification": data["classification"], "task": TASK, "model_sha256": lab.digest(model),
            "events": linked, "head_sha256": previous,
            "availability": "TRANSACTION_ATOMIC_LEDGER_REPLAY_NOT_LIVE_LATENCY",
            "blinding": "ALIASES_ONLY_NOT_AN_INDEPENDENT_HOLDOUT", "live_execution_allowed": False}


def save_sources(archives, data, output):
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    items = []
    archives = sorted(archives, key=lambda a: (a["requested_start_slot"], a["requested_end_slot"]))
    for index, archive in enumerate(archives):
        filename = f"archive_{index:03}.json"
        ev.write(output / filename, archive)
        items.append({"name": filename, "sha256": ev.digest(archive)})
    manifest = {"protocol": "AAI_TRADE_SOURCE_PACKAGE_V1", "product": "AAI.fun",
                "archives": items, "dataset_sha256": lab.digest(data)}
    for name, value in (("dataset.json", data), ("source-manifest.json", manifest),
                        ("assessment.json", assessment(data))):
        ev.write(output / name, value)


def load_sources(directory):
    directory = Path(directory)
    manifest = ev.read(directory / "source-manifest.json")
    lab.exact(manifest, ("protocol", "product", "archives", "dataset_sha256"))
    lab.require(manifest["protocol"] == "AAI_TRADE_SOURCE_PACKAGE_V1"
                and manifest["product"] == "AAI.fun", "SOURCE_PACKAGE_PROTOCOL")
    items = manifest["archives"]
    lab.require(type(items) is list and 1 <= len(items) <= 8, "SOURCE_ARCHIVE_BOUND")
    archives = []
    for index, item in enumerate(items):
        lab.exact(item, ("name", "sha256"))
        lab.require(item["name"] == f"archive_{index:03}.json", "ARCHIVE_FILENAME")
        archive = ev.read(directory / item["name"])
        lab.require(ev.digest(archive) == lab.pin(item["sha256"]), "SOURCE_ARCHIVE_PIN")
        archives.append(archive)
    data = build_dataset(archives)
    lab.require(lab.digest(data) == manifest["dataset_sha256"]
                and lab.canonical(data) == lab.canonical(ev.read(directory / "dataset.json")),
                "SOURCE_DATASET_RECONSTRUCTION_MISMATCH")
    lab.require(lab.canonical(assessment(data)) == lab.canonical(ev.read(directory / "assessment.json")),
                "SOURCE_ASSESSMENT_MISMATCH")
    return archives, data


def prepare(archives, output):
    data = build_dataset(archives)
    save_sources(archives, data, Path(output))
    load_sources(output)
    return assessment(data)


def run(archives, plan, output, bundle=None):
    data = build_dataset(archives)
    model, report = fit(data, plan, bundle)
    trace = public_trace(data, plan, model, bundle)
    save_sources(archives, data, Path(output))
    if bundle is not None:
        ev.write(Path(output) / "neural-features.json", bundle)
    for name, value in (("plan.json", plan), ("model.json", model), ("report.json", report),
                        ("public-trace.json", trace)):
        ev.write(Path(output) / name, value)
    return {"model_sha256": lab.digest(model), "classification": data["classification"],
            "training_performed": True, "biological_core_used": bundle is not None,
            "market_validation_established": False, "live_execution_allowed": False}


def verify(directory):
    _, data = load_sources(directory)
    directory = Path(directory)
    plan = ev.read(directory / "plan.json")
    saved_model = ev.read(directory / "model.json")
    export_path = directory / "neural-features.json"
    if "feature_export_sha256" in saved_model:
        lab.require(export_path.is_file(), "NEURAL_EXPORT_REQUIRED")
        bundle = ev.read(export_path)
    else:
        lab.require(not export_path.exists(), "UNEXPECTED_NEURAL_EXPORT")
        bundle = None
    model, report = fit(data, plan, bundle)
    lab.require(lab.canonical(model) == lab.canonical(saved_model)
                and lab.canonical(report) == lab.canonical(ev.read(directory / "report.json")),
                "TRADE_TRAINING_REPLAY_MISMATCH")
    lab.require(lab.canonical(public_trace(data, plan, model, bundle))
                == lab.canonical(ev.read(directory / "public-trace.json")), "TRADE_PUBLIC_TRACE_MISMATCH")
    result = {"verified": True, "model_sha256": lab.digest(model), "classification": data["classification"],
              "training_performed": True, "biological_core_used": bundle is not None, "live_execution_allowed": False}
    if bundle is not None:
        result["neural_reexecution_performed"] = False
        result["feature_execution_attestation"] = "NOT_ESTABLISHED"
    return result
