"""Read-only paper capture and offline cohort accounting. No model or order execution."""

import argparse
import hashlib
import os
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
COMMUNITY = ROOT / "projects" / "zoora-agent-community"
sys.path.insert(0, str(COMMUNITY))

from zoora_community.client import agent_client, read_credential  # noqa: E402
from zoora_community.practice_journal import (  # noqa: E402
    Journal, bounded, digest, order_body, review_locked,
)
from zoora_community.store import exclusive_file, now_ms, private_regular  # noqa: E402
from zoora_community.validation import (  # noqa: E402
    DIGEST, Problem, canonical, fields, identifier, matching, parse_json, text,
)

LIMIT = 1_048_576
PLAN = "ZOORA_PAPER_COHORT_PLAN_V1"
BUNDLE = "ZOORA_PAPER_COHORT_BUNDLE_V1"
CAPTURE = "ZOORA_PAPER_CAPTURE_V1"
IDENTITY = ("experiment_id", "instance_id", "episode_id", "agent_id", "model_pipeline_sha256")
# Independently specified accounting contract; do not call the simulator's quote/accounting functions.
POLICY = {"initial_cash_micro": 10_000_000_000, "max_order_micro": 250_000_000,
          "max_position_micro": 1_000_000_000, "gas_micro": 1000, "fee_ppm": 10_000,
          "drawdown_halt_ppm": 200_000, "latency_ticks": 1,
          "quote_unit": "MICRO_DEMO_USD", "base_unit": "WHOLE_SYNTHETIC_TOKEN"}


def require(condition, code):
    if not condition:
        raise Problem(409, code)


def read_document(path):
    path = Path(path)
    private_regular(path, LIMIT)
    raw = path.read_bytes()
    return parse_json(raw, LIMIT), hashlib.sha256(raw).hexdigest()


def write_document(path, value):
    raw = (canonical(value) + "\n").encode("utf-8")
    require(len(raw) <= LIMIT, "EVALUATION_DOCUMENT_TOO_LARGE")
    with exclusive_file(path) as output:
        require(output.write(raw) == len(raw), "EVALUATION_SHORT_WRITE")
        output.flush()
        os.fsync(output.fileno())
    return hashlib.sha256(raw).hexdigest()


def array(value, maximum):
    require(type(value) is list and len(value) <= maximum, "EVALUATION_INVALID_ARRAY")
    return value


def number(value, low=0, high=9_000_000_000_000_000):
    return bounded(value, low, high)


def coins_in(frame, tick):
    require(type(frame) is dict and frame.get("version") == "SYNTHETIC_MEME_V1"
            and frame.get("classification") == "SYNTHETIC_TRAINING"
            and frame.get("live_execution_allowed") is False, "EVALUATION_MARKET_CONTRACT")
    require(type(frame.get("tick")) is int and frame["tick"] == tick
            and canonical(frame.get("policy")) == canonical(POLICY)
            and frame.get("status") == ("CLOSED" if tick == 120 else "OPEN"),
            "EVALUATION_MARKET_CONTRACT")
    coins = {}
    for coin in array(frame.get("coins"), 8):
        require(type(coin) is dict, "EVALUATION_INVALID_COIN")
        key = identifier(coin["id"])
        require(key not in coins and coin["stage"] in ("CURVE", "AMM", "MIGRATING", "HALTED"),
                "EVALUATION_INVALID_COIN")
        for field in ("quote_liquidity_micro", "effective_quote_micro", "available_base_tokens"):
            number(coin[field])
        number(coin["effective_base_tokens"], 1)
        coins[key] = coin
    require(bool(coins), "EVALUATION_EMPTY_MARKET")
    return coins


def validate_capture(value):
    fields(value, ("protocol", "source", "captured_at_ms", "manifest_sha256", "journal_evidence_sha256",
                   "instance_id", "episode_id", "agent_id", "commitment", "credential_id",
                   "market", "account", "history", "receipts"))
    require(value["protocol"] == CAPTURE and value["source"] == "AUTHENTICATED_READ_ONLY_API",
            "EVALUATION_CAPTURE_PROTOCOL")
    number(value["captured_at_ms"], 1)
    for key in ("manifest_sha256", "journal_evidence_sha256", "commitment"):
        matching(value[key], DIGEST, "EVALUATION_INVALID_DIGEST")
    for key in ("instance_id", "episode_id", "agent_id", "credential_id"):
        identifier(value[key])
    tick = number(value["market"]["tick"], 0, 120)
    history = array(value["history"], 121)
    require(len(history) == tick + 1 and history[-1] == value["market"], "EVALUATION_HISTORY_GAP")
    for index, frame in enumerate(history):
        coins_in(frame, index)
    account = value["account"]
    require(type(account) is dict and account["agent_id"] == value["agent_id"]
            and account["live_execution_allowed"] is False
            and account["model_identity"] == "CREATOR_DECLARED_UNATTESTED"
            and account["model_training"] == "NOT_PERFORMED_BY_SIMULATOR",
            "EVALUATION_ACCOUNT_BINDING")
    matching(account["model_pipeline_sha256"], DIGEST, "EVALUATION_INVALID_DIGEST")
    array(value["receipts"], 64)
    return tick


