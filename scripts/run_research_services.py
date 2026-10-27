"""Connect research service orders to the existing scanner/model/agent economy."""

from __future__ import annotations

import argparse
from contextlib import closing
from pathlib import Path
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.ecosystem_research import network as n, services as s, blueprints as b, blueprint_evidence as be  # noqa: E402
from src.ecosystem_research.checkout import verify_checkout, worker_environment  # noqa: E402
from src.multi_brain_research import training_lab as lab  # noqa: E402
from src.solana_research import coin_evidence as ev  # noqa: E402

sys.path.insert(0, str(ROOT / "scripts"))
import run_scanner_feed as previous  # noqa: E402

FILES = (
    "blueprint-experience.json",
    "blueprint-model-replay.json",
    "blueprint-scanner-replay.json",
    "blueprint-withdrawals.json",
    "blueprint-trials.json",
    "blueprint-audit.json",
    "blueprint-delivery.json",
    "blueprint-receipt.json",
    "upstream.json",
    "bundle.json",
    "catalog.json",
    "exercise.json",
    "connections.json",
    "alpha-delivery.json",
    "beta-delivery.json",
    "community-audit.json",
    "service-audit.json",
    "summary.json",
    "generator-code.json",
    "agents/community.sqlite3",
)
CODE = (
    "src/ecosystem_research/blueprint_evidence.py",
    "scripts/blueprint_exchange_lab.py",
    "src/ecosystem_research/blueprints.py",
    "src/ecosystem_research/blueprint_store.py",
    "scripts/blueprint_exchange_worker.py",
    "src/ecosystem_research/services.py",
    "src/ecosystem_research/service_evidence.py",
    "scripts/research_services_worker.py",
    "scripts/run_research_services.py",
)


def worker(verb, cfg, python, interactive=False):
    verify_checkout(cfg["community_source"], "community")
    with tempfile.TemporaryDirectory() as temporary:
        packet = Path(temporary) / "packet.json"
        ev.write(packet, cfg)
        command = [
            str(python),
            "-I",
            "-B",
            str(ROOT / "scripts/research_services_worker.py"),
            verb,
            str(packet),
        ]
        if interactive:
            process = subprocess.Popen(command, env=worker_environment())
            handler = signal.getsignal(signal.SIGTERM)

            def stop(*_):
                raise KeyboardInterrupt

            signal.signal(signal.SIGTERM, stop)
            stopped = False
            try:
                process.wait()
            except KeyboardInterrupt:
                stopped = True
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=12)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
                signal.signal(signal.SIGTERM, handler)
            lab.require(process.returncode == 0 or stopped, "SERVICE_PROCESS_EXIT")
            result = {
                "status": "STOPPED",
                "financial_settlement": False,
                "live_execution_allowed": False,
            }
        else:
            completed = subprocess.run(
                command,
                capture_output=True,
                timeout=240,
                check=False,
                env=worker_environment(),
            )
            lab.require(
                len(completed.stdout) + len(completed.stderr) <= 1024**2,
                "SERVICE_WORKER_LOG_BOUND",
            )
            try:
                result = ev.parse(completed.stdout)
            except ValueError as error:
                raise ValueError("SERVICE_WORKER_OUTPUT_INVALID") from error
            if completed.returncode:
                raise ValueError(
                    "SERVICE_WORKER_REJECTED:" + str(result.get("error"))[:220]
                )
    verify_checkout(cfg["community_source"], "community")
    return result


def identity():
    return {name: ev.sha((ROOT / name).read_bytes()) for name in CODE}


def manifest(directory):
    entries, total = {}, 0
    for name in FILES:
        path = n.safe_path(directory / name)
        lab.require(
            path.is_file() and path.stat().st_nlink == 1, "SERVICE_PACKAGE_FILE"
        )
        size = path.stat().st_size
        lab.require(0 < size <= 16 * 1024**2, "SERVICE_PACKAGE_FILE_BOUND")
        total += size
        lab.require(total <= 32 * 1024**2, "SERVICE_PACKAGE_BOUND")
        entries[name] = {"sha256": ev.sha(path.read_bytes()), "bytes": size}
        if name.endswith("sqlite3"):
            lab.require(
                not any(
                    Path(str(path) + suffix).exists()
                    for suffix in ("-wal", "-shm", "-journal")
                ),
                "SERVICE_OPEN_TRANSACTION",
            )
    return {
        "protocol": "AAI_RESEARCH_SERVICE_PACKAGE_V1",
        "status": "COMPLETE",
        "files": entries,
        "financial_settlement": False,
        "live_execution_allowed": False,
    }


