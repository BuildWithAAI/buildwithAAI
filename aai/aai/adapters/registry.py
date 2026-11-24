from __future__ import annotations
from .base import Placeholder
from .billy import BillyAdapter
from .blofin import BlofinAdapter
from .solana_meme import SolanaMemeAdapter
from .stocks import StocksAdapter
from .longterm_feed import LongtermFeedAdapter


def build(cfg, store=None) -> dict:
    a = {"solana_meme": SolanaMemeAdapter(cfg, store), "blofin": BlofinAdapter(cfg, store), "billy": BillyAdapter(cfg, store)}
    a["trader_audit"] = Placeholder("trader_audit", "solana_meme", "trader_audit.csv/.db (157+ wallets) not on this computer; ingestion is Phase 2")
    a["terminal_hud"] = Placeholder("terminal_hud", None, "external terminal_hud Flask app not on this computer; proxy is Phase 2")
    a["forex"] = Placeholder("forex_mt5", "forex", "MT5 EA bridge not built (no forex agent folder on this computer)")
    a["stocks"] = StocksAdapter(cfg, store)  # read-only Yahoo equity quotes via intel markets; no idea agent
    a["longterm_feed"] = LongtermFeedAdapter(cfg, store)  # manual CSV via `aai lt-holdings-import`; audit-only, never tickets
    a["bybit"] = Placeholder("bybit", "perps", "Bybit public API returns HTTP 403 (geo-block) from this box; using Blofin")
    return a
