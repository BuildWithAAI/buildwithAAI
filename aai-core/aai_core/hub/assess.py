"""assess(): one risk_decision for one proposed position, any asset class.

Pipeline: market data -> metrics (ATR, realized vol, spread, depth, funding, ADV) -> rule reasons ->
account guardrails -> tier (SKIP/REDUCED/NORMAL) -> fixed-fractional size x tier multiplier -> caps
(leverage policy, total-risk budget, correlated-risk budget) -> risk_decision v1 (validated).
Rules are risk hygiene with conservative fixed thresholds; none of them is a fitted or validated signal.
"""
from __future__ import annotations
import time
from ..config import Settings
from ..data.registry import Market
from ..data.forex import MAJORS, CROSSES_OK, parse_pair
from ..infra.http import SourceError
from ..risk import vol as V, liquidity as LQ, portfolio as PF, guardrails as G, decision as D
from ..risk.sizing import position_size, clamp_risk_pct, SizingError
from . import smr_bridge

DEFAULT_INTERVAL = {"crypto_perp": "1h", "forex": "1h", "equity": "1d"}
VALID_FOR_S = {"crypto_perp": 300, "forex": 900, "equity": 3600, "solana_meme": 900}
MAX_LEVERAGE = {"crypto_perp": 5.0, "forex": 20.0, "equity": 1.0}            # policy caps (size only shrinks)
DEFAULT_ACCOUNT = {"crypto_perp": "margin", "forex": "margin", "equity": "retirement"}
DEFAULT_BANKROLL = 10_000.0
ASSUMED_STOP_ATR = 2.0


class AssessError(ValueError):
    pass


def _r(code, pts, sev, detail, hard=False):
    return D.reason(code, pts, sev, detail, hard)


def _bankroll(bankroll, book):
    if bankroll:
        return float(bankroll), False
    b = book["account"].get("bankroll") or book["account"].get("equity")
    return (float(b), False) if b else (DEFAULT_BANKROLL, True)


