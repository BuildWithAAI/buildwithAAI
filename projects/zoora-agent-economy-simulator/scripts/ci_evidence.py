"""Run actual CLI smoke/scaling checks; archive machine-verifiable evidence."""
import json
import os
import platform
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
evidence = root / "target" / "validation-evidence"
evidence.mkdir(parents=True, exist_ok=True)
extension = ".exe" if os.name == "nt" else ""
name = "zoora-agent-economy-simulator" + extension

def run(profile, *args):
    result = subprocess.run([str(root / "target" / profile / name), *map(str, args)], cwd=root, check=True, text=True, capture_output=True)
    print(result.stdout.strip())

for config in ("normal", "zero-budget"):
    paths = []
    for profile in ("debug", "release"):
        output = evidence / f"{config}-{profile}.json"
        run(profile, "run", "--config", root / "configs" / f"{config}.toml", "--output", output)
        run(profile, "replay", "--input", output)
        paths.append(output)
    assert paths[0].read_bytes() == paths[1].read_bytes(), "debug/release reports differ"
run("release", "benchmark", "--output", evidence / "scaling.json")
metadata = {
    "kind": "CI_EXECUTION_EVIDENCE",
    "commit_sha": os.environ.get("SOURCE_HEAD_SHA", "UNAVAILABLE"),
    "workflow_run_id": os.environ.get("GITHUB_RUN_ID", "UNAVAILABLE"),
    "os": platform.platform(),
    "machine": platform.machine(),
    "rustc": subprocess.run(["rustc", "--version"], check=True, text=True, capture_output=True).stdout.strip(),
    "cargo": subprocess.run(["cargo", "--version"], check=True, text=True, capture_output=True).stdout.strip(),
    "debug_release_reports_equal": True,
}
(evidence / "execution.json").write_text(json.dumps(metadata, indent=2) + "\n")
print(json.dumps(metadata))
