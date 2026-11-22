"""
A stand-in for the MetaTrader5 package. It is used only by tests/fxBridge.test.ts, which puts this folder
on PYTHONPATH so that the bridge's `import MetaTrader5` finds it. It is on no path the bridge uses on the
owner's computer.

It answers the bridge's read calls from a file the test writes, and it keeps a small book of orders so
that the bridge's order road can be walked from end to end: a waiting limit order is filled when the
price in the file reaches it, and a trade is closed at its stop or its target. Every request the bridge
sends is written to a file the test reads.

It is not MetaTrader. It behaves the way MetaQuotes' pages say the terminal does, as far as the bridge
needs, and it proves nothing about a real terminal or a real broker. Any trading action the bridge must
never send (a market order, a change to a stop, a close) raises here, so a bridge that tried would fail.
"""
import json
import os
from types import SimpleNamespace

SYMBOL = "AUDUSD.s"
TRADE_ACTION_DEAL, TRADE_ACTION_PENDING, TRADE_ACTION_SLTP, TRADE_ACTION_MODIFY, TRADE_ACTION_REMOVE, TRADE_ACTION_CLOSE_BY = 1, 5, 6, 7, 8, 10
ORDER_TYPE_BUY, ORDER_TYPE_SELL, ORDER_TYPE_BUY_LIMIT, ORDER_TYPE_SELL_LIMIT = 0, 1, 2, 3
ORDER_TIME_GTC, ORDER_TIME_DAY = 0, 1
ORDER_FILLING_FOK, ORDER_FILLING_IOC, ORDER_FILLING_RETURN = 0, 1, 2
TRADE_RETCODE_PLACED, TRADE_RETCODE_DONE, TRADE_RETCODE_ERROR, TRADE_RETCODE_TIMEOUT, TRADE_RETCODE_INVALID_FILL = 10008, 10009, 10011, 10012, 10030
DEAL_ENTRY_IN, DEAL_ENTRY_OUT, DEAL_ENTRY_INOUT, DEAL_ENTRY_OUT_BY = 0, 1, 2, 3
DEAL_REASON_CLIENT, DEAL_REASON_EXPERT, DEAL_REASON_SL, DEAL_REASON_TP, DEAL_REASON_SO = 0, 3, 4, 5, 6
ORDER_STATE_PLACED, ORDER_STATE_CANCELED, ORDER_STATE_FILLED, ORDER_STATE_REJECTED, ORDER_STATE_EXPIRED = 1, 2, 4, 5, 6
ACCOUNT_MARGIN_MODE_RETAIL_NETTING, ACCOUNT_MARGIN_MODE_RETAIL_HEDGING = 0, 2
TIMEFRAME_M15, TIMEFRAME_H1, TIMEFRAME_H4, TIMEFRAME_D1 = 15, 16385, 16388, 16408
_FRAMES = {TIMEFRAME_M15: "M15", TIMEFRAME_H1: "H1", TIMEFRAME_H4: "H4", TIMEFRAME_D1: "D1"}
_BAR_COLUMNS = ("time", "open", "high", "low", "close", "tick_volume", "spread", "real_volume")

_tick = None
# With STANDIN_MT5_HIDDEN=1 the pair starts outside Market Watch, with no price and a blank pip value, as in a fresh terminal.
_selected = os.environ.get("STANDIN_MT5_HIDDEN") != "1"
_orders, _positions, _past, _deals, _sent = {}, {}, {}, [], []
_next = [70_000_001]


