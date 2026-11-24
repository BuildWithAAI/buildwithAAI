"""One paper-trading cycle. Order: (1) mark open positions / retry pending prices, (2) discover + score new
launches, (3) price entries and open positions, (4) equity snapshot. Simulation only: nothing here can trade."""
from __future__ import annotations
import json, os, queue, random, threading, time
from datetime import datetime
from zoneinfo import ZoneInfo
from . import costs as K
from .ledger import Ledger
from .sanitize import safe_field
from .prices import quotes as default_quotes
from . import gates as G
from .. import logging_setup as L
from .. import momentum as M
from .. import mayhem as MY
from . import edge as EG
from . import exits as X
from . import sigexit as SX

log = L.get("paper")
CT = ZoneInfo("America/Chicago")

START_BANKROLL = 1000.0
# Isolated $100 paper experiment (2026-11-05): own book + own DB; never mixes with the $1000 books.
EXPERIMENT100_BOOK = "experiment100"
START_BANKROLL_BY_BOOK = {EXPERIMENT100_BOOK: 100.0}
TAKE_PROFIT = 1.00          # +100% on market price vs entry price
STOP_LOSS = -0.50           # -50%
TIME_EXIT_S = 24 * 3600
DEAD_NO_PRICE_S = 24 * 3600  # no valid price for 24 h -> closed as -100%
ENTRY_MAX_DELAY_S = 1800    # a scored launch that cannot be priced within 30 min of its decision is 'unfilled'
DUMP_THRESHOLD = -0.50
BOOKS = {
    # name: (size fraction by decision, cash-constrained?)
    "strategy": ({"NORMAL": 0.02, "REDUCED": 0.01, "SKIP": 0.0}, True),
    "all": ({"NORMAL": 0.01, "REDUCED": 0.01, "SKIP": 0.01}, True),
    # every scored launch at a fixed $10 (1% of the starting bankroll), no cash limit: per-tier evidence
    "shadow": ({"NORMAL": 0.01, "REDUCED": 0.01, "SKIP": 0.01}, False),
}
# 'momentum' (A/B vs strategy, added 2026-11-03): non-SKIP coins ranked/sized by momentum + narrative, moon-bag exits,
# own $1,000 bankroll, same $30k market-cap floor. Not in BOOKS: its sizing and entries are decided in Cycle._momentum_*.
MOMENTUM_BOOK = "momentum"
# Shadow exit controls (Zoorped 2026-11-03): every momentum entry is mirrored, same $ size / tokens / entry price, into one
# book per control policy (smr/paper/exits.py). Own notional $1,000 each, never cash-limited, no events/alerts, and
# they never touch the momentum book's bankroll. Only the exit differs, so the books compare exits on identical entries.
CONTROL_BOOKS = {"momentum_ladder": "ladder", "momentum_x1": "x1"}
# Signal-driven silent controls (Zoorped 2026-11-04, smr/paper/sigexit.py): clip5 + rug rule + 5% dust, and SIG-HV. Same
# mirroring / no-alert rules as ladder and x1; marked every ~60 s by the exit watcher (smr/paper/watcher.py), which owns
# them while its lease is live. The 15-min cycle only steps them when the watcher is down (fallback).
CONTROL_BOOKS.update(SX.SIGNAL_BOOKS)
SIGNAL_BOOKS = tuple(SX.SIGNAL_BOOKS)
MOMENTUM_FAMILY = (MOMENTUM_BOOK, *CONTROL_BOOKS)
ALL_BOOKS = (*BOOKS, MOMENTUM_BOOK, *CONTROL_BOOKS)
# whole-market scanner book (smr/paper/scanner.py, own 5-min daemon): own $1,000, momentum sizing, clip5 + rug rule + 5% dust
# exits applied by the 1-min exit watcher (same step as momentum_clip5_rug_dust), and it DOES write BUY / PARTIAL_SELL / SELL events
SCANNER_BOOK = "scanner"
# experiment100: same clip5_rug_dust watcher path as scanner; separate DB keeps $1000 books frozen
STEP_BOOKS = (*SIGNAL_BOOKS, SCANNER_BOOK, EXPERIMENT100_BOOK)
EVENT_BOOKS = ("strategy", MOMENTUM_BOOK, SCANNER_BOOK, EXPERIMENT100_BOOK)
ALERT_SCANNER_BOOKS = (SCANNER_BOOK, EXPERIMENT100_BOOK)
# strategy book buys only at FDV >= this at entry (Zoorped, 2026-11-03); env SMR_PAPER_MIN_MCAP_USD or --min-mcap-usd
DEFAULT_MIN_MCAP_USD = 30_000.0
MCAP_RECHECK_S = 24 * 3600     # filtered_mcap launches are re-checked until 24 h after launch
MCAP_BOOKS = ("strategy",)
# Market cap for the floor (verified on-chain 2026-11-03, see docs/paper_trading.md). pump.fun Mayhem-mode coins mint
# 2B tokens: 1B into the bonding curve like every coin (same start price and start market cap) and 1B to pump.fun's
# Mayhem trading agent, which trades for <= 24 h and then BURNS everything it did not sell. The agent's inventory is not
# circulating, so market cap = price x (on-chain supply - agent balance), roughly price x 1B. Counting the agent's
# billion doubled Mayhem market caps vs DexScreener/pump.fun/StalkChain and let ~$15k coins pass the $30k floor.
MAYHEM_AGENT = "BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s"   # Sol Vault / agent wallet, pump.fun/docs/mayhem-mode
PUMP_CURVE_SUPPLY = 1e9
MAYHEM_PREBURN_MIN_SUPPLY = 1.5e9   # on-chain supply this high = Mayhem agent billion not burned yet
# Mayhem entry gate (Zoorped 2026-11-03 12:27 CST, "stay out of Mayhem mode trades"): the alerted books never ENTER a coin
# detected as Mayhem mode, and a coin whose Mayhem status is unknown is skipped too (conservative). The benchmark books
# ('all', 'shadow') still buy it, with the flag recorded on launches.mayhem / positions.mayhem for the comparison.
# Detection: smr/mayhem.py (curve account is_mayhem_mode flag, create tx, supply > 1B, agent balance).
MAYHEM_GATED_BOOKS = ("strategy", MOMENTUM_BOOK)
MAYHEM_RESOLVE_PER_CYCLE = 60        # waiting/watching/unchecked launches resolved per cycle (one getAccountInfo each)
DEFAULT_END = datetime(2026, 11, 10, 23, 59, 59, tzinfo=CT).timestamp()   # no new entries after this


def dex_url(mint):
    return f"https://dexscreener.com/solana/{mint}"


def iso_ct(ts):
    return datetime.fromtimestamp(ts, CT).strftime("%Y-%m-%d %H:%M %Z") if ts else None


def fmt_usd(x, digits=2):
    if x is None:
        return "n/a"
    return f"${x:,.{digits}f}"


def fmt_px(x):
    return "n/a" if x is None else f"${x:.4g}"


class _NoPumpFun:
    """pump.fun's frontend API is Cloudflare-blocked (403); paper trading never calls it (no bypass attempts)."""
    class _H:
        def snapshot(self):
            return {"disabled": "paper trading does not call the pump.fun frontend API (Cloudflare 403)"}
    h = _H()

    def _no(self, *a, **k):
        raise RuntimeError("pump.fun frontend API disabled in paper trading (Cloudflare 403)")
    coin = latest_coins = created_by = _no


# ---------------------------------------------------------------------------------------------------------------
# book accounting
def start_bankroll_for(book):
    """Per-book starting cash. experiment100 = $100; everything else keeps the $1000 default."""
    return float(START_BANKROLL_BY_BOOK.get(book, START_BANKROLL))


def book_state(led, book):
    """Bankroll = start + realized PnL. A moon-bag partial sell (momentum book) realizes partial_pnl_usd on the sold
    fraction and frees its cost basis; for every other book the partial columns are NULL, so nothing changes there.
    Cash = bankroll - open cost (open principal is not spendable). External deposits are not modeled; gains = closed
    net PnL after the paper cost model only.

    experiment100 fixed Solana fees (forward-only): open positions with fee_model_version set debit entry_fixed_fee_usd
    from bankroll (clip exit fees are already netted into partial_pnl_usd). rent_locked_usd reduces free cash only
    (still owned capital until forfeited on dust-close or recovered on full exit). Legacy rows (null version) unchanged."""
    start = start_bankroll_for(book)
    r = led.one("SELECT COALESCE(SUM(pnl_usd),0) AS realized, COUNT(*) AS n FROM positions WHERE book=? AND status='closed' AND void_reason IS NULL", (book,))
    o = led.one("SELECT COALESCE(SUM(size_usd * (1 - COALESCE(partial_frac, 0))),0) AS open_cost, COALESCE(SUM(COALESCE(partial_pnl_usd, 0)),0) AS partial, "
                "COALESCE(SUM(CASE WHEN fee_model_version IS NOT NULL THEN COALESCE(entry_fixed_fee_usd, 0) ELSE 0 END),0) AS entry_fees, "
                "COALESCE(SUM(CASE WHEN fee_model_version IS NOT NULL THEN COALESCE(rent_locked_usd, 0) ELSE 0 END),0) AS rent_locked, "
                "COUNT(*) AS n FROM positions WHERE book=? AND status='open' AND void_reason IS NULL", (book,))
    bankroll = start + r["realized"] + o["partial"] - (o["entry_fees"] or 0)
    open_cost = o["open_cost"]
    rent_locked = o["rent_locked"] or 0
    return {"bankroll": bankroll, "start": start, "realized": r["realized"] + o["partial"] - (o["entry_fees"] or 0),
            "open_cost": open_cost, "rent_locked_usd": rent_locked, "entry_fixed_fees_open_usd": o["entry_fees"] or 0,
            "open": o["n"], "cash": bankroll - open_cost - rent_locked}


def safe_reason(t, max_len=160):
    """Rule reasons are our own text but may quote data; keep comparison signs readable through the sanitizer."""
    t = str(t or "")
    for a, b in (("<=", " at most "), (">=", " at least "), ("<", " under "), (">", " over ")):
        t = t.replace(a, b)
    return safe_field(t, max_len=max_len)


def circulating_supply(supply, agent_balance=None):
    """Circulating supply for the market cap: on-chain supply minus tokens held by the Mayhem agent (burned when Mayhem
    ends). Agent balance unknown and supply still ~2B (pre-burn Mayhem) -> the 1B bonding-curve supply, which is what
    pump.fun and DexScreener use and errs low (the agent sells ~5% of its billion on average), never high."""
    if not supply:
        return None
    if agent_balance is not None and 0 <= agent_balance < supply:
        return supply - agent_balance
    if supply >= MAYHEM_PREBURN_MIN_SUPPLY:
        return PUMP_CURVE_SUPPLY
    return supply


def fdv_of(quote, supply, circ=None):
    """Market cap used for the floor = price x circulating supply (see MAYHEM_AGENT). `circ` is the circulating supply
    measured at gate time; without it the on-chain `supply` is used, capped at 1B for pre-burn Mayhem coins. No supply:
    DexScreener marketCap (1B basis) before GeckoTerminal fdv (counts the Mayhem agent's billion)."""
    if quote is None:
        return None
    s = circ or circulating_supply(supply)
    if s:
        return quote.price_usd * s
    return quote.mcap_usd or quote.fdv_usd


def _reasons(top):
    return [safe_field(t, max_len=160) for t in (json.loads(top) if isinstance(top, str) else top or [])[:3]]


def _buy_payload(led, pos, launch):
    return {"kind": "BUY", "book": pos["book"], "position_id": pos["id"], "mint": pos["mint"], "dexscreener_url": dex_url(pos["mint"]),
            "symbol": launch.get("symbol") or "", "name": launch.get("name") or "",
            "decision": pos["decision"], "asof_decision": launch.get("asof_decision") or pos["decision"],
            "gate_reasons": _reasons(launch.get("gate_reasons")), "score": pos["score"], "top_reasons": _reasons(launch.get("top_reasons")),
            "entry_at": pos["entry_at"], "entry_at_ct": iso_ct(pos["entry_at"]),
            "entry_price_usd": pos["entry_price"], "entry_mcap_usd": pos["entry_mcap"],
            "mcap_basis": "price x circulating supply (on-chain supply minus Mayhem agent tokens)" if launch.get("supply")
                          else "DexScreener marketCap / GeckoTerminal fdv",
            "token_supply": launch.get("supply"), "circulating_supply": launch.get("circ_supply"), "price_vs_launch": launch.get("price_vs_launch"),
            "size_usd": round(pos["size_usd"], 2), "size_pct_of_bankroll": round(pos["size_pct"] * 100, 2),
            "bankroll_at_entry": round(pos["bankroll_at_entry"], 2), "liquidity_usd": pos["entry_liq"],
            "holder_count": launch.get("gate_holders") if launch.get("gate_holders") is not None else launch.get("holder_count"),
            "holder_source": launch.get("holder_source"), "entry_cost_pct": round(pos["entry_cost"] * 100, 2),
            "price_source": launch.get("entry_source"), "entry_trigger": launch.get("entry_trigger") or "first_price",
            "mcap_at_cross_usd": launch.get("mcap_at_cross"), "first_priced_mcap_usd": launch.get("first_priced_mcap"),
            "minutes_after_launch": round((pos["entry_at"] - launch["created_at"]) / 60, 1) if launch.get("created_at") else None,
            "min_entry_mcap_usd": launch.get("min_entry_mcap"), "mayhem": launch.get("mayhem"), "mayhem_source": launch.get("mayhem_source"),
            "bundle_pct": launch.get("bundle_pct"), "bundle_wallets": launch.get("bundle_wallets"),
            **({"edge": launch["edge"]} if isinstance(launch.get("edge"), dict) else {}),
            "simulated": True}


def _sell_payload(buy, pos):
    p = dict(buy)
    p.update({"kind": "SELL", "exit_at": pos["exit_at"], "exit_at_ct": iso_ct(pos["exit_at"]), "exit_reason": pos["exit_reason"],
              "exit_price_usd": pos["exit_price"], "exit_fill_price_usd": pos["exit_fill_price"], "exit_mcap_usd": pos["exit_mcap"],
              "exit_liquidity_usd": pos["exit_liq"], "exit_cost_pct": None if pos["exit_cost"] is None else round(pos["exit_cost"] * 100, 2),
              "hold_hours": round((pos["exit_at"] - pos["entry_at"]) / 3600, 2), "proceeds_usd": round(pos["proceeds_usd"], 2),
              "pnl_usd": round(pos["pnl_usd"], 2), "pnl_pct": round(pos["pnl_pct"] * 100, 2), "bankroll_after": round(pos["bankroll_after"], 2)})
    return p


