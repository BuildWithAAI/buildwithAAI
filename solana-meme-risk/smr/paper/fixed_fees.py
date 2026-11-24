"""Solana fixed-fee accounting for experiment100 paper book (forward-only).

Percent fee/slip in costs.py remains. This module adds per-transaction SOL base fee,
optional labeled modeled priority fee + Jito tip, and SPL token-account rent lock/forfeit.

IMPORTANT:
  - Official/sourced values are cited in data/experiment100/fixed_fees.json.
  - Priority fee and Jito tip used here are MODELED CONSERVATIVE SCREENS when no
    execution venue is configured. They are NOT observed executor settings.
  - Positions with fee_model_version IS NULL keep legacy %-only behavior (no fixed SOL fees).
"""
from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass
from typing import Any

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_PATH = os.path.join(ROOT, "data", "experiment100", "fixed_fees.json")
LAMPORTS_PER_SOL = 1_000_000_000


@dataclass(frozen=True)
class FeeModel:
    raw: dict
    path: str

    @property
    def version(self) -> str:
        return str(self.raw.get("version") or "")

    @property
    def enabled(self) -> bool:
        return bool(self.raw.get("enabled"))

    @property
    def sol_usd(self) -> float:
        return float(self.raw["sol_usd"]["usd"])

    def lamports_to_usd(self, lamports: int | float) -> float:
        return float(lamports) / LAMPORTS_PER_SOL * self.sol_usd

    def base_fee_lamports(self) -> int:
        b = self.raw["base_fee"]
        return int(b["lamports_per_signature"]) * int(b.get("signatures_per_tx") or 1)

    def priority_fee_lamports(self) -> int:
        p = self.raw.get("priority_fee") or {}
        if p.get("status") in (None, "disabled", "unknown"):
            return 0
        # Official formula: ceil(cu_price_micro_lamports * cu_limit / 1_000_000)
        price = int(p["compute_unit_price_micro_lamports"])
        limit = int(p["compute_unit_limit"])
        return int(math.ceil(price * limit / 1_000_000))

    def jito_tip_lamports(self) -> int:
        j = self.raw.get("jito_tip") or {}
        if j.get("status") in (None, "disabled", "unknown"):
            return 0
        return int(j.get("lamports") or 0)

    def per_tx_lamports(self) -> int:
        return self.base_fee_lamports() + self.priority_fee_lamports() + self.jito_tip_lamports()

    def per_tx_usd(self) -> float:
        return self.lamports_to_usd(self.per_tx_lamports())

    def rent_lamports(self) -> int:
        return int((self.raw.get("token_account_rent") or {}).get("lamports") or 0)

    def rent_usd(self) -> float:
        return self.lamports_to_usd(self.rent_lamports())

    def assume_exit_txs(self) -> int:
        return int((self.raw.get("uneconomic_entry") or {}).get("assume_exit_txs") or 5)

    def max_cost_share(self) -> float:
        return float((self.raw.get("uneconomic_entry") or {}).get("max_fixed_cost_share_of_size") or 0.25)

    def screen_enabled(self) -> bool:
        u = self.raw.get("uneconomic_entry") or {}
        return bool(self.enabled and u.get("enabled", True))

    def missing_blocking(self) -> list[str]:
        """Fail-closed reasons when config cannot support trustworthy totals."""
        bad = []
        if not self.raw.get("enabled"):
            return ["fixed_fees_disabled"]
        if not self.version:
            bad.append("fee_model_version_missing")
        sol = self.raw.get("sol_usd") or {}
        if sol.get("usd") is None:
            bad.append("sol_usd_missing")
        base = self.raw.get("base_fee") or {}
        if base.get("lamports_per_signature") is None:
            bad.append("base_fee_missing")
        pri = self.raw.get("priority_fee") or {}
        if pri.get("status") == "unknown":
            bad.append("priority_fee_unknown")
        tip = self.raw.get("jito_tip") or {}
        if tip.get("status") == "unknown":
            bad.append("jito_tip_unknown")
        # Modeled screens are allowed when explicitly labeled; unknown blocks.
        if pri.get("status") not in ("modeled_conservative_screen_not_observed", "disabled", "sourced"):
            if pri.get("status") != "modeled_conservative_screen_not_observed":
                # require explicit status
                if not pri.get("status"):
                    bad.append("priority_fee_status_missing")
        if tip.get("status") not in ("modeled_conservative_screen_not_observed", "disabled", "sourced", "modeled_minimum_only"):
            if not tip.get("status"):
                bad.append("jito_tip_status_missing")
        rent = self.raw.get("token_account_rent") or {}
        if rent.get("lamports") is None:
            bad.append("token_account_rent_missing")
        return bad

    def estimate_drag_usd(self, *, entry_txs: int = 1, exit_txs: int | None = None, include_rent: bool | None = None) -> dict:
        exit_txs = self.assume_exit_txs() if exit_txs is None else int(exit_txs)
        u = self.raw.get("uneconomic_entry") or {}
        if include_rent is None:
            include_rent = bool(u.get("include_rent_as_cost_for_screen", True))
        per = self.per_tx_usd()
        rent = self.rent_usd() if include_rent else 0.0
        tx_total = per * (entry_txs + exit_txs)
        return {
            "per_tx_usd": round(per, 6),
            "per_tx_lamports": self.per_tx_lamports(),
            "entry_txs": entry_txs,
            "exit_txs": exit_txs,
            "tx_fees_usd": round(tx_total, 6),
            "rent_usd": round(rent, 6),
            "rent_as_screen_cost": include_rent,
            "total_fixed_drag_usd": round(tx_total + rent, 6),
            "components_lamports": {
                "base": self.base_fee_lamports(),
                "priority": self.priority_fee_lamports(),
                "jito_tip": self.jito_tip_lamports(),
                "rent": self.rent_lamports() if include_rent else 0,
            },
            "sol_usd": self.sol_usd,
            "version": self.version,
        }

    def uneconomic_reason(self, size_usd: float) -> str | None:
        if not self.screen_enabled():
            return None
        miss = self.missing_blocking()
        if miss:
            return "fixed_fee_config_incomplete:" + ",".join(miss)
        if size_usd <= 0:
            return "non_positive_size"
        d = self.estimate_drag_usd()
        share = d["total_fixed_drag_usd"] / size_usd
        max_share = self.max_cost_share()
        if share > max_share + 1e-12:
            return (f"uneconomic_fixed_fees: modeled_drag ${d['total_fixed_drag_usd']:.4f} "
                    f"({share:.1%} of ${size_usd:.2f}) exceeds max_share {max_share:.0%} "
                    f"[version={self.version}]")
        return None

    def snapshot_for_position(self) -> dict:
        """Immutable fee schedule frozen onto a position at entry (forward-only versioning)."""
        return {
            "fee_model_version": self.version,
            "sol_usd": self.sol_usd,
            "sol_usd_meta": self.raw.get("sol_usd"),
            "per_tx_lamports": self.per_tx_lamports(),
            "per_tx_usd": self.per_tx_usd(),
            "base_fee_lamports": self.base_fee_lamports(),
            "priority_fee_lamports": self.priority_fee_lamports(),
            "jito_tip_lamports": self.jito_tip_lamports(),
            "rent_lamports": self.rent_lamports(),
            "rent_usd": self.rent_usd(),
            "priority_status": (self.raw.get("priority_fee") or {}).get("status"),
            "jito_status": (self.raw.get("jito_tip") or {}).get("status"),
            "execution_venue_configured": bool((self.raw.get("execution_venue") or {}).get("configured")),
            "labels": {
                "priority": (self.raw.get("priority_fee") or {}).get("label"),
                "jito_tip": (self.raw.get("jito_tip") or {}).get("label"),
            },
        }


