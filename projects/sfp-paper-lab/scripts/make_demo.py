"""Engineered winning, losing, ambiguous and unfinished-position acceptance cases."""

import datetime
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from zoora_sfp.data import HOUR, D, canonical, decimal_text  # noqa: E402


def demo_value():
    start = int(datetime.datetime(2026, 9, 1, tzinfo=datetime.UTC).timestamp()) * 1000
    bars = []
    overrides = {
        240: ("103", "103.4", "99", "103"),
        241: ("103", "105", "102", "104"),
        242: ("104", "116", "103", "114"),
        243: ("114", "115", "108", "109"),
        244: ("109", "110", "104", "106"),
        245: ("106", "107", "103", "104"),
        280: ("104", "105", "98", "104"),
        281: ("104", "105", "101", "104"),
        282: ("104", "105", "96", "97"),
        320: ("104", "104.2", "100", "104"),
        321: ("104", "120", "95", "110"),
        360: ("105", "106", "100", "105"),
        361: ("105", "106", "104", "105")}
    for i in range(380):
        price = D(100) + D(i) / D(100) + D(abs(i % 12 - 6)) * D("0.03")
        o, h, low, c = overrides.get(i, tuple(decimal_text(x) for x in
                                            [price, price + 1, price - 1, price]))
        bars.append({"open_ms": start + i * HOUR, "close_ms": start + (i + 1) * HOUR,
                     "available_ms": start + (i + 1) * HOUR,
                     "open": o, "high": h, "low": low, "close": c})
    source = {"fixture": "ENGINE_ACCEPTANCE_NOT_STRATEGY_OPTIMIZATION",
              "builder": "BT005_DEMO_V1", "bars": bars}
    return {"protocol": "ZOORA_SFP_DATASET_V1",
            "market": {"base": "SOL", "quote": "USDC", "venue": "SYNTHETIC",
                       "source_id": "BT005-engine-acceptance"},
            "classification": "SYNTHETIC", "availability": "SYNTHETIC_RECONSTRUCTION",
            "source_sha256": hashlib.sha256(canonical(source)).hexdigest(),
            "captured_ms": bars[-1]["available_ms"],
            "purpose": "ENGINE_ACCEPTANCE_NOT_STRATEGY_EVIDENCE", "bars": bars}


def main():
    value = demo_value()
    path = ROOT / "fixtures" / "demo.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(canonical(value) + b"\n")
    print(json.dumps({"fixture": str(path.relative_to(ROOT)), "bars": len(value["bars"]),
                      "classification": value["classification"]}))


if __name__ == "__main__":
    main()
