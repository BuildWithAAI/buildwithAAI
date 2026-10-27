"""Operator CLI for an integrated, bounded sandbox purchase rehearsal."""

import argparse
from pathlib import Path
import sys

from .bridge_sandbox import BridgeSandboxClient, provider_id, read_key
from .client import Client, read_credential
from .payment_pipeline import PaymentPipeline
from . import payment_recovery
from .spending import read_json
from .store import private_regular
from .validation import Problem, canonical


def main():
    parser = argparse.ArgumentParser(description="Connected sandbox purchase queue; no live funds or wallet signing")
    parser.add_argument("--state", type=Path, required=True)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("show", "audit", "joint-audit"):
        sub.add_parser(name)
    backup = sub.add_parser("backup")
    backup.add_argument("--output", type=Path, required=True)
    for name in ("verify-backup", "restore", "migrate"):
        cmd = sub.add_parser(name)
        cmd.add_argument("--backup", type=Path, required=True)
        cmd.add_argument("--sha256", required=True)
    for name in ("init", "stage", "run-one", "run-batch", "revoke"):
        cmd = sub.add_parser(name)
        cmd.add_argument("--port", type=int, default=8765)
        cmd.add_argument("--credential-file", type=Path, required=True)
        if name == "init":
            cmd.add_argument("--mandate-file", type=Path, required=True)
        if name == "stage":
            cmd.add_argument("--request-file", type=Path, required=True)
        if name in {"run-one", "run-batch"}:
            cmd.add_argument("--key-file", type=Path, required=True)
        if name == "run-one":
            cmd.add_argument("--order-id", required=True)
        if name == "run-batch":
            cmd.add_argument("--limit", type=int, default=8)
            cmd.add_argument("--workers", type=int, default=4)
    recover = sub.add_parser("recover")
    recover.add_argument("--order-id", required=True)
    recover.add_argument("--key-file", type=Path, required=True)
    recover.add_argument("--transfer-id")
    args = parser.parse_args()
    pipeline = PaymentPipeline(args.state)
    try:
        if args.command in {"show", "audit"}:
            value = getattr(pipeline, args.command)()
        elif args.command == "joint-audit":
            value = payment_recovery.audit(pipeline)
        elif args.command == "backup":
            value = payment_recovery.create_backup(pipeline, args.output)
        elif args.command == "verify-backup":
            value = payment_recovery.verify_backup(args.backup, args.sha256)
        elif args.command in {"restore", "migrate"}:
            value = getattr(payment_recovery, "restore_backup" if args.command == "restore" else "migrate")(
                pipeline, args.backup, args.sha256)
        elif args.command == "recover":
            target = provider_id(args.transfer_id) if args.transfer_id else None
            value = pipeline.run_one(args.order_id, None, None, BridgeSandboxClient(read_key(args.key_file)),
                                     transfer_id=target, recovery_only=True)
        else:
            token, client = read_credential(args.credential_file), Client(args.port)
            if args.command == "init":
                private_regular(args.mandate_file, 16_384)
                value = pipeline.initialize(read_json(args.mandate_file, 16_384), client, token)
            elif args.command == "stage":
                value = pipeline.stage(read_json(args.request_file, 4096), client, token)
            elif args.command == "revoke":
                value = pipeline.revoke(client, token)
            elif args.command == "run-one":
                value = pipeline.run_one(args.order_id, client, token, BridgeSandboxClient(read_key(args.key_file)))
            else:
                value = pipeline.run_batch(lambda: Client(args.port), token, BridgeSandboxClient(read_key(args.key_file)),
                                           limit=args.limit, workers=args.workers)
        print(canonical(value))
        outcomes = value.get("outcomes", [value])
        return 2 if any(x.get("phase") in {"BLOCKED", "PREFLIGHT_BLOCKED", "PROVIDER_UNKNOWN", "RECONCILIATION_REQUIRED"} for x in outcomes) else 0
    except (Problem, OSError) as error:
        print(canonical({"error": error.code if isinstance(error, Problem) else "PIPELINE_LOCAL_IO_FAILED"}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
