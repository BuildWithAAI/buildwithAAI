"""Entry-time market gates for paper entries.

The as-of score (create + 300 s) cannot see the market at entry, and `risk score` applies its market gates only in
live mode. Here the live scorer's own `market_gates` (smr.risk_score) is applied to the CURRENT market data at entry,
and the paper decision is the stricter of the as-of decision and the gates:
  liquidity < min_liq_usd_any ($2k)       -> SKIP
  liquidity < min_liq_usd_normal ($10k)   -> at most REDUCED
  holders  < min_holders_normal (75)      -> at most REDUCED
plus paper-only conservative rules:
  holder count unknown                    -> at most REDUCED (live mode would read current holders via getProgramAccounts,
                                             which free publicnode refuses; see holder_source)
  FDV < MIN_FDV_USD ($1k)                 -> SKIP (the bonding curve was drained below its launch price: dead/dumped)
  liq/mcap < LIQ_MCAP_REDUCED (0.3)       -> at most REDUCED (measured 2026-11-06: graduation floor pool n=222,
                                             flagged bad_rate 0.878 vs passed 0.735; paper floor n=24 directional)

Market-cap units (verified on-chain 2026-11-03, see docs/paper_trading.md): DexScreener `marketCap`/`fdv` for pump.fun
tokens = priceUsd x 1B. Mayhem-mode launches mint 2B, but 1B sits with pump.fun's Mayhem agent and is burned when Mayhem
ends, so the market cap is priceUsd x (on-chain supply - agent balance) (engine.circulating_supply), ~1B for Mayhem."""
from __future__ import annotations
from .. import config as C

ORDER = {"NORMAL": 0, "REDUCED": 1, "SKIP": 2}
MIN_FDV_USD = 1_000.0
# Thin liquidity vs market cap at entry (Next F1, shipped 2026-11-06). Below MIN_LIQ_TO_MCAP (0.02) the quote is
# rejected as pending by quote_sanity; between 0.02 and this floor the coin may enter but only at REDUCED size.
LIQ_MCAP_REDUCED = 0.3
# pump.fun curve starts at 30 virtual SOL / 1.073B virtual tokens
PUMP_LAUNCH_PRICE_SOL = 30.0 / ((C.PUMP_INITIAL_REAL_TOKEN_RAW + C.PUMP_VIRTUAL_TOKEN_OFFSET_RAW) / 1e6)


# Quote sanity (s49): a real pool holds a meaningful share of the market cap in liquidity. A quote whose liquidity is
# under 2% of its market cap is almost always a mispriced side pool (2QUUWXGM: a non-canonical PumpSwap pool quoted
# $343M mcap on $1.5M "liquidity" while the coin was still on its bonding curve at ~$38k). Entry stays pending.
MIN_LIQ_TO_MCAP = 0.02


def quote_sanity(liquidity_usd, mcap_usd):
    """-> None if the quote looks usable, else a reason to keep the entry pending (no position is opened)."""
    if liquidity_usd and mcap_usd and liquidity_usd > 0 and mcap_usd > 0 and liquidity_usd / mcap_usd < MIN_LIQ_TO_MCAP:
        return (f"implausible quote: liquidity ${liquidity_usd:,.0f} is {liquidity_usd / mcap_usd * 100:.2f}% of "
                f"market cap ${mcap_usd:,.0f} (< {MIN_LIQ_TO_MCAP * 100:.0f}%)")
    return None


def stricter(a, b):
    return a if ORDER.get(a, 2) >= ORDER.get(b, 2) else b


def entry_gates(liquidity_usd, holders, fdv_usd, thresholds=None, holder_source=None):
    from ..risk_score import market_gates
    T = thresholds or C.Thresholds()
    g = market_gates({"liquidity": {"best_liquidity_usd": liquidity_usd}, "holders": {"holder_count": holders}}, T)
    cap = "SKIP" if g["skip"] else "REDUCED" if g["reduce"] else "NORMAL"
    reasons = [f"market gate: {n}" for n in g["notes"] if n != "liquidity unknown"]
    if liquidity_usd is None:
        cap = stricter(cap, "REDUCED"); reasons.append("liquidity unknown (conservative)")
    if holders is None:
        cap = stricter(cap, "REDUCED"); reasons.append("holder count unknown (conservative)")
    if fdv_usd is not None and fdv_usd < MIN_FDV_USD:
        cap = "SKIP"; reasons.append(f"FDV ${fdv_usd:,.0f} < ${MIN_FDV_USD:,.0f}: curve drained below launch price (dead/dumped)")
    if (liquidity_usd is not None and fdv_usd is not None and fdv_usd > 0
            and liquidity_usd / fdv_usd < LIQ_MCAP_REDUCED):
        ratio = liquidity_usd / fdv_usd
        cap = stricter(cap, "REDUCED")
        reasons.append(f"liq/mcap {ratio:.3f} < {LIQ_MCAP_REDUCED}: thin liquidity vs market cap (at most REDUCED)")
    return {"cap": cap, "reasons": reasons, "liquidity_usd": liquidity_usd, "holders": holders, "holder_source": holder_source,
            "fdv_usd": fdv_usd, "thresholds": {"min_liq_usd_any": T.min_liq_usd_any, "min_liq_usd_normal": T.min_liq_usd_normal,
                                               "min_holders_normal": T.min_holders_normal, "min_fdv_usd": MIN_FDV_USD,
                                               "liq_mcap_reduced": LIQ_MCAP_REDUCED}}


def mayhem_reasons(mayhem, source=None):
    """Gate-output note for the Mayhem entry gate (strategy + momentum books only; the benchmark books still buy).
    mayhem: 1/True Mayhem, 0/False not Mayhem, None unknown (treated as Mayhem for entry)."""
    if mayhem in (1, True):
        return [f"mayhem_mode: pump.fun Mayhem coin ({source or 'detected'}); strategy/momentum books do not enter"]
    if mayhem is None:
        return ["mayhem_mode unknown: Mayhem status could not be read; strategy/momentum books do not enter (conservative)"]
    return []


def price_vs_launch(quote):
    """Current pump.fun curve price relative to the launch price (1.0 = untouched), from the SOL-native price."""
    if quote is None or not quote.price_native or (quote.quote_symbol or "").upper() not in ("SOL", "WSOL"):
        return None
    return round(quote.price_native / PUMP_LAUNCH_PRICE_SOL, 4)
