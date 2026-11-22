"""Recent trades for one Solana pool from the public GeckoTerminal trades route.

``GET /api/v2/networks/solana/pools/{pool}/trades`` needs no key. A 429 waits
once, using ``Retry-After`` when that value is from 0 through 8 seconds and 2
seconds otherwise, then the same URL is requested again. Redirects are
refused. Counts and volumes come from fields the body actually contains. A
missing field stays missing. Nothing here sends an order.
"""
from __future__ import annotations

import hashlib
import json
import time
import urllib.error
import urllib.request
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .pump_public import retry_delay_seconds
from .snapshot_feed import SnapshotError

HOST = "api.geckoterminal.com"
LARGE_SELL_SHARE_PPM = 500_000
_BODY_LIMIT = 2_000_000
_B58 = set("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")
_KINDS = frozenset({"buy", "sell"})


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise SnapshotError("REFUSED")


def _address(value) -> bool:
    return type(value) is str and 32 <= len(value) <= 44 and all(character in _B58 for character in value)


def trades_url(pool: str) -> str:
    if not _address(pool):
        raise SnapshotError("BAD_POOL")
    return f"https://{HOST}/api/v2/networks/solana/pools/{pool}/trades"


def trades_url_ok(url, pool=None) -> bool:
    """True only for the exact public trades URL. A query string is refused."""
    if type(url) is not str:
        return False
    parts = urlsplit(url)
    if parts.scheme != "https" or parts.hostname != HOST or parts.username or parts.password or parts.query or parts.fragment:
        return False
    prefix = "/api/v2/networks/solana/pools/"
    suffix = "/trades"
    if not parts.path.startswith(prefix) or not parts.path.endswith(suffix):
        return False
    address = parts.path[len(prefix):-len(suffix)]
    if not _address(address) or "/" in address:
        return False
    if pool is not None and address != pool:
        return False
    return True


def _decimal(value):
    if isinstance(value, bool) or value is None:
        return None
    if type(value) not in (int, float, str):
        return None
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    if not number.is_finite() or number < 0:
        return None
    return number


def _text(number: Decimal) -> str:
    return format(number, "f")


def _share_ppm(part: Decimal, whole: Decimal):
    if whole <= 0:
        return None
    scaled = (part * Decimal(1_000_000) / whole).to_integral_value(rounding=ROUND_HALF_UP)
    return int(scaled)


def _one(row):
    if type(row) is not dict or row.get("type") != "trade":
        return None
    attributes = row.get("attributes")
    if type(attributes) is not dict:
        return None
    kind = attributes.get("kind")
    kind_present = "kind" in attributes
    if kind not in _KINDS:
        kind = None
    trader = attributes.get("tx_from_address")
    if type(trader) is not str or not trader:
        trader = None
    stamp = attributes.get("block_timestamp")
    if type(stamp) is not str or "T" not in stamp:
        stamp = None
    anomalous = attributes.get("is_anomalous") if type(attributes.get("is_anomalous")) is bool else None
    return {
        "kind": kind,
        "kind_present": kind_present,
        "volume_usd": _decimal(attributes.get("volume_in_usd")) if "volume_in_usd" in attributes else None,
        "volume_present": "volume_in_usd" in attributes,
        "trader": trader,
        "trader_present": "tx_from_address" in attributes,
        "block_timestamp": stamp,
        "anomalous": anomalous,
        "anomalous_present": "is_anomalous" in attributes,
    }


def parse_trades(payload) -> tuple[list[dict], int]:
    """Trades in response order. A row that is not a trade object is skipped."""
    if type(payload) is not dict:
        raise SnapshotError("RESPONSE_SHAPE")
    rows = payload.get("data")
    if type(rows) is not list:
        raise SnapshotError("RESPONSE_SHAPE")
    trades = []
    skipped = 0
    for row in rows:
        parsed = _one(row)
        if parsed is None:
            skipped += 1
            continue
        trades.append(parsed)
    return trades, skipped


