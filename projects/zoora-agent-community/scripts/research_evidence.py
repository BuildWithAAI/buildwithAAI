"""Actual HTTP/enrollment -> pinned CLI -> real Rust engine -> replay evidence.

Accounts and work are test fixtures; keys are public reproducible NEVER-FUND keys.
The authenticated local service, wallet signatures, database and subprocesses are real.
"""

import argparse
import base64
import copy
import gzip
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import tempfile

from integration_evidence import ROOT, Running, command
from fixture_signatures import address, signed_body
from zoora_community.client import read_credential
from zoora_community.research import BUNDLE_DOMAIN
from zoora_community.research_identity import fingerprint, verify_snapshot
from zoora_community.store import Store
from zoora_community.validation import Problem, canonical
from zoora_community.wallet_proof import decode_base58
from nacl.signing import VerifyKey

REVIEW = ROOT.parent / "zoora-agent-economy-simulator/review"
sys.path.insert(0, str(REVIEW / "scripts"))
from owner_audit import inspect_run, run_hash  # noqa: E402

if not __debug__:
    raise SystemExit("Run research evidence without -O; acceptance assertions must stay enabled")


def run(engine, bootstrap_reference=False):
    checks = []
    engine = Path(engine).absolute()
    engine_sha = hashlib.sha256(engine.read_bytes()).hexdigest()
    output = ROOT / "evidence-output"
    output.mkdir(exist_ok=True)
    secrets = []

    def check(label, condition=True):
        assert condition, label
        checks.append(label)

    def cli(*args, optimized=False, expected=0):
        p = subprocess.run(
            [
                sys.executable,
                *(["-O"] if optimized else []),
                "-bb",
                "-X",
                "dev",
                "-W",
                "error",
                "-m",
                "zoora_community.research",
                *map(str, args),
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=150,
        )
        assert p.returncode == expected, (args[0], p.stderr[-400:])
        assert "Traceback" not in p.stderr
        assert not any(s in p.stdout + p.stderr for s in secrets)
        return json.loads(p.stdout) if expected == 0 else p

    with tempfile.TemporaryDirectory(prefix="zoora-identity-bridge-") as name:
        folder = Path(name)
        state, owner_file = folder / "state", folder / "owner.json"
        command("init", "--state", state, "--owner-file", owner_file)
        owner = read_credential(owner_file)
        secrets.append(owner)
        server = Running(state, folder)
        ids, tokens, operators = [], [], []
        try:
            for i in range(5):
                op = server.client.request(
                    "POST", "/v1/operators", {"handle": "bridge_operator_" + str(i)}, owner
                )[1]
                operators.append(op)
                secrets.append(op["credential"]["token"])
            for i, op_index in enumerate([0, 1, 2, 3, 4, 0, 1, 0]):
                label = "PUBLIC-AE019-NEVER-FUND-" + str(i)
                operator = operators[op_index]["credential"]["token"]
                challenge = server.client.request(
                    "POST",
                    "/v1/wallet/challenges",
                    dict(
                        handle="bridge_agent_" + str(i),
                        wallet=address(label),
                        capabilities=["research"],
                    ),
                    operator,
                )[1]
                agent = server.client.request(
                    "POST", "/v1/agents", signed_body(challenge, label), operator
                )[1]
                ids.append(agent["agent"]["id"])
                tokens.append(agent["credential"]["token"])
                secrets.append(tokens[-1])
            select = folder / "selection.json"
            select.write_text(canonical(dict(agents=ids)), encoding="utf-8")
            snapshot_file = output / "research-ownership-snapshot.json"
            exported = cli(
                "export",
                "--port",
                server.port,
                "--credential-file",
                owner_file,
                "--selection-file",
                select,
                "--out",
                snapshot_file,
            )
            snapshot = json.loads(snapshot_file.read_bytes())
            pin = exported["snapshot_fingerprint"]
            verify_snapshot(snapshot, pin)
            check(
                "actual CLI exports eight signed affiliations from the owner-authenticated HTTP service",
                len(snapshot["agents"]) == 8,
            )
            for record in snapshot["agents"]:
                current = server.client.request("GET", "/v1/agents/" + record["agent_id"])[1]
                assert all(current[k] == record[k] for k in ["operator_id", "wallet", "handle"])
                proof = record["affiliation_proof"]
                VerifyKey(decode_base58(record["wallet"], 32, "BAD_TEST_KEY")).verify(
                    proof["message"].encode("utf-8"),
                    base64.b64decode(proof["signature"], validate=True),
                )
            check(
                "all eight raw signatures independently verify and match current server membership records"
            )
            check(
                "server-derived mapping groups the three enrolled aliases together",
                snapshot["operator_indices"][0]
                == snapshot["operator_indices"][5]
                == snapshot["operator_indices"][7],
            )
            for token in [tokens[0], operators[0]["credential"]["token"], None]:
                try:
                    server.client.request(
                        "POST", "/v1/research/ownership-snapshots", {"agents": ids}, token
                    )
                except Problem as error:
                    assert error.status in [401, 403]
                else:
                    raise AssertionError("non-owner exported snapshot")
            check("unauthenticated, operator and agent export attempts are refused")
            audit = Store(state).audit()
            check(
                "real database and historical proof audit passes after export",
                audit["audit_events"] > snapshot["audit_prefix"]["events"],
            )
        finally:
            server.stop()

        reference_campaign = json.loads(
            gzip.decompress((REVIEW / "examples/owner-campaign.json.gz").read_bytes())
        )
        template = next(
            c["runs"][0]["input"]
            for c in reference_campaign["cases"]
            if c["name"] == "DECLARED_WALLET_ROTATION"
        )
        bundles, native_counts = [], []
        for policy, expected_agreements in [
            ("AGENT_ONLY", 3),
            ("OWNER_COUNT", 1),
            ("OWNER_RISK", 1),
        ]:
            source = folder / (policy + "-template.json")
            bound = folder / (policy + "-bound.json")
            value = copy.deepcopy(template)
            value["policy"] = policy
            source.write_text(canonical(value), encoding="utf-8")
            cli(
                "bind",
                "--snapshot-file",
                snapshot_file,
                "--snapshot-fingerprint",
                pin,
                "--input-file",
                source,
                "--out",
                bound,
            )
            binding = json.loads(bound.read_bytes())
            assert binding["actions"] == template["actions"]
            assert (
                binding["config"]["recovery"]["trust"]["operators"] == snapshot["operator_indices"]
            )
            check(
                policy
                + " bind preserves original actions and uses only the exported operator mapping"
            )
            result_file = output / ("research-" + policy.lower() + ".json")
            args = [
                "run",
                "--snapshot-file",
                snapshot_file,
                "--snapshot-fingerprint",
                pin,
                "--input-file",
                bound,
                "--engine",
                engine,
                "--engine-sha256",
                engine_sha,
            ]
            info = cli(*args, "--out", result_file)
            bundle = json.loads(result_file.read_bytes())
            assert bundle["fingerprint"] == info["fingerprint"]
            counts = inspect_run(bundle["run"])
            native_counts.append(counts)
            assert bundle["run"]["metrics"]["agreements_opened"] == expected_agreements
            bundles.append(dict(policy=policy, bundle=bundle))
            check(
                policy
                + " actual Rust run independently audits with the expected shared capacity outcome"
            )
            optimized = folder / (policy + "-optimized.json")
            cli(*args, "--out", optimized, optimized=True)
            check(
                policy + " optimized Python retains all validation and identical bundle bytes",
                optimized.read_bytes() == result_file.read_bytes(),
            )
            replay_args = [
                "replay",
                "--bundle-file",
                result_file,
                "--bundle-fingerprint",
                info["fingerprint"],
                "--snapshot-fingerprint",
                pin,
                "--engine",
                engine,
                "--engine-sha256",
                engine_sha,
            ]
            cli(*replay_args)
            cli(*replay_args, optimized=True)
            check(policy + " bundle replays through the CLI in normal and optimized Python")
        check(
            "all simulated payment transcripts retain false wallet-execution capability flags",
            all(
                not any(
                    b["bundle"]["run"]["recovery"]["trust"]["direct"]["wallet_boundary"].values()
                )
                for b in bundles
            ),
        )
        forbidden = folder / "forbidden.json"
        bad_input = copy.deepcopy(binding)
        bad_input["config"]["recovery"]["trust"]["operators"][5] = 63
        bad_source = folder / "forged-input.json"
        bad_source.write_text(canonical(bad_input), encoding="utf-8")
        common = [
            "--snapshot-file",
            snapshot_file,
            "--snapshot-fingerprint",
            pin,
            "--engine",
            engine,
            "--engine-sha256",
            engine_sha,
        ]
        cli("run", *common, "--input-file", bad_source, "--out", forbidden, expected=1)
        check(
            "client cannot split an enrolled alias into a new owner during a run",
            not forbidden.exists(),
        )
        changed = copy.deepcopy(snapshot)
        changed["agents"][0]["operator_id"] = snapshot["agents"][1]["operator_id"]
        changed["fingerprint"] = fingerprint(changed)
        changed_file = folder / "forged-affiliation.json"
        changed_file.write_text(canonical(changed), encoding="utf-8")
        cli(
            "bind",
            "--snapshot-file",
            changed_file,
            "--snapshot-fingerprint",
            changed["fingerprint"],
            "--input-file",
            source,
            "--out",
            forbidden,
            expected=1,
        )
        check(
            "rehashed operator reassignment still fails the wallet-signed affiliation",
            not forbidden.exists(),
        )
        cli("run", *common, "--input-file", bound, "--out", result_file, expected=1)
        check(
            "existing complete bundle is never overwritten",
            json.loads(result_file.read_bytes()) == bundles[-1]["bundle"],
        )
        for label, flag, wrong in [
            ("snapshot", "--snapshot-fingerprint", "0" * 64),
            ("engine", "--engine-sha256", "0" * 64),
        ]:
            args = ["run", *common, "--input-file", bound, "--out", forbidden]
            args[args.index(flag) + 1] = wrong
            cli(*args, expected=1)
            check(label + " pin mismatch prevents output", not forbidden.exists())
        forged = copy.deepcopy(bundles[-1]["bundle"])
        forged["run"]["metrics"]["payments_recorded"] = "999"
        forged["run"]["fingerprint"] = run_hash(forged["run"])
        forged["fingerprint"] = fingerprint(forged, BUNDLE_DOMAIN)
        bad_bundle = folder / "forged-bundle.json"
        bad_bundle.write_text(canonical(forged), encoding="utf-8")
        cli(
            "replay",
            "--bundle-file",
            bad_bundle,
            "--bundle-fingerprint",
            forged["fingerprint"],
            "--snapshot-fingerprint",
            pin,
            "--engine",
            engine,
            "--engine-sha256",
            engine_sha,
            expected=1,
        )
        try:
            inspect_run(forged["run"])
        except AssertionError:
            pass
        else:
            raise AssertionError("independent audit accepted forged money")
        check("native replay and independent accounting reject rehashed invented payment")
        cli(
            "replay",
            "--bundle-file",
            result_file,
            "--bundle-fingerprint",
            "0" * 64,
            "--snapshot-fingerprint",
            pin,
            "--engine",
            engine,
            "--engine-sha256",
            engine_sha,
            expected=1,
        )
        check("external bundle pin protects report and producer metadata")

        server = Running(state, folder)
        try:
            restart = server.client.request(
                "POST", "/v1/research/ownership-snapshots", {"agents": ids}, owner
            )[1]
            check(
                "fresh service process retains all signed affiliation records",
                restart["agents"] == snapshot["agents"],
            )
            op_id = operators[0]["operator"]["id"]
            server.client.request(
                "POST",
                "/v1/operators/" + op_id + "/suspend",
                {"reason": "Test fixture hold"},
                owner,
            )
            try:
                server.client.request(
                    "POST", "/v1/research/ownership-snapshots", {"agents": ids}, owner
                )
            except Problem as error:
                assert error.code == "ACCESS_SUSPENDED"
            else:
                raise AssertionError("suspended source exported")
            check("suspended participants cannot enter a newly exported research snapshot")
        finally:
            server.stop()
        cli(
            "replay",
            "--bundle-file",
            result_file,
            "--bundle-fingerprint",
            bundles[-1]["bundle"]["fingerprint"],
            "--snapshot-fingerprint",
            pin,
            "--engine",
            engine,
            "--engine-sha256",
            engine_sha,
        )
        check(
            "historical offline replay remains valid after suspension and grants no service authorization"
        )
        Store(state).audit()
        all_bytes = snapshot_file.read_bytes() + b"".join(canonical(b).encode() for b in bundles)
        check(
            "snapshot and all complete bundles exclude every raw API capability",
            not any(s.encode() in all_bytes for s in secrets),
        )

        archive = dict(
            schema_version=1,
            classification="SYNTHETIC_FIXTURES_WITH_ACTUAL_LOCAL_ENROLLMENT",
            model="zoora-identity-bridge-reference/0.1.0",
            snapshot=snapshot,
            bundles=bundles,
        )
        (output / "research-reference.json").write_text(
            json.dumps(archive, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n",
            encoding="utf-8",
        )
        if not bootstrap_reference:
            pins = json.loads((ROOT / "examples/identity-bridge-pins.json").read_bytes())
            raw = (ROOT / "examples/identity-bridge.json.gz").read_bytes()
            assert hashlib.sha256(raw).hexdigest() == pins["archive_sha256"]
            decompressed = gzip.decompress(raw)
            assert hashlib.sha256(decompressed).hexdigest() == pins["decompressed_sha256"]
            retained = json.loads(decompressed)
            policies = ["AGENT_ONLY", "OWNER_COUNT", "OWNER_RISK"]
            assert retained["model"] == "zoora-identity-bridge-reference/0.1.0"
            assert [entry["policy"] for entry in retained["bundles"]] == policies
            assert set(pins["bundle_fingerprints"]) == set(policies)
            assert all(
                entry["bundle"]["run"]["input"]["policy"] == entry["policy"]
                for entry in retained["bundles"]
            )
            verify_snapshot(retained["snapshot"], pins["snapshot_fingerprint"])
            for entry in retained["bundles"]:
                policy, bundle = entry["policy"], entry["bundle"]
                retained_file = folder / ("retained-" + policy + ".json")
                retained_file.write_text(canonical(bundle), encoding="utf-8")
                cli(
                    "replay",
                    "--bundle-file",
                    retained_file,
                    "--bundle-fingerprint",
                    pins["bundle_fingerprints"][policy],
                    "--snapshot-fingerprint",
                    pins["snapshot_fingerprint"],
                    "--engine",
                    engine,
                    "--engine-sha256",
                    engine_sha,
                )
                inspect_run(bundle["run"])
            check(
                "all three retained complete bundles replay under the current separately pinned engine"
            )

    result = dict(
        source_head_sha=os.environ.get("SOURCE_HEAD_SHA")
        or subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        source_tree_dirty=bool(subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT)),
        classification="SYNTHETIC_FIXTURES_WITH_ACTUAL_LOCAL_ENROLLMENT",
        platform=platform.platform(),
        engine_sha256=engine_sha,
        snapshot_fingerprint=pin,
        signed_affiliations=8,
        distinct_operators=5,
        policy_runs=3,
        native_counts=native_counts,
        checks=checks,
        retained_reference_verified=not bootstrap_reference,
        live_work_authorization=False,
        wallet_execution=False,
        human_identity_verified=False,
    )
    (output / "research-evidence.json").write_text(
        json.dumps(result, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", required=True)
    parser.add_argument("--bootstrap-reference", action="store_true")
    args = parser.parse_args()
    run(args.engine, args.bootstrap_reference)
