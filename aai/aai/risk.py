"""Central risk engine. Every idea passes the same pre-trade checks; sizing is derived from stop distance
so that the loss AT THE STOP (incl. modelled slippage + fees) equals the risk budget, never more than 3%.
Gaps through the stop can still lose more in reality; that is reported, not hidden."""
from __future__ import annotations
import math, time
from .config import HARD_MAX_RISK_PER_TRADE, HARD_MIN_RISK_PER_TRADE
from .models import Check, Decision, Idea, SECTORS, NON_TRADING_BUCKETS

FULL_LOSS_SECTORS = {"solana_meme"}       # stop=None means "assume it can go to zero"
RESEARCH_ONLY_SECTORS = {"billy"}         # unvalidated rules: never sized for paper trades yet
PLACEHOLDER_SECTORS = {"forex", "stocks"}


def per_unit_loss(side: str, entry: float, stop: float | None, slip: float, fee: float) -> tuple[float, float]:
    """Return (estimated fill px, loss per unit if stopped out incl. slippage and both-side fees)."""
    if side == "long":
        fill = entry * (1 + slip)
        exit_px = 0.0 if stop is None else stop * (1 - slip)
        return fill, (fill - exit_px) + fee * (fill + exit_px)
    fill = entry * (1 - slip)
    exit_px = stop * (1 + slip)
    return fill, (exit_px - fill) + fee * (fill + exit_px)


def floor_to(x: float, step: float | None) -> float:
    if not step or step <= 0:
        return x
    return math.floor(x / step + 1e-9) * step


