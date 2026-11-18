"""HoSec re-check 2. Validation only: the broadcaster still refuses."""

from __future__ import annotations

import base64
import json
from pathlib import Path

import pytest
from solders.hash import Hash
from solders.keypair import Keypair
from solders.message import Message
from solders.pubkey import Pubkey
from solders.transaction import Transaction

from harness import activate, build, buy
from zoora_signer.cli import _acl_paths
from zoora_signer.constants import (
    SELL_V3_DISCRIMINATOR,
    TOKEN_2022,
    USER_VOLUME_ACCOUNT_BYTES,
    WSOL_MINT,
)
from zoora_signer.message_policy import PolicyError, _check_amounts, _check_ata, _check_derived, validate_transaction
from zoora_signer.preflight import judge_clock, parse_icacls
from zoora_signer.quote import rent_exempt_lamports
from zoora_signer.signer import STICKY_HALTS, _telegram_update
from zoora_signer.txbuild import BuildError, build_curve_buy

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = json.loads((ROOT / "fixtures" / "e2e_curve.json").read_text(encoding="utf-8"))
ORDER = FIXTURE["accounts_in_order"]
MINT = str(ORDER[1])
USER = str(ORDER[8])
CURVE = base64.b64decode(FIXTURE["accounts"][ORDER[5]]["data"])
FEE = base64.b64decode(FIXTURE["accounts"][ORDER[12]]["data"])
MINT_DATA = base64.b64decode(FIXTURE["accounts"][MINT]["data"])
LAMPORTS = int(FIXTURE["accounts"][ORDER[5]]["lamports"])


def _buy(**overrides: object):
    args: dict[str, object] = {
        "user": USER,
        "mint_address": MINT,
        "mint_data": MINT_DATA,
        "mint_owner": TOKEN_2022,
        "curve_data": CURVE,
        "fee_config_data": FEE,
        "buyback_fee_recipient": str(ORDER[13]),
        "sol_usd_cents": 100_000,
        "sol_usd_micro": 100_000 * 10_000,
        "stake_cents": 200,
        "slippage_bps": 0,
        "create_base_ata": False,
        "curve_lamports": LAMPORTS,
        "volume_exists": True,
    }
    args.update(overrides)
    return build_curve_buy(**args)  # type: ignore[arg-type]


def _arm(signer: object, services: object, *, volume: bool = True, ata: bool = True) -> dict[str, int]:
    from solders.pubkey import Pubkey

    from zoora_signer.constants import FEE_PROGRAM, PUMP_PROGRAM
    from zoora_signer.txbuild import _ata, _pda

    owner = Pubkey.from_string(str(signer._owner_pubkey()))  # type: ignore[attr-defined]
    mint = Pubkey.from_string(MINT)
    pump = Pubkey.from_string(PUMP_PROGRAM)
    base = Pubkey.from_string(TOKEN_2022)
    curve = str(_pda([b"bonding-curve", bytes(mint)], pump))
    volume_key = str(_pda([b"user_volume_accumulator", bytes(owner)], pump))
    ata_key = str(_ata(owner, base, mint))
    fee_key = str(_pda([b"fee_config", bytes(pump)], Pubkey.from_string(FEE_PROGRAM)))
    ata_data = bytearray(182)
    ata_data[0:32] = bytes(mint)
    ata_data[32:64] = bytes(owner)
    ata_data[64:72] = (1_000_000_000_000).to_bytes(8, "little")
    seen: dict[str, int] = {}
    table = {
        str(mint): (True, 1_000_000, len(MINT_DATA), TOKEN_2022, MINT_DATA),
        curve: (True, LAMPORTS, len(CURVE), PUMP_PROGRAM, CURVE),
        volume_key: (volume, 0, 137 if volume else 0, PUMP_PROGRAM if volume else "", b""),
        ata_key: (
            ata,
            2_000_000,
            len(ata_data) if ata else 0,
            TOKEN_2022 if ata else "",
            bytes(ata_data) if ata else b"",
        ),
        fee_key: (True, 1, len(FEE), FEE_PROGRAM, FEE),
    }

    def account_info(address: str) -> tuple[bool, int, int, str, bytes] | None:
        return table.get(address)  # type: ignore[return-value]

    def rent_exemption(size: int) -> int:
        seen["size"] = size
        from zoora_signer.quote import rent_exempt_lamports

        return 1 if size == 1 else rent_exempt_lamports(size)

    services.chain.account_info = account_info  # type: ignore[attr-defined]
    services.chain.rent_exemption = rent_exemption  # type: ignore[attr-defined]
    return seen


def test_owner_is_required_and_comes_from_the_public_half(tmp_path: Path) -> None:
    built = _buy()
    with pytest.raises(PolicyError, match="OWNER_REQUIRED"):
        validate_transaction(built.raw, owner=None, mint=MINT, max_all_in_lamports=built.all_in_lamports)
    signer, services = build(tmp_path)
    secret = services.secrets.signing_key
    assert secret is not None
    assert signer._owner_pubkey() == str(Pubkey.from_bytes(secret[32:]))


def test_compute_budget_is_capped_with_the_rest_of_the_all_in() -> None:
    built = _buy()
    limit = 49_000_000_000
    data = built.data[:8] + built.data[8:16] + limit.to_bytes(8, "little")
    from solders.instruction import AccountMeta, Instruction
    from solders.message import MessageV0
    from solders.signature import Signature
    from solders.transaction import VersionedTransaction

    from zoora_signer.constants import COMPUTE_BUDGET, CU_LIMIT, PRIORITY_MICRO_LAMPORTS, PUMP_PROGRAM

    payer = Pubkey.from_string(USER)
    from zoora_signer.txbuild import _CURVE_FLAGS

    metas = [
        AccountMeta(Pubkey.from_string(key), is_signer, is_writable)
        for key, (is_writable, is_signer) in zip(built.accounts, _CURVE_FLAGS, strict=True)
    ]
    ixs = [
        Instruction(Pubkey.from_string(COMPUTE_BUDGET), bytes([2]) + CU_LIMIT.to_bytes(4, "little"), []),
        Instruction(
            Pubkey.from_string(COMPUTE_BUDGET),
            bytes([3]) + PRIORITY_MICRO_LAMPORTS.to_bytes(8, "little"),
            [],
        ),
        Instruction(Pubkey.from_string(PUMP_PROGRAM), data, metas),
    ]
    message = MessageV0.try_compile(payer, ixs, [], Hash.default())
    raw = bytes(VersionedTransaction.populate(message, [Signature.default()]))
    with pytest.raises(PolicyError, match="MAX_SOL"):
        validate_transaction(
            raw,
            owner=USER,
            mint=MINT,
            max_all_in_lamports=2_000_000,
            rent_lamports=0,
        )
    price = (2**32).to_bytes(8, "little")
    ixs[1] = Instruction(Pubkey.from_string(COMPUTE_BUDGET), bytes([3]) + price, [])
    message = MessageV0.try_compile(payer, ixs, [], Hash.default())
    raw = bytes(VersionedTransaction.populate(message, [Signature.default()]))
    with pytest.raises(PolicyError, match="CU_PRICE"):
        validate_transaction(raw, owner=USER, mint=MINT, max_all_in_lamports=10**18, rent_lamports=0)


