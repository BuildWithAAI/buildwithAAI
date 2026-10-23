"""Connect a verified experience package to exclusive ownership and crash recovery."""
from __future__ import annotations

import argparse
from contextlib import closing
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.ecosystem_research import controller as c, experience as x  # noqa: E402
from src.ecosystem_research.checkout import worker_environment  # noqa: E402
from src.multi_brain_research import training_lab as lab  # noqa: E402
from src.solana_research import coin_evidence as ev  # noqa: E402
import run_ecosystem_experience as previous  # noqa: E402

FILES = ("upstream.json", "plan.json", "admission-policy.json", "generator-code.json", "checkpoints.json",
         "fault-checks.json", "summary.json", "public-snapshot.json", "controller/journal.sqlite3",
         "controller/journal.sqlite3.lock")
CODE = ("src/ecosystem_research/controller.py", "scripts/ecosystem_controller_worker.py",
        "scripts/run_ecosystem_controller.py")


def derive_plan(parent):
    rules = ev.read(parent / "admission-policy.json")
    state = x.ExperienceJournal(parent / "experience/journal.sqlite3", rules).state()
    batches = []
    for clock, label in ((150000, "BOOTSTRAP"), (250000, "SHARED_TRAINING"),
                         (350000, "POISON_AND_FUTURE_REJECTED"), (450000, "COUNTEREXAMPLES_SUPPRESS_ADVISORIES")):
        batches.append({"id": label, "clock": clock,
                        "requests": [e["request"] for e in state["events"] if e["clock"] == clock]})
    lab.require(sum(len(b["requests"]) for b in batches) == len(state["events"]), "CONTROLLER_SOURCE_CLOCKS")
    repeats = ev.read(parent / "sessions.json")["duplicate_messages_ignored"]
    lab.require(type(repeats) is int and repeats == 100, "CONTROLLER_SOURCE_DUPLICATES")
    batches.insert(2, {"id": "DUPLICATE_DELIVERIES", "clock": 250000,
                       "requests": [batches[1]["requests"][0]] * repeats})
    c.validate_plan(batches)
    return rules, batches, state


def packet(controller, index, expected, *, recover=False):
    return {"database": str(controller.path), "rules": controller.journal.rules, "plan": controller.plan,
            "upstream_sha256": controller.binding["upstream_sha256"], "index": index,
            "expected": expected, "recover": recover}


def worker(action, value):
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "packet.json"
        ev.write(path, value)
        result = subprocess.run([sys.executable, "-I", "-B", str(ROOT / "scripts/ecosystem_controller_worker.py"),
                                 action, str(path)], capture_output=True, timeout=30, check=False,
                                env=worker_environment())
    lab.require(len(result.stdout) + len(result.stderr) <= 1024**2, "CONTROLLER_WORKER_LOG_BOUND")
    code = {"apply": 0, "die-before-commit": 73, "die-after-commit": 74}[action]
    lab.require(result.returncode == code, "CONTROLLER_WORKER_FAILED:" + action + ":"
                + result.stderr[-2000:].decode("utf-8", errors="replace"))
    return ev.parse(result.stdout) if action == "apply" else None


def reject(call, reason):
    try:
        call()
    except ValueError as error:
        lab.require(reason in str(error), "CONTROLLER_UNEXPECTED_REJECTION:" + str(error))
        return
    raise ValueError("CONTROLLER_FAULT_ACCEPTED:" + reason)


