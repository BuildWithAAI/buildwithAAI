import unittest
from dataclasses import replace

from helpers import dataset, delayed, gap, prefix, value

from zoora_sfp.data import HOUR, Config, D, ResearchError, precision
from zoora_sfp.detector import Signal, detect
from zoora_sfp.paper import budget_scenario, plans_for, simulate


class PaperTests(unittest.TestCase):
    def simulate(self, ds=None, config=None, variant="A", signals=None):
        ds = dataset() if ds is None else ds
        config = Config() if config is None else config
        signals = detect(ds)[0] if signals is None else signals
        with precision():
            return simulate(ds, config, signals, variant)

    def test_acceptance_has_win_loss_and_ambiguous_path_bound(self):
        r = self.simulate()
        self.assertEqual([t["reason"] for t in r["trades"]],
                         ["TARGET_LIMIT_SCENARIO", "STOP_SCENARIO", "PATH_AMBIGUOUS_STOP_BOUND"])
        self.assertEqual((r["wins"], r["losses"]), (1, 2))
        self.assertLess(D(r["trades"][2]["net_pnl"]), 0)
        self.assertTrue(r["trades"][2]["path_ambiguous"])

    def test_no_trade_and_no_spot_short(self):
        r = self.simulate(variant="NO_TRADE")
        self.assertEqual(r["ending_cash"], "10000")
        self.assertEqual(r["trades"], [])
        r = self.simulate()
        self.assertEqual(r["skips"]["SPOT_SHORT_UNSUPPORTED"], 22)
        self.assertTrue(all(D(t["quantity"]) > 0 for t in r["trades"]))

    def test_entry_after_signal_availability_and_delay(self):
        ds = dataset()
        config = Config(latency_ms=HOUR)
        plans, _ = plans_for(ds, config, detect(ds)[0], "A")
        first = next(p for p in plans if p.signal_id == next(
            s.id for s in detect(ds)[0] if s.index == 240))
        self.assertEqual(first.index, 242)
        self.assertGreaterEqual(ds.bars[first.index].open_ms,
                                first.available_ms + config.latency_ms)

    def test_late_accounting_does_not_fund_an_early_entry(self):
        ds = dataset(delayed(value(), 100))
        r = self.simulate(ds)
        self.assertEqual(r["trades"], [])
        self.assertGreater(r["skips"].get("PRIOR_ACCOUNTING_UNAVAILABLE", 0), 0)

    def test_confirmation_is_later_and_rejects_invalidated_candidate(self):
        r = self.simulate(variant="C")
        self.assertEqual(r["trades"][0]["entry_index"], 242)
        self.assertGreater(r["skips"]["INVALIDATED_BEFORE_CONFIRMATION"], 0)
        self.assertFalse(any(t["entry_index"] == 321 for t in r["trades"]))

    def test_higher_costs_reduce_same_fixture_net_result(self):
        ds = dataset(prefix(260))
        base = self.simulate(ds)
        costly = self.simulate(ds, Config(fee_bps=20, slippage_bps=10, fixed_cost=D("0.02")))
        self.assertLess(D(costly["completed_trade_net"]), D(base["completed_trade_net"]))
        self.assertGreater(D(costly["costs_including_slippage"]), D(base["costs_including_slippage"]))

    def test_open_inventory_never_forced_closed_into_realized_profit(self):
        r = self.simulate(variant="C", config=Config(buy_burn_scenario_bps=3000))
        self.assertIsNotNone(r["open_position"])
        self.assertEqual(r["open_position"]["status"], "OPEN_UNRESOLVED")
        self.assertGreater(D(r["unrealized_price_change"]), 0)
        self.assertEqual(r["buy_burn_scenario"]["eligible_quote_units"], "0")
        self.assertEqual(r["buy_burn_scenario"]["tokens_burned"], "0")

    def test_gap_while_invested_blocks_assumed_exit_and_budget(self):
        r = self.simulate(dataset(gap(value(), 242)),
                          Config(buy_burn_scenario_bps=3000))
        self.assertEqual(r["performance_status"], "GAP_UNRESOLVED")
        self.assertEqual(r["open_position"]["status"], "GAP_UNRESOLVED")
        self.assertEqual(r["trades"], [])
        self.assertEqual(r["buy_burn_scenario"]["buy_burn_budget_quote_units"], "0")

    def test_cash_nav_and_completed_trade_reconcile(self):
        r = self.simulate()
        with precision():
            self.assertEqual(sum((D(t["net_pnl"]) for t in r["trades"]), D(0)),
                             D(r["completed_trade_net"]))
            self.assertLess(abs(D("10000") + D(r["realized_net_including_open_entry_costs"]) +
                                D(r["unrealized_price_change"]) - D(r["ending_marked_nav"])),
                            D("0.000000000000000000000001"))
        self.assertTrue(all(D(e["cash"]) >= 0 for e in r["equity"]))

    def test_gap_stop_can_lose_more_than_nominal_r(self):
        v = value()
        v["bars"][282].update(open="96", high="98", low="95", close="97")
        r = self.simulate(dataset(v))
        trade = next(t for t in r["trades"] if t["entry_index"] == 281)
        self.assertEqual(trade["reason"], "GAP_STOP_SCENARIO")
        self.assertLess(D(trade["net_r"]), D("-1"))

    def test_daily_breaker_blocks_later_same_day_plan(self):
        v = value()
        v["bars"][282].update(open="96", high="98", low="95", close="97")
        ds = dataset(v)
        signals = detect(ds)[0]
        extra = Signal("e" * 64, 283, "BULLISH", 270, D(100),
                       ds.bars[272].available_ms, ds.bars[283].available_ms,
                       D(2), D(98), D(105))
        r = self.simulate(ds, Config(daily_loss_bps=10), signals=[*signals, extra])
        self.assertTrue(r["equity"][282]["daily_entry_halt"])
        self.assertGreater(r["skips"]["DAILY_CIRCUIT_BREAKER"], 0)
        self.assertFalse(any(t["entry_index"] == 284 for t in r["trades"]))

    def test_small_account_rejects_unaffordable_risk_and_reserves_exit_fee(self):
        r = self.simulate(config=Config(initial_cash=D(1), fixed_cost=D("0.2")))
        self.assertEqual(r["ending_cash"], "1")
        self.assertGreater(r["skips"]["RISK_TOO_SMALL_FOR_COSTS"], 0)

    def test_frozen_trend_baseline_and_context_filter(self):
        a = self.simulate(variant="A")
        b = self.simulate(variant="B")
        self.assertEqual([t["entry_index"] for t in a["trades"]],
                         [t["entry_index"] for t in b["trades"]])
        baseline = self.simulate(variant="TREND_ONLY")
        self.assertGreater(baseline["plans"], 0)
        self.assertTrue(all(t["entry_index"] % 24 == 0 for t in baseline["trades"]))

    def test_losses_deposits_and_unrealized_marks_are_not_budget(self):
        self.assertEqual(budget_scenario(D(-100), D(20_000), D(10_000), 3000)
                         ["buy_burn_budget_quote_units"], "0")
        self.assertEqual(budget_scenario(D(100), D(9000), D(10_000), 3000)
                         ["buy_burn_budget_quote_units"], "0")
        self.assertEqual(budget_scenario(D(100), D(10_100), D(10_000), 3000, True)
                         ["buy_burn_budget_quote_units"], "0")

    def test_only_recovered_realized_surplus_and_free_cash_can_be_earmarked(self):
        r = budget_scenario(D(100), D(10_060), D(10_000), 3000)
        self.assertEqual(r["eligible_quote_units"], "60")
        self.assertEqual(r["buy_burn_budget_quote_units"], "18")
        self.assertEqual(r["tokens_purchased"], "0")
        self.assertEqual(r["tokens_burned"], "0")
        self.assertIsNone(r["aai_mint"])
        self.assertIsNone(r["burn_transaction"])
        self.assertEqual(budget_scenario(D(100), D(10_100), D(10_000), None)
                         ["policy_status"], "UNSELECTED")
        with self.assertRaises(ResearchError):
            budget_scenario(D(100), D(10_100), D(10_000), 10_001)

    def test_invalid_variant_cannot_become_execute_command(self):
        with self.assertRaises(ResearchError):
            self.simulate(variant="LIVE")
        with self.assertRaises(ResearchError):
            self.simulate(variant="BURN")

    def test_exact_quote_value_is_not_float_rounded(self):
        ds = dataset(prefix(260))
        config = replace(Config(), initial_cash=D("10000.000000000000001"))
        r = self.simulate(ds, config)
        with precision():
            self.assertLess(abs(config.initial_cash + D(r["realized_net_including_open_entry_costs"]) -
                                D(r["ending_marked_nav"])), D("0.000000000000000000000001"))


if __name__ == "__main__":
    unittest.main()
