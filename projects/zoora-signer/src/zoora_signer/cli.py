"""Owner CLI. Prints no secrets."""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from zoora_signer.constants import RPC_PROVIDER_NAME, VET_BUDGET_S
from zoora_signer.killswitch import AgentGuardKill, kill_root
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
    is_stub = True

    def quote(self, now_ms: int) -> OracleReading:
        return OracleReading(False, "ORACLE_DOWN", 0, 0, 0, 0)


class _NoMarks:
    is_stub = True

    def mark_cents(self, mint: str, tokens: int, cost_cents: int, recovered_cents: int) -> int | None:
        return None


class _Chain:
    is_stub = True
    authoritative = False

    def sol_lamports(self) -> int:
        return 0

    def signature_status(self, signature: str) -> str:
        return "absent"

    def fee_bps(self) -> int | None:
        return None


def _live_readers(rpc_url: str, clock: Clock, owner: str | None) -> tuple[Oracle, MarkSource, ChainView]:
    import httpx

    from zoora_signer.oracle import ChainJupiterOracle, JupiterPrice, OnchainPyth
    from zoora_signer.rpc import HeliusRpc

    rpc = HeliusRpc(lambda: rpc_url, clock)
    oracle: Oracle = ChainJupiterOracle(OnchainPyth(rpc), JupiterPrice(httpx.Client()))
    return oracle, _RpcMarks(rpc, oracle, clock), _RpcChain(rpc, owner)


class _RpcChain:
    is_stub = False
    authoritative = True

    def __init__(self, rpc: object, owner: str | None) -> None:
        self._rpc = rpc
        self._owner = owner

    def sol_lamports(self) -> int:
        """Finalized SOL balance of the owner. Raises when the RPC result is unusable."""

        if not isinstance(self._owner, str) or not self._owner:
            raise RuntimeError("BALANCE_UNAVAILABLE")
        result = self._rpc.call("getBalance", [self._owner, {"commitment": "finalized"}])  # type: ignore[attr-defined]
        if not result.ok or not isinstance(result.value, dict):
            raise RuntimeError("BALANCE_UNAVAILABLE")
        value = result.value.get("value")
        if type(value) is not int or value < 0:
            raise RuntimeError("BALANCE_UNAVAILABLE")
        return value

    def signature_status(self, signature: str) -> str:
        result = self._rpc.call("getSignatureStatuses", [[signature]])  # type: ignore[attr-defined]
        if not result.ok or not isinstance(result.value, dict):
            return "unknown"
        value = result.value.get("value")
        if not isinstance(value, list) or not value or value[0] is None:
            return "absent"
        status = value[0]
        if isinstance(status, dict) and status.get("err") is None and status.get("confirmationStatus") in {
            "confirmed",
            "finalized",
        }:
            return "confirmed"
        return "unknown"

    def fee_bps(self) -> int | None:
        return None

    def rent_exemption(self, data_len: int) -> int | None:
        result = self._rpc.call("getMinimumBalanceForRentExemption", [data_len])  # type: ignore[attr-defined]
        if not result.ok or type(result.value) is not int or result.value <= 0:
            return None
        return int(result.value)

    def account_info(self, address: str) -> tuple[bool, int, int, str, bytes] | None:
        result = self._rpc.call("getAccountInfo", [address, {"encoding": "base64"}])  # type: ignore[attr-defined]
        if not result.ok or not isinstance(result.value, dict):
            return None
        value = result.value.get("value")
        if value is None:
            return (False, 0, 0, "", b"")
        if not isinstance(value, dict) or type(value.get("lamports")) is not int:
            return None
        import base64

        data = value.get("data")
        owner = value.get("owner")
        if not isinstance(owner, str):
            return None
        if not isinstance(data, list) or len(data) < 2 or data[1] != "base64":
            return None
        try:
            raw = base64.b64decode(str(data[0]), validate=True)
        except ValueError:
            return None
        return (True, int(value["lamports"]), len(raw), owner, raw)


class _RpcMarks:
    is_stub = False

    def __init__(self, rpc: object, oracle: Oracle, clock: Clock) -> None:
        self._rpc = rpc
        self._oracle = oracle
        self._clock = clock

    def mark_cents(self, mint: str, tokens: int, cost_cents: int, recovered_cents: int) -> int | None:
        del cost_cents, recovered_cents
        import base64

        from solders.pubkey import Pubkey

        from zoora_signer.constants import PUMP_PROGRAM
        from zoora_signer.models import sol_usd_cents
        from zoora_signer.quote import decode_bonding_curve, sol_for_tokens
        from zoora_signer.txbuild import _pda

        reading = self._oracle.quote(self._clock.now_ms())
        if not reading.ok:
            return None
        curve = _pda([b"bonding-curve", bytes(Pubkey.from_string(mint))], Pubkey.from_string(PUMP_PROGRAM))
        fetched = self._rpc.call("getAccountInfo", [str(curve), {"encoding": "base64"}])  # type: ignore[attr-defined]
        if not fetched.ok or not isinstance(fetched.value, dict):
            return None
        value = fetched.value.get("value")
        if not isinstance(value, dict):
            return None
        data = value.get("data")
        if not isinstance(data, list) or not data:
            return None
        try:
            raw = base64.b64decode(str(data[0]))
        except ValueError:
            return None
        parsed = decode_bonding_curve(raw)
        if parsed is None:
            return None
        lamports = sol_for_tokens(tokens, int(parsed["virtual_quote"]), int(parsed["virtual_token"]))
        if lamports <= 0:
            return None
        return lamports * sol_usd_cents(reading) // 1_000_000_000