def capture(journal_dir, credential_file, out, *, port=8765, community_origin=None):
    require(Path(journal_dir).is_dir(), "EVALUATION_JOURNAL_MISSING")
    journal = Journal(journal_dir)
    with journal.locked():
        manifest = journal.read("manifest.json")
        review = review_locked(journal, manifest)
        scope = manifest["scope"]
        require(community_origin == manifest["origin"], "EVALUATION_ORIGIN_CHANGED")
        client = agent_client(port, origin=community_origin, expected_instance=scope["instance_id"],
                              expected_agent=scope["agent_id"])
        client.deadline = time.monotonic() + 60
        token = read_credential(credential_file)
        principal = client.request("GET", "/v1/me", token=token)[1]
        require(principal["role"] == "AGENT" and principal["principal_id"] == scope["agent_id"],
                "EVALUATION_AGENT_REQUIRED")
        base = "/v1/practice/episodes/" + scope["episode_id"]
        account_path = base + "/accounts/" + scope["agent_id"]
        first = client.request("GET", base, token=token)[1]
        account = client.request("GET", account_path, token=token)[1]
        history = client.request("GET", base + "/history", token=token)[1]["items"]
        receipts, cursor = [], None
        for _ in range(2):
            page = client.request("GET", account_path + "/orders?limit=50"
                                  + ("&after=" + cursor if cursor else ""), token=token)[1]
            receipts.extend(array(page["items"], 50))
            cursor = page["next_after"]
            if cursor is None:
                break
            identifier(cursor)
        require(cursor is None, "EVALUATION_RECEIPT_BOUND")
        account_after = client.request("GET", account_path, token=token)[1]
        second = client.request("GET", base, token=token)[1]
        require(first == second and account == account_after and first["id"] == scope["episode_id"],
                "EVALUATION_SNAPSHOT_CHANGED")
        require(account["model_pipeline_sha256"] == scope["model_pipeline_sha256"],
                "EVALUATION_PIPELINE_CHANGED")
        result = {"protocol": CAPTURE, "source": "AUTHENTICATED_READ_ONLY_API",
                  "captured_at_ms": now_ms(), "manifest_sha256": digest(manifest),
                  "journal_evidence_sha256": review["evidence_sha256"],
                  "instance_id": scope["instance_id"], "episode_id": scope["episode_id"],
                  "agent_id": scope["agent_id"], "commitment": first["commitment"],
                  "credential_id": principal["credential_id"], "market": first["market"],
                  "account": account, "history": history, "receipts": receipts}
        tick = validate_capture(result)
        sha = write_document(out, result)
        return {"capture_sha256": sha, "tick": tick, "status": result["market"]["status"],
                "classification": "SYNTHETIC_PAPER", "live_execution_allowed": False}


def validate_plan(plan):
    fields(plan, ("protocol", "plan_id", "created_at_ms", "unit", "entries"))
    require(plan["protocol"] == PLAN and plan["unit"] == "MICRO_DEMO_USD", "EVALUATION_PLAN_PROTOCOL")
    identifier(plan["plan_id"])
    number(plan["created_at_ms"], 1)
    entries = array(plan["entries"], 16)
    require(bool(entries), "EVALUATION_EMPTY_PLAN")
    seen, accounts = set(), set()
    for entry in entries:
        fields(entry, (*IDENTITY, "label"))
        for key in IDENTITY[:-1]:
            identifier(entry[key])
        matching(entry["model_pipeline_sha256"], DIGEST, "EVALUATION_INVALID_DIGEST")
        text(entry["label"], 96)
        account = tuple(entry[key] for key in ("instance_id", "episode_id", "agent_id"))
        require(entry["experiment_id"] not in seen and account not in accounts,
                "EVALUATION_DUPLICATE_PLAN_ENTRY")
        seen.add(entry["experiment_id"])
        accounts.add(account)
    return {entry["experiment_id"]: entry for entry in entries}


