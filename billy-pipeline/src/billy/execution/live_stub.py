"""Placeholder for a FUTURE live exchange adapter.

Deliberately contains no network code, no API-key handling and no exchange SDK import. Every
method raises. Implementing live trading requires a separate, reviewed change: an adapter class,
key management outside this repo, a kill switch wired to the exchange, and owner sign-off.
"""
from __future__ import annotations

from ..config import Settings
from .base import LiveTradingDisabled, Order


class LiveAdapterStub:
    name = "live_stub"

    def __init__(self, settings: Settings):
        self.settings = settings

    def submit(self, order: Order) -> dict:
        raise LiveTradingDisabled("No live adapter is implemented. Paper trading only.")

    def open_orders(self) -> list[dict]:
        raise LiveTradingDisabled("No live adapter is implemented. Paper trading only.")
