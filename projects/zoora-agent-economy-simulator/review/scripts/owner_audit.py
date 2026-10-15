"""Independent AE-018 ownership, reserve and causal-admission audit.

The prior recovery auditor checks applied inner case/work/payment history.
This audit reconstructs every owner gate from only the prior action prefix.
Native replay additionally regenerates refused actions and fixed demo inputs.
"""
from __future__ import annotations
import copy
import json
import sys
from pathlib import Path
from trust_audit import digest
from recovery_audit import inspect_run as inspect_recovery, Policy
if not __debug__:
    raise SystemExit("Run owner audit without -O; assertions must be enabled")
CASES = ["DECLARED_WALLET_ROTATION", "LARGE_SINGLE_OBLIGATION", "TIERED_OWNER_CAPACITY",
         "UNPAID_EXPIRY_RETRY", "PARTIAL_AND_FULL_RETURN", "LATE_RECEIPT_OVERAGE",
         "DISPUTE_HOLD_PROPAGATION", "COLLECTIVE_SAME_OWNER", "COLLECTIVE_DIFFERENT_OWNERS",
         "OWNER_DOWNGRADE", "UNVERIFIED_ALIAS", "LARGE_EXACT_TOTALS", "HIDDEN_COMMON_CONTROL"]
POLICIES = ["AGENT_ONLY", "OWNER_COUNT", "OWNER_RISK"]


def run_hash(d):
    return digest("ZOORA_AE018_OWNER_RUN_V1", [d[k] for k in [
        "schema_version", "model", "classification", "input", "journal", "owners", "metrics", "recovery"]])


def campaign_hash(d):
    return digest("ZOORA_AE018_OWNER_CAMPAIGN_V1", [d[k] for k in [
        "schema_version", "model", "classification", "config", "cases"]])


def evidence_history(rows):
    works, facts, history = {}, {}, [(dict(), dict())]
    for row in rows:
        a, out = row["action"], row["outcome"]
        cmd = a["command"]
        if cmd["type"] == "TRUST" and out == dict(status="TRUST", outcome=dict(status="APPLIED")):
            x, actor = cmd["command"], cmd["actor"]
            k = x["type"]
            if k == "OPEN_CONTRACT":
                p = x["plan"]; i = p["id"]
                works[i] = dict(plan=p, contributions=[], accepted_tick=None)
                facts[i] = dict(paid=0, returned=0, delivery_digest=None, delivery_tick=None,
                                delivery=False, late_delivery=False, accepted=False)
            elif k == "CONTRIBUTE":
                works[x["contract_id"]]["contributions"].append(dict(agent=actor["agent"], artifact_digest=x["artifact_digest"]))
                works[x["contract_id"]]["contributions"].sort(key=lambda x: x["agent"])
            elif k == "DIRECT":
                x = x["command"]; k = x["type"]
                i = x["receipt"]["agreement_id"] if "receipt" in x else x["agreement_id"]
                if k == "PAYMENT_RECEIPT":
                    facts[i]["paid"] += x["receipt"]["amount"]
                elif k == "VOLUNTARY_REFUND_RECEIPT":
                    facts[i]["returned"] += x["receipt"]["amount"]
                elif k == "DELIVER":
                    facts[i].update(delivery=True, delivery_digest=x["artifact_digest"], delivery_tick=a["tick"], late_delivery=a["tick"] >= works[i]["plan"]["deadline"])
                elif k == "ACKNOWLEDGE":
                    facts[i]["accepted"] = True
                    works[i]["accepted_tick"] = a["tick"]
                else:
                    raise AssertionError("legacy claim bypass")
        history.append(copy.deepcopy((works, facts)))
    return history