def load(path: str | None = None) -> FeeModel | None:
    path = path or DEFAULT_PATH
    try:
        with open(path) as f:
            raw = json.load(f)
    except (OSError, ValueError):
        return None
    return FeeModel(raw=raw, path=path)


def applies(pos: dict | None) -> bool:
    """True when this position was opened under a fixed-fee model version."""
    return bool(pos and pos.get("fee_model_version"))


def model_from_pos(pos: dict, fallback_path: str | None = None) -> FeeModel | None:
    """Rebuild a minimal FeeModel from the position snapshot so historical rows stay stable.

    If snapshot JSON is present, prefer its frozen per-tx/rent/sol numbers over live config.
    """
    if not applies(pos):
        return None
    snap = None
    try:
        snap = json.loads(pos.get("fee_schedule_json") or "null")
    except ValueError:
        snap = None
    live = load(fallback_path)
    if snap and isinstance(snap, dict) and snap.get("per_tx_usd") is not None:
        # Synthesize a raw dict that yields the frozen economics via helpers where possible.
        raw = {
            "version": snap.get("fee_model_version") or pos.get("fee_model_version"),
            "enabled": True,
            "sol_usd": {"usd": float(snap.get("sol_usd") or (live.sol_usd if live else 0.0))},
            "base_fee": {
                "lamports_per_signature": int(snap.get("base_fee_lamports") or 5000),
                "signatures_per_tx": 1,
            },
            "priority_fee": {
                "status": snap.get("priority_status") or "modeled_conservative_screen_not_observed",
                "compute_unit_limit": 1,
                "compute_unit_price_micro_lamports": int(snap.get("priority_fee_lamports") or 0),
            },
            "jito_tip": {
                "status": snap.get("jito_status") or "modeled_conservative_screen_not_observed",
                "lamports": int(snap.get("jito_tip_lamports") or 0),
            },
            "token_account_rent": {"lamports": int(snap.get("rent_lamports") or 0)},
            "uneconomic_entry": {"enabled": False},
            "_frozen_per_tx_usd": float(snap["per_tx_usd"]),
            "_frozen_rent_usd": float(snap.get("rent_usd") or 0.0),
        }
        return FrozenFeeModel(raw=raw, path="position:" + str(pos.get("id")))
    return live


