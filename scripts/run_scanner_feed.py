"""Collect current scanner observations and deliver evidence to a community agent."""

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
from src.ecosystem_research import network as n, scanner_feed as f  # noqa: E402
from src.ecosystem_research.checkout import verify_checkout, worker_environment  # noqa: E402
from src.multi_brain_research import training_lab as lab  # noqa: E402
from src.solana_research import coin_evidence as ev  # noqa: E402
import run_ecosystem_network as previous  # noqa: E402

FILES = (
    "upstream.json",
    "bundle.json",
    "delivery.json",
    "agent-report.json",
    "agent-receipt.json",
    "audit.json",
    "summary.json",
    "generator-code.json",
    "http-feed/policy.json",
    "http-feed/observations.sqlite3",
    "tls-feed/policy.json",
    "tls-feed/observations.sqlite3",
    "agents/community.sqlite3",
    "scanner.sqlite3",
)
CODE = (
    "src/ecosystem_research/scanner_feed.py",
    "src/ecosystem_research/scanner_client.py",
    "scripts/scanner_feed_worker.py",
    "scripts/run_scanner_feed.py",
)


def worker(action, cfg, python):
    for component in ("scanner", "community"):
        if component + "_source" in cfg:
            verify_checkout(cfg[component + "_source"], component)
    with tempfile.TemporaryDirectory() as folder:
        packet = Path(folder) / "packet.json"
        ev.write(packet, cfg)
        packet.chmod(0o600)
        budget = (cfg.get("count", 1) * 360 + 30) if action == "collect" else 240
        result = subprocess.run(
            [
                str(python),
                "-I",
                "-B",
                str(ROOT / "scripts/scanner_feed_worker.py"),
                action,
                str(packet),
            ],
            capture_output=True,
            timeout=budget,
            check=False,
            env=worker_environment(),
        )
    for component in ("scanner", "community"):
        if component + "_source" in cfg:
            verify_checkout(cfg[component + "_source"], component)
    lab.require(
        len(result.stdout) + len(result.stderr) <= 1024**2, "FEED_WORKER_LOG_BOUND"
    )
    if result.returncode:
        try:
            code = ev.parse(result.stdout).get("error", "INVALID_OUTPUT")
        except ValueError:
            code = "INVALID_OUTPUT"
        raise ValueError("FEED_WORKER_REJECTED:" + str(code)[:250])
    return ev.parse(result.stdout)


def manifest(directory):
    entries, total = {}, 0
    for name in FILES:
        path = n.safe_path(directory / name)
        lab.require(path.is_file() and path.stat().st_nlink == 1, "FEED_PACKAGE_FILE")
        size = path.stat().st_size
        lab.require(0 < size <= f.MAX_DATABASE, "FEED_PACKAGE_FILE_BOUND")
        total += size
        lab.require(total <= 64 * 1024**2, "FEED_PACKAGE_BOUND")
        entries[name] = {"sha256": ev.sha(path.read_bytes()), "bytes": size}
        if name.endswith("sqlite3"):
            lab.require(
                not any(
                    Path(str(path) + suffix).exists()
                    for suffix in ("-wal", "-shm", "-journal")
                ),
                "FEED_OPEN_TRANSACTION",
            )
    return {
        "protocol": "AAI_SCANNER_FEED_PACKAGE_V1",
        "status": "COMPLETE",
        "files": entries,
        "live_execution_allowed": False,
    }


def write_manifest(directory):
    pending = directory / "manifest.pending"
    ev.write(pending, manifest(directory))
    pending.replace(directory / "manifest.json")


def code_identity():
    return {name: ev.sha((ROOT / name).read_bytes()) for name in CODE}


def config(args, directory, source):
    return {
        "community_source": str(args.community_source.resolve()),
        "scanner_source": str(args.scanner_source.resolve()),
        "output": str(directory),
        "controller_manifest_sha256": source["controller_manifest_sha256"],
        "mode": source["mode"],
    }


def verify_package(args, directory, source, bundle):
    lab.require(not (directory / "incomplete.json").exists(), "FEED_INCOMPLETE")
    initial = manifest(directory)
    lab.require(
        n.same(ev.read(directory / "manifest.json"), initial), "FEED_MANIFEST_CHANGED"
    )
    lab.require(
        n.same(ev.read(directory / "upstream.json"), source)
        and n.same(ev.read(directory / "bundle.json"), bundle),
        "FEED_UPSTREAM_CHANGED",
    )
    lab.require(
        n.same(ev.read(directory / "generator-code.json"), code_identity()),
        "FEED_CODE_CHANGED",
    )
    result = worker(
        "lab-verify", config(args, directory, source), args.community_python
    )
    expected = {k: v for k, v in result.items() if k != "verified"}
    lab.require(
        n.same(ev.read(directory / "summary.json"), expected), "FEED_SUMMARY_REPLAY"
    )
    lab.require(n.same(manifest(directory), initial), "FEED_VERIFIER_MUTATED_PACKAGE")
    return expected


