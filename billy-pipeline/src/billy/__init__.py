"""billy-pipeline: @cryptoWZRD_ outlook -> signal -> backtest -> PAPER signals.

Safety: this package contains NO code path that can place an order on a real
exchange. See billy.execution.live_stub.
"""

__version__ = "0.1.0"
ASSETS: tuple[str, ...] = ("BTC", "ETH", "XRP", "LTC", "LINK")
