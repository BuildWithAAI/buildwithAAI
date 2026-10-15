"""Explicit local snapshot export and pinned AE-018 research-engine bridge.

No service-side subprocess, work admission, networked worker or wallet execution
is added. Only the export subcommand contacts the authenticated loopback API.
"""

import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile

from .client import Client, read_credential
from .research_identity import MAX_SNAPSHOT_BYTES, fingerprint, verify_snapshot
from .store import exclusive_file
from .validation import DIGEST, Problem, canonical, fields, matching, parse_json

MODEL = "zoora-identity-bound-owner-research/0.1.0"
CLASSIFICATION = "SYNTHETIC_RESEARCH_WITH_LOCAL_ENROLLMENT_EVIDENCE"
BUNDLE_DOMAIN = b"ZOORA_AE019_IDENTITY_BOUND_RUN_V1\0"
INPUT_DOMAIN = b"ZOORA_AE019_OWNER_INPUT_V1\0"
MAX_REPORT = 128 * 1024 * 1024


def read_bytes(filename, maximum):
    path = Path(filename).absolute()
    try:
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= maximum:
            raise Problem(400, "UNSAFE_RESEARCH_INPUT")
        with path.open("rb") as f:
            raw = f.read(maximum + 1)
    except OSError:
        raise Problem(400, "RESEARCH_INPUT_UNAVAILABLE") from None
    if len(raw) > maximum:
        raise Problem(413, "RESEARCH_INPUT_TOO_LARGE")
    return raw


def read_json(filename, maximum):
    return parse_json(read_bytes(filename, maximum), maximum)


def publish(filename, value, maximum=MAX_REPORT):
    # Retain native struct field order so the earlier independent hash auditor
    # can consume the nested report without changing its declared encoding.
    raw = (
        json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n"
    ).encode("utf-8")
    if len(raw) > maximum:
        raise Problem(413, "RESEARCH_OUTPUT_TOO_LARGE")
    try:
        with exclusive_file(Path(filename)) as f:
            f.write(raw)
            f.flush()
            os.fsync(f.fileno())
    except OSError:
        raise Problem(409, "RESEARCH_OUTPUT_REQUIRES_NEW_FILE") from None


def bind_input(snapshot, value, *, replace=False):
    mapping = verify_snapshot(snapshot)
    fields(value, ("config", "policy", "actions"))
    if type(value["actions"]) is not list or len(value["actions"]) > 2048:
        raise Problem(400, "INVALID_RESEARCH_ACTIONS")
    if type(value["policy"]) is not str or value["policy"] not in {
        "AGENT_ONLY",
        "OWNER_COUNT",
        "OWNER_RISK",
    }:
        raise Problem(400, "INVALID_RESEARCH_POLICY")
    try:
        current = value["config"]["recovery"]["trust"]["operators"]
    except (KeyError, TypeError):
        raise Problem(400, "INVALID_RESEARCH_CONFIG") from None
    result = copy.deepcopy(value)
    if replace:
        result["config"]["recovery"]["trust"]["operators"] = mapping
    elif (
        type(current) is not list or any(type(v) is not int for v in current) or current != mapping
    ):
        raise Problem(409, "RESEARCH_INPUT_OWNER_MAPPING_MISMATCH")
    return result


def engine_path(filename, expected):
    matching(expected, DIGEST, "INVALID_ENGINE_FINGERPRINT")
    path = Path(filename).absolute()
    actual = hashlib.sha256(read_bytes(path, 256 * 1024 * 1024)).hexdigest()
    if actual != expected:
        raise Problem(409, "RESEARCH_ENGINE_PIN_MISMATCH")
    return path


def invoke(engine, *args):
    try:
        result = subprocess.run(
            [str(engine), *map(str, args)],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=120,
        )
    except subprocess.TimeoutExpired:
        raise Problem(504, "RESEARCH_ENGINE_TIMEOUT") from None
    except OSError:
        raise Problem(503, "RESEARCH_ENGINE_UNAVAILABLE") from None
    if result.returncode != 0:
        raise Problem(409, "RESEARCH_ENGINE_REJECTED")


def check_run(engine, run, value, folder):
    if (
        run.get("schema_version") != 1
        or run.get("model") != "zoora-owner-risk-run/0.1.0"
        or run.get("classification") != "SYNTHETIC"
        or run.get("input") != value
    ):
        raise Problem(409, "RESEARCH_ENGINE_REPORT_MISMATCH")
    path = folder / "replay.json"
    publish(path, run)
    invoke(engine, "replay-owner", path)