def seal(directory):
    pending = directory / "manifest.pending"
    ev.write(pending, manifest(directory))
    pending.replace(directory / "manifest.json")


def config(args, directory, source):
    return {
        "output": str(directory),
        "community_source": str(args.community_source.resolve()),
        "bundle_file": str(directory / "bundle.json"),
        "controller_manifest_sha256": source["controller_manifest_sha256"],
        "feed_directory": str(args.feed_directory.resolve() / "tls-feed"),
        "feed_head_sha256": source["feed_head_sha256"],
        "feed_policy_sha256": source["feed_policy_sha256"],
    }


def verify(args, directory, source, bundle):
    lab.require(
        not (directory / "incomplete.json").exists(), "SERVICE_PACKAGE_INCOMPLETE"
    )
    initial = manifest(directory)
    lab.require(
        n.same(initial, ev.read(directory / "manifest.json")),
        "SERVICE_MANIFEST_CHANGED",
    )
    lab.require(
        n.same(ev.read(directory / "upstream.json"), source)
        and n.same(ev.read(directory / "bundle.json"), bundle),
        "SERVICE_UPSTREAM_CHANGED",
    )
    lab.require(
        n.same(ev.read(directory / "generator-code.json"), identity()),
        "SERVICE_GENERATOR_CHANGED",
    )
    result = worker(
        "lab-verify", config(args, directory, source), args.community_python
    )
    expected = {k: v for k, v in result.items() if k != "verified"}
    lab.require(
        n.same(expected, ev.read(directory / "summary.json")), "SERVICE_SUMMARY_REPLAY"
    )
    lab.require(
        n.same(manifest(directory), initial), "SERVICE_VERIFIER_MUTATED_PACKAGE"
    )
    return expected


def build(args, directory, source, bundle):
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    try:
        for name, value in (
            ("upstream.json", source),
            ("bundle.json", bundle),
            ("generator-code.json", identity()),
        ):
            ev.write(directory / name, value)
        result = worker(
            "lab-build", config(args, directory, source), args.community_python
        )
        ev.write(
            directory / "summary.json",
            {k: v for k, v in result.items() if k != "verified"},
        )
        seal(directory)
        return verify(args, directory, source, bundle)
    except (
        ValueError,
        OSError,
        RuntimeError,
        sqlite3.Error,
        subprocess.SubprocessError,
    ):
        ev.write(
            directory / "incomplete.json",
            {
                "status": "INCOMPLETE",
                "financial_settlement": False,
                "live_execution_allowed": False,
            },
        )
        raise


