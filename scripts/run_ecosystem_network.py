"""Real community HTTP/TLS model distribution and pinned advisory-agent commands."""
from __future__ import annotations

import argparse
from contextlib import closing
import os
from pathlib import Path
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.ecosystem_research import network as n  # noqa: E402
from src.ecosystem_research.checkout import verify_checkout, worker_environment  # noqa: E402
from src.multi_brain_research import training_lab as lab  # noqa: E402
from src.solana_research import coin_evidence as ev  # noqa: E402
import run_ecosystem_controller as previous  # noqa: E402

FILES = ("upstream.json", "bundle.json", "publisher.json", "received.json", "consumer.json", "publish-result.json",
         "consume-result.json", "observer.json", "transport.json", "audit.json", "summary.json", "generator-code.json",
         "agents/community.sqlite3")
CODE = ("src/ecosystem_research/network.py", "scripts/ecosystem_network_worker.py", "scripts/run_ecosystem_network.py")


def worker(action, cfg, python, *, interactive=False):
    verify_checkout(cfg["community_source"], "community")
    if interactive and os.path.abspath(python) == os.path.abspath(sys.executable):
        # Use the configured runtime directly when already inside it. This keeps
        # the foreground Windows service in one process with normal Ctrl-C handling.
        import ecosystem_network_worker
        ecosystem_network_worker.serve(cfg)
        verify_checkout(cfg["community_source"], "community")
        return {"status": "STOPPED", "live_execution_allowed": False}
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "packet.json"
        ev.write(path, cfg)
        path.chmod(0o600)
        command = [str(python), "-I", "-B", str(ROOT / "scripts/ecosystem_network_worker.py"), action, str(path)]
        if interactive:
            process = subprocess.Popen(command, env=worker_environment())
            previous_handler = signal.getsignal(signal.SIGTERM)

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
                signal.signal(signal.SIGTERM, previous_handler)
            result = process
        else:
            result = subprocess.run(command, capture_output=True, timeout=240, check=False, env=worker_environment())
    verify_checkout(cfg["community_source"], "community")
    if interactive:
        lab.require(result.returncode == 0 or stopped, "NETWORK_SERVICE_EXIT")
        return {"status": "STOPPED", "live_execution_allowed": False}
    lab.require(len(result.stdout) + len(result.stderr) <= 1024**2, "NETWORK_WORKER_LOG_BOUND")
    if result.returncode:
        try:
            code = ev.parse(result.stdout).get("error", "INVALID_WORKER_OUTPUT")
        except ValueError:
            code = "INVALID_WORKER_OUTPUT"
        raise ValueError("NETWORK_WORKER_REJECTED:" + str(code)[:256])
    return ev.parse(result.stdout)


def manifest(directory):
    entries, total = {}, 0
    for name in FILES:
        path = n.safe_path(directory / name)
        lab.require(path.is_file() and path.stat().st_nlink == 1, "NETWORK_PACKAGE_FILE")
        size = path.stat().st_size
        lab.require(0 < size <= 8 * 1024**2, "NETWORK_PACKAGE_FILE_BOUND")
        total += size
        lab.require(total <= 16 * 1024**2, "NETWORK_PACKAGE_BOUND")
        entries[name] = {"sha256": ev.sha(path.read_bytes()), "bytes": size}
        if name.endswith("sqlite3"):
            lab.require(not any(Path(str(path) + suffix).exists() for suffix in ("-wal", "-journal")),
                        "NETWORK_OPEN_TRANSACTION")
    return {"protocol": "AAI_NETWORK_PACKAGE_V1", "status": "COMPLETE", "files": entries,
            "live_execution_allowed": False}


def write_manifest(directory):
    temporary = directory / "manifest.pending"
    ev.write(temporary, manifest(directory))
    temporary.replace(directory / "manifest.json")


def config(args, directory, source):
    return {"community_source": str(args.community_source.resolve()), "output": str(directory),
            "controller_manifest_sha256": source["controller_manifest_sha256"]}


def code_identity():
    return {name: ev.sha((ROOT / name).read_bytes()) for name in CODE}