def open_positions_for(led, launch, now, stats, books=None):
    """Open one position per book for a launch that has just been priced (inside the caller's transaction)."""
    for book, (sizes, constrained) in BOOKS.items():
        if books is not None and book not in books:
            continue
        dec = (launch.get("strategy_decision") or launch["decision"]) if book == "strategy" else launch["decision"]
        pct = sizes.get(dec, 0.0)
        if pct <= 0:
            continue
        if led.one("SELECT 1 FROM positions WHERE book=? AND mint=?", (book, launch["mint"])) or \
           led.one("SELECT 1 FROM misses WHERE book=? AND mint=?", (book, launch["mint"])):
            continue
        st = book_state(led, book)
        base = st["bankroll"] if constrained else START_BANKROLL
        size = round(pct * base, 2)
        if constrained and size > st["cash"] + 1e-9:
            led.insert("misses", {"book": book, "mint": launch["mint"], "decision": dec, "reason": "no_cash",
                                  "size_usd": size, "cash_usd": round(st["cash"], 2), "at": now})
            stats["missed_no_cash"][book] = stats["missed_no_cash"].get(book, 0) + 1
            continue
        if size <= 0:
            continue
        ec = K.side_cost(size, launch["entry_liq"])
        pos = {"book": book, "mint": launch["mint"], "decision": dec, "score": launch["score"], "size_pct": pct,
               "size_usd": size, "bankroll_at_entry": base, "entry_at": launch["entry_at"], "entry_price": launch["entry_price"],
               "entry_mcap": launch["entry_mcap"], "entry_liq": launch["entry_liq"], "entry_cost": ec,
               "asof_decision": launch.get("asof_decision"), "gate_reasons": launch.get("gate_reasons"), "entry_fdv": launch["entry_mcap"],
               "entry_trigger": launch.get("entry_trigger") or "first_price",
               "tokens": size * (1 - ec) / launch["entry_price"], "status": "open", "last_price": launch["entry_price"],
               "last_price_at": launch["entry_at"], "last_mcap": launch["entry_mcap"], "last_liq": launch["entry_liq"],
               "last_mark_at": now, "min_ret": 0.0, "max_ret": 0.0, "mayhem": launch.get("mayhem")}
        if book in EG.EDGE_BOOKS and isinstance(launch.get("edge"), dict):
            pos["edge"] = json.dumps(launch["edge"], default=str)
        if book in MAYHEM_GATED_BOOKS and launch.get("mayhem") != 0:
            stats["mayhem"]["defence_blocks"] = stats["mayhem"].get("defence_blocks", 0) + 1     # defence in depth (should stay 0)
            continue
        if book in EG.EDGE_BOOKS and launch.get("bundle_block"):
            continue                                                                            # defence in depth (bundle gate)
        pos["id"] = led.insert("positions", pos)
        stats["opened"][book] = stats["opened"].get(book, 0) + 1
        if book in EVENT_BOOKS:
            led.insert("events", {"created_at": now, "book": book, "kind": "BUY", "position_id": pos["id"], "mint": pos["mint"],
                                  "payload": _buy_payload(led, pos, launch)}, mode="INSERT OR IGNORE")


def liquidation_value(p):
    """Mark-to-market of an open position: what selling it at the last price would return after exit costs."""
    if not p["last_price"]:
        return 0.0
    v = p["tokens"] * p["last_price"]
    return v * (1 - K.exit_cost(v, p["last_liq"], p["entry_cost"]))


def evaluate_exit(pos, quote, now):
    """-> (reason, fill_price or None, liquidity) or None. Pure function of the position, the quote and the time.
    TP fills at the +100% target (a resting limit order would not get the overshoot); stops and time exits fill at the
    observed price (gap risk with 15-min polling); dead = no valid price for 24 h -> proceeds 0."""
    if quote is not None:
        r = quote.price_usd / pos["entry_price"] - 1
        if r >= TAKE_PROFIT:
            return "take_profit", pos["entry_price"] * (1 + TAKE_PROFIT), quote.liquidity_usd
        if r <= STOP_LOSS:
            return "stop_loss", quote.price_usd, quote.liquidity_usd
        if now - pos["entry_at"] >= TIME_EXIT_S:
            return "time_exit_24h", quote.price_usd, quote.liquidity_usd
        return None
    if now - (pos["last_price_at"] or pos["entry_at"]) >= DEAD_NO_PRICE_S:
        return "dead_token_no_price_24h", None, None
    return None


def close_position(led, pos, reason, fill, liq, quote, now, stats, trigger=None):
    from . import fixed_fees as FF
    lrow = led.one("SELECT supply, circ_supply FROM launches WHERE mint=?", (pos["mint"],)) or {}
    exit_fdv = fdv_of(quote, lrow.get("supply"), lrow.get("circ_supply"))
    value = pos["tokens"] * fill if fill else 0.0
    xc = K.exit_cost(value, liq if liq is not None else pos["last_liq"], pos["entry_cost"]) if fill else None
    # + an earlier moon-bag partial sell (momentum book only; NULL elsewhere)
    trade_proceeds = (value * (1 - xc) if fill else 0.0)
    # never debit impossible negative proceeds from fixed fees — fees hit PnL separately
    proceeds = trade_proceeds + (pos.get("partial_proceeds_usd") or 0.0)
    fee_upd = {}
    if FF.applies(pos):
        # charge exit tx only when selling a positive token amount this close
        f, fu = FF.apply_exit_fee(pos, tradeable_tokens=pos["tokens"] if fill else 0.0)
        fee_upd.update(fu)
        pos = {**pos, **fu}
        # dust remaining if dust_tokens kept after close_rest (sigbooks sets tokens=dust after); here tokens are tradeable rest
        dust_remaining = bool(pos.get("dust_frac") or pos.get("dust_tokens"))
        # When close_position is used for clip5_rug_dust, caller leaves dust on the row after this update.
        # Forfeit rent whenever a dust bag policy is active (dust never sold).
        ru = FF.settle_rent_on_close(pos, dust_remaining=dust_remaining)
        fee_upd.update(ru)
        pos = {**pos, **ru}
        pnl = FF.pnl_after_fixed(proceeds, pos["size_usd"], pos, {**pos, **fee_upd})
    else:
        pnl = proceeds - pos["size_usd"]
    upd = {"status": "closed", "exit_at": now, "exit_price": quote.price_usd if quote else None, "exit_fill_price": fill,
           "exit_mcap": exit_fdv, "exit_fdv": exit_fdv, "exit_liq": liq, "exit_cost": xc, "exit_reason": reason,
           "proceeds_usd": proceeds, "pnl_usd": pnl, "pnl_pct": pnl / pos["size_usd"], **fee_upd}
    if trigger is not None:
        upd["exit_trigger_price"] = trigger
    if pos.get("partial_at"):
        upd["moon_bag"] = f"closed: {reason}"
    led.update("positions", {"id": pos["id"]}, upd)
    pos = {**pos, **upd}
    pos["bankroll_after"] = book_state(led, pos["book"])["bankroll"]
    led.update("positions", {"id": pos["id"]}, {"bankroll_after": pos["bankroll_after"]})
    stats["closed"][pos["book"]] = stats["closed"].get(pos["book"], 0) + 1
    if pos["book"] in EVENT_BOOKS:
        buy = led.one("SELECT payload FROM events WHERE position_id=? AND kind='BUY'", (pos["id"],))
        launch = led.one("SELECT * FROM launches WHERE mint=?", (pos["mint"],)) or {}
        bp = json.loads(buy["payload"]) if buy else _buy_payload(led, pos, launch)
        sp = _sell_payload(bp, pos)
        if pos["book"] == MOMENTUM_BOOK and pos.get("exit_policy"):
            sp.update(_clip_fields(pos, final_proceeds=proceeds - (pos.get("partial_proceeds_usd") or 0.0)))
        elif pos["book"] == MOMENTUM_BOOK:
            sp.update(_moon_fields(pos, final_proceeds=proceeds - (pos.get("partial_proceeds_usd") or 0.0)))
        elif pos["book"] in ALERT_SCANNER_BOOKS:
            from .scanbook import clip_fields
            sp.update(clip_fields(pos, final_proceeds=proceeds - (pos.get("partial_proceeds_usd") or 0.0)))
        led.insert("events", {"created_at": now, "book": pos["book"], "kind": "SELL", "position_id": pos["id"], "mint": pos["mint"],
                              "payload": sp}, mode="INSERT OR IGNORE")


def _moon_fields(pos, final_proceeds=None):
    """Moon-bag fields for momentum-book events (amount sold, profit locked, moon-bag status)."""
    pp = pos.get("partial_proceeds_usd")
    out = {"moon_bag_status": pos.get("moon_bag") or ("riding" if pos.get("partial_at") else "none (no 2x partial yet)"),
           "partial_sold": bool(pos.get("partial_at")), "partial_at_ct": iso_ct(pos.get("partial_at")),
           "partial_fill_price_usd": pos.get("partial_price"),
           "partial_sold_pct": None if pos.get("partial_frac") is None else round(pos["partial_frac"] * 100, 1),
           "partial_tokens_sold": pos.get("partial_tokens"), "partial_proceeds_usd": None if pp is None else round(pp, 2),
           "profit_locked_usd": None if pp is None else round(pp - pos["size_usd"], 2),
           "partial_realized_pnl_usd": None if pos.get("partial_pnl_usd") is None else round(pos["partial_pnl_usd"], 2),
           "moon_bag_tokens": pos.get("tokens") if pos.get("partial_at") else None,
           "peak_price_usd": pos.get("peak_price")}
    if final_proceeds is not None and pos.get("partial_at"):
        out["moon_bag_proceeds_usd"] = round(final_proceeds, 2)
    return out


def _clip_fields(pos, final_proceeds=None, last=None):
    """Alert fields for a rung-policy (clip5) momentum position: clips filled, share sold / remaining, profit locked,
    the current stop level and rule, the next rung, and (SELL) trigger vs mark for slippage."""
    pol = X.get(pos.get("exit_policy"))
    done = int(pos.get("clips_done") or 0)
    sold = X.sold_frac(pol, done) if pol else (pos.get("partial_frac") or 0)
    pp = pos.get("partial_proceeds_usd")
    e = pos["entry_price"]
    stop = pos.get("stop_price")
    if stop is None and pol:
        stop = X.stop_level(pol, e, done, pos.get("peak_price"), pos.get("grad_at_launch"))
    try:
        log = json.loads(pos.get("clip_log") or "[]")
    except ValueError:
        log = []
    out = {"exit_policy": pos.get("exit_policy"), "exit_policy_rule": pol.describe(pos.get("grad_at_launch")) if pol else None,
           "clips_done": done, "clips_total": len(pol.rungs) if pol else None,
           "sold_pct_of_original": round(sold * 100, 1), "remaining_pct_of_original": round((1 - sold) * 100, 1),
           "cash_recovered_usd": None if pp is None else round(pp, 2),
           "profit_locked_usd": round(pos.get("partial_pnl_usd") or 0.0, 2),
           "stop_level_usd": stop, "stop_vs_entry_pct": None if not stop else round((stop / e - 1) * 100, 1),
           "stop_rule": X.stop_rule_text(pol, done, pos.get("grad_at_launch")) if pol else None,
           "next_rung": X.next_rung(pol, done, e) if pol else None, "peak_price_usd": pos.get("peak_price"),
           "clip_fills": log, "graduated_at_launch": pos.get("grad_at_launch")}
    if last is not None:
        out.update(last)
    if final_proceeds is not None:
        out["final_sale_proceeds_usd"] = round(final_proceeds, 2)
        if pos.get("exit_trigger_price") is not None:
            out["exit_trigger_price_usd"] = pos["exit_trigger_price"]
        out["exit_mark_price_usd"] = pos.get("exit_price")
    return out


def _momentum_payload_fields(pos, launch):
    try:
        det = json.loads(pos.get("mom_detail") or "{}")
    except ValueError:
        det = {}
    return {"theme": pos.get("theme"), "momentum_score": pos.get("mom_score"), "narrative_score": pos.get("narr_score"),
            "combined_score": pos.get("mom_combined"), "momentum": det.get("momentum"), "narrative": det.get("narrative"),
            "selection": det.get("selection"), "exit_rules": det.get("exit_rules"), "unproven": True}


