"""Read Giant Brain snapshot files and the same public market APIs.

The collector writes `/cursor/stores/bot/giant-brain-data/`. One JSON object
per line. `dexscreener_pairs` is the per-token metric row. Missing fields
stay missing. This module does not send an order.
"""
from __future__ import annotations

from datetime import datetime, timezone
import gzip
import json
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

DEFAULT_ROOT = Path("/cursor/stores/bot/giant-brain-data")
HOSTS = frozenset({"api.dexscreener.com", "api.geckoterminal.com"})
PREFIXES = (
    "/token-profiles/latest/v1",
    "/token-boosts/latest/v1",
    "/token-boosts/top/v1",
    "/tokens/v1/solana/",
    "/api/v2/networks/solana/trending_pools",
    "/api/v2/networks/solana/new_pools",
)


class SnapshotError(ValueError):
    pass


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise SnapshotError("REFUSED")


def parse_time_ms(value: str) -> int:
    if type(value) is not str:
        raise SnapshotError("BAD_TIME")
    moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if moment.tzinfo is None:
        raise SnapshotError("BAD_TIME")
    return int(moment.astimezone(timezone.utc).timestamp() * 1000)


def resolve_root(root: Path | None = None) -> Path:
    path = DEFAULT_ROOT if root is None else Path(root)
    if not path.is_dir() or not (path / "latest.json").is_file():
        raise SnapshotError("SNAPSHOT_ROOT_ABSENT")
    return path


def _under(root: Path, relative: str) -> Path:
    if type(relative) is not str or relative.startswith(("/", "\\")) or ".." in Path(relative).parts:
        raise SnapshotError("SNAPSHOT_PATH")
    target = (root / relative).resolve()
    if not target.is_relative_to(root.resolve()):
        raise SnapshotError("SNAPSHOT_PATH")
    return target


def load_latest(root: Path) -> dict:
    data = json.loads((root / "latest.json").read_text(encoding="utf-8"))
    if type(data) is not dict or type(data.get("snapshot_file")) is not str or type(data.get("sources")) is not dict:
        raise SnapshotError("LATEST_SCHEMA")
    return data


def load_index(root: Path) -> dict:
    path = root / "token_index.json"
    if not path.is_file():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    if type(data) is not dict:
        raise SnapshotError("INDEX_SCHEMA")
    return data