def negative_checks(args, directory, source, bundle):
    verify(args, directory, source, bundle)
    lab.require(
        sum(p.stat().st_size for p in directory.rglob("*") if p.is_file())
        <= 35 * 1024**2,
        "SERVICE_COPY_BOUND",
    )
    rejected = {}
    for fault in (
        "deleted_event",
        "rehashed_allowance",
        "delivery_content",
        "job_binding",
        "financial_authority",
        "connection_identity",
        "preflight_authority",
        "worker_outcome",
        "blueprint_deleted_event",
        "blueprint_rehashed_price",
        "blueprint_payload",
        "blueprint_receipt_authority",
        "blueprint_trial_status",
        "blueprint_trial_link",
        "blueprint_protocol_downgrade",
        "blueprint_withdrawal_receipt",
        "blueprint_withdrawal_prior_state",
        "blueprint_withdrawal_service_binding",
        "blueprint_evidence_success_claim",
        "blueprint_evidence_padded_history",
        "blueprint_replay_source_data",
        "blueprint_replay_report",
        "blueprint_transcript_event_reference",
    ):
        with tempfile.TemporaryDirectory() as temporary:
            copied = Path(temporary) / "package"
            shutil.copytree(directory, copied)
            verify(args, copied, source, bundle)
            if fault in ("blueprint_evidence_success_claim", "blueprint_evidence_padded_history",
                         "blueprint_replay_source_data", "blueprint_replay_report", "blueprint_transcript_event_reference"):
                filename = "blueprint-model-replay.json"
                value = ev.read(copied / filename)
                if fault == "blueprint_evidence_success_claim":
                    value["evidence"]["qualification"]["success_verified"] = True
                elif fault == "blueprint_evidence_padded_history":
                    value["evidence"]["track_record"]["states"]["ACCEPTED"] += 1
                    value["evidence"]["track_record"]["states"]["FAILED"] -= 1
                elif fault == "blueprint_replay_source_data":
                    value["input_data"]["records"][0]["captured_ms"] += 1
                elif fault == "blueprint_transcript_event_reference":
                    value["transcript"]["entries"][0]["event_sha256"] = "f" * 64
                    value["transcript"]["sha256"] = lab.digest({k: v for k, v in value["transcript"].items() if k != "sha256"})
                else:
                    value["report"]["research_signal"] = "BUY"
                value["evidence"]["sha256"] = lab.digest({k: v for k, v in value["evidence"].items() if k != "sha256"})
                (copied / filename).write_bytes(n.raw(value))
                experience = ev.read(copied / "blueprint-experience.json")
                experience["replays"][0]["receipt"]["snapshot_sha256"] = ev.sha(n.raw(value))
                if fault == "blueprint_transcript_event_reference":
                    experience["replays"][0]["receipt"]["transcript_sha256"] = value["transcript"]["sha256"]
                (copied / "blueprint-experience.json").write_bytes(n.raw(experience))
            elif fault == "blueprint_withdrawal_receipt":
                value = ev.read(copied / "blueprint-withdrawals.json")
                value["withdrawals"][0]["receipt"]["financial_settlement"] = True
                (copied / "blueprint-withdrawals.json").write_bytes(n.raw(value))
            elif fault in ("blueprint_withdrawal_prior_state", "blueprint_withdrawal_service_binding"):
                with closing(sqlite3.connect(copied / "agents/community.sqlite3")) as db, db:
                    head, changed = None, False
                    for sequence, raw in db.execute("SELECT sequence,body FROM blueprint_events ORDER BY sequence").fetchall():
                        event = ev.parse(raw.encode())
                        if not changed and event["command"]["kind"] == "WITHDRAW":
                            if fault == "blueprint_withdrawal_prior_state":
                                event["facts"]["prior_order"]["work_units"] += 1
                            else:
                                event["command"]["resolution"] = "RELEASE_FAILED"
                            changed = True
                        if head is not None:
                            event["previous_sha256"] = head
                        event["sha256"] = lab.digest({k: v for k, v in event.items() if k != "sha256"})
                        db.execute("UPDATE blueprint_events SET body=? WHERE sequence=?", (ev.canonical(event), sequence))
                        head = event["sha256"]
                    lab.require(changed, "BLUEPRINT_WITHDRAWAL_MUTATION_MISSING")
            elif fault in ("blueprint_trial_status", "blueprint_trial_link"):
                name = "blueprint-trials.json" if fault == "blueprint_trial_status" else "blueprint-delivery.json"
                value = ev.read(copied / name)
                if fault == "blueprint_trial_status":
                    value["statuses"][0]["authorization_granted"] = True
                else:
                    value["license"]["trial_orders"] = value["license"]["trial_orders"][-1:]
                (copied / name).write_bytes(n.raw(value))
            elif fault in ("blueprint_deleted_event", "blueprint_rehashed_price", "blueprint_protocol_downgrade"):
                with closing(sqlite3.connect(copied / "agents/community.sqlite3")) as db, db:
                    if fault == "blueprint_protocol_downgrade":
                        value = ev.parse(db.execute("SELECT value FROM blueprint_configuration").fetchone()[0].encode())
                        value["protocol"] = "AAI_BLUEPRINT_EXCHANGE_V1"
                        db.execute("UPDATE blueprint_configuration SET value=?", (ev.canonical(value),))
                    elif fault == "blueprint_deleted_event":
                        db.execute("DELETE FROM blueprint_events WHERE sequence=(SELECT MAX(sequence) FROM blueprint_events)")
                    else:
                        catalog = ev.read(copied / "catalog.json")
                        state = b.empty()
                        head = lab.digest(ev.parse(db.execute("SELECT value FROM blueprint_configuration").fetchone()[0].encode()))
                        for sequence, raw in db.execute("SELECT sequence,body FROM blueprint_events ORDER BY sequence").fetchall():
                            event = ev.parse(raw.encode())
                            if event["command"]["kind"] == "PUBLISH" and event["command"]["price_usd_cents"]:
                                event["command"]["price_usd_cents"] = 0
                            state, event["result"] = b.apply(state, event["actor"], event["command"], event["at_ms"], event["facts"], catalog)
                            event["previous_sha256"], event["state_sha256"] = head, lab.digest(state)
                            event["sha256"] = lab.digest({k: v for k, v in event.items() if k != "sha256"})
                            db.execute("UPDATE blueprint_events SET body=? WHERE sequence=?", (ev.canonical(event), sequence))
                            head = event["sha256"]
            elif fault in ("blueprint_payload", "blueprint_receipt_authority"):
                name = "blueprint-delivery.json" if fault == "blueprint_payload" else "blueprint-receipt.json"
                value = ev.read(copied / name)
                if fault == "blueprint_payload":
                    value["package"]["instructions"] = "Altered licensed content"
                else:
                    value["profit_verified"] = True
                (copied / name).write_bytes(n.raw(value))
            elif fault in ("deleted_event", "rehashed_allowance", "job_binding"):
                with (
                    closing(sqlite3.connect(copied / "agents/community.sqlite3")) as db,
                    db,
                ):
                    if fault == "deleted_event":
                        db.execute(
                            "DELETE FROM service_events WHERE sequence=(SELECT MAX(sequence) FROM service_events)"
                        )
                    elif fault == "job_binding":
                        db.execute(
                            "UPDATE jobs SET report_bytes=report_bytes+1 WHERE state='SUCCEEDED' AND title LIKE 'Research service %'"
                        )
                    else:
                        catalog = ev.read(copied / "catalog.json")
                        state, head = s.empty(), lab.digest(catalog)
                        for sequence, raw in db.execute(
                            "SELECT sequence,body FROM service_events ORDER BY sequence"
                        ).fetchall():
                            event = ev.parse(raw.encode())
                            if sequence == 0:
                                event["command"]["limit"] += 1
                            state, event["result"] = s.apply(
                                state,
                                event["actor"],
                                event["command"],
                                event["at_ms"],
                                event["facts"],
                                catalog,
                            )
                            event["previous_sha256"], event["state_sha256"] = (
                                head,
                                lab.digest(state),
                            )
                            event["sha256"] = lab.digest(
                                {k: v for k, v in event.items() if k != "sha256"}
                            )
                            db.execute(
                                "UPDATE service_events SET body=? WHERE sequence=?",
                                (ev.canonical(event), sequence),
                            )
                            head = event["sha256"]
            elif fault in ("connection_identity", "preflight_authority", "worker_outcome"):
                value = ev.read(copied / "connections.json")
                if fault == "connection_identity":
                    value["preflights"][0]["connection_binding"]["expected_instance_id"] = "f" * 32
                elif fault == "preflight_authority":
                    value["preflights"][0]["server_readiness"]["authorization_granted"] = True
                else:
                    value["work_cycles"][0]["outcomes"][0]["result"]["result"]["state"] = "ACCEPTED"
                (copied / "connections.json").write_bytes(n.raw(value))
            else:
                name = (
                    "alpha-delivery.json"
                    if fault == "delivery_content"
                    else "exercise.json"
                )
                value = ev.read(copied / name)
                value["financial_settlement"] = True
                (copied / name).write_bytes(n.raw(value))
            seal(copied)
            try:
                verify(args, copied, source, bundle)
            except ValueError:
                rejected[fault] = True
            else:
                raise ValueError("SERVICE_MUTATION_ACCEPTED:" + fault)
    verify(args, directory, source, bundle)
    ev.write(
        directory / "negative-checks.json",
        {
            "protocol": "AAI_RESEARCH_SERVICE_NEGATIVE_CHECKS_V1",
            "rejected": rejected,
            "outer_hashes_recomputed": True,
            "service_chain_recomputed": True,
            "financial_settlement": False,
            "live_execution_allowed": False,
        },
    )
    return rejected


