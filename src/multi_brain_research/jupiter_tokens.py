"""Public Jupiter token search for one or more Solana mints.

``GET https://lite-api.jup.ag/tokens/v2/search?query={mint}`` needs no key.
A comma-separated query returns several mints in one response. On 2026-11-05
that host answered HTTP 200 with no ``Authorization`` header. The fields kept
here are the ones present on that response: organic score, holder count, mint
and freeze authority flags, top-holder percentage, and the 5-minute and
1-hour buy, sell, and trader counters. A missing key stays null. A 429 waits
once, using ``Retry-After`` when that value is from 0 through 8 seconds and 2
seconds otherwise, then the same URL is requested again. Redirects are
refused. Nothing here sends an order.
"""
from __future__ import annotations

import hashlib
import json
import math
import time
import urllib.error
import urllib.request
from urllib.parse import parse_qsl, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .pump_public import retry_delay_seconds
from .snapshot_feed import SnapshotError

HOST = "lite-api.jup.ag"
PATH = "/tokens/v2/search"
BATCH_LIMIT = 40
TOP_HOLDERS_PERCENT = 50
_BODY_LIMIT = 2_000_000
_B58 = set("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")
_STAT_KEYS = (
    "buyVolume",
    "sellVolume",
    "buyOrganicVolume",
    "sellOrganicVolume",
    "numBuys",
    "numSells",
    "numTraders",
    "numOrganicBuyers",
    "numNetBuyers",
)
_COUNT_KEYS = frozenset({"numBuys", "numSells", "numTraders", "numOrganicBuyers", "numNetBuyers", "holderCount"})


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise SnapshotError("REFUSED")


def _address(value) -> bool:
    return type(value) is str and 32 <= len(value) <= 44 and all(character in _B58 for character in value)


def search_url(mints: list[str]) -> str:
    if type(mints) is not list or not 1 <= len(mints) <= BATCH_LIMIT:
        raise SnapshotError("BAD_MINT")
    if any(not _address(mint) for mint in mints) or len(set(mints)) != len(mints):
        raise SnapshotError("BAD_MINT")
    return f"https://{HOST}{PATH}?query={','.join(mints)}"


def search_url_ok(url, mints=None) -> bool:
    """True only for the public search URL. An API key or extra parameter is refused."""
    if type(url) is not str:
        return False
    parts = urlsplit(url)
    if parts.scheme != "https" or parts.hostname != HOST or parts.username or parts.password or parts.fragment:
        return False
    if parts.path != PATH:
        return False
    pairs = parse_qsl(parts.query, keep_blank_values=True)
    if len(pairs) != 1 or pairs[0][0] != "query" or not pairs[0][1]:
        return False
    found = pairs[0][1].split(",")
    if not 1 <= len(found) <= BATCH_LIMIT or any(not _address(mint) for mint in found) or len(set(found)) != len(found):
        return False
    if mints is not None and found != list(mints):
        return False
    return True


def _number(value):
    if isinstance(value, bool) or type(value) not in (int, float):
        return None
    number = float(value)
    if not math.isfinite(number):
        return None
    return value


def _count(value):
    number = _number(value)
    if number is None or isinstance(number, bool):
        return None
    if type(number) is int:
        return number if number >= 0 else None
    if type(number) is float and number >= 0 and number.is_integer():
        return int(number)
    return None


def _text(value):
    if type(value) is not str or not value:
        return None
    return value


def _bool(value):
    if type(value) is bool:
        return value
    return None


def _stats(block):
    source = block if type(block) is dict else {}
    out = {}
    for key in _STAT_KEYS:
        if key in _COUNT_KEYS:
            out[key] = _count(source.get(key))
        else:
            number = _number(source.get(key))
            out[key] = None if number is None or number < 0 else number
    return out


