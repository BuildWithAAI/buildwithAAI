"""Independent Python encoding and actual-CLI checks; all data is SYNTHETIC."""
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
CLASSIFICATION = "SYNTHETIC_VL002_NO_MONETARY_VALUE"
UNITS = "synthetic_units"
CLAUSES = [
    ["support_downtime", "SYNTHETIC: record support and downtime; no uptime guarantee."],
    ["prohibited_uses", "SYNTHETIC: only the named fixture business functions; no subletting."],
    ["content_ownership", "SYNTHETIC: no transfer of content ownership or third-party rights."],
    ["export_retention", "SYNTHETIC: export and retained audit are separate from access state."],
    ["termination_remedies", "SYNTHETIC: ending access does not erase history or move funds."],
    ["refund_review", "SYNTHETIC: refunds require a separate reviewed record; none is executed."],
    ["dispute_process", "SYNTHETIC: record disputed facts separately; no wallet freeze."],
    ["no_promises", "SYNTHETIC: no price, profit, holder distribution or native-coin promise."],
]
SCOPES = ["offer_space", "accept_lease", "request_renewal", "end_lease", "manage_dispute"]
FUNCTIONS = ["service_listing", "inquiry_link", "project_collaboration", "content_display", "agent_workspace"]


def encode(value):
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"), allow_nan=False).encode("ascii")


def fingerprint(kind, value):
    return hashlib.sha256(f"ZOORA_VL002_{kind}_JSON_TUPLE_V1\0".encode("ascii") + encode(value)).hexdigest()


def pin(p):
    return [p["id"], p["revision"], p["sha256"]]


def interval(i):
    return [i["start_ms"], i["end_ms"]]


def party(p):
    return [p["id"], p["operator"]]


def space(s):
    return [s["id"], s["provider"], s["mode"], s["capacity"],
            sorted(s["functions"], key=FUNCTIONS.index), s["subletting_permitted"]]


def claim(c):
    return [c["id"], c["party"], c["delegate"], c["space"],
            sorted(c["scopes"], key=SCOPES.index), interval(c["validity"]), pin(c["evidence"])]


def quote(q):
    return [q["provider_rent"], q["platform_fee"], q["source"], interval(q["validity"]),
            [q["timing"]["observed_ms"], q["timing"]["available_ms"]],
            q["provider_recipient"], q["platform_recipient"]]


def template_manifest():
    return ["lab_template", 1, "synthetic_lab_no_legal_jurisdiction", "synthetic_fixture_not_legal_review", CLAUSES]


def policy_manifest(p):
    return [p["pin"]["id"], p["pin"]["revision"], p["max_duration_ms"], p["notice_ms"], p["grace_ms"], 500, 2000]


def registry_digest(r):
    d = r["draft"]
    return fingerprint("REGISTRY", [1, CLASSIFICATION, UNITS, template_manifest(), policy_manifest(d["policy"]),
        d["instance"], space(d["space"]), [party(d[x]) for x in ("provider", "licensee", "platform")],
        [claim(d[x]) for x in ("provider_authority", "licensee_authority")],
        [[100, 200, "simulated_approved"], [100, 200, "simulated_approved"]], quote(d["quote"]), [0, 5000]])


def terms_digest(r, registry):
    d = r["draft"]
    p = d["policy"]
    return fingerprint("TERMS", [1, CLASSIFICATION, UNITS, registry, d["id"], d["instance"], space(d["space"]),
        [party(d[x]) for x in ("provider", "licensee", "platform")],
        [claim(d[x]) for x in ("provider_authority", "licensee_authority")],
        [pin(p["pin"]), p["max_duration_ms"], p["notice_ms"], p["grace_ms"]], pin(d["template"]),
        interval(d["interval"]), quote(d["quote"]), d.get("renewal_of"), sorted(d for d in r["clauses"])])


def seed_fixture():
    def p(name, value):
        return {"id": name, "revision": 1, "sha256": value}

    def a(name, party_id, actor, scopes, evidence):
        return {"id": name, "party": party_id, "delegate": actor, "space": "space_one", "scopes": scopes,
                "validity": {"start_ms": 0, "end_ms": 10000}, "evidence": p(evidence, "11" * 32)}

    r = {"schema_version": 1, "classification": CLASSIFICATION, "units": UNITS, "registry_sha256": "11" * 32,
         "clauses": [c[0] for c in CLAUSES], "draft": {
        "id": "lease_one", "instance": "lab_instance",
        "space": {"id": "space_one", "provider": "provider_one", "mode": "exclusive", "capacity": 5,
                  "functions": ["service_listing", "project_collaboration"], "subletting_permitted": False},
        "provider": {"id": "provider_one", "operator": "operator_one"},
        "licensee": {"id": "licensee_one", "operator": "operator_two"},
        "platform": {"id": "platform_one", "operator": "operator_three"},
        "provider_authority": a("provider_claim", "provider_one", "provider_actor", ["offer_space", "end_lease"], "provider_evidence"),
        "licensee_authority": a("licensee_claim", "licensee_one", "licensee_actor", ["accept_lease", "request_renewal"], "licensee_evidence"),
        "policy": {"pin": p("lab_policy", "11" * 32), "max_duration_ms": 10000, "notice_ms": 100, "grace_ms": 50},
        "template": p("lab_template", "11" * 32), "declared_terms_sha256": "11" * 32,
        "interval": {"start_ms": 2000, "end_ms": 3000},
        "quote": {"provider_rent": 100, "platform_fee": 10, "source": "lab_quote", "validity": {"start_ms": 900, "end_ms": 1500},
                  "timing": {"observed_ms": 900, "available_ms": 950}, "provider_recipient": "provider_one", "platform_recipient": "platform_one"},
        "renewal_of": None}}
    d = r["draft"]
    d["template"]["sha256"] = fingerprint("TEMPLATE", template_manifest())
    d["policy"]["pin"]["sha256"] = fingerprint("POLICY", policy_manifest(d["policy"]))
    r["registry_sha256"] = registry_digest(r)
    d["declared_terms_sha256"] = terms_digest(r, r["registry_sha256"])
    return r