def test_sell_minimum_trailing_bytes_and_legacy_transactions() -> None:
    data = SELL_V3_DISCRIMINATOR + (5).to_bytes(8, "little") + (1).to_bytes(8, "little")
    with pytest.raises(PolicyError, match="MIN_OUT"):
        _check_amounts(data, max_all_in_lamports=None, expected_token_amount=None, expected_limit_lamports=None)
    with pytest.raises(PolicyError, match="TRAILING"):
        _check_amounts(
            data + b"\x00\x01",
            max_all_in_lamports=None,
            expected_token_amount=None,
            expected_limit_lamports=None,
        )
    payer = Keypair()
    message = Message.new_with_blockhash([], payer.pubkey(), Hash.default())
    with pytest.raises(PolicyError, match="LEGACY"):
        validate_transaction(bytes(Transaction.new_unsigned(message)), owner=str(payer.pubkey()))


def test_missing_volume_and_ata_rent_and_curve_topup_are_in_the_cap() -> None:
    present = _buy(volume_exists=True)
    missing = _buy(volume_exists=False)
    assert missing.rent_lamports - present.rent_lamports == rent_exempt_lamports(USER_VOLUME_ACCOUNT_BYTES)
    with pytest.raises(BuildError, match="RENT"):
        _buy(create_base_ata=True, ata_rent_lamports=0)
    topped = _buy(curve_lamports=0, volume_exists=True)
    assert topped.rent_lamports - present.rent_lamports == rent_exempt_lamports(len(CURVE))
    with pytest.raises(BuildError, match="CAP"):
        _buy(
            create_base_ata=True,
            ata_rent_lamports=rent_exempt_lamports(182),
            volume_exists=False,
            curve_lamports=0,
        )


def test_non_wsol_quote_mint_is_refused() -> None:
    mutated = bytearray(CURVE)
    mutated[83:115] = b"\x01" * 32
    with pytest.raises(BuildError, match="QUOTE_MINT"):
        _buy(curve_data=bytes(mutated))
    assert WSOL_MINT