def raw_fields(token: dict) -> dict:
    """Whitelisted fields from one search object. Absent or unusable values are null."""
    if type(token) is not dict:
        raise SnapshotError("RESPONSE_SHAPE")
    audit = token.get("audit") if type(token.get("audit")) is dict else {}
    organic = _number(token.get("organicScore"))
    return {
        "id": _text(token.get("id")),
        "symbol": _text(token.get("symbol")),
        "name": _text(token.get("name")),
        "organicScore": None if organic is None or organic < 0 else organic,
        "organicScoreLabel": _text(token.get("organicScoreLabel")),
        "holderCount": _count(token.get("holderCount")),
        "usdPrice": None if _number(token.get("usdPrice")) is None or _number(token.get("usdPrice")) < 0 else token.get("usdPrice"),
        "liquidity": None if _number(token.get("liquidity")) is None or _number(token.get("liquidity")) < 0 else token.get("liquidity"),
        "mcap": None if _number(token.get("mcap")) is None or _number(token.get("mcap")) < 0 else token.get("mcap"),
        "updatedAt": _text(token.get("updatedAt")),
        "audit": {
            "mintAuthorityDisabled": _bool(audit.get("mintAuthorityDisabled")),
            "freezeAuthorityDisabled": _bool(audit.get("freezeAuthorityDisabled")),
            "topHoldersPercentage": None if _number(audit.get("topHoldersPercentage")) is None or _number(audit.get("topHoldersPercentage")) < 0 else audit.get("topHoldersPercentage"),
        },
        "stats5m": _stats(token.get("stats5m")),
        "stats1h": _stats(token.get("stats1h")),
    }


def _feature_number(value):
    number = _number(value)
    if number is None or number < 0:
        return None
    return float(number) if type(number) is not int else number


def features_from_raw(raw: dict) -> dict:
    """Flat view of the stored fields. The 50 percent line is a fixed rule, not a fit."""
    if type(raw) is not dict:
        raise SnapshotError("RESPONSE_SHAPE")
    audit = raw.get("audit") if type(raw.get("audit")) is dict else {}
    stats5 = raw.get("stats5m") if type(raw.get("stats5m")) is dict else {}
    stats1 = raw.get("stats1h") if type(raw.get("stats1h")) is dict else {}
    organic = _feature_number(raw.get("organicScore"))
    return {
        "organic_score": organic,
        "organic_score_label": raw.get("organicScoreLabel") if type(raw.get("organicScoreLabel")) is str else None,
        "holder_count": raw.get("holderCount") if type(raw.get("holderCount")) is int and not isinstance(raw.get("holderCount"), bool) else None,
        "mint_authority_disabled": audit.get("mintAuthorityDisabled") if type(audit.get("mintAuthorityDisabled")) is bool else None,
        "freeze_authority_disabled": audit.get("freezeAuthorityDisabled") if type(audit.get("freezeAuthorityDisabled")) is bool else None,
        "top_holders_percentage": _feature_number(audit.get("topHoldersPercentage")),
        "buy_volume_5m": _feature_number(stats5.get("buyVolume")),
        "sell_volume_5m": _feature_number(stats5.get("sellVolume")),
        "num_buys_5m": stats5.get("numBuys") if type(stats5.get("numBuys")) is int and not isinstance(stats5.get("numBuys"), bool) else None,
        "num_sells_5m": stats5.get("numSells") if type(stats5.get("numSells")) is int and not isinstance(stats5.get("numSells"), bool) else None,
        "num_traders_5m": stats5.get("numTraders") if type(stats5.get("numTraders")) is int and not isinstance(stats5.get("numTraders"), bool) else None,
        "num_organic_buyers_5m": stats5.get("numOrganicBuyers") if type(stats5.get("numOrganicBuyers")) is int and not isinstance(stats5.get("numOrganicBuyers"), bool) else None,
        "buy_volume_1h": _feature_number(stats1.get("buyVolume")),
        "sell_volume_1h": _feature_number(stats1.get("sellVolume")),
        "num_buys_1h": stats1.get("numBuys") if type(stats1.get("numBuys")) is int and not isinstance(stats1.get("numBuys"), bool) else None,
        "num_sells_1h": stats1.get("numSells") if type(stats1.get("numSells")) is int and not isinstance(stats1.get("numSells"), bool) else None,
        "num_traders_1h": stats1.get("numTraders") if type(stats1.get("numTraders")) is int and not isinstance(stats1.get("numTraders"), bool) else None,
        "rule_top_holders_percentage": TOP_HOLDERS_PERCENT,
    }


