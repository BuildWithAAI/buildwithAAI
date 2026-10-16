"""Independent retained-fixture audit; standard library only, no application imports."""

import argparse
from collections import Counter
from contextlib import closing
import copy
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import tempfile
import zipfile


def require(condition, description):
    if not condition:
        raise ValueError(description)


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(encoded(value)).hexdigest()


def units(value):
    require(type(value) is str and re.fullmatch(r"[0-9]+\.[0-9]{6}", value), "exact USDC format")
    return int(value.replace(".", ""))


def database(raw, filename, tables, version):
    filename.write_bytes(raw)
    with closing(sqlite3.connect(filename.as_uri() + "?mode=ro", uri=True, autocommit=True)) as connection:
        connection.row_factory = sqlite3.Row
        connection.setconfig(sqlite3.SQLITE_DBCONFIG_DEFENSIVE, True)
        connection.setconfig(sqlite3.SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION, False)
        connection.execute("PRAGMA trusted_schema=OFF")
        connection.execute("PRAGMA query_only=ON")
        require(connection.execute("PRAGMA user_version").fetchone()[0] == version, "database version")
        require([r[0] for r in connection.execute("PRAGMA quick_check")] == ["ok"], "database integrity")
        require(not connection.execute("PRAGMA foreign_key_check").fetchall(), "database foreign keys")
        actual = {r[0] for r in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        require(actual == set(tables), "database tables")
        return {name: [dict(row) for row in connection.execute("SELECT * FROM " + name + " ORDER BY " + order)]
                for name, order in tables.items()}


def check_package(path, pin, expected, source_links):
    require(hashlib.sha256(path.read_bytes()).hexdigest() == pin, "package pin")
    with zipfile.ZipFile(path) as archive:
        require(archive.testzip() is None, "package CRC")
        names = archive.namelist()
        require(len(names) == len(set(names)) and set(names) in (
            {"manifest.json", "payment-pipeline.sqlite3"},
            {"manifest.json", "payment-pipeline.sqlite3", "provider/bridge-sandbox.sqlite3"}), "package members")
        manifest = json.loads(archive.read("manifest.json"))
        require(manifest["format"] == "ZOORA_PAYMENT_RECOVERY_V1" and manifest["audit"] == expected, "package manifest audit")
        hashes = {name: hashlib.sha256(archive.read(name)).hexdigest() for name in names if name != "manifest.json"}
        require(hashes == manifest["files"], "database file pins")
        with tempfile.TemporaryDirectory(prefix="independent-payment-audit-") as directory:
            folder = Path(directory)
            q = database(archive.read("payment-pipeline.sqlite3"), folder / "queue.sqlite3",
                {"control": "id", "pipeline_recovery": "id", "orders": "id", "claims": "order_id,sequence"}, 2)
            control = {**q["control"][0], "pipeline_schema_version": 2, "recovery": q["pipeline_recovery"][0]}
            mandate = json.loads(control["mandate_json"])
            require(digest(mandate) == control["mandate_sha256"] == expected["mandate_sha256"], "mandate pin")
            require(mandate["real_funds_authorized"] is False and mandate["environment"] == "BRIDGE_SANDBOX", "sandbox mandate")
            logical = {"control": control, "orders": q["orders"], "claims": q["claims"]}
            require(digest(logical) == expected["queue_logical_sha256"], "queue logical hash")
            require(control["recovery"]["mode"] == expected["pipeline_mode"] == "ACTIVE", "original queue mode")
            require(expected["source_instance_id"] == mandate["instance_id"], "source instance pin")
            require(len(q["orders"]) == expected["orders"] and len(q["claims"]) == expected["claims"], "queue counts")
            require(sum(c["finished_ms"] is None for c in q["claims"]) == expected["unfinished_claims"], "unfinished claims")
            require(sum(c["dispatch_ms"] is not None for c in q["claims"]) == expected["dispatch_fences"], "dispatch fences")
            b = None
            if "provider/bridge-sandbox.sqlite3" in names:
                b = database(archive.read("provider/bridge-sandbox.sqlite3"), folder / "provider.sqlite3",
                    {"intents": "id", "attempts": "id", "bridge_migrations": "version", "bridge_control": "id"}, 3)
                require(digest({"schema_version": 3, "tables": b}) == expected["provider"]["logical_state_sha256"], "provider logical hash")
                require(len(b["intents"]) == expected["provider"]["journal_intents"]
                        and len(b["attempts"]) == expected["provider"]["journal_attempts"], "provider counts")
            else:
                require(expected["provider"] is None, "missing provider history")
            provider = {row["id"]: row for row in b["intents"]} if b else {}
            require(set(provider) <= {row["id"] for row in q["orders"]}, "orphan provider intent")
            total = 0
            for order in q["orders"]:
                key, terms = order["id"], json.loads(order["terms_json"])
                require(order["terms_sha256"] == digest(terms), "order terms pin")
                require(terms == source_links[key]["order"]["terms"], "original source fixture terms")
                e, request = terms["envelope"], terms["commerce_request"]
                require(hashlib.sha256(b"ZOORA_AE022_COMMERCE_ROUTER_V1\0" + encoded(request)).hexdigest()
                        == e["commerce_binding_sha256"], "source commerce binding")
                require(key == digest({"domain": "ZOORA_SANDBOX_PURCHASE_V1", "instance_id": mandate["instance_id"],
                    "book_id": e["book_id"], "purchase_id": e["purchase_id"]})[:32], "purchase identity")
                require(request["quote"]["purchase_id"] == e["purchase_id"] and terms["agent_id"] in mandate["agents"], "purchase actor")
                merchant = next(m for m in mandate["merchants"] if m["merchant"] == request["quote"]["payee"])
                require(request["activity"] in merchant["activities"], "merchant activity")
                require(terms["intent"] == {"request_id": key, "customer_id": mandate["customer_id"],
                    "source_address": mandate["source_address"], "destination_address": merchant["destination_address"],
                    "amount_usdc": e["amount_usdc"]}, "provider intent")
                value = units(e["amount_usdc"])
                require(0 < value <= units(mandate["payment_limit_usdc"]), "payment principal limit")
                total += value
                inventory = next(item for item in expected["inventory"] if item["order_id"] == key)
                require(inventory["terms_sha256"] == digest(terms) and inventory["amount_usdc"] == e["amount_usdc"], "inventory terms")
                if key in provider:
                    row = provider[key]
                    require(json.loads(row["intent_json"]) == terms["intent"], "cross-journal intent")
                    body = {"on_behalf_of": mandate["customer_id"], "amount": e["amount_usdc"],
                        "client_reference_id": row["idempotency_key"],
                        "source": {"payment_rail": "solana", "currency": "usdc", "from_address": mandate["source_address"]},
                        "destination": {"payment_rail": "solana", "currency": "usdc", "to_address": merchant["destination_address"]}}
                    require(json.loads(row["body_json"]) == body and row["body_sha256"] == digest(body)
                            == inventory["provider_body_sha256"], "cross-journal provider body")
                    require(inventory["idempotency_key"] == row["idempotency_key"], "provider key")
                    attempts = [a for a in b["attempts"] if a["intent_id"] == key]
                    require(len(attempts) == inventory["provider_attempts"], "per-order attempts")
                    creates = [a for a in attempts if a["kind"] == "CREATE"]
                    require(len(creates) <= 1, "one create per order")
                    for attempt in creates:
                        require(any(c["order_id"] == key and c["dispatch_ms"] is not None
                            and c["started_ms"] <= attempt["started_ms"] < c["started_ms"] + 120_000
                            for c in q["claims"]), "create dispatch fence")
            require(total == units(expected["admitted_principal_usdc"]) <= units(mandate["admission_budget_usdc"]), "lifetime admission")
    return len(q["orders"])


def verify(report, fixture, source):
    require(report["source_head_sha"] == source, "source head")
    require(report["classification"] == "CONNECTED_PAYMENT_RECOVERY_PACKAGE_LOCAL_FIXTURE", "report classification")
    require(len(report["checks"]) == len(set(report["checks"])) == 37 and report["base_pipeline_checks"] == 37, "rehearsal checks")
    require(report["external_bridge_requests"] == 0 and report["real_funds_authorized"] is False
            and report["wallet_execution"] is False and report["settlement_accounting"] == "UNAVAILABLE", "execution boundary")
    require(report["source_state_included"] is False and report["credentials_included"] is False, "package scope")
    links = {row["order"]["order_id"]: row for row in report["fixture_bindings"]}
    count = check_package(fixture, report["package_sha256"], report["source_snapshot_audit"], links)
    require(count == 10, "complete order count")
    for label, checkpoint in report["checkpoints"].items():
        path = fixture.parent / ("payment-recovery-checkpoint-" + label + ".zip")
        count += check_package(path, checkpoint["backup_sha256"], checkpoint["audit"], links)
    require(set(report["checkpoints"]) == {"before_dispatch", "submit", "create", "fence", "finish"}, "checkpoint coverage")
    for restored in report["checkpoint_restores"]:
        original = report["checkpoints"][restored["checkpoint"]]["audit"]
        require(restored["snapshot_audit"] == original, "restore snapshot")
        after = restored["restored_audit"]
        require(after["pipeline_mode"] == after["provider"]["journal_mode"] == "RECOVERY_ONLY", "restored modes")
        for field in ("orders", "dispatch_fences", "admitted_principal_usdc", "mandate_sha256"):
            require(after[field] == original[field], "restored immutable quantity")
        before_keys = {r["order_id"]: (r["terms_sha256"], r["provider_body_sha256"], r["idempotency_key"]) for r in original["inventory"]}
        after_keys = {r["order_id"]: (r["terms_sha256"], r["provider_body_sha256"], r["idempotency_key"]) for r in after["inventory"]}
        require(before_keys == after_keys, "restored immutable identities")
    wire, boundary = report["wire"], report["recovery_boundary"]
    require(boundary == 24 and len(wire) == 29 and Counter(r["method"] for r in wire) == {"POST": 8, "GET": 21}, "wire counts")
    require(all(r["method"] == "GET" and r["body_sha256"] is None and r["idempotency_key"] is None for r in wire[boundary:]), "GET-only recovery wire")
    posts = [r for r in wire if r["method"] == "POST"]
    require(len({r["idempotency_key"] for r in posts}) == 8, "unique POST identities")
    for post in posts:
        provider = next(row["provider"] for row in links.values() if row["provider"] and row["provider"]["idempotency_key"] == post["idempotency_key"])
        require(post["body_sha256"] == provider["body_sha256"], "POST body pin")
    final = report["final_restored_audit"]
    require(final["pipeline_mode"] == final["provider"]["journal_mode"] == "RECOVERY_ONLY"
            and final["claims"] == 19 and final["unfinished_claims"] == 5 and final["provider"]["journal_attempts"] == 14
            and final["admitted_principal_usdc"] == "13.000000", "final recovery accounting")
    require(report["publication_process_deaths"] == [86, 87] and report["recovery_process_death"] == 85
            and [r["exit_code"] for r in report["base_process_deaths"]] == [82, 83, 84, 85], "actual process boundaries")
    require(report["source_db_unchanged"] is True and report["migration"]["from_schema"] == 1
            and report["migration"]["pipeline_schema_version"] == 2, "source and migration")
    return {"verified": True, "source_sha": source, "packages_verified": 6, "database_order_bindings": count,
            "recovery_get_requests": len(wire) - boundary, "external_attestation": "UNAVAILABLE"}


def mutation_checks(report, fixture, source):
    mutations = [lambda d: d.update(source_head_sha="0" * 40), lambda d: d.update(package_sha256="0" * 64),
        lambda d: d["source_snapshot_audit"].update(admitted_principal_usdc="13.000001"),
        lambda d: d["source_snapshot_audit"].update(queue_logical_sha256="0" * 64),
        lambda d: d["wire"][-1].update(method="POST"), lambda d: d["wire"][-1].update(idempotency_key="wrong"),
        lambda d: d["checkpoint_restores"][0]["restored_audit"].update(pipeline_mode="ACTIVE"),
        lambda d: d["checkpoint_restores"][1]["restored_audit"]["inventory"][0].update(idempotency_key="wrong"),
        lambda d: d["checkpoints"]["create"]["audit"].update(orders=999),
        lambda d: d["final_restored_audit"].update(unfinished_claims=0),
        lambda d: d["final_restored_audit"]["provider"].update(journal_attempts=13),
        lambda d: d.update(publication_process_deaths=[86]), lambda d: d.update(source_db_unchanged=False),
        lambda d: d.update(real_funds_authorized=True)]
    for mutate in mutations:
        changed = copy.deepcopy(report)
        mutate(changed)
        require(encoded(changed) != encoded(report), "mutation must change data")
        try:
            verify(changed, fixture, source)
        except (ValueError, KeyError, StopIteration):
            continue
        raise ValueError("altered evidence accepted")
    return len(mutations)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    report = json.loads(args.report.read_bytes())
    result = verify(report, args.fixture, args.source_sha)
    if args.self_test:
        result["deliberate_alterations_rejected"] = mutation_checks(report, args.fixture, args.source_sha)
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
