"""Strict price observations and explicit simulation assumptions."""

import hashlib
import json
import re
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from decimal import Decimal, localcontext

HOUR = 3_600_000
MAX_BYTES = 8 * 1024 * 1024
MAX_BARS = 20_000
D = Decimal
DEFAULT_CASH = D("10000")
DEFAULT_FIXED_COST = D("0.01")


class ResearchError(ValueError):
    """A bounded, nonsensitive error code suitable for the CLI."""


def require(condition, code):
    if not condition:
        raise ResearchError(code)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True,
                      allow_nan=False).encode("utf-8")


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def number(value):
    require(isinstance(value, str) and
            re.fullmatch(r"(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,18})?", value),
            "INVALID_DECIMAL")
    return D(value)


def decimal_text(value):
    if value == 0:
        return "0"
    text = format(value, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def integer(value, minimum, maximum, code="INVALID_INTEGER"):
    require(type(value) is int and minimum <= value <= maximum, code)
    return value


def exact(value, keys, code="INVALID_FIELDS"):
    require(isinstance(value, dict) and set(value) == set(keys), code)


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "DUPLICATE_JSON_KEY")
        result[key] = value
    return result


def decode(raw, maximum=MAX_BYTES):
    require(isinstance(raw, bytes) and len(raw) <= maximum, "INPUT_SIZE_LIMIT")
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=_pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(
                              ResearchError("NONFINITE_JSON")))
    except (UnicodeError, json.JSONDecodeError, RecursionError) as exc:
        raise ResearchError("INVALID_JSON") from exc


@dataclass(frozen=True)
class Bar:
    index: int
    open_ms: int
    close_ms: int
    available_ms: int
    o: Decimal
    h: Decimal
    low: Decimal
    c: Decimal


@dataclass(frozen=True)
class Dataset:
    bars: tuple
    market: dict
    classification: str
    availability: str
    source_sha256: str
    dataset_sha256: str
    captured_ms: int
    gaps: tuple
    purpose: str


def parse_dataset(raw):
    value = decode(raw)
    exact(value, {"protocol", "market", "classification", "availability",
                  "source_sha256", "captured_ms", "purpose", "bars"})
    require(value["protocol"] == "ZOORA_SFP_DATASET_V1", "UNSUPPORTED_DATASET")
    exact(value["market"], {"base", "quote", "venue", "source_id"})
    for key in ["base", "quote"]:
        require(isinstance(value["market"][key], str) and
                re.fullmatch(r"[A-Z0-9][A-Z0-9_-]{0,19}", value["market"][key]),
                "INVALID_MARKET")
    for key in ["venue", "source_id"]:
        require(isinstance(value["market"][key], str) and
                re.fullmatch(r"[A-Za-z0-9_.-]{1,80}", value["market"][key]),
                "INVALID_SOURCE")
    require(value["market"]["base"] != value["market"]["quote"], "IDENTICAL_ASSETS")
    require(value["classification"] in {"SYNTHETIC", "SOURCE_ASSERTED_OBSERVATIONS"},
            "INVALID_CLASSIFICATION")
    require(value["availability"] in {"SYNTHETIC_RECONSTRUCTION", "SOURCE_ASSERTED_RECEIPT"},
            "INVALID_AVAILABILITY")
    require(isinstance(value["source_sha256"], str) and
            re.fullmatch(r"[0-9a-f]{64}", value["source_sha256"]), "INVALID_SOURCE_HASH")
    require(value["purpose"] in {"ENGINE_ACCEPTANCE_NOT_STRATEGY_EVIDENCE",
                                 "USER_SUPPLIED_HISTORY_NOT_INDEPENDENTLY_VERIFIED"},
            "INVALID_PURPOSE")
    require(value["classification"] != "SYNTHETIC" or
            value["purpose"] == "ENGINE_ACCEPTANCE_NOT_STRATEGY_EVIDENCE",
            "SYNTHETIC_PURPOSE_REQUIRED")
    captured = integer(value["captured_ms"], 0, 253_402_300_799_000)
    require(isinstance(value["bars"], list) and 1 <= len(value["bars"]) <= MAX_BARS,
            "BAR_COUNT_LIMIT")
    bars = []
    gaps = []
    for i, item in enumerate(value["bars"]):
        exact(item, {"open_ms", "close_ms", "available_ms", "open", "high", "low", "close"})
        start = integer(item["open_ms"], 0, 253_402_300_795_000)
        end = integer(item["close_ms"], 0, 253_402_300_799_000)
        available = integer(item["available_ms"], 0, 253_402_300_799_000)
        require(start % HOUR == 0 and end == start + HOUR, "UNSUPPORTED_BAR_INTERVAL")
        require(end <= available <= captured, "UNFINISHED_OR_EARLY_BAR")
        o, h, low, c = [number(item[k]) for k in ["open", "high", "low", "close"]]
        require(D(0) < low <= min(o, c) <= max(o, c) <= h, "INVALID_OHLC")
        if bars:
            require(start >= bars[-1].close_ms, "OVERLAPPING_OR_UNSORTED_BARS")
            require(available >= bars[-1].available_ms, "UNSUPPORTED_AVAILABILITY_ORDER")
            if start != bars[-1].close_ms:
                gaps.append({"after_index": i - 1, "before_index": i,
                             "missing_hours": (start - bars[-1].close_ms) // HOUR})
        bars.append(Bar(i, start, end, available, o, h, low, c))
    return Dataset(tuple(bars), dict(value["market"]), value["classification"],
                   value["availability"], value["source_sha256"], digest(value),
                   captured, tuple(gaps), value["purpose"])


@dataclass(frozen=True)
class Config:
    initial_cash: Decimal = DEFAULT_CASH
    risk_bps: int = 10
    daily_loss_bps: int = 50
    fee_bps: int = 10
    slippage_bps: int = 5
    fixed_cost: Decimal = DEFAULT_FIXED_COST
    latency_ms: int = 0
    hold_bars: int = 168
    buy_burn_scenario_bps: int | None = None

    def __post_init__(self):
        require(isinstance(self.initial_cash, Decimal) and self.initial_cash.is_finite()
                and D("1") <= self.initial_cash <= D("1000000000"), "INVALID_INITIAL_CASH")
        require(isinstance(self.fixed_cost, Decimal) and self.fixed_cost.is_finite()
                and D(0) <= self.fixed_cost <= D("1000000"), "INVALID_FIXED_COST")
        integer(self.risk_bps, 1, 100)
        integer(self.daily_loss_bps, self.risk_bps, 1000)
        integer(self.fee_bps, 0, 1000)
        integer(self.slippage_bps, 0, 1000)
        integer(self.latency_ms, 0, 24 * HOUR)
        integer(self.hold_bars, 1, 168)
        if self.buy_burn_scenario_bps is not None:
            integer(self.buy_burn_scenario_bps, 0, 10_000)

    def record(self):
        result = asdict(self)
        result["initial_cash"] = decimal_text(self.initial_cash)
        result["fixed_cost"] = decimal_text(self.fixed_cost)
        result["classification"] = "SYNTHETIC_SCENARIO_NOT_APPROVED_ALLOCATION"
        return result


@contextmanager
def precision():
    with localcontext() as context:
        context.prec = 50
        yield context