def read_jsonl(path: Path) -> list[dict]:
    opener = gzip.open if path.suffix == ".gz" else open
    rows = []
    with opener(path, "rt", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            if type(row) is not dict:
                raise SnapshotError("RECORD_SCHEMA")
            rows.append(row)
    return rows


def load_snapshot(root: Path, relative: str | None = None) -> list[dict]:
    if relative is None:
        relative = load_latest(root)["snapshot_file"]
    return read_jsonl(_under(root, relative))


def canonical_pairs(records: list[dict]) -> dict[str, dict]:
    """Highest-liquidity DexScreener pair row per token. Other sources are not metrics."""
    chosen: dict[str, dict] = {}
    for row in records:
        if row.get("source") != "dexscreener_pairs" or row.get("chain") != "solana":
            continue
        mint = row.get("token_address")
        if type(mint) is not str or not mint:
            continue
        current = chosen.get(mint)
        liquidity = row.get("liquidity_usd") if type(row.get("liquidity_usd")) in (int, float) else -1
        previous = current.get("liquidity_usd") if current and type(current.get("liquidity_usd")) in (int, float) else -1
        if current is None or liquidity > previous:
            chosen[mint] = row
    return chosen


def observation_from_pair(current: dict, previous: dict | None = None) -> dict:
    if type(current) is not dict or current.get("source") not in (None, "dexscreener_pairs", "geckoterminal_trending_pools", "geckoterminal_new_pools"):
        raise SnapshotError("PAIR_SCHEMA")
    price = current.get("price_usd")
    if type(price) is bool or type(price) not in (int, float) or not price > 0:
        raise SnapshotError("NO_PRICE")
    prior_price = None
    prior_liquidity = None
    if type(previous) is dict:
        if type(previous.get("price_usd")) in (int, float) and previous["price_usd"] > 0:
            prior_price = previous["price_usd"]
        if type(previous.get("liquidity_usd")) in (int, float) and previous["liquidity_usd"] >= 0:
            prior_liquidity = previous["liquidity_usd"]
    observed = {
        "mint": current.get("token_address"),
        "pool": current.get("pair_address"),
        "symbol": current.get("symbol"),
        "dex": current.get("dex"),
        "price_quote_per_base": price,
        "price_usd": price,
        "previous_price": prior_price,
        "buy_quote_atoms": current.get("buys_h1"),
        "sell_quote_atoms": current.get("sells_h1"),
        "liquidity_usd": current.get("liquidity_usd"),
        "previous_liquidity_usd": prior_liquidity,
        "volume_h1": current.get("volume_h1"),
        "price_change_h1": current.get("price_change_h1"),
        "pair_created_at_ms": current.get("pair_created_at_ms"),
        "classification": "OBSERVED",
        "source": current.get("source") or "dexscreener_pairs",
        "fetched_at": current.get("fetched_at") or current.get("ts"),
        "action": "NO_EXECUTION",
    }
    if type(current.get("holder_concentration")) is dict:
        observed["holder_concentration"] = current["holder_concentration"]
    return observed


def _allowed_url(url: str) -> str:
    parts = urlsplit(url)
    if parts.scheme != "https" or parts.hostname not in HOSTS or parts.username or parts.password or parts.fragment:
        raise SnapshotError("REFUSED")
    if not any(parts.path == prefix or parts.path.startswith(prefix) for prefix in PREFIXES):
        raise SnapshotError("REFUSED")
    return url


def fetch_json(url: str, transport=None):
    _allowed_url(url)
    if transport is not None:
        return transport(url)
    request = Request(url, headers={"Accept": "application/json", "User-Agent": "BuildWithAAI-giant-brain/1"})
    with build_opener(_NoRedirect()).open(request, timeout=20) as response:
        raw = response.read(2_000_001)
    if len(raw) > 2_000_000:
        raise SnapshotError("RESPONSE_TOO_LARGE")
    return json.loads(raw)


def fetch_pair_metrics(mints: list[str], transport=None) -> list[dict]:
    """DexScreener token endpoint, mapped into dexscreener_pairs rows. No key."""
    if type(mints) is not list or not 1 <= len(mints) <= 30 or any(type(item) is not str or not item for item in mints):
        raise SnapshotError("MINT_LIST")
    payload = fetch_json("https://api.dexscreener.com/tokens/v1/solana/" + ",".join(mints), transport)
    if type(payload) is not list:
        raise SnapshotError("DEX_SCHEMA")
    best: dict[str, dict] = {}
    for pair in payload:
        if type(pair) is not dict or pair.get("chainId") not in (None, "solana"):
            continue
        base = pair.get("baseToken") if type(pair.get("baseToken")) is dict else {}
        mint = base.get("address")
        if mint not in mints:
            continue
        liquidity = (pair.get("liquidity") or {}).get("usd") if type(pair.get("liquidity")) is dict else None
        try:
            liquidity_value = float(liquidity) if liquidity is not None else -1
        except (TypeError, ValueError):
            liquidity_value = -1
        previous = best.get(mint)
        if previous is None or liquidity_value > previous["_liquidity"]:
            volume = pair.get("volume") if type(pair.get("volume")) is dict else {}
            change = pair.get("priceChange") if type(pair.get("priceChange")) is dict else {}
            txns = pair.get("txns") if type(pair.get("txns")) is dict else {}
            hour = txns.get("h1") if type(txns.get("h1")) is dict else {}
            best[mint] = {
                "_liquidity": liquidity_value,
                "source": "dexscreener_pairs",
                "chain": "solana",
                "token_address": mint,
                "symbol": base.get("symbol"),
                "name": base.get("name"),
                "pair_address": pair.get("pairAddress"),
                "dex": pair.get("dexId"),
                "price_usd": _float(pair.get("priceUsd")),
                "liquidity_usd": None if liquidity_value < 0 else liquidity_value,
                "volume_h1": _float(volume.get("h1")),
                "price_change_h1": _float(change.get("h1")),
                "buys_h1": hour.get("buys") if type(hour.get("buys")) is int else None,
                "sells_h1": hour.get("sells") if type(hour.get("sells")) is int else None,
                "pair_created_at_ms": pair.get("pairCreatedAt") if type(pair.get("pairCreatedAt")) is int else None,
                "url": pair.get("url"),
            }
    return [{key: value for key, value in row.items() if key != "_liquidity"} for row in best.values()]


def _float(value):
    if type(value) is bool or value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return number
