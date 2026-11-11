"""Public pump.fun launch and graduation rows.

``frontend-api-v3.pump.fun`` answers HTTP 403 with a Cloudflare interstitial.
A browser User-Agent and ``Origin: https://pump.fun`` still receive that page.
``api.pump.fun`` answers ``401 API_KEY_REQUIRED`` and does not publish a coins
route. The replacement is GeckoTerminal's public new-pools feed, which labels
a bonding-curve pool as dex ``pump-fun`` and the graduation venue as dex
``pumpswap``. Numbers are the ones in the response. A missing number stays
missing. This module does not send an order.
"""
from __future__ import annotations

import io
import json
import urllib.error
import urllib.request

FRONTEND_URL = "https://frontend-api-v3.pump.fun/coins/currently-live?offset=0&limit=50&includeNsfw=false"
NEW_POOLS_URL = "https://api.geckoterminal.com/api/v2/networks/solana/new_pools?include=base_token"
DEX_BONDING = "pump-fun"
DEX_GRADUATION = "pumpswap"
SOURCE_BONDING = "pumpfun_bonding_curve"
SOURCE_GRADUATION = "pumpfun_graduation"
_DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 giant-brain-collector",
    "Accept": "application/json",
}
_MAX_DELAY_S = 8
_DEFAULT_DELAY_S = 2


def disabled_frontend_status() -> dict:
    """Status for the retired frontend list. ``ok`` stays false. No warning is implied."""
    return {
        "ok": False,
        "disabled": True,
        "records": 0,
        "reason": "CLOUDFLARE_CHALLENGE",
        "endpoint": FRONTEND_URL,
        "replacement": [SOURCE_BONDING, SOURCE_GRADUATION],
        "note": (
            "HTTP 403 is a Cloudflare interstitial. A browser User-Agent and "
            "Origin https://pump.fun do not pass it. api.pump.fun requires an "
            "API key (401 API_KEY_REQUIRED) and has no public coins route."
        ),
    }


def frontend_block_reason(status: int, body: bytes) -> str | None:
    """Classify a frontend denial. None when the response is not a 403 block."""
    if type(status) is not int or isinstance(status, bool) or status != 403:
        return None
    if type(body) is not bytes:
        return "HTTP_403"
    sample = body[:800].lower()
    if b"just a moment" in sample or b"cloudflare" in sample:
        return "CLOUDFLARE_CHALLENGE"
    return "HTTP_403"


def retry_delay_seconds(headers, *, default: int = _DEFAULT_DELAY_S, cap: int = _MAX_DELAY_S) -> int:
    """Seconds to wait after HTTP 429. ``Retry-After`` is used when it is in range."""
    raw = None
    if headers is not None and hasattr(headers, "get"):
        raw = headers.get("Retry-After")
    if type(raw) is str and raw.strip().isdigit():
        delay = int(raw.strip())
        if delay < 0:
            return default
        if delay > cap:
            return cap
        return delay
    return default


def new_pools_url(page: int = 1) -> str:
    if type(page) is not int or isinstance(page, bool) or not 1 <= page <= 10:
        raise ValueError("BAD_PAGE")
    if page == 1:
        return NEW_POOLS_URL
    return f"{NEW_POOLS_URL}&page={page}"


def _float(value):
    if value is None or isinstance(value, bool):
        return None
    if type(value) in (int, float):
        return float(value)
    if type(value) is str:
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _count(window, key):
    if type(window) is not dict:
        return None
    value = window.get(key)
    if isinstance(value, bool) or type(value) is not int:
        return None
    return value


def _http_error(url: str, status: int, body: bytes):
    phrase = "Too Many Requests" if status == 429 else "HTTP"
    return urllib.error.HTTPError(url, status, phrase, None, io.BytesIO(body))


def read_json(url: str, fetch, sleep, attempts: int = 2):
    """``fetch(url) -> (status, headers, body)``. One retry after HTTP 429."""
    if type(attempts) is not int or isinstance(attempts, bool) or attempts < 1:
        raise ValueError("BAD_ATTEMPTS")
    delay = 0
    status = 0
    body = b""
    for attempt in range(attempts):
        if delay:
            sleep(delay)
        status, headers, body = fetch(url)
        if status == 200:
            raw = body if type(body) is bytes else body.encode("utf-8") if type(body) is str else None
            if raw is None:
                raise ValueError("RESPONSE_SHAPE")
            return json.loads(raw)
        if status != 429 or attempt + 1 == attempts:
            payload = body if type(body) is bytes else b""
            raise _http_error(url, status if type(status) is int else 0, payload)
        delay = retry_delay_seconds(headers)
    raise _http_error(url, status if type(status) is int else 0, body if type(body) is bytes else b"")


def http_json(url: str, sleep, attempts: int = 2, timeout: int = 20, headers=None):
    """GET JSON with one 429 retry. Raises ``HTTPError`` on any other status."""
    sent = dict(_DEFAULT_HEADERS if headers is None else headers)

    def fetch(target):
        request = urllib.request.Request(target, headers=sent)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return getattr(response, "status", 200), response.headers, response.read()
        except urllib.error.HTTPError as error:
            payload = error.read()
            code = error.code
            response_headers = error.headers
            error.close()
            return code, response_headers, payload

    return read_json(url, fetch, sleep, attempts=attempts)


