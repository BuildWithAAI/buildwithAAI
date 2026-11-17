"""Owner CLI. Prints no secrets."""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from zoora_signer.constants import RPC_PROVIDER_NAME, VET_BUDGET_S
from zoora_signer.killswitch import AgentGuardKill
from zoora_signer.models import OracleReading
from zoora_signer.ports import ChainView, Clock, KillSwitch, MarkSource, Oracle, OsProbe
from zoora_signer.preflight import FailClosedProbe, WindowsOsProbe
from zoora_signer.secrets import KeyringSecretStore, reject_key_material_in_env
from zoora_signer.signer import RefuseBroadcaster, Services, Signer
from zoora_signer.vet import SubprocessVet


class _Clock:
    def now_ms(self) -> int:
        return time.time_ns() // 1_000_000


class _DownOracle:
    def quote(self, now_ms: int) -> OracleReading:
        return OracleReading(False, "ORACLE_DOWN", 0, 0, 0, 0)


class _NoMarks:
    def mark_cents(self, mint: str, tokens: int, cost_cents: int, recovered_cents: int) -> int | None:
        return None


class _Chain:
    authoritative = False

    def sol_lamports(self) -> int:
        return 0

    def signature_status(self, signature: str) -> str:
        return "absent"

    def fee_bps(self) -> int | None:
        return None


def _probe(db: Path, rpc_url: str | None) -> OsProbe:
    urls = (rpc_url,) if isinstance(rpc_url, str) and rpc_url.startswith("https://") else ()
    if sys.platform == "win32":
        return WindowsOsProbe([str(db), str(db.parent)], clock_urls=urls)
    return FailClosedProbe()


def _services(args: argparse.Namespace, *, create: bool) -> Services:
    db = Path(args.db)
    if create:
        db.parent.mkdir(parents=True, exist_ok=True)
    secrets = KeyringSecretStore(Path(args.rpc_env_file) if args.rpc_env_file else None)
    try:
        rpc_url = secrets.get_rpc_url()
    except Exception:
        rpc_url = None
    clock: Clock = _Clock()
    oracle: Oracle = _DownOracle()
    marks: MarkSource = _NoMarks()
    chain: ChainView = _Chain()
    kill: KillSwitch = AgentGuardKill(Path(args.kill_switch) if args.kill_switch else None)
    return Services(
        db_path=db,
        secrets=secrets,
        oracle=oracle,
        vet=SubprocessVet(budget_s=VET_BUDGET_S),
        clock=clock,
        chain=chain,
        marks=marks,
        kill=kill,
        probe=_probe(db, rpc_url),
        broadcaster=RefuseBroadcaster(),
        hud_path=Path(args.hud) if args.hud else db.with_suffix(".events.jsonl"),
        provider_name=RPC_PROVIDER_NAME,
    )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="zoora-signer")
    parser.add_argument("--db", default=str(Path.home() / ".zoora-signer" / "signer.sqlite"))
    parser.add_argument("--hud", default="")
    parser.add_argument("--rpc-env-file", default="")
    parser.add_argument("--kill-switch", default="")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("doctor")
    sub.add_parser("status")
    sub.add_parser("resume")
    sub.add_parser("halt")
    sell = sub.add_parser("sell")
    sell.add_argument("mint")
    sell.add_argument("--tokens", type=int, default=0)
    sub.add_parser("sell-all")
    deposit = sub.add_parser("expect-deposit")
    deposit.add_argument("lamports", type=int)
    deposit.add_argument("--ttl", type=int, default=3600)
    route = sub.add_parser("route-approved")
    route.add_argument("--source", required=True)
    route.add_argument("--date", required=True)
    route.add_argument("--text", required=True)
    unhalt = sub.add_parser("unhalt")
    unhalt.add_argument("--confirm", required=True)
    mode = sub.add_parser("mode")
    mode.add_argument("value", choices=("dry-run", "live"))
    white = sub.add_parser("whitelist-add")
    white.add_argument("address")
    sweep = sub.add_parser("sweep")
    sweep.add_argument("address")
    sweep.add_argument("lamports", type=int)
    sub.add_parser("rotate-hmac")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        reject_key_material_in_env()
    except Exception:
        print("refused: key material is set in the environment", file=sys.stderr)
        return 2
    if args.cmd in {"doctor", "status"}:
        signer = Signer.attach(_services(args, create=False))
        if args.cmd == "doctor":
            lines = signer.doctor_lines()
            print("\n".join(lines))
            return 0 if all(line.endswith("pass") for line in lines) else 1
        print(f"activity={signer.activity()} mode={signer.mode()} route={signer.route_approved()}")
        return 0
    signer = Signer.open(_services(args, create=True))
    if args.cmd == "resume":
        decision = signer.resume()
    elif args.cmd == "halt":
        decision = signer.halt("owner")
    elif args.cmd == "unhalt":
        decision = signer.unhalt(args.confirm)
    elif args.cmd == "sell":
        amount = args.tokens if args.tokens > 0 else None
        decision = signer.owner_sell(args.mint, amount)
    elif args.cmd == "sell-all":
        results = signer.sell_all()
        print(f"sells={len(results)}")
        return 0
    elif args.cmd == "expect-deposit":
        decision = signer.expect_deposit(args.lamports, args.ttl)
    elif args.cmd == "route-approved":
        decision = signer.set_route(args.source, args.date, args.text)
    elif args.cmd == "mode":
        decision = signer.set_mode("LIVE" if args.value == "live" else "DRY_RUN")
    elif args.cmd == "whitelist-add":
        decision = signer.whitelist_add(args.address)
    elif args.cmd == "sweep":
        decision = signer.sweep(args.address, args.lamports)
    elif args.cmd == "rotate-hmac":
        print("rotate-hmac reads the new key from the prompt, not from argv")
        import getpass

        value = getpass.getpass("new hmac: ")
        decision = signer.rotate_hmac(value.encode())
    else:
        return 2
    print(decision.code)
    return 0 if decision.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