def bundle_entries(bundle, plan, entries):
    fields(bundle, ("protocol", "plan_sha256", "entries"))
    require(bundle["protocol"] == BUNDLE and bundle["plan_sha256"] == digest(plan),
            "EVALUATION_PLAN_PIN_MISMATCH")
    result, paths = {}, set()
    for entry in array(bundle["entries"], 16):
        fields(entry, ("experiment_id", "journal_dir", "capture_file", "capture_sha256"))
        key = identifier(entry["experiment_id"])
        require(key in entries and key not in result, "EVALUATION_UNPLANNED_OR_DUPLICATE_ENTRY")
        for field in ("journal_dir", "capture_file"):
            text(entry[field], 4096)
            path = (field, entry[field])
            require(path not in paths, "EVALUATION_REUSED_EVIDENCE_PATH")
            paths.add(path)
        matching(entry["capture_sha256"], DIGEST, "EVALUATION_INVALID_DIGEST")
        result[key] = entry
    return result


def fee(gross):
    return (gross * POLICY["fee_ppm"] + 999_999) // 1_000_000


def exit_value(coin, tokens):
    if tokens == 0 or coin["stage"] not in ("CURVE", "AMM"):
        return 0
    gross = coin["effective_quote_micro"] * tokens // (coin["effective_base_tokens"] + tokens)
    if not 0 < gross <= coin["quote_liquidity_micro"]:
        return 0
    return max(0, gross - fee(gross) - POLICY["gas_micro"])


def accounting(value, manifest, records):
    account, market = value["account"], value["market"]
    coins = coins_in(market, market["tick"])
    expected = {}
    for tick, record in sorted(records.items()):
        observation = record["observation"]
        snapshot = observation["snapshot"]
        require(snapshot["commitment"] == value["commitment"]
                and snapshot["market"] == value["history"][tick],
                "EVALUATION_OBSERVATION_CHANGED")
        decision = record.get("decision")
        if decision is not None and decision["action"]["side"] != "HOLD" and "failure" not in record:
            body = order_body(manifest, snapshot, decision["action"])
            expected[body["request_id"]] = (body, record)
    cash, fees, gas = POLICY["initial_cash_micro"], 0, 0
    positions, seen = {}, set()
    filled, rejected, last_sequence = 0, 0, 0
    for receipt in value["receipts"]:
        require(type(receipt) is dict, "EVALUATION_INVALID_RECEIPT")
        key = identifier(receipt["request_id"])
        require(key not in seen and key in expected, "EVALUATION_UNTRACKED_OR_DUPLICATE_ORDER")
        body, record = expected[key]
        require(all(canonical(receipt.get(k)) == canonical(v) for k, v in body.items()),
                "EVALUATION_ORDER_BODY_CHANGED")
        if "settlement" in record:
            require(record["settlement"]["receipt"] == receipt, "EVALUATION_SETTLEMENT_CHANGED")
        sequence = number(receipt["sequence"], last_sequence + 1)
        last_sequence = sequence
        require(type(receipt["fill_tick"]) is int and receipt["fill_tick"] == body["observation_tick"] + 1
                and receipt["fill_tick"] <= market["tick"], "EVALUATION_FILL_CLOCK")
        require(number(receipt["gas_micro"]) == POLICY["gas_micro"], "EVALUATION_GAS_MISMATCH")
        cash -= POLICY["gas_micro"]
        gas += POLICY["gas_micro"]
        output, paid_fee = number(receipt["output"]), number(receipt["fee_micro"])
        coin_id, amount = body["coin_id"], body["amount"]
        require(coin_id in coins, "EVALUATION_UNKNOWN_POSITION")
        if receipt["state"] == "FILLED":
            require(output >= body["min_output"] and receipt["reason"] is None, "EVALUATION_INVALID_FILL")
            if body["side"] == "BUY":
                require(paid_fee == fee(amount), "EVALUATION_FEE_MISMATCH")
                cash -= amount
                positions[coin_id] = positions.get(coin_id, 0) + output
            else:
                require(paid_fee == fee(output + paid_fee), "EVALUATION_FEE_MISMATCH")
                require(positions.get(coin_id, 0) >= amount, "EVALUATION_NEGATIVE_POSITION")
                cash += output
                positions[coin_id] -= amount
            filled += 1
            fees += paid_fee
        else:
            require(receipt["state"] == "REJECTED" and output == 0 and paid_fee == 0
                    and receipt["reason"] in ("ACCESS_REVOKED", "NO_LIQUIDITY_OR_MARKET_UNAVAILABLE",
                                              "MIN_OUTPUT", "DRAWDOWN_HALT", "INSUFFICIENT_CASH",
                                              "POSITION_LIMIT"), "EVALUATION_INVALID_REJECTION")
            rejected += 1
        require(cash >= 0 and number(receipt["cash_after_micro"]) == cash, "EVALUATION_RECEIPT_CASH_MISMATCH")
        seen.add(key)
    require(seen == set(expected), "EVALUATION_UNSETTLED_DECISION")
    require(number(account["order_count"], 0, 64) == len(seen)
            and number(account["initial_cash_micro"]) == POLICY["initial_cash_micro"]
            and number(account["cash_benchmark_micro"]) == POLICY["initial_cash_micro"]
            and number(account["cash_micro"]) == cash
            and number(account["fees_micro"]) == fees and number(account["gas_micro"]) == gas,
            "EVALUATION_ACCOUNT_TOTALS_MISMATCH")
    observed_positions, exits = {}, 0
    for position in array(account["positions"], 8):
        fields(position, ("coin_id", "tokens", "net_exit_micro"))
        key = identifier(position["coin_id"])
        require(key in coins and key not in observed_positions, "EVALUATION_UNKNOWN_POSITION")
        quantity = number(position["tokens"])
        observed_positions[key] = quantity
        marked = exit_value(coins[key], quantity)
        require(number(position["net_exit_micro"]) == marked, "EVALUATION_EXIT_ESTIMATE_MISMATCH")
        exits += marked
    require({k: v for k, v in positions.items() if v}
            == {k: v for k, v in observed_positions.items() if v}, "EVALUATION_POSITION_MISMATCH")
    equity = cash + exits
    require(number(account["liquidation_equity_micro"]) == equity
            and number(account["net_pnl_micro"], -9_000_000_000_000_000)
            == equity - POLICY["initial_cash_micro"], "EVALUATION_EQUITY_MISMATCH")
    drawdown = number(account["max_drawdown_ppm"], 0, 1_000_000)
    return {"cash_baseline_micro": POLICY["initial_cash_micro"], "cash_micro": cash,
            "cash_change_micro": cash - POLICY["initial_cash_micro"],
            "holdings_exit_estimate_micro": exits, "total_exit_estimate_micro": equity,
            "exit_estimate_excess_vs_cash_micro": equity - POLICY["initial_cash_micro"],
            "fees_micro": fees, "gas_micro": gas, "filled_orders": filled, "rejected_orders": rejected,
            "reported_max_drawdown_ppm": drawdown, "drawdown_verification": "SERVER_REPORTED_ONLY",
            "valuation": "CURRENT_RESERVE_EXIT_ESTIMATE_NOT_REALIZED_OR_GUARANTEED"}