def flow_features(trades: list[dict]) -> dict:
    """Buy and sell counts, USD volume, unique traders, and the large-sell share.

    The large sell is the single sell with the greatest ``volume_in_usd``.
    Its share is that volume divided by the sum of ``volume_in_usd`` on the
    page, in parts per million. The veto line is 500000 ppm, the same half
    share the holder rule already uses. It is a rule constant, not a number
    fit on closed trades. A field that never appears is null.
    """
    if type(trades) is not list:
        raise SnapshotError("RESPONSE_SHAPE")
    saw_kind = False
    saw_volume = False
    saw_trader = False
    saw_anomalous = False
    buy_count = 0
    sell_count = 0
    buy_volume = Decimal(0)
    sell_volume = Decimal(0)
    largest_sell = None
    volume_missing = 0
    traders = set()
    anomalous_count = 0
    stamps = []
    for trade in trades:
        if type(trade) is not dict:
            raise SnapshotError("RESPONSE_SHAPE")
        if trade.get("kind_present") is True:
            saw_kind = True
        kind = trade.get("kind")
        if kind == "buy":
            buy_count += 1
        elif kind == "sell":
            sell_count += 1
        volume = trade.get("volume_usd")
        if trade.get("volume_present") is True:
            if volume is None:
                volume_missing += 1
            else:
                saw_volume = True
                if kind == "buy":
                    buy_volume += volume
                elif kind == "sell":
                    sell_volume += volume
                    if largest_sell is None or volume > largest_sell:
                        largest_sell = volume
        if trade.get("trader_present") is True and type(trade.get("trader")) is str:
            saw_trader = True
            traders.add(trade["trader"])
        if trade.get("anomalous_present") is True:
            saw_anomalous = True
            if trade.get("anomalous") is True:
                anomalous_count += 1
        stamp = trade.get("block_timestamp")
        if type(stamp) is str:
            stamps.append(stamp)
    total = buy_volume + sell_volume if saw_volume else None
    if not trades:
        buy_out = 0
        sell_out = 0
    elif saw_kind:
        buy_out = buy_count
        sell_out = sell_count
    else:
        buy_out = None
        sell_out = None
    features = {
        "trade_count": len(trades),
        "buy_count": buy_out,
        "sell_count": sell_out,
        "buy_volume_usd": _text(buy_volume) if saw_volume else None,
        "sell_volume_usd": _text(sell_volume) if saw_volume else None,
        "unique_trader_count": len(traders) if saw_trader else None,
        "largest_sell_usd": _text(largest_sell) if largest_sell is not None else None,
        "large_sell_share_ppm": None,
        "sell_volume_share_ppm": None,
        "anomalous_count": anomalous_count if saw_anomalous else None,
        "volume_missing": volume_missing,
        "window_start": min(stamps) if stamps else None,
        "window_end": max(stamps) if stamps else None,
        "rule_large_sell_share_ppm": LARGE_SELL_SHARE_PPM,
    }
    if total is not None and total > 0:
        features["sell_volume_share_ppm"] = _share_ppm(sell_volume, total)
        features["large_sell_share_ppm"] = _share_ppm(largest_sell or Decimal(0), total)
    return features


def _miss(url: str, reason: str, **extra) -> dict:
    body = {
        "status": "NOT_OBSERVED",
        "reason": reason,
        "url": url,
        "features": None,
        "trade_count": None,
        "rows_skipped": None,
        "body_sha256": None,
        "retries": extra.pop("retries", 0),
        "action": "NO_EXECUTION",
        "execution_allowed": False,
        "live_orders": False,
    }
    body.update(extra)
    return body


def _http_get(url: str) -> tuple[int, object, bytes]:
    if not trades_url_ok(url):
        raise SnapshotError("REFUSED")
    request = Request(url, headers={"Accept": "application/json", "User-Agent": "BuildWithAAI-giant-brain/1"}, method="GET")
    try:
        with build_opener(_NoRedirect()).open(request, timeout=20) as response:
            raw = response.read(_BODY_LIMIT + 1)
            status = getattr(response, "status", 200)
            headers = response.headers
    except urllib.error.HTTPError as error:
        raw = error.read(_BODY_LIMIT + 1)
        headers = error.headers
        status = error.code
        error.close()
        if len(raw) > _BODY_LIMIT:
            raise SnapshotError("RESPONSE_TOO_LARGE")
        return status, headers, raw
    if len(raw) > _BODY_LIMIT:
        raise SnapshotError("RESPONSE_TOO_LARGE")
    return status, headers, raw


def fetch_trades(pool: str, *, transport=None, sleep=time.sleep) -> dict:
    """Read one trades page. ``transport(url) -> (status, headers, body)`` skips the network."""
    url = trades_url(pool)
    delay = 0
    status = 0
    headers = None
    raw = b""
    for attempt in range(2):
        if delay:
            sleep(delay)
        try:
            if transport is None:
                status, headers, raw = _http_get(url)
            else:
                got = transport(url)
                if type(got) is not tuple or len(got) != 3:
                    return _miss(url, "RESPONSE_SHAPE")
                status, headers, raw = got
        except SnapshotError as error:
            reason = str(error) if str(error) in {"REFUSED", "RESPONSE_TOO_LARGE"} else "HTTP_UNREACHABLE"
            return _miss(url, reason)
        except urllib.error.URLError:
            return _miss(url, "HTTP_UNREACHABLE")
        except TimeoutError:
            return _miss(url, "HTTP_TIMEOUT")
        if status == 200:
            break
        waited = retry_delay_seconds(headers)
        if status != 429 or attempt == 1:
            return _miss(
                url,
                "RATE_LIMITED" if status == 429 else "HTTP_STATUS",
                http_status=status if type(status) is int and not isinstance(status, bool) else None,
                retry_after_seconds=waited if status == 429 else None,
                retries=1 if delay else 0,
            )
        delay = waited
    if type(raw) is not bytes:
        return _miss(url, "RESPONSE_SHAPE", http_status=200, retries=1 if delay else 0)
    try:
        payload = json.loads(raw)
        trades, skipped = parse_trades(payload)
    except (SnapshotError, json.JSONDecodeError, UnicodeDecodeError):
        return _miss(url, "RESPONSE_SHAPE", http_status=200, retries=1 if delay else 0)
    features = flow_features(trades)
    return {
        "status": "AVAILABLE",
        "reason": None,
        "url": url,
        "http_status": 200,
        "features": features,
        "trade_count": features["trade_count"],
        "rows_skipped": skipped,
        "body_sha256": hashlib.sha256(raw).hexdigest(),
        "retries": 1 if delay else 0,
        "action": "NO_EXECUTION",
        "execution_allowed": False,
        "live_orders": False,
    }
