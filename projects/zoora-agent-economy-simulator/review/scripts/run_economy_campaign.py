"""Run a bounded offline campaign with replay-checked checkpoints and full run files.

Python 3.11+ and the release Rust binary are required. Use a trusted local directory,
one coordinator at a time. No network calls, wallet keys or paid resources.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import tomllib

ROOT = Path(__file__).resolve().parents[1]
SCENARIOS = {"BALANCED", "SHARED_OPERATOR_SPAM", "SYBIL_SPAM", "PROVIDER_OUTAGE",
             "DEMAND_SURGE", "BUDGET_SQUEEZE", "REFUND_STRESS", "DIGEST_ONLY"}
POLICIES = ("BASELINE", "OPERATOR_CAP")
LIMIT = 128 * 1024 * 1024

def sha(path: Path) -> str:
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256")
    return digest.hexdigest()

def json_file(path: Path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > LIMIT:
        raise ValueError(f"Expected bounded regular file: {path.name}")
    return json.loads(path.read_text(encoding="utf-8"))

def execute(binary: Path, *args, timeout: int):
    process = subprocess.run([str(binary), *map(str, args)], cwd=ROOT,
                             capture_output=True, text=True, timeout=timeout)
    if process.returncode:
        raise RuntimeError(f"CLI {args[0]} failed: {process.stderr.strip()}")

def publish(source: Path, target: Path, resume: bool):
    if target.exists() or target.is_symlink():
        if not resume or target.is_symlink() or not target.is_file() or sha(source) != sha(target):
            raise ValueError(f"Existing export differs; use a new directory: {target.name}")
    else:
        # Staging is on this same local filesystem. link() publishes atomically
        # and fails if the destination already exists; no partial checkpoint name.
        os.link(source, target)

def checkpoint(folder: Path, progress: dict):
    # Replace only this coordinator's explicitly owned progress file, never a run.
    target = folder / "progress.json"
    if target.is_symlink():
        raise ValueError("Progress cannot be a symlink")
    descriptor, name = tempfile.mkstemp(prefix="progress-", suffix=".tmp", dir=folder)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(progress, stream, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, target)
    finally:
        if os.path.exists(name):
            os.unlink(name)

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--binary", type=Path, default=ROOT / "target" / "release" /
                        ("zoora-review-market.exe" if os.name == "nt" else "zoora-review-market"))
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--max-new-runs", type=int, help="Checkpoint early; remains INCOMPLETE")
    parser.add_argument("--timeout", type=int, default=180)
    args = parser.parse_args()
    if not 1 <= args.timeout <= 3600 or (args.max_new_runs is not None and args.max_new_runs < 1):
        raise ValueError("Invalid timeout/run limit")
    config_path, binary = args.config.resolve(strict=True), args.binary.resolve(strict=True)
    if config_path.stat().st_size > 4 * 1024 * 1024:
        raise ValueError("Config too large")
    config_bytes = config_path.read_bytes()
    config = tomllib.loads(config_bytes.decode("utf-8"))
    seeds, scenarios = config.get("seeds"), config.get("scenarios")
    if not isinstance(seeds, list) or not 1 <= len(seeds) <= 16 or any(type(s) is not int or not 0 <= s <= 2**64-1 for s in seeds) or seeds != sorted(set(seeds)):
        raise ValueError("Expected sorted distinct bounded seeds")
    if not isinstance(scenarios, list) or not 1 <= len(scenarios) <= 8 or any(s not in SCENARIOS for s in scenarios) or len(set(scenarios)) != len(scenarios):
        raise ValueError("Invalid scenarios")
    folder = args.output_dir.absolute()
    if folder.is_symlink():
        raise ValueError("Output directory cannot be a symlink")
    config_sha = hashlib.sha256(config_bytes).hexdigest()
    binary_sha = sha(binary)
    identity = {"schema_version": 1, "classification": "SYNTHETIC", "unit": "SIMULATED_UNITS",
                "config_sha256": config_sha, "binary_sha256": binary_sha,
                "expected_runs": len(seeds) * len(scenarios) * 2}
    if folder.exists():
        if not args.resume:
            raise ValueError("Output directory exists; use --resume or choose a new directory")
        previous = json_file(folder / "progress.json")
        if any(previous.get(k) != v for k, v in identity.items()) or (folder / "config.toml").read_bytes() != config_bytes:
            raise ValueError("Resume requires the exact same config and executable")
    else:
        if args.resume:
            raise ValueError("Resume directory does not exist")
        folder.mkdir(parents=True)
        (folder / "config.toml").write_bytes(config_bytes)
    runs_dir = folder / "runs"
    if runs_dir.is_symlink():
        raise ValueError("Run directory cannot be a symlink")
    runs_dir.mkdir(exist_ok=True)
    progress = dict(identity, state="INCOMPLETE", completed_runs=0, runs=[], exports=[])
    checkpoint(folder, progress)
    new_runs = 0
    for seed in seeds:
        for scenario in scenarios:
            for policy in POLICIES:
                name = f"{seed}-{scenario}-{policy}.json"
                target = runs_dir / name
                if target.exists() or target.is_symlink():
                    if not args.resume:
                        raise ValueError("Unexpected pre-existing run")
                    execute(binary, "replay-economy", target, timeout=args.timeout)
                else:
                    if args.max_new_runs is not None and new_runs >= args.max_new_runs:
                        print(json.dumps({"state": "INCOMPLETE", "completed_runs": progress["completed_runs"], "expected_runs": identity["expected_runs"]}))
                        return 0
                    # Generate into a fresh staging directory: interruption cannot leave a
                    # partial file with a valid checkpoint name. Publish without overwriting.
                    with tempfile.TemporaryDirectory(prefix="stage-", dir=folder) as stage:
                        temporary = Path(stage) / name
                        execute(binary, "economy-run", config_path, seed, scenario, policy,
                                temporary, timeout=args.timeout)
                        publish(temporary, target, False)
                    new_runs += 1
                data = json_file(target)
                if (data["seed"], data["scenario"], data["policy"]) != (seed, scenario, policy):
                    raise ValueError("Cached run does not match its expected position")
                # Compare the complete Rust-emitted config, not Python's TOML key order.
                if data["config"] != config:
                    raise ValueError("Cached run config differs")
                progress["runs"].append({"path": "runs/" + name, "sha256": sha(target),
                                         "run_fingerprint": data["fingerprint"]})
                progress["completed_runs"] += 1
                checkpoint(folder, progress)
                print(f"{progress['completed_runs']}/{identity['expected_runs']} {seed} {scenario} {policy}", flush=True)
    with tempfile.TemporaryDirectory(prefix="exports-", dir=folder) as stage:
        stage = Path(stage)
        campaign = stage / "campaign.json"
        execute(binary, "economy-campaign", config_path, campaign, timeout=args.timeout)
        summary = json_file(campaign)
        if [r["run_fingerprint"] for r in summary["runs"]] != [r["run_fingerprint"] for r in progress["runs"]]:
            raise ValueError("Campaign regeneration differs from checkpointed runs")
        for command, name in [("economy-csv", "campaign.csv"), ("economy-viewer", "campaign.html")]:
            execute(binary, command, campaign, stage / name, timeout=args.timeout)
        for name in ["campaign.json", "campaign.csv", "campaign.html"]:
            publish(stage / name, folder / name, args.resume)
            progress["exports"].append({"path": name, "sha256": sha(folder / name),
                                        "bytes": (folder / name).stat().st_size})
        progress["campaign_fingerprint"] = summary["fingerprint"]
    progress["state"] = "COMPLETE"
    checkpoint(folder, progress)
    print(json.dumps({"state": "COMPLETE", "completed_runs": progress["completed_runs"], "campaign_fingerprint": progress["campaign_fingerprint"]}))
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, RuntimeError, OSError, subprocess.TimeoutExpired, KeyError) as error:
        print(f"Campaign stopped without a completion claim: {error}", file=sys.stderr)
        raise SystemExit(1)