# ---------------------------------------------------------------------------------------------------------------
class Cycle:
    def __init__(self, ctx, led: Ledger, *, quotes_fn=None, discover_fn=None, score_fn=None, clock=time.time,
                 cap=15, parallel=3, budget_s=540, min_age_s=360, max_age_s=900, min_txs=15, end_ts=DEFAULT_END,
                 progress=None, seed=None, entry_quotes_fn=None, holders_fn=None, supply_fn=None, thresholds=None, min_mcap_usd=None,
                 agent_balance_fn=None, momentum_cfg=None, narrative_fn=None, mayhem_fn=None, edge_cfg=None):
        self.ctx, self.led, self.clock = ctx, led, clock
        self.quotes_fn = quotes_fn or (lambda mints: default_quotes(ctx, mints))
        # entries: DexScreener + GeckoTerminal for every mint (price cross-check, real-supply FDV, curve reserve)
        self.entry_quotes_fn = entry_quotes_fn or (self.quotes_fn if quotes_fn else (lambda mints: default_quotes(ctx, mints, gt_all=True)))
        self.holders_fn = holders_fn or self._holders
        self.supply_fn = supply_fn or self._supply
        self.agent_balance_fn = agent_balance_fn or self._agent_balance
        # (launch row, supply, agent_balance) -> smr.mayhem.classify-style dict {"mayhem": True|False|None, "source", ...}
        self.mayhem_fn = mayhem_fn or self._mayhem
        env_min = os.environ.get("SMR_PAPER_MIN_MCAP_USD")
        self.min_mcap_usd = float(min_mcap_usd if min_mcap_usd is not None else env_min if env_min else DEFAULT_MIN_MCAP_USD)
        self.thresholds = thresholds or (ctx.settings.thresholds if ctx is not None and getattr(ctx.settings, "thresholds", None) else None)
        self.discover_fn = discover_fn or self._discover
        self.score_fn = score_fn or self._score
        self.cap, self.parallel, self.budget_s = cap, parallel, budget_s
        self.min_age_s, self.max_age_s, self.min_txs, self.end_ts = min_age_s, max_age_s, min_txs, end_ts
        self.say = progress or (lambda m: None)
        self.mcfg = momentum_cfg or M.MomentumConfig.load()
        self.narrative_fn = narrative_fn or self._narrative_index
        # edge signals for strategy + momentum (smr/paper/edge.py, data/paper_edge.json; code defaults all off)
        self.ecfg = edge_cfg or EG.EdgeConfig.load()
        self._smart = None
        self._xdata = None
        self._hcache = None
        self._narr = None
        self._grads = None
        me = self.ecfg.mexit
        self.mom_policy = me.policy if me.enabled and X.get(me.policy) else None
        self.controls = {b: pol for b, pol in CONTROL_BOOKS.items() if me.enabled and pol in (me.controls or []) and (X.get(pol) or b in SIGNAL_BOOKS)}
        self.rng = random.Random(seed)
        self.t0 = clock()
        self.stats = {"opened": {}, "closed": {}, "missed_no_cash": {}, "price_errors": [], "marked": 0, "unpriced_marks": 0,
                      "candidates_in_window": 0, "checked": 0, "eligible": 0, "scored": 0, "score_errors": 0, "score_timeouts": 0,
                      "decisions": {"SKIP": 0, "REDUCED": 0, "NORMAL": 0}, "decisions_after_gates": {"SKIP": 0, "REDUCED": 0, "NORMAL": 0},
                      "gate_downgrades": [], "entries_held": [], "filtered_mcap": 0, "mcap_crossings": 0, "mcap_expired": 0,
                      "mcap_cross_gated": [], "entries_priced": 0, "entries_pending": 0, "unfilled": 0,
                      "mayhem": {"checked": 0, "mayhem": 0, "not_mayhem": 0, "unknown": 0, "sources": {}, "blocked": {},
                                 "blocked_unknown": {}, "waiting_dropped": 0, "watching_dropped": 0, "backfilled": 0},
                      "momentum": {"enabled": self.mcfg.enabled, "evaluated": 0, "entered": 0, "watching_rechecked": 0, "vetoed_skip": 0,
                                   "below_mcap_floor": 0, "vetoed_mayhem": 0, "rejected": [], "partials": 0, "moon_closed": 0, "expired": 0,
                                   "exit_policy": self.mom_policy, "clips": {}, "control_entries": 0, "control_closed": 0,
                                   "hot_themes": [], "narrative_sources": {}, "narrative_errors": []},
                      "edge": {"config": self.ecfg.source, "bundle_blocked": {}, "bundle_unknown": 0, "bundle_reasons": [],
                               "smart_lifts": 0, "smart_boosts": 0, "smart_signals": 0,
                               "x_lookups": 0, "x_fresh": 0, "x_points_applied": 0,
                               "pullback": {"queued": {}, "polled": 0, "triggered": 0, "entered": {}, "expired": 0, "ended": {}, "held": []},
                               "holders_live": {"applied": 0, "vetoed": 0, "no_fresh_cache": 0, "reasons": []}}}

    # ---- step 1 + 3: prices --------------------------------------------------------------------------------
    def _supply(self, mint):
        """On-chain total supply (UI units) from the mint account; None if unreadable."""
        if self.ctx is None:
            return None
        try:
            from .. import data_extractors as dx
            a = dx.mint_authorities(self.ctx, mint)
            return a["supply_raw"] / 10 ** a["decimals"] if a.get("supply_raw") and a.get("decimals") is not None else None
        except Exception:
            return None

    def _agent_balance(self, mint):
        """Tokens of `mint` held by the Mayhem agent wallet (UI units; 0 if it has no account), None if unreadable.
        getTokenAccountsByOwner is an indexed call free publicnode refuses, so it goes to the other endpoints."""
        if self.ctx is None:
            return None
        try:
            r = self.ctx.rpc.call("getTokenAccountsByOwner", [MAYHEM_AGENT, {"mint": mint}, {"encoding": "jsonParsed"}],
                                  ttl=60, skip_eps=("publicnode",))
            vals = (r or {}).get("value")
            if vals is None:
                return None
            return sum(float(a["account"]["data"]["parsed"]["info"]["tokenAmount"]["uiAmountString"]) for a in vals)
        except Exception:
            return None

    def _mayhem(self, l, supply=None, agent=None):
        """Mayhem status from free on-chain data (smr.mayhem.detect). No ctx (offline) -> supply/agent only."""
        if self.ctx is None:
            return MY.classify(None, None, supply, agent)
        return MY.detect(self.ctx, l["mint"], create_sig=l.get("create_sig"), curve=l.get("curve"), supply=supply, agent_balance=agent)

    def _mayhem_status(self, l, supply=None, agent=None):
        """-> launch update dict {mayhem: 1|0|None, mayhem_source, mayhem_checked_at[, curve]}. A stored 1 or 0 is final
        (is_mayhem_mode is immutable); an unknown is re-read. New evidence of Mayhem (supply/agent) always wins."""
        st = self.stats["mayhem"]
        stored = l.get("mayhem")
        if stored == 1 or (stored == 0 and not ((supply or 0) > MY.SUPPLY_MAYHEM_MIN or (agent or 0) > 0)):
            return {"mayhem": stored, "mayhem_source": l.get("mayhem_source"), "mayhem_checked_at": l.get("mayhem_checked_at")}
        try:
            r = self.mayhem_fn(l, supply, agent) or {}
        except Exception as e:
            r = {"mayhem": None, "source": f"error: {type(e).__name__}"[:60]}
        m = r.get("mayhem")
        st["checked"] += 1
        st["mayhem" if m is True else "not_mayhem" if m is False else "unknown"] += 1
        src = safe_field(r.get("source") or "unknown", 60)
        st["sources"][src] = st["sources"].get(src, 0) + 1
        out = {"mayhem": MY.as_int(m), "mayhem_source": src, "mayhem_checked_at": self.clock()}
        if r.get("curve") and not l.get("curve"):
            out["curve"] = r["curve"]
        return out

    def _mayhem_block(self, book, m, sym, mint=None):
        """Count a Mayhem/unknown entry block for one alerted book (once per launch per cycle). -> reason text."""
        st = self.stats["mayhem"]
        k = "blocked" if m == 1 else "blocked_unknown"
        seen = self.__dict__.setdefault("_mayhem_seen", set())
        if (book, k, mint or sym) not in seen:
            seen.add((book, k, mint or sym))
            st[k][book] = st[k].get(book, 0) + 1
        return f"{sym}: {MY.REASON}" + ("" if m == 1 else " status unknown (conservative SKIP)")

    def smart(self):
        """Smart-money data (wallet list + feed cache), read once per cycle; None when the feature is off."""
        if not self.ecfg.smart.enabled:
            return None
        if self._smart is None:
            self._smart = EG.SmartData(self.ecfg.smart, self.clock())
            e = self.stats["edge"]
            e["smart_list_size"] = len(self._smart.wallets); e["smart_feed_age_s"] = self._smart.feed_age.get("buy")
        return self._smart

    def _x_heat(self, l, theme=None):
        """X heat for the coin's ticker (else its theme) from data/x_heat.json; stale/missing -> neutral. None when off."""
        if not self.ecfg.x.enabled:
            return None
        if self._xdata is None:
            self._xdata = EG.XData(self.ecfg.x, self.clock())
        if theme is None and self._narr:
            from .. import narrative as N
            theme = N.score_coin(self._narr.get("themes") or {}, {"mint": l["mint"], "symbol": l.get("symbol"), "name": l.get("name"),
                                                                  "created_at": l.get("created_at")}, self.clock(), self.mcfg).get("theme")
        r = self._xdata.lookup(theme, l.get("symbol"))
        e = self.stats["edge"]
        e["x_lookups"] += 1; e["x_fresh"] += int(bool(r.get("fresh")))
        return {"term": r.get("term"), "fresh": bool(r.get("fresh")), "points": r.get("points", 0.0), "posts_1h": r.get("posts_1h"),
                "accel_x": r.get("accel"), "authors": r.get("distinct_authors"), "engagement": r.get("engagement"),
                "age_min": r.get("age_min"), **({"why": r["why"]} if r.get("why") else {})}

    def _smart_sig(self, l):
        sd = self.smart()
        return sd.signal(l) if sd else None

    def _edge_info(self, l, sig=None, lift=None, xh=None, pb=None):
        """Edge facts for the BUY alert (numbers and sanitized handles only)."""
        out = {"bundle_pct": l.get("bundle_pct"), "bundle_wallets": l.get("bundle_wallets")}
        if l.get("holder_source") == "stalkchain_live":
            out["holders_live"] = {"holders": l.get("gate_holders"), "source": "StalkChain stalkchain_token_quality"}
        if sig is not None:
            out["smart_money"] = {k: sig[k] for k in ("count", "net_buyers", "early_matches", "feed_buyers", "feed_sellers", "handles", "feed_fresh")}
            if lift is not None:
                out["smart_money"]["lifted_to_normal"] = bool(lift)
        if xh is not None:
            out["x_heat"] = xh
        if pb is not None:
            out["pullback"] = pb
        return out

    def _edge_gate(self, l, g, book):
        """Strategy/momentum view of an entry-gate result (edge feature 5, `holders_live`): for a coin at/above the floor
        whose holder count is unknown, a fresh StalkChain live count (data/holder_cache.json) replaces the conservative
        'holder count unknown' cap and the normal holder threshold applies to it; a StalkChain veto condition in the same
        read is a hard SKIP. Returns g unchanged when the gate does not apply (flag off, other book, holders known, under
        the floor, no fresh read). Never touches the benchmark books: callers use it only for strategy/momentum."""
        hc = self.ecfg.holders
        if g is None or not hc.enabled or book not in (hc.books or []) or g.get("gate_holders") is not None:
            return g
        fdv = g.get("entry_fdv")
        if fdv is None or fdv < hc.min_mcap_usd:
            return g
        if self._hcache is None:
            self._hcache = EG.HolderCache(hc, self.clock())
        lg = EG.live_holder_gate(None, fdv, self._hcache.fresh(l["mint"]), hc)
        st = self.stats["edge"]["holders_live"]
        seen = self.__dict__.setdefault("_hl_seen", set())
        if lg is None:
            if ("none", l["mint"]) not in seen:
                seen.add(("none", l["mint"])); st["no_fresh_cache"] += 1
            return g
        gg = G.entry_gates(g.get("gate_liq"), lg["holders"], fdv, self.thresholds, "stalkchain_live")
        cap = gg["cap"]
        reasons = [safe_reason(r) for r in gg["reasons"]] + [r for r in json.loads(g.get("gate_reasons") or "[]") if str(r).startswith("mayhem_mode")]
        if lg["holders"] is not None:      # first: BUY alerts show the top 3 gate reasons
            reasons.insert(0, safe_reason(f"holders: {lg['holders']} live (StalkChain)"))
        if lg["veto"]:
            cap = "SKIP"; reasons.append(safe_reason(lg["veto"], 200))
        dec = G.stricter(g.get("asof_decision") or g.get("decision"), cap)
        info = {"holders": lg["holders"], "age_s": lg["age_s"], "veto": lg["veto"], "cap": cap, "decision": dec,
                "benchmark_decision": g.get("decision")}
        if ("seen", l["mint"]) not in seen:
            seen.add(("seen", l["mint"]))
            st["applied"] += 1; st["vetoed"] += int(bool(lg["veto"]))
            st["reasons"] = (st["reasons"] + [safe_reason(f"{l.get('symbol') or l['mint'][:8]}: {lg['holders']} live holders -> {dec}"
                                                          + (f" ({lg['veto']})" if lg["veto"] else ""), 200)])[-10:]
        self.led.update("launches", {"mint": l["mint"]}, {"holders_live": json.dumps(info, default=str)})
        return {**g, "decision": dec, "gate_cap": cap, "gate_reasons": json.dumps(reasons), "gate_holders": lg["holders"],
                "holder_source": "stalkchain_live" if lg["holders"] is not None else g.get("holder_source"), "holders_live": info}

    def _strategy_lift(self, l, g, sig):
        """REDUCED -> NORMAL for the strategy book only (see EG.strategy_lift). Returns the strategy decision."""
        if EG.strategy_lift(g.get("asof_decision"), g.get("gate_cap"), sig, self.ecfg.smart,
                            blocked=bool(g.get("bundle_block")) or g.get("mayhem") != 0 or g.get("decision") == "SKIP"):
            self.stats["edge"]["smart_lifts"] += 1
            return "NORMAL"
        return g.get("decision")

    # ---- pullback watchlist (edge feature 4) -------------------------------------------------------------------
    def _pb_on(self, book):
        c = self.ecfg.pullback
        return c.enabled and book in (c.books or [])

    def _pb_queue(self, book, l, q, fdv, trigger, decision, detail, now):
        """A coin qualified for `book`: watch it for a 20-35% pullback from its post-qualify high instead of buying now."""
        if self.led.one("SELECT 1 AS x FROM watchlist WHERE book=? AND mint=?", (book, l["mint"])):
            return
        self.led.insert("watchlist", {"book": book, "mint": l["mint"], "status": "watching", "qualified_at": now, "trigger": trigger,
                                      "qualify_price": q.price_usd, "qualify_mcap": fdv, "high_price": q.price_usd, "high_at": now,
                                      "low_price": None, "low_at": None, "last_price": q.price_usd, "last_at": now, "polls": 0,
                                      "expires_at": now + self.ecfg.pullback.expire_s, "decision": decision,
                                      "detail": json.dumps(detail or {}, default=str)})
        qd = self.stats["edge"]["pullback"]["queued"]
        qd[book] = qd.get(book, 0) + 1

    def _pb_end(self, w, status, reason, launch_status=None):
        self.led.update("watchlist", {"book": w["book"], "mint": w["mint"]}, {"status": status, "end_reason": safe_reason(reason, 160)})
        if launch_status:
            col = "strategy_status" if w["book"] == "strategy" else "momentum_status"
            self.led.update("launches", {"mint": w["mint"]}, {col: launch_status})
        e = self.stats["edge"]["pullback"]["ended"]
        e[status] = e.get(status, 0) + 1

    def _pb_info(self, w, pe, now):
        return {"depth_pct": round(pe["depth"] * 100, 1), "high_price": pe["high"], "qualify_price": w["qualify_price"],
                "qualify_mcap": w["qualify_mcap"], "qualified_ago_min": round((now - w["qualified_at"]) / 60, 1), "polls": w.get("polls"),
                "bounce": pe["bounce"], "qualify_trigger": w["trigger"]}

    def _pb_enter(self, w, l, q, now):
        """Entry quote for a triggered watch: re-check the band, every gate, SKIP/Mayhem/bundle, then buy."""
        cfg, book, sym = self.ecfg.pullback, w["book"], l["symbol"] or l["mint"][:8]
        held = self.stats["edge"]["pullback"]["held"]
        g, why = self._gate_entry({**l, "decision": l["asof_decision"] or l["decision"]}, q)
        if g is None:
            held.append(safe_reason(f"{book} {sym}: {why}", 160)); return
        g = self._edge_gate(l, g, book)
        pe = EG.pullback_eval(w, q.price_usd, g["entry_fdv"], self.min_mcap_usd, cfg)
        if not pe["trigger"]:
            held.append(safe_reason(f"{book} {sym}: entry quote {pe['why']}", 160)); return
        if g["decision"] == "SKIP":
            self._pb_end(w, "skip", "gates SKIP at pullback entry: " + "; ".join(json.loads(g["gate_reasons"])), "skip"); return
        if g.get("mayhem") != 0:
            self._mayhem_block(book, g.get("mayhem"), sym, l["mint"])
            if g.get("mayhem") == 1:
                self._pb_end(w, "skip_mayhem", "Mayhem at pullback entry", "skip_mayhem")
            return
        if g.get("bundle_block"):
            self._bundle_count(book, l, g["bundle_block"]); self._pb_end(w, "skip_bundle", g["bundle_block"], "skip_bundle"); return
        info = self._pb_info(w, pe, now)
        if book == "strategy":
            sig = self._smart_sig(l)
            sdec = self._strategy_lift(l, g, sig) if sig is not None else g["decision"]
            ent = {**l, "decision": g["decision"], "strategy_decision": sdec, "gate_reasons": g["gate_reasons"], "gate_holders": g["gate_holders"],
                   "holder_source": g["holder_source"], "price_vs_launch": g["price_vs_launch"], "entry_trigger": "pullback",
                   "entry_at": now, "entry_price": q.price_usd, "entry_mcap": g["entry_fdv"], "entry_liq": q.liquidity_usd,
                   "entry_source": q.source, "mayhem": g.get("mayhem"), "bundle_block": g.get("bundle_block")}
            ent["edge"] = self._edge_info(ent, sig, None if sig is None else sdec != g["decision"], xh=self._x_heat(ent), pb=info)
            open_positions_for(self.led, ent, now, self.stats, books=["strategy"])
            ok = bool(self.led.one("SELECT 1 AS x FROM positions WHERE book='strategy' AND mint=?", (l["mint"],)))
        else:
            if self._mom_slots() <= 0:
                held.append(safe_reason(f"momentum {sym}: no open slot", 160)); return
            det = json.loads(w["detail"] or "{}")
            ev = self._momentum_eval(l, q, g["decision"], g["entry_fdv"], now)
            size = float(det.get("size_pct") or 0)
            if g["decision"] == "REDUCED":
                size = min(size, self.mcfg.reduced_max_size)
            ev["combined"] = {**ev["combined"], "size_pct": size, "enter": size > 0,
                              "why": f"pullback entry {info['depth_pct']}% under the post-qualify high (qualified combined {det.get('combined')})"}
            ev["pullback"] = info
            view = {**l, "decision": g["decision"], "gate_reasons": g["gate_reasons"], "gate_holders": g["gate_holders"],
                    "holder_source": g["holder_source"], "price_vs_launch": g["price_vs_launch"], "entry_fdv": g["entry_fdv"],
                    "supply": g["supply"], "circ_supply": g["circ_supply"], "entry_source": q.source,
                    "mayhem": g.get("mayhem"), "mayhem_source": g.get("mayhem_source")}
            ok = size > 0 and self._momentum_enter(view, q, view, ev, now, "pullback")
            if ok:
                self._mom_record(l, ev, "entered_pullback")
        if ok:
            self.led.update("watchlist", {"book": book, "mint": l["mint"]}, {"status": "entered", "entered_at": now, "entry_depth": pe["depth"]})
            self.led.update("launches", {"mint": l["mint"]}, {("strategy_status" if book == "strategy" else "momentum_status"): "entered_pullback"})
            en = self.stats["edge"]["pullback"]["entered"]
            en[book] = en.get(book, 0) + 1
        elif self.led.one("SELECT 1 AS x FROM misses WHERE book=? AND mint=?", (book, l["mint"])):
            self._pb_end(w, "missed", "no cash at pullback entry", "missed_no_cash")

    def _bundle_count(self, book, l, why):
        e = self.stats["edge"]
        seen = self.__dict__.setdefault("_bundle_seen", set())
        if (book, l["mint"]) not in seen:
            seen.add((book, l["mint"]))
            e["bundle_blocked"][book] = e["bundle_blocked"].get(book, 0) + 1
            e["bundle_reasons"] = (e["bundle_reasons"] + [safe_reason(f"{l.get('symbol') or l['mint'][:8]} ({book}): {why}", 160)])[-10:]

    def _mayhem_prefilter(self, rows, col, stat):
        """Waiting (strategy filtered_mcap) or watching (momentum) launches: resolve unknown Mayhem status (bounded per
        cycle) and drop the Mayhem ones (status -> 'skip_mayhem'). Unknown stays waiting but cannot enter."""
        keep, budget = [], MAYHEM_RESOLVE_PER_CYCLE
        for l in rows:
            if l.get("mayhem") is None and budget > 0 and not (self.ctx is not None and self.clock() - self.t0 > self.budget_s * 0.5):
                budget -= 1
                upd = self._mayhem_status(l, l.get("supply"), None)
                self.led.update("launches", {"mint": l["mint"]}, upd)
                l = {**l, **upd}
            if l.get("mayhem") == 1:
                self.led.update("launches", {"mint": l["mint"]}, {col: "skip_mayhem"})
                self.stats["mayhem"][stat] += 1
                continue
            keep.append(l)
        return keep

    def backfill_mayhem(self, limit=None):
        """Record the Mayhem flag for scored launches never checked (benchmark rows, unfilled entries) and copy it onto
        positions. Bounded; never raises."""
        n = 0
        try:
            rows = self.led.q("SELECT * FROM launches WHERE status='scored' AND mayhem IS NULL AND mayhem_checked_at IS NULL "
                              "AND void_reason IS NULL ORDER BY created_at DESC LIMIT ?", (int(MAYHEM_RESOLVE_PER_CYCLE if limit is None else limit),))
            for l in rows:
                if self.ctx is not None and self.clock() - self.t0 > self.budget_s - 30:
                    break
                self.led.update("launches", {"mint": l["mint"]}, self._mayhem_status(l, l.get("supply"), None)); n += 1
            self.led.db.execute("UPDATE positions SET mayhem=(SELECT l.mayhem FROM launches l WHERE l.mint=positions.mint) "
                                "WHERE mayhem IS NULL AND EXISTS (SELECT 1 FROM launches l WHERE l.mint=positions.mint AND l.mayhem IS NOT NULL)")
        except Exception as e:
            log.warning("mayhem backfill: %s", e)
        self.stats["mayhem"]["backfilled"] += n
        return n

    def _holders(self, launch):
        """-> (holder_count, source). Current holders need getProgramAccounts, which free publicnode refuses
        ('Indexed requests require a personal token'); it is tried only with a Helius key or custom RPCs. Otherwise the
        point-in-time count reconstructed at the as-of time (create+300 s) is used and labelled as such."""
        st = self.ctx.settings if self.ctx is not None else None
        if st is not None and (getattr(st, "helius_api_key", None) or os.environ.get("SOLANA_RPC_URLS", "").strip()):
            try:
                from .. import data_extractors as dx
                h = dx.holder_concentration(self.ctx, launch["mint"])
                if h.get("holder_count") is not None:
                    return h["holder_count"], "live_rpc"
            except Exception:
                pass
        if launch.get("holder_count") is not None:
            return launch["holder_count"], "as_of_reconstruction"
        return None, "unknown"

    def _gate_entry(self, l, q):
        """Apply the live market gates to the current quote. -> launch update dict, or None to keep the entry pending."""
        if q.liquidity_usd is None:
            return None, "liquidity unknown"
        if q.gt_price_usd and q.price_usd and abs(q.gt_price_usd / q.price_usd - 1) > 0.25:
            return None, f"price sources disagree (DexScreener {q.price_usd:.4g} vs GeckoTerminal {q.gt_price_usd:.4g})"
        supply = l.get("supply") or self.supply_fn(l["mint"])
        agent = self.agent_balance_fn(l["mint"]) if supply and supply > PUMP_CURVE_SUPPLY * 1.001 else None
        circ = circulating_supply(supply, agent)
        fdv = fdv_of(q, supply, circ)
        bad = G.quote_sanity(q.liquidity_usd, fdv)
        if bad:
            return None, bad
        holders, hsrc = self.holders_fn(l)
        g = G.entry_gates(q.liquidity_usd, holders, fdv, self.thresholds, hsrc)
        mh = self._mayhem_status(l, supply, agent)
        reasons = g["reasons"] + G.mayhem_reasons(mh["mayhem"], mh.get("mayhem_source"))
        asof = l.get("asof_decision") or l["decision"]
        final = G.stricter(asof, g["cap"])
        upd = {"asof_decision": asof, "decision": final, "gate_cap": g["cap"], "gate_reasons": json.dumps([safe_reason(r) for r in reasons]),
               **mh,
               "gate_liq": q.liquidity_usd, "gate_holders": holders, "holder_source": hsrc, "supply": supply, "circ_supply": circ, "entry_fdv": fdv,
               "entry_mcap": fdv, "price_vs_launch": G.price_vs_launch(q), "bundle_block": EG.bundle_block(l, self.ecfg.bundle),
               "entry_note": json.dumps({"dexscreener_mcap_usd": q.mcap_usd, "gt_fdv_usd": q.fdv_usd, "gt_price_usd": q.gt_price_usd,
                                         "price_native": q.price_native, "mayhem_agent_balance": agent})}
        return upd, None

    def _price(self, mints, entry=False):
        if not mints:
            return {}
        try:
            got, errs = (self.entry_quotes_fn if entry else self.quotes_fn)(list(mints))
        except Exception as e:
            got, errs = {}, [f"{type(e).__name__}: {e}"[:200]]
        self.stats["price_errors"] += errs
        return got

    def mark_and_enter(self, entries_only=None):
        """Mark/exit open positions, track launch outcomes and price pending entries. With `entries_only`
        (a list of mints) only those pending entries are priced (used right after each score)."""
        now = self.clock()
        led = self.led
        if entries_only is not None:
            open_pos, track = [], []
            pend = [l for m in entries_only for l in led.q("SELECT * FROM launches WHERE mint=? AND entry_status='pending' AND void_reason IS NULL", (m,))]
            if not pend:
                return
        else:
            open_pos = led.q("SELECT * FROM positions WHERE status='open' AND void_reason IS NULL")
            pend = led.q("SELECT * FROM launches WHERE entry_status='pending' AND void_reason IS NULL")
            track = led.q("SELECT * FROM launches WHERE entry_status='priced' AND track_done=0 AND void_reason IS NULL")
        qs = self._price({p["mint"] for p in open_pos} | {l["mint"] for l in track})
        qs.update(self._price({l["mint"] for l in pend}, entry=True))
        # market-cap re-check: launches filtered only by the floor, until 24 h after launch
        filt = [] if entries_only is not None else led.q(
            "SELECT * FROM launches WHERE strategy_status='filtered_mcap' AND void_reason IS NULL")
        expired = [l for l in filt if now - l["created_at"] > MCAP_RECHECK_S]
        filt = [l for l in filt if now - l["created_at"] <= MCAP_RECHECK_S]
        if filt:
            filt = self._mayhem_prefilter(filt, "strategy_status", "waiting_dropped")
        if filt:
            miss = {l["mint"] for l in filt} - set(qs)
            if miss:
                qs.update(self._price(miss))
        crossed = [l for l in filt if (fdv_of(qs.get(l["mint"]), l["supply"], l.get("circ_supply")) or 0) >= self.min_mcap_usd]
        # momentum book: non-SKIP launches still 'watching' are re-checked on the cheap tracking quote; only those that
        # pass there get an entry quote (shared GeckoTerminal batch with the market-cap crossings)
        mom_expired, mom_cands = [], []
        if self.mcfg.enabled and entries_only is None:
            watch = led.q("SELECT * FROM launches WHERE momentum_status='watching' AND void_reason IS NULL")
            mom_expired = [l for l in watch if now - (l["created_at"] or now) > self.mcfg.watch_s or now > self.end_ts]
            watch = [l for l in watch if l not in mom_expired]
            if watch:
                watch = self._mayhem_prefilter(watch, "momentum_status", "watching_dropped")
            miss = {l["mint"] for l in watch} - set(qs)
            if miss:
                qs.update(self._price(miss))
            if watch:
                self.narrative()
            for l in watch:
                q = qs.get(l["mint"])
                if q is None:
                    continue
                self.stats["momentum"]["watching_rechecked"] += 1
                ev = self._momentum_eval(l, q, l["decision"], fdv_of(q, l["supply"], l.get("circ_supply")), now)
                if ev["fdv_ok"] and ev["combined"]["enter"]:
                    mom_cands.append(l)
        if pend and self.mcfg.enabled:
            self.narrative()          # HTTP outside the ledger transaction
        # pullback watchlist: poll watched coins (cheap quote), entry quotes only for those inside the band
        pb_rows, pb_obs, pb_trig, pb_void = [], {}, [], []
        pcfg = self.ecfg.pullback
        if pcfg.enabled and entries_only is None:
            pb_rows = led.q("SELECT * FROM watchlist WHERE status='watching'")
            due = [w for w in pb_rows if now <= min(w["expires_at"], self.end_ts) and now - (w["last_at"] or 0) >= pcfg.min_poll_interval_s]
            miss = {w["mint"] for w in due} - set(qs)
            if miss:
                qs.update(self._price(miss))
            for w in due:
                l = led.one("SELECT * FROM launches WHERE mint=?", (w["mint"],))
                if l is None or l["void_reason"]:
                    pb_void.append(w); continue
                q = qs.get(w["mint"])
                if q is None or not q.price_usd:
                    continue
                pe = EG.pullback_eval(w, q.price_usd, fdv_of(q, l["supply"], l.get("circ_supply")), self.min_mcap_usd, pcfg)
                pb_obs[(w["book"], w["mint"])] = EG.pullback_observe(w, q.price_usd, now)
                self.stats["edge"]["pullback"]["polled"] += 1
                if pe["trigger"]:
                    pb_trig.append((w, l))
            pb_trig = pb_trig[:pcfg.max_entry_quotes_per_cycle]
        xmints = {l["mint"] for l in crossed} | {l["mint"] for l in mom_cands} | {w["mint"] for w, _ in pb_trig}
        xq = self._price(xmints, entry=True) if xmints else {}
        now = self.clock()
        with led.tx():
            for l in pend:
                q = qs.get(l["mint"])
                if q is None:
                    led.update("launches", {"mint": l["mint"]}, {"price_attempts": (l["price_attempts"] or 0) + 1})
                    if now - (l["scored_at"] or now) > ENTRY_MAX_DELAY_S:
                        led.update("launches", {"mint": l["mint"]}, {"entry_status": "unfilled"}); self.stats["unfilled"] += 1
                    else:
                        self.stats["entries_pending"] += 1
                    continue
                if now > self.end_ts:
                    led.update("launches", {"mint": l["mint"]}, {"entry_status": "unfilled"}); self.stats["unfilled"] += 1
                    continue
                gated, why = self._gate_entry(l, q)
                if gated is None:
                    led.update("launches", {"mint": l["mint"]}, {"price_attempts": (l["price_attempts"] or 0) + 1,
                                                                 "entry_note": safe_reason(why, 200)})
                    self.stats["entries_held"].append(safe_reason(f"{l['symbol'] or l['mint'][:8]}: {why}", 200))
                    if now - (l["scored_at"] or now) > ENTRY_MAX_DELAY_S:
                        led.update("launches", {"mint": l["mint"]}, {"entry_status": "unfilled"}); self.stats["unfilled"] += 1
                    else:
                        self.stats["entries_pending"] += 1
                    continue
                self.stats["decisions_after_gates"][gated["decision"]] = self.stats["decisions_after_gates"].get(gated["decision"], 0) + 1
                if gated["decision"] != gated["asof_decision"]:
                    self.stats["gate_downgrades"].append({"symbol": l["symbol"] or l["mint"][:8], "mint": l["mint"], "from": gated["asof_decision"],
                                                          "to": gated["decision"], "reasons": json.loads(gated["gate_reasons"])})
                sym = l["symbol"] or safe_field(q.symbol, 32)
                name = l["name"] or safe_field(q.name, 64)
                upd = {**gated, "entry_status": "priced", "entry_at": now, "entry_price": q.price_usd,
                       "entry_liq": q.liquidity_usd, "entry_source": q.source, "entry_pair": q.pair, "last_price": q.price_usd,
                       "last_price_at": now, "min_ret": 0.0, "max_ret": 0.0, "symbol": sym, "name": name,
                       "price_attempts": (l["price_attempts"] or 0) + 1}
                fdv = upd.get("entry_fdv")
                if self.ecfg.bundle.enabled and l.get("bundle_pct") is None:
                    self.stats["edge"]["bundle_unknown"] += 1      # launches scored before the gate: no bundle data, not blocked
                # strategy / momentum views (live StalkChain holders, edge feature 5); the launch row keeps the benchmark decision
                HV = ("decision", "gate_cap", "gate_reasons", "gate_holders", "holder_source")
                sg, mg = self._edge_gate(l, gated, "strategy"), self._edge_gate(l, gated, MOMENTUM_BOOK)
                sv = {} if sg is gated else {k: sg[k] for k in HV}
                mv = {} if mg is gated else {k: mg[k] for k in HV}
                if sv:
                    upd["strategy_decision"] = sv["decision"]
                if {**upd, **sv}["decision"] == "SKIP":
                    upd["strategy_status"] = "skip"
                elif upd.get("bundle_block"):
                    upd["strategy_status"] = "skip_bundle"; self._bundle_count("strategy", l, upd["bundle_block"])
                elif upd.get("mayhem") != 0:
                    # Mayhem (or unknown): the strategy book never enters, not now and not on a later floor crossing
                    upd["strategy_status"] = "skip_mayhem"
                    self.stats["mayhem"]["entry_reasons"] = self.stats["mayhem"].get("entry_reasons", [])[-9:] + [
                        safe_reason(self._mayhem_block("strategy", upd.get("mayhem"), l["symbol"] or l["mint"][:8], l["mint"]), 120)]
                elif fdv is not None and fdv >= self.min_mcap_usd:
                    upd["strategy_status"] = "entered"
                    sig = self._smart_sig({**l, **upd})
                    if sig is not None:
                        sdec = self._strategy_lift(l, {**upd, **sv}, sig)
                        upd["strategy_decision"] = sdec
                        upd["smart_money"] = json.dumps({**sig, "lifted": sdec != {**upd, **sv}["decision"]}, default=str)
                else:
                    # below the market-cap floor: strategy waits (re-checked for 24 h); counterfactual books still buy now
                    upd["strategy_status"] = "filtered_mcap"; self.stats["filtered_mcap"] += 1
                upd["min_entry_mcap"] = self.min_mcap_usd
                upd["first_priced_mcap"] = fdv
                led.update("launches", {"mint": l["mint"]}, upd)
                self.stats["entries_priced"] += 1
                if upd["strategy_status"] == "entered" and self._pb_on("strategy"):
                    upd["strategy_status"] = "watch_pullback"
                    led.update("launches", {"mint": l["mint"]}, {"strategy_status": "watch_pullback"})
                    self._pb_queue("strategy", {**l, **upd}, q, fdv, "first_price", upd.get("strategy_decision") or upd["decision"],
                                   {"smart_money": upd.get("smart_money")}, now)
                books = None if upd["strategy_status"] == "entered" else [b for b in BOOKS if b not in MCAP_BOOKS]
                sig = json.loads(upd["smart_money"]) if upd.get("smart_money") else None
                edge = self._edge_info({**l, **upd, **sv}, sig, (sig or {}).get("lifted"), xh=self._x_heat({**l, **upd}))
                if sv and books is None:
                    # benchmark books on the benchmark row, the strategy book on its live-holder view
                    open_positions_for(led, {**l, **upd, "edge": edge}, now, self.stats, books=[b for b in BOOKS if b not in MCAP_BOOKS])
                    open_positions_for(led, {**l, **upd, **sv, "edge": edge}, now, self.stats, books=list(MCAP_BOOKS))
                else:
                    open_positions_for(led, {**l, **upd, "edge": edge}, now, self.stats, books=books)
                if self.mcfg.enabled:
                    self._momentum_first_price({**l, **upd, **mv}, q, now)
            for l in expired:
                led.update("launches", {"mint": l["mint"]}, {"strategy_status": "expired_mcap"}); self.stats["mcap_expired"] += 1
            for l in filt:
                q = qs.get(l["mint"])
                if q is not None:
                    f = fdv_of(q, l["supply"], l.get("circ_supply"))
                    if f is not None and f > (l["max_fdv_seen"] or 0):
                        led.update("launches", {"mint": l["mint"]}, {"max_fdv_seen": f})
            for l in crossed:
                q = xq.get(l["mint"])
                if q is None or now > self.end_ts:
                    continue
                g, why = self._gate_entry({**l, "decision": l["asof_decision"]}, q)
                if g is None:
                    self.stats["mcap_cross_gated"].append(safe_reason(f"{l['symbol'] or l['mint'][:8]}: {why}", 200)); continue
                g = self._edge_gate(l, g, "strategy")
                if g.get("mayhem") != 0:
                    why = self._mayhem_block("strategy", g.get("mayhem"), l["symbol"] or l["mint"][:8], l["mint"])
                    self.stats["mcap_cross_gated"].append(safe_reason(why, 200))
                    led.update("launches", {"mint": l["mint"]}, {k: g[k] for k in ("mayhem", "mayhem_source", "mayhem_checked_at")}
                               | ({"strategy_status": "skip_mayhem"} if g.get("mayhem") == 1 else {}))
                    continue                      # unknown: stays waiting, re-read next cycle, never entered while unknown
                if g.get("bundle_block"):
                    self._bundle_count("strategy", l, g["bundle_block"])
                    led.update("launches", {"mint": l["mint"]}, {"strategy_status": "skip_bundle", "bundle_block": g["bundle_block"]})
                    continue
                if (g["entry_fdv"] or 0) < self.min_mcap_usd:
                    continue                      # fell back under the floor on the entry quote
                if g["decision"] == "SKIP":
                    self.stats["mcap_cross_gated"].append(safe_reason(f"{l['symbol'] or l['mint'][:8]}: crossed the floor but gates say SKIP: "
                                                                      + "; ".join(json.loads(g["gate_reasons"])), 200))
                    continue                      # stays filtered_mcap: re-checked next cycle
                if self._pb_on("strategy"):
                    led.update("launches", {"mint": l["mint"]}, {"strategy_status": "watch_pullback", "cross_at": now, "mcap_at_cross": g["entry_fdv"],
                                                                 "cross_decision": g["decision"], "cross_gate_reasons": g["gate_reasons"],
                                                                 "cross_liq": q.liquidity_usd, "cross_holders": g["gate_holders"],
                                                                 "supply": g["supply"], "circ_supply": g["circ_supply"]})
                    self._pb_queue("strategy", l, q, g["entry_fdv"], "mcap_cross", g["decision"], {}, now)
                    continue
                upd = {"strategy_status": "entered_on_cross", "cross_at": now, "mcap_at_cross": g["entry_fdv"], "cross_decision": g["decision"],
                       "cross_gate_reasons": g["gate_reasons"], "cross_liq": q.liquidity_usd, "cross_holders": g["gate_holders"],
                       "supply": g["supply"], "circ_supply": g["circ_supply"]}
                sig = self._smart_sig(l)
                if sig is not None:
                    upd["strategy_decision"] = self._strategy_lift(l, g, sig)
                    upd["smart_money"] = json.dumps({**sig, "lifted": upd["strategy_decision"] != g["decision"]}, default=str)
                led.update("launches", {"mint": l["mint"]}, upd)
                self.stats["mcap_crossings"] += 1
                ent = {**l, **upd, "decision": g["decision"], "gate_reasons": g["gate_reasons"], "gate_holders": g["gate_holders"],
                       "holder_source": g["holder_source"], "price_vs_launch": g["price_vs_launch"], "entry_trigger": "mcap_cross",
                       "entry_at": now, "entry_price": q.price_usd, "entry_mcap": g["entry_fdv"], "entry_liq": q.liquidity_usd,
                       "entry_source": q.source}
                ent["edge"] = self._edge_info(ent, sig, None if sig is None else upd["strategy_decision"] != g["decision"], xh=self._x_heat(ent))
                open_positions_for(led, ent, now, self.stats, books=list(MCAP_BOOKS))
            for l in mom_expired:
                led.update("launches", {"mint": l["mint"]}, {"momentum_status": "expired"}); self.stats["momentum"]["expired"] += 1
            if mom_cands and now <= self.end_ts:
                self._momentum_recheck(mom_cands, xq, now)
            for (book, mint), o in pb_obs.items():
                led.update("watchlist", {"book": book, "mint": mint}, o)
            for w in pb_void:
                self._pb_end(w, "voided", "launch voided")
            for w in pb_rows:
                if now > w["expires_at"]:
                    self._pb_end(w, "expired", "no 20-35% pullback inside the watch window", "pullback_expired")
                    self.stats["edge"]["pullback"]["expired"] += 1
            for w, l in pb_trig:
                q = xq.get(w["mint"])
                if q is None or now > self.end_ts:
                    continue
                self.stats["edge"]["pullback"]["triggered"] += 1
                self._pb_enter(w, l, q, now)
            for l in track:
                q = qs.get(l["mint"])
                upd = {}
                if q is not None:
                    r = q.price_usd / l["entry_price"] - 1
                    upd = {"last_price": q.price_usd, "last_price_at": now, "min_ret": min(l["min_ret"] or 0, r), "max_ret": max(l["max_ret"] or 0, r)}
                    if now - l["entry_at"] >= TIME_EXIT_S:
                        upd.update({"ret_24h": r, "track_done": 1})
                elif now - (l["last_price_at"] or l["entry_at"]) >= DEAD_NO_PRICE_S:
                    upd = {"ret_24h": -1.0, "min_ret": -1.0, "track_done": 1}
                if upd:
                    mn = upd.get("min_ret", l["min_ret"])
                    upd["dumped50"] = int(mn is not None and mn <= DUMP_THRESHOLD)
                    led.update("launches", {"mint": l["mint"]}, upd)
            for p in open_pos:
                q = qs.get(p["mint"])
                if p["book"] in STEP_BOOKS:          # signal books + scanner: the watcher owns them while its lease is live
                    self._signal_step(p, q, now)
                    continue
                if p["book"] in MOMENTUM_FAMILY:
                    if p.get("exit_policy"):
                        self._policy_step(p, q, now)
                    else:
                        self._moon_step(p, q, now)
                    continue
                if q is not None:
                    r = q.price_usd / p["entry_price"] - 1
                    sup = (led.one("SELECT supply FROM launches WHERE mint=?", (p["mint"],)) or {}).get("supply")
                    upd = {"last_price": q.price_usd, "last_price_at": now, "last_mcap": fdv_of(q, sup), "last_mark_at": now,
                           "min_ret": min(p["min_ret"] or 0, r), "max_ret": max(p["max_ret"] or 0, r)}
                    if q.liquidity_usd is not None:
                        upd["last_liq"] = q.liquidity_usd
                    led.update("positions", {"id": p["id"]}, upd); p = {**p, **upd}
                    self.stats["marked"] += 1
                else:
                    led.update("positions", {"id": p["id"]}, {"last_mark_at": now}); self.stats["unpriced_marks"] += 1
                ex = evaluate_exit(p, q, now)
                if ex:
                    close_position(led, p, ex[0], ex[1], ex[2], q, now, self.stats)

    # ---- momentum book ---------------------------------------------------------------------------------------
    def _narrative_index(self):
        from .. import narrative as N
        return N.build_index(self.ctx, self.led, self.clock(), self.mcfg)

    def narrative(self):
        """Theme index, built at most once per cycle (DexScreener lists cached 10 min). Never raises."""
        if self._narr is None:
            try:
                self._narr = self.narrative_fn() or {}
            except Exception as e:
                self._narr = {"themes": {}, "hot": [], "errors": [f"{type(e).__name__}: {e}"[:160]]}
            m = self.stats["momentum"]
            m["hot_themes"] = (self._narr.get("hot") or [])[:8]
            m["narrative_sources"] = self._narr.get("sources") or {}
            m["narrative_errors"] = (self._narr.get("errors") or [])[:5]
        return self._narr

    def _momentum_eval(self, l, q, decision, fdv, now):
        from .. import narrative as N
        ret_now = max_ret = None
        if l.get("entry_price") and l.get("max_ret") is not None:
            ret_now = q.price_usd / l["entry_price"] - 1
            max_ret = l["max_ret"]
        mom = M.momentum_score(q.mom_raw, q.gt_pool, fdv, self.mcfg, ret_now, max_ret)
        sig = self._smart_sig(l)
        if sig is not None:
            self.stats["edge"]["smart_signals"] += 1
            boost = EG.momentum_boost(sig, self.ecfg.smart)
            if boost and mom.get("score") is not None:
                mom = {**mom, "score_before_smart": mom["score"], "smart_money_boost": boost, "score": round(min(100.0, mom["score"] + boost), 1)}
                self.stats["edge"]["smart_boosts"] += 1
        narr = N.score_coin((self._narr or {}).get("themes") or {}, {"mint": l["mint"], "symbol": l.get("symbol"), "name": l.get("name"),
                                                                     "created_at": l.get("created_at")}, now, self.mcfg)
        xh = self._x_heat(l, narr.get("theme"))
        if xh is not None and xh["fresh"] and xh["points"]:
            base = narr.get("score") or 0.0
            narr = {**narr, "score_before_x": base, "x_heat_points": xh["points"], "score": round(max(0.0, min(100.0, base + xh["points"])), 1)}
            self.stats["edge"]["x_points_applied"] += 1
        comb = M.combine(mom, narr, l.get("score"), decision, self.mcfg)
        return {"momentum": mom, "narrative": narr, "combined": comb, "fdv": fdv, "smart": sig, "x_heat": xh,
                "fdv_ok": fdv is not None and fdv >= self.min_mcap_usd}

    def _mom_slots(self):
        n = self.led.one("SELECT COUNT(*) AS n FROM positions WHERE book=? AND status='open' AND void_reason IS NULL", (MOMENTUM_BOOK,))["n"]
        return max(0, min(self.mcfg.max_open - n, self.mcfg.max_new_per_cycle - self.stats["opened"].get(MOMENTUM_BOOK, 0)))

    def _mom_record(self, l, ev, status):
        c = ev["combined"]
        self.led.update("launches", {"mint": l["mint"]}, {
            "momentum_status": status, "mom_score": ev["momentum"]["score"], "narr_score": ev["narrative"]["score"], "mom_combined": c["combined"],
            "theme": ev["narrative"]["theme"], "mom_checked_at": self.clock(), "mom_checks": (l.get("mom_checks") or 0) + 1,
            "mom_detail": json.dumps({"momentum": ev["momentum"], "narrative": ev["narrative"], "selection": c})})

    def _momentum_first_price(self, l, q, now):
        """At a launch's first price: SKIP (risk or gates) is a hard veto; otherwise enter if the floor and the momentum
        + narrative thresholds hold now, else keep it 'watching' (re-checked each cycle for watch_s)."""
        m = self.stats["momentum"]
        m["evaluated"] += 1
        if l["decision"] == "SKIP":
            self.led.update("launches", {"mint": l["mint"]}, {"momentum_status": "skip"}); m["vetoed_skip"] += 1
            return
        if l.get("mayhem") != 0:
            # Mayhem (or unknown) is a hard veto like SKIP; it is not watched (unknown is never re-promoted)
            self.led.update("launches", {"mint": l["mint"]}, {"momentum_status": "skip_mayhem"}); m["vetoed_mayhem"] += 1
            m["rejected"].append(safe_reason(self._mayhem_block(MOMENTUM_BOOK, l.get("mayhem"), l.get("symbol") or l["mint"][:8], l["mint"]), 160))
            return
        if l.get("bundle_block"):
            self.led.update("launches", {"mint": l["mint"]}, {"momentum_status": "skip_bundle"})
            self._bundle_count(MOMENTUM_BOOK, l, l["bundle_block"])
            return
        ev = self._momentum_eval(l, q, l["decision"], l.get("entry_fdv"), now)
        if not ev["fdv_ok"]:
            m["below_mcap_floor"] += 1
        if ev["fdv_ok"] and ev["combined"]["enter"] and self._pb_on(MOMENTUM_BOOK):
            self._pb_queue(MOMENTUM_BOOK, l, q, ev["fdv"], "first_price", l["decision"],
                           {"size_pct": ev["combined"]["size_pct"], "combined": ev["combined"]["combined"]}, now)
            self._mom_record(l, ev, "watch_pullback"); return
        if ev["fdv_ok"] and ev["combined"]["enter"] and self._mom_slots() > 0:
            if self._momentum_enter(l, q, l, ev, now, "first_price"):
                self._mom_record(l, ev, "entered"); return
        why = ev["combined"]["why"] if ev["fdv_ok"] else f"market cap under the {fmt_usd(self.min_mcap_usd, 0)} floor"
        m["rejected"].append(safe_reason(f"{l.get('symbol') or l['mint'][:8]}: {why}", 160))
        self._mom_record(l, ev, "watching")

    def _momentum_recheck(self, cands, xq, now):
        """Watching launches that passed on the tracking quote: re-gate on the entry quote (fresh liquidity, holders,
        price cross-check, market cap), re-score with unique buyers, rank by combined score and enter the best."""
        ranked = []
        for l in cands:
            q = xq.get(l["mint"])
            if q is None:
                continue
            g, why = self._gate_entry({**l, "decision": l["asof_decision"] or l["decision"]}, q)
            if g is None:
                self.stats["momentum"]["rejected"].append(safe_reason(f"{l['symbol'] or l['mint'][:8]}: {why}", 160)); continue
            g = self._edge_gate(l, g, MOMENTUM_BOOK)
            if g["decision"] == "SKIP":
                self.stats["momentum"]["rejected"].append(safe_reason(f"{l['symbol'] or l['mint'][:8]}: gates SKIP on re-check", 160)); continue
            if g.get("mayhem") != 0:
                self.stats["momentum"]["rejected"].append(safe_reason(self._mayhem_block(MOMENTUM_BOOK, g.get("mayhem"), l["symbol"] or l["mint"][:8], l["mint"]), 160))
                self.led.update("launches", {"mint": l["mint"]}, {k: g[k] for k in ("mayhem", "mayhem_source", "mayhem_checked_at")}
                                | ({"momentum_status": "skip_mayhem"} if g.get("mayhem") == 1 else {}))
                continue
            if g.get("bundle_block"):
                self._bundle_count(MOMENTUM_BOOK, l, g["bundle_block"])
                self.led.update("launches", {"mint": l["mint"]}, {"momentum_status": "skip_bundle", "bundle_block": g["bundle_block"]})
                continue
            ev = self._momentum_eval(l, q, g["decision"], g["entry_fdv"], now)
            if ev["fdv_ok"] and ev["combined"]["enter"] and self._pb_on(MOMENTUM_BOOK):
                self._pb_queue(MOMENTUM_BOOK, l, q, g["entry_fdv"], "momentum_recheck", g["decision"],
                               {"size_pct": ev["combined"]["size_pct"], "combined": ev["combined"]["combined"]}, now)
                self._mom_record(l, ev, "watch_pullback"); continue
            if ev["fdv_ok"] and ev["combined"]["enter"]:
                ranked.append((ev["combined"]["combined"], l, q, g, ev))
            else:
                self._mom_record(l, ev, "watching")
        ranked.sort(key=lambda t: -t[0])
        for _, l, q, g, ev in ranked:
            if self._mom_slots() <= 0:
                self._mom_record(l, ev, "watching"); continue
            view = {**l, "decision": g["decision"], "gate_reasons": g["gate_reasons"], "gate_holders": g["gate_holders"],
                    "holder_source": g["holder_source"], "price_vs_launch": g["price_vs_launch"], "entry_fdv": g["entry_fdv"],
                    "supply": g["supply"], "circ_supply": g["circ_supply"], "entry_source": q.source,
                    "mayhem": g.get("mayhem"), "mayhem_source": g.get("mayhem_source")}
            self._mom_record(l, ev, "entered" if self._momentum_enter(view, q, view, ev, now, "momentum_recheck") else "watching")

    def _momentum_enter(self, l, q, gated, ev, now, trigger):
        led, book = self.led, MOMENTUM_BOOK
        if led.one("SELECT 1 FROM positions WHERE book=? AND mint=?", (book, l["mint"])):
            return False
        if gated.get("mayhem", l.get("mayhem")) != 0:      # defence in depth: never enter Mayhem/unknown
            self._mayhem_block(book, gated.get("mayhem", l.get("mayhem")), l.get("symbol") or l["mint"][:8], l["mint"])
            return False
        if gated.get("bundle_block") or l.get("bundle_block"):            # defence in depth: bundle gate
            return False
        st = book_state(led, book)
        pct = ev["combined"]["size_pct"]
        size = round(pct * st["bankroll"], 2)
        if size <= 0:
            return False
        if size > st["cash"] + 1e-9:
            led.insert("misses", {"book": book, "mint": l["mint"], "decision": gated["decision"], "reason": "no_cash", "size_usd": size,
                                  "cash_usd": round(st["cash"], 2), "at": now}, mode="INSERT OR IGNORE")
            self.stats["missed_no_cash"][book] = self.stats["missed_no_cash"].get(book, 0) + 1
            return False
        ec = K.side_cost(size, q.liquidity_usd)
        tokens = size * (1 - ec) / q.price_usd
        c = self.mcfg
        grad, grad_src = self._grad_at_launch(l, q)
        pol = X.get(self.mom_policy) if self.mom_policy else None
        if pol:
            rules = {"policy": pol.name, "rule": pol.describe(grad), "rungs": [{"multiple": m, "share_of_original_pct": f * 100} for m, f in pol.rungs],
                     "stop_before_first_clip_pct": pol.pre_stop * 100, "stop_after_first_clip": X.stop_rule_text(pol, 1, grad),
                     "max_hold_h": pol.max_hold_s / 3600,
                     "fills": "rungs at the rung price when a mark is at/above it (conservative); stops and max hold at the mark"}
        else:
            rules = {"stop_loss_pct": c.stop_loss * 100, "partial_at_return_pct": c.take_profit * 100,
                     "partial_sell": f"{c.partial_min_frac:.0%}-{c.partial_max_frac:.0%} (enough to recover stake + fees)",
                     "trail_from_peak_pct": c.trail_from_peak * 100, "max_hold_h": c.max_hold_s / 3600, "pre_2x_time_exit_h": c.pre_tp_time_exit_s / 3600}
        detail = {"momentum": ev["momentum"], "narrative": ev["narrative"], "selection": ev["combined"], "exit_rules": rules}
        pos = {"book": book, "mint": l["mint"], "decision": gated["decision"], "score": l.get("score"), "size_pct": pct, "size_usd": size,
               "bankroll_at_entry": st["bankroll"], "entry_at": now, "entry_price": q.price_usd, "entry_mcap": ev["fdv"], "entry_liq": q.liquidity_usd,
               "entry_cost": ec, "asof_decision": l.get("asof_decision"), "gate_reasons": gated.get("gate_reasons"), "entry_fdv": ev["fdv"],
               "entry_trigger": trigger, "tokens": tokens, "tokens_initial": tokens, "status": "open", "last_price": q.price_usd,
               "last_price_at": now, "last_mcap": ev["fdv"], "last_liq": q.liquidity_usd, "last_mark_at": now, "min_ret": 0.0, "max_ret": 0.0,
               "theme": ev["narrative"]["theme"], "mom_score": ev["momentum"]["score"], "narr_score": ev["narrative"]["score"],
               "mom_combined": ev["combined"]["combined"], "mom_detail": json.dumps(detail), "peak_price": q.price_usd,
               "mayhem": gated.get("mayhem", l.get("mayhem")),
               "edge": json.dumps(self._edge_info(l, ev.get("smart"), xh=ev.get("x_heat"), pb=ev.get("pullback")), default=str),
               "grad_at_launch": grad, "grad_source": grad_src}
        if pol:
            pos.update({"exit_policy": pol.name, "clips_done": 0, "clip_log": "[]", "stop_price": X.stop_level(pol, q.price_usd, 0, q.price_usd, grad)})
        pos["id"] = led.insert("positions", pos)
        self._open_controls(pos, now)
        self.stats["opened"][book] = self.stats["opened"].get(book, 0) + 1
        self.stats["momentum"]["entered"] += 1
        view = {**l, "entry_trigger": trigger, "entry_source": q.source, "min_entry_mcap": self.min_mcap_usd,
                "edge": self._edge_info(l, ev.get("smart"), xh=ev.get("x_heat"), pb=ev.get("pullback"))}
        payload = {**_buy_payload(led, pos, view), **_momentum_payload_fields(pos, view),
                   **(_clip_fields(pos) if pol else _moon_fields(pos))}
        led.insert("events", {"created_at": now, "book": book, "kind": "BUY", "position_id": pos["id"], "mint": pos["mint"],
                              "payload": payload}, mode="INSERT OR IGNORE")
        self.say(f"momentum BUY {l.get('symbol') or l['mint'][:8]} theme={pos['theme']} mom={pos['mom_score']} comb={pos['mom_combined']} ${size}")
        return True

    # ---- rung exit policies (clip5 + shadow controls; smr/paper/exits.py) ---------------------------------------
    def _grads_index(self):
        """mint -> PumpSwap pool creation time (unix s) from data/backtest/work/graduations.jsonl (collector)."""
        if self._grads is None:
            self._grads = {}
            path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                                "data", "backtest", "work", "graduations.jsonl")
            try:
                with open(path) as f:
                    for line in f:
                        try:
                            g = json.loads(line)
                            t = datetime.fromisoformat(str(g["pool_created_at"]).replace("Z", "+00:00")).timestamp()
                            self._grads.setdefault(g["mint"], t)
                        except (ValueError, KeyError, TypeError):
                            continue
            except OSError:
                pass
        return self._grads

    def _grad_at_launch(self, l, q):
        """Proxy for "graduated to PumpSwap within the same minute it launched" (no on-chain flag is stored).
        -> (1 | 0 | None, source). 1: the PumpSwap pool was created <= grad_window_s after the on-chain create
        (DexScreener pairCreatedAt of a pumpswap entry pair, else the graduation collector's pool_created_at).
        0: a later graduation, or still priced on the pump.fun curve at entry. None: unknown (ladder uses the 40% trail)."""
        win = self.ecfg.mexit.grad_window_s
        created = l.get("created_at")
        if not created:
            return None, "no create time"
        pc = (getattr(q, "mom_raw", None) or {}).get("pair_created_ms")
        if (q.dex or "").lower() == "pumpswap" and pc:
            return int(pc / 1000 - created <= win), "dexscreener_pair_created"
        g = self._grads_index().get(l["mint"])
        if g is not None:
            return int(g - created <= win), "graduations_jsonl"
        if (q.dex or "").lower() == "pumpfun":
            return 0, "on pump.fun curve at entry"
        return None, "unknown"

    def _open_controls(self, mpos, now):
        """Mirror one momentum entry into each shadow control book (same size, tokens, price; no cash check, no events)."""
        for book, name in self.controls.items():
            if self.led.one("SELECT 1 AS x FROM positions WHERE book=? AND mint=?", (book, mpos["mint"])):
                continue
            pol = X.get(name)
            c = {k: mpos[k] for k in ("mint", "decision", "score", "size_pct", "size_usd", "entry_at", "entry_price", "entry_mcap", "entry_liq",
                                     "entry_cost", "asof_decision", "gate_reasons", "entry_fdv", "entry_trigger", "tokens", "tokens_initial",
                                     "last_price", "last_price_at", "last_mcap", "last_liq", "last_mark_at", "min_ret", "max_ret", "theme",
                                     "mom_score", "narr_score", "mom_combined", "peak_price", "mayhem", "grad_at_launch", "grad_source")}
            c.update({"book": book, "status": "open", "bankroll_at_entry": book_state(self.led, book)["bankroll"], "exit_policy": name,
                      "clips_done": 0, "clip_log": "[]", "mirror_of": mpos["id"],
                      "stop_price": X.stop_level(pol, mpos["entry_price"], 0, mpos["entry_price"], mpos.get("grad_at_launch")) if pol
                      else SX.stop_level(name, mpos["entry_price"], False, mpos["entry_price"])})
            if book in SIGNAL_BOOKS:
                # permanent dust bag: never sold; realized PnL counts it at zero, the report also values it at its last mark
                c.update({"dust_frac": SX.DUST_FRAC, "dust_tokens": mpos["tokens"] * SX.DUST_FRAC, "sig_state": "{}"})
            self.led.insert("positions", c)
            self.stats["opened"][book] = self.stats["opened"].get(book, 0) + 1
            self.stats["momentum"]["control_entries"] += 1

    def _policy_step(self, p, q, now):
        """Mark one rung-policy position (momentum clip5 or a control) and apply its exits."""
        led = self.led
        if q is None:
            led.update("positions", {"id": p["id"]}, {"last_mark_at": now}); self.stats["unpriced_marks"] += 1
            if now - (p["last_price_at"] or p["entry_at"]) >= DEAD_NO_PRICE_S:
                close_position(led, p, "dead_token_no_price_24h", None, None, None, now, self.stats)
                self._count_close(p)
            return
        pol = X.get(p["exit_policy"])
        r = q.price_usd / p["entry_price"] - 1
        sup = (led.one("SELECT supply, circ_supply FROM launches WHERE mint=?", (p["mint"],)) or {})
        upd = {"last_price": q.price_usd, "last_price_at": now, "last_mcap": fdv_of(q, sup.get("supply"), sup.get("circ_supply")),
               "last_mark_at": now, "min_ret": min(p["min_ret"] or 0, r), "max_ret": max(p["max_ret"] or 0, r),
               "peak_price": max(p.get("peak_price") or p["entry_price"], q.price_usd)}
        if q.liquidity_usd is not None:
            upd["last_liq"] = q.liquidity_usd
        led.update("positions", {"id": p["id"]}, upd); p = {**p, **upd}
        self.stats["marked"] += 1
        for a in X.evaluate(pol, p, q.price_usd, now):
            if a[0] == "clip":
                p = self._clip(p, q, pol, a, now)
                if p["status"] == "closed":
                    return
            else:
                close_position(led, p, a[1], a[3], q.liquidity_usd, q, now, self.stats, trigger=a[2])
                self._count_close(p)
                return
        sl = X.stop_level(pol, p["entry_price"], p.get("clips_done") or 0, p["peak_price"], p.get("grad_at_launch"))
        led.update("positions", {"id": p["id"]}, {"stop_price": sl})

    def _signal_step(self, p, q, now):
        """Signal books: the exit watcher owns them while its lease is live (skip); otherwise (watcher down) apply the same
        step here, at the cycle's cadence, on a row re-read inside this transaction."""
        from . import sigbooks as SB
        ms = self.stats["momentum"]
        if SB.lease_active(self.led, now):
            ms["signal_books_skipped_watcher_owns"] = ms.get("signal_books_skipped_watcher_owns", 0) + 1
            return
        fresh = self.led.one("SELECT * FROM positions WHERE id=? AND status='open' AND void_reason IS NULL", (p["id"],))
        if fresh is None:
            return
        if fresh["last_mark_at"] and now - fresh["last_mark_at"] < SB.MIN_MARK_GAP_S:
            return                      # the cycle's second pass ("final marks") is not a new 1-min mark
        ms["signal_books_cycle_fallback"] = ms.get("signal_books_cycle_fallback", 0) + 1
        SB.step(self.led, fresh, q, now, "cycle", self.stats)

    def _count_close(self, p):
        if p["book"] in CONTROL_BOOKS:
            self.stats["momentum"]["control_closed"] += 1
        elif p.get("partial_at"):
            self.stats["momentum"]["moon_closed"] += 1

    def _clip(self, p, q, pol, a, now):
        """Fill one rung: sell `frac` of the ORIGINAL tokens at the conservative fill price; realize it into the book.
        The last rung of a fully-laddered policy (clip5 10x, x1 3x) closes the position. Momentum book: PARTIAL_SELL
        event (seq = clip number) with the alert fields; controls write no events."""
        led = self.led
        _, n, mult, frac, tgt, fill = a
        liq = q.liquidity_usd if q.liquidity_usd is not None else p["last_liq"]
        t0 = p.get("tokens_initial") or p["tokens"]
        done_before = X.sold_frac(pol, n - 1)
        sold = min(p["tokens"], t0 * frac)
        last_rung = n == len(pol.rungs) and X.sold_frac(pol, n) >= X.FULL
        if last_rung:
            sold = p["tokens"]
        value = sold * fill
        xc = K.exit_cost(value, liq, p["entry_cost"])
        proceeds = value * (1 - xc)
        cost_basis = p["size_usd"] * frac
        try:
            log = json.loads(p.get("clip_log") or "[]")
        except ValueError:
            log = []
        rec = {"clip": n, "of": len(pol.rungs), "multiple": mult, "at": now, "at_ct": iso_ct(now), "trigger_price_usd": tgt,
               "mark_price_usd": q.price_usd, "fill_price_usd": fill, "fill_rule": "rung price (mark at/above it; conservative)",
               "mark_vs_trigger_pct": round((q.price_usd / tgt - 1) * 100, 2), "share_of_original_pct": round(frac * 100, 1),
               "tokens": sold, "exit_cost_pct": round(xc * 100, 2), "proceeds_usd": round(proceeds, 4),
               "pnl_usd": round(proceeds - cost_basis, 4)}
        log.append(rec)
        cum_frac = done_before + frac
        upd = {"tokens": 0.0 if last_rung else p["tokens"] - sold, "tokens_initial": t0, "clips_done": n, "clip_log": json.dumps(log),
               "partial_frac": min(1.0, cum_frac), "partial_tokens": (p.get("partial_tokens") or 0) + sold,
               "partial_cost": xc, "partial_proceeds_usd": (p.get("partial_proceeds_usd") or 0) + proceeds,
               "partial_pnl_usd": (p.get("partial_pnl_usd") or 0) + proceeds - cost_basis}
        if not p.get("partial_at"):
            upd.update({"partial_at": now, "partial_price": fill})
        upd["stop_price"] = X.stop_level(pol, p["entry_price"], n, p["peak_price"], p.get("grad_at_launch"))
        led.update("positions", {"id": p["id"]}, upd)
        p = {**p, **upd}
        key = f"{p['book']}:{pol.name}"
        self.stats["momentum"]["clips"][key] = self.stats["momentum"]["clips"].get(key, 0) + 1
        if p["book"] == MOMENTUM_BOOK:
            self.stats["momentum"]["partials"] += 1
            buy = led.one("SELECT payload FROM events WHERE position_id=? AND kind='BUY'", (p["id"],))
            bp = json.loads(buy["payload"]) if buy else {}
            last = {"clip_no": n, "clip_label": f"clip {n}/{len(pol.rungs)}", "clip_multiple": mult, "clip_trigger_price_usd": tgt,
                    "clip_mark_price_usd": q.price_usd, "clip_fill_price_usd": fill, "clip_share_sold_pct": round(frac * 100, 1),
                    "clip_proceeds_usd": round(proceeds, 2), "clip_pnl_usd": round(proceeds - cost_basis, 2), "clip_at_ct": iso_ct(now),
                    "clip_exit_cost_pct": round(xc * 100, 2)}
            payload = {**bp, "kind": "PARTIAL_SELL", "partial_reason": f"{pol.name}_clip_{n}_{mult:g}x", "observed_price_usd": q.price_usd,
                       "hold_hours": round((now - p["entry_at"]) / 3600, 2),
                       "bankroll_after": round(book_state(led, p["book"])["bankroll"], 2), **_clip_fields(p, last=last)}
            led.insert("events", {"created_at": now, "book": p["book"], "kind": "PARTIAL_SELL", "position_id": p["id"], "mint": p["mint"],
                                  "seq": n, "payload": payload}, mode="INSERT OR IGNORE")
        if last_rung:
            close_position(led, p, f"{pol.name}_all_clips_filled", fill, liq, q, now, self.stats, trigger=tgt)
            self._count_close(p)
            p = {**p, "status": "closed"}
        return p

    def _moon_step(self, p, q, now):
        """Mark one momentum-book position and apply the moon-bag exit rules."""
        led = self.led
        if q is not None:
            r = q.price_usd / p["entry_price"] - 1
            sup = (led.one("SELECT supply, circ_supply FROM launches WHERE mint=?", (p["mint"],)) or {})
            upd = {"last_price": q.price_usd, "last_price_at": now, "last_mcap": fdv_of(q, sup.get("supply"), sup.get("circ_supply")),
                   "last_mark_at": now, "min_ret": min(p["min_ret"] or 0, r), "max_ret": max(p["max_ret"] or 0, r)}
            if q.liquidity_usd is not None:
                upd["last_liq"] = q.liquidity_usd
            led.update("positions", {"id": p["id"]}, upd); p = {**p, **upd}
            self.stats["marked"] += 1
            ex = M.evaluate_moon_exit(p, q.price_usd, now, self.mcfg)
            if ex and ex[0] == "partial":
                self._partial(p, q, ex[2], now)
            elif ex:
                close_position(led, p, ex[1], ex[2], q.liquidity_usd, q, now, self.stats)
                if p.get("partial_at"):
                    self.stats["momentum"]["moon_closed"] += 1
            if not ex or ex[0] == "partial":
                pk = max(p.get("peak_price") or 0, q.price_usd)
                if ex:
                    pk = max(pk, ex[2])
                led.update("positions", {"id": p["id"]}, {"peak_price": pk})
            return
        led.update("positions", {"id": p["id"]}, {"last_mark_at": now}); self.stats["unpriced_marks"] += 1
        if now - (p["last_price_at"] or p["entry_at"]) >= DEAD_NO_PRICE_S:
            close_position(led, p, "dead_token_no_price_24h", None, None, None, now, self.stats)

    def _partial(self, p, q, fill, now):
        """At 2x: sell enough (at the 2x target, like a resting limit) to take out the stake plus fees; the rest rides."""
        led = self.led
        liq = q.liquidity_usd if q.liquidity_usd is not None else p["last_liq"]
        ec = p["entry_cost"]
        frac = M.partial_fraction(p["size_usd"], p["tokens"], fill, lambda v: K.exit_cost(v, liq, ec), self.mcfg)
        sold = p["tokens"] * frac
        value = sold * fill
        xc = K.exit_cost(value, liq, ec)
        proceeds = value * (1 - xc)
        upd = {"tokens": p["tokens"] - sold, "tokens_initial": p.get("tokens_initial") or p["tokens"], "partial_at": now, "partial_price": fill,
               "partial_frac": frac, "partial_tokens": sold, "partial_cost": xc, "partial_proceeds_usd": proceeds,
               "partial_pnl_usd": proceeds - p["size_usd"] * frac, "peak_price": max(p.get("peak_price") or 0, q.price_usd, fill), "moon_bag": "riding"}
        led.update("positions", {"id": p["id"]}, upd)
        p = {**p, **upd}
        self.stats["momentum"]["partials"] += 1
        buy = led.one("SELECT payload FROM events WHERE position_id=? AND kind='BUY'", (p["id"],))
        bp = json.loads(buy["payload"]) if buy else {}
        c = self.mcfg
        payload = {**bp, "kind": "PARTIAL_SELL", "partial_reason": "take_profit_partial_2x", "observed_price_usd": q.price_usd,
                   "partial_exit_cost_pct": round(xc * 100, 2), "hold_hours": round((now - p["entry_at"]) / 3600, 2),
                   "bankroll_after": round(book_state(led, p["book"])["bankroll"], 2),
                   "moon_bag_rule": f"trailing stop {c.trail_from_peak:.0%} below its peak, max hold {c.max_hold_s / 3600:g}h from entry",
                   **_moon_fields(p)}
        led.insert("events", {"created_at": now, "book": p["book"], "kind": "PARTIAL_SELL", "position_id": p["id"], "mint": p["mint"],
                              "payload": payload}, mode="INSERT OR IGNORE")

    # ---- step 2: discovery + scoring -----------------------------------------------------------------------
    def _discover(self, now, want):
        """Recent pump.fun creates from the on-chain mint-authority stream (launches.db, publicnode RPC), prefiltered
        with the backtest/watch eligibility rule (>= min_txs successful txs in the first 5 min)."""
        from ..backtest.sampler import _check
        from concurrent.futures import ThreadPoolExecutor
        ctx, led = self.ctx, self.led
        ctx.anchors.ensure_range(int(now) - self.max_age_s - 300, int(now), max_pages=40)
        rows = ctx.anchors.db.execute("SELECT signature, block_time FROM stream WHERE err=0 AND block_time BETWEEN ? AND ? ORDER BY block_time",
                                      (int(now - self.max_age_s), int(now - self.min_age_s))).fetchall()
        done = {r["create_sig"] for r in led.q("SELECT create_sig FROM checked WHERE checked_at > ?", (now - 7200,))}
        rows = [r for r in rows if r[0] not in done]
        self.stats["candidates_in_window"] = len(rows)
        self.rng.shuffle(rows)       # random sample of the window: no newest/oldest bias
        out, deadline = [], self.t0 + min(150, self.budget_s * 0.3)
        with ThreadPoolExecutor(8) as ex:
            for i in range(0, len(rows), 8):
                if len(out) >= want or self.clock() > deadline:
                    break
                for (sig, bt), r in zip(rows[i:i + 8], ex.map(lambda r: _check(ctx, r[0], r[1], self.min_txs, ctx.settings.score_delay_s), rows[i:i + 8])):
                    self.stats["checked"] += 1
                    mint = r.get("mint")
                    led.insert("checked", {"create_sig": sig, "mint": mint, "create_time": r.get("create_time") or bt,
                                           "txs_first_5m": r.get("txs_first_5m"), "eligible": r.get("eligible", 0), "note": r.get("note"),
                                           "checked_at": self.clock(), "cycle_id": self.cycle_id}, mode="INSERT OR REPLACE")
                    if r.get("eligible") and mint and not led.one("SELECT 1 FROM launches WHERE mint=?", (mint,)):
                        out.append({"mint": mint, "create_sig": sig, "created_at": int(r.get("create_time") or bt), "txs_first_5m": r.get("txs_first_5m")})
        return out[:want]

    def _score(self, mint, as_of, coin):
        from ..pipeline import score_mint
        return score_mint(mint, ctx=self.ctx, as_of=as_of, coin=coin)

    def score_new(self):
        now = self.clock()
        if now > self.end_ts:
            self.say("paper week is over: no new launches scored (positions are still marked)")
            return
        cands = self.discover_fn(now, self.cap)
        self.stats["eligible"] = len(cands)
        if not cands:
            return
        # name/symbol for the report come from DexScreener (untrusted; sanitized), never from pump.fun
        meta = self._price([c["mint"] for c in cands])
        work = queue.Queue(); res = queue.Queue()
        for c in cands:
            work.put(c)
        delay = self.ctx.settings.score_delay_s if self.ctx is not None else 300

        def worker():
            while True:
                try:
                    c = work.get_nowait()
                except queue.Empty:
                    return
                t = time.time()
                q = meta.get(c["mint"])
                coin = {"name": safe_field(q.name, 64), "symbol": safe_field(q.symbol, 32)} if q else {}
                try:
                    doc = self.score_fn(c["mint"], c["created_at"] + delay, coin)
                    res.put((c, doc, None, time.time() - t))
                except Exception as e:
                    res.put((c, None, f"{type(e).__name__}: {e}"[:300], time.time() - t))
        # daemon threads: a stuck score cannot hold the cycle past its budget
        for _ in range(max(1, self.parallel)):
            threading.Thread(target=worker, daemon=True).start()
        deadline = self.t0 + self.budget_s - 45
        got = 0
        while got < len(cands):
            left = deadline - self.clock()
            if left <= 0:
                break
            try:
                c, doc, err, el = res.get(timeout=min(5, left))
            except queue.Empty:
                continue
            got += 1
            self._record(c, doc, err, el, meta.get(c["mint"]))
            if doc is not None:
                self.mark_and_enter(entries_only=[c["mint"]])   # enter at the first price after the decision
        if got < len(cands):
            done = {r["mint"] for r in self.led.q("SELECT mint FROM launches")}
            for c in cands:
                if c["mint"] not in done:
                    self.stats["score_timeouts"] += 1
                    self.led.insert("launches", {"mint": c["mint"], "create_sig": c["create_sig"], "created_at": c["created_at"],
                                                 "discovered_at": now, "txs_first_5m": c["txs_first_5m"], "status": "timeout",
                                                 "error": "score did not finish within the cycle budget", "cycle_id": self.cycle_id},
                                    mode="INSERT OR IGNORE")
            while True:     # drain: never dropping its claim on a mint keeps the ledger idempotent
                try:
                    work.get_nowait()
                except queue.Empty:
                    break

    def _record(self, c, doc, err, el, q):
        now = self.clock()
        row = {"mint": c["mint"], "create_sig": c["create_sig"], "created_at": c["created_at"], "discovered_at": self.t0,
               "txs_first_5m": c["txs_first_5m"], "scored_at": now, "score_elapsed_s": round(el, 2), "cycle_id": self.cycle_id}
        if doc is None:
            row.update({"status": "error", "error": err}); self.stats["score_errors"] += 1
        else:
            s = doc.get("orchestrator_summary") or {}
            ev = doc.get("evidence") or {}
            asset = doc.get("asset") or {}
            row.update({"status": "scored", "as_of": c["created_at"] + (self.ctx.settings.score_delay_s if self.ctx else 300),
                        "decision": doc.get("recommendation"), "score": doc.get("score"), "raw_points": doc.get("raw_points"),
                        "max_size_pct": s.get("max_size_pct"), "confidence": s.get("confidence"),
                        "top_reasons": json.dumps([safe_reason(t) for t in (s.get("top_reasons") or [])[:3]]),
                        "asof_decision": doc.get("recommendation"),
                        "hard_flags": json.dumps(s.get("hard_flags") or []), "holder_count": (ev.get("holders") or {}).get("holder_count"),
                        "model_version": s.get("model"), "report_id": doc.get("report_id"),
                        "symbol": safe_field(asset.get("symbol") or (q.symbol if q else None), 32),
                        "name": safe_field(asset.get("name") or (q.name if q else None), 64), "entry_status": "pending"})
            row.update(EG.bundle_fields(doc))           # data only; the gate itself is EG.bundle_block at entry
            self.stats["scored"] += 1
            self.stats["decisions"][row["decision"]] = self.stats["decisions"].get(row["decision"], 0) + 1
            self.say(f"{row['symbol'] or c['mint'][:8]} {row['decision']} score={row['score']} ({el:.0f}s)")
        self.led.insert("launches", row, mode="INSERT OR IGNORE")

    # ---- equity --------------------------------------------------------------------------------------------
    def snapshot(self):
        now = self.clock()
        for book in ALL_BOOKS:
            st = book_state(self.led, book)
            v = sum(liquidation_value(p) for p in self.led.q("SELECT * FROM positions WHERE book=? AND status='open' AND void_reason IS NULL", (book,)))
            mtm = st["bankroll"] - st["open_cost"] + v
            self.led.insert("equity", {"cycle_id": self.cycle_id, "book": book, "at": now, "realized": st["bankroll"], "mtm": mtm,
                                       "open_count": st["open"]}, mode="INSERT OR REPLACE")

    def run(self):
        self.cycle_id = self.led.insert("cycles", {"started_at": self.t0})
        self.say("marking open positions"); self.mark_and_enter()
        self.say("discovering + scoring new launches"); self.score_new()
        self.say("retrying unpriced entries + final marks"); self.mark_and_enter()
        self.backfill_mayhem()
        self.snapshot()
        el = self.clock() - self.t0
        self.stats["elapsed_s"] = round(el, 1)
        self.stats["price_errors"] = self.stats["price_errors"][:10]
        self.stats["momentum"]["rejected"] = list(dict.fromkeys(self.stats["momentum"]["rejected"]))[:15]
        self.stats["mcap_cross_gated"] = list(dict.fromkeys(self.stats["mcap_cross_gated"]))[:20]
        self.led.update("cycles", {"id": self.cycle_id}, {"finished_at": self.clock(), "elapsed_s": round(el, 2), "stats": json.dumps(self.stats)})
        return {"cycle_id": self.cycle_id, **self.stats}


