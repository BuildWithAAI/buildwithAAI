"""Shared HTTP session: retries, timeouts, browser-like UA, small on-disk cache for big lists."""
from __future__ import annotations
import json, logging, os, time, hashlib
from pathlib import Path
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

log = logging.getLogger("http")
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/124.0 Safari/537.36 zoorped-opsec-pipeline/1.0")
ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT / "data" / "cache"

_session: requests.Session | None = None


def session() -> requests.Session:
    global _session
    if _session is None:
        s = requests.Session()
        retry = Retry(total=3, backoff_factor=1.0, status_forcelist=(429, 500, 502, 503, 504),
                      allowed_methods=frozenset(["GET", "POST"]), respect_retry_after_header=True)
        s.mount("https://", HTTPAdapter(max_retries=retry, pool_maxsize=16))
        s.mount("http://", HTTPAdapter(max_retries=retry))
        s.headers.update({"User-Agent": UA, "Accept": "*/*"})
        _session = s
    return _session


def get(url: str, timeout: float = 25, **kw) -> requests.Response:
    r = session().get(url, timeout=timeout, **kw)
    r.raise_for_status()
    return r


def get_json(url: str, timeout: float = 25, **kw):
    return get(url, timeout=timeout, **kw).json()


def post_json(url: str, payload, timeout: float = 25):
    r = session().post(url, json=payload, timeout=timeout)
    r.raise_for_status()
    return r.json()


def cached_json(url: str, max_age_s: int = 6 * 3600, timeout: float = 60):
    """Fetch JSON with a disk cache; on network failure fall back to a stale cache copy."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    p = CACHE_DIR / (hashlib.sha1(url.encode()).hexdigest() + ".json")
    if p.exists() and time.time() - p.stat().st_mtime < max_age_s:
        return json.loads(p.read_text())
    try:
        data = get_json(url, timeout=timeout)
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(data))
        os.replace(tmp, p)
        return data
    except Exception as e:  # stale fallback
        if p.exists():
            log.warning("using stale cache for %s (%s)", url, e)
            return json.loads(p.read_text())
        raise
