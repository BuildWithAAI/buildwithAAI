"""Bounded, exact-integer long-only spot lab. No network, signer or order API.

Recorded decisions are operator supplied; timestamp checks cannot attest that an
external agent never saw the future. The lab is not an AMM or broker fill model.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from itertools import pairwise

from .contracts import _name, _time
from .education import Curriculum, PracticeAttempt, assess, digest, require

SUPPORTED_TRACKS = ("solana", "ethereum", "bnb_smart_chain", "sui")
PPM = 1_000_000


def integer(value, minimum=0, maximum=10**18):
    require(type(value) is int and minimum <= value <= maximum, "INVALID_PAPER_INTEGER")


def ceil_div(numerator, denominator):
    return (numerator + denominator - 1) // denominator


@dataclass(frozen=True)
class PaperMarket:
    track_id: str
    network: str
    venue: str
    base_asset_id: str
    quote_asset_id: str
    base_scale: int
    quote_unit: str
    classification: str

    def __post_init__(self):
        require(self.track_id in SUPPORTED_TRACKS, "PAPER_TRACK_NOT_IMPLEMENTED")
        for value in (self.network, self.venue, self.quote_unit):
            _name(value)
        for value in (self.base_asset_id, self.quote_asset_id):
            require(type(value) is str and 1 <= len(value) <= 256 and value.isascii()
                    and not any(ord(char) <= 32 or ord(char) >= 127 for char in value), "INVALID_PAPER_ASSET_ID")
        require(self.base_asset_id != self.quote_asset_id, "IDENTICAL_PAPER_ASSETS")
        require(type(self.base_scale) is int and self.base_scale in tuple(10**n for n in range(19)), "INVALID_BASE_SCALE")
        require(self.classification in ("SYNTHETIC_FIXTURE", "RECORDED_UNVERIFIED"), "INVALID_TAPE_CLASSIFICATION")

    def sha256(self):
        return digest("AAI_PAPER_INSTRUMENT_V1", asdict(self))


@dataclass(frozen=True)
class Quote:
    quote_id: str
    market_sha256: str
    event_ms: int
    available_ms: int
    bid: int
    ask: int
    bid_size: int
    ask_size: int
    market_open: bool

    def __post_init__(self):
        from .contracts import _pin

        _name(self.quote_id)
        _pin(self.market_sha256)
        _time(self.event_ms)
        _time(self.available_ms)
        require(self.event_ms <= self.available_ms, "QUOTE_AVAILABLE_BEFORE_EVENT")
        integer(self.bid, 1)
        integer(self.ask, self.bid)
        integer(self.bid_size)
        integer(self.ask_size)
        require(type(self.market_open) is bool, "INVALID_MARKET_STATE")


@dataclass(frozen=True)
class PaperDecision:
    decision_id: str
    at_ms: int
    side: str
    quantity: int
    reference_quote_id: str | None

    def __post_init__(self):
        _name(self.decision_id)
        _time(self.at_ms)
        require(self.side in ("BUY", "SELL", "HOLD"), "INVALID_PAPER_SIDE")
        integer(self.quantity)
        require((self.side == "HOLD" and self.quantity == 0)
                or (self.side in ("BUY", "SELL") and self.quantity > 0), "INVALID_PAPER_QUANTITY")
        if self.reference_quote_id is not None:
            _name(self.reference_quote_id)


@dataclass(frozen=True)
class PaperPolicy:
    initial_cash: int
    max_order_quote: int
    max_position_quote: int
    max_drawdown_ppm: int
    max_spread_ppm: int
    max_slippage_ppm: int
    fee_ppm: int
    gas_quote: int
    latency_ms: int
    max_fill_wait_ms: int
    max_quote_age_ms: int
    kill_switch: bool

    def __post_init__(self):
        for value in (self.initial_cash, self.max_order_quote, self.max_position_quote):
            integer(value, 1)
        for value in (self.max_drawdown_ppm, self.max_spread_ppm, self.max_slippage_ppm, self.fee_ppm):
            integer(value, 0, PPM)
        integer(self.gas_quote)
        for value in (self.latency_ms, self.max_fill_wait_ms, self.max_quote_age_ms):
            integer(value, 1, 86_400_000)
        require(self.latency_ms <= self.max_fill_wait_ms and type(self.kill_switch) is bool, "INVALID_PAPER_POLICY")

    def sha256(self):
        return digest("AAI_PAPER_POLICY_V1", asdict(self))


def replay_paper(curriculum: Curriculum, attempt: PracticeAttempt, market: PaperMarket,
                 policy: PaperPolicy, quotes: tuple[Quote, ...], decisions: tuple[PaperDecision, ...]):
    require(type(curriculum) is Curriculum and type(attempt) is PracticeAttempt
            and type(market) is PaperMarket and type(policy) is PaperPolicy, "INVALID_PAPER_REQUEST")
    require(attempt.track_id == market.track_id, "PAPER_EDUCATION_TRACK_MISMATCH")
    require(type(quotes) is tuple and 2 <= len(quotes) <= 5000
            and all(type(quote) is Quote for quote in quotes), "INVALID_QUOTE_TAPE")
    require(type(decisions) is tuple and 1 <= len(decisions) <= 1000
            and all(type(decision) is PaperDecision for decision in decisions), "INVALID_DECISION_TAPE")
    require(len({quote.quote_id for quote in quotes}) == len(quotes)
            and len({decision.decision_id for decision in decisions}) == len(decisions), "DUPLICATE_PAPER_EVENT")
    require(all(quote.market_sha256 == market.sha256() for quote in quotes), "PAPER_MARKET_MISMATCH")
    require(all(a.available_ms < b.available_ms and a.event_ms <= b.event_ms for a, b in pairwise(quotes)),
            "NONMONOTONIC_QUOTE_TAPE")
    require(all(a.at_ms < b.at_ms for a, b in pairwise(decisions)), "NONMONOTONIC_DECISIONS")
    require(attempt.completed_ms <= decisions[0].at_ms and decisions[-1].at_ms <= quotes[-1].available_ms,
            "PAPER_WINDOW_MISMATCH")
    cash, units, fees, gas, committed_until = policy.initial_cash, 0, 0, 0, 0
    fills, events = [], []
    previous = "0" * 64

    def marks(until):
        current_cash, current_units, fill_index = policy.initial_cash, 0, 0
        peak, drawdown = policy.initial_cash, 0
        for quote in quotes:
            if quote.available_ms > until:
                break
            while fill_index < len(fills) and fills[fill_index]["at_ms"] <= quote.available_ms:
                current_cash, current_units = fills[fill_index]["cash_after"], fills[fill_index]["units_after"]
                fill_index += 1
            equity = current_cash + current_units * quote.bid // market.base_scale
            peak = max(peak, equity)
            drawdown = max(drawdown, ceil_div((peak - equity) * PPM, peak))
        return drawdown

    for decision in decisions:
        require(decision.at_ms >= committed_until, "DECISION_PRECEDES_PRIOR_FILL")
        school = assess(curriculum, attempt, decision.at_ms)
        require(school["paper_lab_allowed"], "PAPER_EDUCATION_REQUIRED")
        visible = [quote for quote in quotes if quote.available_ms <= decision.at_ms]
        reference = visible[-1] if visible else None
        reason, filled = None, None
        if decision.side == "HOLD":
            reason = "HOLD"
        elif policy.kill_switch:
            reason = "KILL_SWITCH"
        elif reference is None:
            reason = "NO_VISIBLE_QUOTE"
        elif decision.reference_quote_id != reference.quote_id:
            reason = "REFERENCE_NOT_LATEST_VISIBLE"
        elif decision.at_ms - reference.event_ms > policy.max_quote_age_ms:
            reason = "STALE_REFERENCE"
        elif not reference.market_open:
            reason = "MARKET_CLOSED"
        elif (reference.ask - reference.bid) * PPM > reference.ask * policy.max_spread_ppm:
            reason = "SPREAD_LIMIT"
        elif decision.side == "BUY" and marks(decision.at_ms) >= policy.max_drawdown_ppm:
            reason = "DRAWDOWN_HALT"
        elif decision.side == "SELL" and decision.quantity > units:
            reason = "INSUFFICIENT_POSITION"
        else:
            candidates = [quote for quote in quotes
                          if quote.event_ms >= decision.at_ms + policy.latency_ms
                          and quote.available_ms > decision.at_ms]
            # The first eligible later quote is the only candidate, never the
            # best future quote. This lab has no resting orders or partial fills.
            fill = candidates[0] if candidates else None
            if fill is None or fill.available_ms - decision.at_ms > policy.max_fill_wait_ms:
                reason = "NO_TIMELY_FILL_QUOTE"
            elif fill.available_ms - fill.event_ms > policy.max_quote_age_ms:
                reason = "STALE_FILL_QUOTE"
            elif not fill.market_open:
                reason = "MARKET_CLOSED_AT_FILL"
            elif (fill.ask - fill.bid) * PPM > fill.ask * policy.max_spread_ppm:
                reason = "SPREAD_LIMIT_AT_FILL"
            elif decision.quantity > (fill.ask_size if decision.side == "BUY" else fill.bid_size):
                reason = "INSUFFICIENT_DEPTH"
            else:
                buy = decision.side == "BUY"
                price = fill.ask if buy else fill.bid
                reference_price = reference.ask if buy else reference.bid
                adverse = max(0, price - reference_price if buy else reference_price - price)
                notional = (ceil_div(decision.quantity * price, market.base_scale) if buy
                            else decision.quantity * price // market.base_scale)
                fee = ceil_div(notional * policy.fee_ppm, PPM)
                if adverse * PPM > reference_price * policy.max_slippage_ppm:
                    reason = "SLIPPAGE_LIMIT"
                elif notional > policy.max_order_quote:
                    reason = "ORDER_LIMIT"
                elif buy and ceil_div((units + decision.quantity) * price, market.base_scale) > policy.max_position_quote:
                    reason = "POSITION_LIMIT"
                elif buy and notional + fee + policy.gas_quote > cash:
                    reason = "INSUFFICIENT_CASH_WITH_COSTS"
                elif not buy and cash + notional < fee + policy.gas_quote:
                    reason = "INSUFFICIENT_CASH_FOR_EXIT_COSTS"
                else:
                    cash += (-notional if buy else notional) - fee - policy.gas_quote
                    units += decision.quantity if buy else -decision.quantity
                    fees += fee
                    gas += policy.gas_quote
                    committed_until = fill.available_ms
                    reason = "PAPER_FILLED"
                    filled = {"quote_id": fill.quote_id, "at_ms": fill.available_ms, "side": decision.side,
                              "quantity": decision.quantity, "price": price, "notional": notional,
                              "fee": fee, "gas_quote": policy.gas_quote, "cash_after": cash, "units_after": units}
                    fills.append(filled)
        event = {"decision": asdict(decision), "reason": reason, "fill": filled,
                 "cash_after": cash, "units_after": units, "previous_sha256": previous}
        previous = digest("AAI_PAPER_LAB_EVENT_V1", event)
        events.append({**event, "event_sha256": previous})
    last = quotes[-1]
    marked_value = units * last.bid // market.base_scale
    # Separately disclose a hypothetical full exit at the displayed final bid.
    # There is no depth/fill guarantee for this diagnostic valuation.
    exit_cost = ceil_div(marked_value * policy.fee_ppm, PPM) + policy.gas_quote if units else 0
    record = {"schema_version": 1, "classification": market.classification, "market": asdict(market),
              "market_sha256": market.sha256(), "policy": asdict(policy), "policy_sha256": policy.sha256(),
              "learner": asdict(attempt.learner), "attempt_sha256": attempt.sha256(),
              "curriculum_sha256": curriculum.sha256(),
              "tape_sha256": digest("AAI_PAPER_TAPE_V1", [asdict(quote) for quote in quotes]),
              "events": events, "event_head_sha256": previous, "fills": len(fills),
              "ending_cash": cash, "ending_base_units": units, "paid_fees": fees, "paid_gas_quote": gas,
              "marked_equity": cash + marked_value, "net_marked_pnl": cash + marked_value - policy.initial_cash,
              "hypothetical_exit_equity": cash + marked_value - exit_cost,
              "max_marked_drawdown_ppm": marks(last.available_ms),
              "benchmark": "INITIAL_CASH_NO_TRADES", "benchmark_equity": policy.initial_cash,
              "decision_provenance": "OPERATOR_SUPPLIED_NOT_INDEPENDENTLY_ATTESTED",
              "statistical_edge": "NOT_ESTABLISHED", "action": "NO_EXECUTION", "live_execution_allowed": False}
    return {**record, "record_sha256": digest("AAI_PAPER_LAB_RECORD_V1", record)}
