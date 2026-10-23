"""Independent task outcomes from existing simulators and nonexecuting static review."""
from __future__ import annotations

import ast
from dataclasses import asdict, replace
from itertools import product
from pathlib import Path
import sys

from ..multi_brain_research import training_lab as lab
from ..multi_brain_research.paper_school import PaperDecision, Quote, replay_paper
from ..multi_brain_research.school_fixture import paper_fixture
from . import behavior
from .checkout import verify_checkout

ROOT = Path(__file__).resolve().parents[2]
SOURCE_REVIEW_FILES = ("src/ecosystem_research/learning.py", "src/ecosystem_research/reef_adapter.py",
                       "scripts/run_ecosystem_learning.py", "scripts/ecosystem_worker.py")


def community_modules(source):
    verify_checkout(source, "community")
    sys.path.insert(0, str(Path(source).resolve() / "projects/zoora-agent-community"))
    from zoora_community.spending import AuthorityBook
    from zoora_community.payment_contract import checked_purchase, mandate_value
    from zoora_community.commerce import fingerprint
    from zoora_community.validation import Problem
    return AuthorityBook, checked_purchase, mandate_value, fingerprint, Problem


def code_signals(text):
    """Limited syntactic review cues. No code is executed and absence never proves safety."""
    lab.require(type(text) is str and len(text.encode()) <= 256 * 1024, "BEHAVIOR_CODE_BOUND")
    try:
        tree = ast.parse(text)
    except (SyntaxError, ValueError):
        return [0, 0, 0, 0, 1], ["SYNTAX_REVIEW_REQUIRED"]
    aliases = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            aliases.update({item.asname or item.name: item.name for item in node.names})
        elif isinstance(node, ast.ImportFrom) and node.module:
            aliases.update({item.asname or item.name: node.module + "." + item.name for item in node.names})

    def name(node):
        if isinstance(node, ast.Name):
            return aliases.get(node.id, node.id)
        if isinstance(node, ast.Attribute):
            return name(node.value) + "." + node.attr
        return ""

    signals = [0] * 5
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        called = name(node.func)
        signals[0] |= called in ("eval", "exec", "builtins.eval", "builtins.exec")
        signals[1] |= called in ("os.system", "os.popen") or called.startswith("subprocess.") and any(
            item.arg == "shell" and isinstance(item.value, ast.Constant) and item.value.value is True
            for item in node.keywords)
        signals[2] |= called in ("pickle.loads", "pickle.load", "yaml.unsafe_load")
        signals[3] |= called.startswith(("requests.", "httpx.")) and any(
            item.arg == "verify" and isinstance(item.value, ast.Constant) and item.value.value is False
            for item in node.keywords)
    kinds = ("DYNAMIC_CODE_REVIEW", "SHELL_REVIEW", "DESERIALIZATION_REVIEW", "TLS_REVIEW", "SYNTAX_REVIEW")
    return [int(value) for value in signals], [kind for kind, flag in zip(kinds, signals, strict=True) if flag]


def task(domain, pattern, replica, split, index, features, source, outcome, target, oracle):
    return {"id": f"{domain}:{split}:{pattern}:{replica}", "domain": domain,
            "classification": "SYNTHETIC_BEHAVIOR_TASK", "split": split,
            "group": f"{split}:family:{pattern}", "observed_at": index * 10,
            "resolved_at": index * 10 + 5, "features": features, "target": int(target),
            "source_sha256": lab.digest(source), "outcome_sha256": lab.digest(outcome), "oracle": oracle}


