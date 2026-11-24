"""Compatibility shim (v0 flat module name). Implementation lives in smr.risk_score; import from there in new code."""
from smr.risk_score import *  # noqa: F401,F403
from smr.pipeline import score_mint as score_mint_v1, score_mint_legacy  # noqa: F401


def score_mint(mint, n_buyers=None, hops=None, trace_limit=None, full=False, verbose=False, **kw):
    """v0 signature; returns the v0-compatible dict (with risk_report_v1 embedded)."""
    import sys
    prog = (lambda m: print(f"[risk] {m}", file=sys.stderr)) if verbose else None
    return score_mint_legacy(mint, n_buyers=n_buyers, hops=hops, trace_limit=trace_limit, full=full, progress=prog, **kw)


def main(argv=None):
    """v0: python risk_score.py <MINT> [...]  ==  python -m risk score <MINT> [...]"""
    import sys
    from smr.cli import main as cli
    cli(["score"] + list(sys.argv[1:] if argv is None else argv))


if __name__ == "__main__":
    main()
