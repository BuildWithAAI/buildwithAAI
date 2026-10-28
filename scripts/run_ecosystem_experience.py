"""Extend a verified behavior package with restartable shared experience; research only."""
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
from src.ecosystem_research import reef_adapter  # noqa: E402
from src.ecosystem_research.checkout import verify_checkout, worker_environment  # noqa: E402
from src.multi_brain_research import training_lab as lab  # noqa: E402
from src.solana_research import coin_evidence as ev  # noqa: E402
import run_ecosystem_behavior as previous  # noqa: E402

FILES = ("upstream.json", "curriculum.json", "admission-policy.json", "sessions.json", "generator-code.json",
         "paper_learner.json", "contract_learner.json", "code_learner.json", "opsec_learner.json",
         "jobs.json", "access.json", "selection.json", "reef-records.json", "reef-component.json",
         "summary.json", "public-snapshot.json", "agents/community.sqlite3", "experience/journal.sqlite3",
         "reef/records.sqlite3")


def worker(phase, directory, community, reef, community_python, reef_python, parent, *, quiet=False):
    verify_checkout(community, "community")
    reef_adapter.verify_reef(reef)
    environment = {**worker_environment(), "HF_HUB_OFFLINE": "1", "DO_NOT_TRACK": "1",
                   "LITELLM_LOCAL_MODEL_COST_MAP": "True"}
    python = community_python if phase.startswith("data-") else reef_python
    result = subprocess.run([str(python), "-I", "-B", str(ROOT / "scripts/ecosystem_experience_worker.py"),
                             phase, str(directory), str(community), str(reef), str(parent)], cwd=directory,
                            env=environment, capture_output=True, timeout=240, check=False)
    lab.require(len(result.stdout) + len(result.stderr) <= 1024**2, "EXPERIENCE_WORKER_LOG_BOUND")
    if phase.endswith("-build"):
        (directory / (phase + ".log")).write_bytes(result.stdout + result.stderr)
    if result.returncode:
        if not quiet:
            print((result.stdout + result.stderr)[-6000:].decode("utf-8", errors="replace"), file=sys.stderr)
        raise ValueError("EXPERIENCE_WORKER_REJECTED:" + phase)
    verify_checkout(community, "community")
    reef_adapter.verify_reef(reef)


def manifest(directory):
    lab.require(not (directory / "owner.credential").exists(), "EXPERIENCE_CREDENTIAL_RETAINED")
    entries, total = {}, 0
    for name in FILES:
        path = directory / name
        lab.require(path.is_file() and not path.is_symlink() and not path.parent.is_symlink(), "EXPERIENCE_PACKAGE_FILE")
        size = path.stat().st_size
        lab.require(0 < size <= 8 * 1024**2, "EXPERIENCE_PACKAGE_FILE_BOUND")
        total += size
        lab.require(total <= 32 * 1024**2, "EXPERIENCE_PACKAGE_BOUND")
        entries[name] = {"sha256": ev.sha(path.read_bytes()), "bytes": size}
        if name.endswith("sqlite3"):
            lab.require(not Path(str(path) + "-wal").exists(), "EXPERIENCE_PACKAGE_OPEN_WAL")
    return {"protocol": "AAI_EXPERIENCE_PACKAGE_V1", "status": "COMPLETE", "files": entries,
            "upstream_sha256": lab.digest(ev.read(directory / "upstream.json")), "live_execution_allowed": False}


def write_manifest(directory):
    temporary = directory / "manifest.pending"
    ev.write(temporary, manifest(directory))
    temporary.replace(directory / "manifest.json")


def verify_package(directory, community, reef, community_python, reef_python, parent, source, *, quiet=False):
    lab.require(not (directory / "incomplete.json").exists(), "EXPERIENCE_INCOMPLETE")
    expected = manifest(directory)
    lab.require(ev.read(directory / "manifest.json") == expected, "EXPERIENCE_MANIFEST_CHANGED")
    lab.require(ev.read(directory / "upstream.json") == source, "EXPERIENCE_UPSTREAM_CHANGED")
    for phase in ("data-verify", "reef-verify"):
        worker(phase, directory, community, reef, community_python, reef_python, parent, quiet=quiet)
    lab.require(manifest(directory) == expected, "EXPERIENCE_VERIFIER_MUTATED_PACKAGE")
    return ev.read(directory / "summary.json")