def verify_package(args, directory, source, bundle):
    lab.require(not (directory / "incomplete.json").exists(), "NETWORK_INCOMPLETE")
    initial = manifest(directory)
    lab.require(n.same(ev.read(directory / "manifest.json"), initial), "NETWORK_MANIFEST_CHANGED")
    lab.require(n.same(ev.read(directory / "upstream.json"), source)
                and n.same(ev.read(directory / "bundle.json"), bundle), "NETWORK_UPSTREAM_CHANGED")
    lab.require(n.same(ev.read(directory / "generator-code.json"), code_identity()), "NETWORK_CODE_CHANGED")
    result = worker("lab-verify", config(args, directory, source), args.community_python)
    expected = {k: v for k, v in result.items() if k != "verified"}
    lab.require(n.same(ev.read(directory / "summary.json"), expected), "NETWORK_SUMMARY_REPLAY")
    lab.require(n.same(manifest(directory), initial), "NETWORK_VERIFIER_MUTATED_PACKAGE")
    return expected


def build(args, directory, source, bundle):
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    try:
        ev.write(directory / "upstream.json", source)
        ev.write(directory / "bundle.json", bundle)
        ev.write(directory / "generator-code.json", code_identity())
        result = worker("lab-build", config(args, directory, source), args.community_python)
        ev.write(directory / "summary.json", {k: v for k, v in result.items() if k != "verified"})
        write_manifest(directory)
        return verify_package(args, directory, source, bundle)
    except (ValueError, OSError, RuntimeError, sqlite3.Error, subprocess.SubprocessError):
        ev.write(directory / "incomplete.json", {"status": "INCOMPLETE", "live_execution_allowed": False})
        raise


def negative_checks(args, directory, source, bundle):
    verify_package(args, directory, source, bundle)
    lab.require(sum(p.stat().st_size for p in directory.rglob("*") if p.is_file()) <= 20 * 1024**2,
                "NETWORK_COPY_BOUND")
    rejected = {}
    for fault in ("transferred_model", "consumer_result", "job_binding", "observer_authority", "transport_claim"):
        with tempfile.TemporaryDirectory() as folder:
            copied = Path(folder) / "package"
            shutil.copytree(directory, copied)
            verify_package(args, copied, source, bundle)
            if fault == "job_binding":
                with closing(sqlite3.connect(copied / "agents/community.sqlite3")) as connection, connection:
                    connection.execute("UPDATE jobs SET report_bytes=report_bytes+1 WHERE title='Network advisory consume'")
            else:
                name = {"transferred_model": "received.json", "consumer_result": "consumer.json",
                        "observer_authority": "observer.json", "transport_claim": "transport.json"}[fault]
                path = copied / name
                value = ev.read(path)
                if fault == "transferred_model":
                    next(iter(value["reports"]["paper_trading"]["model"]["contexts"].values()))["one"] += 1
                elif fault == "consumer_result":
                    value["domains"]["paper_trading"]["blocked_contexts_suppressed"] = 0
                elif fault == "observer_authority":
                    value["live_execution_allowed"] = True
                else:
                    value["denied"]["outsider"] = False
                path.write_bytes(n.raw(value))
            write_manifest(copied)
            try:
                verify_package(args, copied, source, bundle)
            except ValueError:
                rejected[fault] = True
            else:
                raise ValueError("NETWORK_TAMPER_ACCEPTED:" + fault)
    verify_package(args, directory, source, bundle)
    ev.write(directory / "negative-checks.json", {"protocol": "AAI_NETWORK_NEGATIVE_CHECKS_V1", "rejected": rejected,
        "outer_hashes_recomputed": True, "live_execution_allowed": False})
    return rejected