def build(args, directory, source, bundle):
    n.safe_path(directory)
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    try:
        ev.write(directory / "upstream.json", source)
        ev.write(directory / "bundle.json", bundle)
        ev.write(directory / "generator-code.json", code_identity())
        result = worker(
            "lab-build", config(args, directory, source), args.community_python
        )
        ev.write(
            directory / "summary.json",
            {k: v for k, v in result.items() if k != "verified"},
        )
        write_manifest(directory)
        return verify_package(args, directory, source, bundle)
    except (
        ValueError,
        OSError,
        RuntimeError,
        sqlite3.Error,
        subprocess.SubprocessError,
    ):
        ev.write(
            directory / "incomplete.json",
            {"status": "INCOMPLETE", "live_execution_allowed": False},
        )
        raise


def negative_checks(args, directory, source, bundle):
    verify_package(args, directory, source, bundle)
    lab.require(
        sum(p.stat().st_size for p in directory.rglob("*") if p.is_file())
        <= 70 * 1024**2,
        "FEED_COPY_BOUND",
    )
    rejected = {}
    for fault in (
        "rehashed_projection",
        "agent_facts",
        "job_binding",
        "execution_authority",
        "source_policy",
    ):
        with tempfile.TemporaryDirectory() as folder:
            copied = Path(folder) / "package"
            shutil.copytree(directory, copied)
            verify_package(args, copied, source, bundle)
            if fault in ("rehashed_projection", "job_binding"):
                filename = (
                    "tls-feed/observations.sqlite3"
                    if fault == "rehashed_projection"
                    else "agents/community.sqlite3"
                )
                with closing(sqlite3.connect(copied / filename)) as db, db:
                    if fault == "job_binding":
                        db.execute(
                            "UPDATE jobs SET report_bytes=report_bytes+1 WHERE title='Network advisory consume'"
                        )
                    else:
                        value = ev.parse(
                            db.execute("SELECT body FROM events WHERE sequence=0")
                            .fetchone()[0]
                            .encode()
                        )
                        value["assessment"]["projection"]["facts"]["price_usd"] = (
                            "999999"
                        )
                        value["sha256"] = lab.digest(
                            {k: v for k, v in value.items() if k != "sha256"}
                        )
                        db.execute(
                            "UPDATE events SET body=? WHERE sequence=0",
                            (ev.canonical(value),),
                        )
            else:
                path = copied / (
                    "tls-feed/policy.json"
                    if fault == "source_policy"
                    else "agent-report.json"
                )
                value = ev.read(path)
                if fault == "source_policy":
                    value["rpc_hosts"] = ["untrusted.invalid"]
                elif fault == "agent_facts":
                    value["last_observation"]["projection"]["facts"]["price_usd"] = (
                        "999999"
                    )
                else:
                    value["live_execution_allowed"] = True
                path.write_bytes(n.raw(value))
            write_manifest(copied)
            try:
                verify_package(args, copied, source, bundle)
            except ValueError:
                rejected[fault] = True
            else:
                raise ValueError("FEED_TAMPER_ACCEPTED:" + fault)
    verify_package(args, directory, source, bundle)
    ev.write(
        directory / "negative-checks.json",
        {
            "protocol": "AAI_SCANNER_FEED_NEGATIVE_CHECKS_V1",
            "rejected": rejected,
            "outer_hashes_recomputed": True,
            "live_execution_allowed": False,
        },
    )
    return rejected


