"""Connect independently verified ecosystem jobs to pinned Reef report-review learning."""
from __future__ import annotations

import argparse
from contextlib import closing
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.ecosystem_research import learning, reef_adapter  # noqa: E402
from src.ecosystem_research.checkout import worker_environment  # noqa: E402
from src.multi_brain_research import training_lab as lab  # noqa: E402
from src.solana_research import coin_evidence as ev  # noqa: E402
import run_ecosystem_research as ecosystem  # noqa: E402

FILES = ("input.json", "curricula.json", "proposals.json", "evaluation.json", "releases.json",
         "reviews.json", "reef-records.json", "component.json", "evaluator-code.json", "summary.json",
         "public-snapshot.json", "state/reef.sqlite3")


def worker(phase, directory, reef, python, *, quiet=False):
    reef_adapter.verify_reef(reef)
    environment = {**worker_environment(), "HF_HUB_OFFLINE": "1", "DO_NOT_TRACK": "1",
                   "LITELLM_LOCAL_MODEL_COST_MAP": "True"}
    result = subprocess.run([str(python), "-I", "-B", str(ROOT / "scripts/ecosystem_learning_worker.py"),
                             phase, str(directory), str(reef)], cwd=directory, env=environment,
                            capture_output=True, timeout=180, check=False)
    lab.require(len(result.stdout) + len(result.stderr) <= 1024**2, "LEARNING_WORKER_LOG_BOUND")
    if phase == "build":
        (directory / "build.log").write_bytes(result.stdout + result.stderr)
    if result.returncode:
        if not quiet:
            print((result.stdout + result.stderr)[-5000:].decode("utf-8", errors="replace"), file=sys.stderr)
        raise ValueError("LEARNING_WORKER_REJECTED")
    reef_adapter.verify_reef(reef)


def manifest(directory):
    entries, total = {}, 0
    for name in FILES:
        path = directory / name
        lab.require(path.is_file() and not path.is_symlink(), "LEARNING_PACKAGE_FILE")
        size = path.stat().st_size
        lab.require(0 < size <= 8 * 1024**2, "LEARNING_PACKAGE_FILE_BOUND")
        total += size
        lab.require(total <= 32 * 1024**2, "LEARNING_PACKAGE_BOUND")
        entries[name] = {"sha256": ev.sha(path.read_bytes()), "bytes": size}
    return {"protocol": "AAI_LEARNING_PACKAGE_V1", "status": "COMPLETE", "files": entries,
            "input_sha256": lab.digest(ev.read(directory / "input.json")), "live_execution_allowed": False}


def write_manifest(directory):
    # The final replace is the completion marker; a partial build has no complete package.
    temporary = directory / "manifest.pending"
    ev.write(temporary, manifest(directory))
    temporary.replace(directory / "manifest.json")


def verify_package(directory, reef, python, expected_source=None, *, quiet=False):
    lab.require(not (directory / "incomplete.json").exists(), "LEARNING_INCOMPLETE")
    expected = manifest(directory)
    lab.require(ev.read(directory / "manifest.json") == expected, "LEARNING_MANIFEST_CHANGED")
    if expected_source is not None:
        lab.require(ev.read(directory / "input.json") == expected_source, "LEARNING_SOURCE_CHANGED")
    worker("verify", directory, reef, python, quiet=quiet)
    lab.require(manifest(directory) == expected, "LEARNING_VERIFIER_MUTATED_PACKAGE")
    return ev.read(directory / "summary.json")


def build(source, directory, reef, python):
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    try:
        ev.write(directory / "input.json", source)
        worker("build", directory, reef, python)
        write_manifest(directory)
        return verify_package(directory, reef, python, source)
    except (ValueError, OSError, RuntimeError, subprocess.SubprocessError):
        ev.write(directory / "incomplete.json", {"status": "INCOMPLETE", "live_execution_allowed": False})
        raise


