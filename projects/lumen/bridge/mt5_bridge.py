#!/usr/bin/env python3
"""
Zoora's price bridge for MetaTrader 5. It reads prices. It cannot trade.

Run it on the Windows computer where the MetaTrader 5 terminal is installed and logged in to the broker
account. It attaches to that terminal, so it holds no account number and no password: the terminal does.

It listens on this computer only (127.0.0.1) and answers one instruction, "quote", for the pairs in PAIRS.
A request must carry an HMAC-SHA256 of its body made with LUMEN_FX_BRIDGE_SECRET, a nonce the bridge has
not seen, and a send time within a minute. An answer is signed the same way and carries the request's
nonce, so the engine can tell it came from here and is not an old answer played back.

Nothing in this file places, changes, closes or cancels an order, moves money, or logs in to an account.
A test (tests/fxBridge.test.ts) fails if such a call is added.

    python mt5_bridge.py --check     print what the terminal shows, then stop
    python mt5_bridge.py             serve prices until Ctrl+C

Settings, read from the environment:

    LUMEN_FX_BRIDGE_SECRET   shared with the engine, at least 32 characters. Needed to serve.
    LUMEN_FX_BRIDGE_PORT     the port on this computer. Unset is 8765.
    LUMEN_FX_SYMBOL_AUDUSD   the terminal's own name for AUDUSD, if the bridge picks the wrong one.
    LUMEN_MT5_TERMINAL       the path of terminal64.exe, if more than one terminal is installed.

See docs/FOREX.md.
"""
import hashlib
import hmac
import json
import os
import re
import sys
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# The pairs the engine may ask about. Her book trades AUDUSD first.
PAIRS = ("AUDUSD",)
# A request older or newer than this, by this computer's clock, is refused.
FRESH_MS = 60_000
# How often the terminal's latest price is read. Four times a second.
SAMPLE_SECONDS = 0.25
# How long a price change is kept, and the most that go into one answer.
KEEP_MS = 10 * 60_000
MAX_PATH = 1_200
MAX_BODY = 2_048
ACCOUNT_KINDS = {0: "demo", 1: "contest", 2: "real"}


def now_ms():
    return int(time.time() * 1000)


def sign(secret, body):
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


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


class Feed:
    """
    The terminal's prices. Every call into the terminal is made from one thread, the one that runs `run`.
    The web side only reads what that thread has stored.
    """

    def __init__(self, mt5, env, clock=now_ms):
        self.mt5 = mt5
        self.env = env
        self.clock = clock
        self.lock = threading.Lock()
        self.account = None
        self.pairs = {}

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
            stop.wait(max(0.0, SAMPLE_SECONDS - (time.monotonic() - started)))

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
    server_version = "ZooraPriceBridge/1"
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
        nonce = ask["nonce"]
        # The one thing this bridge does. An instruction to trade has nothing here to carry it out.
        if ask.get("instruction") != "quote":
            return self.answer(400, {"ok": False, "reason": "READ_ONLY", "nonce": nonce})
        pair = ask.get("pair")
        if pair not in PAIRS:
            return self.answer(400, {"ok": False, "reason": "PAIR", "nonce": nonce})
        since = ask.get("sinceMs")
        quote = self.server.feed.quote(pair, since if type(since) is int and since >= 0 else 0)
        if quote is None:
            return self.answer(503, {"ok": False, "reason": "NO_PRICE", "nonce": nonce})
        payload = {"ok": True, "nonce": nonce}
        payload.update(quote)
        return self.answer(200, payload)


def flags(value, names):
    return ", ".join(name for bit, name in names if int(value) & bit) or "none"