class RiskEngine:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.r = cfg["risk"]

    def sector_cap_trade(self, sector: str) -> float:
        v = self.r.get("sector_max_risk_per_trade", {}).get(sector, self.r["max_risk_per_trade"])
        return min(v, self.r["max_risk_per_trade"], HARD_MAX_RISK_PER_TRADE)

    def evaluate(self, idea: Idea, state: dict, signal: dict | None = None, instrument: dict | None = None,
                 now: float | None = None) -> Decision:
        """state: {equity, open_positions:[{sector,symbol,risk_usd}], kill_switch:{on,reason}, mode}"""
        now = now or time.time()
        r = self.r
        checks: list[Check] = []
        add = lambda n, ok, d: checks.append(Check(n, bool(ok), d))
        equity = float(state["equity"])
        slip, fee = r["slippage_bps"] / 1e4, r["fee_bps"] / 1e4

        ks = state.get("kill_switch") or {}
        add("kill_switch_off", not ks.get("on"), "kill switch is ON: " + str(ks.get("reason")) if ks.get("on") else "off")
        add("paper_mode", state.get("mode", "paper") == "paper", f"mode={state.get('mode', 'paper')}")
        add("equity_positive", equity > 0, f"equity={equity:.2f}")
        add("trading_bucket_only", idea.sector not in NON_TRADING_BUCKETS,
            "longterm is a separate bucket: use draft tickets (aai/longterm.py), not the trading path"
            if idea.sector in NON_TRADING_BUCKETS else "trading bucket")
        add("known_sector", idea.sector in SECTORS, f"sector={idea.sector}")
        add("sector_enabled", idea.sector not in PLACEHOLDER_SECTORS,
            "placeholder sector, no validated adapter" if idea.sector in PLACEHOLDER_SECTORS else "enabled")
        add("not_research_only", idea.sector not in RESEARCH_ONLY_SECTORS,
            "rules unvalidated (research only); backtest + sign-off required" if idea.sector in RESEARCH_ONLY_SECTORS else "ok")
        age = now - idea.ts
        add("idea_fresh", 0 <= age <= r["max_idea_age_sec"] + 1, f"age={age:.0f}s max={r['max_idea_age_sec']}s")
        add("valid_side", idea.side in ("long", "short"), f"side={idea.side}")
        entry_ok = idea.entry is not None and idea.entry > 0 and math.isfinite(idea.entry)
        add("valid_entry", entry_ok, f"entry={idea.entry}")

        # stop validation
        if idea.stop is None:
            ok = idea.sector in FULL_LOSS_SECTORS and idea.side == "long"
            add("stop_defined", ok, "no stop: full-loss sizing (notional = risk budget)" if ok else "stop required for this sector")
        else:
            ok = entry_ok and idea.stop > 0 and ((idea.side == "long" and idea.stop < idea.entry) or (idea.side == "short" and idea.stop > idea.entry))
            add("stop_defined", ok, f"stop={idea.stop} {'on correct side' if ok else 'missing / wrong side of entry'}")
            if ok:
                dist = abs(idea.entry - idea.stop) / idea.entry
                add("stop_distance", dist <= r["max_stop_distance_pct"], f"{dist:.2%} (max {r['max_stop_distance_pct']:.0%})")
                if idea.target is not None:
                    tgt_ok = (idea.side == "long" and idea.target > idea.entry) or (idea.side == "short" and idea.target < idea.entry)
                    rr = abs(idea.target - idea.entry) / abs(idea.entry - idea.stop) if tgt_ok else 0.0
                    add("reward_risk", tgt_ok and rr >= r["min_reward_risk"], f"R:R={rr:.2f} (min {r['min_reward_risk']})")

        # sector-specific signal gate
        cap_trade = self.sector_cap_trade(idea.sector)
        if idea.sector == "solana_meme":
            if not signal:
                add("signal_gate", False, "no solana-meme-risk score on record for this mint")
            else:
                rec = signal.get("recommendation")
                sig_age = now - float(signal.get("ts", 0))
                if rec == "SKIP":
                    add("signal_gate", False, f"risk score SKIP (score={signal.get('score')}): " + "; ".join((signal.get("payload") or {}).get("reasons", [])[:3]))
                elif rec not in ("REDUCED", "NORMAL"):
                    add("signal_gate", False, f"unknown recommendation {rec}")
                else:
                    add("signal_gate", True, f"risk score {rec} (score={signal.get('score')})")
                    if rec == "REDUCED":
                        cap_trade = min(cap_trade, HARD_MIN_RISK_PER_TRADE)
                add("signal_fresh", sig_age <= 3600, f"score age {sig_age:.0f}s (max 3600s)")

        # risk fraction: clamp to [1%, cap]; requests above the cap are cut, never honoured
        req = idea.requested_risk if idea.requested_risk is not None else r["default_risk_per_trade"]
        risk_frac = max(min(req, cap_trade), HARD_MIN_RISK_PER_TRADE) if cap_trade >= HARD_MIN_RISK_PER_TRADE else cap_trade
        risk_frac = min(risk_frac, HARD_MAX_RISK_PER_TRADE)
        add("risk_per_trade_bounds", HARD_MIN_RISK_PER_TRADE - 1e-12 <= risk_frac <= HARD_MAX_RISK_PER_TRADE + 1e-12,
            f"requested={req:.2%} -> applied={risk_frac:.2%} (sector cap {cap_trade:.2%}, hard 1-3%)")
        risk_budget = equity * risk_frac

        # portfolio limits
        open_pos = state.get("open_positions", [])
        open_risk = sum(p["risk_usd"] for p in open_pos)
        sector_risk = sum(p["risk_usd"] for p in open_pos if p["sector"] == idea.sector)
        add("max_open_positions", len(open_pos) < r["max_open_positions"], f"{len(open_pos)} open (max {r['max_open_positions']})")
        add("no_duplicate_position", not any(p["symbol"] == idea.symbol for p in open_pos), f"symbol={idea.symbol}")

        # sizing
        qty = notional = 0.0
        fill = None
        if entry_ok and all(c.passed for c in checks if c.name == "stop_defined"):
            fill, ul = per_unit_loss(idea.side, idea.entry, idea.stop, slip, fee)
            mult = float((instrument or {}).get("contract_value") or 1.0)    # units per contract
            lot = (instrument or {}).get("lot_size")
            min_size = (instrument or {}).get("min_size")
            contracts = floor_to(risk_budget / (ul * mult), lot)
            # leverage cap (only ever reduces size)
            max_contracts_lev = floor_to(equity * r["max_leverage"] / (fill * mult), lot)
            if contracts > max_contracts_lev:
                add("leverage_cap", True, f"size cut by leverage cap {r['max_leverage']}x")
                contracts = max_contracts_lev
            qty = contracts
            notional = contracts * mult * fill
            actual_risk = contracts * mult * ul
            add("size_positive", qty > 0 and (not min_size or qty >= min_size - 1e-12),
                f"qty={qty:g} (contract_value={mult:g}, lot={lot}, min={min_size})")
            risk_budget = actual_risk
        else:
            add("size_positive", False, "cannot size without valid entry/stop")

        add("total_open_risk", (open_risk + risk_budget) <= equity * r["max_total_open_risk"] + 1e-9,
            f"open {open_risk:.2f} + new {risk_budget:.2f} vs cap {equity * r['max_total_open_risk']:.2f} ({r['max_total_open_risk']:.0%})")
        scap = r["sector_caps"].get(idea.sector, 0.0)
        add("sector_cap", (sector_risk + risk_budget) <= equity * scap + 1e-9,
            f"{idea.sector} open {sector_risk:.2f} + new {risk_budget:.2f} vs cap {equity * scap:.2f} ({scap:.0%})")

        # final invariant: never more than 3% of equity at the stop
        eff = risk_budget / equity if equity > 0 else 1.0
        add("hard_3pct_invariant", eff <= HARD_MAX_RISK_PER_TRADE + 1e-9, f"effective risk {eff:.3%} of equity")

        approved = all(c.passed for c in checks)
        return Decision(idea.id, approved, checks, risk_frac=eff if approved else 0.0, risk_usd=round(risk_budget, 6) if approved else 0.0,
                        qty=qty if approved else 0.0, notional=round(notional, 6) if approved else 0.0, fill_px_est=fill,
                        inputs={"idea": idea.to_dict(), "equity": equity, "open_risk": open_risk, "sector_risk": sector_risk,
                                "signal": {k: (signal or {}).get(k) for k in ("id", "recommendation", "score", "ts")} if signal else None,
                                "instrument": {k: (instrument or {}).get(k) for k in ("contract_value", "lot_size", "min_size")} if instrument else None,
                                "limits": {k: r[k] for k in ("max_risk_per_trade", "max_total_open_risk", "max_open_positions")}})
