"""Conservative OHLC scenarios, not observed or executable fills."""

from bisect import bisect_left
from collections import Counter
from dataclasses import dataclass
from decimal import ROUND_DOWN

from .data import HOUR, D, decimal_text, digest, integer, require
from .detector import Signal, contiguous, prior_atr, trend_context

VARIANTS = ("A", "B", "C", "NO_TRADE", "TREND_ONLY")
UNIT_STEP = D("0.00000001")  # Explicit synthetic quantity resolution, not venue precision.


@dataclass(frozen=True)
class Plan:
    signal_id: str
    index: int
    available_ms: int
    stop: object
    atr: object


def plans_for(dataset, config, signals, variant):
    require(variant in VARIANTS, "UNKNOWN_VARIANT")
    if variant == "NO_TRADE":
        return [], {}
    bars = dataset.bars
    opens = [b.open_ms for b in bars]
    availability = [b.available_ms for b in bars]
    skips = Counter()
    candidates = signals
    if variant == "TREND_ONLY":
        candidates = []
        # Frozen benchmark: one decision at every UTC daily candle close.
        for i, b in enumerate(bars):
            if b.close_ms % (24 * HOUR) != 0:
                continue
            atr = prior_atr(bars, i, b.open_ms)
            context = trend_context(bars, b.available_ms, availability)
            if atr is None or context is None or not context["upward"]:
                continue
            identity = digest({"baseline": "DAILY_UPWARD_4H_SMA50", "market": dataset.market,
                               "open_ms": b.open_ms, "available_ms": b.available_ms})
            candidates.append(Signal(identity, i, "BULLISH", i, b.c, b.available_ms,
                                     b.available_ms, atr, b.c - atr, b.h))
    plans = []
    for s in candidates:
        if s.direction != "BULLISH":
            skips["SPOT_SHORT_UNSUPPORTED"] += 1
            continue
        if variant == "B":
            context = trend_context(bars, s.available_ms, availability)
            if context is None:
                skips["CONTEXT_UNAVAILABLE"] += 1
                continue
            if not context["upward"]:
                skips["TREND_NOT_ALIGNED"] += 1
                continue
        decision_index, available = s.index, s.available_ms
        if variant == "C":
            confirmed = False
            for u in range(s.index + 1, min(len(bars), s.index + 4)):
                window = bars[s.index:u + 1]
                if not contiguous(window):
                    skips["CONFIRMATION_GAP"] += 1
                    break
                if bars[u].low <= s.stop:
                    skips["INVALIDATED_BEFORE_CONFIRMATION"] += 1
                    break
                if bars[u].c > s.confirmation:
                    decision_index, available = u, max(s.available_ms, bars[u].available_ms)
                    confirmed = True
                    break
            if not confirmed:
                skips["NO_TIMELY_CONFIRMATION"] += 1
                continue
        due = max(decision_index + 1, bisect_left(opens, available + config.latency_ms))
        if due >= len(bars):
            skips["NO_LATER_OPEN"] += 1
            continue
        if bars[due].open_ms - (available + config.latency_ms) >= HOUR:
            skips["ENTRY_COVERAGE_GAP"] += 1
            continue
        prior = bars[s.index + 1:due]
        if not contiguous(bars[s.index:due + 1]):
            skips["PENDING_COVERAGE_GAP"] += 1
            continue
        if any(b.low <= s.stop and b.available_ms <= bars[due].open_ms for b in prior):
            skips["KNOWN_INVALIDATION_BEFORE_ENTRY"] += 1
            continue
        if s.stop <= 0 or bars[due].o <= s.stop:
            skips["GAP_BEYOND_STOP"] += 1
            continue
        plans.append(Plan(s.id, due, available, s.stop, s.atr))
    return sorted(plans, key=lambda p: (p.index, p.available_ms, p.signal_id)), dict(skips)


def budget_scenario(realized_net, cash, initial_cash, rate_bps, unresolved=False):
    """An unspent hypothetical budget; never a purchase or burn."""
    require(all(isinstance(v, D) and v.is_finite() for v in
                [realized_net, cash, initial_cash]) and cash >= 0 and initial_cash > 0
            and type(unresolved) is bool, "INVALID_BUDGET_INPUT")
    if rate_bps is not None:
        integer(rate_bps, 0, 10_000)
    recoverable = max(D(0), realized_net)
    cash_surplus = max(D(0), cash - initial_cash)
    eligible = D(0) if unresolved else min(recoverable, cash_surplus)
    reserve = D(0) if rate_bps is None else eligible * D(rate_bps) / D(10_000)
    return {"policy_status": "UNSELECTED" if rate_bps is None else "SIMULATION_PROPOSAL_ONLY",
            "classification": "SYNTHETIC_UNSPENT_BUDGET",
            "eligibility_status": "WITHHELD_UNRESOLVED_DATA_OR_POSITION" if unresolved
            else "SIMULATED_SURPLUS_ONLY",
            "basis": "CUMULATIVE_REALIZED_NET_AFTER_LOSS_RECOVERY_AND_FREE_CASH",
            "positive_realized_net": decimal_text(recoverable),
            "free_cash_surplus": decimal_text(cash_surplus),
            "eligible_quote_units": decimal_text(eligible),
            "scenario_allocation_bps": rate_bps,
            "buy_burn_budget_quote_units": decimal_text(reserve),
            "unallocated_quote_units": decimal_text(eligible - reserve),
            "funds_transferred": "0", "tokens_purchased": "0", "tokens_burned": "0",
            "aai_mint": None, "burn_transaction": None,
            "price_floor": "NOT_ESTABLISHED"}


