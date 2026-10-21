"""Typed AAI.fun research handoffs; forecasts do not confer execution authority."""
from __future__ import annotations

from collections import Counter
from pathlib import Path

from ..multi_brain_research import trade_learning as trade
from ..multi_brain_research import training_lab as lab
from ..multi_brain_research import neural_features as neural
from ..multi_brain_research.consensus import ModuleSpec
from ..solana_research import coin_evidence as ev

MAX_ASSETS = 32
MAX_FORECASTS = 2048
LOCK_PATH = Path(__file__).resolve().parents[2] / "research/ecosystem/components.json"


def validate_lock(value):
    lab.exact(value, ("protocol", "repository", "components", "mode"))
    lab.require(value["protocol"] == "AAI_ECOSYSTEM_COMPONENT_LOCK_V1"
                and value["repository"] == "BuildWithAAI/buildwithAAI"
                and value["mode"] == "RESEARCH_SANDBOX_NO_SETTLEMENT", "ECOSYSTEM_LOCK_PROTOCOL")
    lab.exact(value["components"], ("scanner", "community"))
    for key, component in value["components"].items():
        lab.exact(component, ("commit", "package", "used_interfaces", "pr"))
        commit = component["commit"]
        lab.require(type(commit) is str and len(commit) == 40
                    and all(c in "0123456789abcdef" for c in commit), "COMPONENT_COMMIT")
        expected = "src/aai_scanner" if key == "scanner" else "projects/zoora-agent-community"
        lab.require(component["package"] == expected, "COMPONENT_PACKAGE")
        lab.require(type(component["used_interfaces"]) is list
                    and all(type(i) is str and 1 <= len(i) <= 64 for i in component["used_interfaces"]),
                    "COMPONENT_INTERFACES")
        ev.integer(component["pr"], 1, 1_000_000)
    return value


def assets(data):
    trade.validate_dataset(data)
    result = {}
    for episode in data["episodes"]:
        mint, decimals = episode["base_mint"], episode["base_decimals"]
        lab.require(mint not in result or result[mint] == decimals, "ECOSYSTEM_MINT_DECIMALS")
        result[mint] = decimals
    lab.require(1 <= len(result) <= MAX_ASSETS, "ECOSYSTEM_ASSET_BOUND")
    return dict(sorted(result.items()))


def source_projection(data):
    return {"protocol": "AAI_ECOSYSTEM_SOURCE_REPORT_V1",
            "dataset_sha256": lab.digest(data), "assessment": trade.assessment(data),
            "live_execution_allowed": False}


def forecasts(data, model, plan, bundle=None):
    """Apply a verified frozen readout to new observations without fitting target data."""
    trade.validate_dataset(data)
    lab.require(model["protocol"] == "AAI_TRADE_LOGISTIC_READOUT_V1"
                and model["task"] == trade.TASK and model["calibration"] == "NOT_ESTABLISHED"
                and model["live_execution_allowed"] is False, "ECOSYSTEM_READOUT_SCOPE")
    pipeline = trade.PIPELINE if bundle is None else bundle["pipeline"]
    lab.require(model["pipeline_sha256"] == lab.digest(pipeline), "ECOSYSTEM_FEATURE_PIPELINE")
    if "feature_export_sha256" in model:
        lab.require(bundle is not None, "NEURAL_EXPORT_REQUIRED")
    else:
        lab.require(bundle is None, "UNEXPECTED_NEURAL_EXPORT")
    exported = None if bundle is None else neural.validate_bundle(bundle, data, trade.PIPELINE)
    lab.require(model["plan_sha256"] == lab.digest(plan), "ECOSYSTEM_TRAINING_PLAN")
    count = sum(len(e["observations"]) for e in data["episodes"])
    lab.require(1 <= count <= MAX_FORECASTS, "ECOSYSTEM_FORECAST_BOUND")
    rows = []
    for episode in data["episodes"]:
        for index, observation in enumerate(episode["observations"]):
            values = trade.features(episode, index) if exported is None else exported[episode["episode_id"]][index]
            probability = lab.probability(model, values)
            lab.finite(probability, 0, 1)
            rows.append({"episode_id": episode["episode_id"], "sequence": index,
                         "order": list(observation["order"]),
                         "prediction_ppm": round(probability * 1_000_000),
                         "calibration": "NOT_ESTABLISHED", "action": "NO_EXECUTION"})
    return {"protocol": "AAI_ECOSYSTEM_FORECAST_REPORT_V1",
            "classification": data["classification"], "dataset_sha256": lab.digest(data),
            "training_dataset_sha256": model["dataset_sha256"], "model_sha256": lab.digest(model),
            "pipeline_sha256": lab.digest(pipeline),
            "task": {"name": trade.TASK, "horizon_unit": "LATER_MARKET_TRANSACTIONS",
                     "count": plan["horizon_transactions"], "max_horizon_slots": plan["max_horizon_slots"]},
            "feature_export_sha256": lab.digest(bundle) if bundle is not None else None,
            "rows": rows, "training_on_target_performed": False,
            "feature_execution_attestation": "NOT_ESTABLISHED",
            "market_validation_established": False, "live_execution_allowed": False}