def _helius_url(url: str, *, live: bool = False) -> bool:
    from zoora_signer.rpc import rpc_host_allowed

    return rpc_host_allowed(url, live=live)


def _acl_paths(db: Path, hud: Path, rpc_env: Path | None, kill_dir: Path | None = None) -> list[str]:
    paths = [db, db.parent, Path(str(db) + "-wal"), Path(str(db) + "-shm"), hud, hud.parent]
    if rpc_env is not None:
        paths.extend((rpc_env, rpc_env.parent))
    if kill_dir is not None:
        paths.append(kill_dir)
    kept = {db, db.parent, hud.parent}
    if kill_dir is not None:
        kept.add(kill_dir)
    return [str(path) for path in paths if path.exists() or path in kept]


def _probe(db: Path, hud: Path, rpc_env: Path | None, kill_dir: Path | None = None) -> OsProbe:
    if sys.platform == "win32":
        return WindowsOsProbe(_acl_paths(db, hud, rpc_env, kill_dir))
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
    try:
        owner_pubkey = secrets.wallet_pubkey()
    except Exception:
        owner_pubkey = None
    clock: Clock = _Clock()
    oracle: Oracle
    marks: MarkSource
    chain: ChainView
    if isinstance(rpc_url, str) and _helius_url(rpc_url):
        oracle, marks, chain = _live_readers(rpc_url, clock, owner_pubkey)
    else:
        oracle = _DownOracle()
        marks = _NoMarks()
        chain = _Chain()
    root = kill_root(str(args.kill_switch))
    kill: KillSwitch = AgentGuardKill(root)
    hud = Path(args.hud) if args.hud else db.with_suffix(".events.jsonl")
    rpc_env = Path(args.rpc_env_file) if args.rpc_env_file else None
    return Services(
        db_path=db,
        secrets=secrets,
        oracle=oracle,
        vet=SubprocessVet(budget_s=VET_BUDGET_S),
        clock=clock,
        chain=chain,
        marks=marks,
        kill=kill,
        probe=_probe(db, hud, rpc_env, root),
        broadcaster=RefuseBroadcaster(),
        hud_path=hud,
        provider_name=RPC_PROVIDER_NAME,
    )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="zoora-signer")
    parser.add_argument("--db", default=str(Path.home() / ".zoora-signer" / "signer.sqlite"))
    parser.add_argument("--hud", default="")
    parser.add_argument("--rpc-env-file", default="")
    parser.add_argument(
        "--kill-switch",
        default="",
        help="Agent-guard home. Defaults to AGENT_GUARD_HOME when that variable is set. "
        "The kill file is <home>/state/KILL_SWITCH. A path that is the state directory also checks <path>/KILL_SWITCH.",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("doctor")
    sub.add_parser("status")
    sub.add_parser("resume")
    sub.add_parser("halt")
    sell = sub.add_parser("sell")
    sell.add_argument("mint")
    sell.add_argument("--tokens", type=int, default=0)
    sell.add_argument("--confirm", default="")
    sub.add_parser("init-event-key")
    rekey = sub.add_parser("rekey")
    rekey.add_argument("--confirm", required=True)
    sub.add_parser("sell-all")
    deposit = sub.add_parser("expect-deposit")
    deposit.add_argument("lamports", type=int)
    deposit.add_argument("--ttl", type=int, default=3600)
    route = sub.add_parser("route-approved")
    route.add_argument("--source", required=True)
    route.add_argument("--date", required=True)
    route.add_argument("--text", required=True)
    reanchor = sub.add_parser("reanchor")
    reanchor.add_argument("--confirm", required=True)
    tampered = sub.add_parser("owner-sell-tampered")
    tampered.add_argument("mint")
    tampered.add_argument("--confirm", required=True)
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
        if not Path(args.db).is_file():
            print("status: no database", file=sys.stderr)
            return 1
        print(f"activity={signer.activity()} mode={signer.mode()} route={signer.route_approved()}")
        return 0
    signer = Signer.open(_services(args, create=True))
    if args.cmd == "resume":
        decision = signer.resume()
    elif args.cmd == "halt":
        decision = signer.halt("owner")
    elif args.cmd == "reanchor":
        decision = signer.reanchor(args.confirm)
    elif args.cmd == "owner-sell-tampered":
        decision = signer.owner_sell_after_tamper(args.mint, args.confirm)
    elif args.cmd == "unhalt":
        decision = signer.unhalt(args.confirm)
    elif args.cmd == "sell":
        amount = args.tokens if args.tokens > 0 else None
        decision = signer.owner_sell(args.mint, amount, args.confirm)
    elif args.cmd == "init-event-key":
        decision = signer.init_event_key()
        if decision.ok:
            print("event key stored")
    elif args.cmd == "rekey":
        decision = signer.rekey(args.confirm)
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