def build(directory, community, reef, community_python, reef_python, parent, source):
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    try:
        ev.write(directory / "upstream.json", source)
        for phase in ("data-build", "data-verify", "reef-build"):
            worker(phase, directory, community, reef, community_python, reef_python, parent)
        write_manifest(directory)
        return verify_package(directory, community, reef, community_python, reef_python, parent, source)
    except (ValueError, OSError, RuntimeError, subprocess.SubprocessError):
        ev.write(directory / "incomplete.json", {"status": "INCOMPLETE", "live_execution_allowed": False})
        raise


def negative_checks(directory, *arguments):
    verify_package(directory, *arguments)
    lab.require(sum(p.stat().st_size for p in directory.rglob("*") if p.is_file()) <= 40 * 1024**2,
                "EXPERIENCE_COPY_BOUND")
    rejected = {}
    for fault in ("rehash_journal", "forged_receipt", "learned_model", "restart_checkpoint", "public_guard"):
        with tempfile.TemporaryDirectory() as folder:
            copied = Path(folder) / "package"
            shutil.copytree(directory, copied)
            verify_package(copied, *arguments)
            if fault == "rehash_journal":
                with closing(sqlite3.connect(copied / "experience/journal.sqlite3")) as connection:
                    rows = connection.execute("SELECT sequence,body FROM events ORDER BY sequence").fetchall()
                    previous_hash = "0" * 64
                    for sequence, raw in rows:
                        value = ev.parse(raw.encode())
                        if sequence == 0:
                            value["request"]["case"]["target"] ^= 1
                        value["previous_sha256"] = previous_hash
                        body = {k: v for k, v in value.items() if k != "sha256"}
                        previous_hash = value["sha256"] = lab.digest(body)
                        connection.execute("UPDATE events SET body=? WHERE sequence=?", (ev.canonical(value), sequence))
                    connection.commit()
            else:
                name = {"forged_receipt": "admission-policy.json", "learned_model": "paper_learner.json",
                        "restart_checkpoint": "sessions.json", "public_guard": "public-snapshot.json"}[fault]
                path = copied / name
                value = ev.read(path)
                if fault == "forged_receipt":
                    next(iter(value["registry"].values()))["receipt"]["project_id"] = "0" * 32
                elif fault == "learned_model":
                    next(iter(value["model"]["contexts"].values()))["one"] += 1
                elif fault == "restart_checkpoint":
                    value["checkpoints"][1]["audit"]["accepted"] += 1
                else:
                    value["blocked_context_count"] = 0
                path.write_text(ev.canonical(value) + "\n", encoding="utf-8")
            write_manifest(copied)
            try:
                verify_package(copied, *arguments, quiet=True)
            except ValueError:
                rejected[fault] = True
            else:
                raise ValueError("EXPERIENCE_TAMPER_ACCEPTED:" + fault)
    verify_package(directory, *arguments)
    ev.write(directory / "negative-checks.json", {"protocol": "AAI_EXPERIENCE_NEGATIVE_CHECKS_V1",
             "rejected": rejected, "outer_hashes_recomputed": True, "journal_hash_chain_recomputed": True,
             "live_execution_allowed": False})
    return rejected


def upstream(args):
    source, connected = previous.upstream(args)
    parent = args.behavior_directory.resolve()
    previous.verify_package(parent, args.community_source.resolve(), args.reef_source.resolve(),
                            args.community_python.absolute(), args.reef_python.absolute(), source, connected)
    return {"protocol": "AAI_EXPERIENCE_UPSTREAM_V1", "behavior_manifest_sha256": ev.sha((parent / "manifest.json").read_bytes()),
            "behavior_public_snapshot_sha256": ev.sha((parent / "public-snapshot.json").read_bytes()),
            "source_classification": ev.read(parent / "summary.json")["recorded_source_classification"],
            "live_execution_allowed": False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("run", "verify", "negative-checks"))
    parser.add_argument("--directory", type=Path, required=True)
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
    directory = args.directory.absolute()
    try:
        source = upstream(args)
        arguments = (args.community_source.resolve(), args.reef_source.resolve(), args.community_python.absolute(),
                     args.reef_python.absolute(), args.behavior_directory.resolve(), source)
        result = build(directory, *arguments) if args.command == "run" else verify_package(directory, *arguments)
        if args.command == "negative-checks":
            negative_checks(directory, *arguments)
        lab.require(upstream(args) == source, "EXPERIENCE_UPSTREAM_MUTATED")
        print(ev.canonical({"verified": True, **result}))
        return 0
    except (ValueError, OSError, RuntimeError, subprocess.SubprocessError) as error:
        print(ev.canonical({"status": "EXPERIENCE_REJECTED", "error": str(error), "live_execution_allowed": False}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
