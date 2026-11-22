#!/usr/bin/env python3
"""
Zoora's bridge to MetaTrader 5. It reads prices and places her forex orders. It is live: an order it
places is a real order on whatever account the terminal is logged in to.

Run it on the Windows computer where the MetaTrader 5 terminal is installed and logged in to the broker
account. It attaches to that terminal, so it holds no account number and no password: the terminal does.

It listens on this computer only (127.0.0.1). A request must carry an HMAC-SHA256 of its body made with
LUMEN_FX_BRIDGE_SECRET, a nonce the bridge has not seen, and a send time within a minute. An answer is
signed the same way and carries the request's nonce.

What it will do, and nothing else:

    quote    every price change of a pair since a time
    place    one waiting limit order, with its stop and its target in the same request
    state    where one of her orders stands at the broker
    cancel   pull one of her orders that is still waiting

What it will not do. There is no market order in this file, no changing of a stop or a target, no closing
of a trade, no moving of money, and no logging in. A test (tests/fxBridge.test.ts) fails if one is added.

The owner's rule is kept here as well as in the engine, so that nothing that reaches this bridge can trade
larger: an order is the owner's size or it is refused, the terminal's own sum for its loss at the stop has
to agree with the rule, and there is one order or trade of hers in a pair at a time.

    python mt5_bridge.py --check     print what the terminal shows, then stop. Sends nothing.
    python mt5_bridge.py --prove     place one real order far from the market, read it back, pull it
    python mt5_bridge.py             serve prices and place her orders until Ctrl+C

Settings, read from the environment:

    LUMEN_FX_BRIDGE_SECRET    shared with the engine, at least 32 characters. Needed to serve.
    LUMEN_FX_BRIDGE_PORT      the port on this computer. Unset is 8765.
    LUMEN_FX_LOTS             the size of one trade. Unset is 0.01. Set it to what the engine has.
    LUMEN_FX_RISK_USD         what one trade may lose at its stop. Unset is 3. Set it to what the engine has.
    LUMEN_FX_SYMBOL_AUDUSD    the terminal's own name for AUDUSD, if the bridge picks the wrong one.
    LUMEN_MT5_TERMINAL        the path of terminal64.exe, if more than one terminal is installed.
    LUMEN_FX_BRIDGE_JOURNAL   where the record of what was sent is kept. Unset is .zoora/mt5-bridge.json at home.
    LUMEN_FX_CHECK_SECONDS    how long --check watches the price for a change. Unset is 3.

See docs/FOREX.md.
"""
import hashlib
import hmac
import json
import os
import queue
import re
import secrets
import sys
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# The pairs she trades, with the digits and the size of one lot that her arithmetic assumes.
PAIRS = {"AUDUSD": {"digits": 5, "contract": 100000}}
# A request older or newer than this, by this computer's clock, is refused.
FRESH_MS = 60_000
# How often the terminal's latest price is read. Four times a second.
SAMPLE_SECONDS = 0.25
# How long a price change is kept, and the most that go into one answer.
KEEP_MS = 10 * 60_000
MAX_PATH = 1_200
MAX_BODY = 2_048
ACCOUNT_KINDS = {0: "demo", 1: "contest", 2: "real"}
# Every order of hers carries this number and a note with her order's id, so the bridge knows its own.
MAGIC = 20261122
TAG = "zoora "
# Account currencies counted as dollars. Bybit's MetaTrader account is funded in USDT and shows it as USDx.
DOLLARS = ("USD", "USDT", "USDC", "USDX", "BYUSDT")
# How long the web side waits for the terminal to answer about an order.
WAIT_SECONDS = 20.0
# The numbers MetaTrader gives its own names, used only if the package does not carry the name.
NUMBERS = {
    "TRADE_ACTION_PENDING": 5, "TRADE_ACTION_REMOVE": 8,
    "ORDER_TYPE_BUY": 0, "ORDER_TYPE_SELL": 1, "ORDER_TYPE_BUY_LIMIT": 2, "ORDER_TYPE_SELL_LIMIT": 3,
    "ORDER_TIME_GTC": 0, "ORDER_TIME_DAY": 1,
    "ORDER_FILLING_FOK": 0, "ORDER_FILLING_IOC": 1, "ORDER_FILLING_RETURN": 2,
    "TRADE_RETCODE_PLACED": 10008, "TRADE_RETCODE_DONE": 10009, "TRADE_RETCODE_ERROR": 10011, "TRADE_RETCODE_TIMEOUT": 10012, "TRADE_RETCODE_INVALID_FILL": 10030,
    "DEAL_ENTRY_IN": 0, "DEAL_ENTRY_OUT": 1, "DEAL_ENTRY_INOUT": 2, "DEAL_ENTRY_OUT_BY": 3,
    "DEAL_REASON_SL": 4, "DEAL_REASON_TP": 5, "DEAL_REASON_SO": 6,
    "ORDER_STATE_CANCELED": 2, "ORDER_STATE_FILLED": 4, "ORDER_STATE_REJECTED": 5, "ORDER_STATE_EXPIRED": 6,
    "ACCOUNT_MARGIN_MODE_RETAIL_HEDGING": 2,
}


def now_ms():
    return int(time.time() * 1000)


def sign(secret, body):
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


def number(mt5, name):
    return int(getattr(mt5, name, NUMBERS[name]))


def centi_lots(text, unset):
    """A size such as 0.01 as hundredths of a lot. Anything else is the unset value."""
    text = (text or "").strip()
    if not re.fullmatch(r"\d{1,3}(\.\d{1,2})?", text):
        return unset
    whole, _, part = text.partition(".")
    value = int(whole) * 100 + int((part + "00")[:2])
    return value if value > 0 else unset


def cents(text, unset):
    text = (text or "").strip()
    if not re.fullmatch(r"\d+(\.\d{1,2})?", text):
        return unset
    whole, _, part = text.partition(".")
    value = int(whole) * 100 + int((part + "00")[:2])
    return value if value > 0 else unset