def parse_search(payload, mints: list[str]) -> dict[str, dict | None]:
    """Map each requested mint to its object. A mint the list does not contain is None."""
    if type(payload) is not list or type(mints) is not list:
        raise SnapshotError("RESPONSE_SHAPE")
    by_id = {}
    for row in payload:
        if type(row) is not dict:
            continue
        mint = row.get("id")
        if type(mint) is str and mint in mints and mint not in by_id:
            by_id[mint] = raw_fields(row)
    return {mint: by_id.get(mint) for mint in mints}


def _miss(url: str, mint: str, reason: str, **extra) -> dict:
    body = {
        "status": "NOT_OBSERVED",
        "reason": reason,
        "mint": mint,
        "url": url,
        "raw": None,
        "features": None,
        "body_sha256": None,
        "retries": extra.pop("retries", 0),
        "action": "NO_EXECUTION",
        "execution_allowed": False,
        "live_orders": False,
    }
    body.update(extra)
    return body


def _http_get(url: str) -> tuple[int, object, bytes]:
    if not search_url_ok(url):
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


def fetch_search(mints: list[str], *, transport=None, sleep=time.sleep) -> dict[str, dict]:
    """Read one search page. ``transport(url) -> (status, headers, body)`` skips the network."""
    url = search_url(mints)
    single = {mint: search_url([mint]) for mint in mints}
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
                    return {mint: _miss(single[mint], mint, "RESPONSE_SHAPE") for mint in mints}
                status, headers, raw = got
        except SnapshotError as error:
            reason = str(error) if str(error) in {"REFUSED", "RESPONSE_TOO_LARGE"} else "HTTP_UNREACHABLE"
            return {mint: _miss(single[mint], mint, reason) for mint in mints}
        except urllib.error.URLError:
            return {mint: _miss(single[mint], mint, "HTTP_UNREACHABLE") for mint in mints}
        except TimeoutError:
            return {mint: _miss(single[mint], mint, "HTTP_TIMEOUT") for mint in mints}
        if status == 200:
            break
        waited = retry_delay_seconds(headers)
        if status != 429 or attempt == 1:
            reason = "RATE_LIMITED" if status == 429 else "HTTP_STATUS"
            return {
                mint: _miss(
                    single[mint],
                    mint,
                    reason,
                    http_status=status if type(status) is int and not isinstance(status, bool) else None,
                    retry_after_seconds=waited if status == 429 else None,
                    retries=1 if delay else 0,
                )
                for mint in mints
            }
        delay = waited
    if type(raw) is not bytes:
        return {mint: _miss(single[mint], mint, "RESPONSE_SHAPE", http_status=200, retries=1 if delay else 0) for mint in mints}
    digest = hashlib.sha256(raw).hexdigest()
    try:
        payload = json.loads(raw)
        parsed = parse_search(payload, mints)
    except (SnapshotError, json.JSONDecodeError, UnicodeDecodeError):
        return {
            mint: _miss(single[mint], mint, "RESPONSE_SHAPE", http_status=200, body_sha256=digest, retries=1 if delay else 0)
            for mint in mints
        }
    out = {}
    for mint in mints:
        raw_row = parsed.get(mint)
        if raw_row is None:
            out[mint] = _miss(
                single[mint], mint, "NOT_IN_RESPONSE", http_status=200, body_sha256=digest, retries=1 if delay else 0,
            )
            continue
        if raw_row.get("id") != mint:
            out[mint] = _miss(
                single[mint], mint, "NOT_IN_RESPONSE", http_status=200, body_sha256=digest, retries=1 if delay else 0,
            )
            continue
        out[mint] = {
            "status": "AVAILABLE",
            "reason": None,
            "mint": mint,
            "url": single[mint],
            "http_status": 200,
            "raw": raw_row,
            "features": features_from_raw(raw_row),
            "body_sha256": digest,
            "retries": 1 if delay else 0,
            "action": "NO_EXECUTION",
            "execution_allowed": False,
            "live_orders": False,
        }
    return out