def default_ledger_path(ctx=None):
    d = ctx.settings.data_dir if ctx is not None else os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data")
    return os.path.join(d, "paper.db")


def void_cycle(led, cycle_id, reason, now=None):
    """Void every launch/position/miss/event of one cycle (rows kept for audit, excluded from PnL and stats).
    Unreported events of voided positions are marked reported so they are never sent; earlier equity snapshots
    (which contained the voided positions) are voided too, so every book restarts from START_BANKROLL."""
    now = now or time.time()
    with led.tx():
        mints = [r["mint"] for r in led.q("SELECT mint FROM launches WHERE cycle_id=?", (cycle_id,))]
        if not mints:
            return {"cycle_id": cycle_id, "launches": 0, "positions": 0, "events_marked": 0}
        ph = ",".join("?" * len(mints))
        led.db.execute(f"UPDATE launches SET void_reason=? WHERE mint IN ({ph}) AND void_reason IS NULL", (reason, *mints))
        npos = led.db.execute(f"UPDATE positions SET void_reason=? WHERE mint IN ({ph}) AND void_reason IS NULL", (reason, *mints)).rowcount
        led.db.execute(f"UPDATE misses SET void_reason=? WHERE mint IN ({ph}) AND void_reason IS NULL", (reason, *mints))
        nev = led.db.execute(f"UPDATE events SET reported_at=?, void_reason=? WHERE mint IN ({ph}) AND reported_at IS NULL", (now, reason, *mints)).rowcount
        led.db.execute(f"UPDATE events SET void_reason=? WHERE mint IN ({ph}) AND void_reason IS NULL", (reason, *mints))
        neq = led.db.execute("UPDATE equity SET void_reason=? WHERE at <= ? AND void_reason IS NULL", (reason, now)).rowcount
    return {"cycle_id": cycle_id, "reason": reason, "launches": len(mints), "positions": npos, "events_marked": nev, "equity_rows": neq}