def evaluate_entry(plan, entry, bundle, root):
    journal_path, capture_path = root / bundle["journal_dir"], root / bundle["capture_file"]
    require(journal_path.is_dir(), "EVALUATION_JOURNAL_MISSING")
    journal = Journal(journal_path)
    with journal.locked():
        manifest = journal.read("manifest.json")
        review = review_locked(journal, manifest)
        records = journal.records(manifest)
        value, sha = read_document(capture_path)
        require(sha == bundle["capture_sha256"], "EVALUATION_CAPTURE_PIN_MISMATCH")
        tick = validate_capture(value)
        require(all(manifest["scope"][key] == entry[key] for key in IDENTITY)
                and all(value[key] == entry[key] for key in ("instance_id", "episode_id", "agent_id"))
                and value["account"]["model_pipeline_sha256"] == entry["model_pipeline_sha256"],
                "EVALUATION_IDENTITY_MISMATCH")
        require(value["manifest_sha256"] == digest(manifest)
                and value["journal_evidence_sha256"] == review["evidence_sha256"],
                "EVALUATION_JOURNAL_PIN_MISMATCH")
        require(bool(records), "EVALUATION_NO_OBSERVATIONS")
        observed_times = [number(r["observation"]["observed_at_ms"], 1) for r in records.values()]
        require(plan["created_at_ms"] <= min(observed_times), "EVALUATION_PLAN_DECLARED_TOO_LATE")
        require(value["captured_at_ms"] >= max(observed_times) and tick >= max(records),
                "EVALUATION_CAPTURE_CLOCK")
        for observed_tick, record in records.items():
            snapshot = record["observation"]["snapshot"]
            require(snapshot["commitment"] == value["commitment"]
                    and snapshot["market"] == value["history"][observed_tick],
                    "EVALUATION_OBSERVATION_CHANGED")
            if "decision" in record:
                decided = number(record["decision"]["decided_at_ms"], 1)
                require(record["observation"]["observed_at_ms"] <= decided <= value["captured_at_ms"],
                        "EVALUATION_DECISION_CLOCK")
        pins = {"capture_sha256": sha, "journal_evidence_sha256": review["evidence_sha256"]}
        if tick != 120 or value["account"]["pending"] is not None:
            return {"status": "INTERIM", "reason": "EPISODE_NOT_CLOSED_OR_ORDER_PENDING",
                    "pins": pins, "counts": review["counts"], "accounting": None}
        if any("failure" in r or "decision" not in r for r in records.values()):
            return {"status": "FAILED_TRIAL", "reason": "RETAINED_INFERENCE_OR_DELIVERY_FAILURE",
                    "pins": pins, "counts": review["counts"], "accounting": None}
        totals = accounting(value, manifest, records)
        return {"status": "COMPLETE", "reason": None, "pins": pins,
                "counts": review["counts"], "accounting": totals}