def simulate(dataset, config, signals, variant, *, entry_window=None, prepared_plans=None):
    if prepared_plans is None:
        plans, skips = plans_for(dataset, config, signals, variant)
    else:
        require(variant == "RANDOM_TIME", "INVALID_PREPARED_VARIANT")
        plans, skips = list(prepared_plans), {}
        for plan in plans:
            require(isinstance(plan, Plan) and type(plan.index) is int and
                    0 <= plan.index < len(dataset.bars) and
                    plan.available_ms <= dataset.bars[plan.index].open_ms and
                    isinstance(plan.stop, D) and plan.stop.is_finite() and plan.stop > 0,
                    "INVALID_PREPARED_PLAN")
            integer(plan.available_ms, 0, 253_402_300_799_000)
    if entry_window is not None:
        start, end = entry_window
        require(type(start) is int and type(end) is int and start < end, "INVALID_ENTRY_WINDOW")
        plans = [p for p in plans if start <= dataset.bars[p.index].open_ms < end]
    skips = Counter(skips)
    by_index = {}
    for plan in plans:
        by_index.setdefault(plan.index, []).append(plan)
    cash = config.initial_cash
    fee = D(config.fee_bps) / D(10_000)
    slip = D(config.slippage_bps) / D(10_000)
    position = None
    trades, equity = [], []
    completed_net = D(0)
    total_costs = D(0)
    max_drawdown = D(0)
    peak = config.initial_cash
    previous_nav = config.initial_cash
    current_day, day_nav, halted = None, config.initial_cash, False
    gap_censored = False
    for i, bar in enumerate(dataset.bars):
        day = bar.open_ms // (24 * HOUR)
        if day != current_day:
            current_day, day_nav, halted = day, previous_nav, False
        # Unknown stops/targets inside a missing interval must not create a winner.
        if i and bar.open_ms != dataset.bars[i - 1].close_ms and position is not None:
            gap_censored = True
        for plan in by_index.get(i, []):
            if i and dataset.bars[i - 1].available_ms > bar.open_ms:
                skips["PRIOR_ACCOUNTING_UNAVAILABLE"] += 1
                continue
            if gap_censored:
                skips["OPEN_POSITION_GAP_UNRESOLVED"] += 1
                continue
            if position is not None:
                skips["POSITION_ALREADY_OPEN"] += 1
                continue
            if halted:
                skips["DAILY_CIRCUIT_BREAKER"] += 1
                continue
            entry = bar.o * (D(1) + slip)
            stop_exit = plan.stop * (D(1) - slip)
            unit_loss = entry - stop_exit + fee * (entry + stop_exit)
            budget = cash * D(config.risk_bps) / D(10_000)
            if budget <= 2 * config.fixed_cost or unit_loss <= 0:
                skips["RISK_TOO_SMALL_FOR_COSTS"] += 1
                continue
            risk_quantity = (budget - 2 * config.fixed_cost) / unit_loss
            # Reserve the exit's fixed fee too; the paper account cannot borrow it.
            affordable = max(D(0), cash - 2 * config.fixed_cost) / (entry * (D(1) + fee))
            quantity = min(risk_quantity, affordable).quantize(UNIT_STEP, rounding=ROUND_DOWN)
            if quantity <= 0:
                skips["UNAFFORDABLE_QUANTITY"] += 1
                continue
            entry_fee = quantity * entry * fee + config.fixed_cost
            entry_slippage = quantity * (entry - bar.o)
            cash -= quantity * entry + entry_fee
            require(cash >= 0, "PAPER_CASH_RECONCILIATION_FAILED")
            position = {"plan": plan, "entry_index": i, "entry": entry, "quantity": quantity,
                        "entry_fee": entry_fee, "entry_slippage": entry_slippage,
                        "entry_raw": bar.o, "nominal_risk": quantity * (entry - plan.stop),
                        "target": entry + D(2) * (entry - plan.stop), "stop": plan.stop}
            total_costs += entry_fee + entry_slippage
        if position is not None and not gap_censored:
            stop, target = position["stop"], position["target"]
            reason, raw_exit, ambiguous = None, None, False
            if bar.o <= stop:
                reason, raw_exit = "GAP_STOP_SCENARIO", bar.o
            elif bar.o >= target:
                reason, raw_exit = "TARGET_LIMIT_SCENARIO", target
            elif bar.low <= stop and bar.h >= target:
                reason, raw_exit, ambiguous = "PATH_AMBIGUOUS_STOP_BOUND", stop, True
            elif bar.low <= stop:
                reason, raw_exit = "STOP_SCENARIO", stop
            elif bar.h >= target:
                reason, raw_exit = "TARGET_LIMIT_SCENARIO", target
            elif i - position["entry_index"] + 1 >= config.hold_bars:
                reason, raw_exit = "TIME_LIMIT_CLOSE_SCENARIO", bar.c
            if reason is not None:
                price = raw_exit * (D(1) - slip)
                quantity = position["quantity"]
                exit_fee = quantity * price * fee + config.fixed_cost
                exit_slippage = quantity * (raw_exit - price)
                cash += quantity * price - exit_fee
                require(cash >= 0, "PAPER_CASH_RECONCILIATION_FAILED")
                net = quantity * (price - position["entry"]) - position["entry_fee"] - exit_fee
                completed_net += net
                total_costs += exit_fee + exit_slippage
                nominal = position["nominal_risk"]
                trades.append({"signal_id": position["plan"].signal_id,
                               "entry_index": position["entry_index"], "exit_index": i,
                               "decision_available_ms": position["plan"].available_ms,
                               "entry_open_ms": dataset.bars[position["entry_index"]].open_ms,
                               "exit_bar_available_ms": bar.available_ms,
                               "entry": decimal_text(position["entry"]),
                               "exit": decimal_text(price), "quantity": decimal_text(quantity),
                               "entry_fee": decimal_text(position["entry_fee"]),
                               "exit_fee": decimal_text(exit_fee),
                               "slippage_cost": decimal_text(position["entry_slippage"] + exit_slippage),
                               "nominal_risk": decimal_text(nominal),
                               "net_pnl": decimal_text(net),
                               "net_r": decimal_text(net / nominal) if nominal > 0 else None,
                               "reason": reason, "path_ambiguous": ambiguous,
                               "classification": "SYNTHETIC_FILL_BOUND_NOT_EXECUTABLE"})
                position = None
        inventory = D(0) if position is None else position["quantity"] * bar.c
        nav = cash + inventory
        require(nav.is_finite() and D(0) <= nav <= D("1000000000000000"),
                "PAPER_NUMERICAL_SCOPE_EXCEEDED")
        peak = max(peak, nav)
        max_drawdown = max(max_drawdown, (peak - nav) / peak)
        # Closed-bar observation only. This is not a live intrabar loss governor.
        if nav <= day_nav * (D(1) - D(config.daily_loss_bps) / D(10_000)):
            halted = True
        equity.append({"index": i, "close_ms": bar.close_ms, "available_ms": bar.available_ms,
                       "cash": decimal_text(cash), "inventory_mark": decimal_text(inventory),
                       "nav": decimal_text(nav), "daily_entry_halt": halted,
                       "mark_classification": "LAST_TRADE_MARK_NOT_LIQUIDATION"})
        previous_nav = nav
    open_fee = D(0) if position is None else position["entry_fee"]
    realized_net = completed_net - open_fee
    unrealized = D(0) if position is None else position["quantity"] * (
        dataset.bars[-1].c - position["entry"])
    expected = config.initial_cash + realized_net + unrealized
    require(abs(expected - previous_nav) < D("0.000000000000000000000001"),
            "PAPER_NAV_RECONCILIATION_FAILED")
    wins = sum(D(t["net_pnl"]) > 0 for t in trades)
    losses = sum(D(t["net_pnl"]) < 0 for t in trades)
    return {"variant": variant, "plans": len(plans), "skips": dict(sorted(skips.items())),
            "trades": trades, "equity": equity, "completed_trades": len(trades),
            "wins": wins, "losses": losses,
            "win_rate": decimal_text(D(wins) / D(len(trades))) if trades else None,
            "completed_trade_net": decimal_text(completed_net),
            "realized_net_including_open_entry_costs": decimal_text(realized_net),
            "unrealized_price_change": decimal_text(unrealized),
            "costs_including_slippage": decimal_text(total_costs),
            "ending_cash": decimal_text(cash), "ending_marked_nav": decimal_text(previous_nav),
            "max_close_mark_drawdown": decimal_text(max_drawdown),
            "open_position": None if position is None else {
                "signal_id": position["plan"].signal_id,
                "quantity": decimal_text(position["quantity"]),
                "entry": decimal_text(position["entry"]), "stop": decimal_text(position["stop"]),
                "target": decimal_text(position["target"]),
                "status": "GAP_UNRESOLVED" if gap_censored else "OPEN_UNRESOLVED"},
            "performance_status": "GAP_UNRESOLVED" if gap_censored else "SCENARIO_ONLY",
            "buy_burn_scenario": budget_scenario(realized_net, cash, config.initial_cash,
                                                config.buy_burn_scenario_bps,
                                                bool(position is not None or dataset.gaps))}