def upstream(args):
    if args.command == "transport-self-test":
        bundle = n.read_bundle(args.bundle_file, args.trusted_controller_sha256)
        feed_source = {
            "protocol": "AAI_SCANNER_FEED_UPSTREAM_V1",
            "network_manifest_sha256": None,
            "controller_manifest_sha256": args.trusted_controller_sha256,
            "verification": "PINNED_DISTRIBUTION_FILES_ONLY",
            "mode": "SYNTHETIC_TRANSPORT_TEST",
            "live_execution_allowed": False,
        }
    else:
        feed_source, bundle = previous.upstream(args)
    parent = args.feed_directory.resolve()
    previous.verify_package(args, parent, feed_source, bundle)
    delivery, policy = (
        ev.read(parent / "delivery.json"),
        ev.read(parent / "tls-feed/policy.json"),
    )
    return {
        "protocol": "AAI_RESEARCH_SERVICES_UPSTREAM_V1",
        "feed_manifest_sha256": ev.sha((parent / "manifest.json").read_bytes()),
        "controller_manifest_sha256": feed_source["controller_manifest_sha256"],
        "feed_head_sha256": delivery["tls"]["head_sha256"],
        "feed_policy_sha256": lab.digest(policy),
        "source_mode": feed_source["mode"],
        "scope": "HISTORICAL_RESEARCH_SERVICES",
        "verification": "VERIFIED_SCANNER_FEED_AND_ITS_DECLARED_ANCESTRY",
        "financial_settlement": False,
        "live_execution_allowed": False,
    }, bundle


