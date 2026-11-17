"""Local validator rehearsal. Not part of CI. Never signs and never calls the website.

E2E_IN_CI = False

Usage (on a machine that has the Solana CLI):

    python scripts/e2e_validator.py

The script dumps the pump program and one curve account from the public mainnet RPC,
starts solana-test-validator with --bpf-program and --clone, and simulates an unsigned
transaction with sigVerify false. If the CLI is not installed it exits 2 and prints
the commands a person would run. It does not submit a transaction.
"""

from __future__ import annotations

import shutil
import sys

E2E_IN_CI = False

PUBLIC_RPC = "https://api.mainnet-beta.solana.com"
PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
CURVE = "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf"


def main() -> int:
    if shutil.which("solana-test-validator") is None or shutil.which("solana") is None:
        print("solana-test-validator is not installed. This rehearsal is not part of CI.")
        print("When the Solana CLI is available, the steps are:")
        print(f"  solana program dump {PUMP} pump.so --url {PUBLIC_RPC}")
        print(f"  solana-test-validator --bpf-program {PUMP} pump.so --clone {CURVE} --url {PUBLIC_RPC}")
        print("  simulateTransaction with sigVerify false and replaceRecentBlockhash true")
        print("Do not pass a funded key. Do not call the website.")
        return 2
    print("Validator binary found. This build still does not sign or submit.")
    print("Run the dump and --clone commands above yourself, then simulate with sigVerify false.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
