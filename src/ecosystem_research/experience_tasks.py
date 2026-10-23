"""Compound-task variants and verified feature-omission counterexamples; sandbox only."""
from __future__ import annotations

from copy import deepcopy
from itertools import combinations, product

from . import behavior as b, behavior_tasks as bt
from ..multi_brain_research import training_lab as lab
from ..multi_brain_research.paper_school import PaperDecision, PaperPolicy, Quote, replay_paper
from ..multi_brain_research.school_fixture import paper_fixture


def build_tasks(parent, community):
    AuthorityBook, checked_purchase, _, fingerprint, Problem = bt.community_modules(community)
    curriculum, attempt, market, _, _, _ = paper_fixture()
    batches = {stage: {domain: [] for domain in b.DOMAINS} for stage in ("extension", "drift", "novelty")}
    sources, outcomes = {}, {}

    def seed(domain, wanted):
        row = next(c for c in parent["cases"][domain] if c["target"] == wanted)
        return deepcopy(parent["sources"][row["source_sha256"]])

    def retain(domain, stage, split, pattern, replica, source, features, outcome, target, oracle):
        index = {"extension": 20000 if split == "train" else 30000, "drift": 40000, "novelty": 60000}[stage]
        source["experience_variant"] = [stage, split, pattern, replica]
        row = bt.task(domain, pattern, replica, split, index + pattern * 8 + replica,
                      features, source, outcome, target, oracle)
        row["id"] = stage + ":" + row["id"]
        row["group"] = stage + ":" + row["group"]
        batches[stage][domain].append(row)
        sources[row["source_sha256"]], outcomes[row["outcome_sha256"]] = source, outcome

    def paper(stage, split, pattern, replica, bits):
        expensive, wide, thin = bits
        source = seed("paper_trading", 1)
        reference = 130 + replica + (30 if split == "holdout" else 0)
        direction = 1 if stage == "drift" else 0
        bids = [reference - 2 * direction, reference - direction, reference, reference + 4, reference + 15]
        if stage == "drift":
            bids[3:] = [reference - 20, reference - 30]
        for quote, bid in zip(source["quotes"], bids, strict=True):
            quote.update(bid=bid, ask=bid + (30 if wide else 1), ask_size=0 if thin else 10000)
        source["policy"]["fee_ppm"] = 50000 if stage == "novelty" else (150000 if expensive else 10000)
        configured = PaperPolicy(**source["policy"])
        result = replay_paper(curriculum, attempt, market, configured,
                              tuple(Quote(**q) for q in source["quotes"]),
                              tuple(PaperDecision(**d) for d in source["decisions"]))
        features = [direction, -1 if stage == "novelty" else expensive, wide, thin]
        retain("paper_trading", stage, split, pattern, replica, source, features, result,
               result["ending_base_units"] == 0 and result["ending_cash"] > configured.initial_cash,
               "paper_school.replay_paper:closed_position_net_cash")

    def contract(stage, split, pattern, replica, faults):
        source = seed("contract_review", 1)
        config, command = source["policy"], source["command"]
        quote = command["quote"]
        number = {"extension": 20000, "drift": 40000, "novelty": 60000}[stage] + pattern * 10 + replica
        if split == "holdout":
            number += 100000
        quote.update(purchase_id=f"{number:032x}", invoice_id=f"{number + 1000000:032x}", amount=60 + replica)
        if 0 in faults:
            quote["amount"] = 101 + replica
        if 1 in faults:
            config["payment_budget"] = 50
        if 2 in faults:
            quote["fee_cap"] = 12
        if 3 in faults:
            command["at_tick"] = 40
        if 4 in faults:
            command["actor"] = "unreviewed_actor"
        if 5 in faults:
            quote["payee"] = "unreviewed_payee"
        if 6 in faults:
            quote["network"] = "FOREIGN_NETWORK"
        source["revoked"] = 7 in faults
        if stage == "drift":
            quote["purpose"] = "outside_purpose_scope"  # Deliberately omitted from the eight learner features.
        features = [int(quote["amount"] <= config["payment_limit"]), int(quote["amount"] <= config["payment_budget"]),
                    int(quote["fee_cap"] <= config["fee_budget"]),
                    int(config["valid_from"] <= command["at_tick"] < min(config["expires"], quote["expires"])),
                    int(command["actor"] == quote["payer"] and command["actor"] in config["agents"]),
                    int(quote["payee"] in config["payees"]), int(quote["network"] == "SIMULATED_NETWORK"),
                    int(not source["revoked"])]
        book = AuthorityBook(config)
        if source["revoked"]:
            book.apply({"kind": "REVOKE", "actor": config["operator"], "at_tick": 0})
        result = book.apply(command)
        retain("contract_review", stage, split, pattern, replica, source, features, result,
               result["outcome"] == "AUTHORIZED", "spending.AuthorityBook.apply")

    def opsec(stage, split, pattern, replica, faults):
        source = seed("opsec_review", 1)
        book, mandate, envelope = source["book"], source["mandate"], source["envelope"]
        request = book["state"]["purchases"][0]["request"]
        number = {"extension": 20000, "drift": 40000, "novelty": 60000}[stage] + pattern * 10 + replica
        if split == "holdout":
            number += 100000
        request["quote"].update(purchase_id=f"{number:032x}", invoice_id=f"{number + 1000000:032x}", amount=11 + replica)
        envelope["purchase_id"] = request["quote"]["purchase_id"]
        if 0 in faults:
            source["agent"] = "c" * 32
        if 1 in faults:
            book["operator_id"] = "c" * 32
        if 2 in faults:
            request["quote"]["payee"] = "unreviewed_payee"
        if 3 in faults:
            request["activity"] = "marketing_service"
        envelope["commerce_binding_sha256"] = "0" * 64 if 4 in faults else fingerprint(request)
        if 5 in faults:
            envelope["amount_usdc"] = "3.000000"
        if 6 in faults:
            book["current_elapsed_ms"] = 40
        book["state"]["authority"]["revoked"] = 7 in faults
        paid = book["state"]["authority"]["payments"][0]
        paid["quote"] = deepcopy(request["quote"])
        if stage == "drift":
            paid["state"] = "DECLINED"  # Actual authorization state is omitted from the learner feature vector.
        features = [int(source["agent"] in mandate["agents"]), int(book["operator_id"] == mandate["operator_id"]),
                    int(request["quote"]["payee"] == "supplier"), int(request["activity"] == "api_service"),
                    int(envelope["commerce_binding_sha256"] == fingerprint(request)),
                    int(envelope["amount_usdc"] <= "2.000000"), int(book["current_elapsed_ms"] < 40),
                    int(not book["state"]["authority"]["revoked"])]
        try:
            terms, state = checked_purchase(book, envelope, source["agent"], mandate)
            result = {"accepted": True, "terms_sha256": lab.digest(terms), "state": state}
        except Problem as error:
            result = {"accepted": False, "reason": error.code}
        retain("opsec_review", stage, split, pattern, replica, source, features, result,
               result["accepted"], "payment_contract.checked_purchase:offline_preflight")

    cues = ("value = eval(text)", "import subprocess as runner\nrunner.run(command, shell=True)",
            "import pickle as codec\nvalue = codec.loads(payload)",
            "import requests as client\nclient.get(url, verify=False)")

    def code(stage, split, pattern, replica, chosen):
        text = f"def context_{stage}_{split}_{pattern}_{replica}(value):\n    return value + {replica}\n"
        text += "\n".join(cues[i] for i in chosen) + "\n"
        features, findings = bt.code_signals(text)
        result = {"findings": findings, "code_executed": False, "safety_established": False}
        retain("code_review", stage, split, pattern, replica, {"code": text}, features, result, bool(findings),
               "nonexecuting_AST_review_cues_v1")

    for split in ("train", "holdout"):
        for pattern, bits in enumerate(product((0, 1), repeat=3)):
            for replica in range(4):
                paper("extension", split, pattern, replica, bits)
        for pattern, faults in enumerate([()] + list(combinations(range(8), 2))):
            for replica in range(4):
                contract("extension", split, pattern, replica, faults)
                opsec("extension", split, pattern, replica, faults)
        for pattern, chosen in enumerate([()] + list(combinations(range(4), 2))):
            for replica in range(4):
                code("extension", split, pattern, replica, chosen)
    for replica in range(4):
        paper("drift", "train", 0, replica, (0, 0, 0))
        contract("drift", "train", 0, replica, ())
        opsec("drift", "train", 0, replica, ())
        paper("novelty", "holdout", 0, replica, (0, 0, 0))
        contract("novelty", "holdout", 0, replica, (0, 1, 2))
        opsec("novelty", "holdout", 0, replica, (0, 1, 2))
        code("novelty", "holdout", 0, replica, (0, 1, 2))
    for domains in batches.values():
        for domain, rows in domains.items():
            if rows:
                b.validate_cases(domain, rows)
    bt.verify_checkout(community, "community")
    return {"protocol": "AAI_EXPERIENCE_CURRICULUM_V1", "classification": "SYNTHETIC_BEHAVIOR_TASK",
            "batches": batches, "sources": sources, "outcomes": outcomes, "live_execution_allowed": False}