def main():
    fixture_path = ROOT / "fixtures" / "valid_request.json"
    if sys.argv[1:] == ["--write-fixture"]:
        fixture_path.parent.mkdir(parents=True, exist_ok=True)
        fixture_path.write_text(json.dumps(seed_fixture(), indent=2) + "\n", encoding="utf-8")
        return
    binary = Path(sys.argv[1]) if len(sys.argv) == 2 else ROOT / "target" / "release" / ("vl-validate.exe" if os.name == "nt" else "vl-validate")
    binary = binary.resolve()
    original = json.loads(fixture_path.read_bytes())
    if original != seed_fixture():
        raise RuntimeError("fixture differs from independently constructed approved laboratory case")
    registry = original["registry_sha256"]
    records = []

    def run(name, request, at=1000, reason=None, rehash=False):
        request = copy.deepcopy(request)
        if rehash:
            request["draft"]["declared_terms_sha256"] = terms_digest(request, registry)
        raw = request if isinstance(request, bytes) else encode(request)
        result = subprocess.run([str(binary), "validate", str(at)], input=raw, capture_output=True, timeout=15)
        decision = json.loads(result.stdout)
        expected_status = "VALID_DRAFT" if reason is None else "REFUSED"
        if result.returncode != (0 if reason is None else 1) or decision["status"] != expected_status or decision["reason"] != reason:
            raise RuntimeError(f"unexpected decision for controlled case {name}")
        if decision["registry_sha256"] != registry or decision["classification"] != CLASSIFICATION or decision["at_ms"] != at:
            raise RuntimeError("decision context differs")
        raw_hash = hashlib.sha256(b"ZOORA_VL002_INPUT_BYTES_V1\0" + raw).hexdigest() if len(raw) <= 16384 else None
        if decision["input_sha256"] != raw_hash:
            raise RuntimeError("independent input digest differs")
        expected_terms = terms_digest(json.loads(raw), registry) if reason is None else None
        if decision["terms_sha256"] != expected_terms:
            raise RuntimeError("independent agreement digest differs")
        records.append({"case": name, "status": decision["status"], "reason": reason})

    run("valid_fixture", original)
    run("quote_age_equal_limit", original, at=1400)
    run("quote_age_over_limit", original, at=1401, reason="QUOTE_UNAVAILABLE_OR_STALE")
    run("quote_expiry_equal", original, at=1500, reason="QUOTE_NOT_CURRENT")
    run("quote_not_available", original, at=949, reason="QUOTE_UNAVAILABLE_OR_STALE")
    run("registry_expiry_equal", original, at=5000, reason="REGISTRY_NOT_CURRENT")
    run("unknown_field", {**original, "approve_and_send_funds": True}, reason="MALFORMED_INPUT")
    run("duplicate_json_field", b'{"schema_version":1,' + encode(original)[1:], reason="MALFORMED_INPUT")
    run("trailing_json", encode(original) + b"{}", reason="MALFORMED_INPUT")
    run("oversized_input", b"x" * 16385, reason="INPUT_TOO_LARGE")
    reorder = copy.deepcopy(original)
    reorder["clauses"].reverse()
    reorder["draft"]["space"]["functions"].reverse()
    reorder["draft"]["provider_authority"]["scopes"].reverse()
    run("semantic_sets_and_object_order", json.dumps(reorder, sort_keys=True, indent=2).encode())
    for path, value, reason in [
        (("quote", "provider_rent"), 101, "QUOTE_MISMATCH"),
        (("quote", "platform_fee"), 11, "QUOTE_MISMATCH"),
        (("provider", "operator"), "other_operator", "PARTY_OR_SPACE_MISMATCH"),
        (("provider_authority", "delegate"), "attacker_actor", "AUTHORITY_MISMATCH"),
        (("policy", "notice_ms"), 99, "POLICY_MISMATCH"),
        (("template", "revision"), 2, "TEMPLATE_MISMATCH"),
        (("interval", "start_ms"), 1099, "NOTICE_NOT_MET"),
    ]:
        altered = copy.deepcopy(original)
        altered["draft"][path[0]][path[1]] = value
        run("rehashed_" + "_".join(path), altered, reason=reason, rehash=True)
    altered = copy.deepcopy(original)
    altered["draft"]["interval"]["start_ms"] = 1100
    run("notice_equal_limit", altered, rehash=True)
    altered = copy.deepcopy(original)
    altered["draft"]["renewal_of"] = "prior_lease"
    run("renewal_requires_lifecycle", altered, reason="RENEWAL_REQUIRES_LIFECYCLE", rehash=True)
    out = ROOT / "target" / "validation-evidence"
    out.mkdir(parents=True, exist_ok=True)
    source = os.environ.get("SOURCE_HEAD_SHA", "local_unpublished")
    report = {"classification": CLASSIFICATION, "source_head_sha": source, "registry_sha256": registry,
              "terms_sha256": original["draft"]["declared_terms_sha256"], "checks": records, "passed": len(records)}
    (out / "vl002-independent.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"{len(records)} independent CLI/hash checks passed; synthetic draft validation only")


if __name__ == "__main__":
    main()
