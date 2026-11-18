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

    from zoora_signer.constants import PUMP_PROGRAM
    from zoora_signer.txbuild import _ata, _pda

    owner = Pubkey.from_string(str(signer._owner_pubkey()))  # type: ignore[attr-defined]
    mint = Pubkey.from_string(MINT)
    pump = Pubkey.from_string(PUMP_PROGRAM)
    base = Pubkey.from_string(TOKEN_2022)
    curve = str(_pda([b"bonding-curve", bytes(mint)], pump))
    volume_key = str(_pda([b"user_volume_accumulator", bytes(owner)], pump))
    ata_key = str(_ata(owner, base, mint))
    seen: dict[str, int] = {}
    table = {
        curve: (True, LAMPORTS, len(CURVE), PUMP_PROGRAM, CURVE),
        volume_key: (volume, 0, 137 if volume else 0, PUMP_PROGRAM if volume else "", b""),
        ata_key: (ata, 2_000_000, 182 if ata else 0, TOKEN_2022 if ata else "", b""),
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
    with pytest.raises(BuildError, match="CAP"):
        _buy(curve_lamports=0, volume_exists=True)


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
    assert signer._unsigned_buy(intent, 10_000, 10_000 * 10_000) is None
    quoted(formula * 10)
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
    from zoora_signer.constants import PUMP_PROGRAM, USER_VOLUME_ACCOUNT_BYTES
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
            elif address == ata:
                value = {
                    "lamports": 2_000_000,
                    "owner": TOKEN_2022,
                    "data": [base64.b64encode(b"\x00" * 182).decode(), "base64"],
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
    services.chain = _RpcChain(rpc)  # type: ignore[assignment]

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
    assert signer.reanchor().ok
    assert signer.unhalt("UNHALT").ok


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
