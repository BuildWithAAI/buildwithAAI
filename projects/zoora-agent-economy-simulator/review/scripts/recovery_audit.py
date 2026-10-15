"""Independent AE-017 applied event, evidence binding, credit and payment audit.

Native replay additionally regenerates rejected attempts and fixed demo inputs.
This shares the AE-016 arithmetic auditor; it independently derives case states.
All actor/operator labels and judgments remain unauthenticated fixtures.
"""
from __future__ import annotations
import copy
import json
import sys
from pathlib import Path
from trust_audit import digest, valid_digest, inspect_run as inspect_trust, run_hash as trust_hash
if not __debug__:
    raise SystemExit("Run recovery audit without -O; assertions must be enabled")
CASES = ["FALSE_COMPLAINT_DISMISSED", "CUSTOMER_NONRESPONSE_ACCEPTED", "COMPLAINT_UPHELD",
         "APPEAL_OVERTURNS_REJECTION", "APPEAL_UPHOLDS_COMPLAINT", "REVIEWER_TIMEOUT_ESCALATION",
         "REVIEWERS_ALL_TIMEOUT", "APPEAL_TIMEOUT_UNRESOLVED", "RETURN_RESOLVES_PENDING",
         "STALE_ACCEPTANCE", "CONFLICTED_REVIEWERS", "UNFINISHED_PAID_WORK_HOLD",
         "COLLECTIVE_CONTESTED", "DEADLINE_BOUNDARIES", "FORGED_BINDINGS_AND_DUPLICATES"]
TERMINAL = {"FINAL_ACCEPTED", "FINAL_REJECTED", "EXPIRED", "STALE", "WITHDRAWN", "RETURNED"}


def run_hash(d):
    return digest("ZOORA_AE017_RECOVERY_RUN_V1", [d[k] for k in [
        "schema_version", "model", "classification", "input", "journal", "cases", "events", "trust"]])


def campaign_hash(d):
    return digest("ZOORA_AE017_RECOVERY_CAMPAIGN_V1", [d[k] for k in [
        "schema_version", "model", "classification", "config", "cases"]])


def binding(c, w, f):
    return digest("ZOORA_AE017_REVIEW_BINDING_V1", [c["id"], c["contract_id"], c["opener"], c["kind"],
        c["opened_tick"], c["reason_digest"], c["evidence"], c["appeal_reason"],
        digest("ZOORA_AE016_CONSENT_V1", w["plan"]), w["contributions"], str(f["paid"]),
        str(f["returned"]), f["delivery_digest"], f["delivery_tick"]])


def acceptable(w, f):
    return (f["paid"] == w["plan"]["payment_units"] and not f["returned"] and f["delivery_digest"]
            and f["delivery_tick"] < w["plan"]["deadline"] and len(w["contributions"]) == len(w["plan"]["shares"]))


def timer(c):
    return {"EVIDENCE": c["evidence_until"], "PRIMARY_REVIEW": c["primary_deadline"],
            "PROVISIONAL": c["appeal_until"], "APPELLATE_EVIDENCE": c["appellate_evidence_until"],
            "APPELLATE_REVIEW": c["appellate_deadline"]}.get(c["status"])


class Policy:
    def __init__(self, cfg, events):
        self.cfg, self.events, self.visible = cfg, events, 0

    def disposition(self, i, w, f, tick):
        if f["paid"] and f["paid"] == f["returned"]:
            return "ORDINARY", None
        matching = [e["case"] for e in self.events if e["visible_actions"] <= self.visible and e["tick"] <= tick and e["case"]["contract_id"] == i]
        if matching:
            c = matching[-1]
            status = c["status"]
            if status == "FINAL_ACCEPTED":
                v = c["appellate"] or c["primary"]
                if binding(c, w, f) == v["binding"] and acceptable(w, f):
                    return "ACCEPTED", c["final_tick"]
                return "UNRESOLVED", None
            if status == "FINAL_REJECTED":
                return "REJECTED", None
            if status in ["EXPIRED", "STALE"]:
                return "UNRESOLVED", None
            if status in ["WITHDRAWN", "RETURNED"]:
                return "ORDINARY", None
            return "PENDING", None
        if tick >= w["plan"]["deadline"] and f["paid"] > f["returned"] and not f["accepted"]:
            return "UNRESOLVED", None
        return "ORDINARY", None