def evaluate(plan_file, bundle_file, out):
    plan, plan_bytes_sha = read_document(plan_file)
    bundle, bundle_bytes_sha = read_document(bundle_file)
    entries = validate_plan(plan)
    evidence = bundle_entries(bundle, plan, entries)
    root = Path(bundle_file).absolute().parent
    rows = []
    for key, entry in entries.items():
        row = {"experiment_id": key, "label": entry["label"]}
        if key not in evidence:
            row.update(status="MISSING", reason="PLANNED_TRIAL_MISSING", accounting=None)
        else:
            try:
                row.update(evaluate_entry(plan, entry, evidence[key], root))
            except (Problem, OSError, KeyError, TypeError, ValueError) as error:
                row.update(status="INVALID", reason=error.code if isinstance(error, Problem)
                           else "EVALUATION_EVIDENCE_UNREADABLE", accounting=None)
        rows.append(row)
    complete = all(row["status"] == "COMPLETE" for row in rows)
    summary = None
    if complete:
        summary = {"completed_trials": len(rows),
                   "sum_exit_estimate_excess_vs_cash_micro": sum(
                       row["accounting"]["exit_estimate_excess_vs_cash_micro"] for row in rows),
                   "interpretation": "DESCRIPTIVE_ACCOUNTING_ONLY_NOT_ESTIMATED_EDGE"}
    report = {"protocol": "ZOORA_PAPER_COHORT_REPORT_V1",
              "status": "COHORT_COMPLETE" if complete else "COHORT_INCOMPLETE",
              "plan_sha256": digest(plan), "plan_file_sha256": plan_bytes_sha,
              "bundle_file_sha256": bundle_bytes_sha, "planned_trials": len(entries),
              "rows": rows, "summary": summary, "unit": "MICRO_DEMO_USD",
              "classification": "SYNTHETIC_PAPER", "external_attestation": "UNAVAILABLE",
              "preregistration": "HOST_DECLARED_CLOCK_ONLY_NOT_EXTERNALLY_ATTESTED",
              "model_identity": "HOST_DECLARED_NOT_ATTESTED", "model_training": "NOT_PERFORMED",
              "performance_edge": "NOT_ESTABLISHED", "live_execution_allowed": False}
    sha = write_document(out, report)
    return {"report_sha256": sha, "status": report["status"], "planned_trials": len(entries),
            "completed_trials": sum(r["status"] == "COMPLETE" for r in rows),
            "live_execution_allowed": False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    collect = sub.add_parser("capture", help="Read one stable authenticated account and observed market history.")
    collect.add_argument("--journal-dir", required=True)
    collect.add_argument("--credential-file", required=True)
    collect.add_argument("--out", required=True)
    collect.add_argument("--port", type=int, default=8765)
    collect.add_argument("--community-origin")
    compare = sub.add_parser("evaluate", help="Check all declared trials offline against a cash baseline.")
    compare.add_argument("--plan", required=True)
    compare.add_argument("--bundle", required=True)
    compare.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "capture":
            result = capture(args.journal_dir, args.credential_file, args.out,
                             port=args.port, community_origin=args.community_origin)
        else:
            result = evaluate(args.plan, args.bundle, args.out)
        print(canonical(result))
        return 2 if result.get("status") == "COHORT_INCOMPLETE" else 0
    except (Problem, OSError, KeyError, TypeError, ValueError) as error:
        print(canonical({"error": error.code if isinstance(error, Problem)
                         else "EVALUATION_INPUT_OR_STORAGE_UNAVAILABLE"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
