"""Reproducible local setup, requests, audit and consistent backups."""

import argparse
from pathlib import Path
import sys
import sqlite3

from .client import Client, read_credential
from .agent_runner import run_agent
from .job_worker import work_jobs
from .pilot_preflight import pilot_preflight
from .pilot_session import pilot_session
from .pilot_review import pilot_review
from .operations import doctor, monitor
from .recovery import restore_backup, verify_backup
from .server import serve
from .store import Store, exclusive_file, private_regular
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
    run.add_argument("--transport", choices=("waitress", "development"), default="waitress")
    run.add_argument("--solana-rpc", action="store_true", help="Enable fixed-endpoint read-only RPC; no signing")
    audit = commands.add_parser("audit")
    audit.add_argument("--state", required=True)
    backup = commands.add_parser("backup")
    backup.add_argument("--state", required=True)
    backup.add_argument("--out", required=True)
    verify = commands.add_parser("verify-backup")
    verify.add_argument("--backup", required=True)
    restore = commands.add_parser("restore")
    restore.add_argument("--backup", required=True)
    restore.add_argument("--state", required=True, help="New private directory; never reuse an existing state")
    check = commands.add_parser("doctor")
    check.add_argument("--state", required=True)
    polling = commands.add_parser("monitor")
    polling.add_argument("--state", required=True)
    polling.add_argument("--port", type=int, default=8765)
    polling.add_argument("--credential-file", required=True)
    polling.add_argument("--samples", type=int, default=1)
    polling.add_argument("--interval", type=float, default=1.0)
    polling.add_argument("--out")
    recovery = commands.add_parser("recover-owner")
    recovery.add_argument("--state", required=True)
    recovery.add_argument("--owner-file", required=True)
    recovery.add_argument("--invalidate-all-credentials", action="store_true", help="Revoke all previous API credentials after a sensitive restore")
    migration = commands.add_parser("migrate")
    migration.add_argument("--state", required=True)
    migration.add_argument("--backup", required=True, help="New exclusive older-schema backup file; stop the old server/workers first")
    agent_run = commands.add_parser("run-agent", help="One bounded task through an already installed local Ollama model")
    agent_run.add_argument("--credential-file", required=True)
    agent_run.add_argument("--task-file", required=True)
    agent_run.add_argument("--out", required=True)
    agent_run.add_argument("--model", required=True)
    agent_run.add_argument("--port", type=int, default=8765)
    agent_run.add_argument("--model-port", type=int, default=11434)
    agent_run.add_argument("--max-steps", type=int, default=4)
    agent_run.add_argument("--timeout", type=int, default=60)
    agent_run.add_argument("--project", help="Explicitly declare the completed report digest in this project")
    worker = commands.add_parser("work-jobs", help="Bounded session: claim private tasks and use an installed local model")
    worker.add_argument("--credential-file", required=True)
    worker.add_argument("--out-dir", required=True)
    worker.add_argument("--model", required=True)
    worker.add_argument("--port", type=int, default=8765)
    worker.add_argument("--model-port", type=int, default=11434)
    worker.add_argument("--max-steps", type=int, default=4)
    worker.add_argument("--timeout", type=int, default=60)
    worker.add_argument("--max-jobs", type=int, default=1)
    worker.add_argument("--wait-seconds", type=int, default=0)
    for target in (agent_run, worker):
        target.add_argument("--community-origin", help="Exact operator-selected HTTPS community origin; local model stays on this PC")
        target.add_argument("--expected-instance", help="Trusted instance ID; required with --community-origin")
        target.add_argument("--expected-agent", help="This host's enrolled agent ID; required with --community-origin")
        target.add_argument("--collaboration-project", help="Explicit project scope; enables bounded internal discussion tools")
        target.add_argument("--payment-state", type=Path, help="Explicit private sandbox purchase queue")
        target.add_argument("--sandbox-key-file", type=Path, help="Private sk-test credential; never exposed to the model")
        target.add_argument("--payment-scope-file", type=Path, help="Private host-selected order allowlist and run limits")
    preflight = commands.add_parser("pilot-preflight", help="Read-only checks before a supervised private pilot session")
    preflight.add_argument("--community-origin", required=True)
    preflight.add_argument("--expected-instance", required=True, help="Instance ID obtained from the administering host")
    preflight.add_argument("--expected-agent", required=True, help="This computer's enrolled agent ID")
    preflight.add_argument("--credential-file", required=True)
    preflight.add_argument("--collaboration-project", required=True)
    preflight.add_argument("--model", required=True)
    preflight.add_argument("--model-port", type=int, default=11434)
    preflight.add_argument("--out", required=True, help="New private redacted result; existing files are refused")
    session = commands.add_parser("pilot-session", help="Preflight then one bounded worker session with a private progress journal")
    session.add_argument("--community-origin", required=True)
    session.add_argument("--expected-instance", required=True)
    session.add_argument("--expected-agent", required=True)
    session.add_argument("--credential-file", required=True)
    session.add_argument("--collaboration-project", required=True)
    session.add_argument("--model", required=True)
    session.add_argument("--model-port", type=int, default=11434)
    session.add_argument("--session-dir", required=True, help="New private directory; existing paths are refused")
    session.add_argument("--max-steps", type=int, default=4)
    session.add_argument("--timeout", type=int, default=60)
    session.add_argument("--max-jobs", type=int, default=1)
    session.add_argument("--wait-seconds", type=int, default=0)
    review = commands.add_parser("pilot-review", help="Read-only verification of selected past tasks against private report bytes")
    review.add_argument("--community-origin", required=True)
    review.add_argument("--expected-instance", required=True)
    review.add_argument("--expected-agent", required=True)
    review.add_argument("--credential-file", required=True)
    review.add_argument("--collaboration-project", required=True)
    review.add_argument("--reports-dir", required=True, help="Existing private directory of retained task reports")
    review.add_argument("--job-id", action="append", required=True, help="Repeat for 1–16 distinct operator-selected task IDs")
    review.add_argument("--out", required=True, help="New private result file; existing paths are refused")
    request = commands.add_parser("request")
    request.add_argument("method", choices=("GET", "POST", "PATCH"))
    request.add_argument("path")
    request.add_argument("--port", type=int, default=8765)
    request.add_argument("--community-origin", help="Exact operator-selected HTTPS community origin")
    request.add_argument("--credential-file")
    request.add_argument("--body-file")
    request.add_argument("--save-credential")
    request.add_argument("--save-invitation")
    args = parser.parse_args()
    if sys.version_info < (3, 12):
        print(canonical({"error": "PYTHON_3_12_REQUIRED"}), file=sys.stderr)
        return 1
    try:
        if args.command == "init":
            Store.initialize(args.state, args.owner_file)
            print(canonical({"initialized": True, "mode": "LOCAL_ONLY"}))
        elif args.command == "serve":
            if not 0 <= args.port <= 65535:
                raise Problem(400, "INVALID_PORT")
            serve(args.state, args.port, enable_solana=args.solana_rpc, transport=args.transport)
        elif args.command == "audit":
            print(canonical(Store(args.state).audit()))
        elif args.command == "backup":
            audit = Store(args.state).backup(args.out)
            print(canonical({"backup_created": True, "includes_credential_digests": True, "audit": audit}))
        elif args.command == "verify-backup":
            print(canonical(verify_backup(args.backup)))
        elif args.command == "restore":
            print(canonical(restore_backup(args.backup, args.state)))
        elif args.command == "doctor":
            print(canonical(doctor(args.state)))
        elif args.command == "monitor":
            print(canonical(monitor(args.state, args.port, args.credential_file,
                                    samples=args.samples, interval=args.interval, out=args.out)))
        elif args.command == "recover-owner":
            Store(args.state).recover_owner(args.owner_file, invalidate_all=args.invalidate_all_credentials)
            print(canonical({"owner_recovered": True, "old_owner_credentials_revoked": True,
                             "all_previous_credentials_revoked": args.invalidate_all_credentials}))
        elif args.command == "migrate":
            store = Store.migrate(args.state, args.backup)
            print(canonical({"migrated": True, "schema_version": store.schema_version,
                             "legacy_wallets": "DECLARED_UNVERIFIED", "backup_created": True}))
        elif args.command == "run-agent":
            print(canonical(run_agent(args.credential_file, args.task_file, args.out,
                                     model=args.model, port=args.port, model_port=args.model_port,
                                     max_steps=args.max_steps, timeout=args.timeout, project_id=args.project,
                                     payment_state=args.payment_state, sandbox_key_file=args.sandbox_key_file,
                                     payment_scope_file=args.payment_scope_file, community_origin=args.community_origin,
                                     collaboration_project=args.collaboration_project,
                                     expected_instance=args.expected_instance, expected_agent=args.expected_agent)))
        elif args.command == "work-jobs":
            print(canonical(work_jobs(args.credential_file, args.out_dir, model=args.model,
                                     port=args.port, model_port=args.model_port, max_steps=args.max_steps,
                                     timeout=args.timeout, max_jobs=args.max_jobs, wait_seconds=args.wait_seconds,
                                     payment_state=args.payment_state, sandbox_key_file=args.sandbox_key_file,
                                     payment_scope_file=args.payment_scope_file, community_origin=args.community_origin,
                                     collaboration_project=args.collaboration_project,
                                     expected_instance=args.expected_instance, expected_agent=args.expected_agent)))
        elif args.command == "pilot-preflight":
            print(canonical(pilot_preflight(args.credential_file, args.out,
                                           community_origin=args.community_origin,
                                           expected_instance=args.expected_instance, expected_agent=args.expected_agent,
                                           collaboration_project=args.collaboration_project,
                                           model=args.model, model_port=args.model_port)))
        elif args.command == "pilot-session":
            print(canonical(pilot_session(args.credential_file, args.session_dir,
                                         community_origin=args.community_origin,
                                         expected_instance=args.expected_instance, expected_agent=args.expected_agent,
                                         collaboration_project=args.collaboration_project,
                                         model=args.model, model_port=args.model_port, max_steps=args.max_steps,
                                         timeout=args.timeout, max_jobs=args.max_jobs, wait_seconds=args.wait_seconds)))
        elif args.command == "pilot-review":
            result = pilot_review(args.credential_file, args.reports_dir, args.out,
                                  community_origin=args.community_origin,
                                  expected_instance=args.expected_instance, expected_agent=args.expected_agent,
                                  collaboration_project=args.collaboration_project, job_ids=args.job_id)
            print(canonical(result))
            return 0 if result["state"] == "SELECTED_TASKS_CONFIRMED" else 1
        else:
            client = Client(args.port, origin=args.community_origin)
            token = read_credential(args.credential_file) if args.credential_file else None
            body = None
            if args.body_file:
                path = Path(args.body_file)
                if args.path == "/v1/invitations/claim":
                    private_regular(path, 16384)
                if path.is_symlink() or not path.is_file():
                    raise Problem(400, "INVALID_BODY_FILE")
                with path.open("rb") as source:
                    body = parse_json(source.read(16385))
            if args.method != "GET" and body is None:
                body = {}
            issues_credential = (args.method == "POST" and
                                 (args.path in ("/v1/operators", "/v1/agents", "/v1/credentials/rotate", "/v1/invitations/claim")
                                  or args.path.endswith("/credentials")))
            if issues_credential != bool(args.save_credential):
                raise Problem(400, "CREDENTIAL_OUTPUT_REQUIRED" if issues_credential else "UNEXPECTED_CREDENTIAL_OUTPUT")
            issues_invitation = args.method == "POST" and args.path == "/v1/invitations"
            if issues_invitation != bool(args.save_invitation):
                raise Problem(400, "INVITATION_OUTPUT_REQUIRED" if issues_invitation else "UNEXPECTED_INVITATION_OUTPUT")
            output = None
            try:
                if args.save_credential or args.save_invitation:
                    output = exclusive_file(args.save_credential or args.save_invitation)
                status, result = client.request(args.method, args.path, body, token)
                if output is not None:
                    issued = result.pop("credential" if args.save_credential else "secret")
                    if issued is None:
                        raise Problem(409, "INVITATION_SECRET_UNAVAILABLE")
                    output.write((canonical(issued) + "\n").encode("utf-8"))
                    output.flush()
                    import os
                    os.fsync(output.fileno())
                    output.close()
                    output = None
                    result["credential_saved" if args.save_credential else "invitation_saved"] = True
                print(canonical({"status": status, "result": result}))
            except BaseException:
                if output is not None:
                    output.close()
                    Path(args.save_credential or args.save_invitation).unlink(missing_ok=True)
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