def find_symbol(mt5, pair, env):
    """
    The terminal's own name for a pair, and every name it could have been. A broker often adds a suffix:
    AUDUSD.s, AUDUSD+. One that can be traded comes before one that cannot, then the plain name, then
    one already in Market Watch.
    """
    named = (env.get("LUMEN_FX_SYMBOL_" + pair) or "").strip()
    if named:
        return (named if mt5.symbol_info(named) is not None else None), [named]
    found = {}
    for info in mt5.symbols_get(group="*" + pair + "*") or ():
        if str(info.name).upper().startswith(pair):
            found[str(info.name)] = info
    exact = mt5.symbol_info(pair)
    if exact is not None:
        found[pair] = exact
    ranked = sorted(found, key=lambda name: (int(getattr(found[name], "trade_mode", 0)) == 0, name != pair, not getattr(found[name], "visible", False), name))
    return (ranked[0] if ranked else None), ranked


class Journal:
    """
    What the bridge has sent, by her order's id. It is written before an order is sent and again after,
    so a restart can neither send an order twice nor lose track of one. It holds no secret.
    """

    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()
        self.entries = {}
        try:
            with open(path, "r", encoding="utf-8") as handle:
                self.entries = json.load(handle)
        except FileNotFoundError:
            pass
        if not isinstance(self.entries, dict):
            raise ValueError("not a journal")

    def get(self, key):
        with self.lock:
            entry = self.entries.get(key)
            return dict(entry) if isinstance(entry, dict) else None

    def put(self, key, entry):
        with self.lock:
            self.entries[key] = dict(entry)
            folder = os.path.dirname(self.path)
            if folder:
                os.makedirs(folder, exist_ok=True)
            with open(self.path + ".next", "w", encoding="utf-8") as handle:
                json.dump(self.entries, handle, separators=(",", ":"))
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(self.path + ".next", self.path)


def journal_path(env):
    return (env.get("LUMEN_FX_BRIDGE_JOURNAL") or "").strip() or os.path.join(os.path.expanduser("~"), ".zoora", "mt5-bridge.json")


class Feed:
    """
    The terminal's prices, and the one thread that speaks to the terminal. Every call into the terminal,
    for a price or for an order, is made from the thread that runs `run`. The web side hands it work
    through `ask` and reads what it has stored.
    """

    def __init__(self, mt5, env, clock=now_ms):
        self.mt5 = mt5
        self.env = env
        self.clock = clock
        self.lock = threading.Lock()
        self.account = None
        self.pairs = {}
        self.jobs = queue.Queue()

    def connect(self):
        path = (self.env.get("LUMEN_MT5_TERMINAL") or "").strip()
        return bool(self.mt5.initialize(path) if path else self.mt5.initialize())

    def refresh(self):
        """Reads which account the terminal is in and what each pair is called and how it is sized."""
        account = self.mt5.account_info()
        kind = ACCOUNT_KINDS.get(int(account.trade_mode)) if account is not None else None
        for pair in PAIRS:
            symbol, _ = find_symbol(self.mt5, pair, self.env)
            info = self.mt5.symbol_info(symbol) if symbol else None
            if info is None:
                with self.lock:
                    self.pairs.pop(pair, None)
                continue
            # A pair has to be in Market Watch for the terminal to keep its price up to date.
            if not getattr(info, "visible", True):
                self.mt5.symbol_select(symbol, True)
            contract = float(info.trade_contract_size)
            spec = {"symbol": symbol, "digits": int(info.digits), "contract": int(contract) if contract.is_integer() else contract, "stopsLevel": int(info.trade_stops_level)}
            with self.lock:
                entry = self.pairs.get(pair)
                if entry is None or entry["spec"]["symbol"] != symbol or entry["spec"]["digits"] != spec["digits"]:
                    entry = {"spec": spec, "last": None, "path": deque()}
                    self.pairs[pair] = entry
                entry["spec"] = spec
        with self.lock:
            self.account = kind

    def sample(self):
        """
        Reads the latest price of each pair and keeps it if it has changed. The first price read is not
        kept: with the market shut it could be days old, and there is no telling. From then on a change is
        stamped with this computer's clock, because the terminal's own times are in the broker's time zone.
        """
        with self.lock:
            entries = list(self.pairs.items())
        for pair, entry in entries:
            tick = self.mt5.symbol_info_tick(entry["spec"]["symbol"])
            if tick is None or not tick.bid or not tick.ask:
                continue
            key = (int(tick.time_msc), float(tick.bid), float(tick.ask))
            first = entry["last"] is None
            if key == entry["last"]:
                continue
            entry["last"] = key
            if first:
                continue
            scale = 10 ** entry["spec"]["digits"]
            bid, ask = int(round(key[1] * scale)), int(round(key[2] * scale))
            if not 0 < bid <= ask:
                continue
            at = self.clock()
            with self.lock:
                entry["path"].append((at, bid, ask))
                while entry["path"] and at - entry["path"][0][0] > KEEP_MS:
                    entry["path"].popleft()

    def ask(self, work, wait=WAIT_SECONDS):
        """
        Has the terminal's thread do a piece of work and gives back what it returned. Nothing comes back if
        the terminal did not get to it in time. Work the terminal reaches after its time is up is not done
        at all, so an order is never placed late, behind the back of whoever stopped waiting.
        """
        done, box = threading.Event(), {}
        self.jobs.put((work, done, box, time.monotonic() + wait))
        done.wait(wait + 0.5)
        return box.get("out")

    def run(self, stop):
        checked = 0.0
        while not stop.is_set():
            started = time.monotonic()
            try:
                if started - checked >= 5.0:
                    checked = started
                    if self.mt5.terminal_info() is None:
                        self.connect()
                    self.refresh()
                self.sample()
            except Exception:
                # A terminal that is closed or busy is no price. The next round tries again.
                pass
            # Until the next reading is due, orders are seen to as they come.
            while not stop.is_set():
                left = SAMPLE_SECONDS - (time.monotonic() - started)
                if left <= 0:
                    break
                try:
                    work, done, box, until = self.jobs.get(timeout=left)
                except queue.Empty:
                    break
                try:
                    if time.monotonic() <= until:
                        box["out"] = work()
                except Exception as error:
                    box["out"] = {"ok": False, "reason": "BRIDGE", "what": type(error).__name__}
                done.set()

    def quote(self, pair, since_ms):
        """Every price change of a pair after a time, oldest first, and always at least the newest one."""
        with self.lock:
            entry = self.pairs.get(pair)
            if entry is None or self.account is None or not entry["path"]:
                return None
            steps = [step for step in entry["path"] if step[0] > since_ms] or [entry["path"][-1]]
            answer = dict(entry["spec"])
            answer.update({"pair": pair, "account": self.account, "path": [list(step) for step in steps[-MAX_PATH:]]})
            return answer


