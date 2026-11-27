from __future__ import annotations
import os
from .base import Placeholder
from .billy import BillyAdapter
from .blofin import BlofinAdapter
from .solana_meme import SolanaMemeAdapter
from .stocks import StocksAdapter
from .longterm_feed import LongtermFeedAdapter


def forex_why() -> str:
    """Honest placeholder text: the forex agent's folder exists on this box, the MT5 bridge does not run here."""
    fx_root = os.path.join(os.environ.get("AAI_WORKSPACE", "/workspace"), "aai-forex")
    if os.path.isdir(fx_root):
        return ("MT5 EA bridge not wired: the aai-forex agent is on this computer (Zoora reads its paper scans and books), "
                "but its MT5 adapter is a Windows-only stub that is never run from this box")
    return "MT5 EA bridge not built (no forex agent folder on this computer)"


def build(cfg, store=None) -> dict:
    a = {"solana_meme": SolanaMemeAdapter(cfg, store), "blofin": BlofinAdapter(cfg, store), "billy": BillyAdapter(cfg, store)}
    a["trader_audit"] = Placeholder("trader_audit", "solana_meme", "trader_audit.csv/.db (157+ wallets) not on this computer; ingestion is Phase 2")
    a["terminal_hud"] = Placeholder("terminal_hud", None, "external terminal_hud Flask app not on this computer; proxy is Phase 2")
    a["forex"] = Placeholder("forex_mt5", "forex", forex_why())
    a["stocks"] = StocksAdapter(cfg, store)  # read-only Yahoo equity quotes via intel markets; no idea agent
    a["longterm_feed"] = LongtermFeedAdapter(cfg, store)  # manual CSV via `aai lt-holdings-import`; audit-only, never tickets
    a["bybit"] = Placeholder("bybit", "perps", "Bybit public API returns HTTP 403 (geo-block) from this box; using Blofin")
    return a