def negative_checks(directory, reef, python, source):
    verify_package(directory, reef, python, source)
    rejected = {}
    for fault in ("policy", "feedback_database", "public_projection"):
        with tempfile.TemporaryDirectory() as temporary:
            copy = Path(temporary) / "package"
            shutil.copytree(directory, copy)
            verify_package(copy, reef, python, source)
            if fault == "policy":
                value = ev.read(copy / "proposals.json")
                value[learning.ROLES[0]]["live_execution_allowed"] = True
                (copy / "proposals.json").write_text(ev.canonical(value) + "\n", encoding="utf-8")
            elif fault == "feedback_database":
                with closing(sqlite3.connect(copy / "state/reef.sqlite3")) as connection:
                    rows = connection.execute("SELECT agent_record_id, payload_json FROM agent_record").fetchall()
                    import json
                    record, raw = next((key, raw) for key, raw in rows if json.loads(raw).get("score") == 1.0)
                    payload = json.loads(raw)
                    payload["score"] = 0.0
                    connection.execute("UPDATE agent_record SET payload_json=? WHERE agent_record_id=?",
                                       (ev.canonical(payload), record))
                    connection.commit()
            else:
                value = ev.read(copy / "public-snapshot.json")
                value["live_execution_allowed"] = True
                (copy / "public-snapshot.json").write_text(ev.canonical(value) + "\n", encoding="utf-8")
            # Also update the outer hashes: semantic replay must reject the changed package.
            write_manifest(copy)
            try:
                verify_package(copy, reef, python, source, quiet=True)
            except ValueError:
                rejected[fault] = True
            else:
                raise ValueError("LEARNING_TAMPER_ACCEPTED")
    verify_package(directory, reef, python, source)
    ev.write(directory / "negative-checks.json", {"protocol": "AAI_LEARNING_NEGATIVE_CHECKS_V1",
             "rejected": rejected, "outer_hashes_recomputed": True, "live_execution_allowed": False})
    return rejected


def fixture_source():
    reports = learning.fixtures()
    jobs = {role: {"job_id": "fixture-job-" + role, "artifact_id": "fixture-artifact-" + role,
                  "report_sha256": ev.sha((ev.canonical(report) + "\n").encode()),
                  "report_bytes": len((ev.canonical(report) + "\n").encode()), "state": "SUCCEEDED"}
            for role, report in reports.items()}
    return {"protocol": "AAI_LEARNING_VERIFIED_INPUT_V1", "classification": "SYNTHETIC_ADAPTER_FIXTURE",
            "reports": reports, "jobs": jobs, "audit_head": "0" * 64,
            "verification": "SYNTHETIC_ADAPTER_FIXTURE_NOT_COMMUNITY_AUDIT",
            "quality_target": "INTERNAL_REPORT_CONSISTENCY_ONLY", "live_execution_allowed": False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("run", "verify", "negative-checks", "self-test"))
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--ecosystem-directory", type=Path)
    parser.add_argument("--scanner-source", type=Path)
    parser.add_argument("--community-source", type=Path)
    parser.add_argument("--reef-source", type=Path, required=True)
    parser.add_argument("--reef-python", type=Path, default=Path(sys.executable))
    args = parser.parse_args(argv)
    directory, reef = args.directory.absolute(), args.reef_source.resolve()
    python = args.reef_python.absolute()
    try:
        if args.command == "self-test":
            source = fixture_source()
        else:
            lab.require(args.ecosystem_directory is not None and args.scanner_source is not None
                        and args.community_source is not None, "LEARNING_VERIFIED_ECOSYSTEM_REQUIRED")
            ecosystem.verify(args.ecosystem_directory, args.scanner_source, args.community_source)
            source = learning.source_snapshot(args.ecosystem_directory)
        if args.command in ("run", "self-test"):
            result = build(source, directory, reef, python)
        else:
            result = verify_package(directory, reef, python, source)
        if args.command in ("negative-checks", "self-test"):
            negative_checks(directory, reef, python, source)
        if args.command != "self-test":
            ecosystem.verify(args.ecosystem_directory, args.scanner_source, args.community_source)
            lab.require(learning.source_snapshot(args.ecosystem_directory) == source, "LEARNING_SOURCE_MUTATED")
        print(ev.canonical({"verified": True, **result}))
        return 0
    except (ValueError, OSError, RuntimeError, subprocess.SubprocessError) as error:
        print(ev.canonical({"status": "LEARNING_REJECTED", "error": str(error), "live_execution_allowed": False}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