def assess(asset_class: str, symbol: str, side: str = "long", entry: float | None = None, stop: float | None = None,
           bankroll: float | None = None, risk_pct: float | None = None, book_path: str | None = None,
           interval: str | None = None, venue: str = "auto", account_type: str | None = None,
           settings: Settings | None = None, market: Market | None = None, now: float | None = None,
           smr_args: list[str] | None = None) -> dict:
    settings = settings or Settings()
    now = time.time() if now is None else now
    book = PF.load_book(book_path)
    lim = G.limits(book)
    if asset_class == "solana_meme":
        return _assess_meme(symbol, side, bankroll, risk_pct, book, lim, settings, now, smr_args)
    if asset_class not in DEFAULT_INTERVAL:
        raise AssessError(f"unknown asset class {asset_class!r}")
    market = market or Market(settings)
    feed = market.feed(asset_class)
    interval = interval or DEFAULT_INTERVAL[asset_class]
    account_type = account_type or DEFAULT_ACCOUNT[asset_class]
    reasons, warnings, metrics = [], [], {}
    conf = 2   # 2 high, 1 medium, 0 low

    # ---- market data
    kw = {"venue": venue} if asset_class == "crypto_perp" else {}
    series = feed.candles(symbol, interval, 300 if asset_class == "equity" else 200, now=now, **kw)
    q = feed.quote(symbol, **kw)
    closed = series.closed()
    if len(closed) < 30:
        raise AssessError(f"only {len(closed)} closed candles for {symbol}; need >= 30")
    last_ts = closed[-1][0]
    a = V.atr(closed, 14)
    ppy = V.PERIODS_PER_YEAR[asset_class][interval]
    closes = [c[4] for c in closed]
    metrics.update({"interval": interval, "last_price": q.last, "bid": q.bid, "ask": q.ask, "spread_bps": q.spread_bps,
                    "atr14": a, "atr14_pct": round(a / closes[-1] * 100, 4) if a else None,
                    "realized_vol_annual_30": V.realized_vol(closes, 30, ppy),
                    "realized_vol_annual_100": V.realized_vol(closes, 100, ppy),
                    "vol_ratio_20_100": V.vol_ratio(closes, 20, 100), "last_closed_candle_ts": last_ts})

    # ---- entry / stop
    if entry is None:
        entry = (q.ask if side == "long" else q.bid) or q.last
        warnings.append(f"entry not given: using current {'ask' if q.ask else 'last'} {entry}")
    assumed = False
    if stop is None:
        if not a:
            raise AssessError("no stop given and ATR unavailable")
        stop = entry - ASSUMED_STOP_ATR * a if side == "long" else entry + ASSUMED_STOP_ATR * a
        assumed, conf = True, min(conf, 1)
        reasons.append(_r("assumed_stop", 0, "info", f"no stop given: assumed {ASSUMED_STOP_ATR}x ATR14({interval}) = {stop:.6g}"))
    risk_pct_req = risk_pct
    try:
        risk_pct, notes = clamp_risk_pct(risk_pct)
        warnings += notes
        bank, bank_assumed = _bankroll(bankroll, book)
        if bank_assumed:
            warnings.append(f"bankroll not given: sizes are per {DEFAULT_BANKROLL:,.0f} units")
        fx = _quote_to_account(asset_class, symbol, entry, feed, metrics, warnings)
        base = position_size(bank, risk_pct, entry, stop, side, max_leverage=MAX_LEVERAGE[asset_class], quote_to_account=fx)
    except SizingError as e:
        reasons.append(_r("invalid_order", 100, "hard", str(e), hard=True))
        return _finish(asset_class, symbol, q.venue, side, reasons, warnings, metrics, None, {}, {}, series, feed, 0, now)

    # ---- rules
    k = abs(entry - stop) / a if a else None
    metrics["stop_atr_multiple"] = round(k, 3) if k else None
    if k is not None:
        if k < 0.5:
            reasons.append(_r("stop_inside_noise", 30, "warn", f"stop is {k:.2f}x ATR14({interval}); likely stopped out by normal noise"))
        elif k < 1.0:
            reasons.append(_r("tight_stop", 15, "warn", f"stop is {k:.2f}x ATR14({interval})"))
    else:
        conf = 0
    vr = metrics["vol_ratio_20_100"]
    if vr is not None and vr >= 2.0:
        reasons.append(_r("volatility_expansion", 20, "warn", f"20-bar realized vol is {vr:.2f}x the 100-bar level"))
    elif vr is not None and vr >= 1.5:
        reasons.append(_r("volatility_elevated", 10, "warn", f"20-bar realized vol is {vr:.2f}x the 100-bar level"))
    pts, sev, det = LQ.spread_check(asset_class, q.spread_bps)
    reasons.append(_r("spread", pts, sev, det))
    if q.spread_bps is None:
        conf = min(conf, 1)
    age = now - (last_ts + V_INTERVAL(interval))
    if asset_class == "crypto_perp" and age > 3 * V_INTERVAL(interval):
        reasons.append(_r("data_stale", 20, "warn", f"last closed candle is {age/60:.0f} min old")); conf = 0
    elif asset_class != "crypto_perp" and age > 2 * V_INTERVAL(interval) + 3600:
        reasons.append(_r("market_closed_or_stale", 0, "info", f"last closed {interval} candle ended {age/3600:.1f} h ago (market closed?)"))
        warnings.append("market appears closed or data delayed: fills at the next open can gap past the stop")
    if asset_class == "crypto_perp":
        perp = q.perp or {}
        dpts, dsev, ddet, frac = LQ.depth_check(base["notional"], side, q.depth)
        reasons.append(_r("book_depth", dpts, dsev, ddet)); metrics["depth"] = q.depth; metrics["depth_fraction"] = frac
        fr, fi = perp.get("funding_rate"), perp.get("funding_interval_h") or 8.0
        if fr is not None:
            r8 = fr * 8.0 / fi
            cost = r8 if side == "long" else -r8
            metrics.update({"funding_rate": fr, "funding_interval_h": fi, "funding_8h_equiv": r8, "funding_cost_8h_for_side": cost})
            if cost >= 0.001:
                reasons.append(_r("funding_cost", 20, "warn", f"paying {cost*100:.3f}% per 8h as {side}"))
            elif cost >= 0.0005:
                reasons.append(_r("funding_cost", 10, "warn", f"paying {cost*100:.3f}% per 8h as {side}"))
        metrics.update({"open_interest_usd": perp.get("open_interest_usd"), "volume_24h_quote": perp.get("volume_24h_quote")})
        if any(not x["ok"] for x in feed.attempts):
            warnings.append("primary venue unavailable; data from fallback venue " + q.venue + " (prices/funding may differ from the user's venue)")
            conf = min(conf, 1)
    if asset_class == "forex":
        b_, q_ = parse_pair(symbol)
        pair = b_ + q_
        if pair not in MAJORS:
            reasons.append(_r("non_major_pair", 10 if pair in CROSSES_OK else 20, "warn", f"{pair} is not a USD major: wider spreads, thinner liquidity"))
        ecb = feed.ecb_check(symbol)
        metrics["ecb_reference"] = ecb
        if ecb.get("rate") and q.last:
            dev = abs(q.last / ecb["rate"] - 1) * 100
            metrics["ecb_deviation_pct"] = round(dev, 4)
            if dev > 1.5:
                reasons.append(_r("price_source_mismatch", 10, "warn", f"Yahoo {q.last} vs ECB fix {ecb['rate']} ({ecb['date']}) differ {dev:.2f}%"))
                conf = min(conf, 1)
        warnings.append("no broker feed: real MT5 spread, swap and slippage unknown")
    if asset_class == "equity":
        adv = LQ.avg_dollar_volume(closed if interval == "1d" else [], 20)
        apts, asev, adet, afrac = LQ.adv_check(base["notional"], adv)
        reasons.append(_r("dollar_volume", apts, asev, adet)); metrics.update({"adv20_usd": adv, "adv_fraction": afrac})
        conc = base["notional"] / bank * 100
        metrics["position_pct_of_bankroll"] = round(conc, 3)
        if conc > 20:
            reasons.append(_r("concentration", 15, "warn", f"position would be {conc:.1f}% of bankroll"))
        if side == "short" and account_type in ("retirement", "cash"):
            reasons.append(_r("short_not_allowed", 100, "hard", f"short selling not possible in a {account_type} account", hard=True))
        it = (getattr(feed, "meta", {}) or {}).get("instrumentType")
        metrics["instrument_type"] = it
        if it and it not in ("EQUITY", "ETF"):
            reasons.append(_r("instrument_type", 20, "warn", f"instrument type {it}"))

    # ---- guardrails (account)
    g_reasons, g_metrics = G.account_checks(book["account"], lim)
    reasons += [_r(r["code"], r["points"], r["severity"], r["detail"], r.get("hard", False)) for r in g_reasons]

    # ---- tier
    score, decision, hard = D.decide(reasons)
    mult = D.TIER_MULT[decision]
    size = None
    expo = {}
    if decision != "SKIP":
        size = position_size(bank, risk_pct * mult, entry, stop, side, max_leverage=MAX_LEVERAGE[asset_class], quote_to_account=fx)
        # ---- exposure budgets across agents
        expo, cap_amount, cap_notes = _exposure(asset_class, symbol, side, size, book, bank, lim, market, interval)
        if cap_amount is not None and cap_amount < size["risk_amount"]:
            if cap_amount <= bank * 0.001:   # < 0.1% of bankroll left: no room
                reasons.append(_r("risk_budget_exhausted", 100, "hard", "; ".join(cap_notes), hard=True))
                score, decision, hard = D.decide(reasons)
                size = None
            else:
                size = position_size(bank, cap_amount / bank * 100, entry, stop, side, max_leverage=MAX_LEVERAGE[asset_class], quote_to_account=fx)
                size["capped_by"] += cap_notes
                reasons.append(_r("risk_budget_cap", 0, "warn", "; ".join(cap_notes)))
                if decision == "NORMAL":
                    decision = "REDUCED"
    else:
        expo = PF.aggregate(book, bank) if book["positions"] else {}
    if size:
        size.update({"risk_pct_requested": risk_pct_req, "tier_multiplier": mult, "assumed_stop": assumed, "bankroll_assumed": bank_assumed})
        size["capped_by"] = list(dict.fromkeys(size["capped_by"]))
        for k_ in ("risk_pct_target", "side", "stop_distance"):
            size.pop(k_, None)
    guard = {"limits": lim, **g_metrics, "max_leverage_policy": MAX_LEVERAGE[asset_class], "account_type": account_type}
    return _finish(asset_class, symbol, q.venue, side, reasons, warnings, metrics, size, expo, guard, series, feed, conf, now,
                   decision_override=(score, decision, hard))


