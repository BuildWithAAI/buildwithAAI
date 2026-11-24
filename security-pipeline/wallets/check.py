"""Wallet monitor. Reads PUBLIC addresses from config/exposure.yaml (or CLI args) and audits them.

  python -m wallets.check                         # audit addresses in exposure.yaml
  python -m wallets.check --evm 0xABC... --chains ethereum,optimism
  python -m wallets.check --sol <base58 address>
"""
from __future__ import annotations
import argparse, json, logging, re, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from common import config, logs  # noqa: E402
from . import evm, solana  # noqa: E402
from .badlists import known_bad_addresses  # noqa: E402

log = logging.getLogger("wallets")
EVM_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
SOL_RE = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")
SECRET_HINT = re.compile(r"^(0x)?[0-9a-fA-F]{64}$|^[1-9A-HJ-NP-Za-km-z]{80,90}$|(\b[a-z]+\b\s+){11,23}\b[a-z]+\b")
DEFAULT_EVM_CHAINS = ["ethereum", "optimism", "base", "arbitrum", "polygon", "bsc"]


def _guard(value: str) -> None:
    """Refuse anything that looks like a private key or seed phrase - never store or transmit it."""
    if SECRET_HINT.search(value.strip()):
        raise SystemExit("REFUSED: that looks like a PRIVATE KEY or SEED PHRASE. Only public addresses are accepted. "
                         "If you pasted a secret anywhere, treat that wallet as compromised and move funds.")


def run(exposure: dict, extra_evm=None, extra_sol=None, chains=None) -> dict:
    wcfg = exposure.get("wallets") or {}
    evm_list = [(w["address"] if isinstance(w, dict) else w, (w.get("chains") if isinstance(w, dict) else None))
                for w in (wcfg.get("evm") or [])] + [(a, None) for a in (extra_evm or [])]
    sol_list = [(w["address"] if isinstance(w, dict) else w) for w in (wcfg.get("solana") or [])] + list(extra_sol or [])
    result = {"addresses_configured": len(evm_list) + len(sol_list), "findings": [], "errors": []}
    if not evm_list and not sol_list:
        result["note"] = "No wallet addresses configured (config/exposure.yaml -> wallets). Wallet monitoring idle."
        return result
    bad, errs = known_bad_addresses(exposure)
    result["errors"] += errs
    result["known_bad_list_size"] = len(bad)
    for addr, ch in evm_list:
        _guard(addr)
        if not EVM_RE.match(addr):
            result["errors"].append(f"invalid EVM address skipped: {addr}"); continue
        f, e = evm.audit_address(addr, chains or ch or DEFAULT_EVM_CHAINS, bad)
        result["findings"] += f; result["errors"] += e
    for addr in sol_list:
        _guard(addr)
        if not SOL_RE.match(addr):
            result["errors"].append(f"invalid Solana address skipped: {addr}"); continue
        f, e = solana.audit_address(addr, bad)
        result["findings"] += f; result["errors"] += e
    order = {"CRITICAL": 0, "HIGH": 1, "WATCH": 2, "INFO": 3}
    result["findings"].sort(key=lambda x: order.get(x["tier"], 9))
    return result


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--evm", action="append", default=[], help="public EVM address (repeatable)")
    ap.add_argument("--sol", action="append", default=[], help="public Solana address (repeatable)")
    ap.add_argument("--chains", help="comma list of EVM chains: " + ",".join(evm.CHAINS))
    ap.add_argument("--no-config", action="store_true", help="ignore addresses in exposure.yaml")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args()
    logs.setup(a.verbose)
    exp = config.exposure()
    if a.no_config:
        exp = dict(exp, wallets={})
    res = run(exp, a.evm, a.sol, a.chains.split(",") if a.chains else None)
    print(json.dumps(res, indent=2, default=str))


if __name__ == "__main__":
    main()
