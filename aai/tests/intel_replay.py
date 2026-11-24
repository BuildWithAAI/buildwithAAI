"""Record/replay HTTP for intel adapter tests. Recorded fixtures live in tests/fixtures/intel/raw/*.json.
Keys drop volatile query params (dates/timestamps) and the year in Treasury URLs so the fixtures replay forever."""
from __future__ import annotations
import hashlib, json, re
from pathlib import Path
from aai.intel.core import FetchError

RAW = Path(__file__).parent / "fixtures" / "intel" / "raw"
VOLATILE = {"cosd", "start_timestamp", "end_timestamp", "field_tdr_date_value"}


def key(url: str, params: dict | None) -> str:
    u = re.sub(r"/20\d\d/all", "/YEAR/all", url)
    p = {k: v for k, v in sorted((params or {}).items()) if k not in VOLATILE}
    return u + "?" + json.dumps(p, sort_keys=True)


def fname(k: str) -> str:
    return hashlib.sha1(k.encode()).hexdigest()[:16] + ".json"


class ReplayFetcher:
    """Drop-in for aai.intel.core.Fetcher that serves recorded responses; unknown URLs raise FetchError (like a 404)."""

    def __init__(self, overrides: dict | None = None, fail: set | None = None):
        self.overrides, self.fail, self.calls = overrides or {}, fail or set(), []

    def get(self, url, params=None, as_="json", timeout=None, headers=None, retries=None):
        self.calls.append((url, params, headers))
        for frag in self.fail:
            if frag in url:
                raise FetchError("HTTP 503 (test)", 503)
        for frag, body in self.overrides.items():
            if frag in url:
                return body
        k = key(url, params)
        p = RAW / fname(k)
        if not p.exists():
            raise FetchError("HTTP 404 (no fixture)", 404, retryable=False)
        rec = json.loads(p.read_text())
        return rec["body"]
