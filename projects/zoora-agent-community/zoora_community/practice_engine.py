"""Bounded synthetic spot market. No network, signer, learned model or real money.

Only public_market/account_view cross the observation boundary. Secret entropy,
latent regimes and future launch times are server state, never browser fixtures.
This is a teaching model, not a Pump program/fee implementation.
"""

from copy import deepcopy
import hashlib
import hmac

from .validation import Problem, canonical

VERSION = "SYNTHETIC_MEME_V1"
UNIT = 1_000_000  # micro demo USD; base quantities are whole synthetic tokens
MAX_TICKS = 120
MAX_ACCOUNTS = 8
MAX_ORDERS = 64
INITIAL_CASH = 10_000 * UNIT
MAX_ORDER = 250 * UNIT
MAX_POSITION = 1_000 * UNIT
GAS = 1_000
FEE_PPM = 10_000
POLICY = {
    "initial_cash_micro": INITIAL_CASH,
    "max_order_micro": MAX_ORDER,
    "max_position_micro": MAX_POSITION,
    "gas_micro": GAS,
    "fee_ppm": FEE_PPM,
    "drawdown_halt_ppm": 200_000,
    "latency_ticks": 1,
    "quote_unit": "MICRO_DEMO_USD",
    "base_unit": "WHOLE_SYNTHETIC_TOKEN",
}
MODES = ("fade", "churn", "dump", "runner", "billion", "liquidity_exit")


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def integer(value, low=0, high=9_000_000_000_000_000):
    if type(value) is not int or not low <= value <= high:
        raise Problem(400, "INVALID_PRACTICE_INTEGER")
    return value


def draw(world, label, bound):
    raw = hmac.new(bytes.fromhex(world["secret"]), label.encode(), hashlib.sha256).digest()
    return int.from_bytes(raw, "big") % bound


def new_world(secret):
    # Caller supplies fresh 256-bit OS entropy; publicly reproducible seeds are test-only.
    if type(secret) is not str or len(secret) != 64:
        raise ValueError("256-bit secret required")
    bytes.fromhex(secret)
    world = {
        "version": VERSION,
        "secret": secret,
        "tick": 0,
        "status": "OPEN",
        "coins": {},
        "accounts": {},
    }
    for i in range(8):
        coin_id = hmac.new(bytes.fromhex(secret), f"coin:{i}".encode(), hashlib.sha256).hexdigest()[
            :32
        ]
        # Modes are independently sampled; no roster guarantees a winning coin.
        number = draw(world, coin_id + ":mode", 100)
        mode = (
            "fade"
            if number < 35
            else "churn"
            if number < 60
            else "dump"
            if number < 80
            else "runner"
            if number < 94
            else "billion"
            if number < 97
            else "liquidity_exit"
        )
        open_lp = draw(world, coin_id + ":venue", 4) == 0
        # Liquidity withdrawals belong only to the generic removable-LP venue.
        if mode == "liquidity_exit" and not open_lp:
            mode = "dump"
        world["coins"][coin_id] = {
            "id": coin_id,
            "name": "Coin " + coin_id[:6].upper(),
            "symbol": "T" + coin_id[:5].upper(),
            "launch": 0 if i < 4 else 4 + draw(world, coin_id + ":launch", 17),
            "mode": mode,
            "turn": 12 + draw(world, coin_id + ":turn", 50),
            "supply": 1_000_000_000,
            "vb": 793_100_000 if open_lp else 1_073_000_000,
            "vq": 3_965_500_000 if open_lp else 5_365_000_000,
            "rb": 793_100_000,
            "rq": 3_965_500_000 if open_lp else 0,
            "lp_reserve": 0 if open_lp else 200_000_000,
            "stage": "AMM" if open_lp else "CURVE",
            "open_lp": open_lp,
            "volume": 0,
            "buys": 0,
            "sells": 0,
            "top10_bps": 1500 + draw(world, coin_id + ":holders", 5500),
            "migration_tick": None,
        }
    return world


def cap(coin):
    return coin["vq"] * coin["supply"] // coin["vb"]


def fee(amount):
    return (amount * FEE_PPM + 999_999) // 1_000_000