ACCOUNT_CCY = "USD"


def _quote_to_account(asset_class, symbol, entry, feed, metrics, warnings) -> float:
    """Account currency is USD. USDT perps are treated as USD (USDT/USD basis ignored)."""
    if asset_class != "forex":
        return 1.0
    b, q = parse_pair(symbol)
    if q == ACCOUNT_CCY:
        r = 1.0
    elif b == ACCOUNT_CCY:
        r = 1.0 / entry
    else:
        d, rate = feed.f.latest(q, ACCOUNT_CCY)     # ECB reference rate quote->USD
        if not rate:
            raise SourceError(f"no {q}{ACCOUNT_CCY} rate to convert P&L")
        r = float(rate)
        warnings.append(f"P&L converted {q}->{ACCOUNT_CCY} at ECB reference {rate} ({d})")
    metrics["quote_to_account"] = r
    metrics["account_currency"] = ACCOUNT_CCY
    return r


def V_INTERVAL(iv):
    from ..schema import INTERVALS
    return INTERVALS[iv]


def _exposure(asset_class, symbol, side, size, book, bank, lim, market, interval):
    if not book["positions"]:
        return {}, None, []
    agg = PF.aggregate(book, bank)
    notes, caps = [], []
    room_total = bank * lim["max_total_risk_pct"] / 100 - agg["total_risk"]
    caps.append(room_total)
    if room_total < size["risk_amount"]:
        notes.append(f"total risk budget: {agg['total_risk_pct']}% used of {lim['max_total_risk_pct']}%")
    # correlation on daily closes (90 days)
    cand_daily = None
    try:
        cand_daily = market.feed(asset_class).candles(symbol, "1d", 120).closed()
    except (SourceError, ValueError):
        pass
    cache = {}

    def corr_of(p):
        ac = p.get("asset_class")
        if ac not in ("crypto_perp", "forex", "equity") or cand_daily is None:
            return None
        key = (ac, p.get("symbol"))
        if key not in cache:
            try:
                other = market.feed(ac).candles(p["symbol"], "1d", 120).closed()
                ra, rb = PF.aligned_returns(cand_daily, other)
                cache[key] = PF.correlation(ra[-90:], rb[-90:])
            except (SourceError, ValueError, KeyError):
                cache[key] = None
        return cache[key]

    cr = PF.correlated_risk({"asset_class": asset_class, "side": side}, book["positions"], corr_of)
    room_corr = bank * lim["max_correlated_risk_pct"] / 100 - cr["existing_correlated_risk"]
    caps.append(room_corr)
    if room_corr < size["risk_amount"]:
        notes.append(f"correlated risk budget: {cr['existing_correlated_risk']:.2f} already at risk in positions moving with this one (limit {lim['max_correlated_risk_pct']}%)")
    agg["correlated"] = cr
    agg["room"] = {"total_risk": round(room_total, 2), "correlated_risk": round(room_corr, 2)}
    return agg, max(0.0, min(caps)), notes