def upstream(args):
    # The older synthetic parent contract deliberately forbids a scanner source.
    # This stage always needs the real scanner checkout for its separate HTTP lane.
    parent_args = argparse.Namespace(**vars(args))
    if args.synthetic_only:
        parent_args.scanner_source = None
    network_source, bundle = previous.upstream(parent_args)
    previous.verify_package(
        args, args.network_directory.resolve(), network_source, bundle
    )
    return {
        "protocol": "AAI_SCANNER_FEED_UPSTREAM_V1",
        "network_manifest_sha256": ev.sha(
            (args.network_directory / "manifest.json").read_bytes()
        ),
        "controller_manifest_sha256": network_source["controller_manifest_sha256"],
        "verification": "COMPLETE_UPSTREAM_REPLAY",
        "mode": "LIVE_PROVIDER_READS",
        "live_execution_allowed": False,
    }, bundle


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    commands = result.add_subparsers(dest="command", required=True)
    for name in ("run", "verify", "negative-checks", "transport-self-test"):
        p = commands.add_parser(name)
        p.add_argument("--directory", type=Path, required=True)
        p.add_argument("--scanner-source", type=Path, required=True)
        p.add_argument("--community-source", type=Path, required=True)
        p.add_argument("--community-python", type=Path, default=Path(sys.executable))
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
                help="Existing parent corpus mode only; scanner reads still use real providers",
            )
    for name in ("collect", "status", "agent"):
        p = commands.add_parser(name)
        p.add_argument("--directory", type=Path, required=True)
        p.add_argument("--community-python", type=Path, default=Path(sys.executable))
        if name == "collect":
            p.add_argument("--scanner-origin", required=True)
            p.add_argument("--scanner-release-sha256", required=True)
            p.add_argument("--mint", required=True)
            p.add_argument("--rpc-host", action="append", required=True)
            p.add_argument("--scanner-token-file", type=Path)
            p.add_argument("--scanner-ca-file", type=Path)
            p.add_argument("--count", type=int, default=1)
            p.add_argument("--interval-seconds", type=int, default=30)
            p.add_argument("--expected-head")
        if name == "agent":
            p.add_argument("--expected-head", required=True)
            p.add_argument("--community-source", type=Path, required=True)
            p.add_argument("--origin", required=True)
            p.add_argument("--expected-instance", required=True)
            p.add_argument("--expected-agent", required=True)
            p.add_argument("--credential", type=Path, required=True)
            p.add_argument("--project", required=True)
            p.add_argument("--bundle-sha256", required=True)
            p.add_argument("--trusted-controller-sha256", required=True)
            p.add_argument("--ca-file", type=Path)
            p.add_argument("--output", type=Path)
    return result


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        directory = n.safe_path(args.directory)
        if args.command in ("collect", "status", "agent"):
            cfg = {"directory": str(directory)}
            for key in (
                "scanner_origin",
                "scanner_release_sha256",
                "mint",
                "scanner_token_file",
                "scanner_ca_file",
                "count",
                "interval_seconds",
                "expected_head",
                "community_source",
                "origin",
                "expected_instance",
                "expected_agent",
                "credential",
                "ca_file",
                "output",
            ):
                value = getattr(args, key, None)
                if value is not None:
                    cfg[key] = (
                        str(n.safe_path(value)) if isinstance(value, Path) else value
                    )
            if args.command == "collect":
                cfg["rpc_hosts"] = args.rpc_host
                lab.require(
                    1 <= args.count <= f.MAX_RECORDS
                    and 30 <= args.interval_seconds <= 300,
                    "FEED_POLL_BOUNDS",
                )
            if args.command == "agent":
                cfg.update(
                    project_id=n.identity(args.project),
                    bundle_sha256=lab.pin(args.bundle_sha256),
                    controller_manifest_sha256=lab.pin(args.trusted_controller_sha256),
                )
                if args.output:
                    n.safe_path(args.output).mkdir(
                        mode=0o700, parents=True, exist_ok=True
                    )
            result = worker(args.command, cfg, args.community_python)
        else:
            if args.command == "transport-self-test":
                bundle = n.read_bundle(args.bundle_file, args.trusted_controller_sha256)
                source = {
                    "protocol": "AAI_SCANNER_FEED_UPSTREAM_V1",
                    "network_manifest_sha256": None,
                    "controller_manifest_sha256": args.trusted_controller_sha256,
                    "verification": "PINNED_DISTRIBUTION_FILES_ONLY",
                    "mode": "SYNTHETIC_TRANSPORT_TEST",
                    "live_execution_allowed": False,
                }
            else:
                source, bundle = upstream(args)
            result = (
                build(args, directory, source, bundle)
                if args.command in ("run", "transport-self-test")
                else verify_package(args, directory, source, bundle)
            )
            if args.command in ("negative-checks", "transport-self-test"):
                result = {
                    **result,
                    "negative_checks": negative_checks(args, directory, source, bundle),
                }
            if args.command != "transport-self-test":
                later_source, later_bundle = upstream(args)
                lab.require(
                    n.same(later_source, source) and n.same(later_bundle, bundle),
                    "FEED_UPSTREAM_MUTATED",
                )
        print(ev.canonical({"verified": True, **result}))
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
                    "status": "FEED_REJECTED",
                    "error": code[:300],
                    "live_execution_allowed": False,
                }
            )
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