def _control():
    """What the test wants this broker to do differently, read fresh each time."""
    try:
        with open(os.environ.get("STANDIN_MT5_CONTROL", ""), "r", encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _contract():
    return float(os.environ.get("STANDIN_MT5_CONTRACT", "100000"))


def _write_book():
    path = os.environ.get("STANDIN_MT5_BOOK")
    if not path:
        return
    book = {"sent": _sent, "orders": [vars(item) for item in _orders.values()], "positions": [vars(item) for item in _positions.values()], "deals": [vars(item) for item in _deals]}
    with open(path + ".next", "w", encoding="utf-8") as handle:
        json.dump(book, handle)
    os.replace(path + ".next", path)


def _ticket():
    _next[0] += 1
    return _next[0]


def _deal(position, entry, reason, price, profit):
    cost = float(_control().get("commission", 0.0))
    _deals.append(SimpleNamespace(ticket=_ticket(), order=position.ticket, time=0, time_msc=0, type=position.type if entry == DEAL_ENTRY_IN else 1 - position.type, entry=entry, magic=position.magic, position_id=position.ticket, reason=reason, volume=position.volume, price=price, commission=cost, swap=0.0, profit=round(profit, 2), fee=0.0, symbol=position.symbol, comment=position.comment, external_id=""))


def _match():
    """The broker's side: fills a waiting order the price has come to, and closes a trade at its stop or its target."""
    tick = _read_tick()
    if tick is None:
        return
    changed = False
    for ticket, order in list(_orders.items()):
        buy = order.type == ORDER_TYPE_BUY_LIMIT
        if (buy and tick.ask <= order.price_open) or (not buy and tick.bid >= order.price_open):
            del _orders[ticket]
            _past[ticket] = SimpleNamespace(ticket=ticket, state=ORDER_STATE_FILLED, symbol=order.symbol, magic=order.magic, comment=order.comment)
            position = SimpleNamespace(ticket=ticket, identifier=ticket, time=0, type=0 if buy else 1, magic=order.magic, volume=order.volume_initial, price_open=order.price_open, sl=order.sl, tp=order.tp, price_current=order.price_open, swap=0.0, profit=0.0, symbol=order.symbol, comment=order.comment)
            _positions[ticket] = position
            _deal(position, DEAL_ENTRY_IN, DEAL_REASON_EXPERT, order.price_open, 0.0)
            changed = True
    by_hand = bool(_control().get("close_by_hand"))
    for ticket, position in list(_positions.items()):
        up = 1 if position.type == 0 else -1
        out = tick.bid if position.type == 0 else tick.ask
        reason = price = None
        if by_hand:
            reason, price = DEAL_REASON_CLIENT, out
        elif position.sl and (out - position.sl) * up <= 0:
            # A stop is a market order once touched: it gets the price there is, which is worse after a jump.
            reason, price = DEAL_REASON_SL, out
        elif position.tp and (out - position.tp) * up >= 0:
            reason, price = DEAL_REASON_TP, position.tp
        if reason is None:
            continue
        del _positions[ticket]
        _deal(position, DEAL_ENTRY_OUT, reason, price, (price - position.price_open) * up * position.volume * _contract())
        changed = True
    if changed:
        _write_book()


def initialize(*args, **kwargs):
    return os.environ.get("STANDIN_MT5_DOWN") != "1"


def shutdown():
    return None


def last_error():
    return (-10003, "IPC initialize failed") if os.environ.get("STANDIN_MT5_DOWN") == "1" else (1, "Success")


def terminal_info():
    control = _control()
    return SimpleNamespace(name="Stand-in terminal", company="Stand-in", build=1, connected=not control.get("offline", False), trade_allowed=not control.get("algo_off", False), tradeapi_disabled=bool(control.get("python_off", False)))


def account_info():
    control = _control()
    return SimpleNamespace(login=87654321, server="StandIn-Demo", company="Stand-in", currency=control.get("currency", "USD"), leverage=500, margin_mode=ACCOUNT_MARGIN_MODE_RETAIL_NETTING if control.get("netting") else ACCOUNT_MARGIN_MODE_RETAIL_HEDGING, trade_mode=int(os.environ.get("STANDIN_MT5_ACCOUNT", "0")), trade_allowed=not control.get("account_off", False), trade_expert=not control.get("expert_off", False), fifo_close=False)


def _symbol(name, trade_mode):
    contract = _contract()
    shown = name == SYMBOL and _selected
    control = _control()
    return SimpleNamespace(name=name, visible=shown, select=shown, digits=int(control.get("digits", 5)), point=0.00001, trade_contract_size=contract, volume_min=0.01, volume_max=100.0, volume_step=0.01, trade_stops_level=int(control.get("stops_level", 0)), trade_freeze_level=0, trade_tick_value=contract / 100000.0 if shown else 0.0, trade_tick_size=0.00001, trade_mode=trade_mode, trade_exemode=2, filling_mode=3, order_mode=int(control.get("order_mode", 127)), expiration_mode=int(control.get("expiration_mode", 15)), currency_base="AUD", currency_profit="USD")


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
    global _selected
    if name == SYMBOL:
        _selected = bool(enable)
    return name == SYMBOL


def _read_tick():
    global _tick
    if not _selected:
        return None
    try:
        with open(os.environ["STANDIN_MT5_TICK"], "r", encoding="utf-8") as handle:
            data = json.load(handle)
        _tick = SimpleNamespace(time=int(data["msc"] // 1000), time_msc=int(data["msc"]), bid=float(data["bid"]), ask=float(data["ask"]), last=0.0, volume=0, flags=6, volume_real=0.0)
    except (OSError, ValueError, KeyError):
        # The file is being written this instant, or is not there yet. The last price stands.
        pass
    return _tick


def symbol_info_tick(name):
    if name != SYMBOL:
        return None
    _match()
    return _read_tick()


def copy_rates_from_pos(symbol, timeframe, start_pos, count):
    """
    Bars from the file the test writes. As in MetaTrader, a position counts from the present into the
    past, position 0 is the bar still being made, and what comes back is oldest first. MetaTrader gives
    rows with named columns: here a row is a dict, or a plain tuple when the test asks for one.
    """
    control = _control()
    if symbol != SYMBOL or control.get("no_history"):
        return None
    if control.get("empty_history"):
        return []
    try:
        with open(os.environ.get("STANDIN_MT5_BARS", ""), "r", encoding="utf-8") as handle:
            rows = json.load(handle).get(_FRAMES.get(int(timeframe), ""), [])
    except (OSError, ValueError):
        return None
    end = len(rows) - int(start_pos)
    # A terminal that gives more than was asked for: the bridge has to cut it to the newest.
    wanted = int(count) + (2 if control.get("too_many") else 0)
    chosen = [list(row) + [0] for row in rows[max(0, end - wanted):max(0, end)]]
    if control.get("newest_first"):
        chosen.reverse()
    if control.get("plain_rows"):
        return [tuple(row) for row in chosen]
    return [dict(zip(_BAR_COLUMNS, row)) for row in chosen]


def order_calc_profit(action, symbol, volume, price_open, price_close):
    if symbol != SYMBOL or action not in (ORDER_TYPE_BUY, ORDER_TYPE_SELL) or _control().get("no_sum"):
        return None
    return round((price_close - price_open) * (1 if action == ORDER_TYPE_BUY else -1) * volume * _contract(), 2)


def _judge(request):
    """What a trade server says to a waiting limit order: 0 if it would take it."""
    control = _control()
    if control.get("refuse_return") and request.get("type_filling") == ORDER_FILLING_RETURN:
        return TRADE_RETCODE_INVALID_FILL, "Unsupported filling mode"
    if control.get("refuse_all_filling"):
        return TRADE_RETCODE_INVALID_FILL, "Unsupported filling mode"
    if control.get("reject_check"):
        return int(control["reject_check"]), "Rejected by the test"
    tick = _read_tick()
    if request.get("symbol") != SYMBOL or tick is None:
        return 10013, "Invalid request"
    if request.get("type") not in (ORDER_TYPE_BUY_LIMIT, ORDER_TYPE_SELL_LIMIT) or not 0.01 <= float(request.get("volume", 0)) <= 100:
        return 10014, "Invalid volume"
    buy, price, stop, target = request["type"] == ORDER_TYPE_BUY_LIMIT, float(request.get("price", 0)), float(request.get("sl", 0)), float(request.get("tp", 0))
    if (buy and price >= tick.ask) or (not buy and price <= tick.bid):
        return 10015, "Invalid price"
    if stop and ((buy and stop >= price) or (not buy and stop <= price)) or target and ((buy and target <= price) or (not buy and target >= price)):
        return 10016, "Invalid stops"
    return 0, "Done"


def order_check(request):
    _sent.append({"call": "order_check", "request": dict(request)})
    _write_book()
    if _control().get("check_silent"):
        return None
    code, comment = _judge(request)
    return SimpleNamespace(retcode=code, balance=100.0, equity=100.0, profit=0.0, margin=1.3, margin_free=98.7, margin_level=7692.0, comment=comment, request=request)


def order_send(request):
    _sent.append({"call": "order_send", "request": dict(request)})
    control = _control()
    action = request.get("action")
    if action == TRADE_ACTION_REMOVE:
        order = _orders.pop(int(request.get("order", 0)), None)
        if order is None or control.get("remove_fails"):
            if order is not None:
                _orders[order.ticket] = order
            _write_book()
            return SimpleNamespace(retcode=10013, deal=0, order=0, volume=0.0, price=0.0, bid=0.0, ask=0.0, comment="Invalid request", request_id=0, retcode_external=0, request=request)
        _past[order.ticket] = SimpleNamespace(ticket=order.ticket, state=ORDER_STATE_CANCELED, symbol=order.symbol, magic=order.magic, comment=order.comment)
        _write_book()
        return SimpleNamespace(retcode=TRADE_RETCODE_DONE, deal=0, order=order.ticket, volume=0.0, price=0.0, bid=0.0, ask=0.0, comment="Request executed", request_id=0, retcode_external=0, request=request)
    if action != TRADE_ACTION_PENDING:
        _write_book()
        raise AssertionError("the bridge sent an action it must never send: %r" % (action,))
    if control.get("lost"):
        # The request never reached the trade server, and the terminal has no word.
        _write_book()
        return None
    code, comment = _judge(request)
    if control.get("reject_send"):
        code, comment = int(control["reject_send"]), "Rejected by the test"
    if code:
        _write_book()
        return SimpleNamespace(retcode=code, deal=0, order=0, volume=0.0, price=0.0, bid=0.0, ask=0.0, comment=comment, request_id=0, retcode_external=0, request=request)
    ticket = _ticket()
    _orders[ticket] = SimpleNamespace(ticket=ticket, time_setup=0, type=request["type"], type_time=request.get("type_time"), type_filling=request.get("type_filling"), state=ORDER_STATE_PLACED, magic=int(request.get("magic", 0)), volume_initial=float(request["volume"]), volume_current=float(request["volume"]), price_open=float(request["price"]), sl=0.0 if control.get("drop_stop") else float(request.get("sl", 0)), tp=float(request.get("tp", 0)), symbol=request["symbol"], comment="" if control.get("drop_note") else str(request.get("comment", "")))
    _write_book()
    if control.get("answer_lost"):
        # The trade server took the order, and the answer never came back.
        return None
    if control.get("no_ticket"):
        return SimpleNamespace(retcode=TRADE_RETCODE_DONE, deal=0, order=0, volume=0.0, price=0.0, bid=0.0, ask=0.0, comment="Request executed", request_id=0, retcode_external=0, request=request)
    return SimpleNamespace(retcode=TRADE_RETCODE_DONE, deal=0, order=ticket, volume=float(request["volume"]), price=float(request["price"]), bid=0.0, ask=0.0, comment="Request executed", request_id=1, retcode_external=0, request=request)


def orders_get(symbol=None, ticket=None, group=None):
    _match()
    return tuple(order for order in _orders.values() if (ticket is None or order.ticket == ticket) and (symbol is None or order.symbol == symbol))


def positions_get(symbol=None, ticket=None, group=None):
    _match()
    return tuple(position for position in _positions.values() if (ticket is None or position.ticket == ticket) and (symbol is None or position.symbol == symbol))


def history_deals_get(*args, position=None, ticket=None, group=None):
    _match()
    found = tuple(deal for deal in _deals if (position is None or deal.position_id == position) and (ticket is None or deal.order == ticket))
    return found or None


def history_orders_get(*args, ticket=None, position=None, group=None):
    found = tuple(order for order in _past.values() if ticket is None or order.ticket == ticket)
    return found or None