def parse_new_pools(payload, fetched_at: str) -> list[dict]:
    """Bonding-curve and graduation rows from one GeckoTerminal new-pools document."""
    if type(payload) is not dict or type(fetched_at) is not str:
        raise ValueError("RESPONSE_SHAPE")
    included = {}
    for item in payload.get("included") or []:
        if type(item) is not dict or type(item.get("id")) is not str:
            continue
        attributes = item.get("attributes")
        included[item["id"]] = attributes if type(attributes) is dict else {}
    rows = []
    for pool in payload.get("data") or []:
        if type(pool) is not dict:
            continue
        attributes = pool.get("attributes") if type(pool.get("attributes")) is dict else {}
        relationships = pool.get("relationships") if type(pool.get("relationships")) is dict else {}
        dex_rel = relationships.get("dex") if type(relationships.get("dex")) is dict else {}
        dex_data = dex_rel.get("data") if type(dex_rel.get("data")) is dict else {}
        dex = dex_data.get("id")
        if dex == DEX_BONDING:
            source = SOURCE_BONDING
            graduation = "BONDING_CURVE"
        elif dex == DEX_GRADUATION:
            source = SOURCE_GRADUATION
            graduation = "PUMPSWAP"
        else:
            continue
        base_rel = relationships.get("base_token") if type(relationships.get("base_token")) is dict else {}
        base = base_rel.get("data") if type(base_rel.get("data")) is dict else {}
        token_id = base.get("id")
        if type(token_id) is not str or "_" not in token_id:
            continue
        address = token_id.split("_", 1)[1]
        if not address:
            continue
        token = included.get(token_id, {})
        volume = attributes.get("volume_usd") if type(attributes.get("volume_usd")) is dict else {}
        change = attributes.get("price_change_percentage") if type(attributes.get("price_change_percentage")) is dict else {}
        trades = attributes.get("transactions") if type(attributes.get("transactions")) is dict else {}
        token_name = token.get("name") if type(token.get("name")) is str else None
        pool_name = attributes.get("name") if type(attributes.get("name")) is str else None
        rows.append({
            "source": source,
            "fetched_at": fetched_at,
            "chain": "solana",
            "token_address": address,
            "symbol": token.get("symbol") if type(token.get("symbol")) is str else None,
            "name": token_name or pool_name,
            "pair_address": attributes.get("address") if type(attributes.get("address")) is str else None,
            "dex": dex,
            "graduation": graduation,
            "price_usd": _float(attributes.get("base_token_price_usd")),
            "liquidity_usd": _float(attributes.get("reserve_in_usd")),
            "fdv": _float(attributes.get("fdv_usd")),
            "market_cap": _float(attributes.get("market_cap_usd")),
            "volume_m5": _float(volume.get("m5")),
            "volume_h1": _float(volume.get("h1")),
            "volume_h6": _float(volume.get("h6")),
            "volume_h24": _float(volume.get("h24")),
            "price_change_m5": _float(change.get("m5")),
            "price_change_h1": _float(change.get("h1")),
            "price_change_h6": _float(change.get("h6")),
            "price_change_h24": _float(change.get("h24")),
            "buys_m5": _count(trades.get("m5"), "buys"),
            "sells_m5": _count(trades.get("m5"), "sells"),
            "buys_h1": _count(trades.get("h1"), "buys"),
            "sells_h1": _count(trades.get("h1"), "sells"),
            "buys_h24": _count(trades.get("h24"), "buys"),
            "sells_h24": _count(trades.get("h24"), "sells"),
            "pool_created_at": attributes.get("pool_created_at") if type(attributes.get("pool_created_at")) is str else None,
        })
    return rows


def apply_pump_sources(saved_page, get, sleep, fetched_at: str) -> dict:
    """Build collector rows from the page already fetched, plus new-pools page 2.

    ``get`` returns a parsed document or raises. The frontend URL is not requested.
    """
    status = {"pumpfun_currently_live": disabled_frontend_status()}
    pages = []
    errors = []
    if saved_page is not None:
        pages.append(saved_page)
    if sleep is not None:
        sleep(2)
    try:
        pages.append(get(new_pools_url(2)))
    except Exception as error:
        errors.append(repr(error))
    rows = []
    seen = set()
    for page in pages:
        try:
            parsed = parse_new_pools(page, fetched_at)
        except ValueError as error:
            errors.append(repr(error))
            continue
        for row in parsed:
            key = (row["source"], row.get("token_address"), row.get("pair_address"))
            if key in seen:
                continue
            seen.add(key)
            rows.append(row)
    counts = {}
    for row in rows:
        counts[row["source"]] = counts.get(row["source"], 0) + 1
    have_page = any(type(page) is dict for page in pages)
    for source in (SOURCE_BONDING, SOURCE_GRADUATION):
        entry = {"ok": have_page, "records": counts.get(source, 0)}
        if errors:
            entry["error"] = errors[0]
            if not have_page:
                entry["ok"] = False
        status[source] = entry
    return {"rows": rows, "status": status, "errors": errors}
