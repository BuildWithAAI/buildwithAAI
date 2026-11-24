"""Phase-1 safety contract: no order placement, no private endpoints, no credentials."""

import re
from pathlib import Path

import pytest
from pydantic import ValidationError

from perps.config import ExecutionCfg

SRC = Path(__file__).resolve().parents[1] / "src" / "perps"
FORBIDDEN = [
    r"/api/v1/trade", r"/api/v1/account", r"/api/v1/asset", r"/api/v1/user",      # Blofin private
    r"/v5/order", r"/v5/position", r"/v5/account", r"/v5/asset", r"/v5/user",     # Bybit private
    r"ACCESS-SIGN", r"ACCESS-KEY", r"ACCESS-PASSPHRASE", r"X-BAPI-SIGN", r"X-BAPI-API-KEY",
    r"\bhmac\b", r"api_secret", r"secret_key", r"\.post\(", r"\.put\(", r"\.delete\(",
]


def test_no_private_or_order_code_paths():
    hits = []
    for f in SRC.rglob("*.py"):
        text = f.read_text()
        for pat in FORBIDDEN:
            if re.search(pat, text, flags=re.IGNORECASE):
                hits.append(f"{f.relative_to(SRC)}: {pat}")
    assert not hits, hits


def test_execution_cannot_be_enabled_in_phase1():
    with pytest.raises(ValidationError):
        ExecutionCfg(enabled=True)


def test_http_client_is_get_only():
    from perps.data.http import PublicHttpClient

    public = [m for m in dir(PublicHttpClient) if not m.startswith("_")]
    assert public == ["get"]