def quote(coin, side, amount):
    if coin["stage"] not in ("CURVE", "AMM") or coin["rq"] < 0:
        return 0
    if side == "BUY":
        net = amount - fee(amount)
        out = coin["vb"] * net // (coin["vq"] + net)
        return out if 0 < out <= coin["rb"] else 0
    gross = coin["vq"] * amount // (coin["vb"] + amount)
    # Virtual curve balances cannot fund a withdrawal of real quote reserves.
    return gross - fee(gross) if 0 < gross <= coin["rq"] else 0


def swap(coin, side, amount):
    out = quote(coin, side, amount)
    if out <= 0:
        return 0
    if side == "BUY":
        net = amount - fee(amount)
        coin["vb"] -= out
        coin["rb"] -= out
        coin["vq"] += net
        coin["rq"] += net
        coin["volume"] += amount
        coin["buys"] += 1
    else:
        gross = coin["vq"] * amount // (coin["vb"] + amount)
        coin["vb"] += amount
        coin["rb"] += amount
        coin["vq"] -= gross
        coin["rq"] -= gross
        coin["volume"] += gross
        coin["sells"] += 1
    return out


def public_market(world):
    # Explicit allowlist. Never serialize the private coin/world dictionary.
    return {
        "version": VERSION,
        "classification": "SYNTHETIC_TRAINING",
        "live_execution_allowed": False,
        "tick": world["tick"],
        "virtual_elapsed_seconds": world["tick"] * 10,
        "status": world["status"],
        "policy": dict(POLICY),
        "coins": [
            {
                "id": c["id"],
                "name": c["name"],
                "symbol": c["symbol"],
                "stage": c["stage"],
                "venue": "SIM_OPEN_LP" if c["open_lp"] else "SIM_LOCKED_LAUNCHPAD",
                "lp_withdrawal": "POSSIBLE" if c["open_lp"] else "DISABLED_IN_MODEL",
                "market_cap_micro": cap(c),
                "quote_liquidity_micro": c["rq"],
                "effective_quote_micro": c["vq"],
                "effective_base_tokens": c["vb"],
                "available_base_tokens": c["rb"],
                "supply_tokens": c["supply"],
                "volume_micro": c["volume"],
                "buy_count": c["buys"],
                "sell_count": c["sells"],
                "top10_bps": c["top10_bps"],
                "age_ticks": world["tick"] - c["launch"],
            }
            for c in sorted(world["coins"].values(), key=lambda v: v["id"])
            if c["launch"] <= world["tick"]
        ],
    }


def liquidation(world, account):
    total = account["cash"]
    for key, quantity in account["positions"].items():
        total += max(0, quote(world["coins"][key], "SELL", quantity) - GAS) if quantity else 0
    return total


def mark_accounts(world):
    for account in world["accounts"].values():
        value = liquidation(world, account)
        account["high_water"] = max(account["high_water"], value)
        dd = (account["high_water"] - value) * 1_000_000 // account["high_water"]
        account["max_drawdown_ppm"] = max(account["max_drawdown_ppm"], dd)
        account["buy_halted"] |= dd >= POLICY["drawdown_halt_ppm"]


def account_view(world, agent_id):
    account = world["accounts"].get(agent_id)
    if account is None:
        raise Problem(404, "PRACTICE_ACCOUNT_NOT_FOUND")
    return {
        "agent_id": agent_id,
        "model_pipeline_sha256": account["pipeline"],
        "model_identity": "CREATOR_DECLARED_UNATTESTED",
        "model_training": "NOT_PERFORMED_BY_SIMULATOR",
        "cash_micro": account["cash"],
        "initial_cash_micro": INITIAL_CASH,
        "liquidation_equity_micro": liquidation(world, account),
        "net_pnl_micro": liquidation(world, account) - INITIAL_CASH,
        "cash_benchmark_micro": INITIAL_CASH,
        "fees_micro": account["fees"],
        "gas_micro": account["gas"],
        "positions": [
            {
                "coin_id": k,
                "tokens": v,
                "net_exit_micro": max(0, quote(world["coins"][k], "SELL", v) - GAS) if v else 0,
            }
            for k, v in sorted(account["positions"].items())
        ],
        "pending": deepcopy(account["pending"]),
        "buy_halted": account["buy_halted"],
        "max_drawdown_ppm": account["max_drawdown_ppm"],
        "order_count": account["order_count"],
        "recent_receipts": deepcopy(account["receipts"][-20:]),
        "live_execution_allowed": False,
    }


