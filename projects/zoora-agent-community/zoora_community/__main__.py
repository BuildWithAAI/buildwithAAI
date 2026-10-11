"""Reproducible local setup, requests, audit and consistent backups."""

import argparse
from pathlib import Path
import sys
import sqlite3

from .client import Client, read_credential
from .server import serve
from .store import Store, exclusive_file
from .validation import Problem, canonical, parse_json


def main():
    parser = argparse.ArgumentParser(description="Zoora community: LOCAL_ONLY; no wallet execution")
    commands = parser.add_subparsers(dest="command", required=True)
    initialize = commands.add_parser("init")
    initialize.add_argument("--state", required=True)
    initialize.add_argument("--owner-file", required=True)
    run = commands.add_parser("serve")
    run.add_argument("--state", required=True)
    run.add_argument("--port", type=int, default=8765)
    audit = commands.add_parser("audit")
    audit.add_argument("--state", required=True)
    backup = commands.add_parser("backup")
    backup.add_argument("--state", required=True)
    backup.add_argument("--out", required=True)
    recovery = commands.add_parser("recover-owner")
    recovery.add_argument("--state", required=True)
    recovery.add_argument("--owner-file", required=True)
    request = commands.add_parser("request")
    request.add_argument("method", choices=("GET", "POST", "PATCH"))
    request.add_argument("path")
    request.add_argument("--port", type=int, default=8765)
    request.add_argument("--credential-file")
    request.add_argument("--body-file")
    request.add_argument("--save-credential")
    args = parser.parse_args()
    try:
        if args.command == "init":
            Store.initialize(args.state, args.owner_file)
            print(canonical({"initialized": True, "mode": "LOCAL_ONLY"}))
        elif args.command == "serve":
            if not 0 <= args.port <= 65535:
                raise Problem(400, "INVALID_PORT")
            serve(args.state, args.port)
        elif args.command == "audit":
            print(canonical(Store(args.state).audit()))
        elif args.command == "backup":
            Store(args.state).backup(args.out)
            print(canonical({"backup_created": True, "includes_credential_digests": True}))
        elif args.command == "recover-owner":
            Store(args.state).recover_owner(args.owner_file)
            print(canonical({"owner_recovered": True, "old_owner_credentials_revoked": True}))
        else:
            client = Client(args.port)
            token = read_credential(args.credential_file) if args.credential_file else None
            body = None
            if args.body_file:
                path = Path(args.body_file)
                if path.is_symlink() or not path.is_file():
                    raise Problem(400, "INVALID_BODY_FILE")
                with path.open("rb") as source:
                    body = parse_json(source.read(16385))
            if args.method != "GET" and body is None:
                body = {}
            issues_credential = (args.method == "POST" and
                                 (args.path in ("/v1/operators", "/v1/agents", "/v1/credentials/rotate")
                                  or args.path.endswith("/credentials")))
            if issues_credential != bool(args.save_credential):
                raise Problem(400, "CREDENTIAL_OUTPUT_REQUIRED" if issues_credential else "UNEXPECTED_CREDENTIAL_OUTPUT")
            output = None
            try:
                if args.save_credential:
                    output = exclusive_file(args.save_credential)
                status, result = client.request(args.method, args.path, body, token)
                if output is not None:
                    issued = result.pop("credential")
                    output.write((canonical(issued) + "\n").encode("utf-8"))
                    output.flush()
                    import os
                    os.fsync(output.fileno())
                    output.close()
                    output = None
                    result["credential_saved"] = True
                print(canonical({"status": status, "result": result}))
            except BaseException:
                if output is not None:
                    output.close()
                    Path(args.save_credential).unlink(missing_ok=True)
                raise
    except Problem as problem:
        print(canonical({"error": problem.code}), file=sys.stderr)
        return 1
    except (OSError, ValueError, KeyError, sqlite3.Error):
        print(canonical({"error": "LOCAL_OPERATION_FAILED"}), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