def inspect_run(d):
    assert d["schema_version"] == 1 and d["model"] == "zoora-recovery-run/0.1.0"
    assert d["classification"] == "SYNTHETIC" and d["fingerprint"] == run_hash(d)
    cfg, rows, events = d["input"]["config"], d["journal"], d["events"]
    assert len(rows) == len(d["input"]["actions"]) <= 4096
    assert 0 <= len(d["cases"]) <= 64 and len(events) <= 2048
    assert d["trust"]["input"]["config"] == cfg["trust"]
    # Capture ONLY successful prior trust evidence at each action prefix.
    works, facts, history, trust_rows, virtual = {}, {}, [(dict(), dict())], [], []
    previous_tick = 0
    for seq, row in enumerate(rows):
        a, outcome = row["action"], row["outcome"]
        assert row["sequence"] == seq and a == d["input"]["actions"][seq]
        assert previous_tick <= a["tick"] < cfg["trust"]["ticks"] - 1
        previous_tick = a["tick"]
        cmd = a["command"]
        if cmd["type"] == "TRUST" and outcome["status"] == "TRUST":
            t = dict(sequence=len(trust_rows), action=dict(tick=a["tick"], actor=cmd["actor"], command=cmd["command"]),
                     outcome=outcome["outcome"], profiles_after=row["profiles_after"])
            trust_rows.append(t)
            v = copy.deepcopy(t); v["sequence"] = seq; virtual.append(v)
            if outcome["outcome"]["status"] == "APPLIED":
                x = cmd["command"]; k = x["type"]
                if k == "OPEN_CONTRACT":
                    p=x["plan"]; i=p["id"]
                    works[i]=dict(plan=p,contributions=[])
                    facts[i]=dict(paid=0,returned=0,delivery_digest=None,delivery_tick=None,accepted=False,accepted_tick=None)
                elif k == "CONTRIBUTE":
                    works[x["contract_id"]]["contributions"].append(dict(agent=cmd["actor"]["agent"],artifact_digest=x["artifact_digest"]))
                    works[x["contract_id"]]["contributions"].sort(key=lambda x:x["agent"])
                elif k == "DIRECT":
                    x=x["command"]; k=x["type"]
                    i=x["receipt"]["agreement_id"] if "receipt" in x else x["agreement_id"]
                    if k=="PAYMENT_RECEIPT":facts[i]["paid"]+=x["receipt"]["amount"]
                    elif k=="VOLUNTARY_REFUND_RECEIPT":facts[i]["returned"]+=x["receipt"]["amount"]
                    elif k=="DELIVER":facts[i].update(delivery_digest=x["artifact_digest"],delivery_tick=a["tick"])
                    elif k=="ACKNOWLEDGE":facts[i].update(accepted=True,accepted_tick=a["tick"])
                    else:raise AssertionError("legacy case bypass")
        else:
            virtual.append(dict(sequence=seq,action=dict(tick=a["tick"],actor=dict(type="REVIEW_FIXTURE"),command=dict(type="ADVANCE")),outcome=dict(status="APPLIED"),profiles_after=row["profiles_after"]))
        history.append(copy.deepcopy((works,facts)))
    assert d["trust"]["journal"] == trust_rows
    assert d["trust"]["input"]["actions"] == [r["action"] for r in trust_rows]
    cases, applied_case_events, snapshots = {}, set(), []
    ops = cfg["trust"]["operators"]
    rops = {r["id"]:r["operator"] for r in cfg["reviewers"]}

    def eligible(w, excluded=()):
        parties={cfg["trust"]["reviewer_operator"],ops[w["plan"]["client"]],*[ops[s["agent"]] for s in w["plan"]["shares"]]}
        return [r["id"] for r in cfg["reviewers"] if r["operator"] not in parties and r["operator"] not in excluded]

    def select(ids,i):return ids[i%len(ids)]
    def party(w,agent):return agent in [w["plan"]["client"],*[s["agent"] for s in w["plan"]["shares"]]]
    prev_order=(0,0)
    for seq, event in enumerate(events):
        assert event["sequence"]==seq
        tick,n,kind,c=event["tick"],event["visible_actions"],event["kind"],event["case"]
        assert 0<=n<=len(rows) and prev_order <= (n,tick)
        prev_order=(n,tick)
        assert (not n or rows[n-1]["action"]["tick"] <= tick) and (n==len(rows) or tick<=rows[n]["action"]["tick"])
        ws,fs=history[n]; w,f=ws[c["contract_id"]],fs[c["contract_id"]]
        old=copy.deepcopy(cases.get(c["id"]))
        expected=copy.deepcopy(old)
        action=rows[n-1]["action"] if n else None
        cmd=action["command"] if action else {}
        command_events={"OPENED":"OPEN_CASE","EVIDENCE_SUBMITTED":"SUBMIT_EVIDENCE","PRIMARY_DECISION":"PRIMARY_VERDICT","APPEAL_FILED":"APPEAL","APPELLATE_DECISION":"APPELLATE_VERDICT","WITHDRAWN":"WITHDRAW"}
        if kind in command_events:
            assert n and tick==action["tick"] and rows[n-1]["outcome"]==dict(status="APPLIED")
            assert cmd["type"]==command_events[kind] and n not in applied_case_events
            applied_case_events.add(n)
        elif kind!="RETURN_OBSERVED":
            due=[(timer(x),i) for i,x in cases.items() if timer(x) is not None]
            assert due and min(due)==(tick,c["id"])
        if kind=="OPENED":
            assert c["id"]==len(cases) and not any(x["contract_id"]==c["contract_id"] for x in cases.values())
            assert cmd["contract_id"]==c["contract_id"] and party(w,cmd["agent"]) and f["paid"]>f["returned"]
            assert valid_digest(cmd["reason_digest"])
            p=w["plan"]
            if cmd["kind"]=="COMPLAINT":
                assert cmd["agent"]==p["client"] and (f["delivery_digest"] or tick>=p["deadline"])
                ack=f["accepted_tick"]
                assert tick < (ack if ack is not None else p["deadline"])+cfg["complaint_ticks"]
            else:
                assert cmd["kind"]=="CUSTOMER_NONRESPONSE" and cmd["agent"]!=p["client"] and not f["accepted"] and acceptable(w,f)
                assert f["delivery_tick"]+cfg["response_ticks"]<=tick<f["delivery_tick"]+cfg["response_ticks"]+cfg["complaint_ticks"]
            ids=eligible(w);assert len({rops[r] for r in ids})>=3
            assert tick+cfg["evidence_ticks"]+2*cfg["primary_review_ticks"]+cfg["appeal_ticks"]+cfg["appellate_review_ticks"]<cfg["trust"]["ticks"]-1
            expected=dict(id=c["id"],contract_id=p["id"],opener=cmd["agent"],kind=cmd["kind"],opened_tick=tick,reason_digest=cmd["reason_digest"],evidence_until=tick+cfg["evidence_ticks"],primary_deadline=tick+cfg["evidence_ticks"]+cfg["primary_review_ticks"],primary_assignments=[select(ids,c["id"])],primary=None,appeal_until=None,appellant=None,appeal_reason=None,appellate_reviewer=None,appellate_evidence_until=None,appellate_deadline=None,appellate=None,evidence=[],status="EVIDENCE",final_tick=None,returned_tick=None)
        elif kind=="EVIDENCE_SUBMITTED":
            assert party(w,cmd["agent"]) and old["status"] in ["EVIDENCE","APPELLATE_EVIDENCE"]
            assert valid_digest(cmd["evidence_digest"]) and len(old["evidence"])<8 and not any(x["digest"]==cmd["evidence_digest"] for x in old["evidence"])
            expected["evidence"].append(dict(agent=cmd["agent"],digest=cmd["evidence_digest"]))
        elif kind in ["PRIMARY_WINDOW_OPENED","APPELLATE_WINDOW_OPENED"]:
            assert old["status"]==("EVIDENCE" if kind=="PRIMARY_WINDOW_OPENED" else "APPELLATE_EVIDENCE")
            expected["status"]="PRIMARY_REVIEW" if kind=="PRIMARY_WINDOW_OPENED" else "APPELLATE_REVIEW"
        elif kind=="PRIMARY_REASSIGNED":
            assert old["status"]=="PRIMARY_REVIEW" and len(old["primary_assignments"])==1
            ids=eligible(w,{rops[r] for r in old["primary_assignments"]})
            expected["primary_assignments"].append(select(ids,c["id"]))
            expected["primary_deadline"]=tick+cfg["primary_review_ticks"]
        elif kind in ["PRIMARY_DECISION","APPELLATE_DECISION"]:
            appeal=kind=="APPELLATE_DECISION"
            assert old["status"]==("APPELLATE_REVIEW" if appeal else "PRIMARY_REVIEW")
            assert cmd["case_id"]==c["id"] and cmd["reviewer"]==(old["appellate_reviewer"] if appeal else old["primary_assignments"][-1])
            assert cmd["binding"]==binding(old,w,f) and valid_digest(cmd["reason_digest"])
            assert cmd["verdict"] in ["ACCEPT_WORK","REJECT_WORK"]
            assert cmd["verdict"]!="ACCEPT_WORK" or acceptable(w,f)
            expected["appellate" if appeal else "primary"]={k:cmd[k] for k in ["reviewer","verdict","binding","reason_digest"]}
            expected["appellate" if appeal else "primary"]["tick"]=tick
            if appeal:expected.update(status="FINAL_ACCEPTED" if cmd["verdict"]=="ACCEPT_WORK" else "FINAL_REJECTED",final_tick=tick)
            else:expected.update(status="PROVISIONAL",appeal_until=tick+cfg["appeal_ticks"])
        elif kind=="APPEAL_FILED":
            assert old["status"]=="PROVISIONAL" and party(w,cmd["agent"]) and cmd["case_id"]==c["id"] and tick<old["appeal_until"] and valid_digest(cmd["reason_digest"])
            ids=eligible(w,{rops[r] for r in old["primary_assignments"]})
            expected.update(appellant=cmd["agent"],appeal_reason=cmd["reason_digest"],appellate_reviewer=select(ids,c["id"]),appellate_evidence_until=tick+cfg["evidence_ticks"],appellate_deadline=tick+cfg["appellate_review_ticks"],status="APPELLATE_EVIDENCE")
        elif kind in ["FINALIZED","EVIDENCE_STALE"]:
            assert old["status"]=="PROVISIONAL"
            v=old["primary"]
            status="STALE" if v["binding"]!=binding(old,w,f) or (v["verdict"]=="ACCEPT_WORK" and not acceptable(w,f)) else ("FINAL_ACCEPTED" if v["verdict"]=="ACCEPT_WORK" else "FINAL_REJECTED")
            assert (kind=="EVIDENCE_STALE")== (status=="STALE")
            expected.update(status=status,final_tick=tick)
        elif kind=="EXPIRED":
            assert old["status"]=="APPELLATE_REVIEW" or (old["status"]=="PRIMARY_REVIEW" and len(old["primary_assignments"])==2)
            expected.update(status="EXPIRED",final_tick=tick)
        elif kind=="WITHDRAWN":
            assert old["status"] in ["EVIDENCE","PRIMARY_REVIEW"] and not old["primary"] and cmd["agent"]==old["opener"] and cmd["case_id"]==c["id"]
            expected.update(status="WITHDRAWN",final_tick=tick)
        elif kind=="RETURN_OBSERVED":
            assert old["returned_tick"] is None and f["paid"]>0 and f["paid"]==f["returned"]
            assert n and tick==action["tick"] and cmd["type"]=="TRUST" and cmd["command"]["type"]=="DIRECT" and cmd["command"]["command"]["type"]=="VOLUNTARY_REFUND_RECEIPT"
            expected["returned_tick"]=tick
            if old["status"] not in TERMINAL:expected.update(status="RETURNED",final_tick=tick)
        else:raise AssertionError("unknown recovery event")
        assert c==expected,(seq,kind)
        cases[c["id"]]=copy.deepcopy(c);snapshots.append(copy.deepcopy(cases))
    for seq,row in enumerate(rows):
        n=row["event_count_after"]
        assert 0<=n<=len(events) and (not seq or n>=rows[seq-1]["event_count_after"])
        assert all(e["visible_actions"]<=seq+1 and e["tick"]<=row["action"]["tick"] for e in events[:n])
        assert all(e["visible_actions"]>seq+1 or e["tick"]>row["action"]["tick"] for e in events[n:])
        at=snapshots[n-1] if n else {}
        assert all(timer(c) is None or timer(c)>row["action"]["tick"] for c in at.values())
        if row["outcome"]["status"]=="APPLIED" and row["action"]["command"]["type"]!="ADVANCE":assert seq+1 in applied_case_events
    assert all(timer(c) is None for c in cases.values())
    assert d["cases"]==[cases[i] for i in sorted(cases)]
    # Existing trust arithmetic checks every full-journal profile using the case policy.
    pseudo={**d["trust"],"schema_version":1,"model":"zoora-trust-run/0.1.0","classification":"SYNTHETIC","credit_unit":"WORK_CREDIT_1_10000"}
    pseudo["input"]=dict(config=cfg["trust"],actions=[r["action"] for r in virtual]);pseudo["journal"]=virtual
    pseudo["fingerprint"]=trust_hash(pseudo)
    counts=inspect_trust(pseudo,Policy(cfg,events))
    return dict(**counts,review_cases=len(cases),case_events=len(events))


def inspect_campaign(d):
    assert d["schema_version"]==1 and d["model"]=="zoora-recovery-campaign/0.1.0"
    assert d["classification"]=="SYNTHETIC" and d["fingerprint"]==campaign_hash(d)
    assert [c["name"] for c in d["cases"]]==CASES
    counts=[]
    for c in d["cases"]:
        assert c["run"]["input"]["config"]==d["config"]
        counts.append(inspect_run(c["run"]))
    return {k:sum(c[k] for c in counts) for k in counts[0]}

if __name__=="__main__":
    d=json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    print(json.dumps(inspect_campaign(d) if d.get("model")=="zoora-recovery-campaign/0.1.0" else inspect_run(d),sort_keys=True))