def no(reason, **more):
    answer = {"ok": False, "reason": reason}
    answer.update(more)
    return answer


class Desk:
    """
    Her orders at the broker. Every method here speaks to the terminal, so each is run on the terminal's
    thread. Nothing here sends a market order, changes an order, or closes a trade.
    """

    def __init__(self, mt5, env, journal, clock=now_ms):
        self.mt5 = mt5
        self.env = env
        self.journal = journal
        self.clock = clock
        self.lots = centi_lots(env.get("LUMEN_FX_LOTS"), 1)
        self.risk = cents(env.get("LUMEN_FX_RISK_USD"), 300)

    def mine(self, symbol, order_id=None):
        """Her waiting orders and open trades in a symbol: those with her number, and with one order's note if an id is given."""
        tag = TAG + order_id if order_id else None
        found = []
        for item in list(self.mt5.orders_get(symbol=symbol) or ()) + list(self.mt5.positions_get(symbol=symbol) or ()):
            if int(getattr(item, "magic", 0)) == MAGIC and (tag is None or getattr(item, "comment", "") == tag):
                found.append(int(item.ticket))
        return found

    def remove(self, ticket):
        result = self.mt5.order_send({"action": number(self.mt5, "TRADE_ACTION_REMOVE"), "order": int(ticket)})
        return result is not None and int(result.retcode) == number(self.mt5, "TRADE_RETCODE_DONE")

    def place(self, ask):
        """
        Places one waiting limit order with its stop and its target, or says why not. Before it is sent
        the terminal checks it, and the terminal's own sum for the loss at the stop has to agree with the
        rule. After it is sent it is read back from the broker, and pulled if anything about it differs.
        """
        mt5 = self.mt5
        order_id = ask.get("id")
        if not isinstance(order_id, str) or not re.fullmatch(r"fx-[0-9a-f]{8}", order_id):
            return no("ID")
        # An id it has seen before is never sent again. It is told where that order stands.
        if self.journal.get(order_id) is not None:
            return self.state(order_id)
        pair, side = ask.get("pair"), ask.get("side")
        if pair not in PAIRS:
            return no("PAIR")
        if side not in ("buy", "sell"):
            return no("SIDE")
        size, limit, stop, target, loss = (ask.get(name) for name in ("centiLots", "limit", "stop", "target", "lossCents"))
        if not all(type(value) is int and value > 0 for value in (size, limit, stop, target, loss)):
            return no("LEVELS")
        up = 1 if side == "buy" else -1
        if (limit - stop) * up <= 0 or (target - limit) * up <= 0:
            return no("LEVELS")
        # The owner's rule, held here too: his size and no other. What it may lose at its stop is checked further
        # down, against the terminal's own sum and not against what the request says.
        if size != self.lots:
            return no("LOTS", allowed=self.lots)

        terminal, account = mt5.terminal_info(), mt5.account_info()
        if terminal is None or account is None or not getattr(terminal, "connected", False):
            return no("TERMINAL")
        if not getattr(terminal, "trade_allowed", False) or getattr(terminal, "tradeapi_disabled", False):
            return no("TRADING_OFF")
        if not getattr(account, "trade_allowed", False) or not getattr(account, "trade_expert", False):
            return no("ACCOUNT_OFF")
        # Her trade is followed by its ticket. On an account that nets every trade in a pair into one, that does not hold.
        if int(getattr(account, "margin_mode", -1)) != number(mt5, "ACCOUNT_MARGIN_MODE_RETAIL_HEDGING"):
            return no("NETTING")
        if str(getattr(account, "currency", "")).upper() not in DOLLARS:
            return no("CURRENCY", currency=str(getattr(account, "currency", "")))
        kind = ACCOUNT_KINDS.get(int(account.trade_mode), "unknown")
        symbol, _ = find_symbol(mt5, pair, self.env)
        info = mt5.symbol_info(symbol) if symbol else None
        if info is None:
            return no("SYMBOL")
        digits = int(info.digits)
        if digits != PAIRS[pair]["digits"] or abs(float(info.trade_contract_size) - PAIRS[pair]["contract"]) > 1e-9:
            return no("SPEC")
        scale = 10 ** digits
        volume = size / 100.0
        step = float(info.volume_step) or 0.01
        if volume < float(info.volume_min) - 1e-9 or volume > float(info.volume_max) + 1e-9 or abs(round(volume / step) * step - volume) > 1e-9:
            return no("LOTS", least=float(info.volume_min), step=step)
        allowed = int(getattr(info, "order_mode", 0))
        if not (allowed & 2 and allowed & 16 and allowed & 32):
            return no("ORDER_KIND", allowed=allowed)
        trading = int(getattr(info, "trade_mode", 0))
        if trading != 4 and not (trading == 1 and side == "buy") and not (trading == 2 and side == "sell"):
            return no("SYMBOL_OFF")
        # One order or trade of hers in a pair at a time, whatever the engine believes.
        if self.mine(symbol):
            return no("ALREADY")
        tick = mt5.symbol_info_tick(symbol)
        if tick is None or not tick.bid or not tick.ask:
            return no("NO_PRICE")
        bid, offer = int(round(tick.bid * scale)), int(round(tick.ask * scale))
        gap = max(1, int(info.trade_stops_level))
        # A limit order waits at a better price than the market. At the market or through it, it would be a market order.
        if (side == "buy" and offer - limit < gap) or (side == "sell" and limit - bid < gap):
            return no("FX_LIMIT", bid=bid, ask=offer)
        if abs(limit - stop) < gap or abs(target - limit) < gap:
            return no("LEVELS", least=gap)

        def price(points):
            return round(points / scale, digits)

        # The terminal's own sum for what this trade loses at its stop, in the account's money.
        told = mt5.order_calc_profit(number(mt5, "ORDER_TYPE_BUY" if side == "buy" else "ORDER_TYPE_SELL"), symbol, volume, price(limit), price(stop))
        if told is None:
            return no("SUM")
        terminal_cents = int(round(-float(told) * 100))
        if terminal_cents <= 0 or abs(terminal_cents - loss) > max(2, loss // 50) or terminal_cents > self.risk + 2:
            return no("RISK", terminalCents=terminal_cents, allowedCents=self.risk)

        life = int(getattr(info, "expiration_mode", 1))
        request = {
            "action": number(mt5, "TRADE_ACTION_PENDING"),
            "symbol": symbol,
            "volume": volume,
            "type": number(mt5, "ORDER_TYPE_BUY_LIMIT" if side == "buy" else "ORDER_TYPE_SELL_LIMIT"),
            "price": price(limit),
            "sl": price(stop),
            "tp": price(target),
            "deviation": 0,
            "magic": MAGIC,
            "comment": TAG + order_id,
            "type_time": number(mt5, "ORDER_TIME_GTC") if life & 1 or not life & 2 else number(mt5, "ORDER_TIME_DAY"),
            "type_filling": number(mt5, "ORDER_FILLING_RETURN"),
        }
        # The terminal checks the order before anything is sent. A waiting order is filled later, so MetaTrader's
        # rule for it is the "return" way of filling. A broker that will not have that is tried the other ways.
        for way in ("ORDER_FILLING_RETURN", "ORDER_FILLING_IOC", "ORDER_FILLING_FOK"):
            request["type_filling"] = number(mt5, way)
            checked = mt5.order_check(request)
            if checked is None:
                return no("CHECK")
            code = int(checked.retcode)
            if code in (0, number(mt5, "TRADE_RETCODE_DONE")):
                break
            if code != number(mt5, "TRADE_RETCODE_INVALID_FILL"):
                return no("BROKER_%d" % code, brokerSays=str(getattr(checked, "comment", ""))[:80])
        else:
            return no("BROKER_%d" % number(mt5, "TRADE_RETCODE_INVALID_FILL"))

        entry = {"state": "sending", "at": self.clock(), "pair": pair, "symbol": symbol, "side": side, "centiLots": size, "limit": limit, "stop": stop, "target": target, "account": kind}
        self.journal.put(order_id, entry)
        result = mt5.order_send(request)
        code = int(result.retcode) if result is not None else None
        ticket = int(getattr(result, "order", 0) or 0) if result is not None else 0
        taken = (number(mt5, "TRADE_RETCODE_DONE"), number(mt5, "TRADE_RETCODE_PLACED"))
        if code in taken and ticket > 0:
            pass
        elif result is None or code in taken or code in (number(mt5, "TRADE_RETCODE_TIMEOUT"), number(mt5, "TRADE_RETCODE_ERROR")):
            # No clear word, or a yes with no ticket. It is looked for at the broker by its note, and never sent a second time.
            found = self.mine(symbol, order_id)
            if not found:
                entry["state"] = "unknown"
                self.journal.put(order_id, entry)
                return no("UNKNOWN", id=order_id)
            ticket = found[0]
        else:
            entry.update({"state": "refused", "reason": "BROKER_%d" % code})
            self.journal.put(order_id, entry)
            return no("BROKER_%d" % code, id=order_id, brokerSays=str(getattr(result, "comment", ""))[:80])
        entry.update({"state": "placed", "ticket": ticket})
        self.journal.put(order_id, entry)

        wrong = self.read_back(ticket, symbol, side, volume, limit, stop, target, scale)
        if wrong:
            waiting = bool(mt5.orders_get(ticket=ticket))
            pulled = waiting and self.remove(ticket)
            entry.update({"state": "cancelled" if pulled else "unknown", "reason": "READBACK"})
            self.journal.put(order_id, entry)
            print("ORDER %s READ BACK WRONG (%s). %s" % (order_id, wrong, "It was pulled." if pulled else "IT COULD NOT BE PULLED. Look at ticket %d in the terminal." % ticket), flush=True)
            return no("READBACK" if pulled else "READBACK_STUCK", id=order_id, what=wrong, ticket=str(ticket))
        return self.state(order_id)

    def read_back(self, ticket, symbol, side, volume, limit, stop, target, scale):
        """What differs between the order as the broker now holds it and the order that was sent. Nothing, if nothing does."""
        mt5 = self.mt5
        for _ in range(6):
            orders = mt5.orders_get(ticket=ticket) or ()
            positions = () if orders else (mt5.positions_get(ticket=ticket) or ())
            if orders or positions:
                break
            time.sleep(0.1)
        if orders:
            held = orders[0]
            kind = number(mt5, "ORDER_TYPE_BUY_LIMIT" if side == "buy" else "ORDER_TYPE_SELL_LIMIT")
            facts = [("type", int(held.type) == kind), ("size", abs(float(held.volume_initial) - volume) < 1e-9), ("price", int(round(held.price_open * scale)) == limit)]
        elif positions:
            # Her price came in the instant after it was placed. It is a trade already.
            held = positions[0]
            facts = [("type", int(held.type) == (0 if side == "buy" else 1)), ("size", abs(float(held.volume) - volume) < 1e-9)]
        else:
            # Neither waiting nor open. `state` reads the broker's history and says what became of it.
            return None
        facts += [("symbol", held.symbol == symbol), ("stop", int(round(held.sl * scale)) == stop), ("target", int(round(held.tp * scale)) == target)]
        return ", ".join(name for name, same in facts if not same) or None

    def state(self, order_id):
        """Where one of her orders stands at the broker: none, unknown, refused, resting, open, closed or cancelled."""
        mt5 = self.mt5
        if not isinstance(order_id, str) or not re.fullmatch(r"fx-[0-9a-f]{8}", order_id):
            return no("ID")
        entry = self.journal.get(order_id)
        if entry is None:
            # Not in the journal. If the journal was lost, the order may still be at the broker under its note.
            for pair in PAIRS:
                symbol, _ = find_symbol(mt5, pair, self.env)
                found = self.mine(symbol, order_id) if symbol else []
                if found:
                    entry = {"state": "placed", "at": self.clock(), "pair": pair, "symbol": symbol, "ticket": found[0], "found": True}
                    self.journal.put(order_id, entry)
                    break
            if entry is None:
                return {"ok": True, "id": order_id, "status": "none"}
        if entry.get("state") == "refused":
            return {"ok": True, "id": order_id, "status": "refused", "reason": entry.get("reason", "")}
        if not entry.get("ticket"):
            found = self.mine(entry.get("symbol", ""), order_id)
            if not found:
                # Sent, with no clear word back, and not at the broker. After a minute it is taken as never having arrived.
                return {"ok": True, "id": order_id, "status": "none" if self.clock() - int(entry.get("at", 0)) > 60_000 else "unknown"}
            entry.update({"state": "placed", "ticket": found[0]})
            self.journal.put(order_id, entry)
        ticket = int(entry["ticket"])
        scale = 10 ** PAIRS[entry.get("pair", "AUDUSD")]["digits"]
        answer = {"ok": True, "id": order_id, "ticket": str(ticket)}
        for name in ("account", "side", "centiLots", "limit", "stop", "target"):
            if name in entry:
                answer[name] = entry[name]

        def points(value):
            return int(round(float(value) * scale))

        if mt5.orders_get(ticket=ticket):
            answer["status"] = "resting"
            return answer
        positions = mt5.positions_get(ticket=ticket) or ()
        if positions:
            answer.update({"status": "open", "fill": points(positions[0].price_open)})
            return answer
        deals = list(mt5.history_deals_get(position=ticket) or ())
        entered = number(mt5, "DEAL_ENTRY_IN")
        left = (number(mt5, "DEAL_ENTRY_OUT"), number(mt5, "DEAL_ENTRY_INOUT"), number(mt5, "DEAL_ENTRY_OUT_BY"))
        forced = (number(mt5, "DEAL_REASON_SL"), number(mt5, "DEAL_REASON_TP"), number(mt5, "DEAL_REASON_SO"))
        ins = [deal for deal in deals if int(deal.entry) == entered]
        outs = [deal for deal in deals if int(deal.entry) in left or (int(deal.entry) != entered and int(deal.reason) in forced)]
        if outs:
            last = outs[-1]
            why = "stop" if int(last.reason) == number(mt5, "DEAL_REASON_SL") else "target" if int(last.reason) == number(mt5, "DEAL_REASON_TP") else "other"
            cost = sum(float(deal.commission) + float(deal.swap) + float(getattr(deal, "fee", 0.0)) for deal in deals)
            made = sum(float(deal.profit) for deal in deals)
            # The result is the broker's own figure: what the trade made, with its commission, its swap and its fee taken off.
            answer.update({"status": "closed", "exit": points(last.price), "exitWhy": why, "resultCents": int(round((made + cost) * 100)), "costCents": int(round(cost * 100))})
            if ins:
                answer["fill"] = points(ins[0].price)
            return answer
        if ins:
            # It was filled, and the broker's history has no close for it yet.
            answer.update({"status": "open", "fill": points(ins[0].price)})
            return answer
        if entry.get("state") == "cancelled":
            answer["status"] = "cancelled"
            return answer
        past = mt5.history_orders_get(ticket=ticket) or ()
        ended = (number(mt5, "ORDER_STATE_CANCELED"), number(mt5, "ORDER_STATE_REJECTED"), number(mt5, "ORDER_STATE_EXPIRED"))
        answer["status"] = "cancelled" if past and int(past[0].state) in ended else "unknown"
        return answer

    def cancel(self, order_id):
        """Pulls an order that is still waiting. A trade that is already open is not touched: it has its stop and its target."""
        now = self.state(order_id)
        if now.get("status") != "resting":
            return now
        if self.remove(int(now["ticket"])):
            entry = self.journal.get(order_id) or {}
            entry["state"] = "cancelled"
            self.journal.put(order_id, entry)
        return self.state(order_id)


class Door:
    """Who may ask. A request is let in once, if it is signed with the secret and fresh."""

    def __init__(self, secret, clock=now_ms):
        self.secret = secret
        self.clock = clock
        self.lock = threading.Lock()
        self.seen = {}

    def admit(self, body, signature):
        if not hmac.compare_digest(sign(self.secret, body).encode("ascii"), (signature or "").encode("utf-8", "replace")):
            return None
        try:
            ask = json.loads(body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return None
        if not isinstance(ask, dict):
            return None
        nonce, issued, now = ask.get("nonce"), ask.get("issuedAtMs"), self.clock()
        if not isinstance(nonce, str) or not re.fullmatch(r"[0-9a-f]{32}", nonce):
            return None
        if type(issued) is not int or abs(now - issued) > FRESH_MS:
            return None
        with self.lock:
            for old in [key for key, at in self.seen.items() if now - at > 2 * FRESH_MS]:
                del self.seen[old]
            if nonce in self.seen or len(self.seen) > 50_000:
                return None
            self.seen[nonce] = now
        return ask


class Handler(BaseHTTPRequestHandler):
    server_version = "ZooraBridge/2"
    sys_version = ""
    timeout = 5

    def log_message(self, *args):
        # Nothing about a request is written anywhere.
        pass

    def answer(self, status, payload):
        raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(raw)))
        self.send_header("x-lumen-signature", sign(self.server.door.secret, raw))
        self.end_headers()
        self.wfile.write(raw)

    def refuse(self, status):
        self.send_response(status)
        self.send_header("content-length", "0")
        self.end_headers()

    def do_POST(self):
        try:
            length = int(self.headers.get("content-length") or 0)
        except ValueError:
            length = 0
        if self.path != "/" or length <= 0 or length > MAX_BODY:
            return self.refuse(400)
        ask = self.server.door.admit(self.rfile.read(length), self.headers.get("x-lumen-signature"))
        if ask is None:
            return self.refuse(401)
        nonce, what = ask["nonce"], ask.get("instruction")
        feed, desk = self.server.feed, self.server.desk
        if what == "quote":
            pair = ask.get("pair")
            if pair not in PAIRS:
                return self.answer(400, {"ok": False, "reason": "PAIR", "nonce": nonce})
            since = ask.get("sinceMs")
            quote = feed.quote(pair, since if type(since) is int and since >= 0 else 0)
            if quote is None:
                return self.answer(503, {"ok": False, "reason": "NO_PRICE", "nonce": nonce})
            payload = {"ok": True, "nonce": nonce}
            payload.update(quote)
            return self.answer(200, payload)
        work = {"place": lambda: desk.place(ask), "state": lambda: desk.state(ask.get("id")), "cancel": lambda: desk.cancel(ask.get("id"))}.get(what)
        if work is None:
            # Anything else, a market order or a close among them, has nothing here to carry it out.
            return self.answer(400, {"ok": False, "reason": "INSTRUCTION", "nonce": nonce})
        out = feed.ask(work)
        if out is None:
            # The terminal did not answer in time. Whether an order went is not known here, and `state` will say.
            return self.answer(504, {"ok": False, "reason": "UNKNOWN", "nonce": nonce})
        out = dict(out)
        out["nonce"] = nonce
        return self.answer(200 if out.get("ok") else 409, out)