def gate(forecast, model):
    lab.require(forecast["model_sha256"] == lab.digest(model)
                and forecast["task"]["name"] == trade.TASK
                and forecast["task"]["horizon_unit"] == "LATER_MARKET_TRANSACTIONS",
                "ECOSYSTEM_FORECAST_BINDING")
    # The existing registry can describe missing calibration without inventing a receipt.
    is_neural = "feature_export_sha256" in model
    pipeline = neural.expected_pipeline(trade.PIPELINE) if is_neural else trade.PIPELINE
    lab.require(model["pipeline_sha256"] == lab.digest(pipeline)
                and forecast["pipeline_sha256"] == model["pipeline_sha256"], "REGISTRY_PIPELINE_BINDING")
    spec = ModuleSpec("trade_readout", "aai_trade_research",
                      pipeline["connectome_sha256"] if is_neural else None,
                      pipeline["checkpoint_sha256"] if is_neural else None,
                      lab.digest(pipeline["encoder"]) if is_neural else lab.digest(pipeline),
                      lab.digest(model), None)
    missing = list(spec.missing_components())
    return {"protocol": "AAI_ECOSYSTEM_RESEARCH_GATE_V1", "model_sha256": lab.digest(model),
            "forecast_sha256": lab.digest(forecast), "qualified_model_count": 0,
            "required_qualified_models": 2, "registered_pipeline_sha256": spec.pipeline_sha256(),
            "missing_pipeline_components": missing,
            "legacy_coordinator": "BLOCKED_TRANSACTION_HORIZON_IS_NOT_MILLISECONDS",
            "reasons": ["CALIBRATION_NOT_ESTABLISHED", "SECOND_QUALIFIED_MODEL_MISSING",
                        "HISTORICAL_RISK_NOT_VERIFIED", "EXECUTABLE_QUOTES_UNAVAILABLE",
                        "COORDINATOR_HORIZON_ADAPTER_REQUIRED"],
            "research_signal": "ABSTAIN", "action": "NO_EXECUTION",
            "live_execution_allowed": False}


def inspection_projection(mint, parsed, expected_decimals):
    ev.key(mint)
    lab.require(type(parsed) is dict and parsed.get("mint") == mint, "SCANNER_MINT_BINDING")
    status = parsed.get("status")
    lab.require(status in ("AVAILABLE", "UNAVAILABLE", "UNVERIFIED"), "SCANNER_STATUS")
    if status == "AVAILABLE":
        lab.require(parsed["decimals"] == expected_decimals, "SCANNER_SOURCE_DECIMALS_MISMATCH")
    return {"mint": mint, "status": status, "source": parsed["evidence"],
            "token_program": parsed.get("token_program"),
            "decimals": parsed.get("decimals"), "supply_raw": parsed.get("supply_raw"),
            "mint_authority_present": parsed.get("mint_authority") is not None if status == "AVAILABLE" else None,
            "freeze_authority_present": parsed.get("freeze_authority") is not None if status == "AVAILABLE" else None,
            "extension_type_ids": parsed.get("extension_type_ids", []),
            "reason": parsed.get("reason"), "quality_flags": list(parsed.get("quality_flags", [])),
            "scope": "CURRENT_RPC_AFTER_SOURCE_WINDOW",
            "historical_risk_verified": False, "safety_established": False}


def public_snapshot(source, forecast, decision, inspections, job_states):
    lab.require(source["dataset_sha256"] == forecast["dataset_sha256"], "PUBLIC_SOURCE_BINDING")
    lab.require(decision["forecast_sha256"] == lab.digest(forecast)
                and decision["action"] == "NO_EXECUTION" and decision["research_signal"] == "ABSTAIN",
                "PUBLIC_GATE_BINDING")
    lab.require(job_states == {"source_auditor": "SUCCEEDED", "forecast_reviewer": "SUCCEEDED"},
                "PUBLIC_JOB_STATE")
    study_id = lab.digest([source["dataset_sha256"], forecast["model_sha256"]])
    return {"protocol": "AAI_ECOSYSTEM_PUBLIC_SNAPSHOT_V1", "study_id": study_id,
            "mode": "RESEARCH_SANDBOX", "source_classification": forecast["classification"],
            "observation_count": len(forecast["rows"]), "mint_review_count": len(inspections),
            "mint_status_counts": dict(sorted(Counter(p["status"] for p in inspections).items())),
            "jobs": dict(job_states), "research_signal": "ABSTAIN",
            "reasons": list(decision["reasons"]), "live_execution_allowed": False,
            "agent_identities": "DISPOSABLE_LOCAL_TEST_RECORDS",
            "payments_performed": False, "model_training_on_target_performed": False,
            "legacy_coordinator": decision["legacy_coordinator"]}


def public_events(snapshot):
    lab.require(snapshot["protocol"] == "AAI_ECOSYSTEM_PUBLIC_SNAPSHOT_V1", "PUBLIC_PROTOCOL")
    events = [{"type": "SOURCE_VERIFIED", "observations": snapshot["observation_count"]},
              {"type": "MINTS_REVIEWED", "count": snapshot["mint_review_count"]},
              {"type": "RESEARCH_JOB_COMPLETED", "role": "source_auditor"},
              {"type": "RESEARCH_JOB_COMPLETED", "role": "forecast_reviewer"},
              {"type": "RESEARCH_GATE", "signal": "ABSTAIN", "action": "NO_EXECUTION"}]
    previous, result = "0" * 64, []
    for sequence, event in enumerate(events):
        item = {"sequence": sequence, "study_id": snapshot["study_id"],
                "previous_sha256": previous, "event": event}
        previous = lab.digest(item)
        result.append({**item, "sha256": previous})
    return {"protocol": "AAI_ECOSYSTEM_ACTIVITY_EVENTS_V1", "classification": "LOCAL_RESEARCH_ACTIVITY",
            "events": result, "head_sha256": previous, "live_execution_allowed": False}
