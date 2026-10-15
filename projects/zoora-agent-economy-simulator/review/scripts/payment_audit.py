"""Independent arithmetic and causality audit; also run native scenario regeneration.

This is an offline fixture audit, not external receipt authentication or a signer.
"""
from __future__ import annotations
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import sys

if not __debug__:
    raise RuntimeError("Independent audit requires assertions; run Python without -O")

def digest(domain, body):
    raw=json.dumps(body,ensure_ascii=False,separators=(",", ":")).encode()
    return hashlib.sha256(domain.encode()+b"\0"+raw).hexdigest()

def run_hash(d):
    keys=["config","seed","scenario","policy","intentions","intentions_fingerprint","quotes","transfers","observations","queue","final_balances","rounds","metrics","direct"]
    return digest("ZOORA_AE013_PAYMENT_RUN_V1",[[d[k] for k in ["schema_version","model","classification","unit","rng"]],*[d[k] for k in keys]])

def campaign_hash(d):
    return digest("ZOORA_AE013_PAYMENT_CAMPAIGN_V1",[d[k] for k in ["schema_version","model","classification","unit","rng","config","runs"]])

def inspect_amounts(a):
    assert int(a["opening_units"])==int(a["final_wallet_units"])
    assert int(a["payments_sent"])==int(a["adapter_payments_recorded"])+int(a["observed_unapplied_payment_units"])
    assert int(a["voluntary_returns_sent"])<=int(a["payments_sent"])

def inspect_run(d):
    assert d["classification"]=="SYNTHETIC" and d["unit"]=="SIMULATED_UNITS"
    assert d["fingerprint"]==run_hash(d)
    assert d["intentions_fingerprint"]==digest("ZOORA_AE013_PAYMENT_INTENTIONS_V1",d["intentions"])
    cfg=d["config"];opening=cfg["agents"]*cfg["starting_balance"]
    balances=[cfg["starting_balance"]]*cfg["agents"]
    quotes={q["intention"]["agreement_id"]:q for q in d["quotes"]}
    direct=d["direct"];agreements={a["terms"]["agreement_id"]:a for a in direct["agreements"]}
    assert len(quotes)==len(d["quotes"])
    accepted={key:q for key,q in quotes.items() if q["decision"] in ["RESERVED","UNRESERVED"]}
    assert set(agreements)==set(accepted) and len(agreements)<=cfg["max_quotes"]
    for key,q in accepted.items():
        t=agreements[key]["terms"];i=q["intention"]
        assert (t["client"],t["provider"],t["amount"],t["delivery_deadline"])==(i["client"],i["provider"],cfg["price"],q["delivery_deadline"])
    payment=Counter();returns=Counter();references=set()
    for n,f in enumerate(d["transfers"]):
        r=f["receipt"];assert f["sequence"]==n and r["transaction_ref"] not in references
        references.add(r["transaction_ref"])
        assert r["transaction_ref"]==digest("ZOORA_AE004_DIRECT_FIXTURE_V1",[r["agreement_id"],0 if f["kind"]=="PAYMENT" else 1,r["sender"],r["recipient"],r["amount"],r["simulation_tick"]])
        assert r["classification"]=="SYNTHETIC" and r["asset"]=="SYNTHETIC_UNIT" and r["slot"] is None and r["source"]=="OFFLINE_FIXTURE_V1"
        assert r["simulation_tick"]<=r["availability_tick"] and r["amount"]>0
        balances[r["sender"]]-=r["amount"];balances[r["recipient"]]+=r["amount"]
        assert min(balances)>=0 and sum(balances)==opening
        (payment if f["kind"]=="PAYMENT" else returns)[r["agreement_id"]]+=r["amount"]
    assert balances==[int(b["units"]) for b in d["final_balances"]]
    seen=set();credited=set();eligible={};unbacked=duplicates=adapter_rejections=late_sent=late_observed=0
    for n,o in enumerate(d["observations"]):
        assert o["sequence"]==n;r=o["receipt"];seq=o["transfer_sequence"]
        if seq is None:
            assert o["eligibility"]=="UNBACKED_CLAIM" and o["direct_outcome"] is None
            assert not any(f["receipt"]==r for f in d["transfers"]);unbacked+=1;continue
        f=d["transfers"][seq];assert f["receipt"]==r and f["sequence"]==seq
        if seq in seen:
            assert o["eligibility"]=="DUPLICATE" and o["direct_outcome"] is None;duplicates+=1;continue
        seen.add(seq);outcome=o["direct_outcome"];assert outcome is not None
        if outcome["status"]=="REJECTED":assert o["eligibility"]=="ADAPTER_REJECTED";adapter_rejections+=1;continue
        assert outcome["status"]=="RECORDED";credited.add(seq)
        if f["kind"]=="VOLUNTARY_RETURN":assert o["eligibility"]=="RETURN_OBSERVATION";continue
        q=quotes[r["agreement_id"]]
        if r["availability_tick"]+cfg["service_ticks"]+1>=q["delivery_deadline"]:expected="DELIVERY_WINDOW_CLOSED"
        elif d["policy"]=="RESERVE_ON_QUOTE":expected="ELIGIBLE"
        elif r["simulation_tick"]>=q["funding_cutoff"]:expected="LATE_TRANSFER"
        elif r["availability_tick"]>=(q["funding_cutoff"] if d["policy"]=="STRICT_OBSERVATION" else q["evidence_cutoff"]):expected="LATE_OBSERVATION"
        else:expected="ELIGIBLE"
        assert o["eligibility"]==expected
        late_sent+=expected=="LATE_TRANSFER";late_observed+=expected=="LATE_OBSERVATION"
        if expected=="ELIGIBLE":eligible[r["agreement_id"]]=r["availability_tick"]
    assert len(seen)==len(d["transfers"])
    a=d["metrics"]["amounts"];c=d["metrics"]["counts"];inspect_amounts(a)
    assert int(a["opening_units"])==sum(balances)==opening
    assert int(a["payments_sent"])==sum(payment.values());assert int(a["voluntary_returns_sent"])==sum(returns.values())
    adapter=sum(f["receipt"]["amount"] for f in d["transfers"] if f["sequence"] in credited and f["kind"]=="PAYMENT")
    assert int(a["adapter_payments_recorded"])==adapter==int(direct["metrics"]["payments_recorded"])
    assert int(a["observed_unapplied_payment_units"])==sum(payment.values())-adapter
    assert int(a["voluntary_returns_sent"])==int(direct["metrics"]["voluntary_refunds_recorded"])
    work=[q for q in quotes.values() if not q["intention"]["attack_fixture"]]
    assert c["intended_work"]==len(work)
    assert c["paid_work"]==sum(payment[q["intention"]["agreement_id"]]>0 for q in work)
    assert c["started_work"]==sum(q["started_tick"] is not None for q in work)
    assert c["acknowledged_work"]==sum(q["acknowledged"] for q in work)==sum(a["delivery_acknowledged"] for a in agreements.values())
    assert c["paid_work_not_started"]==sum(payment[q["intention"]["agreement_id"]]>0 and q["started_tick"] is None for q in work)
    assert (c["unbacked_claims"],c["duplicate_observations"],c["adapter_rejections"],c["late_transfer_observations"],c["late_evidence_observations"])==(unbacked,duplicates,adapter_rejections,late_sent,late_observed)
    assert int(a["paid_not_started_net_units"])==sum(payment[key]-returns[key] for key,q in quotes.items() if q["started_tick"] is None)
    assert int(a["unacknowledged_net_units"])==sum(payment[key]-returns[key] for key,q in quotes.items() if not q["acknowledged"])
    timeline=[(q["quote_tick"],0,n,"RESERVE",key) for n,(key,q) in enumerate(quotes.items()) if q["decision"]=="RESERVED"]
    for n,e in enumerate(d["queue"]):assert e["sequence"]==n;timeline.append((e["tick"],1,n,e["action"],e["agreement_id"]))
    slots=defaultdict(set);ready={};started=set();max_slots=0
    for tick,_,sequence,action,key in sorted(timeline):
        q=quotes[key];provider=q["intention"]["provider"]
        if action=="RESERVE":slots[provider].add(key)
        elif action=="READY":assert eligible[key]==tick;ready[key]=sequence
        elif action=="STARTED":
            assert key in ready and key not in started and eligible[key]<=tick and q["started_tick"]==tick
            waiting=[other for other in ready if other not in started and quotes[other]["intention"]["provider"]==provider and tick+cfg["service_ticks"]+1<quotes[other]["delivery_deadline"]]
            assert ready[key]==min(ready[other] for other in waiting)
            started.add(key);slots[provider].add(key)
        elif action in ["RELEASED","DELIVERY_DEADLINE"]:assert key in slots[provider];slots[provider].remove(key)
        else:raise AssertionError("Unknown queue action")
        max_slots=max(max_slots,len(slots[provider]));assert len(slots[provider])<=cfg["provider_capacity"]
    assert max_slots==c["peak_occupied_slots"]
    assert all(not s for s in slots.values())
    assert all(v is False for v in direct["wallet_boundary"].values())
    for r in d["rounds"]:inspect_amounts(r["amounts"])
    for field in c:
        values=[r["counts"][field] for r in d["rounds"]]
        assert c[field]==(max(values) if field.startswith("peak_") else sum(values))
    for field in a:
        if field in ["opening_units","final_wallet_units"]:continue
        assert int(a[field])==sum(int(r["amounts"][field]) for r in d["rounds"])
    return {"transfers":len(d["transfers"]),"observations":len(d["observations"]),"queue_events":len(d["queue"])}