def fault_checks(rules, plan, source_sha256):
    """Execute faults in disposable databases; never mutate the sealed package."""
    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder)

        def fresh(label):
            result = c.ControlledJournal(root / (label + ".sqlite3"), rules, plan, source_sha256).initialize()
            return result, result.snapshot()["checkpoint"]

        for action in ("hold", "hold-before-commit"):
            journal, anchor = fresh(action)
            path, ready = root / (action + ".json"), root / (action + "-ready.json")
            ev.write(path, packet(journal, 0, anchor))
            process = subprocess.Popen([sys.executable, "-I", "-B", str(ROOT / "scripts/ecosystem_controller_worker.py"),
                                        action, str(path), str(ready)], env=worker_environment(), stdin=subprocess.PIPE,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                deadline = time.monotonic() + 20
                while not ready.exists() and process.poll() is None and time.monotonic() < deadline:
                    time.sleep(0.01)
                lab.require(ready.exists(), "CONTROLLER_OWNER_NOT_READY")
                reject(lambda j=journal, a=anchor: j.acquire(a), "BUSY")
                reject(lambda j=journal, a=anchor: j.acquire(a, recover=True), "BUSY")
                lab.require(journal.snapshot()["checkpoint"] == anchor, "CONTROLLER_DIRTY_READER")
                _, error = process.communicate(b"release\n", timeout=20)
                lab.require(process.returncode == 0, "CONTROLLER_OWNER_FAILED:" + error[-1000:].decode(errors="replace"))
            finally:
                if process.poll() is None:
                    process.kill()
                process.communicate(timeout=20)
            current = journal.snapshot()
            lab.require(current["owner"] == "", "CONTROLLER_OWNER_NOT_RELEASED")
            lab.require(len(current["commits"]) == int(action == "hold-before-commit"), "CONTROLLER_RELEASE_COMMIT")

        journal, anchor = fresh("before")
        worker("die-before-commit", packet(journal, 0, anchor))
        reject(lambda: journal.acquire(anchor), "RECOVERY_REQUIRED")
        with journal.acquire(anchor, recover=True) as session:
            lab.require(journal.snapshot()["checkpoint"] == anchor, "CONTROLLER_PARTIAL_COMMIT")
            session.apply(0, anchor)
        lab.require(len(journal.snapshot()["state"]["events"]) == len(plan[0]["requests"]), "CONTROLLER_LOST_RECOVERY")

        journal, anchor = fresh("after")
        worker("die-after-commit", packet(journal, 0, anchor))
        latest = journal.snapshot()["checkpoint"]
        reject(lambda: journal.acquire(anchor, recover=True), "EXPECTED_CHECKPOINT")
        reject(lambda: journal.acquire(latest), "RECOVERY_REQUIRED")
        with journal.acquire(latest, recover=True) as session:
            lab.require(session.apply(0, anchor)["duplicate"], "CONTROLLER_RETRY_REAPPLIED")
        lab.require(journal.snapshot()["checkpoint"] == latest, "CONTROLLER_RETRY_ADVANCED")

        journal, anchor = fresh("rollback")
        original = journal.path.read_bytes()
        with journal.acquire(anchor) as session:
            session.apply(0, anchor)
        latest = journal.snapshot()["checkpoint"]
        journal.path.write_bytes(original)
        reject(lambda: journal.acquire(latest), "EXPECTED_CHECKPOINT")

        journal, anchor = fresh("uncontrolled")
        journal.journal.admit_many(plan[0]["requests"], plan[0]["clock"])
        reject(lambda: journal.acquire(anchor), "UNCHECKPOINTED_MEMORY")

        journal, anchor = fresh("rehash")
        with journal.acquire(anchor) as session:
            session.apply(0, anchor)
        with closing(sqlite3.connect(journal.path)) as connection, connection:
            value = ev.parse(connection.execute("SELECT body FROM controller_commits").fetchone()[0].encode())
            value["after"]["events"] += 1
            value["sha256"] = lab.digest({k: v for k, v in value.items() if k != "sha256"})
            connection.execute("UPDATE controller_commits SET body=?", (ev.canonical(value),))
        reject(journal.snapshot, "CHECKPOINT_REPLAY")

        journal, anchor = fresh("fenced")
        session = journal.acquire(anchor)
        try:
            with closing(sqlite3.connect(journal.path)) as connection, connection:
                connection.execute("UPDATE controller_owner SET epoch=epoch+1")
            reject(lambda: session.apply(0, anchor), "FENCED_SESSION")
            reject(session.close, "FENCED_SESSION")
        finally:
            session.lock.close()
        lab.require(journal.snapshot()["checkpoint"] == anchor, "CONTROLLER_FENCED_WRITE")
    return {"protocol": "AAI_CONTROLLER_FAULT_CHECKS_V1", "passed": {
        "live_owner_excludes_competitor_and_recovery": True,
        "reader_sees_only_committed_snapshot_during_write": True,
        "death_before_commit_rolls_back_and_recovers": True,
        "death_after_commit_retries_without_reapplying": True,
        "older_snapshot_rejected_by_retained_anchor": True,
        "uncheckpointed_writer_detected": True,
        "rehashed_false_checkpoint_rejected": True,
        "stale_epoch_fenced": True}, "crash_exit_codes": [73, 74], "precommit_dirty_pages_spilled": True,
        "live_execution_allowed": False}


def derived(parent, source, snapshot, faults):
    audit = x.ExperienceJournal(parent / "experience/journal.sqlite3", ev.read(parent / "admission-policy.json")).audit()
    public, summary = ev.read(parent / "public-snapshot.json"), ev.read(parent / "summary.json")
    summary = {"protocol": "AAI_CONTROLLER_SUMMARY_V1", "controller_batches": len(snapshot["commits"]),
               "cold_process_commits": len(snapshot["commits"]), "ownership_epochs": snapshot["epoch"],
               "fault_probes_passed": len(faults["passed"]), "crash_points_exercised": 2,
               "journal_events": audit["events"], "accepted_training_outcomes": audit["accepted"],
               "quarantined_shares": sum(audit["quarantined"].values()), "duplicate_messages_ignored": 100,
               "blocked_contexts": sum(len(v) for v in audit["blocked_contexts"].values()),
               "upstream_advisory_versions": summary["selected_advisory_versions"], "new_jobs_submitted": 0,
               "real_market_qualification": summary["real_market_qualification"],
               "recorded_observations": summary["recorded_observations"],
               "live_execution_allowed": False}
    observer = {"protocol": "AAI_CONTROLLER_PUBLIC_SNAPSHOT_V1", "mode": "SANDBOX_BEHAVIOR_ADVISORY",
                "experience_public_snapshot_sha256": source["experience_public_snapshot_sha256"],
                "checkpoint_sha256": snapshot["checkpoint"]["sha256"],
                "journal_head_sha256": audit["head_sha256"], "committed_batches": len(snapshot["commits"]),
                "active_models": public["active_models"], "accepted_training_outcomes": audit["accepted"],
                "blocked_context_count": public["blocked_context_count"], "research_signal": "ABSTAIN",
                "real_market_qualification": public["real_market_qualification"], "live_execution_allowed": False}
    return {"generator-code.json": {name: ev.sha((ROOT / name).read_bytes()) for name in CODE},
            "checkpoints.json": {"protocol": "AAI_CONTROLLER_CHECKPOINTS_V1", "commits": snapshot["commits"],
                                 "latest_anchor": snapshot["checkpoint"], "live_execution_allowed": False},
            "fault-checks.json": faults, "summary.json": summary, "public-snapshot.json": observer}


def manifest(directory):
    entries, total = {}, 0
    for name in FILES:
        path = directory / name
        c.safe_path(path)
        lab.require(path.is_file() and path.stat().st_nlink == 1, "CONTROLLER_PACKAGE_FILE")
        size = path.stat().st_size
        lab.require(0 < size <= 8 * 1024**2, "CONTROLLER_PACKAGE_FILE_BOUND")
        total += size
        lab.require(total <= 16 * 1024**2, "CONTROLLER_PACKAGE_BOUND")
        entries[name] = {"sha256": ev.sha(path.read_bytes()), "bytes": size}
        if name.endswith("sqlite3"):
            lab.require(not any(Path(str(path) + suffix).exists() for suffix in ("-wal", "-journal")),
                        "CONTROLLER_PACKAGE_OPEN_TRANSACTION")
    return {"protocol": "AAI_CONTROLLER_PACKAGE_V1", "status": "COMPLETE", "files": entries,
            "live_execution_allowed": False}


def write_manifest(directory):
    temporary = directory / "manifest.pending"
    ev.write(temporary, manifest(directory))
    temporary.replace(directory / "manifest.json")


def verify_package(directory, parent, source):
    lab.require(not (directory / "incomplete.json").exists(), "CONTROLLER_INCOMPLETE")
    initial = manifest(directory)
    lab.require(ev.canonical(ev.read(directory / "manifest.json")) == ev.canonical(initial), "CONTROLLER_MANIFEST_CHANGED")
    lab.require(ev.canonical(ev.read(directory / "upstream.json")) == ev.canonical(source), "CONTROLLER_UPSTREAM_CHANGED")
    rules, plan, state = derive_plan(parent)
    lab.require(ev.canonical(ev.read(directory / "plan.json")) == ev.canonical(plan)
                and ev.canonical(ev.read(directory / "admission-policy.json")) == ev.canonical(rules),
                "CONTROLLER_SOURCE_PLAN_CHANGED")
    journal = c.ControlledJournal(directory / "controller/journal.sqlite3", rules, plan, lab.digest(source))
    snapshot = journal.snapshot()
    lab.require(snapshot["owner"] == "" and snapshot["epoch"] == len(plan)
                and len(snapshot["commits"]) == len(plan) and snapshot["state"] == state, "CONTROLLER_FINAL_STATE")
    faults = fault_checks(rules, plan, lab.digest(source))
    for name, value in derived(parent, source, snapshot, faults).items():
        lab.require(ev.canonical(ev.read(directory / name)) == ev.canonical(value), "CONTROLLER_DERIVED_REPLAY:" + name)
    lab.require(manifest(directory) == initial, "CONTROLLER_VERIFIER_MUTATED_PACKAGE")
    return ev.read(directory / "summary.json")


def build(directory, parent, source):
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    try:
        rules, plan, _ = derive_plan(parent)
        for name, value in (("upstream.json", source), ("plan.json", plan), ("admission-policy.json", rules)):
            ev.write(directory / name, value)
        journal = c.ControlledJournal(directory / "controller/journal.sqlite3", rules, plan, lab.digest(source)).initialize()
        for index in range(len(plan)):
            before = journal.snapshot()["checkpoint"]
            result = worker("apply", packet(journal, index, before))
            lab.require(not result["duplicate"], "CONTROLLER_COLD_PROCESS_DUPLICATE")
        snapshot = journal.snapshot()
        faults = fault_checks(rules, plan, lab.digest(source))
        for name, value in derived(parent, source, snapshot, faults).items():
            ev.write(directory / name, value)
        write_manifest(directory)
        return verify_package(directory, parent, source)
    except (ValueError, OSError, RuntimeError, sqlite3.Error, subprocess.SubprocessError):
        ev.write(directory / "incomplete.json", {"status": "INCOMPLETE", "live_execution_allowed": False})
        raise


def negative_checks(directory, parent, source):
    verify_package(directory, parent, source)
    lab.require(sum(p.stat().st_size for p in directory.rglob("*") if p.is_file()) <= 20 * 1024**2,
                "CONTROLLER_COPY_BOUND")
    rejected = {}
    for fault in ("checkpoint", "rollback", "plan", "public_guard"):
        with tempfile.TemporaryDirectory() as folder:
            copied = Path(folder) / "package"
            shutil.copytree(directory, copied)
            verify_package(copied, parent, source)
            if fault in ("checkpoint", "rollback"):
                with closing(sqlite3.connect(copied / "controller/journal.sqlite3")) as connection, connection:
                    if fault == "checkpoint":
                        value = ev.parse(connection.execute("SELECT body FROM controller_commits WHERE sequence=0").fetchone()[0].encode())
                        value["after"]["events"] += 1
                        value["sha256"] = lab.digest({k: v for k, v in value.items() if k != "sha256"})
                        connection.execute("UPDATE controller_commits SET body=? WHERE sequence=0", (ev.canonical(value),))
                    else:
                        value = ev.parse(connection.execute("SELECT body FROM controller_commits ORDER BY sequence DESC LIMIT 1").fetchone()[0].encode())
                        connection.execute("DELETE FROM events WHERE sequence>=?", (value["before"]["journal"]["events"],))
                        connection.execute("DELETE FROM controller_commits WHERE sequence=?", (value["sequence"],))
            else:
                path = copied / ("plan.json" if fault == "plan" else "public-snapshot.json")
                value = ev.read(path)
                if fault == "plan":
                    value[0]["requests"][0]["case"]["target"] ^= 1
                else:
                    value["blocked_context_count"] = 0
                path.write_text(ev.canonical(value) + "\n", encoding="utf-8")
            write_manifest(copied)
            try:
                verify_package(copied, parent, source)
            except ValueError:
                rejected[fault] = True
            else:
                raise ValueError("CONTROLLER_TAMPER_ACCEPTED:" + fault)
    verify_package(directory, parent, source)
    ev.write(directory / "negative-checks.json", {"protocol": "AAI_CONTROLLER_NEGATIVE_CHECKS_V1", "rejected": rejected,
             "outer_hashes_recomputed": True, "false_checkpoint_hash_recomputed": True, "live_execution_allowed": False})
    return rejected


def upstream(args):
    source = previous.upstream(args)
    parent = args.experience_directory.resolve()
    previous.verify_package(parent, args.community_source.resolve(), args.reef_source.resolve(),
                            args.community_python.absolute(), args.reef_python.absolute(), args.behavior_directory.resolve(), source)
    return {"protocol": "AAI_CONTROLLER_UPSTREAM_V1", "experience_manifest_sha256": ev.sha((parent / "manifest.json").read_bytes()),
            "experience_public_snapshot_sha256": ev.sha((parent / "public-snapshot.json").read_bytes()),
            "live_execution_allowed": False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("run", "verify", "negative-checks"))
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--experience-directory", type=Path, required=True)
    parser.add_argument("--behavior-directory", type=Path, required=True)
    parser.add_argument("--community-source", type=Path, required=True)
    parser.add_argument("--community-python", type=Path, default=Path(sys.executable))
    parser.add_argument("--reef-source", type=Path, required=True)
    parser.add_argument("--reef-python", type=Path, default=Path(sys.executable))
    parser.add_argument("--ecosystem-directory", type=Path)
    parser.add_argument("--learning-directory", type=Path)
    parser.add_argument("--scanner-source", type=Path)
    parser.add_argument("--synthetic-only", action="store_true")
    args = parser.parse_args(argv)
    directory, parent = args.directory.absolute(), args.experience_directory.resolve()
    try:
        source = upstream(args)
        result = build(directory, parent, source) if args.command == "run" else verify_package(directory, parent, source)
        if args.command == "negative-checks":
            negative_checks(directory, parent, source)
        lab.require(upstream(args) == source, "CONTROLLER_UPSTREAM_MUTATED")
        print(ev.canonical({"verified": True, **result}))
        return 0
    except (ValueError, OSError, RuntimeError, sqlite3.Error, subprocess.SubprocessError) as error:
        print(ev.canonical({"status": "CONTROLLER_REJECTED", "error": str(error), "live_execution_allowed": False}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
