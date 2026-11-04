"""Market readout on frozen FlyVis flash responses.

Price, flow, and liquidity become a causal luminance trace. That trace is
projected onto the published FV-REF-001 central-cell flash responses. This is
not a new forward pass of the 45,669-neuron network. A logistic readout is fit
only on earlier decisions and scored on later ones.

Paper only. A weak out-of-sample result stays a weak result.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

from .flyvis_smoke import read_activity

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / "experiments/flyvis_trained_reference/evidence/local-completed-2"
ARTIFACT = ROOT / "research/giant-brain/flyvis_market_readout.json"
STIMULUS = "MOVING_LUMINANCE_V1"
ACTIVITY_SOURCE = "FROZEN_FV_REF_001_FLASH_KERNEL_PROJECTION"
FLASH_START, FLASH_END = 200, 401
_KERNELS = None


class ReadoutError(ValueError):
    pass


def _clip(value: float) -> float:
    return max(-1.0, min(1.0, value))


def _finite(value):
    if type(value) is bool or type(value) not in (int, float):
        return None
    number = float(value)
    if not math.isfinite(number):
        return None
    return number


def stimulus_from_history(history: list[dict]) -> list[float]:
    """Luminance from a causal window. Later rows must not be included by the caller."""
    if type(history) is not list or len(history) < 2:
        raise ReadoutError("NEED_HISTORY")
    trace = []
    for index in range(1, len(history)):
        previous, current = history[index - 1], history[index]
        old = _finite(previous.get("price_usd", previous.get("last_trade_price")))
        new = _finite(current.get("price_usd", current.get("last_trade_price")))
        if old is None or new is None or old <= 0 or new <= 0:
            raise ReadoutError("NO_PRICE")
        parts = [_clip((new - old) / old)]
        weights = [0.5]
        buys, sells = _finite(current.get("buys_h1")), _finite(current.get("sells_h1"))
        if buys is not None and sells is not None and buys >= 0 and sells >= 0 and buys + sells > 0:
            parts.append(_clip((buys - sells) / (buys + sells)))
            weights.append(0.3)
        old_liq = _finite(previous.get("liquidity_usd"))
        new_liq = _finite(current.get("liquidity_usd"))
        if old_liq is not None and new_liq is not None and old_liq > 0 and new_liq >= 0:
            parts.append(_clip((new_liq - old_liq) / old_liq))
            weights.append(0.2)
        trace.append(_clip(sum(weight * part for weight, part in zip(weights, parts)) / sum(weights)))
    return trace


def _resample(values: list[float], width: int) -> list[float]:
    if width < 1:
        raise ReadoutError("STIMULUS_WIDTH")
    out = []
    for index in range(width):
        start = int(index * len(values) / width)
        end = max(start + 1, int((index + 1) * len(values) / width))
        chunk = values[start:end]
        out.append(sum(chunk) / len(chunk))
    return out


def frozen_kernels() -> tuple[list[str], list[list[float]]]:
    """Mean flash-window response for each non-photoreceptor cell type."""
    global _KERNELS
    if _KERNELS is not None:
        return _KERNELS
    activity = (EVIDENCE / "run-1.npy").read_bytes()
    cells = json.loads((EVIDENCE / "cells.json").read_text(encoding="utf-8"))
    shape, values = read_activity(activity, shape_prefix=(4, 600), max_width=65, max_elements=200_000)
    labels = [label for label in cells["labels"] if label not in {f"R{i}" for i in range(1, 9)}]
    label_index = {label: index for index, label in enumerate(cells["labels"])}
    kernels = []
    frames = list(range(FLASH_START, min(FLASH_END, shape[1])))
    for label in labels:
        cell = label_index[label]
        samples = []
        for frame in frames:
            samples.append(sum(values[((cond * shape[1]) + frame) * shape[2] + cell] for cond in range(shape[0])) / shape[0])
        kernels.append(samples)
    _KERNELS = (labels, kernels)
    return _KERNELS


def project(trace: list[float], kernels: list[list[float]] | None = None) -> list[float]:
    labels_kernels = kernels if kernels is not None else frozen_kernels()[1]
    width = len(trace)
    scale = math.sqrt(sum(item * item for item in trace)) or 1.0
    activity = []
    for kernel in labels_kernels:
        sampled = _resample(kernel, width)
        kernel_scale = math.sqrt(sum(item * item for item in sampled)) or 1.0
        activity.append(sum(left * right for left, right in zip(trace, sampled)) / (scale * kernel_scale))
    return activity


def _sigmoid(value: float) -> float:
    value = max(-20.0, min(20.0, value))
    return 1.0 / (1.0 + math.exp(-value))


def _split(rows: list[dict]) -> tuple[list[dict], list[dict]]:
    ordered = sorted(rows, key=lambda row: (row["ts"], row["mint"]))
    times = sorted({row["ts"] for row in ordered})
    if len(times) < 2 or len(ordered) < 4:
        raise ReadoutError("NEED_CAUSAL_SPLIT")
    cut = times[max(1, int(len(times) * 0.6)) - 1]
    # The cut timestamp stays in train. Later timestamps are the untouched test.
    train = [row for row in ordered if row["ts"] <= cut]
    test = [row for row in ordered if row["ts"] > cut]
    if not train or not test:
        raise ReadoutError("NEED_CAUSAL_SPLIT")
    return train, test


def fit_weights(train: list[dict], *, steps: int = 40) -> tuple[list[float], float]:
    width = len(train[0]["activity"])
    weights = [0.0] * width
    bias = 0.0
    rate = 0.2
    penalty = 0.01
    count = len(train)
    for _ in range(steps):
        grad_b = 0.0
        grad_w = [0.0] * width
        for row in train:
            score = bias + sum(weight * value for weight, value in zip(weights, row["activity"]))
            error = _sigmoid(score) - row["label"]
            grad_b += error
            for index, value in enumerate(row["activity"]):
                grad_w[index] += error * value
        bias -= rate * grad_b / count
        for index in range(width):
            weights[index] -= rate * (grad_w[index] / count + penalty * weights[index])
    return weights, bias


def predict_ppm(activity: list[float], weights: list[float], bias: float) -> int:
    score = bias + sum(weight * value for weight, value in zip(weights, activity))
    return max(0, min(1_000_000, int(round(_sigmoid(score) * 1_000_000))))


def _metrics(rows: list[dict], weights: list[float], bias: float) -> dict:
    if not rows:
        return {"n": 0, "accuracy": None, "log_loss": None, "base_rate": None}
    correct = 0
    loss = 0.0
    positives = 0
    for row in rows:
        ppm = predict_ppm(row["activity"], weights, bias)
        probability = min(1 - 1e-6, max(1e-6, ppm / 1_000_000))
        label = row["label"]
        positives += label
        chosen = 1 if ppm >= 500_000 else 0
        correct += chosen == label
        loss += -(label * math.log(probability) + (1 - label) * math.log(1 - probability))
    count = len(rows)
    return {
        "n": count,
        "accuracy": correct / count,
        "log_loss": loss / count,
        "base_rate": positives / count,
    }


def decisions_from_series(series: dict[str, list[dict]]) -> list[dict]:
    """One decision per token step. Features stop at that step. The label is the next price."""
    rows = []
    kernels = frozen_kernels()[1]
    for mint, history in series.items():
        ordered = sorted(history, key=lambda item: item["ts"])
        for index in range(1, len(ordered) - 1):
            window = ordered[: index + 1]
            try:
                trace = stimulus_from_history(window)
            except ReadoutError:
                continue
            current = ordered[index]["price_usd"]
            nxt = ordered[index + 1]["price_usd"]
            if current <= 0 or nxt <= 0:
                continue
            rows.append({
                "mint": mint,
                "ts": ordered[index]["ts"],
                "label": 1 if nxt > current else 0,
                "activity": project(trace, kernels),
                "trace": trace,
            })
    return rows


def fit_readout(series: dict[str, list[dict]]) -> dict:
    rows = decisions_from_series(series)
    train, test = _split(rows)
    weights, bias = fit_weights(train)
    labels, _kernels = frozen_kernels()
    report = {
        "protocol": "AAI_FLYVIS_MARKET_READOUT_V1",
        "stimulus": STIMULUS,
        "activity_source": ACTIVITY_SOURCE,
        "network_forward_pass": False,
        "cell_labels": labels,
        "weights": [round(weight, 8) for weight in weights],
        "bias": round(bias, 8),
        "train": _metrics(train, weights, bias),
        "test": {
            **_metrics(test, weights, bias),
            "majority_class_accuracy": None if not test else max(
                sum(row["label"] for row in test) / len(test),
                1 - sum(row["label"] for row in test) / len(test),
            ),
        },
        "train_end_ts": max(row["ts"] for row in train),
        "test_start_ts": min(row["ts"] for row in test),
        "market_validation_established": False,
        "execution_allowed": False,
        "action": "NO_EXECUTION",
    }
    report["test"]["beats_majority_class"] = report["test"]["accuracy"] > report["test"]["majority_class_accuracy"]
    identity = {key: report[key] for key in ("stimulus", "activity_source", "cell_labels", "weights", "bias", "test")}
    report["readout_sha256"] = hashlib.sha256(
        json.dumps(identity, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    return report


def series_from_snapshot_root(root: Path) -> dict[str, list[dict]]:
    from .snapshot_feed import canonical_pairs, load_snapshot, parse_time_ms, resolve_root, snapshot_files

    root = resolve_root(root)
    series: dict[str, list[dict]] = {}
    for relative in snapshot_files(root):
        for row in canonical_pairs(load_snapshot(root, relative)).values():
            price = _finite(row.get("price_usd"))
            stamp = row.get("ts") or row.get("fetched_at")
            if price is None or price <= 0 or type(stamp) is not str:
                continue
            point = {
                "ts": stamp,
                "ts_ms": parse_time_ms(stamp),
                "price_usd": price,
                "buys_h1": row.get("buys_h1"),
                "sells_h1": row.get("sells_h1"),
                "liquidity_usd": row.get("liquidity_usd"),
                "pair_address": row.get("pair_address"),
                "dex": row.get("dex"),
                "symbol": row.get("symbol"),
            }
            fee = row.get("fee_bps")
            if type(fee) is int and not isinstance(fee, bool) and 0 <= fee <= 10_000:
                point["fee_bps"] = fee
            series.setdefault(row["token_address"], []).append(point)
    for points in series.values():
        points.sort(key=lambda item: item["ts_ms"])
    return series


def load_artifact(path: Path | None = None) -> dict | None:
    chosen = ARTIFACT if path is None else path
    if not chosen.is_file():
        return None
    data = json.loads(chosen.read_text(encoding="utf-8"))
    if data.get("protocol") != "AAI_FLYVIS_MARKET_READOUT_V1" or data.get("network_forward_pass") is not False:
        raise ReadoutError("READOUT_PROTOCOL")
    return data


def score_history(history: list[dict], readout: dict | None = None) -> dict:
    artifact = load_artifact() if readout is None else readout
    base = {
        "activity_source": ACTIVITY_SOURCE,
        "network_forward_pass": False,
        "stimulus": STIMULUS,
        "paper_long_support_ppm": None,
        "uncertainty_ppm": None,
        "abstain_reason": "MISSING_DATA",
        "action": "NO_EXECUTION",
        "execution_allowed": False,
    }
    if artifact is None:
        base["abstain_reason"] = "READOUT_NOT_FIT"
        base["detail"] = "READOUT_NOT_FIT"
        return base
    try:
        trace = stimulus_from_history(history)
        activity = project(trace)
    except (ReadoutError, OSError, ValueError):
        base["detail"] = "STIMULUS_UNAVAILABLE"
        return base
    if len(activity) != len(artifact["weights"]):
        base["abstain_reason"] = "MODULE_FAILED"
        base["detail"] = "ACTIVITY_WIDTH"
        return base
    ppm = predict_ppm(activity, artifact["weights"], artifact["bias"])
    return {
        **base,
        "paper_long_support_ppm": ppm,
        "prediction_ppm": ppm,
        "uncertainty_ppm": int(abs(ppm - 500_000)),
        "abstain_reason": None,
        "detail": "FLASH_KERNEL_READOUT",
        "readout_sha256": artifact.get("readout_sha256"),
        "encoder_sha256": hashlib.sha256(STIMULUS.encode()).hexdigest(),
        "oos_test": artifact.get("test"),
    }
