"""Run bounded behavior learning with pinned community and Reef workers; no orders or payments."""
from __future__ import annotations

import argparse
from contextlib import closing
import json
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.ecosystem_research import behavior, learning, reef_adapter  # noqa: E402
from src.ecosystem_research.checkout import verify_checkout, worker_environment  # noqa: E402
from src.multi_brain_research import training_lab as lab  # noqa: E402
from src.solana_research import coin_evidence as ev  # noqa: E402
import run_ecosystem_learning as review_learning  # noqa: E402
import run_ecosystem_research as ecosystem  # noqa: E402

FILES = ("upstream.json", "tasks.json", "replays.json", "recorded-feedback.json", "code-review.json",
         "generator-code.json", "paper_learner.json", "contract_learner.json", "code_learner.json",
         "opsec_learner.json", "jobs.json", "selection.json", "behavior-records.json", "summary.json",
         "public-snapshot.json", "reef-component.json", "agents/community.sqlite3", "reef/records.sqlite3")


def worker(phase, directory, community, reef, community_python, reef_python, connected, *, quiet=False):
    verify_checkout(community, "community")
    reef_adapter.verify_reef(reef)
    environment = {**worker_environment(), "HF_HUB_OFFLINE": "1", "DO_NOT_TRACK": "1",
                   "LITELLM_LOCAL_MODEL_COST_MAP": "True"}
    python = community_python if phase.startswith("data-") else reef_python
    result = subprocess.run([str(python), "-I", "-B", str(ROOT / "scripts/ecosystem_behavior_worker.py"),
                             phase, str(directory), str(community), str(reef), str(connected) if connected else "-"],
                            cwd=directory, env=environment, capture_output=True, timeout=240, check=False)
    lab.require(len(result.stdout) + len(result.stderr) <= 1024**2, "BEHAVIOR_WORKER_LOG_BOUND")
    if phase.endswith("-build"):
        (directory / (phase + ".log")).write_bytes(result.stdout + result.stderr)
    if result.returncode:
        if not quiet:
            print((result.stdout + result.stderr)[-6000:].decode("utf-8", errors="replace"), file=sys.stderr)
        raise ValueError("BEHAVIOR_WORKER_REJECTED:" + phase)
    verify_checkout(community, "community")
    reef_adapter.verify_reef(reef)


def manifest(directory):
    lab.require(not (directory / "owner.credential").exists(), "BEHAVIOR_CREDENTIAL_RETAINED")
    entries, total = {}, 0
    for name in FILES:
        path = directory / name
        lab.require(path.is_file() and not path.is_symlink() and not path.parent.is_symlink(), "BEHAVIOR_PACKAGE_FILE")
        size = path.stat().st_size
        lab.require(0 < size <= 8 * 1024**2, "BEHAVIOR_PACKAGE_FILE_BOUND")
        total += size
        lab.require(total <= 32 * 1024**2, "BEHAVIOR_PACKAGE_BOUND")
        entries[name] = {"sha256": ev.sha(path.read_bytes()), "bytes": size}
        if name.endswith("sqlite3"):
            lab.require(not Path(str(path) + "-wal").exists(), "BEHAVIOR_PACKAGE_OPEN_WAL")
    return {"protocol": "AAI_BEHAVIOR_PACKAGE_V1", "status": "COMPLETE", "files": entries,
            "upstream_sha256": lab.digest(ev.read(directory / "upstream.json")), "live_execution_allowed": False}


def write_manifest(directory):
    temporary = directory / "manifest.pending"
    ev.write(temporary, manifest(directory))
    temporary.replace(directory / "manifest.json")


def verify_package(directory, community, reef, community_python, reef_python, source, connected, *, quiet=False):
    lab.require(not (directory / "incomplete.json").exists(), "BEHAVIOR_INCOMPLETE")
    expected = manifest(directory)
    lab.require(ev.read(directory / "manifest.json") == expected, "BEHAVIOR_MANIFEST_CHANGED")
    lab.require(ev.read(directory / "upstream.json") == source, "BEHAVIOR_UPSTREAM_CHANGED")
    for phase in ("data-verify", "reef-verify"):
        worker(phase, directory, community, reef, community_python, reef_python, connected, quiet=quiet)
    lab.require(manifest(directory) == expected, "BEHAVIOR_VERIFIER_MUTATED_PACKAGE")
    return ev.read(directory / "summary.json")


def build(directory, community, reef, community_python, reef_python, source, connected):
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    try:
        ev.write(directory / "upstream.json", source)
        for phase in ("data-build", "data-verify", "reef-build"):
            worker(phase, directory, community, reef, community_python, reef_python, connected)
        write_manifest(directory)
        return verify_package(directory, community, reef, community_python, reef_python, source, connected)
    except (ValueError, OSError, RuntimeError, subprocess.SubprocessError):
        ev.write(directory / "incomplete.json", {"status": "INCOMPLETE", "live_execution_allowed": False})
        raise