def upstream(args):
    source = previous.upstream(args)
    previous.verify_package(args.controller_directory.resolve(), args.experience_directory.resolve(), source)
    parent = args.controller_directory.resolve()
    result = {"protocol": "AAI_NETWORK_UPSTREAM_V1", "controller_manifest_sha256": ev.sha((parent / "manifest.json").read_bytes()),
              "controller_public_snapshot_sha256": ev.sha((parent / "public-snapshot.json").read_bytes()),
              "verification": "COMPLETE_UPSTREAM_REPLAY", "live_execution_allowed": False}
    bundle = n.load_bundle(parent, args.experience_directory.resolve(), result["controller_manifest_sha256"])
    return result, bundle


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    commands = result.add_subparsers(dest="command", required=True)
    for name in ("run", "verify", "negative-checks", "transport-self-test"):
        p = commands.add_parser(name)
        p.add_argument("--directory", type=Path, required=True)
        p.add_argument("--community-source", type=Path, required=True)
        p.add_argument("--community-python", type=Path, default=Path(sys.executable))
        if name == "transport-self-test":
            p.add_argument("--bundle-file", type=Path, required=True)
            p.add_argument("--trusted-controller-sha256", required=True)
        else:
            p.add_argument("--controller-directory", type=Path, required=True)
            p.add_argument("--experience-directory", type=Path, required=True)
            p.add_argument("--behavior-directory", type=Path, required=True)
            p.add_argument("--reef-source", type=Path, required=True)
            p.add_argument("--reef-python", type=Path, default=Path(sys.executable))
            p.add_argument("--ecosystem-directory", type=Path)
            p.add_argument("--learning-directory", type=Path)
            p.add_argument("--scanner-source", type=Path)
            p.add_argument("--synthetic-only", action="store_true")
    for name in ("serve", "publish", "consume", "observe", "predict"):
        p = commands.add_parser(name)
        p.add_argument("--community-source", type=Path, required=True)
        p.add_argument("--community-python", type=Path, default=Path(sys.executable))
        p.add_argument("--trusted-controller-sha256", required=True)
        p.add_argument("--port", type=int, default=8765)
        if name in ("serve", "publish"):
            p.add_argument("--bundle-file", type=Path, required=True)
        if name == "serve":
            p.add_argument("--state", type=Path, required=True)
            p.add_argument("--public-origin")
        else:
            p.add_argument("--origin")
            p.add_argument("--expected-instance", required=True)
            p.add_argument("--expected-agent", required=True)
            p.add_argument("--project", required=True)
            p.add_argument("--bundle-sha256", required=True)
            p.add_argument("--credential", type=Path, required=True)
            p.add_argument("--ca-file", type=Path)
            p.add_argument("--output", type=Path)
            if name == "predict":
                p.add_argument("--domain", choices=tuple(n.ROLES), required=True)
                p.add_argument("--features", required=True, help="JSON integer feature vector for the bounded advisory model")
    return result


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        if args.command in ("serve", "publish", "consume", "observe", "predict"):
            lab.pin(args.trusted_controller_sha256)
            cfg = {"community_source": str(args.community_source.resolve()), "port": args.port,
                   "controller_manifest_sha256": args.trusted_controller_sha256}
            for key in ("bundle_file", "state", "public_origin", "origin", "expected_instance", "expected_agent", "credential",
                        "ca_file", "output", "domain"):
                value = getattr(args, key, None)
                if value is not None:
                    cfg[key] = str(value.absolute()) if isinstance(value, Path) else value
            if args.command != "serve":
                cfg.update(project_id=n.identity(args.project), bundle_sha256=args.bundle_sha256)
            if args.command == "predict":
                lab.require(len(args.features) <= 128, "NETWORK_FEATURE_ARGUMENT_BOUND")
                cfg["features"] = ev.parse(args.features.encode())
            result = worker(args.command, cfg, args.community_python, interactive=args.command == "serve")
        else:
            directory = args.directory.absolute()
            if args.command == "transport-self-test":
                bundle = n.read_bundle(args.bundle_file, args.trusted_controller_sha256)
                source = {"protocol": "AAI_NETWORK_UPSTREAM_V1", "controller_manifest_sha256": args.trusted_controller_sha256,
                          "controller_public_snapshot_sha256": ev.sha(n.raw(bundle["controller_public"])),
                          "verification": "PINNED_DISTRIBUTION_FILES_ONLY", "live_execution_allowed": False}
            else:
                source, bundle = upstream(args)
            result = build(args, directory, source, bundle) if args.command in ("run", "transport-self-test") else verify_package(args, directory, source, bundle)
            if args.command == "negative-checks":
                negative_checks(args, directory, source, bundle)
            if args.command != "transport-self-test":
                later_source, later_bundle = upstream(args)
                lab.require(n.same(later_source, source) and n.same(later_bundle, bundle), "NETWORK_UPSTREAM_MUTATED")
        print(ev.canonical({"verified": True, **result}))
        return 0
    except (ValueError, OSError, RuntimeError, sqlite3.Error, subprocess.SubprocessError) as error:
        code = str(error) if isinstance(error, ValueError) else type(error).__name__
        print(ev.canonical({"status": "NETWORK_REJECTED", "error": code[:300], "live_execution_allowed": False}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
