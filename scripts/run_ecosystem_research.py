"""Connect pinned ecosystem components to AAI.fun research artifacts; no deployment."""
from __future__ import annotations

import argparse
from contextlib import closing, contextmanager
import shutil
import sqlite3
import tempfile
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.ecosystem_research import mint_capture  # noqa: E402
from src.ecosystem_research.checkout import lock, verify_checkout, worker_environment  # noqa: E402
from src.multi_brain_research import trade_learning as trade  # noqa: E402
from src.multi_brain_research import training_lab as lab  # noqa: E402
from src.multi_brain_research import neural_features as neural  # noqa: E402
from src.solana_research import coin_evidence as ev  # noqa: E402


@contextmanager
def worker_log(phase, output):
    if phase == "recheck":
        with tempfile.TemporaryFile("w+b") as stream:
            yield stream
    else:
        with (output / f"{phase}.log").open("xb") as stream:
            yield stream


def phase_worker(phase, output, scanner, community):
    for name, path in (("scanner", scanner), ("community", community)):
        verify_checkout(path, name)
    with worker_log(phase, output) as stream:
        subprocess.run([sys.executable, "-I", "-B", str(ROOT / "scripts/ecosystem_worker.py"),
                        phase, str(output), str(scanner), str(community)],
                       cwd=output, env=worker_environment(), stdout=stream, stderr=subprocess.STDOUT,
                       timeout=240, check=True)
        stream.flush()
        lab.require(stream.seek(0, 2) <= 1024**2, "ECOSYSTEM_LOG_BOUND")
    for name, path in (("scanner", scanner), ("community", community)):
        verify_checkout(path, name)


def run(native, output, scanner, community):
    native, output = Path(native).resolve(), Path(output).absolute()
    scanner, community = Path(scanner).resolve(), Path(community).resolve()
    for name, path in (("scanner", scanner), ("community", community)):
        verify_checkout(path, name)
    trade.verify(native / "neural-training")
    training_archives, training_data = trade.load_sources(native / "neural-training")
    target_archives, target_data = trade.load_sources(native / "real-input")
    plan = ev.read(native / "neural-training/plan.json")
    training_bundle = ev.read(native / "neural-training/neural-features.json")
    target_bundle = ev.read(native / "real-features.json")
    neural.validate_bundle(target_bundle, target_data, trade.PIPELINE)
    lab.require(target_data["classification"] == "RPC_CAPTURE", "ECOSYSTEM_REAL_TARGET_REQUIRED")
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    try:
        trade.run(training_archives, plan, output / "training", training_bundle,
                  stitch=training_data["protocol"] == trade.CONTIGUOUS_DATASET)
        lab.require(ev.read(output / "training/model.json") == ev.read(native / "neural-training/model.json"),
                    "ECOSYSTEM_TRAINING_COPY_CHANGED")
        trade.prepare(target_archives, output / "target",
                      stitch=target_data["protocol"] == trade.CONTIGUOUS_DATASET)
        ev.write(output / "target-neural-features.json", target_bundle)
        ev.write(output / "components.json", lock())
        mint_capture.collect(output / "mint-capture", target_data)
        phase_worker("build", output, scanner, community)
        phase_worker("verify", output, scanner, community)
        result = ev.read(output / "summary.json")
    except Exception:
        ev.write(output / "incomplete.json", {"status": "INCOMPLETE", "live_execution_allowed": False})
        for phase in ("build", "verify"):
            log = output / f"{phase}.log"
            if log.is_file():
                print(log.read_bytes()[-7000:].decode("utf-8", errors="replace"), file=sys.stderr)
        raise
    print(ev.canonical({"verified": True, **result}))
    return result


def verify(output, scanner, community):
    output = Path(output).resolve()
    # Repeated verification leaves no new credential, database record or log file.
    phase_worker("recheck", output, Path(scanner).resolve(), Path(community).resolve())
    return ev.read(output / "summary.json")


def negative_checks(output, scanner, community):
    output, scanner, community = [Path(p).resolve() for p in (output, scanner, community)]
    verify(output, scanner, community)
    size = sum(p.stat().st_size for p in output.rglob("*") if p.is_file())
    lab.require(size <= 512 * 1024**2, "ECOSYSTEM_COPY_BOUND")
    rejected = {}
    for fault in ("artifact", "database", "public_projection"):
        with tempfile.TemporaryDirectory() as folder:
            copied = Path(folder) / "evidence"
            shutil.copytree(output, copied)
            phase_worker("recheck", copied, scanner, community)
            if fault == "artifact":
                path = copied / "forecast_reviewer.json"
                value = ev.read(path)
                value["rows"][0]["prediction_ppm"] ^= 1
                path.write_text(ev.canonical(value), encoding="utf-8")
            elif fault == "database":
                with closing(sqlite3.connect(copied / "state/community.sqlite3")) as connection:
                    connection.execute("UPDATE jobs SET report_sha256=?", ("a" * 64,))
                    connection.commit()
            else:
                path = copied / "public-snapshot.json"
                value = ev.read(path)
                value["live_execution_allowed"] = True
                path.write_text(ev.canonical(value), encoding="utf-8")
            try:
                phase_worker("recheck", copied, scanner, community)
            except subprocess.CalledProcessError:
                rejected[fault] = True
            else:
                raise ValueError("ECOSYSTEM_TAMPER_ACCEPTED")
    ev.write(output / "negative-checks.json", {"protocol": "AAI_ECOSYSTEM_NEGATIVE_CHECKS_V1",
                                              "rejected": rejected, "original_inputs_unchanged": True,
                                              "live_execution_allowed": False})
    verify(output, scanner, community)
    return rejected


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for command in ("run", "verify", "negative-checks"):
        child = commands.add_parser(command)
        child.add_argument("--scanner-source", type=Path, required=True)
        child.add_argument("--community-source", type=Path, required=True)
        if command == "run":
            child.add_argument("--native-directory", type=Path, required=True)
            child.add_argument("--output", type=Path, required=True)
        else:
            child.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "run":
            run(args.native_directory, args.output, args.scanner_source, args.community_source)
        elif args.command == "negative-checks":
            result = negative_checks(args.directory, args.scanner_source, args.community_source)
            print(ev.canonical({"verified": True, "rejected": result, "live_execution_allowed": False}))
        else:
            result = verify(args.directory, args.scanner_source, args.community_source)
            print(ev.canonical({"verified": True, **result}))
        return 0
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(ev.canonical({"status": "ECOSYSTEM_REJECTED", "error": str(error), "live_execution_allowed": False}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
