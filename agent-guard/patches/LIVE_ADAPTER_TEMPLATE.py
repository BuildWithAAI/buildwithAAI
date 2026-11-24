"""Required shape for ANY future live exchange / wallet adapter (Bybit, Blofin, Solana burner, ...).

Not wired anywhere; copy into the agent's execution module. Keys come from env/vault on the execution host only,
must be TRADE-ONLY (withdraw/transfer OFF, IP-whitelisted)."""
import os
import sys

sys.path.insert(0, os.environ.get("AGENT_GUARD_PATH", "/workspace/agent-guard"))
from agent_guard import OrderIntent, audit_log, check_order, killswitch, money_movement  # noqa: E402  (fail closed)

AGENT = "perps"  # config id from config/limits.json


class LiveAdapter:
    def __init__(self, venue: str):
        self.venue = venue
        self._key = os.environ.get(f"{venue.upper()}_TRADE_API_KEY")  # never log; use audit_log.log_key_use
        if not self._key:
            raise PermissionError("no trade-only key in env/vault")

    def place_order(self, symbol, side, qty, price, stop, equity_usd, day_start_equity_usd, leverage, approval_id=None):
        intent = OrderIntent(agent=AGENT, venue=self.venue, symbol=symbol, side=side, notional_usd=qty * price,
                             equity_usd=equity_usd, leverage=leverage, entry=price, stop=stop,
                             day_start_equity_usd=day_start_equity_usd, approval_id=approval_id)
        check_order(intent)                      # raises on kill switch / any limit / missing approval
        audit_log.log_key_use(AGENT, self.venue, self._key, f"order {symbol} {side} {qty}")
        killswitch.require_not_engaged(AGENT, "send order")  # re-check immediately before the network call
        raise NotImplementedError("venue order call goes here")

    @money_movement("withdraw")
    def withdraw(self, asset, amount, destination, *, agent=AGENT, approval_id=None):
        raise NotImplementedError("should never be implemented: keys must not have withdraw permission")