def run_research(snapshot, value, engine, engine_sha256):
    value = bind_input(snapshot, value)
    with tempfile.TemporaryDirectory(prefix="zoora-owner-research-") as name:
        folder = Path(name)
        source, output = folder / "input.json", folder / "run.json"
        publish(source, value, 4 * 1024 * 1024)
        invoke(engine, "owner-run", source, output)
        run = read_json(output, MAX_REPORT)
        check_run(engine, run, value, folder)
    bundle = dict(
        schema_version=1,
        model=MODEL,
        classification=CLASSIFICATION,
        snapshot=snapshot,
        input_sha256=hashlib.sha256(INPUT_DOMAIN + canonical(value).encode("utf-8")).hexdigest(),
        engine_sha256=engine_sha256,
        run=run,
    )
    bundle["fingerprint"] = fingerprint(bundle, BUNDLE_DOMAIN)
    return bundle


def replay_bundle(bundle, expected_snapshot, engine, expected_engine, expected_bundle):
    fields(
        bundle,
        (
            "schema_version",
            "model",
            "classification",
            "snapshot",
            "input_sha256",
            "engine_sha256",
            "run",
            "fingerprint",
        ),
    )
    if (
        type(bundle["schema_version"]) is not int
        or bundle["schema_version"] != 1
        or bundle["model"] != MODEL
        or bundle["classification"] != CLASSIFICATION
        or bundle["fingerprint"] != fingerprint(bundle, BUNDLE_DOMAIN)
    ):
        raise Problem(409, "RESEARCH_BUNDLE_MISMATCH")
    matching(bundle["engine_sha256"], DIGEST, "INVALID_ENGINE_FINGERPRINT")
    matching(expected_engine, DIGEST, "INVALID_ENGINE_FINGERPRINT")
    matching(expected_bundle, DIGEST, "INVALID_RESEARCH_FINGERPRINT")
    if bundle["fingerprint"] != expected_bundle:
        raise Problem(409, "RESEARCH_BUNDLE_PIN_MISMATCH")
    verify_snapshot(bundle["snapshot"], expected_snapshot)
    run = bundle["run"]
    if type(run) is not dict or type(run.get("input")) is not dict:
        raise Problem(400, "INVALID_RESEARCH_RUN")
    value = bind_input(bundle["snapshot"], run["input"])
    digest = hashlib.sha256(INPUT_DOMAIN + canonical(value).encode("utf-8")).hexdigest()
    if digest != bundle["input_sha256"]:
        raise Problem(409, "RESEARCH_INPUT_HASH_MISMATCH")
    with tempfile.TemporaryDirectory(prefix="zoora-owner-replay-") as name:
        check_run(engine, run, value, Path(name))


def execute(args):
    if args.command == "export":
        selection = read_json(args.selection_file, 16_384)
        snapshot = Client(args.port).request(
            "POST",
            "/v1/research/ownership-snapshots",
            selection,
            read_credential(args.credential_file),
        )[1]
        verify_snapshot(snapshot)
        publish(args.out, snapshot, MAX_SNAPSHOT_BYTES)
        return dict(
            classification=snapshot["classification"],
            snapshot_fingerprint=snapshot["fingerprint"],
            agents=len(snapshot["agents"]),
            saved=True,
        )
    if args.command == "replay":
        engine = engine_path(args.engine, args.engine_sha256)
        bundle = read_json(args.bundle_file, MAX_REPORT)
        replay_bundle(
            bundle, args.snapshot_fingerprint, engine, args.engine_sha256, args.bundle_fingerprint
        )
        return dict(
            classification=CLASSIFICATION,
            replayed=True,
            fingerprint=bundle["fingerprint"],
            replay_engine_sha256=args.engine_sha256,
        )
    snapshot = read_json(args.snapshot_file, MAX_SNAPSHOT_BYTES)
    verify_snapshot(snapshot, args.snapshot_fingerprint)
    value = read_json(args.input_file, 4 * 1024 * 1024)
    if args.command == "bind":
        publish(args.out, bind_input(snapshot, value, replace=True), 4 * 1024 * 1024)
        return dict(classification="SYNTHETIC_INPUT_BOUND_TO_LOCAL_SNAPSHOT", saved=True)
    engine = engine_path(args.engine, args.engine_sha256)
    bundle = run_research(snapshot, value, engine, args.engine_sha256)
    publish(args.out, bundle)
    return dict(classification=CLASSIFICATION, fingerprint=bundle["fingerprint"], saved=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    export = sub.add_parser("export")
    export.add_argument("--port", type=int, default=8765)
    export.add_argument("--credential-file", required=True)
    export.add_argument("--selection-file", required=True)
    export.add_argument("--out", required=True)
    for mode in ["bind", "run", "replay"]:
        p = sub.add_parser(mode)
        p.add_argument("--snapshot-fingerprint", required=True)
        if mode == "replay":
            p.add_argument("--bundle-file", required=True)
            p.add_argument("--bundle-fingerprint", required=True)
        else:
            p.add_argument("--snapshot-file", required=True)
            p.add_argument("--input-file", required=True)
            p.add_argument("--out", required=True)
        if mode != "bind":
            p.add_argument("--engine", required=True)
            p.add_argument("--engine-sha256", required=True)
    try:
        result = execute(parser.parse_args())
    except Problem as error:
        print(canonical(dict(error=error.code)), file=sys.stderr)
        return 1
    print(canonical(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
