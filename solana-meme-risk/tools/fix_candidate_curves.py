"""One-off: recompute candidates.curve with the Mayhem-agent-aware curve_from_create (cached txs)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from smr.context import default_context
from smr.backtest.store import Store
from smr import chain

ctx = default_context(); st = Store(sys.argv[1] if len(sys.argv) > 1 else "data/backtest/work/backtest.db")
rows = st.q("SELECT create_sig, mint, curve FROM candidates WHERE mint IS NOT NULL")
ch = 0
for sig, mint, curve in rows:
    tx = ctx.rpc.get_transaction(sig)
    c = chain.curve_from_create(tx, mint) if tx else None
    if c and c != curve:
        st.x("UPDATE candidates SET curve=? WHERE create_sig=?", (c, sig)); ch += 1
print("candidates", len(rows), "curve changed", ch)
