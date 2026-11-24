"""AAI Forex research & paper-trading pipeline.

Paper / simulated execution only. No code path in this package places a real
order unless the MT5 adapter is constructed with an explicit live confirmation
on a Windows machine running MetaTrader 5 (see execution/mt5_adapter.py).
"""

__version__ = "0.1.0"