def negative_checks(directory, community, reef, community_python, reef_python, source, connected):
    arguments = (community, reef, community_python, reef_python, source, connected)
    verify_package(directory, *arguments)
    rejected = {}
    for fault in ("future_outcome", "learned_policy", "feedback_database", "consumption_receipt", "public_projection"):
        with tempfile.TemporaryDirectory() as temporary:
            copied = Path(temporary) / "package"
            shutil.copytree(directory, copied)
            verify_package(copied, *arguments)
            if fault == "future_outcome":
                path = copied / "tasks.json"
                value = ev.read(path)
                value["cases"][behavior.DOMAINS[0]][0]["resolved_at"] = 10**9
                path.write_text(ev.canonical(value) + "\n", encoding="utf-8")
            elif fault == "learned_policy":
                path = copied / "paper_learner.json"
                value = ev.read(path)
                context = next(iter(value["model"]["contexts"].values()))
                context["zero"], context["one"] = context["one"], context["zero"]
                path.write_text(ev.canonical(value) + "\n", encoding="utf-8")
            elif fault == "feedback_database":
                with closing(sqlite3.connect(copied / "reef/records.sqlite3")) as connection:
                    rows = connection.execute("SELECT agent_record_id, payload_json FROM agent_record").fetchall()
                    record, raw = next((key, raw) for key, raw in rows if json.loads(raw).get("score") == 1.0)
                    payload = json.loads(raw)
                    payload["score"] = 0.0
                    connection.execute("UPDATE agent_record SET payload_json=? WHERE agent_record_id=?",
                                       (ev.canonical(payload), record))
                    connection.commit()
            elif fault == "consumption_receipt":
                with closing(sqlite3.connect(copied / "reef/records.sqlite3")) as connection:
                    connection.execute("UPDATE record_consumption SET metadata_json=?", ('{}',))
                    connection.commit()
            else:
                path = copied / "public-snapshot.json"
                value = ev.read(path)
                value["live_execution_allowed"] = True
                path.write_text(ev.canonical(value) + "\n", encoding="utf-8")
            # Hashes alone are insufficient: rehash the altered package and require semantic replay to fail.
            write_manifest(copied)
            try:
                verify_package(copied, *arguments, quiet=True)
            except ValueError:
                rejected[fault] = True
            else:
                raise ValueError("BEHAVIOR_TAMPER_ACCEPTED:" + fault)
    verify_package(directory, *arguments)
    ev.write(directory / "negative-checks.json", {"protocol": "AAI_BEHAVIOR_NEGATIVE_CHECKS_V1",
             "rejected": rejected, "outer_hashes_recomputed": True, "live_execution_allowed": False})
    return rejected


def upstream(args):
    if args.command == "self-test" or args.synthetic_only:
        lab.require(args.ecosystem_directory is None and args.learning_directory is None
                    and args.scanner_source is None, "BEHAVIOR_FIXTURE_SOURCE_CONFLICT")
        return {"protocol": "AAI_BEHAVIOR_UPSTREAM_V1", "classification": "SYNTHETIC_ONLY_NO_MARKET_SOURCE",
                "learning_public_snapshot_sha256": None, "live_execution_allowed": False}, None
    lab.require(args.ecosystem_directory is not None and args.learning_directory is not None
                and args.scanner_source is not None, "BEHAVIOR_VERIFIED_UPSTREAM_REQUIRED")
    connected = args.ecosystem_directory.resolve()
    ecosystem.verify(connected, args.scanner_source, args.community_source)
    source = learning.source_snapshot(connected)
    review_learning.verify_package(args.learning_directory.resolve(), args.reef_source.resolve(),
                                   args.reef_python.absolute(), source)
    return {"protocol": "AAI_BEHAVIOR_UPSTREAM_V1", "classification": "RPC_CAPTURE",
            "ecosystem_input_sha256": lab.digest(source),
            "learning_manifest_sha256": ev.sha((args.learning_directory / "manifest.json").read_bytes()),
            "learning_public_snapshot_sha256": ev.sha((args.learning_directory / "public-snapshot.json").read_bytes()),
            "live_execution_allowed": False}, connected


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("run", "verify", "negative-checks", "self-test"))
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--community-source", type=Path, required=True)
    parser.add_argument("--community-python", type=Path, default=Path(sys.executable))
    parser.add_argument("--reef-source", type=Path, required=True)
    parser.add_argument("--reef-python", type=Path, default=Path(sys.executable))
    parser.add_argument("--ecosystem-directory", type=Path)
    parser.add_argument("--learning-directory", type=Path)
    parser.add_argument("--scanner-source", type=Path)
    parser.add_argument("--synthetic-only", action="store_true", help="Explicitly omit all market-source evidence")
    args = parser.parse_args(argv)
    directory = args.directory.absolute()
    try:
        source, connected = upstream(args)
        arguments = (args.community_source.resolve(), args.reef_source.resolve(), args.community_python.absolute(),
                     args.reef_python.absolute(), source, connected)
        if args.command in ("run", "self-test"):
            result = build(directory, *arguments)
        else:
            result = verify_package(directory, *arguments)
        if args.command in ("self-test", "negative-checks"):
            negative_checks(directory, *arguments)
        lab.require(upstream(args) == (source, connected), "BEHAVIOR_UPSTREAM_MUTATED")
        print(ev.canonical({"verified": True, **result}))
        return 0
    except (ValueError, OSError, RuntimeError, subprocess.SubprocessError) as error:
        print(ev.canonical({"status": "BEHAVIOR_REJECTED", "error": str(error), "live_execution_allowed": False}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
