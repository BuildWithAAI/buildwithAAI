"""Frozen chronological experiments; no external preregistration or execution claim."""

from bisect import bisect_left
from dataclasses import replace

from .data import HOUR, Config, D, Dataset, decimal_text, digest, exact, integer, number, precision, require
from .detector import detect, prior_atr
from .paper import UNIT_STEP, VARIANTS, Plan, budget_scenario, simulate
from .reports import code_fingerprint

STUDY_RULES = "BT006_EXPANDING_CHRONOLOGICAL_V1"
CANDIDATES = ("A", "B", "C")
SCENARIOS = ("BASE", "DOUBLE_COST", "ONE_HOUR_DELAY")


def bar_record(b):
    return {"open_ms": b.open_ms, "close_ms": b.close_ms, "available_ms": b.available_ms,
            "open": decimal_text(b.o), "high": decimal_text(b.h),
            "low": decimal_text(b.low), "close": decimal_text(b.c)}


def known_prefix(dataset, cutoff):
    bars = tuple(b for b in dataset.bars if b.close_ms <= cutoff and b.available_ms <= cutoff)
    require(bars, "NO_KNOWN_PREFIX")
    value = {"market": dataset.market, "classification": dataset.classification,
             "availability": dataset.availability, "bars": [bar_record(b) for b in bars]}
    gaps = tuple({"after_index": i - 1, "before_index": i,
                  "missing_hours": (b.open_ms - bars[i - 1].close_ms) // HOUR}
                 for i, b in enumerate(bars) if i and b.open_ms != bars[i - 1].close_ms)
    return Dataset(bars, dict(dataset.market), dataset.classification, dataset.availability,
                   dataset.source_sha256, digest(value), min(dataset.captured_ms, cutoff),
                   gaps, dataset.purpose)


def coverage(dataset, start, end, warmup):
    required_start = start - warmup * HOUR
    expected = (end - required_start) // HOUR
    rows = [b for b in dataset.bars if required_start <= b.open_ms < end]
    missing = expected - len(rows)
    valid = (missing == 0 and rows and rows[0].open_ms == required_start and
             rows[-1].close_ms == end)
    return {"status": "COMPLETE" if valid else "INCOMPLETE",
            "required_start_ms": required_start, "end_ms": end,
            "expected_bars": expected, "known_bars": len(rows), "missing_bars": missing}


def config_from_record(value):
    exact(value, set(Config().record()))
    result = Config(number(value["initial_cash"]), value["risk_bps"], value["daily_loss_bps"],
                    value["fee_bps"], value["slippage_bps"], number(value["fixed_cost"]),
                    value["latency_ms"], value["hold_bars"], value["buy_burn_scenario_bps"])
    require(result.record() == value, "NONCANONICAL_STUDY_CONFIG")
    require(result.buy_burn_scenario_bps is None, "FOLD_PROFITS_NOT_A_BUY_BURN_ACCOUNT")
    return result


def minimum_embargo(config):
    return config.hold_bars + (config.latency_ms + HOUR - 1) // HOUR + 5


def make_plan(dataset, config=None, *, warmup_hours=204, train_hours=240, test_hours=192,
              folds=3, seeds=(11, 23, 47, 89, 131), min_train_trades=3,
              min_test_trades=30, max_drawdown_bps=300, embargo_hours=None):
    config = Config() if config is None else config
    require(config.buy_burn_scenario_bps is None, "FOLD_PROFITS_NOT_A_BUY_BURN_ACCOUNT")
    embargo = minimum_embargo(config) if embargo_hours is None else embargo_hours
    start = dataset.bars[0].open_ms + warmup_hours * HOUR
    value = {"protocol": "ZOORA_SFP_STUDY_PLAN_V1", "rules": STUDY_RULES,
             "market": dict(dataset.market), "price_classification": dataset.classification,
             "availability_semantics": dataset.availability, "config": config.record(),
             "warmup_hours": warmup_hours, "train_hours": train_hours, "test_hours": test_hours,
             "folds": folds, "embargo_hours": embargo, "start_ms": start,
             "seeds": list(seeds), "min_train_trades": min_train_trades,
             "min_test_trades": min_test_trades, "max_drawdown_bps": max_drawdown_bps,
             "selection": "POSITIVE_CLOSED_TRAIN_NET_FLAT_ELIGIBLE_OR_CASH",
             "control": "TRAIN_A_PLAN_DENSITY_FROZEN_BEFORE_TEST",
             "scenarios": list(SCENARIOS),
             "first_train_prefix_sha256": known_prefix(dataset, start + train_hours * HOUR).dataset_sha256,
             "prepared_from_dataset_sha256": dataset.dataset_sha256,
             "prepared_from_capture_ms": dataset.captured_ms,
             "preregistration": "LOCAL_HASH_FREEZE_NOT_EXTERNAL_ATTESTATION",
             "gates": "RESEARCH_SCREEN_PROPOSAL_NOT_TRADING_ACCEPTANCE"}
    value["plan_sha256"] = digest(value)
    parse_plan(value)
    prefix = known_prefix(dataset, start + train_hours * HOUR)
    require(coverage(prefix, start, start + train_hours * HOUR, warmup_hours)["status"] ==
            "COMPLETE", "FIRST_TRAIN_WINDOW_INCOMPLETE")
    return value


def parse_plan(value):
    keys = {"protocol", "rules", "market", "price_classification", "availability_semantics", "config",
            "warmup_hours", "train_hours", "test_hours", "folds", "embargo_hours", "start_ms", "seeds",
            "min_train_trades", "min_test_trades", "max_drawdown_bps", "selection", "control",
            "scenarios", "first_train_prefix_sha256", "prepared_from_dataset_sha256",
            "prepared_from_capture_ms", "preregistration", "gates", "plan_sha256"}
    exact(value, keys)
    payload = {k: v for k, v in value.items() if k != "plan_sha256"}
    require(digest(payload) == value["plan_sha256"], "STUDY_PLAN_HASH_MISMATCH")
    require(value["protocol"] == "ZOORA_SFP_STUDY_PLAN_V1" and value["rules"] == STUDY_RULES,
            "UNSUPPORTED_STUDY_PLAN")
    require(value["selection"] == "POSITIVE_CLOSED_TRAIN_NET_FLAT_ELIGIBLE_OR_CASH" and
            value["control"] == "TRAIN_A_PLAN_DENSITY_FROZEN_BEFORE_TEST" and
            value["scenarios"] == list(SCENARIOS) and
            value["preregistration"] == "LOCAL_HASH_FREEZE_NOT_EXTERNAL_ATTESTATION" and
            value["gates"] == "RESEARCH_SCREEN_PROPOSAL_NOT_TRADING_ACCEPTANCE", "INVALID_STUDY_RULES")
    config = config_from_record(value["config"])
    # Every stress setting must be valid rather than silently clipped.
    stress_configs(config)
    integer(value["warmup_hours"], 24, 1000)
    integer(value["train_hours"], 24, 10000)
    integer(value["test_hours"], 24, 5000)
    integer(value["folds"], 1, 8)
    integer(value["embargo_hours"], minimum_embargo(config), 1000)
    integer(value["start_ms"], value["warmup_hours"] * HOUR, 253_000_000_000_000)
    require(value["start_ms"] % HOUR == 0, "UNALIGNED_STUDY_START")
    integer(value["min_train_trades"], 1, 1000)
    integer(value["min_test_trades"], 1, 10000)
    integer(value["max_drawdown_bps"], 1, 10000)
    require(isinstance(value["seeds"], list) and 1 <= len(value["seeds"]) <= 8 and
            all(type(s) is int for s in value["seeds"]) and
            len(set(value["seeds"])) == len(value["seeds"]), "INVALID_SEED_LIST")
    for seed in value["seeds"]:
        integer(seed, 0, 2**31 - 1)
    exact(value["market"], {"base", "quote", "venue", "source_id"})
    require(value["price_classification"] in {"SYNTHETIC", "SOURCE_ASSERTED_OBSERVATIONS"} and
            value["availability_semantics"] in {"SYNTHETIC_RECONSTRUCTION", "SOURCE_ASSERTED_RECEIPT"},
            "INVALID_STUDY_CLASSIFICATION")
    integer(value["prepared_from_capture_ms"], 0, 253_402_300_799_000)
    require(all(isinstance(value[k], str) and len(value[k]) == 64 and
                all(c in "0123456789abcdef" for c in value[k])
                for k in ["first_train_prefix_sha256", "prepared_from_dataset_sha256"]),
            "INVALID_STUDY_HASH")
    require(value["warmup_hours"] + value["train_hours"] + value["embargo_hours"] +
            value["test_hours"] * value["folds"] <= 20000, "STUDY_WINDOW_LIMIT")
    return config


def stress_configs(config):
    return {"BASE": config,
            "DOUBLE_COST": replace(config, fee_bps=config.fee_bps * 2,
                                   slippage_bps=config.slippage_bps * 2,
                                   fixed_cost=config.fixed_cost * 2),
            "ONE_HOUR_DELAY": replace(config, latency_ms=config.latency_ms + HOUR)}


def random_plans(dataset, config, seed, rate_bps):
    integer(seed, 0, 2**31 - 1)
    integer(rate_bps, 0, 10000)
    bars = dataset.bars
    opens = [b.open_ms for b in bars]
    plans = []
    for i, bar in enumerate(bars):
        atr = prior_atr(bars, i, bar.open_ms)
        if atr is None or bar.available_ms - bar.close_ms > HOUR:
            continue
        identity = {"control": "SEEDED_CLOSED_BAR_CLOCK_V1", "seed": seed,
                    "market": dataset.market, "decision_open_ms": bar.open_ms}
        if int(digest(identity)[:16], 16) * 10000 >= rate_bps * 2**64:
            continue
        due = max(i + 1, bisect_left(opens, bar.available_ms + config.latency_ms))
        stop = bar.c - atr
        if due >= len(bars) or stop <= 0 or bars[due].o <= stop:
            continue
        if any(bars[u].close_ms != bars[u + 1].open_ms for u in range(i, due)):
            continue
        if any(b.low <= stop and b.available_ms <= bars[due].open_ms for b in bars[i + 1:due]):
            continue
        plans.append(Plan(digest(identity), due, bar.available_ms, stop, atr))
    return plans


def buy_hold(dataset, config, window):
    """100% affordable-capital benchmark; terminal marks stay unrealized."""
    start, end = window
    fee, slip = D(config.fee_bps) / D(10000), D(config.slippage_bps) / D(10000)
    cash, quantity, entry, expense, slippage = config.initial_cash, D(0), D(0), D(0), D(0)
    entered = None
    equity = []
    peak, drawdown = config.initial_cash, D(0)
    for i, bar in enumerate(dataset.bars):
        if entered is None and start <= bar.open_ms < end and i and dataset.bars[i - 1].available_ms <= bar.open_ms:
            entry = bar.o * (1 + slip)
            quantity = max(D(0), cash - 2 * config.fixed_cost) / (entry * (1 + fee))
            quantity = quantity.quantize(UNIT_STEP, rounding="ROUND_DOWN")
            if quantity > 0:
                entered = i
                expense = quantity * entry * fee + config.fixed_cost
                slippage = quantity * (entry - bar.o)
                cash -= quantity * entry + expense
        nav = cash + quantity * bar.c
        require(cash >= 0 and D(0) <= nav <= D("1000000000000000"), "BUY_HOLD_ACCOUNTING_FAILED")
        peak = max(peak, nav)
        drawdown = max(drawdown, (peak - nav) / peak)
        equity.append({"index": i, "nav": decimal_text(nav),
                       "inventory_mark": decimal_text(quantity * bar.c)})
    unrealized = quantity * (dataset.bars[-1].c - entry) if entered is not None else D(0)
    require(abs(config.initial_cash - expense + unrealized - nav) < D("0.000000000000000000000001"),
            "BUY_HOLD_ACCOUNTING_FAILED")
    return {"variant": "BUY_HOLD", "plans": int(entered is not None), "skips": {}, "trades": [],
            "equity": equity, "completed_trades": 0, "wins": 0, "losses": 0, "win_rate": None,
            "completed_trade_net": "0", "realized_net_including_open_entry_costs": decimal_text(-expense),
            "unrealized_price_change": decimal_text(unrealized),
            "costs_including_slippage": decimal_text(expense + slippage),
            "ending_cash": decimal_text(cash), "ending_marked_nav": decimal_text(nav),
            "max_close_mark_drawdown": decimal_text(drawdown),
            "open_position": None if entered is None else {"entry_index": entered, "status": "OPEN_UNRESOLVED"},
            "performance_status": "SCENARIO_ONLY", "exposure_policy": "FULL_AFFORDABLE_CAPITAL_NO_STOP_BENCHMARK",
            "buy_burn_scenario": budget_scenario(-expense, cash, config.initial_cash, None, entered is not None)}


def metrics(result, dataset, config, window):
    values = [D(t["net_pnl"]) for t in result["trades"]]
    positive = sum((v for v in values if v > 0), D(0))
    negative = -sum((v for v in values if v < 0), D(0))
    streak = worst = 0
    for value in values:
        streak = streak + 1 if value < 0 else 0
        worst = max(worst, streak)
    start, end = window
    eligible = {b.index for b in dataset.bars if start <= b.open_ms < end}
    exposed = {e["index"] for e in result["equity"] if D(e["inventory_mark"]) > 0}
    for trade in result["trades"]:
        exposed.update(range(trade["entry_index"], trade["exit_index"] + 1))
    record = {k: result[k] for k in ["completed_trades", "wins", "losses", "win_rate", "completed_trade_net",
              "realized_net_including_open_entry_costs", "unrealized_price_change", "costs_including_slippage",
              "ending_cash", "ending_marked_nav", "max_close_mark_drawdown", "open_position", "performance_status"]}
    record.update({"marked_return": decimal_text(D(result["ending_marked_nav"]) / config.initial_cash - 1),
                   "profit_factor": decimal_text(positive / negative) if negative else None,
                   "profit_factor_status": "DEFINED" if negative else "NO_LOSSES_UNDEFINED",
                   "expectancy_net": decimal_text(sum(values, D(0)) / len(values)) if values else None,
                   "worst_trade_net": decimal_text(min(values)) if values else None,
                   "longest_closed_loss_streak": worst,
                   "observed_exposure_fraction": decimal_text(D(len(exposed & eligible)) / len(eligible))
                   if eligible else None,
                   "ambiguous_trades": sum(t["path_ambiguous"] for t in result["trades"]),
                   "plans": result["plans"], "skips": result["skips"]})
    return record


def select_training(trials, min_trades, valid):
    eligible = [t for t in trials if valid and t["metrics"]["completed_trades"] >= min_trades and
                t["metrics"]["open_position"] is None and
                D(t["metrics"]["completed_trade_net"]) > 0]
    if not eligible:
        return "NO_TRADE", "NO_ELIGIBLE_POSITIVE_FLAT_TRAINING_RESULT"
    # Exact Decimal scoring and fixed A/B/C order settle ties; no test metric is consulted.
    winner = max(eligible, key=lambda t: (D(t["metrics"]["completed_trade_net"]),
                                        -CANDIDATES.index(t["variant"])))
    return winner["variant"], "TRAINING_ONLY_SELECTION"


def run_study(dataset, plan, source_head=None):
    config = parse_plan(plan)
    require(source_head is None or (isinstance(source_head, str) and len(source_head) == 40 and
            all(c in "0123456789abcdef" for c in source_head)), "INVALID_SOURCE_HEAD")
    require(dataset.market == plan["market"] and dataset.classification == plan["price_classification"] and
            dataset.availability == plan["availability_semantics"], "STUDY_DATA_CONTRACT_MISMATCH")
    first_end = plan["start_ms"] + plan["train_hours"] * HOUR
    require(known_prefix(dataset, first_end).dataset_sha256 == plan["first_train_prefix_sha256"],
            "FROZEN_TRAINING_HISTORY_CHANGED")
    with precision():
        trials, folds = [], []
        stresses = stress_configs(config)
        for fold_id in range(plan["folds"]):
            train_start = plan["start_ms"]
            train_end = first_end + fold_id * plan["test_hours"] * HOUR
            test_start = train_end + plan["embargo_hours"] * HOUR
            test_end = test_start + plan["test_hours"] * HOUR
            train_ds = known_prefix(dataset, train_end)
            train_coverage = coverage(train_ds, train_start, train_end, plan["warmup_hours"])
            train_signals, _ = detect(train_ds)
            training = []

            def trial(phase, variant, scenario, ds, cfg, signals, window, seed=None, rate=None, fold=fold_id):
                if variant == "BUY_HOLD":
                    result = buy_hold(ds, cfg, window)
                elif variant == "RANDOM_TIME":
                    result = simulate(ds, cfg, [], variant, entry_window=window,
                                      prepared_plans=random_plans(ds, cfg, seed, rate))
                else:
                    result = simulate(ds, cfg, signals, variant, entry_window=window)
                identity = {"fold": fold, "phase": phase, "variant": variant, "scenario": scenario,
                            "seed": seed, "window": list(window), "prefix_sha256": ds.dataset_sha256,
                            "config": cfg.record(), "rules": STUDY_RULES}
                t = dict(identity, trial_id=digest(identity), metrics=metrics(result, ds, cfg, window),
                         trades=result["trades"], classification="SYNTHETIC_EXECUTION_SCENARIO")
                trials.append(t)
                return t

            for variant in CANDIDATES:
                training.append(trial("TRAIN", variant, "BASE", train_ds, config, train_signals,
                                      (train_start, train_end)))
            selected, reason = select_training(training, plan["min_train_trades"],
                                               train_coverage["status"] == "COMPLETE")
            rate = min(10000, training[0]["metrics"]["plans"] * 10000 //
                       ((train_end - train_start) // HOUR))
            test_ds = known_prefix(dataset, test_end)
            test_coverage = coverage(test_ds, test_start, test_end, plan["warmup_hours"])
            evaluation = []
            if test_coverage["status"] == "COMPLETE":
                test_signals, _ = detect(test_ds)
                for scenario, cfg in stresses.items():
                    for variant in VARIANTS:
                        evaluation.append(trial("TEST", variant, scenario, test_ds, cfg, test_signals,
                                                (test_start, test_end)))
                evaluation.append(trial("TEST", "BUY_HOLD", "BASE", test_ds, config, [],
                                        (test_start, test_end)))
                for seed in plan["seeds"]:
                    evaluation.append(trial("TEST", "RANDOM_TIME", "BASE", test_ds, config, [],
                                            (test_start, test_end), seed, rate))
            folds.append({"fold": fold_id, "train_start_ms": train_start, "train_end_ms": train_end,
                          "test_start_ms": test_start, "test_end_ms": test_end,
                          "train_coverage": train_coverage, "test_coverage": test_coverage,
                          "selected_variant": selected, "selection_reason": reason,
                          "random_rate_bps": rate, "training_trial_ids": [t["trial_id"] for t in training],
                          "test_trial_ids": [t["trial_id"] for t in evaluation]})
        fingerprint = code_fingerprint()
        identity = {"rules": STUDY_RULES, "plan_sha256": plan["plan_sha256"],
                    "dataset_sha256": dataset.dataset_sha256, "code_sha256": fingerprint["sha256"],
                    "source_head_sha": source_head}
        report = dict(identity, protocol="ZOORA_SFP_STUDY_REPORT_V1", run_id=digest(identity),
                      source_head_status="DECLARED_NOT_ATTESTED" if source_head else "UNDECLARED",
                      code_fingerprint=fingerprint,
                      market=dataset.market, price_classification=dataset.classification,
                      availability_semantics=dataset.availability, source_verification="UNAVAILABLE",
                      folds=folds, trials=trials, summary=summarize(trials, folds, plan),
                      account_policy="INDEPENDENT_FOLD_ACCOUNTS_NOT_A_COMPOUNDED_TREASURY",
                      cash_resets="EXPERIMENT_BOUNDARIES_NOT_LOSS_ERASURE",
                      random_control="TRAIN_RATE_FROZEN_TIME_CONTROL_NOT_EXACT_EXPOSURE_MATCHING",
                      unseen_status="CHRONOLOGICAL_WINDOWS_NOT_ATTESTED_UNSEEN",
                      selection_risk="MULTIPLE_VARIANTS_SEEDS_AND_SCENARIOS_NOT_STATISTICALLY_ADJUSTED",
                      readiness="BLOCKED_NOT_A_FUNDED_STRATEGY", price_floor="NOT_ESTABLISHED",
                      funds_transferred="0", tokens_purchased="0", tokens_burned="0",
                      captured_ms=dataset.captured_ms, source_sha256=dataset.source_sha256)
        return report


def summarize(trials, folds, plan):
    rows = []
    for variant in (*VARIANTS, "BUY_HOLD", "RANDOM_TIME", "TRAIN_SELECTED"):
        tests = [t for t in trials if t["phase"] == "TEST" and t["scenario"] == "BASE" and
                 (t["variant"] == variant if variant != "TRAIN_SELECTED" else
                  t["variant"] == folds[t["fold"]]["selected_variant"])]
        # Average random seeds within each fold before averaging folds.
        grouped = {}
        for t in tests:
            grouped.setdefault(t["fold"], []).append(t["metrics"])
        returns = [sum((D(m["marked_return"]) for m in ms), D(0)) / len(ms)
                   for ms in grouped.values()]
        closed = sum(t["metrics"]["completed_trades"] for t in tests)
        dd = max((D(t["metrics"]["max_close_mark_drawdown"]) for t in tests), default=D(0))
        open_count = sum(t["metrics"]["open_position"] is not None for t in tests)
        reasons = []
        if len(grouped) != plan["folds"]:
            reasons.append("INCOMPLETE_FOLDS")
        if any(f["train_coverage"]["status"] != "COMPLETE" for f in folds):
            reasons.append("INCOMPLETE_TRAINING_FOLDS")
        if closed < plan["min_test_trades"]:
            reasons.append("TOO_FEW_CLOSED_TRADES")
        if not returns or sum(returns, D(0)) <= 0:
            reasons.append("NONPOSITIVE_MEAN_MARKED_RETURN")
        if dd * 10000 > plan["max_drawdown_bps"]:
            reasons.append("DRAWDOWN_SCREEN_EXCEEDED")
        if open_count:
            reasons.append("UNRESOLVED_TERMINAL_POSITIONS")
        if variant in {"BUY_HOLD", "RANDOM_TIME", "NO_TRADE"}:
            reasons.append("CONTROL_NOT_A_STRATEGY_ACCEPTANCE")
        rows.append({"variant": variant, "evaluated_folds": len(grouped), "closed_trades": closed,
                     "mean_marked_return": decimal_text(sum(returns, D(0)) / len(returns)) if returns else None,
                     "positive_folds": sum(v > 0 for v in returns),
                     "max_close_mark_drawdown": decimal_text(dd), "unresolved_trials": open_count,
                     "numeric_screen": "FAIL" if reasons else "PASS_RESEARCH_SCREEN_ONLY",
                     "screen_reasons": reasons,
                     "readiness": "BLOCKED_SOURCE_QUOTES_UNSEEN_AND_SELECTION_REVIEW"})
    return rows
