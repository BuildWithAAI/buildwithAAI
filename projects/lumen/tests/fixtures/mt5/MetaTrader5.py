"""
A stand-in for the MetaTrader5 package. It is used only by tests/fxBridge.test.ts, which puts this
folder on PYTHONPATH so that the bridge's `import MetaTrader5` finds it. It is on no path the bridge
uses on the owner's computer. It answers the handful of read calls the bridge makes, from a file the
test writes. It has no way to take an order: the trading calls of the real package are not defined
here at all, so a bridge that tried to trade would fail in the test.
"""
import json
import os
from types import SimpleNamespace

SYMBOL = "AUDUSD.s"
_tick = None


def initialize(*args, **kwargs):
    return os.environ.get("STANDIN_MT5_DOWN") != "1"


def shutdown():
    return None


def last_error():
    return (-10003, "IPC initialize failed") if os.environ.get("STANDIN_MT5_DOWN") == "1" else (1, "Success")


def terminal_info():
    return SimpleNamespace(name="Stand-in terminal", company="Stand-in", build=1, connected=True, trade_allowed=True, tradeapi_disabled=False)


def account_info():
    return SimpleNamespace(login=87654321, server="StandIn-Demo", company="Stand-in", currency="USD", leverage=500, margin_mode=2, trade_mode=int(os.environ.get("STANDIN_MT5_ACCOUNT", "0")), trade_allowed=True, trade_expert=True)


def _symbol(name, trade_mode):
    contract = float(os.environ.get("STANDIN_MT5_CONTRACT", "100000"))
    return SimpleNamespace(name=name, visible=name == SYMBOL, select=name == SYMBOL, digits=5, point=0.00001, trade_contract_size=contract, volume_min=0.01, volume_max=100.0, volume_step=0.01, trade_stops_level=0, trade_freeze_level=0, trade_tick_value=contract / 100000.0, trade_tick_size=0.00001, trade_mode=trade_mode, trade_exemode=2, filling_mode=3, order_mode=127, expiration_mode=15, currency_base="AUD", currency_profit="USD")


def symbol_info(name):
    # A broker's own names. The plain name does not exist here, as on an account whose pairs carry a suffix.
    if name == SYMBOL:
        return _symbol(SYMBOL, 4)
    if name == "AUDUSD+":
        return _symbol("AUDUSD+", 0)
    return None


def symbols_get(group=None):
    return (_symbol("AUDUSD+", 0), _symbol(SYMBOL, 4), SimpleNamespace(name="XAUDUSD", visible=False, trade_mode=4))


def symbol_select(name, enable=True):
    return name == SYMBOL


def symbol_info_tick(name):
    global _tick
    if name != SYMBOL:
        return None
    try:
        with open(os.environ["STANDIN_MT5_TICK"], "r", encoding="utf-8") as handle:
            data = json.load(handle)
        _tick = SimpleNamespace(time=int(data["msc"] // 1000), time_msc=int(data["msc"]), bid=float(data["bid"]), ask=float(data["ask"]), last=0.0, volume=0, flags=6, volume_real=0.0)
    except (OSError, ValueError, KeyError):
        # The file is being written this instant, or is not there yet. The last price stands.
        pass
    return _tick