def flags(value, names):
    return ", ".join(name for bit, name in names if int(value) & bit) or "none"


def check(mt5, env, out=print, watch_seconds=3.0):
    """Prints what the terminal shows, and what it says to an order like hers. It sends nothing."""
    terminal = mt5.terminal_info()
    account = mt5.account_info()
    if terminal is None or account is None:
        out("The terminal answered, but it is not logged in to an account. Log in inside MetaTrader 5 and run this again.")
        return 1
    login = str(getattr(account, "login", ""))
    out("terminal: %s, build %s, connected to the broker: %s" % (getattr(terminal, "name", "?"), getattr(terminal, "build", "?"), "yes" if getattr(terminal, "connected", False) else "NO"))
    out("account: %s on %s, ending %s" % (ACCOUNT_KINDS.get(int(account.trade_mode), "unknown").upper(), getattr(account, "server", "?"), login[-3:] if len(login) > 3 else "?"))
    out("account currency: %s, leverage 1:%s, positions: %s" % (getattr(account, "currency", "?"), getattr(account, "leverage", "?"), {0: "netting", 1: "exchange", 2: "hedging"}.get(int(getattr(account, "margin_mode", -1)), "unknown")))
    out("programs may trade: terminal %s, account %s, account by program %s" % tuple("yes" if getattr(owner, name, False) else "NO" for owner, name in ((terminal, "trade_allowed"), (account, "trade_allowed"), (account, "trade_expert"))))
    # Tools, Options, Expert Advisors has a box that shuts trading by Python off. It has to be clear for her orders.
    blocked = getattr(terminal, "tradeapi_disabled", None)
    out("trading by Python switched off in the terminal: %s. Closing oldest first only: %s" % ("unknown" if blocked is None else "YES" if blocked else "no", "yes" if getattr(account, "fifo_close", False) else "no"))
    desk = Desk(mt5, env, None)
    out("the owner's rule held by this bridge: %.2f lot a trade, no more than %.2f lost at its stop" % (desk.lots / 100.0, desk.risk / 100.0))
    status = 0
    for pair in PAIRS:
        symbol, names = find_symbol(mt5, pair, env)
        info = mt5.symbol_info(symbol) if symbol else None
        if info is None:
            out("%s: NOT FOUND in this terminal. Names seen: %s" % (pair, ", ".join(names) or "none"))
            status = 1
            continue
        if not getattr(info, "visible", True):
            # A pair outside Market Watch has no live price and some of its figures are blank. It is added, and read again.
            mt5.symbol_select(symbol, True)
            time.sleep(0.5)
            info = mt5.symbol_info(symbol) or info
        out("%s is called %s here. Other names seen: %s" % (pair, symbol, ", ".join(name for name in names if name != symbol) or "none"))
        out("  digits %s, one lot %s %s, lots from %s in steps of %s" % (info.digits, ("%f" % info.trade_contract_size).rstrip("0").rstrip("."), getattr(info, "currency_base", ""), info.volume_min, info.volume_step))
        out("  least distance for an order, a stop or a target: %s points. Frozen within: %s points" % (info.trade_stops_level, getattr(info, "trade_freeze_level", "?")))
        out("  trading: %s (%s). Execution: %s (%s)" % ({0: "disabled", 1: "buy only", 2: "sell only", 3: "close only", 4: "full"}.get(int(getattr(info, "trade_mode", -1)), "unknown"), getattr(info, "trade_mode", "?"), {0: "request", 1: "instant", 2: "market", 3: "exchange"}.get(int(getattr(info, "trade_exemode", -1)), "unknown"), getattr(info, "trade_exemode", "?")))
        out("  orders allowed: %s (%s)" % (flags(getattr(info, "order_mode", 0), ((1, "market"), (2, "limit"), (4, "stop"), (8, "stop-limit"), (16, "stop loss"), (32, "take profit"), (64, "close by"))), getattr(info, "order_mode", "?")))
        out("  filling: %s (%s). Order life: %s (%s)" % (flags(getattr(info, "filling_mode", 0), ((1, "fill or kill"), (2, "immediate or cancel"), (4, "book or cancel"))), getattr(info, "filling_mode", "?"), flags(getattr(info, "expiration_mode", 0), ((1, "until cancelled"), (2, "day"), (4, "until a time"), (8, "until a day"))), getattr(info, "expiration_mode", "?")))
        tick = mt5.symbol_info_tick(symbol)
        for _ in range(8):
            if tick is not None and tick.bid and tick.ask:
                break
            time.sleep(0.25)
            tick = mt5.symbol_info_tick(symbol)
        if tick is None or not tick.bid or not tick.ask:
            out("  price: none yet. Open the pair in Market Watch and run this again.")
            status = 1
        else:
            pip = 10 * float(info.point)
            out("  last price: bid %.*f, ask %.*f, spread %.1f pips. If the market is shut this is its last price, however old." % (info.digits, tick.bid, info.digits, tick.ask, (tick.ask - tick.bid) / pip))
            # The bridge passes on a price only once it has seen it change. This is that same reading, for a few seconds.
            changes, last, until = 0, (int(tick.time_msc), float(tick.bid), float(tick.ask)), time.monotonic() + watch_seconds
            while time.monotonic() < until:
                time.sleep(SAMPLE_SECONDS)
                seen = mt5.symbol_info_tick(symbol)
                key = (int(seen.time_msc), float(seen.bid), float(seen.ask)) if seen is not None else last
                if key != last:
                    changes, last = changes + 1, key
            if changes:
                out("  watched for %.1f seconds: the price changed %d times. The market is open." % (watch_seconds, changes))
            else:
                out("  watched for %.1f seconds: the price did not change. The market is shut, or this pair is not being updated. An order cannot be placed until it is open." % watch_seconds)
            # What the terminal itself says to an order like hers, without sending one: her size, a buy limit 300 pips under
            # the market, a stop where the rule's money is lost and a target as far the other way.
            scale = 10 ** int(info.digits)
            away = int(desk.risk * scale / (desk.lots * float(info.trade_contract_size))) if desk.lots * float(info.trade_contract_size) else 0
            limit = int(round(tick.bid * scale)) - 3000
            if away > 0 and limit - away > 0:
                volume = desk.lots / 100.0
                told = mt5.order_calc_profit(number(mt5, "ORDER_TYPE_BUY"), symbol, volume, round(limit / scale, int(info.digits)), round((limit - away) / scale, int(info.digits)))
                if told is None:
                    out("  the terminal's own sum for a loss of %d pips on %.2f lot: IT GAVE NONE" % (away // 10, volume))
                    status = 1
                else:
                    out("  the terminal's own sum for a loss of %.1f pips on %.2f lot: %.2f %s" % (away / 10.0, volume, float(told), getattr(account, "currency", "")))
                    if abs(-float(told) * 100 - desk.risk) > max(2, desk.risk // 50):
                        out("  THAT IS NOT the rule's %.2f. Her orders would be refused here." % (desk.risk / 100.0))
                        status = 1
                request = {"action": number(mt5, "TRADE_ACTION_PENDING"), "symbol": symbol, "volume": volume, "type": number(mt5, "ORDER_TYPE_BUY_LIMIT"), "price": round(limit / scale, int(info.digits)), "sl": round((limit - away) / scale, int(info.digits)), "tp": round((limit + away) / scale, int(info.digits)), "deviation": 0, "magic": MAGIC, "comment": TAG + "check", "type_time": number(mt5, "ORDER_TIME_GTC"), "type_filling": number(mt5, "ORDER_FILLING_RETURN")}
                checked = mt5.order_check(request)
                if checked is None:
                    out("  asked whether it would take a %.2f-lot buy limit with a stop and a target: IT DID NOT ANSWER (%s)" % (volume, mt5.last_error(),))
                    status = 1
                else:
                    fine = int(checked.retcode) in (0, number(mt5, "TRADE_RETCODE_DONE"))
                    out("  asked whether it would take a %.2f-lot buy limit with a stop and a target: %s (%s %s). Nothing was sent." % (volume, "yes" if fine else "NO", checked.retcode, str(getattr(checked, "comment", ""))[:60]))
                    if not fine:
                        status = 1
        # What the broker itself says one pip is worth, to set against the owner's rule: 0.01 lot, 30 pips, three dollars.
        size, value = float(getattr(info, "trade_tick_size", 0) or 0), float(getattr(info, "trade_tick_value", 0) or 0)
        if size > 0 and value > 0:
            pip_cents = value * (10 * float(info.point) / size) * 0.01 * 100
            out("  on 0.01 lot one pip is %.2f cents here, so 30 pips is %.2f %s" % (pip_cents, pip_cents * 30 / 100, getattr(account, "currency", "")))
            if int(info.digits) != PAIRS[pair]["digits"] or abs(float(info.trade_contract_size) - PAIRS[pair]["contract"]) > 1e-9 or abs(pip_cents - 10.0) > 0.05:
                out("  THIS IS NOT what her book assumes (5 digits, 100000 a lot, 10 cents a pip). Her orders would be refused here.")
                status = 1
    out("check: %s" % ("ok" if status == 0 else "something above needs a look"))
    return status


def prove(mt5, env, out=print):
    """
    Places one real order, of her size, 300 pips under the market where it cannot be filled, with its stop
    and its target. Reads it back from the broker, pulls it, and looks again. It goes down the same road
    as every order of hers, so what it prints is what that road does on this account.
    """
    try:
        journal = Journal(journal_path(env))
    except ValueError:
        out("The journal at %s cannot be read. Move it aside and run this again." % journal_path(env))
        return 2
    desk = Desk(mt5, env, journal)
    account = mt5.account_info()
    out("account: %s on %s" % (ACCOUNT_KINDS.get(int(account.trade_mode), "unknown").upper() if account is not None else "NONE", getattr(account, "server", "?")))
    pair = next(iter(PAIRS))
    symbol, _ = find_symbol(mt5, pair, env)
    info = mt5.symbol_info(symbol) if symbol else None
    if info is not None and not getattr(info, "visible", True):
        mt5.symbol_select(symbol, True)
        time.sleep(0.5)
    tick = mt5.symbol_info_tick(symbol) if symbol else None
    if info is None or tick is None or not tick.bid:
        out("No price for %s in this terminal. Run --check first." % pair)
        return 1
    scale = 10 ** int(info.digits)
    away = int(desk.risk * scale / (desk.lots * float(info.trade_contract_size)))
    limit = int(round(tick.bid * scale)) - 3000
    order_id = "fx-" + secrets.token_hex(4)
    ask = {"id": order_id, "pair": pair, "side": "buy", "centiLots": desk.lots, "limit": limit, "stop": limit - away, "target": limit + away, "lossCents": int(round(away * desk.lots * float(info.trade_contract_size) / scale))}
    out("1. placing a real %.2f-lot buy limit at %.*f, 300 pips under the market, stop %.*f, target %.*f" % (desk.lots / 100.0, info.digits, limit / scale, info.digits, (limit - away) / scale, info.digits, (limit + away) / scale))
    placed = desk.place(ask)
    if not placed.get("ok") or placed.get("status") != "resting":
        out("   NOT PLACED: %s" % json.dumps(placed, sort_keys=True))
        return 1
    out("   the broker holds it: ticket %s, read back with the same price, stop and target" % placed.get("ticket"))
    again = desk.place(ask)
    out("2. asked to place the same order again: %s" % ("it was not sent twice" if again.get("ticket") == placed.get("ticket") and len(desk.mine(symbol)) == 1 else "SOMETHING IS WRONG: %s" % json.dumps(again, sort_keys=True)))
    pulled = desk.cancel(order_id)
    out("3. pulling it: %s" % ("pulled" if pulled.get("status") == "cancelled" else "NOT PULLED: %s. Look at ticket %s in the terminal." % (json.dumps(pulled, sort_keys=True), placed.get("ticket"))))
    left = desk.mine(symbol)
    out("4. her orders left at the broker in %s: %d" % (symbol, len(left)))
    fine = pulled.get("status") == "cancelled" and not left and again.get("ticket") == placed.get("ticket")
    out("prove: %s" % ("ok. The road her orders take works on this account." if fine else "something above needs a look"))
    return 0 if fine else 1


def serve(mt5, env, out=print):
    secret = env.get("LUMEN_FX_BRIDGE_SECRET") or ""
    if len(secret) < 32:
        out("Set LUMEN_FX_BRIDGE_SECRET to at least 32 characters, the same value the engine has. Nothing was started.")
        return 2
    try:
        port = int(env.get("LUMEN_FX_BRIDGE_PORT") or 8765)
    except ValueError:
        out("LUMEN_FX_BRIDGE_PORT is not a number. Nothing was started.")
        return 2
    try:
        journal = Journal(journal_path(env))
    except ValueError:
        # A record that cannot be read is not guessed at: an order might be sent twice.
        out("The journal at %s cannot be read. Move it aside and start again. Nothing was started." % journal_path(env))
        return 2
    feed = Feed(mt5, env)
    feed.refresh()
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    server.feed = feed
    server.desk = Desk(mt5, env, journal)
    server.door = Door(secret)
    web = threading.Thread(target=server.serve_forever, daemon=True)
    web.start()
    with feed.lock:
        names = ", ".join("%s as %s" % (pair, entry["spec"]["symbol"]) for pair, entry in feed.pairs.items()) or "no pair found"
        account = feed.account or "no account"
    out("Bridge on http://127.0.0.1:%d. %s account. %s. LIVE: her orders go to the broker, %.2f lot each. Ctrl+C stops it." % (port, account.upper(), names, server.desk.lots / 100.0))
    stop = threading.Event()
    try:
        # The terminal is spoken to from this thread only.
        feed.run(stop)
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        server.shutdown()
        server.server_close()
    out("Bridge stopped. Orders and trades already at the broker stay there, with their stops and targets.")
    return 0


def main(argv, env=os.environ, out=print):
    try:
        import MetaTrader5 as mt5
    except ImportError:
        out("The MetaTrader5 package is not installed. It runs on Windows only: pip install MetaTrader5")
        return 2
    path = (env.get("LUMEN_MT5_TERMINAL") or "").strip()
    if not (mt5.initialize(path) if path else mt5.initialize()):
        out("Could not attach to a MetaTrader 5 terminal: %s. Install it, open it, log in to the account, and run this again." % (mt5.last_error(),))
        return 2
    try:
        if "--prove" in argv:
            return prove(mt5, env, out)
        if "--check" not in argv:
            return serve(mt5, env, out)
        try:
            watch = min(60.0, max(0.0, float(env.get("LUMEN_FX_CHECK_SECONDS") or 3)))
        except ValueError:
            watch = 3.0
        return check(mt5, env, out, watch)
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