def owner_states(cfg, profiles, works, facts, policy, visible, tick):
    ops, owners = cfg["recovery"]["trust"]["operators"], {}
    policy.visible = visible
    assert len(profiles) == len(ops)
    for agent, p in enumerate(profiles):
        assert p["agent"] == agent
        op = ops[agent]
        if op not in owners:
            owners[op] = dict(operator=op, agents=[], tier=p["tier"], limit_source_agent=agent,
                              work_limit=p["limits"]["work"], payment_limit=cfg["payment_caps"][p["tier"]],
                              active_agreements=[], reserved_payment_units=0, active_assigned_net_units=0,
                              active_lead_net_units=0, dispute_hold=False, over_work_limit=False, over_payment_limit=False)
        o = owners[op]; o["agents"].append(agent)
        if p["tier"] > o["tier"]:
            o.update(tier=p["tier"], limit_source_agent=agent, work_limit=p["limits"]["work"], payment_limit=cfg["payment_caps"][p["tier"]])
        o["dispute_hold"] |= p["dispute_hold"]
    for i in sorted(works):
        w, f = works[i], facts[i]
        if (f["paid"] and f["paid"] == f["returned"]) or (not f["paid"] and tick >= w["plan"]["deadline"]):
            continue
        status, _ = policy.disposition(i, w, f, tick)
        if status == "ORDINARY":
            active = not (f["accepted"] and not f["returned"])
        elif status == "ACCEPTED":
            active = not (f["paid"] == w["plan"]["payment_units"] and not f["returned"] and f["delivery"] and not f["late_delivery"])
        else:
            active = True
        if active:
            assigned = {ops[s["agent"]] for s in w["plan"]["shares"]}
            for op in assigned:
                o = owners[op]
                o["active_agreements"].append(i)
                o["reserved_payment_units"] += w["plan"]["payment_units"]
                o["active_assigned_net_units"] += f["paid"] - f["returned"]
                if ops[w["plan"]["lead"]] == op:
                    o["active_lead_net_units"] += f["paid"] - f["returned"]
    for o in owners.values():
        o["over_work_limit"] = len(o["active_agreements"]) > o["work_limit"]
        o["over_payment_limit"] = o["reserved_payment_units"] > o["payment_limit"]
        for field in ["reserved_payment_units", "active_assigned_net_units", "active_lead_net_units"]:
            o[field] = str(o[field])
    return [owners[op] for op in sorted(owners)]


def decide(cfg, policy, action, owners):
    if policy == "AGENT_ONLY":
        return None
    x = action["command"]
    if x["type"] != "TRUST" or x["actor"]["type"] != "AGENT":
        return None
    agent, cmd = x["actor"]["agent"], x["command"]
    ops = cfg["recovery"]["trust"]["operators"]
    by_op = {o["operator"]: o for o in owners}
    if cmd["type"] == "OPEN_CONTRACT" and agent == cmd["plan"]["lead"]:
        p = cmd["plan"]
        if any(s["agent"] >= len(ops) for s in p["shares"]):
            return None
        for op in sorted({ops[s["agent"]] for s in p["shares"]}):
            o = by_op[op]
            if policy == "OWNER_RISK" and o["dispute_hold"]:
                return op, "OWNER_HOLD"
            if len(o["active_agreements"]) >= o["work_limit"]:
                return op, "OWNER_WORK_LIMIT"
            if policy == "OWNER_RISK" and int(o["reserved_payment_units"]) + p["payment_units"] > o["payment_limit"]:
                return op, "OWNER_PAYMENT_LIMIT"
    elif cmd["type"] in ["CREATE_GROUP", "JOIN_GROUP"] and policy == "OWNER_RISK" and agent < len(ops):
        op = ops[agent]; o = by_op[op]
        if o["dispute_hold"] or o["over_work_limit"] or o["over_payment_limit"]:
            return op, "OWNER_HOLD"
    return None