def check(mt5, env, out=print):
    """Prints what the terminal shows: the facts the engine's arithmetic, and the order half still to be built, depend on."""
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
    # Tools, Options, Expert Advisors has a box that shuts trading by Python off. The order half will need it clear.
    blocked = getattr(terminal, "tradeapi_disabled", None)
    out("trading by Python switched off in the terminal: %s. Closing oldest first only: %s" % ("unknown" if blocked is None else "YES" if blocked else "no", "yes" if getattr(account, "fifo_close", False) else "no"))
    status = 0
    for pair in PAIRS:
        symbol, names = find_symbol(mt5, pair, env)
        info = mt5.symbol_info(symbol) if symbol else None
        if info is None:
            out("%s: NOT FOUND in this terminal. Names seen: %s" % (pair, ", ".join(names) or "none"))
            status = 1
            continue
        if not getattr(info, "visible", True):
            mt5.symbol_select(symbol, True)
        out("%s is called %s here. Other names seen: %s" % (pair, symbol, ", ".join(name for name in names if name != symbol) or "none"))
        out("  digits %s, one lot %s %s, lots from %s in steps of %s" % (info.digits, ("%f" % info.trade_contract_size).rstrip("0").rstrip("."), getattr(info, "currency_base", ""), info.volume_min, info.volume_step))
        out("  least distance for an order, a stop or a target: %s points. Frozen within: %s points" % (info.trade_stops_level, getattr(info, "trade_freeze_level", "?")))
        out("  trading: %s (%s). Execution: %s (%s)" % ({0: "disabled", 1: "buy only", 2: "sell only", 3: "close only", 4: "full"}.get(int(getattr(info, "trade_mode", -1)), "unknown"), getattr(info, "trade_mode", "?"), {0: "request", 1: "instant", 2: "market", 3: "exchange"}.get(int(getattr(info, "trade_exemode", -1)), "unknown"), getattr(info, "trade_exemode", "?")))
        out("  orders allowed: %s (%s)" % (flags(getattr(info, "order_mode", 0), ((1, "market"), (2, "limit"), (4, "stop"), (8, "stop-limit"), (16, "stop loss"), (32, "take profit"), (64, "close by"))), getattr(info, "order_mode", "?")))
        out("  filling: %s (%s). Order life: %s (%s)" % (flags(getattr(info, "filling_mode", 0), ((1, "fill or kill"), (2, "immediate or cancel"), (4, "book or cancel"))), getattr(info, "filling_mode", "?"), flags(getattr(info, "expiration_mode", 0), ((1, "until cancelled"), (2, "day"), (4, "until a time"), (8, "until a day"))), getattr(info, "expiration_mode", "?")))
        tick = mt5.symbol_info_tick(symbol)
        if tick is None or not tick.bid or not tick.ask:
            out("  price: none yet. Open the pair in Market Watch and run this again.")
            status = 1
        else:
            pip = 10 * float(info.point)
            out("  last price: bid %.*f, ask %.*f, spread %.1f pips. If the market is shut this is its last price, however old." % (info.digits, tick.bid, info.digits, tick.ask, (tick.ask - tick.bid) / pip))
        # What the broker itself says one pip is worth, to set against the owner's rule: 0.01 lot, 30 pips, three dollars.
        size, value = float(getattr(info, "trade_tick_size", 0) or 0), float(getattr(info, "trade_tick_value", 0) or 0)
        if size > 0 and value > 0:
            pip_cents = value * (10 * float(info.point) / size) * 0.01 * 100
            out("  on 0.01 lot one pip is %.2f cents here, so 30 pips is %.2f %s" % (pip_cents, pip_cents * 30 / 100, getattr(account, "currency", "")))
            if int(info.digits) != 5 or abs(float(info.trade_contract_size) - 100000.0) > 1e-9 or abs(pip_cents - 10.0) > 0.05:
                out("  THIS IS NOT what her book assumes (5 digits, 100000 a lot, 10 cents a pip). The engine will not read these prices.")
                status = 1
    out("check: %s" % ("ok" if status == 0 else "something above needs a look"))
    return status


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
    feed = Feed(mt5, env)
    feed.refresh()
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    server.feed = feed
    server.door = Door(secret)
    web = threading.Thread(target=server.serve_forever, daemon=True)
    web.start()
    with feed.lock:
        names = ", ".join("%s as %s" % (pair, entry["spec"]["symbol"]) for pair, entry in feed.pairs.items()) or "no pair found"
        account = feed.account or "no account"
    out("Price bridge on http://127.0.0.1:%d. %s account. Reading %s. It cannot trade. Ctrl+C stops it." % (port, account.upper(), names))
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
    out("Price bridge stopped.")
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
        return check(mt5, env, out) if "--check" in argv else serve(mt5, env, out)
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
