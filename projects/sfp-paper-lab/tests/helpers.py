"""Synthetic observations, not market data."""

from copy import deepcopy

from scripts.make_demo import demo_value
from zoora_sfp.data import HOUR, canonical, parse_dataset


def value():
    return deepcopy(demo_value())


def dataset(v=None):
    return parse_dataset(canonical(value() if v is None else v))


def prefix(count):
    v = value()
    v["bars"] = v["bars"][:count]
    v["captured_ms"] = v["bars"][-1]["available_ms"]
    return v


def delayed(v, delay):
    for b in v["bars"]:
        b["available_ms"] = b["close_ms"] + delay
    v["captured_ms"] += delay
    return v


def csv_bytes(v=None):
    v = value() if v is None else v
    return ("\n".join(",".join([str(b["open_ms"] // 1000), b["open"], b["high"],
                               b["low"], b["close"], "100", "2"])
                      for b in v["bars"]) + "\n").encode()


def gap(v, index):
    del v["bars"][index]
    return v


def unaligned(v):
    for b in v["bars"]:
        b["open_ms"] += HOUR // 2
        b["close_ms"] += HOUR // 2
        b["available_ms"] += HOUR // 2
    v["captured_ms"] += HOUR // 2
    return v