class FrozenFeeModel(FeeModel):
    """FeeModel that returns frozen per-tx / rent USD from the entry snapshot."""

    def per_tx_usd(self) -> float:
        if "_frozen_per_tx_usd" in self.raw:
            return float(self.raw["_frozen_per_tx_usd"])
        return super().per_tx_usd()

    def rent_usd(self) -> float:
        if "_frozen_rent_usd" in self.raw:
            return float(self.raw["_frozen_rent_usd"])
        return super().rent_usd()

    def priority_fee_lamports(self) -> int:
        # When frozen via micro-lamports hack (limit=1), price field stores lamports directly.
        p = self.raw.get("priority_fee") or {}
        if int(p.get("compute_unit_limit") or 0) == 1:
            return int(p.get("compute_unit_price_micro_lamports") or 0)
        return super().priority_fee_lamports()


def charge_tx_usd(pos: dict) -> float:
    """USD fee for one successful tx under the position's frozen schedule. 0 if legacy."""
    m = model_from_pos(pos)
    if not m:
        return 0.0
    return float(m.per_tx_usd())


def entry_fields(model: FeeModel) -> dict[str, Any]:
    """Columns to set on a new experiment100 position."""
    snap = model.snapshot_for_position()
    return {
        "fee_model_version": model.version,
        "fee_schedule_json": json.dumps(snap, default=str),
        "fixed_fees_usd": float(snap["per_tx_usd"]),
        "entry_fixed_fee_usd": float(snap["per_tx_usd"]),
        "rent_locked_usd": float(snap["rent_usd"]),
        "rent_recovered_usd": 0.0,
        "rent_forfeited_usd": 0.0,
    }


def apply_exit_fee(pos: dict, *, tradeable_tokens: float) -> tuple[float, dict]:
    """Charge one exit tx fee if there are tokens to sell. Returns (fee_usd, column_updates).

    Never invents negative proceeds: caller subtracts fee from PnL, not from proceeds.
    Zero-token closes (already flat) charge $0 chain fee.
    """
    if not applies(pos):
        return 0.0, {}
    if tradeable_tokens is not None and tradeable_tokens <= 1e-18:
        return 0.0, {}
    fee = charge_tx_usd(pos)
    prev = float(pos.get("fixed_fees_usd") or 0.0)
    return fee, {"fixed_fees_usd": prev + fee}


def settle_rent_on_close(pos: dict, *, dust_remaining: bool) -> dict:
    """Dust remaining (clip5_rug_dust) => forfeit rent into PnL; else recover (unlock only)."""
    if not applies(pos):
        return {}
    locked = float(pos.get("rent_locked_usd") or 0.0)
    if locked <= 0:
        return {"rent_locked_usd": 0.0}
    if dust_remaining:
        return {
            "rent_locked_usd": 0.0,
            "rent_forfeited_usd": float(pos.get("rent_forfeited_usd") or 0.0) + locked,
        }
    return {
        "rent_locked_usd": 0.0,
        "rent_recovered_usd": float(pos.get("rent_recovered_usd") or 0.0) + locked,
    }


def pnl_after_fixed(proceeds: float, size_usd: float, pos: dict, rent_upd: dict | None = None) -> float:
    """Closed PnL net of cumulative fixed fees and rent forfeit (recovery is not a PnL gain)."""
    fees = float((rent_upd or {}).get("fixed_fees_usd", pos.get("fixed_fees_usd")) or 0.0)
    # prefer explicit forfeited from rent_upd after settle
    forfeited = float((rent_upd or {}).get("rent_forfeited_usd", pos.get("rent_forfeited_usd")) or 0.0)
    if not applies(pos):
        return proceeds - size_usd
    return proceeds - size_usd - fees - forfeited


def drag_report(model: FeeModel | None, sizes=(1.0, 2.0)) -> dict:
    if model is None:
        return {"error": "fixed_fees_config_missing", "path": DEFAULT_PATH}
    miss = model.missing_blocking()
    out = {
        "version": model.version,
        "enabled": model.enabled,
        "path": model.path,
        "missing_blocking": miss,
        "sol_usd": model.raw.get("sol_usd"),
        "execution_venue": model.raw.get("execution_venue"),
        "per_tx": {
            "lamports": model.per_tx_lamports(),
            "usd": round(model.per_tx_usd(), 6),
            "base_lamports": model.base_fee_lamports(),
            "priority_lamports": model.priority_fee_lamports(),
            "jito_tip_lamports": model.jito_tip_lamports(),
            "priority_status": (model.raw.get("priority_fee") or {}).get("status"),
            "jito_status": (model.raw.get("jito_tip") or {}).get("status"),
        },
        "rent_usd": round(model.rent_usd(), 6),
        "assumptions_label": "priority/tip are modeled conservative screens — NOT observed executor settings",
        "by_size": {},
    }
    for s in sizes:
        d = model.estimate_drag_usd()
        share = d["total_fixed_drag_usd"] / s if s else None
        out["by_size"][f"${s:g}"] = {
            **d,
            "size_usd": s,
            "drag_share_of_size": None if share is None else round(share, 6),
            "uneconomic_reason": model.uneconomic_reason(s),
        }
    return out
