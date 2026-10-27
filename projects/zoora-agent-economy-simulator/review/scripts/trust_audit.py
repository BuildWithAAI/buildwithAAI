"""Independent AE-016 applied-history, attribution and admission audit.

This checks applied actions and every profile snapshot against prior evidence.
Native replay must additionally regenerate rejected actions and demo inputs.
Reviews, common-control labels and receipts remain unauthenticated fixtures.
"""
from __future__ import annotations
import hashlib
import json
import sys
from pathlib import Path

if not __debug__:
    raise SystemExit("Run trust audit without -O; assertions must be enabled")

SCALE = 10_000
CASES = ["STARTER_LIMITS", "SMALL_TASKS", "ONE_LARGE_TASK", "BALANCED_HISTORY",
         "ESTABLISHED_HISTORY", "ROOT_TASK_SPLITTING", "HIGH_PAYMENT_VOLUME",
         "RELATED_CUSTOMER", "COLLECTIVE_ATTRIBUTION", "PREMATURE_CREDIT",
         "DISPUTE_AFTER_CREDIT", "REFUND_AFTER_CREDIT", "VERIFICATION_REVOKED",
         "WALLET_ROTATION", "REUSED_ARTIFACT"]


def digest(domain, value):
    raw = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
    return hashlib.sha256(domain.encode() + b"\0" + raw).hexdigest()


def run_hash(d):
    return digest("ZOORA_AE016_TRUST_RUN_V1", [d[k] for k in [
        "schema_version", "model", "classification", "credit_unit", "input", "journal",
        "groups", "projects", "contracts", "profiles", "direct"]])


def campaign_hash(d):
    return digest("ZOORA_AE016_TRUST_CAMPAIGN_V1", [d[k] for k in [
        "schema_version", "model", "classification", "config", "cases"]])


def valid_digest(value):
    return isinstance(value, str) and len(value) == 64 and all(x in "0123456789abcdef" for x in value)


