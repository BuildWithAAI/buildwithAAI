"""Unsigned local-validator rehearsal. No mainnet signing and no website calls.

E2E_IN_CI = False

Loads the account snapshot in fixtures/e2e_curve.json, recorded from
https://solana-rpc.publicnode.com on 2026-11-17 at the slot stored in that
file. The snapshot is a successful pump sell_v3. The pump, Token-2022, and
SPL Token programs are copied with --clone-upgradeable-program from the
public RPC. The script then simulates buy_v3 and sell_v3 with sigVerify
false. Nothing is signed or submitted.

The transactions are the real unsigned buy_v3 and sell_v3 builders. The
signature slot is empty. This process does not sign and does not submit.
"""

from __future__ import annotations

import base64
import json
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

E2E_IN_CI = False
SOLANA_CLI_VERSION = "v4.4.1"
PUBLIC_RPCS = (
    "https://api.mainnet-beta.solana.com",
    "https://solana-rpc.publicnode.com",
)
PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
SPL_TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
SYSTEM = "11111111111111111111111111111111"
FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "e2e_curve.json"
SKIP_ACCOUNTS = {PUMP, TOKEN_2022, SPL_TOKEN, SYSTEM}


def _rpc(url: str, method: str, params: list[object]) -> dict[str, object]:
    if method == "sendTransaction":
        raise RuntimeError("submission is disabled")
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    request = urllib.request.Request(url, data=body, headers={"content-type": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode())
    if not isinstance(payload, dict):
        raise RuntimeError("rpc response was not an object")
    return payload


def _rent_exempt(account: dict[str, object]) -> None:
    data = base64.b64decode(str(account["data"]))
    need = (len(data) + 128) * 6960
    account["lamports"] = max(int(account["lamports"]), need)


def _account_file(path: Path, pubkey: str, account: dict[str, object]) -> None:
    body = {
        "pubkey": pubkey,
        "account": {
            "lamports": account["lamports"],
            "data": [account["data"], "base64"],
            "owner": account["owner"],
            "executable": False,
            "rentEpoch": account["rentEpoch"],
        },
    }
    path.write_text(json.dumps(body), encoding="utf-8")


def _synthetic_accounts(document: dict[str, object]) -> dict[str, dict[str, object]]:
    """Fill accounts the recorded trade names that were not on chain at the snapshot.

    The user's base token account is copied from the curve's base token account,
    with the owner set to the recorded user and a token balance large enough to
    sell. The two wrapped-SOL account addresses are unused for a SOL-paired
    coin; they still have to exist or the runtime returns AccountNotFound.
    """

    order = document["accounts_in_order"]
    assert isinstance(order, list)
    stored = document["accounts"]
    assert isinstance(stored, dict)
    curve_ata = stored[str(order[6])]
    assert isinstance(curve_ata, dict)
    raw = bytearray(base64.b64decode(str(curve_ata["data"])))
    from solders.pubkey import Pubkey

    user = bytes(Pubkey.from_string(str(order[8])))
    raw[32:64] = user
    raw[64:72] = (1_000_000_000_000).to_bytes(8, "little")
    synthesized = {
        str(order[9]): {
            "lamports": curve_ata["lamports"],
            "data": base64.b64encode(bytes(raw)).decode(),
            "owner": curve_ata["owner"],
            "rentEpoch": curve_ata["rentEpoch"],
        }
    }
    for index in (7, 10):
        key = str(order[index])
        if key in stored:
            continue
        synthesized[key] = {
            "lamports": 1_000_000,
            "data": base64.b64encode(b"").decode(),
            "owner": SYSTEM,
            "rentEpoch": 0,
        }
    return synthesized


def _builder_transactions(document: dict[str, object]) -> tuple[str, str, tuple[str, ...]]:
    """Real builder output. Signature.default() leaves the transaction unsigned."""

    sys.path.insert(0, str(FIXTURE.parents[1] / "src"))
    from zoora_signer.constants import TOKEN_2022
    from zoora_signer.txbuild import build_curve_buy, build_curve_sell

    order = document["accounts_in_order"]
    assert isinstance(order, list)
    accounts = document["accounts"]
    assert isinstance(accounts, dict)
    mint = str(order[1])
    user = str(order[8])
    buyback = str(order[13])
    curve = base64.b64decode(str(accounts[str(order[5])]["data"]))
    fee = base64.b64decode(str(accounts[str(order[12])]["data"]))
    mint_data = base64.b64decode(str(accounts[mint]["data"]))
    buy = build_curve_buy(
        user=user,
        mint_address=mint,
        mint_data=mint_data,
        mint_owner=TOKEN_2022,
        curve_data=curve,
        fee_config_data=fee,
        buyback_fee_recipient=buyback,
        sol_usd_cents=100_000,
        sol_usd_micro=100_000 * 10_000,
        stake_cents=200,
        slippage_bps=1500,
        create_base_ata=False,
        curve_lamports=int(accounts[str(order[5])]["lamports"]),
        volume_exists=False,
    )
    sell = build_curve_sell(
        user=user,
        mint_address=mint,
        mint_data=mint_data,
        mint_owner=TOKEN_2022,
        curve_data=curve,
        fee_config_data=fee,
        buyback_fee_recipient=buyback,
        token_in=10_000_000_000_000,
        slippage_bps=1500,
    )
    return (
        base64.b64encode(buy.raw).decode(),
        base64.b64encode(sell.raw).decode(),
        buy.accounts,
    )


def _wait_one_slot(url: str) -> None:
    """Give the local validator one slot so a just-cloned program is deployed."""

    def slot() -> int | None:
        try:
            payload = _rpc(url, "getSlot", [])
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            return None
        found = payload.get("result")
        return int(found) if isinstance(found, int) else None

    start = slot()
    deadline = time.time() + 5
    while time.time() < deadline:
        current = slot()
        if start is not None and current is not None and current > start:
            return
        time.sleep(0.2)


def _wait_for_validator(url: str, proc: subprocess.Popen[str], log_path: Path) -> None:
    deadline = time.time() + 90
    while time.time() < deadline:
        if proc.poll() is not None:
            tail = log_path.read_text(encoding="utf-8", errors="replace")[-2000:]
            raise RuntimeError(f"validator exited {proc.returncode}: {tail}")
        try:
            health = _rpc(url, "getHealth", [])
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            time.sleep(1)
            continue
        if health.get("result") == "ok":
            return
        time.sleep(1)
    raise RuntimeError("validator did not become healthy")


def _simulate(url: str, encoded: str) -> object:
    response = _rpc(
        url,
        "simulateTransaction",
        [
            encoded,
            {
                "encoding": "base64",
                "sigVerify": False,
                "replaceRecentBlockhash": True,
                "commitment": "processed",
            },
        ],
    )
    result = response.get("result")
    if not isinstance(result, dict):
        return response.get("error") or "no result"
    value = result.get("value")
    if not isinstance(value, dict):
        return "no value"
    err = value.get("err")
    if err is not None:
        logs = value.get("logs")
        if isinstance(logs, list):
            print("\n".join(str(line) for line in logs[-12:]))
        return err
    return None


def rehearsal_result(buy_err: object, sell_err: object) -> int:
    if buy_err is None and sell_err is None:
        return 0
    return 1


def _not_deployed(err: object) -> bool:
    return err is not None and "not deployed" in str(err).lower()


def run_pair(simulate: object, buy: str, sell: str) -> tuple[object, object]:
    """Simulate both trades, retrying once when the program is not deployed yet."""

    caller = simulate
    assert callable(caller)
    buy_err = caller(buy)
    if _not_deployed(buy_err):
        buy_err = caller(buy)
    sell_err = caller(sell)
    if _not_deployed(sell_err):
        sell_err = caller(sell)
    return buy_err, sell_err


def main() -> int:
    if shutil.which("solana") is None or shutil.which("solana-test-validator") is None:
        print(f"Solana CLI {SOLANA_CLI_VERSION} is not installed.")
        print("Install the pinned release, then rerun this script.")
        print("The rehearsal uses --clone-upgradeable-program, --account, and unsigned simulateTransaction")
        print("with sigVerify false. It does not sign and it does not submit.")
        return 2
    document = json.loads(FIXTURE.read_text(encoding="utf-8"))
    buy_tx, sell_tx, built_accounts = _builder_transactions(document)
    stored = {str(key): value for key, value in document["accounts"].items()}
    stored.update(_synthetic_accounts(document))
    curve_ata = stored[str(document["accounts_in_order"][6])]
    assert isinstance(curve_ata, dict)
    user_ata = built_accounts[9]
    if user_ata not in stored:
        raw = bytearray(base64.b64decode(str(curve_ata["data"])))
        from solders.pubkey import Pubkey

        raw[32:64] = bytes(Pubkey.from_string(built_accounts[8]))
        raw[64:72] = (10**15).to_bytes(8, "little")
        stored[user_ata] = {
            "lamports": curve_ata["lamports"],
            "data": base64.b64encode(bytes(raw)).decode(),
            "owner": curve_ata["owner"],
            "rentEpoch": curve_ata["rentEpoch"],
        }
    for key in built_accounts:
        if key in stored or key in SKIP_ACCOUNTS:
            continue
        stored[key] = {
            "lamports": 1_000_000,
            "data": base64.b64encode(b"").decode(),
            "owner": SYSTEM,
            "rentEpoch": 0,
        }
    for account in stored.values():
        if isinstance(account, dict):
            _rent_exempt(account)
    work = Path(tempfile.mkdtemp(prefix="zoora-validator-"))
    for key, account in stored.items():
        if not isinstance(account, dict):
            continue
        _account_file(work / f"{key}.json", key, account)
    buy_err: object = "not run"
    sell_err: object = "not run"
    for url in PUBLIC_RPCS:
        command = [
            "solana-test-validator",
            "--reset",
            "--quiet",
            "--ledger",
            str(work / "ledger"),
            "--bind-address",
            "127.0.0.1",
            "--rpc-port",
            "8899",
            "--url",
            url,
        ]
        for program in (PUMP, TOKEN_2022, SPL_TOKEN):
            print(f"cloning upgradeable program {program} from {url}")
            command.extend(["--clone-upgradeable-program", program])
        for key in stored:
            command.extend(["--account", key, str(work / f"{key}.json")])
        log_path = work / "validator.log"
        log_handle = log_path.open("w", encoding="utf-8")
        proc = subprocess.Popen(command, stdout=log_handle, stderr=subprocess.STDOUT, text=True)
        local = "http://127.0.0.1:8899"
        try:
            _wait_for_validator(local, proc, log_path)
            _wait_one_slot(local)
            buy_err, sell_err = run_pair(lambda raw, endpoint=local: _simulate(endpoint, raw), buy_tx, sell_tx)
        except Exception as exc:
            print(f"rehearsal failed against {url}: {exc}")
            buy_err = str(exc)
            sell_err = str(exc)
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
            log_handle.close()
        if buy_err is None and sell_err is None:
            break
    if rehearsal_result(buy_err, sell_err) != 0:
        print(f"unsigned simulation failed; buy={buy_err} sell={sell_err}")
        return 1
    print("unsigned buy_v3 simulation finished with no error")
    print("unsigned sell_v3 simulation finished with no error")
    print("no signature was produced and nothing was submitted")
    print(f"accounts recorded from {document['source']} at slot {document['slot']} on {document['recorded_on']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