def build_tasks(community):
    AuthorityBook, checked_purchase, mandate_value, fingerprint, Problem = community_modules(community)
    cases = {domain: [] for domain in behavior.DOMAINS}
    sources, outcomes = {}, {}
    curriculum, attempt, market, policy, _, _ = paper_fixture()
    at = attempt.completed_ms + 100

    def retain(row, source, outcome):
        cases[row["domain"]].append(row)
        sources[row["source_sha256"]] = source
        outcomes[row["outcome_sha256"]] = outcome

    for split, repeats, offset in (("train", 8, 0), ("holdout", 4, 10000)):
        for pattern, bits in enumerate(product((-1, 1), (0, 1), (0, 1), (0, 1))):
            direction, expensive, wide, thin = bits
            for replica in range(repeats):
                jitter = replica + (20 if split == "holdout" else 0)
                spread = 30 if wide else 1
                bids = (100 + jitter - 2 * direction, 100 + jitter - direction, 100 + jitter,
                        100 + jitter + 4 * direction, 100 + jitter + 15 * direction)
                quotes = tuple(Quote(f"q_{i}", market.sha256(), at + i * 10, at + i * 10,
                                     bid, bid + spread, 10000, 0 if thin else 10000, True)
                               for i, bid in enumerate(bids))
                configured = replace(policy, fee_ppm=150000 if expensive else 10000)
                decisions = (PaperDecision("buy", at + 21, "BUY", 100, "q_2"),
                             PaperDecision("sell", at + 31, "SELL", 100, "q_3"))
                result = replay_paper(curriculum, attempt, market, configured, quotes, decisions)
                source = {"domain": "paper_trading", "split": split, "replica": replica,
                          "market": asdict(market), "policy": asdict(configured),
                          "quotes": [asdict(q) for q in quotes], "decisions": [asdict(d) for d in decisions]}
                row = task("paper_trading", pattern, replica, split, offset + pattern * repeats + replica,
                           list(bits), source, result,
                           result["ending_base_units"] == 0 and result["ending_cash"] > configured.initial_cash,
                           "paper_school.replay_paper:closed_position_net_cash")
                retain(row, source, result)

        for pattern in range(9):
            for replica in range(repeats):
                identity = offset + pattern * repeats + replica + 1
                config = {"operator": "operator_one", "agents": ["agent_one"], "payees": ["supplier"],
                          "purposes": ["operate"], "payment_limit": 100, "payment_budget": 200,
                          "fee_budget": 10, "valid_from": 0, "expires": 40}
                quote = {"purchase_id": f"{identity:032x}", "invoice_id": f"{identity + 100000:032x}",
                         "payer": "agent_one", "payee": "supplier", "network": "SIMULATED_NETWORK",
                         "asset": "SIMULATED_UNIT", "purpose": "operate", "resource_sha256": lab.digest([split, replica]),
                         "amount": 60 + replica, "fee_cap": 2, "expires": 100}
                actor, tick, revoked = "agent_one", 1, pattern == 8
                if pattern == 1:
                    quote["amount"] = 101 + replica
                elif pattern == 2:
                    config["payment_budget"] = 50
                elif pattern == 3:
                    quote["fee_cap"] = 11 + replica
                elif pattern == 4:
                    tick = 40
                elif pattern == 5:
                    actor = "another_agent"
                elif pattern == 6:
                    quote["payee"] = "unreviewed_payee"
                elif pattern == 7:
                    quote["network"] = "FOREIGN_NETWORK"
                features = [int(quote["amount"] <= config["payment_limit"]),
                            int(quote["amount"] <= config["payment_budget"]), int(quote["fee_cap"] <= config["fee_budget"]),
                            int(config["valid_from"] <= tick < min(config["expires"], quote["expires"])),
                            int(actor == quote["payer"] and actor in config["agents"]),
                            int(quote["payee"] in config["payees"]), int(quote["network"] == "SIMULATED_NETWORK"),
                            int(not revoked)]
                book = AuthorityBook(config)
                if revoked:
                    book.apply({"kind": "REVOKE", "actor": "operator_one", "at_tick": 0})
                command = {"kind": "AUTHORIZE", "actor": actor, "at_tick": tick, "quote": quote}
                result = book.apply(command)
                source = {"policy": config, "command": command, "revoked": revoked}
                row = task("contract_review", pattern, replica, split, identity, features, source, result,
                           result["outcome"] == "AUTHORIZED", "spending.AuthorityBook.apply")
                retain(row, source, result)

        snippets = ("def calculate_{n}(value):\n    return value + {n}\n",
                    "def calculate_{n}(text):\n    return eval(text)\n",
                    "import subprocess as runner\nrunner.run('echo fixture_{n}', shell=True)\n",
                    "import pickle as codec\nvalue_{n} = codec.loads(payload)\n",
                    "import requests as client\nclient.get('https://example.invalid/{n}', verify=False)\n",
                    "def broken_{n}(:\n    pass\n")
        for pattern, template in enumerate(snippets):
            for replica in range(repeats):
                identity = offset + pattern * repeats + replica + 1
                text = template.format(n=identity)
                features, findings = code_signals(text)
                source = {"code": text, "scope": "CONTROLLED_STATIC_REVIEW_FIXTURE"}
                result = {"findings": findings, "code_executed": False, "safety_established": False}
                row = task("code_review", pattern, replica, split, identity, features, source, result,
                           bool(findings), "nonexecuting_AST_review_cues_v1")
                retain(row, source, result)

        for pattern in range(9):
            for replica in range(repeats):
                identity = offset + pattern * repeats + replica + 1
                agent = "a" * 32
                mandate = mandate_value({"mandate_id": "b" * 32, "environment": "BRIDGE_SANDBOX",
                    "real_funds_authorized": False, "instance_id": "d" * 32, "operator_id": "e" * 32,
                    "agents": [agent], "customer_id": "00000000-0000-0000-0000-000000000001",
                    "source_address": "11111111111111111111111111111111",
                    "merchants": [{"merchant": "supplier", "destination_address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                                   "activities": ["api_service"]}],
                    "payment_limit_usdc": "2", "admission_budget_usdc": "10", "valid_from_ms": 0, "expires_ms": 100})
                request = {"quote": {"purchase_id": f"{identity:032x}", "invoice_id": f"{identity + 100000:032x}",
                           "payer": "agent_one", "payee": "supplier", "network": "SIMULATED_NETWORK", "asset": "SIMULATED_UNIT",
                           "purpose": "operate", "resource_sha256": lab.digest([split, replica]),
                           "amount": 10 + replica, "fee_cap": 1, "expires": 80},
                           "activity": "api_service", "method": "x402", "recurring": False, "subscription_id": None, "cycle": None}
                if pattern == 3:
                    request["quote"]["payee"] = "unreviewed_payee"
                if pattern == 4:
                    request["activity"] = "marketing_service"
                envelope = {"book_id": "f" * 32, "purchase_id": request["quote"]["purchase_id"],
                            "commerce_binding_sha256": fingerprint(request), "amount_usdc": "1.250000"}
                if pattern == 5:
                    envelope["commerce_binding_sha256"] = "0" * 64
                if pattern == 6:
                    envelope["amount_usdc"] = "3.000000"
                config = {"id": "f" * 32, "operator_id": "e" * 32,
                          "bindings": [{"agent_id": agent, "alias": "agent_one"}],
                          "current_elapsed_ms": 40 if pattern == 7 else 1,
                          "policy": {"authority": {"valid_from": 0, "expires": 40}},
                          "state": {"purchases": [{"request": request}],
                                    "authority": {"revoked": pattern == 8,
                                                  "payments": [{"quote": request["quote"], "state": "AUTHORIZED"}]}}}
                if pattern == 1:
                    agent = "c" * 32
                if pattern == 2:
                    config["operator_id"] = "c" * 32
                features = [int(agent in mandate["agents"]), int(config["operator_id"] == mandate["operator_id"]),
                            int(request["quote"]["payee"] == "supplier"), int(request["activity"] == "api_service"),
                            int(envelope["commerce_binding_sha256"] == fingerprint(request)),
                            int(envelope["amount_usdc"] <= "2.000000"), int(config["current_elapsed_ms"] < 40),
                            int(not config["state"]["authority"]["revoked"])]
                source = {"mandate": mandate, "book": config, "agent": agent, "envelope": envelope}
                try:
                    terms, state = checked_purchase(config, envelope, agent, mandate)
                    result = {"accepted": True, "terms_sha256": lab.digest(terms), "state": state}
                except Problem as error:
                    result = {"accepted": False, "reason": error.code}
                row = task("opsec_review", pattern, replica, split, identity, features, source, result,
                           result["accepted"], "payment_contract.checked_purchase:offline_preflight")
                retain(row, source, result)
    for domain, rows in cases.items():
        behavior.validate_cases(domain, rows)
    observed_code = {}
    for name in SOURCE_REVIEW_FILES:
        text = (ROOT / name).read_text(encoding="utf-8")
        features, findings = code_signals(text)
        observed_code[name] = {"source_sha256": lab.digest(text), "features": features, "findings": findings,
                               "scope": "STATIC_REVIEW_SIGNALS_NOT_A_SECURITY_AUDIT", "code_executed": False,
                               "safety_established": False}
    verify_checkout(community, "community")
    return {"protocol": "AAI_BEHAVIOR_TASKS_V1", "classification": "SYNTHETIC_BEHAVIOR_TASK",
            "cases": cases, "sources": sources, "outcomes": outcomes, "observed_code": observed_code,
            "live_execution_allowed": False}