def _conf_name(c):
    return ["low", "medium", "high"][max(0, min(2, c))]


def _finish(asset_class, symbol, venue, side, reasons, warnings, metrics, size, expo, guard, series, feed, conf, now,
            decision_override=None):
    score, decision, hard = decision_override or D.decide(reasons)
    max_pct = round(size["risk_pct"], 4) if size else 0.0
    sym = series.symbol if series else symbol
    d = {
        "v": 1, "asset_id": f"{asset_class}:{sym}", "symbol": sym, "decision": decision, "score": int(score),
        "max_size_pct": max_pct, "confidence": _conf_name(conf), "hard_flags": hard,
        "top_reasons": D.top_reasons(reasons), "as_of": D.iso(now), "valid_until": D.iso(now + VALID_FOR_S[asset_class]),
        "model": D.MODEL, "line": D.line(sym, decision, int(score), max_pct, _conf_name(conf), reasons),
        "schema": "aai.risk_decision.v1", "asset_class": asset_class, "venue": venue, "side": side,
        "reasons": reasons, "suggested_size": size, "metrics": metrics, "exposure": expo or {}, "guardrails": guard or {},
        "data": {"sources": [], "attempts": list(getattr(feed, "attempts", [])), "interval": series.interval if series else None,
                 "last_candle_ts": series.closed()[-1][0] if series and series.closed() else None,
                 "candles": len(series.candles) if series else None},
        "warnings": warnings, "source_summary": None, "disclaimer": D.DISCLAIMER,
    }
    d["data"]["sources"] = sorted({a["venue"] for a in d["data"]["attempts"] if a["ok"]})
    errs = D.validate(d)
    if errs:
        raise AssessError("risk_decision failed schema validation: " + "; ".join(errs[:5]))
    return d


