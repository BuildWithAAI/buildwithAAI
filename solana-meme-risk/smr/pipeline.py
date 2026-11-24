"""Public entry points.
  score_mint(mint, as_of=None)        -> validated risk_report v1 dict
  score_mint_legacy(mint, as_of=None) -> v0-compatible dict (adapter contract) with the v1 report embedded"""
from __future__ import annotations
from .context import Context, default_context
from .signal_extractor import extract_signals
from .risk_score import score_signals
from . import report


def _run(mint, ctx, as_of, n_buyers, hops, trace_limit, full, progress, apply_market_gates, coin):
    ctx = ctx or default_context()
    sig = extract_signals(ctx, mint, as_of=as_of, n_buyers=n_buyers, hops=hops, trace_limit=trace_limit, progress=progress, coin=coin)
    sig["token_age_s"] = (sig["as_of"] - sig["create_time"]) if sig.get("create_time") else 0
    sc = score_signals(sig, ctx.settings, apply_market_gates)
    doc = report.build(sig, sc, ctx.settings, sources=ctx.source_snapshot(), generated_at=ctx.clock(), full=full)
    return sig, sc, doc


def score_mint(mint, *, ctx: Context | None = None, as_of=None, n_buyers=None, hops=None, trace_limit=None, full=False,
               progress=None, apply_market_gates=None, coin=None):
    return _run(mint, ctx, as_of, n_buyers, hops, trace_limit, full, progress, apply_market_gates, coin)[2]


def score_mint_legacy(mint, *, ctx: Context | None = None, as_of=None, n_buyers=None, hops=None, trace_limit=None, full=False,
                      progress=None, apply_market_gates=None, coin=None):
    from . import legacy
    sig, sc, doc = _run(mint, ctx, as_of, n_buyers, hops, trace_limit, full, progress, apply_market_gates, coin)
    return legacy.build(sig, sc, doc, full=full)