def background(world, coin):
    age = world["tick"] - coin["launch"]
    if age <= 0 or coin["stage"] == "HALTED":
        return
    if coin["stage"] == "MIGRATING":
        # One full unavailable tick; reduced reserves and a price discontinuity are visible.
        if world["tick"] > coin["migration_tick"]:
            coin["vb"] = coin["rb"] = coin["lp_reserve"]
            coin["lp_reserve"] = 0
            coin["vq"] = coin["rq"] = coin["rq"] * 99 // 100
            coin["stage"] = "AMM"
        return
    mode = coin["mode"]
    noise = draw(world, f"{coin['id']}:{world['tick']}:flow", 10_000)
    if mode == "liquidity_exit" and age == coin["turn"]:
        # Generic removable-LP stress case, never a locked launchpad withdrawal.
        coin["vb"] = coin["rb"] = max(1, coin["rb"] // 100)
        coin["vq"] = coin["rq"] = max(1, coin["rq"] // 100)
    outside = (
        coin["supply"]
        - coin["rb"]
        - coin["lp_reserve"]
        - sum(a["positions"].get(coin["id"], 0) for a in world["accounts"].values())
    )
    if mode in ("dump", "fade", "liquidity_exit") and age >= coin["turn"]:
        amount = min(
            outside, max(1, outside * (80 if mode == "dump" and age == coin["turn"] else 8) // 100)
        )
        swap(coin, "SELL", amount)
    elif mode == "churn" or noise < 2400:
        # Several same-tick buys followed by sells model clustered/churn-like prints.
        for _ in range(1 + noise % 4):
            bought = swap(coin, "BUY", max(100_000, coin["vq"] // 80))
            if bought:
                swap(coin, "SELL", bought * 9 // 10)
    else:
        scale = 9 if mode == "billion" else 15 if mode == "runner" else 24
        if (
            cap(coin)
            > (2_000_000_000 if mode == "billion" else 20_000_000 if mode == "runner" else 80_000)
            * UNIT
        ):
            swap(coin, "SELL", min(outside, max(1, outside // 100)))
        else:
            amount = max(100_000, coin["vq"] * (80 + noise % 80) // (scale * 100))
            # Legacy-inspired curve completion. This deliberately omits v3 synthetic migration.
            if coin["stage"] == "CURVE" and quote(coin, "BUY", amount) == 0:
                cost = (coin["vq"] * coin["rb"] + (coin["vb"] - coin["rb"]) - 1) // (
                    coin["vb"] - coin["rb"]
                )
                coin["vb"] -= coin["rb"]
                coin["rb"] = 0
                coin["vq"] += cost
                coin["rq"] += cost
                coin["volume"] += cost
                coin["buys"] += 1
                coin["stage"] = "MIGRATING"
                coin["migration_tick"] = world["tick"]
            else:
                swap(coin, "BUY", amount)
    # The teaching model caps numerical growth, not a real protocol market cap.
    if coin["vq"] > 10**15:
        coin["stage"] = "HALTED"


def fill(world, agent_id, account, revoked=False):
    order = account["pending"]
    if not order:
        return
    coin = world["coins"][order["coin_id"]]
    amount, side = order["amount"], order["side"]
    output = quote(coin, side, amount)
    reason = (
        "ACCESS_REVOKED"
        if revoked
        else (
            "NO_LIQUIDITY_OR_MARKET_UNAVAILABLE"
            if output <= 0
            else "MIN_OUTPUT"
            if output < order["min_output"]
            else None
        )
    )
    if side == "BUY" and reason is None:
        position = account["positions"].get(coin["id"], 0)
        if account["buy_halted"]:
            reason = "DRAWDOWN_HALT"
        elif amount > account["cash"]:
            reason = "INSUFFICIENT_CASH"
        elif (position + output) * (coin["vq"] + amount - fee(amount)) // (
            coin["vb"] - output
        ) > MAX_POSITION:
            reason = "POSITION_LIMIT"
    paid_fee = 0
    if reason is None:
        gross = coin["vq"] * amount // (coin["vb"] + amount) if side == "SELL" else amount
        paid_fee = fee(gross)
        swap(coin, side, amount)
        if side == "BUY":
            account["cash"] -= amount
            account["positions"][coin["id"]] = account["positions"].get(coin["id"], 0) + output
        else:
            account["cash"] += output
            account["positions"][coin["id"]] -= amount
        account["fees"] += paid_fee
    receipt = {
        **order,
        "state": "REJECTED" if reason else "FILLED",
        "reason": reason,
        "fill_tick": world["tick"],
        "output": 0 if reason else output,
        "fee_micro": paid_fee,
        "gas_micro": GAS,
        "cash_after_micro": account["cash"],
    }
    account["receipts"].append(receipt)
    account["pending"] = None
    account["pending_credential"] = None


def apply(world, command):
    """Mutate a private world transactionally; store rolls back all failures."""
    action = command["action"]
    if world["status"] != "OPEN":
        raise Problem(409, "PRACTICE_EPISODE_CLOSED")
    if action == "enroll":
        key = command["agent_id"]
        if key in world["accounts"]:
            raise Problem(409, "PRACTICE_ACCOUNT_EXISTS")
        if len(world["accounts"]) >= MAX_ACCOUNTS:
            raise Problem(409, "PRACTICE_ACCOUNT_LIMIT")
        if world["tick"] != 0:
            raise Problem(409, "PRACTICE_ENROLLMENT_CLOSED")
        world["accounts"][key] = {
            "pipeline": command["pipeline"],
            "cash": INITIAL_CASH,
            "positions": {},
            "pending": None,
            "pending_credential": None,
            "receipts": [],
            "fees": 0,
            "gas": 0,
            "order_count": 0,
            "high_water": INITIAL_CASH,
            "max_drawdown_ppm": 0,
            "buy_halted": False,
        }
        return account_view(world, key)
    if action == "order":
        key = command["agent_id"]
        if key not in world["accounts"]:
            raise Problem(404, "PRACTICE_ACCOUNT_NOT_FOUND")
        account = world["accounts"][key]
        if command["observation_tick"] != world["tick"]:
            raise Problem(409, "PRACTICE_OBSERVATION_STALE")
        if world["tick"] >= MAX_TICKS:
            raise Problem(409, "PRACTICE_EPISODE_CLOSED")
        if account["pending"]:
            raise Problem(409, "PRACTICE_ORDER_PENDING")
        if account["order_count"] >= MAX_ORDERS:
            raise Problem(409, "PRACTICE_ORDER_LIMIT")
        coin = world["coins"].get(command["coin_id"])
        if coin is None or coin["launch"] > world["tick"]:
            raise Problem(404, "PRACTICE_COIN_NOT_FOUND")
        side, amount = command["side"], integer(command["amount"], 1)
        if side not in ("BUY", "SELL"):
            raise Problem(400, "INVALID_PRACTICE_SIDE")
        integer(command["min_output"], 1)
        if account["cash"] < GAS + (amount if side == "BUY" else 0):
            raise Problem(409, "PRACTICE_INSUFFICIENT_CASH")
        if side == "BUY" and (amount > MAX_ORDER or account["buy_halted"]):
            raise Problem(409, "PRACTICE_BUY_LIMIT")
        if side == "SELL" and amount > account["positions"].get(coin["id"], 0):
            raise Problem(409, "PRACTICE_INSUFFICIENT_TOKENS")
        account["cash"] -= GAS
        account["gas"] += GAS
        account["order_count"] += 1
        order = {
            k: command[k]
            for k in (
                "request_id",
                "coin_id",
                "side",
                "amount",
                "min_output",
                "observation_tick",
                "sequence",
            )
        }
        order["state"] = "PENDING"
        account["pending"] = order
        account["pending_credential"] = command.get("credential_id")
        mark_accounts(world)
        return deepcopy(order)
    if action == "step":
        if integer(command["expected_tick"], 0, MAX_TICKS) != world["tick"]:
            raise Problem(409, "PRACTICE_CLOCK_CONFLICT")
        world["tick"] += 1
        for coin in sorted(world["coins"].values(), key=lambda v: v["id"]):
            if coin["launch"] <= world["tick"]:
                background(world, coin)
                mark_accounts(world)
        # Fixed FIFO by acceptance sequence, never selected by favorable outcome.
        pending = sorted(
            (
                (a["pending"]["sequence"], key, a)
                for key, a in world["accounts"].items()
                if a["pending"]
            ),
            key=lambda v: v[0],
        )
        for _sequence, key, account in pending:
            fill(world, key, account, key in command.get("ineligible_agents", []))
            mark_accounts(world)
        if world["tick"] == MAX_TICKS:
            world["status"] = "CLOSED"
        return public_market(world)
    raise Problem(400, "INVALID_PRACTICE_ACTION")
