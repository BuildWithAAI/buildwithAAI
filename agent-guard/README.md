# agent-guard

agent-guard is a stdlib-only safety layer shared by all trading and research agents on this box. The rules are in SECURITY_POLICY.md.

```
bin/killswitch on --reason "..." | off --confirm RESUME | status
bin/agent-guard audit verify|tail ; check-text "..." ; config-check ; approve ...
python3 audit.py                      # rerunnable audit, redacted, writes reports/
.venv/bin/python -m pytest -q         # 44 tests
```

```python
import sys; sys.path.insert(0, "/workspace/agent-guard")
from agent_guard import OrderIntent, check_order, money_movement, wrap_untrusted, require_clean, killswitch
check_order(OrderIntent(agent="perps", venue="bybit", symbol="BTCUSDT", side="buy", notional_usd=200,
                        equity_usd=1000, leverage=2, entry=67000, stop=66000))   # raises on any violation
```

* `patches/APPLIED-integrations.patch` is exactly what was changed in the agent repos. The originals are in `backups/20261103T0640/`.
* `patches/PROPOSED-*.patch` are injection gates that have not been applied yet. Each one was dry-run against a copy of its repo and its tests pass.
  To apply one, run `cd /workspace && patch -p1 < agent-guard/patches/<file>`.
* `patches/LIVE_ADAPTER_TEMPLATE.py` is the required shape for any future live exchange or wallet adapter.
