"""pump.fun Mayhem-mode detection from free on-chain data (SIMULATION/analysis only; no pump.fun frontend API).

A Mayhem coin is created with `create_v2(..., is_mayhem_mode=true)`: the create tx runs the Mayhem program's
InitializeMayhemState and mints a second 1B tokens to pump.fun's Mayhem agent (BwWK17...), which trades them for up to
24 h and then burns what it did not sell. Sources, strongest first (all free, no pump.fun API):
  curve_flag  BondingCurve account byte 81 = is_mayhem_mode (immutable; getAccountInfo on publicnode). An 81-byte
              account predates the field = legacy create = not Mayhem.
  create_tx   create-tx logs contain 'Instruction: InitializeMayhemState', or the Mayhem agent got tokens of the mint
              -> Mayhem; a complete create log (CreateV2/Create present, not truncated) without either -> not Mayhem.
  supply      on-chain supply > 1.001B (only Mayhem mints more than 1B; burns only lower supply) -> Mayhem
  agent       the Mayhem agent holds a balance of the mint -> Mayhem
Any source saying Mayhem wins (conservative). 'Not Mayhem' needs an explicit curve flag or a complete create tx.
Otherwise the status is unknown (None); paper entry treats unknown like Mayhem (SKIP)."""
from __future__ import annotations
import base64

MAYHEM_AGENT = "BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s"
MAYHEM_PROGRAM = "MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e"
CURVE_DISCRIMINATOR = bytes([23, 183, 248, 55, 96, 216, 172, 96])
CURVE_MAYHEM_OFFSET = 81          # 8 disc + 5 x u64 + complete(bool) + creator(32)
NORMAL_SUPPLY = 1e9
SUPPLY_MAYHEM_MIN = NORMAL_SUPPLY * 1.001
REASON = "mayhem_mode"


def from_curve_account(data) -> bool | None:
    """is_mayhem_mode from BondingCurve account bytes (or a getAccountInfo base64 [data, 'base64'] pair)."""
    if isinstance(data, (list, tuple)) and data:
        try:
            data = base64.b64decode(data[0])
        except (ValueError, TypeError):
            return None
    if not isinstance(data, (bytes, bytearray)) or len(data) < 81 or bytes(data[:8]) != CURVE_DISCRIMINATOR:
        return None
    if len(data) == 81:
        return False              # pre-Mayhem account layout (legacy create, never extended)
    b = data[CURVE_MAYHEM_OFFSET]
    return True if b == 1 else False if b == 0 else None


def from_create_tx(tx, mint) -> bool | None:
    """Mayhem from the create transaction. None if the tx is missing, failed or its log is incomplete."""
    if not tx or not tx.get("meta") or tx["meta"].get("err"):
        return None
    meta = tx["meta"]
    for b in (meta.get("postTokenBalances") or []):
        if b.get("mint") == mint and b.get("owner") == MAYHEM_AGENT and int((b.get("uiTokenAmount") or {}).get("amount") or 0) > 0:
            return True
    logs = meta.get("logMessages") or []
    if any("InitializeMayhemState" in l for l in logs):
        return True
    if any(MAYHEM_PROGRAM in l for l in logs):
        return True
    truncated = any("Log truncated" in l for l in logs)
    has_create = any(l in ("Program log: Instruction: CreateV2", "Program log: Instruction: Create") for l in logs)
    return False if logs and has_create and not truncated else None


def classify(curve_flag=None, tx_flag=None, supply=None, agent_balance=None) -> dict:
    """-> {"mayhem": True | False | None, "source": str, "evidence": {...}}. Mayhem if ANY source says so."""
    ev = {"curve_flag": curve_flag, "create_tx": tx_flag, "supply": supply, "agent_balance": agent_balance}
    yes = []
    if curve_flag is True:
        yes.append("curve_flag")
    if tx_flag is True:
        yes.append("create_tx")
    if supply is not None and supply > SUPPLY_MAYHEM_MIN:
        yes.append("supply")
    if agent_balance is not None and agent_balance > 0:
        yes.append("agent_balance")
    if yes:
        return {"mayhem": True, "source": "+".join(yes), "evidence": ev}
    no = [n for n, v in (("curve_flag", curve_flag), ("create_tx", tx_flag)) if v is False]
    if no:
        return {"mayhem": False, "source": "+".join(no), "evidence": ev}
    return {"mayhem": None, "source": "unknown", "evidence": ev}


def as_int(m):
    return None if m is None else int(bool(m))


def detect(ctx, mint, create_sig=None, curve=None, supply=None, agent_balance=None, tx=None) -> dict:
    """Read the free on-chain sources (create tx: RPC-cached; curve account: one getAccountInfo) and classify.
    Never raises. Adds 'curve' (bonding-curve address) to the result when found."""
    tx_flag = curve_flag = None
    if ctx is not None and tx is None and create_sig:
        try:
            tx = ctx.rpc.get_transaction(create_sig)
        except Exception:
            tx = None
    cands = [curve] if curve else []
    if tx is not None:
        tx_flag = from_create_tx(tx, mint)
        # bonding-curve PDA = owner of the largest token balance after create; newer creates split the curve's
        # tokens over two accounts, so the other holders are tried too (first one with a BondingCurve layout wins)
        bals = sorted((b for b in (tx["meta"].get("postTokenBalances") or []) if b.get("mint") == mint and b.get("owner")
                       and b.get("owner") != MAYHEM_AGENT), key=lambda b: -int((b.get("uiTokenAmount") or {}).get("amount") or 0))
        cands += [b["owner"] for b in bals if b["owner"] not in cands]
    found = None
    for c in cands[:3]:
        if ctx is None:
            break
        try:
            r = ctx.rpc.call("getAccountInfo", [c, {"encoding": "base64"}], ttl=86400)
            v = (r or {}).get("value")
            f = from_curve_account(v.get("data")) if v else None
        except Exception:
            f = None
        if f is not None:
            curve_flag, found = f, c
            break
    out = classify(curve_flag, tx_flag, supply, agent_balance)
    out["curve"] = found or (cands[0] if cands else None)
    return out
