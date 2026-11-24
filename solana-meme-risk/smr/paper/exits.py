"""Rung-based exit policies for the momentum book and its shadow controls (SIMULATION ONLY; pure functions).

Policies (Zoorped 2026-11-03):
  clip5  (momentum book, alerted)  sell 20% of the ORIGINAL position at 2x, 3x, 4x, 6x and 10x of entry.
                                   Stop before the first clip: -50% of entry. After it: max(entry, 0.60 x highest mark
                                   since entry). 48 h max hold, then the rest is sold at the mark.
  ladder (control E, no alerts)    50% at 2x, 25% at 4x, the last 25% rides a trailing stop. Trail 20% below the peak if
                                   the coin graduated to PumpSwap within the minute it launched, else 40%. Stop -50%
                                   before the first clip, max(entry, trail) after. 48 h max hold.
  x1     (control, no alerts)      50% at 2x, 50% at 3x. Stop -50% before 2x, breakeven (entry) after. 48 h max hold.

Fill rules (marks are ~15 min apart, intra-interval highs/lows are not seen):
  * A rung fills when a mark is at or above it. Conservative fill: min(mark, rung) = the rung price (a resting limit;
    no credit for the overshoot). A mark past several rungs fills every one of them at its own rung price.
  * A stop fills at the MARK (gap-through: a mark under the stop sells at the mark, not at the stop level).
  * Max hold sells the remainder at the mark.
Every fill records the trigger price (rung or stop level) and the mark used, so slippage can be measured."""
from __future__ import annotations
from dataclasses import dataclass, field

FULL = 1.0 - 1e-9


@dataclass(frozen=True)
class Policy:
    name: str
    rungs: tuple            # ((multiple of entry, fraction of ORIGINAL tokens), ...) ascending
    pre_stop: float = -0.50  # before the first clip: stop at entry x (1 + pre_stop)
    keep: float | None = None   # after the first clip: stop = max(entry, keep x peak); None = breakeven only
    keep_fast: float | None = None   # ladder: keep used when the coin graduated at launch
    max_hold_s: int = 48 * 3600
    alerts: bool = False

    def describe(self, grad=None):
        rr = ", ".join(f"{f:.0%} at {m:g}x" for m, f in self.rungs)
        left = 1 - sum(f for _, f in self.rungs)
        k = self.keep_for(grad)
        after = "breakeven (entry)" if k is None else f"max(entry, {k:.0%} of the highest mark since entry)"
        if self.keep_fast is not None and grad is None:
            after += f" ({self.keep_fast:.0%} if it graduated to PumpSwap within its launch minute)"
        return (f"{self.name}: {rr}" + (f", last {left:.0%} rides" if left > 1e-9 else "")
                + f"; stop {self.pre_stop:+.0%} before the first clip, then {after}; max hold {self.max_hold_s / 3600:g}h")

    def keep_for(self, grad):
        return self.keep_fast if (grad == 1 and self.keep_fast is not None) else self.keep


POLICIES = {
    "clip5": Policy("clip5", ((2.0, 0.2), (3.0, 0.2), (4.0, 0.2), (6.0, 0.2), (10.0, 0.2)), keep=0.60, alerts=True),
    "ladder": Policy("ladder", ((2.0, 0.5), (4.0, 0.25)), keep=0.60, keep_fast=0.80),
    "x1": Policy("x1", ((2.0, 0.5), (3.0, 0.5)), keep=None),
}


def get(name):
    return POLICIES.get(name)


def stop_level(pol: Policy, entry, clips_done, peak, grad=None):
    """Current stop price for the remaining tokens."""
    if not clips_done:
        return entry * (1 + pol.pre_stop)
    k = pol.keep_for(grad)
    return entry if k is None else max(entry, k * (peak or entry))


def stop_rule_text(pol: Policy, clips_done, grad=None):
    if not clips_done:
        return f"{pol.pre_stop:+.0%} of entry (before the first clip)"
    k = pol.keep_for(grad)
    return "breakeven (entry price)" if k is None else f"max(entry, {k:.0%} x highest mark since entry)"


def evaluate(pol: Policy, pos, price, now):
    """-> list of actions for one mark (pure). pos needs entry_price, entry_at, clips_done, peak_price, grad_at_launch.
    Order: stop (on the stop level before this mark's clips), max hold, then rungs. A rung can only fill on a new high,
    so it never conflicts with the stop. Actions:
      ("stop", reason, trigger_price, fill_price)       close the rest at the mark
      ("max_hold", reason, None, fill_price)           close the rest at the mark
      ("clip", n, multiple, frac_of_original, trigger_price, fill_price)   n is 1-based"""
    if price is None:
        return []
    e = pos["entry_price"]
    done = int(pos.get("clips_done") or 0)
    peak = max(pos.get("peak_price") or e, e)
    grad = pos.get("grad_at_launch")
    sl = stop_level(pol, e, done, peak, grad)
    if price <= sl:
        why = f"{pol.name}_stop_loss" if not done else (f"{pol.name}_breakeven_stop" if pol.keep_for(grad) is None or sl <= e + 1e-18
                                                         else f"{pol.name}_trailing_stop")
        return [("stop", why, sl, price)]
    if now - pos["entry_at"] >= pol.max_hold_s:
        return [("max_hold", f"{pol.name}_max_hold_{int(pol.max_hold_s // 3600)}h", None, price)]
    out = []
    for i, (m, f) in enumerate(pol.rungs[done:], start=done + 1):
        tgt = e * m
        if price >= tgt:
            out.append(("clip", i, m, f, tgt, min(price, tgt)))
        else:
            break
    return out


def sold_frac(pol: Policy, clips_done):
    return sum(f for _, f in pol.rungs[:int(clips_done or 0)])


def next_rung(pol: Policy, clips_done, entry):
    d = int(clips_done or 0)
    if d >= len(pol.rungs):
        return None
    m, f = pol.rungs[d]
    return {"multiple": m, "price_usd": entry * m, "share_of_original_pct": round(f * 100, 1)}