def _assess_meme(mint, side, bankroll, risk_pct, book, lim, settings, now, smr_args):
    if side != "long":
        raise AssessError("solana_meme supports long only (no shorting memecoins)")
    s = smr_bridge.score_summary(settings, mint, smr_args)
    reasons = smr_bridge.reasons_from_summary(s)
    warnings = ["delegated to solana-meme-risk (smr); its backtest showed no demonstrated edge (held-out AUC 0.47)",
                "memecoin positions are treated as 100% at risk (no reliable stop)"]
    g_reasons, g_metrics = G.account_checks(book["account"], lim)
    reasons += [D.reason(r["code"], r["points"], r["severity"], r["detail"], r.get("hard", False)) for r in g_reasons]
    decision, score = s["decision"], int(s["score"])
    hard = list(s.get("hard_flags") or [])
    if any(r["hard"] for r in g_reasons):
        decision = "SKIP"; hard += [r["code"] for r in g_reasons if r["hard"]]
    pct = float(s.get("max_size_pct") or 0.0)
    if risk_pct is not None:
        pct = min(pct, clamp_risk_pct(risk_pct)[0])
    if decision == "SKIP":
        pct = 0.0
    bank, bank_assumed = _bankroll(bankroll, book)
    expo = {}
    size = None
    if pct > 0:
        amt = bank * pct / 100
        caps = []
        if book["positions"]:
            expo = PF.aggregate(book, bank)
            room = bank * lim["max_total_risk_pct"] / 100 - expo["total_risk"]
            cr = PF.correlated_risk({"asset_class": "solana_meme", "side": "long"}, book["positions"], lambda p: None)
            room_c = bank * lim["max_correlated_risk_pct"] / 100 - cr["existing_correlated_risk"]
            expo["correlated"] = cr; expo["room"] = {"total_risk": round(room, 2), "correlated_risk": round(room_c, 2)}
            if min(room, room_c) < amt:
                caps.append("risk budget (total/correlated crypto)")
                amt = max(0.0, min(room, room_c))
        if amt <= bank * 0.001:
            decision, pct = "SKIP", 0.0
            reasons.append(D.reason("risk_budget_exhausted", 100, "hard", "no risk budget left for crypto", True)); hard.append("risk_budget_exhausted")
        else:
            pct = round(amt / bank * 100, 4)
            size = {"risk_pct": pct, "risk_pct_requested": risk_pct, "tier_multiplier": None, "risk_amount": round(amt, 2),
                    "qty": None, "notional": round(amt, 2), "leverage": round(amt / bank, 6), "entry": None, "stop": None,
                    "stop_distance_pct": 100.0, "assumed_stop": True, "bankroll": bank, "bankroll_assumed": bank_assumed, "capped_by": caps}
            if caps and decision == "NORMAL":
                decision = "REDUCED"
    d = {"v": 1, "asset_id": s["asset_id"], "symbol": s.get("symbol"), "decision": decision, "score": score,
         "max_size_pct": pct, "confidence": s["confidence"], "hard_flags": hard,
         "top_reasons": D.top_reasons(reasons) if decision != s["decision"] else s["top_reasons"],
         "as_of": s["as_of"], "valid_until": s["valid_until"], "model": f"{D.MODEL}+{s['model']}",
         "line": D.line(s.get("symbol") or mint[:8], decision, score, pct, s["confidence"], reasons),
         "schema": "aai.risk_decision.v1", "asset_class": "solana_meme", "venue": "pump.fun/solana", "side": "long",
         "reasons": reasons, "suggested_size": size, "metrics": {"smr_score": score, "smr_decision": s["decision"]},
         "exposure": expo, "guardrails": {"limits": lim, **g_metrics},
         "data": {"sources": ["smr:python -m risk score --summary"], "attempts": [{"venue": "smr", "what": "score", "ok": True}],
                  "interval": None, "last_candle_ts": None, "candles": None},
         "warnings": warnings, "source_summary": s, "disclaimer": D.DISCLAIMER}
    errs = D.validate(d)
    if errs:
        raise AssessError("risk_decision failed schema validation: " + "; ".join(errs[:5]))
    return d
