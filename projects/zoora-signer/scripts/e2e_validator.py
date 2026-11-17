"""Unsigned local-validator rehearsal. No mainnet signing and no website calls.

E2E_IN_CI = False

The required CI jobs do not run this script. An optional job may. It dumps the
pump program and the global account from the public Solana RPC, loads them into
solana-test-validator, and calls simulateTransaction with sigVerify false.
A throwaway pubkey is created in memory and is never signed.
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
PUBLIC_RPC = "https://api.mainnet-beta.solana.com"
PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
GLOBAL = "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf"
# buy_v2 discriminator, same bytes as zoora_signer.constants.BUY_V2_DISCRIMINATOR.
BUY_V2 = bytes([184, 23, 238, 97, 103, 197, 211, 61])


def _rpc(url: str, method: str, params: list[object]) -> dict[str, object]:
    if method == "sendTransaction":
        raise RuntimeError("submission is disabled")
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    request = urllib.request.Request(url, data=body, headers={"content-type": "application/json"})
    with urllib.request.urlopen(request, timeout=20) as response:
        payload = json.loads(response.read().decode())
    if not isinstance(payload, dict):
        raise RuntimeError("rpc response was not an object")
    return payload


def _unsigned_transaction() -> str:
    from solders.hash import Hash
    from solders.instruction import Instruction
    from solders.message import Message
    from solders.pubkey import Pubkey
    from solders.transaction import Transaction

    payer = Pubkey.new_unique()
    instruction = Instruction(Pubkey.from_string(PUMP), BUY_V2, [])
    message = Message.new_with_blockhash([instruction], payer, Hash.default())
    transaction = Transaction.new_unsigned(message)
    if transaction.is_signed():
        raise RuntimeError("unsigned transaction was signed")
    return base64.b64encode(bytes(transaction)).decode()


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


def main() -> int:
    if shutil.which("solana") is None or shutil.which("solana-test-validator") is None:
        print(f"Solana CLI {SOLANA_CLI_VERSION} is not installed.")
        print("Install the pinned release, then rerun this script.")
        print("The rehearsal uses --bpf-program, --clone, and unsigned simulateTransaction")
        print("with sigVerify false. It does not sign and it does not submit.")
        return 2
    work = Path(tempfile.mkdtemp(prefix="zoora-validator-"))
    so_path = work / "pump.so"
    ledger = work / "ledger"
    log_path = work / "validator.log"
    print(f"dumping program to {so_path.name} from the public RPC")
    dump = subprocess.run(
        ["solana", "program", "dump", PUMP, str(so_path), "--url", PUBLIC_RPC],
        check=False,
        timeout=180,
        capture_output=True,
        text=True,
    )
    if dump.returncode != 0 or not so_path.is_file():
        print(dump.stderr[-1000:])
        print("program dump failed")
        return 1
    log_handle = log_path.open("w", encoding="utf-8")
    proc = subprocess.Popen(
        [
            "solana-test-validator",
            "--reset",
            "--quiet",
            "--ledger",
            str(ledger),
            "--bind-address",
            "127.0.0.1",
            "--rpc-port",
            "8899",
            "--bpf-program",
            PUMP,
            str(so_path),
            "--clone",
            GLOBAL,
            "--url",
            PUBLIC_RPC,
        ],
        stdout=log_handle,
        stderr=subprocess.STDOUT,
        text=True,
    )
    local = "http://127.0.0.1:8899"
    try:
        _wait_for_validator(local, proc, log_path)
        encoded = _unsigned_transaction()
        response = _rpc(
            local,
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
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        log_handle.close()
    if "result" not in response and "error" not in response:
        print("simulation returned no result")
        return 1
    result = response.get("result")
    err = result.get("value", {}).get("err") if isinstance(result, dict) else response.get("error")
    if err is not None:
        print(f"unsigned simulation failed; err={err}")
        return 1
    print("unsigned simulation finished with no error")
    print("no signature was produced and nothing was submitted")
    return 0


if __name__ == "__main__":
    sys.exit(main())