def inspect_campaign(d):
    assert d["fingerprint"]==campaign_hash(d) and d["classification"]=="SYNTHETIC"
    cfg=d["config"];expected=[(seed,s,p) for seed in cfg["seeds"] for s in cfg["scenarios"] for p in ["RESERVE_ON_QUOTE","STRICT_OBSERVATION","EVIDENCE_GRACE"]]
    assert [(r["seed"],r["scenario"],r["policy"]) for r in d["runs"]]==expected
    for seed in cfg["seeds"]:assert len({r["intentions_fingerprint"] for r in d["runs"] if r["seed"]==seed})==1
    for r in d["runs"]:inspect_amounts(r["metrics"]["amounts"]);assert r["metrics"]["counts"]["peak_occupied_slots"]<=cfg["provider_capacity"]

if __name__=="__main__":
    if len(sys.argv)!=2:raise SystemExit("usage: payment_audit.py REPORT.json")
    path=Path(sys.argv[1]);assert not path.is_symlink() and path.is_file() and path.stat().st_size<=128*1024*1024
    data=json.loads(path.read_text(encoding="utf-8"))
    if data.get("model")=="zoora-payment-run/0.1.0":result=inspect_run(data)
    elif data.get("model")=="zoora-payment-campaign/0.1.0":inspect_campaign(data);result={"runs":len(data["runs"])}
    else:raise SystemExit("Unsupported payment model")
    print(json.dumps({"classification":"SYNTHETIC","method":"INDEPENDENT_ARITHMETIC_AND_CAUSAL_CHECKS_NOT_SCENARIO_REGENERATION","verified":result,"native_replay_also_required":True}))
