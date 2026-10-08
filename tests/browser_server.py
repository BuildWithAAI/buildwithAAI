"""Offline UI QA server: explicitly synthetic; never used by production CLI."""
import tempfile
from pathlib import Path
from waitress import serve
from src.aai_scanner.config import Config
from src.aai_scanner.service import Scanner
from src.aai_scanner.storage import Store
from src.aai_scanner.web import Application
from tests.scanner_fixtures import FakeMarket, FakeRPC

with tempfile.TemporaryDirectory() as directory:
    config = Config(database=str(Path(directory) / 'ui.sqlite3'))
    store = Store(config.database)
    market = FakeMarket()
    market.name = 'SYNTHETIC TEST <img src=x onerror=alert(1)>'
    scanner = Scanner(config, store, rpc=FakeRPC(), market=market)
    serve(Application(config, store, scanner), host='127.0.0.1', port=8787)