def inspect_run(d):
    assert d["schema_version"] == 1 and d["model"] == "zoora-owner-risk-run/0.1.0"
    assert d["classification"] == "SYNTHETIC" and d["fingerprint"] == run_hash(d)
    cfg, policy = d["input"]["config"], d["input"]["policy"]
    assert policy in POLICIES and len(cfg["payment_caps"]) == 3
    assert 0 < cfg["payment_caps"][0] <= cfg["payment_caps"][1] <= cfg["payment_caps"][2] <= 2**64 - 1
    recovery, rows = d["recovery"], d["journal"]
    assert recovery["input"]["config"] == cfg["recovery"]
    inner_counts = inspect_recovery(recovery)
    inner = recovery["journal"]
    history = evidence_history(inner)
    context = Policy(cfg["recovery"], recovery["events"])
    cursor, refused, native_rejected, snapshots = 0, 0, 0, 0
    assert len(rows) == len(d["input"]["actions"]) <= 2048
    last_tick = 0
    for seq, row in enumerate(rows):
        a = row["action"]; tick = a["tick"]
        assert last_tick <= tick < cfg["recovery"]["trust"]["ticks"] - 1
        last_tick = tick
        assert row["sequence"] == seq and a == d["input"]["actions"][seq]
        assert row["advance_sequence"] == cursor
        assert inner[cursor]["action"] == dict(tick=tick, command=dict(type="ADVANCE"))
        assert inner[cursor]["outcome"] == dict(status="APPLIED")
        cursor += 1
        ws, fs = history[cursor]
        before = owner_states(cfg, inner[cursor-1]["profiles_after"], ws, fs, context, cursor, tick)
        decision = decide(cfg, policy, a, before)
        if decision is not None:
            op, reason = decision
            assert row["delegated_sequence"] is None
            assert row["outcome"] == dict(status="REFUSED", operator=op, reason=reason)
            refused += 1
        else:
            assert row["delegated_sequence"] == cursor and inner[cursor]["action"] == a
            outcome = inner[cursor]["outcome"]
            assert row["outcome"] == dict(status="FORWARDED", outcome=outcome)
            native_rejected += (outcome["status"] == "REJECTED" or
                                outcome == dict(status="TRUST", outcome=dict(status="REJECTED", reason=outcome.get("outcome", {}).get("reason"))))
            cursor += 1
        ws, fs = history[cursor]
        after = owner_states(cfg, inner[cursor-1]["profiles_after"], ws, fs, context, cursor, tick)
        assert row["owners_after"] == after, (seq, a["command"]["type"])
        snapshots += len(after)
    assert cursor == len(inner)
    ws, fs = history[-1]
    final = owner_states(cfg, recovery["trust"]["profiles"], ws, fs, context, cursor, cfg["recovery"]["trust"]["ticks"]-1)
    assert d["owners"] == final
    direct = recovery["trust"]["direct"]["metrics"]
    assert d["metrics"] == dict(owner_rejections=refused, delegated_rejections=native_rejected,
        agreements_opened=len(recovery["trust"]["contracts"]), payments_recorded=direct["payments_recorded"],
        voluntary_returns_recorded=direct["voluntary_refunds_recorded"], net_transferred=direct["net_transferred"])
    return dict(original_actions=len(rows), inner_actions=inner_counts["actions"],
                profiles_checked=inner_counts["profiles_checked"], owner_snapshots_checked=snapshots+len(final),
                owner_rejections=refused, agreements=len(recovery["trust"]["contracts"]))


def inspect_campaign(d):
    assert d["schema_version"] == 1 and d["model"] == "zoora-owner-risk-campaign/0.1.0"
    assert d["classification"] == "SYNTHETIC" and d["fingerprint"] == campaign_hash(d)
    assert [c["name"] for c in d["cases"]] == CASES
    results = []
    original_actions = 0
    for c in d["cases"]:
        cfg = copy.deepcopy(d["config"])
        if c["name"] == "LARGE_EXACT_TOTALS":
            cfg["payment_caps"] = [2**64-1] * 3
        if c["name"] == "HIDDEN_COMMON_CONTROL":
            cfg["recovery"]["trust"]["operators"][5] = 50
            cfg["recovery"]["trust"]["operators"][7] = 70
        assert c["config"] == cfg
        assert [r["input"]["policy"] for r in c["runs"]] == POLICIES
        for r in c["runs"]:
            assert r["input"]["config"] == cfg and r["input"]["actions"] == c["actions"]
            results.append(inspect_run(r))
        original_actions += len(c["actions"])
    totals = {k: sum(r[k] for r in results) for k in results[0]}
    totals.update(scenarios=len(CASES), policy_runs=len(results), unique_original_actions=original_actions)
    return totals


if __name__ == "__main__":
    d = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    print(json.dumps(inspect_campaign(d) if d.get("model") == "zoora-owner-risk-campaign/0.1.0" else inspect_run(d), sort_keys=True))