def inspect_run(d, policy=None):
    assert d["schema_version"] == 1 and d["model"] == "zoora-trust-run/0.1.0"
    assert d["classification"] == "SYNTHETIC" and d["credit_unit"] == "WORK_CREDIT_1_10000"
    assert d["fingerprint"] == run_hash(d)
    cfg = d["input"]["config"]
    ops = cfg["operators"]
    approved, consents, used = set(), set(), set()
    groups, projects, contracts, facts = {}, {}, {}, {}
    seen_receipts = set()

    def acceptance(i):
        if policy is not None:
            status, accepted = policy.disposition(i, contracts[i], facts[i], current_tick)
            return accepted if status == "ACCEPTED" else (contracts[i]["accepted_tick"] if status == "ORDINARY" else None)
        return contracts[i]["accepted_tick"]

    def eligible(i):
        f = facts[i]
        if policy is not None:
            at = acceptance(i)
            status, _ = policy.disposition(i, contracts[i], f, current_tick)
            return (at is not None and f["paid"] == f["amount"] and not f["returned"]
                    and not f["late_delivery"] and f["delivery"]
                    and (status != "ACCEPTED" or current_tick >= at + cfg["maturity_ticks"]))
        return (f["accepted"] and f["paid"] == f["amount"] and not f["returned"]
                and not f["dispute"] and not f["refund_request"] and not f["late_delivery"])

    def active(i, tick):
        f = facts[i]
        if f["paid"] and f["paid"] == f["returned"]:
            return False
        if not f["paid"] and tick >= contracts[i]["plan"]["deadline"]:
            return False
        if policy is not None:
            status, _ = policy.disposition(i, contracts[i], f, tick)
            if status != "ORDINARY":
                return not (status == "ACCEPTED" and acceptance(i) is not None and not f["returned"] and f["delivery"] and not f["late_delivery"] and f["paid"] == f["amount"])
        return not (f["accepted"] and not f["returned"] and not f["dispute"] and not f["refund_request"])

    def profile(agent, tick):
        earned, confirmed, active_count, hold = 0, 0, 0, False
        customers = set()
        for i, c in contracts.items():
            if not any(s["agent"] == agent for s in c["plan"]["shares"]):
                continue
            f = facts[i]
            active_count += active(i, tick)
            hold |= (f["dispute"] or f["refund_request"]) and f["paid"] > f["returned"]
            if policy is not None and f["paid"] > f["returned"]:
                status, _ = policy.disposition(i, c, f, tick)
                hold |= status in ["PENDING", "REJECTED", "UNRESOLVED"]
            if eligible(i) and c["plan"]["client"] in approved:
                for s in c["credit_shares"]:
                    if s["agent"] == agent and s["earned_microunits"] > 0:
                        earned += s["earned_microunits"]
                        confirmed += 1
                        customers.add(ops[c["plan"]["client"]])
        tier = 0
        if agent in approved and not hold and tick >= cfg["minimum_age_ticks"] and len(customers) >= cfg["minimum_customer_operators"]:
            tier = 2 if earned >= cfg["tier_two_credits"] * SCALE else int(earned >= cfg["tier_one_credits"] * SCALE)
        limits = [{"work": 1, "development": 1, "community_funded": 1},
                  {"work": 2, "development": 2, "community_funded": 2},
                  {"work": 4, "development": 3, "community_funded": 3}][tier]
        membership = lambda kind: sum(g["kind"] == kind and agent in g["members"] for g in groups.values())
        return dict(agent=agent, review_fixture_approved=agent in approved, tier=tier,
                    earned_credit_microunits=earned, confirmed_contracts=confirmed,
                    customer_operators=len(customers), active_contracts=active_count,
                    development_memberships=membership("DEVELOPMENT"),
                    community_funded_memberships=membership("COMMUNITY_FUNDED"),
                    dispute_hold=bool(hold), limits=limits)

    assert len(d["journal"]) == len(d["input"]["actions"])
    last_tick = 0
    current_tick = 0
    for seq, row in enumerate(d["journal"]):
        a = row["action"]
        assert row["sequence"] == seq and a == d["input"]["actions"][seq]
        tick, actor, command = a["tick"], a["actor"], a["command"]
        assert last_tick <= tick < cfg["ticks"] - 1
        last_tick = tick
        current_tick = tick
        if policy is not None:
            policy.visible = seq
        kind = command["type"]
        if row["outcome"]["status"] == "APPLIED":
            agent = actor.get("agent")
            if kind in ["REVIEW_AGENT", "DEFINE_PROJECT", "CONFIRM_WORK", "ADVANCE"]:
                assert actor["type"] == "REVIEW_FIXTURE"
            elif kind != "DIRECT":
                assert actor["type"] == "AGENT" and 0 <= agent < len(ops)
            if kind == "REVIEW_AGENT":
                assert valid_digest(command["evidence_digest"])
                if command["approved"]:
                    approved.add(command["agent"])
                else:
                    approved.discard(command["agent"])
            elif kind == "DEFINE_PROJECT":
                i = command["id"]
                assert i not in projects and valid_digest(command["scope_digest"])
                assert not any(p["scope_digest"] == command["scope_digest"] for p in projects.values())
                projects[i] = dict(id=i, work_budget=command["work_budget"], issued_units=0, scope_digest=command["scope_digest"])
            elif kind in ["CREATE_GROUP", "JOIN_GROUP"]:
                i = command["id"]
                group_kind = command["kind"] if kind == "CREATE_GROUP" else groups[i]["kind"]
                p = profile(agent, tick)
                count, limit = ((p["development_memberships"], p["limits"]["development"]) if group_kind == "DEVELOPMENT"
                                else (p["community_funded_memberships"], p["limits"]["community_funded"]))
                assert not p["dispute_hold"] and count < limit
                if kind == "CREATE_GROUP":
                    assert i not in groups
                    groups[i] = dict(id=i, kind=group_kind, members=[])
                assert agent not in groups[i]["members"]
                groups[i]["members"].append(agent)
                groups[i]["members"].sort()
            elif kind == "LEAVE_GROUP":
                i = command["id"]
                assert agent in groups[i]["members"]
                assert not any(c["plan"]["group"] == i and any(s["agent"] == agent for s in c["plan"]["shares"]) and active(k, tick) for k, c in contracts.items())
                groups[i]["members"].remove(agent)
            elif kind == "CONSENT":
                key = (agent, command["plan_digest"])
                assert valid_digest(key[1]) and key not in consents
                consents.add(key)
            elif kind == "OPEN_CONTRACT":
                p = command["plan"]
                i = p["id"]
                assert i not in contracts and agent == p["lead"]
                assert p["work_units"] > 0 and p["payment_units"] > 0
                assert sum(s["basis_points"] for s in p["shares"]) == SCALE
                assert [s["agent"] for s in p["shares"]] == sorted({s["agent"] for s in p["shares"]})
                assert tick < p["deadline"] < cfg["ticks"] - 1
                scope = projects[p["project"]]
                assert scope["issued_units"] + p["work_units"] <= scope["work_budget"]
                plan_digest = digest("ZOORA_AE016_CONSENT_V1", p)
                for who in [p["client"], *[s["agent"] for s in p["shares"]]]:
                    assert (who, plan_digest) in consents
                    consents.remove((who, plan_digest))
                for s in p["shares"]:
                    state = profile(s["agent"], tick)
                    assert not state["dispute_hold"] and state["active_contracts"] < state["limits"]["work"]
                    if p["group"] is not None:
                        assert s["agent"] in groups[p["group"]]["members"]
                    else:
                        assert len(p["shares"]) == 1
                scope["issued_units"] += p["work_units"]
                contracts[i] = dict(plan=p, contributions=[], accepted_tick=None, reviewed_tick=None, review_digest=None, credit_shares=[])
                facts[i] = dict(amount=p["payment_units"], paid=0, returned=0, accepted=False,
                                delivery=False, delivery_tick=None, delivery_digest=None, late_delivery=False, dispute=False, refund_request=False)
            elif kind == "CONTRIBUTE":
                i = command["contract_id"]
                c, f = contracts[i], facts[i]
                assert any(s["agent"] == agent for s in c["plan"]["shares"])
                assert not any(s["agent"] == agent for s in c["contributions"])
                assert f["paid"] == f["amount"] and not f["returned"] and not f["delivery"]
                assert tick < c["plan"]["deadline"] and valid_digest(command["artifact_digest"])
                c["contributions"].append(dict(agent=agent, artifact_digest=command["artifact_digest"]))
                c["contributions"].sort(key=lambda s: s["agent"])
            elif kind == "DIRECT":
                x = command["command"]
                k = x["type"]
                i = x["receipt"]["agreement_id"] if "receipt" in x else x["agreement_id"]
                c, f = contracts[i], facts[i]
                p = c["plan"]
                if "receipt" in x:
                    assert actor["type"] == "RECEIPT_FIXTURE"
                    receipt = x["receipt"]
                    assert valid_digest(receipt["transaction_ref"]) and receipt["transaction_ref"] not in seen_receipts
                    assert receipt["availability_tick"] == tick and receipt["simulation_tick"] <= tick
                    assert receipt["classification"] == "SYNTHETIC" and receipt["source"] == "OFFLINE_FIXTURE_V1"
                    refund = k == "VOLUNTARY_REFUND_RECEIPT"
                    assert (receipt["sender"], receipt["recipient"]) == ((p["lead"], p["client"]) if refund else (p["client"], p["lead"]))
                    f["returned" if refund else "paid"] += receipt["amount"]
                    assert 0 <= f["returned"] <= f["paid"] <= f["amount"]
                    seen_receipts.add(receipt["transaction_ref"])
                else:
                    expected = p["lead"] if k in ["DELIVER", "DECLINE_REFUND"] else p["client"]
                    assert actor == dict(type="AGENT", agent=expected)
                    if k == "DELIVER":
                        assert len(c["contributions"]) == len(p["shares"]) and not f["delivery"]
                        f["delivery"] = True
                        f["delivery_tick"], f["delivery_digest"] = tick, x["artifact_digest"]
                        f["late_delivery"] = tick >= p["deadline"]
                    elif k == "ACKNOWLEDGE":
                        assert f["delivery"] and not f["accepted"] and not f["dispute"] and not f["refund_request"]
                        f["accepted"] = True
                        c["accepted_tick"] = tick
                    elif k == "DISPUTE":
                        f["dispute"] = True
                    elif k == "REQUEST_REFUND":
                        f["refund_request"] = True
            elif kind == "CONFIRM_WORK":
                i = command["contract_id"]
                c = contracts[i]
                assert c["reviewed_tick"] is None and eligible(i)
                assert tick >= acceptance(i) + cfg["maturity_ticks"]
                assert c["plan"]["client"] in approved and valid_digest(command["review_digest"])
                refs = [s["artifact_digest"] for s in c["contributions"]]
                assert len(set(refs)) == len(refs) and not used.intersection(refs)
                used.update(refs)
                c["credit_shares"] = []
                for s in c["plan"]["shares"]:
                    units = c["plan"]["work_units"] * s["basis_points"]
                    c["credit_shares"].append(dict(agent=s["agent"], allocated_microunits=units,
                        earned_microunits=0 if ops[s["agent"]] == ops[c["plan"]["client"]] else units))
                assert sum(s["allocated_microunits"] for s in c["credit_shares"]) == c["plan"]["work_units"] * SCALE
                c["reviewed_tick"], c["review_digest"] = tick, command["review_digest"]
        if policy is not None:
            policy.visible = seq + 1
        assert row["profiles_after"] == [profile(i, tick) for i in range(len(ops))], (seq, kind)
    current_tick = cfg["ticks"] - 1
    if policy is not None:
        policy.visible = len(d["journal"])
    assert d["profiles"] == [profile(i, cfg["ticks"] - 1) for i in range(len(ops))]
    assert d["groups"] == [groups[i] for i in sorted(groups)]
    assert d["projects"] == [projects[i] for i in sorted(projects)]
    assert d["contracts"] == [contracts[i] for i in sorted(contracts)]
    direct = d["direct"]
    assert not any(direct["wallet_boundary"].values())
    assert int(direct["metrics"]["payments_recorded"]) == sum(f["paid"] for f in facts.values())
    assert int(direct["metrics"]["voluntary_refunds_recorded"]) == sum(f["returned"] for f in facts.values())
    assert int(direct["metrics"]["net_transferred"]) == sum(f["paid"] - f["returned"] for f in facts.values())
    assert len(direct["agreements"]) == len(contracts)
    for agreement in direct["agreements"]:
        i = agreement["terms"]["agreement_id"]
        assert int(agreement["payments_received"]) == facts[i]["paid"]
        assert int(agreement["voluntary_refunds_received"]) == facts[i]["returned"]
    return dict(actions=len(d["journal"]), contracts=len(contracts), profiles_checked=(len(d["journal"]) + 1) * len(ops))


def inspect_campaign(d):
    assert d["schema_version"] == 1 and d["model"] == "zoora-trust-campaign/0.1.0"
    assert d["classification"] == "SYNTHETIC" and d["fingerprint"] == campaign_hash(d)
    assert [c["name"] for c in d["cases"]] == CASES
    results = []
    for c in d["cases"]:
        assert c["run"]["input"]["config"] == d["config"]
        results.append(inspect_run(c["run"]))
    return {key: sum(r[key] for r in results) for key in results[0]}


if __name__ == "__main__":
    value = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    print(json.dumps(inspect_campaign(value) if "cases" in value else inspect_run(value), sort_keys=True))