def void_position(led, reason, *, position_id=None, mint=None, book="strategy", now=None):
    """Void ONE position (by id, or by mint within `book`); other books' positions for the same mint are untouched.
    The row is kept for audit with void_reason set. Because bankroll/cash are derived from non-voided rows, this
    refunds its cost and fees and drops any realized or unrealized PnL. Its events are marked reported (never sent) and
    voided; that book's equity snapshots taken while it was held are voided (they contained it). If it is a strategy
    (market-cap-floor) book position, the launch's strategy_status becomes 'voided' so it is not counted as an entry
    and is never re-entered on a later cross. The launch itself stays valid for the other books and tier stats."""
    now = now or time.time()
    if (position_id is None) == (mint is None):
        raise ValueError("give exactly one of position_id or mint")
    with led.tx():
        if position_id is not None:
            p = led.one("SELECT * FROM positions WHERE id=?", (int(position_id),))
        else:
            p = led.one("SELECT * FROM positions WHERE book=? AND mint=?", (book, mint))
        if p is None:
            return {"found": False, "position_id": position_id, "mint": mint, "book": book, "positions": 0}
        out = {"found": True, "position_id": p["id"], "book": p["book"], "mint": p["mint"], "status": p["status"],
               "size_usd": p["size_usd"], "pnl_usd": p["pnl_usd"], "reason": reason}
        if p["void_reason"] is not None:
            return {**out, "positions": 0, "already_voided": p["void_reason"]}
        before = book_state(led, p["book"])
        led.db.execute("UPDATE positions SET void_reason=? WHERE id=?", (reason, p["id"]))
        nev = led.db.execute("UPDATE events SET reported_at=?, void_reason=? WHERE position_id=? AND reported_at IS NULL",
                             (now, reason, p["id"])).rowcount
        led.db.execute("UPDATE events SET void_reason=? WHERE position_id=? AND void_reason IS NULL", (reason, p["id"]))
        end = p["exit_at"] if p["status"] == "closed" and p["exit_at"] else now
        neq = led.db.execute("UPDATE equity SET void_reason=? WHERE book=? AND at>=? AND at<=? AND void_reason IS NULL",
                             (reason, p["book"], p["entry_at"], end)).rowcount
        if p["book"] in MCAP_BOOKS:
            led.db.execute("UPDATE launches SET strategy_status='voided' WHERE mint=?", (p["mint"],))
        nmir = 0
        if p["book"] == MOMENTUM_BOOK:
            led.db.execute("UPDATE launches SET momentum_status='voided' WHERE mint=?", (p["mint"],))
            # its shadow exit controls (same entry) go with it
            for c in led.q("SELECT * FROM positions WHERE mirror_of=? AND void_reason IS NULL", (p["id"],)):
                led.db.execute("UPDATE positions SET void_reason=? WHERE id=?", (reason, c["id"]))
                cend = c["exit_at"] if c["status"] == "closed" and c["exit_at"] else now
                led.db.execute("UPDATE equity SET void_reason=? WHERE book=? AND at>=? AND at<=? AND void_reason IS NULL",
                               (reason, c["book"], c["entry_at"], cend))
                nmir += 1
        after = book_state(led, p["book"])
    return {**out, "positions": 1, "control_positions_voided": nmir, "events_marked": nev, "equity_rows": neq,
            "bankroll_before": round(before["bankroll"], 2), "bankroll_after": round(after["bankroll"], 2),
            "cash_before": round(before["cash"], 2), "cash_after": round(after["cash"], 2), "open_after": after["open"]}
