"""Longer generated acceptance history, never historical or optimization evidence."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.make_demo import demo_value  # noqa: E402
from zoora_sfp.data import HOUR, D, canonical, decimal_text, digest  # noqa: E402


def study_demo():
    original = demo_value()
    begin = original["bars"][0]["open_ms"] - 31 * 24 * HOUR
    overrides = [240, 241, 242, 243, 244, 245, 280, 281, 282, 320, 321, 360, 361]
    bars = []
    for i in range(1216):
        price = D(100) + D(i) / D(100) + D(abs(i % 12 - 6)) * D("0.03")
        values = [price, price + 1, price - 1, price]
        if i % 400 in overrides:
            old = original["bars"][i % 400]
            values = [D(old[k]) + D(i // 400) * 4 for k in ["open", "high", "low", "close"]]
        bars.append(dict(zip(["open", "high", "low", "close"], map(decimal_text, values), strict=True),
                         open_ms=begin + i * HOUR, close_ms=begin + (i + 1) * HOUR,
                         available_ms=begin + (i + 1) * HOUR))
    value = dict(original, bars=bars, captured_ms=bars[-1]["close_ms"],
                 source_sha256=digest({"builder": "BT006_ENGINE_ACCEPTANCE_V1", "bars": bars}))
    value["market"] = dict(original["market"], source_id="BT006-engine-acceptance")
    return value


if __name__ == "__main__":
    path = ROOT / "fixtures/study-demo.json"
    value = study_demo()
    path.write_bytes(canonical(value) + b"\n")
    print(json.dumps({"fixture": str(path.relative_to(ROOT)), "bars": len(value["bars"]),
                      "classification": "SYNTHETIC"}))