def test_buy_uses_the_vetted_price_not_the_market_input(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    assert activate(signer).ok
    assert signer.set_route("https://example.invalid/permission", "2026-11-17", "written permission").ok
    assert signer.set_mode("LIVE").ok
    _arm(signer, services)

    class Market:
        def buy_inputs(self, mint: str) -> dict[str, object]:
            return {
                "mint_data": MINT_DATA,
                "mint_owner": TOKEN_2022,
                "curve_data": CURVE,
                "fee_config_data": FEE,
                "buyback": str(ORDER[13]),
                "sol_usd_cents": 1,
                "curve_lamports": 1,
                "volume_exists": False,
                "create_base_ata": False,
            }

    services.market = Market()
    from zoora_signer.signer import parse_intent

    intent = parse_intent(
        {
            "intent_id": "price",
            "issued_at_ms": services.clock.now_ms(),
            "key_id": "1",
            "max_slippage_bps": 0,
            "mint": MINT,
            "side": "buy",
            "usd_stake_micro": 2_000_000,
        }
    )
    assert intent is not None
    vetted = signer._unsigned_buy(intent, 100_000, 100_000 * 10_000)
    lied = signer._unsigned_buy(intent, 10_000, 10_000 * 10_000)
    assert vetted is not None and lied is not None
    assert vetted.limit_lamports != lied.limit_lamports
    assert vetted.accounts[8] == signer._owner_pubkey()


def test_pumpswap_is_off_the_live_allowlist_and_ata_mint_is_checked() -> None:
    with pytest.raises(PolicyError, match="ATA_MINT"):
        _check_ata(
            [
                ("a", True, True),
                ("b", False, True),
                ("a", False, False),
                ("nope", False, False),
                ("s", False, False),
                ("t", False, False),
            ],
            "a",
            "mint",
        )
    metas = [(USER, False, False)] * 17
    metas[14] = ("11111111111111111111111111111111", False, True)
    with pytest.raises(PolicyError):
        _check_derived("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", b"\x00" * 8, metas, USER, MINT)


def test_sddl_rejects_a_real_icacls_listing_and_an_extra_ace() -> None:
    owner = "S-1-5-21-100"
    captured = (
        "C:\\Users\\runner\\signer.sqlite BUILTIN\\Users:(I)(F)\n"
        "                        NT AUTHORITY\\SYSTEM:(I)(F)\n"
    )
    assert not parse_icacls(captured, owner)
    assert parse_icacls(f"O:{owner}G:S-1-5-18D:P(A;;FA;;;{owner})(A;;FR;;;SY)", owner)
    assert not parse_icacls(f"D:P(A;;FA;;;S-1-5-32-544)(A;;FA;;;{owner})(A;;FR;;;S-1-5-18)", owner)


def test_kill_status_acl_path_and_sticky_halts(tmp_path: Path) -> None:
    from zoora_signer.heartbeat import write_heartbeat
    from zoora_signer.killswitch import AgentGuardKill

    now = 1_000_000
    guard = AgentGuardKill(tmp_path, now_ms=lambda: now)
    path = write_heartbeat(tmp_path, now)
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["status"] = "killed"
    path.write_text(json.dumps(payload), encoding="utf-8")
    if __import__("os").name != "nt":
        path.chmod(0o600)
    assert guard.poll() == "killed"
    kill = tmp_path / "guard"
    kill.mkdir()
    assert str(kill) in _acl_paths(tmp_path / "signer.sqlite", tmp_path / "hud.jsonl", None, kill)
    assert {"anchor_mismatch", "hash_chain", "settle_error", "unconfirmed"} <= STICKY_HALTS


def test_kill_is_polled_again_before_the_refused_sign(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    assert activate(signer).ok
    assert signer.set_route("https://example.invalid/permission", "2026-11-17", "written permission").ok
    assert signer.set_mode("LIVE").ok
    _arm(signer, services, volume=True)

    class Market:
        def buy_inputs(self, mint: str) -> dict[str, object]:
            services.kill.state = "killed"
            return {
                "mint_data": MINT_DATA,
                "mint_owner": TOKEN_2022,
                "curve_data": CURVE,
                "fee_config_data": FEE,
                "buyback": str(ORDER[13]),
                "sol_usd_cents": 1,
                "curve_lamports": LAMPORTS,
                "volume_exists": True,
                "create_base_ata": False,
            }

    services.market = Market()
    assert buy(signer, mint=MINT).code == "KILL_HOLD"


def test_two_clock_hosts_are_required() -> None:
    assert judge_clock(1_000, [1_000, 1_100], None, ["clock.example", "clock.example"]) is None
    assert judge_clock(1_000, [1_000, 1_100], None, ["a.example", "b.example"]) == 100


def test_a_missing_anchor_halts_once_one_was_written(tmp_path: Path) -> None:
    signer, _services = build(tmp_path / "signer.sqlite")
    anchor = Path(str(signer.path) + ".anchor")
    if not anchor.is_file():
        anchor = Path(signer.path).with_suffix(".anchor")
    anchor.unlink()
    again, _services = build(tmp_path / "signer.sqlite")
    assert again.activity() == "HALTED"
    from zoora_signer.db import connect

    row = connect(again.path).execute("SELECT halt_reason FROM signer_state WHERE id = 1").fetchone()
    assert row is not None and "anchor_mismatch" in str(row["halt_reason"])


def test_readme_telegram_and_status(tmp_path: Path) -> None:
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    assert 'pip install --no-deps --no-build-isolation -e ".[dev]"' in readme
    forwarded = {
        "message": {
            "forward_origin": None,
            "text": "halt",
            "chat": {"id": 1},
            "from": {"id": 1},
        }
    }
    assert _telegram_update(forwarded)[0] == "TELEGRAM_FORWARDED"
    automatic = {
        "message": {
            "is_automatic_forward": True,
            "text": "halt",
            "chat": {"id": 1},
            "from": {"id": 1},
        }
    }
    assert _telegram_update(automatic)[0] == "TELEGRAM_FORWARDED"
    from zoora_signer.cli import main

    assert main(["--db", str(tmp_path / "missing.sqlite"), "status"]) == 1
    workflow = (ROOT.parents[1] / ".github" / "workflows" / "zoora-signer.yml").read_text(encoding="utf-8")
    assert "continue-on-error" not in workflow


def test_state_dir_and_exists_kill_switch(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from zoora_signer.heartbeat import write_heartbeat
    from zoora_signer.killswitch import AgentGuardKill, kill_root

    now = 1_000_000
    home = tmp_path / "home"
    home.mkdir()
    write_heartbeat(home, now)
    guard = AgentGuardKill(home, now_ms=lambda: now)
    assert guard.poll() == "killed"
    (home / "state").mkdir()
    assert guard.poll() == "clear"
    (home / "state").rmdir()
    (home / "state").write_text("not-a-dir", encoding="utf-8")
    assert guard.poll() == "killed"

    state = tmp_path / "state"
    state.mkdir()
    write_heartbeat(state, now)
    pointed = AgentGuardKill(state, now_ms=lambda: now)
    assert pointed.poll() == "clear"
    (state / "KILL_SWITCH").mkdir()
    assert pointed.poll() == "killed"

    monkeypatch.setenv("AGENT_GUARD_HOME", str(home))
    assert kill_root("") == home
    assert kill_root(str(state)) == state


def test_usdc_quote_buy_is_refused() -> None:
    from solders.instruction import AccountMeta, Instruction
    from solders.message import MessageV0
    from solders.pubkey import Pubkey
    from solders.signature import Signature
    from solders.transaction import VersionedTransaction

    from zoora_signer.constants import COMPUTE_BUDGET, CU_LIMIT, PRIORITY_MICRO_LAMPORTS, PUMP_PROGRAM
    from zoora_signer.txbuild import _CURVE_FLAGS

    built = _buy()
    usdc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    accounts = list(built.accounts)
    accounts[2] = usdc
    metas = [
        AccountMeta(Pubkey.from_string(key), is_signer, is_writable)
        for key, (is_writable, is_signer) in zip(accounts, _CURVE_FLAGS, strict=True)
    ]
    payer = Pubkey.from_string(USER)
    budget = Pubkey.from_string(COMPUTE_BUDGET)
    ixs = [
        Instruction(budget, bytes([2]) + CU_LIMIT.to_bytes(4, "little"), []),
        Instruction(budget, bytes([3]) + PRIORITY_MICRO_LAMPORTS.to_bytes(8, "little"), []),
        Instruction(Pubkey.from_string(PUMP_PROGRAM), built.data, metas),
    ]
    message = MessageV0.try_compile(payer, ixs, [], Hash.default())
    raw = bytes(VersionedTransaction.populate(message, [Signature.default()]))
    with pytest.raises(PolicyError, match="QUOTE_MINT"):
        validate_transaction(
            raw,
            owner=USER,
            mint=MINT,
            max_all_in_lamports=built.all_in_lamports,
            expected_token_amount=built.token_amount,
            expected_limit_lamports=built.limit_lamports,
            rent_lamports=built.rent_lamports,
        )


def test_buy_price_rounds_up_in_micro_usd() -> None:
    from zoora_signer.models import OracleReading, sol_usd_cents, sol_usd_micro
    from zoora_signer.quote import lamports_for_micro_price, micro_cost_ceil

    reading = OracleReading(True, None, 10_000_000_050, 0, 0, 10_000_000_050)
    assert sol_usd_cents(reading) == 10_000
    assert sol_usd_micro(reading) == 100_000_001
    floored = lamports_for_micro_price(2_000_000, sol_usd_cents(reading) * 10_000)
    ceiled = lamports_for_micro_price(2_000_000, sol_usd_micro(reading))
    assert floored is not None and ceiled is not None and ceiled < floored
    assert (micro_cost_ceil(floored, sol_usd_micro(reading)) or 0) > 2_000_000
    assert (micro_cost_ceil(ceiled, sol_usd_micro(reading)) or 0) <= 2_000_000


def test_sell_requires_an_expected_minimum() -> None:
    data = SELL_V3_DISCRIMINATOR + (5).to_bytes(8, "little") + (1_000).to_bytes(8, "little")
    with pytest.raises(PolicyError, match="MIN_OUT"):
        _check_amounts(data, max_all_in_lamports=None, expected_token_amount=5, expected_limit_lamports=None)
    assert (
        _check_amounts(data, max_all_in_lamports=None, expected_token_amount=5, expected_limit_lamports=1_000)
        == 1_000
    )


def test_live_volume_rent_comes_from_rpc(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    assert activate(signer).ok
    assert signer.set_route("https://example.invalid/permission", "2026-11-17", "written permission").ok
    assert signer.set_mode("LIVE").ok
    seen = _arm(signer, services, volume=False)

    class Market:
        def buy_inputs(self, mint: str) -> dict[str, object]:
            return {
                "mint_data": MINT_DATA,
                "mint_owner": TOKEN_2022,
                "curve_data": CURVE,
                "fee_config_data": FEE,
                "buyback": str(ORDER[13]),
                "curve_lamports": LAMPORTS,
                "volume_exists": False,
                "create_base_ata": False,
            }

    services.market = Market()
    from zoora_signer.signer import parse_intent

    intent = parse_intent(
        {
            "intent_id": "rent",
            "issued_at_ms": services.clock.now_ms(),
            "key_id": "1",
            "max_slippage_bps": 0,
            "mint": MINT,
            "side": "buy",
            "usd_stake_micro": 2_000_000,
        }
    )
    assert intent is not None
    micro = 10_000 * 10_000
    built = signer._unsigned_buy(intent, 10_000, micro)
    assert built is not None
    assert seen["size"] == USER_VOLUME_ACCOUNT_BYTES == 137
    from zoora_signer.quote import rent_exempt_lamports

    assert built.rent_lamports == rent_exempt_lamports(USER_VOLUME_ACCOUNT_BYTES)
    services.chain.rent_exemption = None  # type: ignore[attr-defined]
    assert signer._unsigned_buy(intent, 10_000, micro) is None


def test_market_rent_claims_are_not_trusted(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    assert activate(signer).ok
    assert signer.set_route("https://example.invalid/permission", "2026-11-17", "written permission").ok
    assert signer.set_mode("LIVE").ok
    _arm(signer, services, volume=False)
    from zoora_signer.signer import parse_intent

    intent = parse_intent(
        {
            "intent_id": "chain",
            "issued_at_ms": services.clock.now_ms(),
            "key_id": "1",
            "max_slippage_bps": 0,
            "mint": MINT,
            "side": "buy",
            "usd_stake_micro": 2_000_000,
        }
    )
    assert intent is not None

    class Market:
        def __init__(self, **extra: object) -> None:
            self.extra = extra

        def buy_inputs(self, mint: str) -> dict[str, object]:
            body: dict[str, object] = {
                "mint_data": MINT_DATA,
                "mint_owner": TOKEN_2022,
                "curve_data": CURVE,
                "fee_config_data": FEE,
                "buyback": str(ORDER[13]),
                "curve_lamports": 1,
                "volume_exists": True,
                "ata_rent_lamports": 1,
            }
            body.update(self.extra)
            return body

    services.market = Market()
    assert signer._unsigned_buy(intent, 10_000, 10_000 * 10_000) is None
    services.market = Market(ata_rent_lamports=0, volume_exists=False)
    built = signer._unsigned_buy(intent, 10_000, 10_000 * 10_000)
    from zoora_signer.quote import rent_exempt_lamports

    assert built is not None and built.rent_lamports == rent_exempt_lamports(USER_VOLUME_ACCOUNT_BYTES)


def test_chain_rent_outside_the_formula_is_refused(tmp_path: Path) -> None:
    from zoora_signer.quote import rent_exempt_lamports
    from zoora_signer.signer import parse_intent

    signer, services = build(tmp_path)
    assert activate(signer).ok
    assert signer.set_route("https://example.invalid/permission", "2026-11-17", "written permission").ok
    assert signer.set_mode("LIVE").ok
    _arm(signer, services, volume=False)
    formula = rent_exempt_lamports(USER_VOLUME_ACCOUNT_BYTES)

    class Market:
        def buy_inputs(self, mint: str) -> dict[str, object]:
            return {
                "mint_data": MINT_DATA,
                "mint_owner": TOKEN_2022,
                "curve_data": CURVE,
                "fee_config_data": FEE,
                "buyback": str(ORDER[13]),
                "volume_exists": False,
            }

    services.market = Market()
    intent = parse_intent(
        {
            "intent_id": "rent-band",
            "issued_at_ms": services.clock.now_ms(),
            "key_id": "1",
            "max_slippage_bps": 0,
            "mint": MINT,
            "side": "buy",
            "usd_stake_micro": 2_000_000,
        }
    )
    assert intent is not None

    def quoted(value: int) -> int:
        def rent_exemption(size: int) -> int:
            return value

        services.chain.rent_exemption = rent_exemption  # type: ignore[attr-defined]
        return value

    quoted(2)
    assert signer._rent(USER_VOLUME_ACCOUNT_BYTES) == formula
    quoted(formula * 10)
    assert signer._rent(USER_VOLUME_ACCOUNT_BYTES) is None
    assert signer._unsigned_buy(intent, 10_000, 10_000 * 10_000) is None
    services.chain.account_info = lambda _address: (False, 5, 0)  # type: ignore[attr-defined]
    quoted(formula)
    assert signer._unsigned_buy(intent, 10_000, 10_000 * 10_000) is None


def test_curve_buy_requires_the_micro_price() -> None:
    from zoora_signer.models import OracleReading, sol_usd_cents, sol_usd_micro
    from zoora_signer.quote import lamports_for_micro_price, micro_cost_ceil

    kwargs = {
        "user": USER,
        "mint_address": MINT,
        "mint_data": MINT_DATA,
        "mint_owner": TOKEN_2022,
        "curve_data": CURVE,
        "fee_config_data": FEE,
        "buyback_fee_recipient": str(ORDER[13]),
        "sol_usd_cents": 10_000,
        "stake_cents": 200,
        "slippage_bps": 0,
        "create_base_ata": False,
        "curve_lamports": LAMPORTS,
        "volume_exists": True,
    }
    with pytest.raises(TypeError):
        build_curve_buy(**kwargs)  # type: ignore[arg-type]
    reading = OracleReading(True, None, 10_000_000_050, 0, 0, 10_000_000_050)
    built = build_curve_buy(**kwargs, sol_usd_micro=sol_usd_micro(reading))  # type: ignore[arg-type]
    assert (micro_cost_ceil(built.all_in_lamports, sol_usd_micro(reading)) or 0) <= 2_000_000
    floored = lamports_for_micro_price(2_000_000, sol_usd_cents(reading) * 10_000)
    assert floored is not None
    assert (micro_cost_ceil(floored, sol_usd_micro(reading)) or 0) > 2_000_000


def test_aliases_ls_ow_and_ba_are_refused() -> None:
    owner = "S-1-5-21-9"
    base = f"(A;;FA;;;{owner})(A;;FR;;;S-1-5-18)"
    assert parse_icacls(f"D:P{base}", owner)
    for alias in ("LS", "OW", "BA"):
        assert not parse_icacls(f"D:P{base}(A;;FA;;;{alias})", owner)


def test_dangling_symlink_is_a_kill(tmp_path: Path) -> None:
    from zoora_signer.heartbeat import write_heartbeat
    from zoora_signer.killswitch import AgentGuardKill

    root = tmp_path / "home"
    root.mkdir()
    (root / "state").mkdir()
    write_heartbeat(root, 1_000)
    link = root / "state" / "KILL_SWITCH"
    link.symlink_to(root / "missing")
    assert AgentGuardKill(root, now_ms=lambda: 1_000).poll() == "killed"


def test_tail_byte_must_match_exactly() -> None:
    data = SELL_V3_DISCRIMINATOR + (5).to_bytes(8, "little") + (1_000).to_bytes(8, "little") + b"\x02"
    with pytest.raises(PolicyError, match="TRAILING"):
        _check_amounts(
            data,
            max_all_in_lamports=None,
            expected_token_amount=5,
            expected_limit_lamports=1_000,
            expected_tail=1,
        )
    assert (
        _check_amounts(
            data,
            max_all_in_lamports=None,
            expected_token_amount=5,
            expected_limit_lamports=1_000,
            expected_tail=2,
        )
        == 1_000
    )


def test_sticky_halts_need_a_chain_reconcile(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    signer.halt("settle_error")
    assert signer.unhalt("UNHALT").code == "RECONCILE_REQUIRED"
    services.chain.authoritative = True
    assert signer.unhalt("UNHALT").ok


def test_event_keeps_the_digest_from_before_the_edit(tmp_path: Path) -> None:
    from zoora_signer.db import transact
    from zoora_signer.signer import _state_digest

    signer, _services = build(tmp_path / "signer.sqlite")

    def op(conn: object) -> None:
        from sqlite3 import Connection

        db = conn if isinstance(conn, Connection) else None
        assert db is not None
        before = _state_digest(db)
        db.execute("UPDATE signer_state SET boot_id = 'edited' WHERE id = 1")
        signer._event(db, "note", {"state_sha256": before})

    transact(signer.path, op)
    assert signer.activity() == "HALTED"


def test_deleted_anchor_meta_halts_before_the_first_anchor(tmp_path: Path) -> None:
    from zoora_signer.db import connect

    signer, _services = build(tmp_path / "signer.sqlite")
    anchor = Path(signer.path).with_suffix(".anchor")
    anchor.unlink()
    conn = connect(signer.path)
    conn.execute("DELETE FROM anchor_meta")
    conn.close()
    again, _services = build(tmp_path / "signer.sqlite")
    assert again.activity() == "HALTED"


def test_foreign_event_authority_is_refused() -> None:
    built = _buy()
    metas = [(key, False, False) for key in built.accounts]
    metas[8] = (built.accounts[8], True, True)
    metas[15] = ("11111111111111111111111111111111", False, False)
    with pytest.raises(PolicyError, match="EVENT_AUTHORITY"):
        _check_derived("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", built.data, metas, USER, MINT)


def test_helius_rent_method_and_a_lying_volume_account(tmp_path: Path) -> None:
    import json as js

    import httpx

    from zoora_signer.cli import _RpcChain
    from zoora_signer.constants import FEE_PROGRAM, PUMP_PROGRAM, USER_VOLUME_ACCOUNT_BYTES
    from zoora_signer.quote import rent_exempt_lamports
    from zoora_signer.rpc import HeliusRpc
    from zoora_signer.signer import parse_intent

    formula = rent_exempt_lamports(USER_VOLUME_ACCOUNT_BYTES)
    signer, services = build(tmp_path)
    assert activate(signer).ok
    assert signer.set_route("https://example.invalid/permission", "2026-11-17", "written permission").ok
    assert signer.set_mode("LIVE").ok
    from solders.pubkey import Pubkey

    from zoora_signer.txbuild import _ata, _pda

    owner_key = Pubkey.from_string(str(signer._owner_pubkey()))
    mint_key = Pubkey.from_string(MINT)
    pump = Pubkey.from_string(PUMP_PROGRAM)
    curve = str(_pda([b"bonding-curve", bytes(mint_key)], pump))
    volume = str(_pda([b"user_volume_accumulator", bytes(owner_key)], pump))
    ata = str(_ata(owner_key, Pubkey.from_string(TOKEN_2022), mint_key))
    fee_key = str(_pda([b"fee_config", bytes(pump)], Pubkey.from_string(FEE_PROGRAM)))

    def handler(request: httpx.Request) -> httpx.Response:
        body = js.loads(request.content.decode())
        method = body["method"]
        assert method != "sendTransaction"
        if method == "getMinimumBalanceForRentExemption":
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": formula})
        if method == "getAccountInfo":
            address = body["params"][0]
            if address == curve:
                value = {
                    "lamports": LAMPORTS,
                    "owner": PUMP_PROGRAM,
                    "data": [base64.b64encode(CURVE).decode(), "base64"],
                }
            elif address == volume:
                value = {
                    "lamports": 1,
                    "owner": "11111111111111111111111111111111",
                    "data": [base64.b64encode(b"\x00" * 137).decode(), "base64"],
                }
            elif address == str(mint_key):
                value = {
                    "lamports": 1_000_000,
                    "owner": TOKEN_2022,
                    "data": [base64.b64encode(MINT_DATA).decode(), "base64"],
                }
            elif address == fee_key:
                value = {
                    "lamports": 1,
                    "owner": FEE_PROGRAM,
                    "data": [base64.b64encode(FEE).decode(), "base64"],
                }
            elif address == ata:
                ata_data = bytearray(182)
                ata_data[0:32] = bytes(mint_key)
                ata_data[32:64] = bytes(owner_key)
                value = {
                    "lamports": 2_000_000,
                    "owner": TOKEN_2022,
                    "data": [base64.b64encode(bytes(ata_data)).decode(), "base64"],
                }
            else:
                value = None
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": {"value": value}})
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "error": {"message": "no"}})

    clock = services.clock
    rpc = HeliusRpc(
        lambda: "https://mainnet.helius-rpc.com/?api-key=test",
        clock,
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    services.chain = _RpcChain(rpc, str(signer._owner_pubkey()))  # type: ignore[assignment]

    class Market:
        def buy_inputs(self, mint: str) -> dict[str, object]:
            return {
                "mint_data": MINT_DATA,
                "mint_owner": TOKEN_2022,
                "curve_data": CURVE,
                "fee_config_data": FEE,
                "buyback": str(ORDER[13]),
                "volume_exists": True,
            }

    services.market = Market()
    intent = parse_intent(
        {
            "intent_id": "lie",
            "issued_at_ms": services.clock.now_ms(),
            "key_id": "1",
            "max_slippage_bps": 0,
            "mint": MINT,
            "side": "buy",
            "usd_stake_micro": 2_000_000,
        }
    )
    assert intent is not None
    built = signer._unsigned_buy(intent, 10_000, 10_000 * 10_000)
    assert built is not None
    assert built.rent_lamports >= formula
    from zoora_signer.quote import micro_cost_ceil

    assert (micro_cost_ceil(built.all_in_lamports, 10_000 * 10_000) or 0) <= 2_000_000


def test_state_edit_before_a_buy_halts(tmp_path: Path) -> None:
    from zoora_signer.db import connect

    signer, _services = build(tmp_path)
    assert activate(signer).ok
    conn = connect(signer.path)
    conn.execute("UPDATE signer_state SET boot_id = 'edited' WHERE id = 1")
    conn.close()
    assert buy(signer).code != "FILLED"
    assert signer.activity() == "HALTED"


def test_resume_and_whitelist_do_not_stick_on_reboot(tmp_path: Path) -> None:
    from zoora_signer.db import connect

    signer, _services = build(tmp_path / "resume.sqlite")
    signer.halt("owner")
    assert signer.resume().code == "HALT_PERSISTED"
    again, _services = build(tmp_path / "resume.sqlite")
    row = connect(again.path).execute("SELECT halt_reason FROM signer_state WHERE id = 1").fetchone()
    assert row is not None and "anchor_mismatch" not in str(row["halt_reason"] or "")

    listed, _services = build(tmp_path / "white.sqlite")
    assert listed.whitelist_add("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf").ok
    back, _services = build(tmp_path / "white.sqlite")
    assert back.activity() == "PAUSED"


def test_anchor_mismatch_needs_reanchor(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    signer.halt("anchor_mismatch")
    services.chain.authoritative = True
    assert signer.unhalt("UNHALT").code == "RECONCILE_REQUIRED"
    assert signer.reanchor("REANCHOR").ok
    assert signer.unhalt("UNHALT").ok


def test_mainnet_rent_uses_5080_and_budgets_a_low_chain_value(caplog: pytest.LogCaptureFixture) -> None:
    import logging

    from zoora_signer.quote import accept_chain_rent, note_low_rent

    # Mainnet fixture slot 470726647. The local validator still exempts at 6960.
    assert rent_exempt_lamports(137) == 1_346_200
    assert rent_exempt_lamports(165) == 1_488_440
    assert rent_exempt_lamports(170) == 1_513_840
    assert rent_exempt_lamports(182) == 1_574_800
    assert rent_exempt_lamports(399) == 2_677_160
    assert rent_exempt_lamports(137) != (137 + 128) * 6_960
    assert accept_chain_rent(2, 137) == 1_346_200
    assert accept_chain_rent(1_346_200 * 10, 137) is None
    built = _buy(volume_exists=False, volume_rent_lamports=1_346_200, create_base_ata=False)
    assert built.rent_lamports >= 1_346_200
    low = _buy(volume_exists=False, volume_rent_lamports=2, create_base_ata=False)
    assert low.rent_lamports >= 1_346_200
    created = _buy(create_base_ata=True, ata_rent_lamports=2, volume_exists=True)
    assert created.rent_lamports >= 1_574_800
    with caplog.at_level(logging.WARNING, logger="zoora_signer.rent"):
        note_low_rent(2, 137, 1_346_200)
    assert "below the formula" in caplog.text


def test_reanchor_refuses_a_tampered_ledger(tmp_path: Path) -> None:
    from zoora_signer.db import connect, verify_chain

    signer, services = build(tmp_path)
    assert activate(signer).ok
    services.chain.authoritative = True
    assert signer.reanchor("no").code == "CONFIRMATION_REQUIRED"
    services.kill.state = "killed"
    assert signer.reanchor("REANCHOR").code == "KILL_HOLD"
    services.kill.state = "clear"
    key = services.secrets.get_event_hmac()
    assert key is not None and key != services.secrets.get_hmac_key()
    conn = connect(signer.path)
    assert verify_chain(conn, key)
    assert verify_chain(conn, b"z" * 32) is False
    assert key.hex().encode() not in Path(signer.path).read_bytes()
    conn.execute("UPDATE signer_state SET ledger_sol_lamports = 1000000000000 WHERE id = 1")
    conn.commit()
    conn.close()
    assert signer.reanchor("REANCHOR").code == "RECONCILE_REQUIRED"
    row = connect(signer.path).execute("SELECT ledger_sol_lamports FROM signer_state").fetchone()
    assert row is not None and int(row[0]) == 1_000_000_000_000


def test_market_reserves_do_not_change_the_chain_quote(tmp_path: Path) -> None:
    import struct

    from zoora_signer.signer import parse_intent
    from zoora_signer.txbuild import build_curve_buy, build_curve_sell

    signer, services = build(tmp_path)
    assert activate(signer).ok
    assert signer.set_route("https://example.invalid/permission", "2026-11-17", "written permission").ok
    assert signer.set_mode("LIVE").ok
    _arm(signer, services, volume=True, ata=True)
    scaled = bytearray(CURVE)
    virtual_token, virtual_quote = struct.unpack_from("<QQ", scaled, 8)
    struct.pack_into("<QQ", scaled, 8, virtual_token * 3, virtual_quote * 3)

    class Market:
        def buy_inputs(self, mint: str) -> dict[str, object]:
            return {
                "mint_data": bytes(scaled),
                "mint_owner": TOKEN_2022,
                "curve_data": bytes(scaled),
                "fee_config_data": FEE,
                "buyback": str(ORDER[13]),
                "volume_exists": True,
            }

        def sell_inputs(self, mint: str) -> dict[str, object]:
            body = self.buy_inputs(mint)
            body["token_in"] = 1_000_000
            body["slippage_bps"] = 0
            return body

    services.market = Market()
    intent = parse_intent(
        {
            "intent_id": "chain-bytes",
            "issued_at_ms": services.clock.now_ms(),
            "key_id": "1",
            "max_slippage_bps": 0,
            "mint": MINT,
            "side": "buy",
            "usd_stake_micro": 100_000,
        }
    )
    assert intent is not None
    built = signer._unsigned_buy(intent, 10_000, 10_000 * 10_000)
    direct = build_curve_buy(
        user=str(signer._owner_pubkey()),
        mint_address=MINT,
        mint_data=MINT_DATA,
        mint_owner=TOKEN_2022,
        curve_data=CURVE,
        fee_config_data=FEE,
        buyback_fee_recipient=str(ORDER[13]),
        sol_usd_cents=10_000,
        sol_usd_micro=10_000 * 10_000,
        stake_cents=10,
        slippage_bps=0,
        create_base_ata=False,
        curve_lamports=LAMPORTS,
        volume_exists=True,
    )
    lied = build_curve_buy(
        user=str(signer._owner_pubkey()),
        mint_address=MINT,
        mint_data=MINT_DATA,
        mint_owner=TOKEN_2022,
        curve_data=bytes(scaled),
        fee_config_data=FEE,
        buyback_fee_recipient=str(ORDER[13]),
        sol_usd_cents=10_000,
        sol_usd_micro=10_000 * 10_000,
        stake_cents=10,
        slippage_bps=0,
        create_base_ata=False,
        curve_lamports=LAMPORTS,
        volume_exists=True,
    )
    assert built is not None
    assert built.token_amount == direct.token_amount
    assert built.token_amount != lied.token_amount

    class Grab:
        enabled = True
        raw = b""

        def submit(self, payload: bytes) -> None:
            self.raw = payload
            raise RuntimeError("BROADCAST_DISABLED")

    grab = Grab()
    services.broadcaster = grab  # type: ignore[assignment]
    assert signer._broadcast_sell(MINT, 1_000_000_000_000).code == "BROADCASTER_NOT_ENABLED"
    sold = build_curve_sell(
        user=str(signer._owner_pubkey()),
        mint_address=MINT,
        mint_data=MINT_DATA,
        mint_owner=TOKEN_2022,
        curve_data=CURVE,
        fee_config_data=FEE,
        buyback_fee_recipient=str(ORDER[13]),
        token_in=1_000_000_000_000,
        slippage_bps=0,
    )
    lied_sell = build_curve_sell(
        user=str(signer._owner_pubkey()),
        mint_address=MINT,
        mint_data=MINT_DATA,
        mint_owner=TOKEN_2022,
        curve_data=bytes(scaled),
        fee_config_data=FEE,
        buyback_fee_recipient=str(ORDER[13]),
        token_in=1_000_000_000_000,
        slippage_bps=0,
    )
    assert grab.raw == b""
    assert signer.last_unsigned == sold.raw
    assert sold.limit_lamports != lied_sell.limit_lamports


def test_devnet_cannot_go_live(tmp_path: Path) -> None:
    from zoora_signer.rpc import rpc_host_allowed

    signer, services = build(tmp_path)
    assert activate(signer).ok
    assert signer.set_route("https://example.invalid/permission", "2026-11-17", "written permission").ok
    services.secrets.rpc_url = "https://devnet.helius-rpc.com/?api-key=test"
    assert rpc_host_allowed(services.secrets.rpc_url, live=False)
    assert not rpc_host_allowed(services.secrets.rpc_url, live=True)
    assert signer.set_mode("LIVE").code == "LIVE_HOST"
    services.secrets.rpc_url = "https://mainnet.helius-rpc.com/?api-key=test"
    assert signer.set_mode("LIVE").ok


def test_sell_all_refuses_a_tampered_database(tmp_path: Path) -> None:
    signer, _services = build(tmp_path)
    assert activate(signer).ok
    assert buy(signer).ok
    import sqlite3

    conn = sqlite3.connect(signer.path)
    conn.execute("UPDATE signer_state SET boot_id = 'edited' WHERE id = 1")
    conn.commit()
    conn.close()
    results = signer.sell_all()
    assert results and results[0].code == "ANCHOR_MISMATCH"


def test_owner_sell_after_tamper_leaves_the_ledger(tmp_path: Path) -> None:
    from zoora_signer.db import connect

    signer, services = build(tmp_path)
    assert activate(signer).ok
    assert signer.set_route("https://example.invalid/permission", "2026-11-17", "written permission").ok
    _arm(signer, services, volume=True, ata=True)
    owner = signer._owner_pubkey()
    assert owner is not None
    from solders.pubkey import Pubkey

    from zoora_signer.txbuild import _ata

    ata = str(_ata(Pubkey.from_string(owner), Pubkey.from_string(TOKEN_2022), Pubkey.from_string(MINT)))
    balance = bytearray(182)
    balance[64:72] = (1_000_000_000_000).to_bytes(8, "little")
    table = services.chain.account_info  # type: ignore[attr-defined]

    def account_info(address: str) -> tuple[bool, int, int, str, bytes] | None:
        found = table(address)
        if address == ata and found is not None:
            return (True, found[1], len(balance), TOKEN_2022, bytes(balance))
        return found

    services.chain.account_info = account_info  # type: ignore[attr-defined]

    class Market:
        def sell_inputs(self, mint: str) -> dict[str, object]:
            return {
                "mint_data": b"\x00" * 82,
                "mint_owner": "11111111111111111111111111111111",
                "curve_data": b"\x00" * 82,
                "fee_config_data": FEE,
                "buyback": str(ORDER[13]),
                "token_in": 1,
                "slippage_bps": 0,
            }

    services.market = Market()
    conn = connect(signer.path)
    conn.execute("UPDATE signer_state SET boot_id = 'edited', ledger_sol_lamports = 1000000000000 WHERE id = 1")
    conn.commit()
    before = int(conn.execute("SELECT ledger_sol_lamports FROM signer_state").fetchone()[0])
    conn.close()
    assert signer.owner_sell_after_tamper(MINT, "no").code == "CONFIRMATION_REQUIRED"
    services.kill.state = "killed"
    decision = signer.owner_sell_after_tamper(MINT, "OWNER_SELL")
    assert decision.code == "OWNER_SELL_SIMULATED"
    row = connect(signer.path).execute("SELECT ledger_sol_lamports, halt_reason FROM signer_state").fetchone()
    assert row is not None and int(row[0]) == before
    assert "anchor_mismatch" in str(row[1] or "")
    kind = connect(signer.path).execute("SELECT kind, payload FROM events ORDER BY id DESC LIMIT 1").fetchone()
    assert kind is not None and str(kind[0]) == "owner_sell"
    assert '"kill_logged":true' in str(kind[1])
    refused = signer.unhalt("UNHALT")
    assert not refused.ok
    assert signer.activity() == "HALTED"


def test_rpc_balance_and_a_zero_ledger_cannot_reanchor(tmp_path: Path) -> None:
    import json as js

    import httpx

    from zoora_signer.cli import _RpcChain
    from zoora_signer.rpc import HeliusRpc

    owner = "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf"
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        body = js.loads(request.content.decode())
        assert body["method"] == "getBalance"
        assert body["params"][1]["commitment"] == "finalized"
        seen["owner"] = body["params"][0]
        if seen.get("fail"):
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": {"value": "no"}})
        result = {"context": {"slot": 1}, "value": 5_000_000}
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": result})

    clock = type("Clock", (), {"now_ms": lambda self: 1_763_400_000_000})()
    rpc = HeliusRpc(
        lambda: "https://mainnet.helius-rpc.com/?api-key=test",
        clock,
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    chain = _RpcChain(rpc, owner)
    assert chain.sol_lamports() == 5_000_000
    seen["fail"] = True
    with pytest.raises(RuntimeError, match="BALANCE_UNAVAILABLE"):
        chain.sol_lamports()

    signer, services = build(tmp_path)
    assert activate(signer).ok
    assert buy(signer).ok
    seen["fail"] = False
    services.chain = _RpcChain(rpc, str(signer._owner_pubkey()))  # type: ignore[assignment]
    import sqlite3

    conn = sqlite3.connect(signer.path)
    conn.execute("DELETE FROM trades")
    conn.execute("DELETE FROM reservations")
    conn.execute("UPDATE signer_state SET ledger_sol_lamports = 0 WHERE id = 1")
    conn.commit()
    conn.close()
    assert signer.reanchor("REANCHOR").code == "RECONCILE_REQUIRED"


def test_forged_fee_does_not_change_min_out(tmp_path: Path) -> None:
    import struct

    signer, services = build(tmp_path)
    assert activate(signer).ok
    assert signer.set_route("https://example.invalid/permission", "2026-11-17", "written permission").ok
    assert signer.set_mode("LIVE").ok
    _arm(signer, services)
    forged = bytearray(FEE)
    struct.pack_into("<QQQ", forged, 8 + 1 + 32, 0, 9_900, 0)
    struct.pack_into("<I", forged, 8 + 1 + 32 + 24, 0)

    class Market:
        def sell_inputs(self, mint: str) -> dict[str, object]:
            return {
                "fee_config_data": bytes(forged),
                "buyback": str(ORDER[13]),
                "token_in": 9_900,
                "slippage_bps": 0,
            }

    services.market = Market()

    class Grab:
        enabled = True
        raw = b""

        def submit(self, payload: bytes) -> None:
            self.raw = payload
            raise RuntimeError("BROADCAST_DISABLED")

    grab = Grab()
    services.broadcaster = grab  # type: ignore[assignment]
    assert signer._broadcast_sell(MINT, None).code == "BROADCASTER_NOT_ENABLED"
    from zoora_signer.txbuild import build_curve_sell

    honest = build_curve_sell(
        user=str(signer._owner_pubkey()),
        mint_address=MINT,
        mint_data=MINT_DATA,
        mint_owner=TOKEN_2022,
        curve_data=CURVE,
        fee_config_data=FEE,
        buyback_fee_recipient=str(ORDER[13]),
        token_in=1_000_000_000_000,
        slippage_bps=0,
    )
    lied = build_curve_sell(
        user=str(signer._owner_pubkey()),
        mint_address=MINT,
        mint_data=MINT_DATA,
        mint_owner=TOKEN_2022,
        curve_data=CURVE,
        fee_config_data=bytes(forged),
        buyback_fee_recipient=str(ORDER[13]),
        token_in=1_000_000_000_000,
        slippage_bps=0,
    )
    assert grab.raw == b""
    assert signer.last_unsigned == honest.raw
    assert honest.limit_lamports != lied.limit_lamports
    services.max_fee_bps = 10_000
    assert signer._max_total_fee() == 135
    services.max_fee_bps = 40
    assert signer._max_total_fee() == 50


def test_route_flip_and_token_shrinkage_block_reanchor(tmp_path: Path) -> None:
    import sqlite3

    signer, services = build(tmp_path)
    assert activate(signer).ok
    assert signer.set_route("https://example.invalid/permission", "2026-11-17", "written permission").ok
    services.chain.authoritative = True
    conn = sqlite3.connect(signer.path)
    conn.execute("UPDATE signer_state SET route_approved = 0 WHERE id = 1")
    conn.commit()
    conn.close()
    assert signer.reanchor("REANCHOR").code == "RECONCILE_REQUIRED"


def test_event_key_refuses_weak_keys_and_an_unkeyed_chain_does_not_fill(tmp_path: Path) -> None:
    from zoora_signer.db import connect, legacy_event_digest, verify_chain
    from zoora_signer.secrets import InvalidSigningKey

    signer, services = build(tmp_path)
    assert activate(signer).ok
    services.chain.authoritative = True
    with pytest.raises(InvalidSigningKey):
        services.secrets.set_event_hmac(b"\x00" * 32)
    with pytest.raises(InvalidSigningKey):
        services.secrets.set_event_hmac(b"e" * 32)
    hmac_key = services.secrets.get_hmac_key()
    assert hmac_key is not None
    with pytest.raises(InvalidSigningKey):
        services.secrets.set_event_hmac(hmac_key)
    stored = services.secrets.get_event_hmac()
    assert stored is not None
    services.secrets.event_hmac = None
    decision = signer.init_event_key()
    assert decision.ok
    fresh = services.secrets.get_event_hmac()
    assert fresh is not None and fresh.hex() not in decision.code and decision.intent_id != fresh.hex()
    assert not hasattr(signer, "rekey")
    conn = connect(signer.path)
    prev = "0" * 64
    rows = conn.execute("SELECT id, ts_ms, kind, payload FROM events ORDER BY id").fetchall()
    for row in rows:
        digest = legacy_event_digest(int(row["id"]), int(row["ts_ms"]), str(row["kind"]), prev, str(row["payload"]))
        conn.execute(
            "UPDATE events SET prev_hash = ?, hash = ? WHERE id = ?",
            (prev, digest, int(row["id"])),
        )
        prev = digest
    conn.commit()
    assert verify_chain(conn, fresh) is False
    conn.close()
    assert buy(signer).code != "FILLED"
    assert signer.activity() == "HALTED"


def test_sha256_event_and_a_missing_digest_do_not_fill(tmp_path: Path) -> None:
    from zoora_signer.db import connect, event_digest, legacy_event_digest
    from zoora_signer.models import canonical
    from zoora_signer.signer import _state_digest

    signer, services = build(tmp_path / "sha")
    assert activate(signer).ok
    assert buy(signer).ok
    conn = connect(signer.path)
    conn.execute("DELETE FROM reservations")
    digest = _state_digest(conn)
    last = conn.execute("SELECT id, hash FROM events ORDER BY id DESC LIMIT 1").fetchone()
    assert last is not None
    body = canonical({"note": "forged", "state_sha256": digest})
    new_id = int(last["id"]) + 1
    prev = str(last["hash"])
    conn.execute(
        "INSERT INTO events (id, ts_ms, kind, payload, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?)",
        (new_id, 1, "forged", body, prev, legacy_event_digest(new_id, 1, "forged", prev, body)),
    )
    conn.commit()
    conn.close()
    assert buy(signer).code != "FILLED"
    assert buy(signer).code != "FILLED"
    assert signer.activity() == "HALTED"

    bare, services = build(tmp_path / "bare")
    assert activate(bare).ok
    assert buy(bare).ok
    key = services.secrets.get_event_hmac()
    assert key is not None
    conn = connect(bare.path)
    row = conn.execute(
        "SELECT id, ts_ms, kind, payload, prev_hash FROM events ORDER BY id DESC LIMIT 1"
    ).fetchone()
    assert row is not None
    payload = json.loads(str(row["payload"]))
    assert isinstance(payload, dict)
    del payload["state_sha256"]
    body = canonical(payload)
    prev = str(row["prev_hash"])
    conn.execute(
        "UPDATE events SET payload = ?, hash = ? WHERE id = ?",
        (body, event_digest(int(row["id"]), int(row["ts_ms"]), str(row["kind"]), prev, body, key), int(row["id"])),
    )
    conn.commit()
    conn.close()
    assert buy(bare).code != "FILLED"
    assert bare.activity() == "HALTED"


def test_resetting_start_equity_after_a_loss_halts(tmp_path: Path) -> None:
    import sqlite3

    from harness import record_state

    signer, services = build(tmp_path)
    assert activate(signer).ok
    conn = sqlite3.connect(signer.path)
    row = conn.execute("SELECT start_equity_cents FROM equity_day").fetchone()
    assert row is not None
    start = int(row[0])
    conn.execute("UPDATE equity_day SET start_equity_cents = ?", (start + 401,))
    conn.commit()
    conn.close()
    record_state(signer)
    services.clock.now += 601_000
    assert buy(signer).code == "DAILY_LOSS"
    conn = sqlite3.connect(signer.path)
    conn.execute("UPDATE equity_day SET start_equity_cents = ?", (start,))
    conn.commit()
    conn.close()
    services.clock.now += 601_000
    assert buy(signer).code != "FILLED"
    assert signer.activity() == "HALTED"


def test_reanchor_checks_counters_against_the_event_log(tmp_path: Path) -> None:
    import sqlite3

    from solders.pubkey import Pubkey

    from harness import MINT
    from zoora_signer.constants import TOKEN_2022
    from zoora_signer.txbuild import _ata

    signer, services = build(tmp_path)
    assert activate(signer).ok
    assert buy(signer).ok
    owner = str(signer._owner_pubkey())
    ata_data = bytearray(72)
    ata_data[0:32] = bytes(Pubkey.from_string(MINT))
    ata_data[32:64] = bytes(Pubkey.from_string(owner))
    ata_data[64:72] = (1_000_000).to_bytes(8, "little")
    ata = str(_ata(Pubkey.from_string(owner), Pubkey.from_string(TOKEN_2022), Pubkey.from_string(MINT)))

    def account_info(address: str) -> tuple[bool, int, int, str, bytes]:
        if address == MINT:
            return (True, 1, 82, TOKEN_2022, b"\x00" * 82)
        if address == ata:
            return (True, 1, len(ata_data), TOKEN_2022, bytes(ata_data))
        return (False, 0, 0, "", b"")

    services.chain.account_info = account_info  # type: ignore[attr-defined]
    services.chain.authoritative = True
    services.chain.sol = int(
        sqlite3.connect(signer.path).execute("SELECT ledger_sol_lamports FROM signer_state").fetchone()[0]
    )
    assert signer.reanchor("REANCHOR").ok
    conn = sqlite3.connect(signer.path)
    conn.execute("UPDATE trades SET cost_cents = 0 WHERE status = 'open'")
    conn.commit()
    conn.close()
    assert signer.reanchor("REANCHOR").code == "RECONCILE_REQUIRED"


def test_dry_run_owner_sell_does_not_call_the_broadcaster(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    assert activate(signer).ok
    _arm(signer, services)

    class Recorder:
        enabled = True
        calls = 0

        def submit(self, payload: bytes) -> None:
            self.calls += 1

    recorder = Recorder()
    services.broadcaster = recorder  # type: ignore[assignment]
    assert buy(signer, mint=MINT).ok
    decision = signer.owner_sell(MINT, confirmation="OWNER_SELL")
    assert decision.code == "CLOSED"
    assert signer.open_trade_count() == 0
    assert recorder.calls == 0
    assert signer.set_route("https://example.invalid/permission", "2026-11-17", "written permission").ok
    assert signer.set_mode("LIVE").ok
    live = signer.owner_sell(MINT, confirmation="OWNER_SELL")
    assert live.code == "BROADCASTER_NOT_ENABLED"
    assert recorder.calls == 0


def test_deleting_a_trade_or_reservation_halts_the_next_buy(tmp_path: Path) -> None:
    import sqlite3

    signer, _services = build(tmp_path)
    assert activate(signer).ok
    assert buy(signer).ok
    conn = sqlite3.connect(signer.path)
    conn.execute("DELETE FROM trades")
    conn.execute("DELETE FROM reservations")
    conn.commit()
    conn.close()
    assert buy(signer).code != "FILLED"
    assert signer.activity() == "HALTED"


def test_dry_run_repolls_before_the_fill(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    assert activate(signer).ok
    seen = {"n": 0}

    def poll() -> str:
        seen["n"] += 1
        return "clear" if seen["n"] == 1 else "killed"

    services.kill.poll = poll  # type: ignore[method-assign]
    assert buy(signer).code == "KILL_HOLD"
    assert signer.open_trade_count() == 0


def test_dry_run_intent_polls_the_kill_switch(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    assert activate(signer).ok
    services.kill.state = "killed"
    assert signer.mode() == "DRY_RUN"
    assert buy(signer).code == "KILL_HOLD"


def test_unreadable_state_dir_is_killed(tmp_path: Path, monkeypatch: object) -> None:
    import os

    from zoora_signer.heartbeat import write_heartbeat
    from zoora_signer.killswitch import AgentGuardKill

    root = tmp_path / "home"
    state = root / "state"
    state.mkdir(parents=True)
    write_heartbeat(root, 5_000)
    if os.name == "nt":
        real = os.lstat

        def denied(path: object) -> object:
            if Path(str(path)).name == "KILL_SWITCH":
                raise PermissionError(path)
            return real(path)  # type: ignore[arg-type]

        monkeypatch.setattr("zoora_signer.killswitch.os.lstat", denied)  # type: ignore[attr-defined]
    else:
        state.chmod(0)
    try:
        assert AgentGuardKill(root, now_ms=lambda: 5_000).poll() == "killed"
    finally:
        if os.name != "nt":
            state.chmod(0o700)


def test_forward_keys_and_bots_are_rejected() -> None:
    base = {"text": "halt", "chat": {"id": 1}, "from": {"id": 1, "is_bot": False}}
    assert _telegram_update({"message": {**base, "forward_from": None}})[0] == "TELEGRAM_FORWARDED"
    assert _telegram_update({"message": {**base, "forward_from_chat": None}})[0] == "TELEGRAM_FORWARDED"
    bot = {"text": "halt", "chat": {"id": 1}, "from": {"id": 1, "is_bot": True}}
    assert _telegram_update({"message": bot})[0] == "TELEGRAM_REJECTED"
