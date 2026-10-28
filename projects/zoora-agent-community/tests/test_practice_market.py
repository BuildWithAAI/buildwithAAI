"""Blind observation boundary, exact ledger arithmetic and adversarial API use."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from copy import deepcopy
import json
import secrets
import unittest
from unittest.mock import patch

from helpers import Fixture
from zoora_community import practice_engine as e
from zoora_community.store import Store
from zoora_community.validation import Problem, canonical


def rid():
    return secrets.token_hex(16)


class PracticeEngineTests(unittest.TestCase):
    def setUp(self):
        self.world = e.new_world("ab" * 32)
        self.key = next(iter(self.world["coins"]))
        self.coin = self.world["coins"][self.key]
        self.coin.update(
            vb=1_000_000,
            rb=1_000_000,
            vq=100_000_000,
            rq=100_000_000,
            stage="AMM",
            open_lp=True,
            lp_reserve=0,
            mode="churn",
            launch=0,
        )
        self.agent = "f" * 32
        e.apply(self.world, {"action": "enroll", "agent_id": self.agent, "pipeline": "a" * 64})

    def order(self, side="BUY", amount=10_000_000, minimum=1, **extra):
        return {
            "action": "order",
            "agent_id": self.agent,
            "request_id": rid(),
            "coin_id": self.key,
            "side": side,
            "amount": amount,
            "min_output": minimum,
            "observation_tick": self.world["tick"],
            "sequence": 1,
            **extra,
        }

    def step(self):
        # Disable background flow to independently verify only a learner's AMM arithmetic.
        with patch.object(e, "background", lambda *_: None):
            return e.apply(self.world, {"action": "step", "expected_tick": self.world["tick"]})

    def refused(self, code, call):
        with self.assertRaises(Problem) as caught:
            call()
        self.assertEqual(caught.exception.code, code)

    def test_hand_calculated_buy_and_sell_with_fees_gas_and_real_reserves(self):
        e.apply(self.world, self.order())
        self.assertEqual(self.world["accounts"][self.agent]["cash"], e.INITIAL_CASH - 1000)
        self.step()
        a = self.world["accounts"][self.agent]
        # 10 demo USD: fee=0.10, pool receives9.90. floor(1m*9.9m/109.9m)=90081.
        self.assertEqual(a["positions"][self.key], 90081)
        self.assertEqual((self.coin["vb"], self.coin["vq"]), (909919, 109900000))
        self.assertEqual(a["cash"], e.INITIAL_CASH - 10001000)
        e.apply(self.world, self.order("SELL", 90081))
        self.step()
        # floor(109900000*90081/1000000)=9899901; fee=99000; net=9800901.
        self.assertEqual(a["cash"], e.INITIAL_CASH - 201099)
        self.assertEqual((a["fees"], a["gas"], a["positions"][self.key]), (199000, 2000, 0))
        self.assertEqual(e.account_view(self.world, self.agent)["net_pnl_micro"], -201099)

    def test_no_same_tick_fill_and_min_output_failure_only_charges_gas(self):
        e.apply(self.world, self.order(minimum=999999999))
        self.assertIsNotNone(self.world["accounts"][self.agent]["pending"])
        self.assertEqual(self.world["accounts"][self.agent]["receipts"], [])
        self.step()
        a = self.world["accounts"][self.agent]
        self.assertEqual(
            (a["cash"], a["fees"], a["receipts"][0]["reason"]),
            (e.INITIAL_CASH - e.GAS, 0, "MIN_OUTPUT"),
        )

    def test_background_rug_precedes_pending_sell_and_no_magic_exit(self):
        a = self.world["accounts"][self.agent]
        a["positions"][self.key] = 1000
        e.apply(self.world, self.order("SELL", 1000))

        def rug(_world, coin):
            coin["stage"] = "HALTED"

        with patch.object(e, "background", rug):
            e.apply(self.world, {"action": "step", "expected_tick": 0})
        self.assertEqual(a["positions"][self.key], 1000)
        self.assertEqual(a["receipts"][0]["output"], 0)
        self.assertEqual(
            e.account_view(self.world, self.agent)["positions"][0]["net_exit_micro"], 0
        )

    def test_real_curve_quote_reserves_limit_selling(self):
        self.coin.update(stage="CURVE", rq=100)
        self.assertEqual(e.quote(self.coin, "SELL", 1_000_000), 0)

    def test_no_short_negative_boolean_or_nan_orders(self):
        self.refused(
            "PRACTICE_INSUFFICIENT_TOKENS", lambda: e.apply(self.world, self.order("SELL", 1))
        )
        for value in (-1, 0, True, 1.2, float("nan"), "1"):
            with self.subTest(value=value):
                self.refused(
                    "INVALID_PRACTICE_INTEGER",
                    lambda v=value: e.apply(self.world, self.order(amount=v)),
                )
        self.refused("INVALID_PRACTICE_SIDE", lambda: e.apply(self.world, self.order(side="SHORT")))

    def test_stale_observation_pending_budget_and_order_limit(self):
        self.refused(
            "PRACTICE_OBSERVATION_STALE",
            lambda: e.apply(self.world, self.order(observation_tick=2)),
        )
        self.refused(
            "PRACTICE_BUY_LIMIT", lambda: e.apply(self.world, self.order(amount=e.MAX_ORDER + 1))
        )
        e.apply(self.world, self.order())
        self.refused("PRACTICE_ORDER_PENDING", lambda: e.apply(self.world, self.order()))
        self.step()
        self.world["accounts"][self.agent]["order_count"] = e.MAX_ORDERS
        self.refused("PRACTICE_ORDER_LIMIT", lambda: e.apply(self.world, self.order()))

    def test_buy_halt_latches_and_reduction_is_allowed(self):
        a = self.world["accounts"][self.agent]
        a["cash"] = e.INITIAL_CASH // 2
        a["positions"][self.key] = 100
        e.mark_accounts(self.world)
        self.assertTrue(a["buy_halted"])
        a["cash"] = e.INITIAL_CASH
        e.mark_accounts(self.world)
        self.assertTrue(a["buy_halted"])
        self.refused("PRACTICE_BUY_LIMIT", lambda: e.apply(self.world, self.order()))
        e.apply(self.world, self.order("SELL", 100))
        self.step()
        self.assertEqual(a["positions"][self.key], 0)

    def test_hidden_launches_regimes_entropy_and_turns_never_serialize(self):
        public = e.public_market(self.world)
        encoded = canonical(public)
        self.assertEqual(len(public["coins"]), 4)
        for name in (
            "secret",
            "mode",
            "launch",
            "turn",
            "migration_tick",
            "billion",
            "dump",
            "runner",
        ):
            self.assertNotIn('"' + name + '"', encoded)
        for coin in self.world["coins"].values():
            if coin["launch"] > 0:
                self.assertNotIn(coin["id"], encoded)
        self.assertNotIn(self.world["secret"], encoded)
        self.assertFalse(public["live_execution_allowed"])

    def test_same_observed_prefix_different_latent_future_is_indistinguishable(self):
        other = deepcopy(self.world)
        for coin in other["coins"].values():
            coin["mode"] = "billion"
            coin["turn"] = 90
        self.assertEqual(e.public_market(self.world), e.public_market(other))

    def test_migration_unavailable_tick_and_reserved_supply(self):
        self.coin.update(
            stage="MIGRATING", migration_tick=1, rb=0, lp_reserve=200_000_000, rq=20_000_000_000
        )
        self.world["tick"] = 1
        e.background(self.world, self.coin)
        self.assertEqual(e.quote(self.coin, "BUY", 1000000), 0)
        self.world["tick"] = 2
        e.background(self.world, self.coin)
        self.assertEqual(
            (self.coin["stage"], self.coin["rb"], self.coin["lp_reserve"]), ("AMM", 200_000_000, 0)
        )
        self.assertEqual(self.coin["rq"], 19_800_000_000)

    def test_learner_buying_exact_last_curve_tokens_immediately_stops_trading(self):
        self.coin.update(stage="CURVE", rb=90081, lp_reserve=200000000, open_lp=False)
        e.apply(self.world, self.order())
        self.step()
        self.assertEqual(
            (self.coin["stage"], self.coin["rb"], self.coin["migration_tick"]), ("MIGRATING", 0, 1)
        )
        self.assertEqual(e.quote(self.coin, "SELL", 90081), 0)
        self.assertEqual(self.world["accounts"][self.agent]["receipts"][0]["output"], 90081)

    def test_background_exact_curve_completion_cannot_churn_sell_before_migration(self):
        self.coin.update(stage="CURVE", rb=12223, lp_reserve=200000000, open_lp=False)
        self.world["tick"] = 1
        # At this reserve state, a 1.25 demo USD buy (after1% fee) receives exactly12223 tokens.
        with patch.object(e, "draw", return_value=0):
            e.background(self.world, self.coin)
        self.assertEqual(
            (self.coin["stage"], self.coin["rb"], self.coin["migration_tick"]), ("MIGRATING", 0, 1)
        )
        self.assertEqual(self.coin["buys"], 1)
        self.assertEqual(self.coin["sells"], 0)

    def test_runner_and_liquidity_collapse_stress_paths_are_reachable(self):
        for mode, minimum in (
            ("runner", 1_000_000),
            ("billion", 1_000_000_000),
            ("liquidity_exit", 0),
        ):
            world = e.new_world("a1" * 32)
            coin = next(iter(world["coins"].values()))
            coin.update(mode=mode, turn=25)
            if mode == "liquidity_exit":
                coin.update(
                    stage="AMM",
                    open_lp=True,
                    lp_reserve=0,
                    vb=793100000,
                    rb=793100000,
                    vq=3965500000,
                    rq=3965500000,
                )
            peak = 0
            for tick in range(e.MAX_TICKS):
                e.apply(world, {"action": "step", "expected_tick": tick})
                peak = max(peak, e.cap(coin))
            if mode == "liquidity_exit":
                self.assertEqual(e.cap(coin) // e.UNIT, 0)
                self.assertEqual(e.quote(coin, "SELL", 1), 0)
            else:
                self.assertGreaterEqual(peak, minimum * e.UNIT)

    def test_pending_orders_fill_in_acceptance_order_against_shared_reserves(self):
        other = "e" * 32
        e.apply(self.world, {"action": "enroll", "agent_id": other, "pipeline": "b" * 64})
        e.apply(self.world, self.order(sequence=1))
        e.apply(self.world, self.order(agent_id=other, sequence=2))
        self.step()
        first = self.world["accounts"][self.agent]["receipts"][0]
        second = self.world["accounts"][other]["receipts"][0]
        self.assertGreater(first["output"], second["output"])
        held = sum(a["positions"].get(self.key, 0) for a in self.world["accounts"].values())
        self.assertEqual(held + self.coin["rb"], 1000000)

    def test_long_worlds_are_deterministic_bounded_and_conserve_tokens(self):
        for seed in ("01", "02", "03", "04"):
            a = e.new_world(seed * 32)
            b = deepcopy(a)
            for tick in range(e.MAX_TICKS):
                command = {"action": "step", "expected_tick": tick}
                self.assertEqual(e.apply(a, command), e.apply(b, command))
                for coin in a["coins"].values():
                    self.assertGreaterEqual(coin["rq"], 0)
                    self.assertLessEqual(coin["rb"] + coin["lp_reserve"], coin["supply"])
                    self.assertLess(e.cap(coin), 2**53)
            self.assertEqual(a["status"], "CLOSED")
            self.refused(
                "PRACTICE_EPISODE_CLOSED",
                lambda w=a: e.apply(w, {"action": "step", "expected_tick": 120}),
            )


class PracticeStoreTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        self.addCleanup(self.f.close)
        _, self.operator = self.f.operator()
        self.agent_id, self.agent = self.f.agent(self.operator)
        _, self.other = self.f.operator("other_operator")
        self.other_id, self.other_agent = self.f.agent(self.other, "other_agent")
        self.episode = self.post("/v1/practice/episodes", {"request_id": rid()}, self.f.owner)[1][
            "id"
        ]
        self.base = "/v1/practice/episodes/" + self.episode

    def post(self, route, body, token):
        return self.f.store.call("POST", route, body, token)

    def get(self, route, token=None):
        return self.f.store.call("GET", route, token=token)

    def enroll(self):
        return self.post(
            self.base + "/accounts",
            {"request_id": rid(), "agent_id": self.agent_id, "model_pipeline_sha256": "a" * 64},
            self.operator,
        )

    def step(self, tick):
        return self.post(
            self.base + "/step", {"request_id": rid(), "expected_tick": tick}, self.f.owner
        )

    def payload(self):
        coin = self.get(self.base, self.agent)[1]["market"]["coins"][0]
        return {
            "request_id": rid(),
            "coin_id": coin["id"],
            "side": "BUY",
            "amount": 1_000_000,
            "min_output": 1,
            "observation_tick": 0,
        }

    def refused(self, code, fn):
        with self.assertRaises(Problem) as caught:
            fn()
        self.assertEqual(caught.exception.code, code)

    def test_authenticated_observation_only_and_forum_tokens_denied(self):
        for route in ("/v1/practice/episodes", self.base, self.base + "/history"):
            self.refused("UNAUTHORIZED", lambda r=route: self.get(r))
            self.assertEqual(self.get(route, self.agent)[0], 200)
        posting = self.post(f"/v1/forum/agents/{self.agent_id}/credentials", {}, self.operator)[1][
            "token"
        ]
        self.refused("FORUM_SCOPE_REQUIRED", lambda: self.get(self.base, posting))
        self.refused(
            "FORUM_SCOPE_REQUIRED",
            lambda: self.post(self.base + "/orders", self.payload(), posting),
        )

    def test_creator_and_agent_roles_cannot_control_clock_or_peek_future(self):
        for token in (self.operator, self.agent, self.other_agent):
            self.refused(
                "FORBIDDEN",
                lambda t=token: self.post(
                    self.base + "/step", {"request_id": rid(), "expected_tick": 0}, t
                ),
            )
            self.refused(
                "FORBIDDEN",
                lambda t=token: self.post("/v1/practice/episodes", {"request_id": rid()}, t),
            )
        for suffix in ("/future", "/seed", "/scenario", "/outcome"):
            self.refused("NOT_FOUND", lambda s=suffix: self.get(self.base + s, self.agent))
        self.assertEqual(
            [f["tick"] for f in self.get(self.base + "/history", self.agent)[1]["items"]], [0]
        )

    def test_only_creator_enrolls_only_agent_trades_and_account_is_private(self):
        self.enroll()
        self.refused(
            "FORBIDDEN", lambda: self.post(self.base + "/orders", self.payload(), self.operator)
        )
        self.refused(
            "FORBIDDEN",
            lambda: self.get(self.base + "/accounts/" + self.agent_id, self.other_agent),
        )
        self.refused(
            "FORBIDDEN", lambda: self.get(self.base + "/accounts/" + self.agent_id, self.other)
        )
        self.refused(
            "FORBIDDEN",
            lambda: self.post(
                self.base + "/accounts",
                {"request_id": rid(), "agent_id": self.other_id, "model_pipeline_sha256": "a" * 64},
                self.operator,
            ),
        )
        for token in (self.agent, self.operator, self.f.owner):
            self.assertEqual(self.get(self.base + "/accounts/" + self.agent_id, token)[0], 200)

    def test_order_idempotency_race_single_debit_and_changed_payload_conflict(self):
        self.enroll()
        body = self.payload()
        with ThreadPoolExecutor(max_workers=4) as pool:
            replies = list(
                pool.map(lambda _: self.post(self.base + "/orders", body, self.agent), range(4))
            )
        self.assertEqual(sum(status == 201 for status, _ in replies), 1)
        self.assertTrue(all(data == replies[0][1] for _, data in replies))
        account = self.get(self.base + "/accounts/" + self.agent_id, self.agent)[1]
        self.assertEqual((account["gas_micro"], account["order_count"]), (e.GAS, 1))
        self.refused(
            "PRACTICE_IDEMPOTENCY_CONFLICT",
            lambda: self.post(
                self.base + "/orders", {**body, "amount": body["amount"] + 1}, self.agent
            ),
        )
        self.step(0)
        self.assertEqual(self.post(self.base + "/orders", body, self.agent)[1], replies[0][1])
        self.assertEqual(
            len(
                self.get(self.base + "/accounts/" + self.agent_id + "/orders", self.agent)[1][
                    "items"
                ]
            ),
            1,
        )
        self.f.store.audit()

    def test_step_idempotency_and_optimistic_clock(self):
        body = {"request_id": rid(), "expected_tick": 0}
        first = self.post(self.base + "/step", body, self.f.owner)[1]
        self.assertEqual(self.post(self.base + "/step", body, self.f.owner)[1], first)
        self.refused("PRACTICE_CLOCK_CONFLICT", lambda: self.step(0))
        self.assertEqual(self.get(self.base, self.agent)[1]["tick"], 1)
        self.refused("PRACTICE_ENROLLMENT_CLOSED", self.enroll)
        self.f.store.audit()

    def assert_revoked_pending(self):
        self.step(0)
        account = self.get(self.base + "/accounts/" + self.agent_id, self.f.owner)[1]
        self.assertEqual(account["recent_receipts"][0]["reason"], "ACCESS_REVOKED")
        self.assertEqual(account["recent_receipts"][0]["output"], 0)
        self.assertEqual(account["cash_micro"], e.INITIAL_CASH - e.GAS)
        self.assertEqual(account["positions"], [])
        self.f.store.audit()

    def test_suspended_agent_cannot_settle_its_pending_order(self):
        self.enroll()
        self.post(self.base + "/orders", self.payload(), self.agent)
        self.post(
            "/v1/agents/" + self.agent_id + "/suspend",
            {"reason": "Pause delegated work"},
            self.f.owner,
        )
        self.assert_revoked_pending()

    def test_suspended_creator_cancels_its_agents_pending_order(self):
        self.enroll()
        self.post(self.base + "/orders", self.payload(), self.agent)
        operator_id = self.get("/v1/me", self.operator)[1]["principal_id"]
        self.post(
            "/v1/operators/" + operator_id + "/suspend", {"reason": "Pause creator"}, self.f.owner
        )
        self.assert_revoked_pending()

    def test_rotated_credential_does_not_leave_an_old_order_authorized(self):
        self.enroll()
        body = self.payload()
        self.post(self.base + "/orders", body, self.agent)
        fresh = self.post("/v1/credentials/rotate", {}, self.agent)[1]["credential"]["token"]
        self.assert_revoked_pending()
        self.refused("UNAUTHORIZED", lambda: self.post(self.base + "/orders", body, self.agent))
        self.assertEqual(self.get(self.base + "/accounts/" + self.agent_id, fresh)[0], 200)

    def test_expired_credential_cancels_pending_even_with_active_account(self):
        self.enroll()
        self.post(self.base + "/orders", self.payload(), self.agent)
        self.f.at += 86_400_001
        self.assert_revoked_pending()

    def test_audit_detects_entire_episode_removal(self):
        self.enroll()
        self.step(0)
        with closing(self.f.store._connection()) as c:
            c.execute("DELETE FROM practice_actions WHERE episode_id=?", (self.episode,))
            c.execute("DELETE FROM practice_frames WHERE episode_id=?", (self.episode,))
            c.execute("DELETE FROM practice_episodes WHERE id=?", (self.episode,))
        self.refused("PRACTICE_CONSISTENCY_FAILURE", self.f.store.audit)

    def test_audit_detects_truncation_to_a_valid_genesis(self):
        self.enroll()
        self.step(0)
        with closing(self.f.store._connection()) as c:
            c.execute("DELETE FROM practice_actions WHERE episode_id=?", (self.episode,))
            c.execute("DELETE FROM practice_frames WHERE episode_id=? AND tick>0", (self.episode,))
            c.execute(
                "UPDATE practice_episodes SET state_json=initial_json,head=commitment WHERE id=?",
                (self.episode,),
            )
        self.refused("PRACTICE_CONSISTENCY_FAILURE", self.f.store.audit)

    def test_audit_binds_creation_retry_identity(self):
        with closing(self.f.store._connection()) as c:
            c.execute("UPDATE practice_episodes SET request_id=? WHERE id=?", (rid(), self.episode))
        self.refused("PRACTICE_CONSISTENCY_FAILURE", self.f.store.audit)

    def test_atomic_rollback_on_audit_failure_then_retry(self):
        self.enroll()
        body = self.payload()
        before = self.get(self.base + "/accounts/" + self.agent_id, self.agent)[1]
        with patch.object(self.f.store, "_event", side_effect=RuntimeError("fault")):
            with self.assertRaises(RuntimeError):
                self.post(self.base + "/orders", body, self.agent)
        self.assertEqual(self.get(self.base + "/accounts/" + self.agent_id, self.agent)[1], before)
        self.assertEqual(self.post(self.base + "/orders", body, self.agent)[0], 201)
        self.f.store.audit()

    def test_restart_replay_detects_cash_frame_and_command_tampering(self):
        self.enroll()
        self.post(self.base + "/orders", self.payload(), self.agent)
        self.step(0)
        restarted = Store(self.f.state, clock=lambda: self.f.at)
        self.assertEqual(restarted.audit(), self.f.store.audit())
        with closing(self.f.store._connection()) as c:
            saved = c.execute(
                "SELECT state_json FROM practice_episodes WHERE id=?", (self.episode,)
            ).fetchone()[0]
            state = json.loads(saved)
            state["accounts"][self.agent_id]["cash"] += 1
            c.execute(
                "UPDATE practice_episodes SET state_json=? WHERE id=?",
                (canonical(state), self.episode),
            )
        self.refused("PRACTICE_CONSISTENCY_FAILURE", restarted.audit)
        with closing(self.f.store._connection()) as c:
            c.execute("UPDATE practice_episodes SET state_json=? WHERE id=?", (saved, self.episode))
            c.execute(
                "UPDATE practice_frames SET snapshot='{}' WHERE episode_id=? AND tick=1",
                (self.episode,),
            )
        self.refused("PRACTICE_CONSISTENCY_FAILURE", restarted.audit)

    def test_no_entropy_latent_types_in_api_or_general_audit(self):
        self.enroll()
        self.step(0)
        outputs = [
            self.get(self.base, self.f.owner)[1],
            self.get(self.base + "/history", self.agent)[1],
            self.get("/v1/audit", self.f.owner)[1],
        ]
        with closing(self.f.store._connection()) as c:
            secret = json.loads(
                c.execute(
                    "SELECT state_json FROM practice_episodes WHERE id=?", (self.episode,)
                ).fetchone()[0]
            )["secret"]
        for value in outputs:
            data = canonical(value)
            self.assertNotIn(secret, data)
            for key in ('"mode":', '"turn":', '"secret":', '"initial_json":', '"state_json":'):
                self.assertNotIn(key, data)

    def test_unknown_fields_seed_injection_and_bool_clock_rejected(self):
        self.refused(
            "INVALID_FIELDS",
            lambda: self.post(
                "/v1/practice/episodes", {"request_id": rid(), "seed": "public"}, self.f.owner
            ),
        )
        self.refused(
            "INVALID_PRACTICE_INTEGER",
            lambda: self.post(
                self.base + "/step", {"request_id": rid(), "expected_tick": True}, self.f.owner
            ),
        )
        self.enroll()
        self.refused(
            "INVALID_FIELDS",
            lambda: self.post(
                self.base + "/orders", {**self.payload(), "fill_price": 1}, self.agent
            ),
        )


if __name__ == "__main__":
    unittest.main()
