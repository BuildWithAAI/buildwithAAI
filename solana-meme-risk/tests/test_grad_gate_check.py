import json

from tools.grad_gate_check import main, pool_rows


def test_pool_filters_and_gates(tmp_path):
    rows = [
        {"mint": "Apump", "fdv_usd_seen": 40000, "reserve_usd_seen": 8000, "ratio_24h": 0.1, "max_x": 1.2},   # liq/mc 0.2, bad
        {"mint": "Bpump", "fdv_usd_seen": 60000, "reserve_usd_seen": 30000, "ratio_last": 2.0, "max_x": 3},    # 22.6x, good
        {"mint": "Cxxxx", "fdv_usd_seen": 90000, "reserve_usd_seen": 30000, "ratio_24h": 0.1},                 # no pump suffix
        {"mint": "Dpump", "fdv_usd_seen": 20000, "reserve_usd_seen": 30000, "ratio_24h": 0.1},                 # under $30k
        {"mint": "Epump", "fdv_usd_seen": 50000, "reserve_usd_seen": 0.0001, "ratio_24h": 0.1},                # no reserve
        {"mint": "Fpump", "fdv_usd_seen": 50000, "reserve_usd_seen": 20000, "unlabelable": True},              # no outcome
    ]
    pool = pool_rows(rows)
    assert [x["mint"] for x in pool] == ["Apump", "Bpump"]
    p = tmp_path / "l.jsonl"
    p.write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    rep = main(str(p))
    assert rep["pool"] == 2 and rep["bad"] == 1
    assert rep["by_source"] == {"24h": 1, "last_trade": 1}
    g = rep["gates"]["liq_mcap_lt_0.3"]
    assert g["flagged"]["bad"] == 1 and g["passed"]["good"] == 1 and g["passed"]["hit_2x"] == 1
    assert rep["gates"]["entry_ge_20x"]["flagged"]["n"] == 1