def resources_arguments(p, *, local_bundle):
    p.add_argument(
        "--feed-directory",
        type=Path,
        required=local_bundle,
        help="Single pinned journal directory; agents default to authenticated remote transfer when omitted",
    )
    p.add_argument("--feed-head-sha256", required=True)
    p.add_argument("--feed-policy-sha256", required=True)
    p.add_argument("--trusted-controller-sha256", required=True)
    if local_bundle:
        p.add_argument("--bundle-file", type=Path, required=True)
    else:
        p.add_argument("--bundle-sha256", required=True)


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    commands = result.add_subparsers(dest="command", required=True)
    offline = commands.add_parser("blueprint-replay", help="Reproduce an externally pinned evidence snapshot offline")
    offline.add_argument("--input", type=Path, required=True)
    offline.add_argument("--sha256", required=True)
    offline.add_argument("--trusted-controller-sha256", required=True)
    for name in ("run", "verify", "negative-checks", "transport-self-test"):
        p = commands.add_parser(name)
        p.add_argument("--directory", type=Path, required=True)
        p.add_argument("--feed-directory", type=Path, required=True)
        p.add_argument("--community-source", type=Path, required=True)
        p.add_argument("--community-python", type=Path, default=Path(sys.executable))
        p.add_argument("--scanner-source", type=Path, required=True)
        if name == "transport-self-test":
            p.add_argument("--bundle-file", type=Path, required=True)
            p.add_argument("--trusted-controller-sha256", required=True)
        else:
            for component in ("network", "controller", "experience", "behavior"):
                p.add_argument(
                    "--" + component + "-directory", type=Path, required=True
                )
            p.add_argument("--reef-source", type=Path, required=True)
            p.add_argument("--reef-python", type=Path, default=Path(sys.executable))
            p.add_argument("--ecosystem-directory", type=Path)
            p.add_argument("--learning-directory", type=Path)
            p.add_argument(
                "--synthetic-only",
                action="store_true",
                help="Parent behavior corpus only; source classifications are preserved",
            )
    for name in ("serve", "act", "observe", "fulfill", "accept", "preflight", "work-once",
                 "blueprint-act", "blueprint-observe", "blueprint-candidates", "blueprint-evidence", "blueprint-transcript", "blueprint-reproduce",
                 "blueprint-terms", "blueprint-fetch", "blueprint-trial", "blueprint-accept", "blueprint-status", "blueprint-withdraw"):
        p = commands.add_parser(name)
        p.add_argument("--community-source", type=Path, required=True)
        p.add_argument("--community-python", type=Path, default=Path(sys.executable))
        p.add_argument("--port", type=int, default=8765)
        if name == "serve":
            resources_arguments(p, local_bundle=True)
            p.add_argument("--state", type=Path, required=True)
            p.add_argument("--initialize-owner-file", type=Path)
            p.add_argument("--public-origin")
        else:
            p.add_argument("--origin")
            p.add_argument("--ca-file", type=Path)
            p.add_argument("--credential", type=Path, required=True)
            p.add_argument("--expected-instance", required=True)
            p.add_argument("--expected-principal", required=True)
            p.add_argument(
                "--expected-role",
                choices=("AGENT", "OPERATOR", "OWNER"),
                default="AGENT",
            )
            p.add_argument("--catalog-sha256", required=True)
            if name in ("act", "blueprint-act"):
                p.add_argument("--action-file", type=Path, required=True)
            if name in ("accept", "fulfill", "preflight", "work-once", "blueprint-accept", "blueprint-reproduce"):
                resources_arguments(p, local_bundle=False)
            if name in ("accept", "fulfill", "preflight"):
                p.add_argument("--order-id", required=True)
            if name == "fulfill":
                p.add_argument("--output", type=Path)
            if name == "preflight":
                p.add_argument("--for-action", choices=("fulfill", "accept"), required=True)
            if name == "work-once":
                p.add_argument("--work-mode", choices=("provide", "accept", "both"), default="both")
                p.add_argument("--max-orders", type=int, choices=range(1, 5), default=1)
            if name == "blueprint-terms":
                p.add_argument("--listing-id", required=True)
            if name == "blueprint-status":
                p.add_argument("--license-id", required=True)
            if name in ("blueprint-fetch", "blueprint-trial", "blueprint-accept", "blueprint-withdraw", "blueprint-evidence", "blueprint-transcript", "blueprint-reproduce"):
                p.add_argument("--license-id", required=True)
                p.add_argument("--package-sha256", required=True)
                p.add_argument("--terms-sha256", required=True)
            if name in ("blueprint-fetch", "blueprint-evidence", "blueprint-transcript"):
                p.add_argument("--output", type=Path)
            if name == "blueprint-reproduce":
                p.add_argument("--output", type=Path, required=True)
            if name == "blueprint-trial":
                p.add_argument("--attempt", type=int, choices=range(1, 4), default=1)
                p.add_argument("--mandate-id", required=True)
                p.add_argument("--start-before-ms", type=int, required=True)
            if name in ("blueprint-accept", "blueprint-withdraw", "blueprint-reproduce"):
                p.add_argument("--trial-order-id", required=True)
            if name == "blueprint-withdraw":
                p.add_argument("--resolution", required=True, choices=tuple(b.RESOLUTIONS))
                p.add_argument("--delivery-sha256")
    return result


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        if args.command == "blueprint-replay":
            result = be.replay_file(args.input, args.sha256, args.trusted_controller_sha256)
        elif args.command in ("serve", "act", "observe", "fulfill", "accept", "preflight", "work-once") or args.command.startswith("blueprint-"):
            cfg = {
                key: str(value.absolute()) if isinstance(value, Path) else value
                for key, value in vars(args).items()
                if value is not None
                and key
                not in (
                    "command",
                    "community_python",
                    "initialize_owner_file",
                    "trusted_controller_sha256",
                )
            }
            if hasattr(args, "trusted_controller_sha256"):
                cfg["controller_manifest_sha256"] = lab.pin(
                    args.trusted_controller_sha256
                )
            if args.command == "serve" and args.initialize_owner_file:
                cfg.update(
                    initialize=True,
                    owner_file=str(n.safe_path(args.initialize_owner_file)),
                )
            result = worker(
                args.command,
                cfg,
                args.community_python,
                interactive=args.command == "serve",
            )
        else:
            source, bundle = upstream(args)
            directory = n.safe_path(args.directory)
            result = (
                build(args, directory, source, bundle)
                if args.command in ("run", "transport-self-test")
                else verify(args, directory, source, bundle)
            )
            if args.command in ("negative-checks", "transport-self-test"):
                result = {
                    **result,
                    "negative_checks": negative_checks(args, directory, source, bundle),
                }
            later, later_bundle = upstream(args)
            lab.require(
                n.same(source, later) and n.same(bundle, later_bundle),
                "SERVICE_PARENT_MUTATED",
            )
        print(ev.canonical({"verified": True, **result}))
        if args.command in ("preflight", "work-once") and result["status"] == "BLOCKED":
            return 3
        if args.command == "work-once" and result["status"] == "STOPPED_FOR_REVIEW":
            return 4
        return 0
    except KeyboardInterrupt:
        return 130
    except (
        ValueError,
        OSError,
        RuntimeError,
        sqlite3.Error,
        subprocess.SubprocessError,
    ) as error:
        code = str(error) if isinstance(error, ValueError) else type(error).__name__
        print(
            ev.canonical(
                {
                    "status": "SERVICE_REJECTED",
                    "error": code[:280],
                    "financial_settlement": False,
                    "live_execution_allowed": False,
                }
            )
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
