"""Shared fixture loading for the offline test suite (no network: replay mode raises CacheMiss)."""
from __future__ import annotations
import copy, dataclasses, functools, gzip, json, os, sqlite3

FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")


@functools.lru_cache(None)
def _load(name):
    with gzip.open(os.path.join(FIX, name), "rt") as f:
        return json.load(f)


def fixture(name):
    return copy.deepcopy(_load(name))


def signals(name):
    return fixture(name)["signals"]


def default_settings(**kw):
    from smr import config as C
    return dataclasses.replace(C.load_settings(), thresholds=C.Thresholds(), thresholds_version="default", weights={}, **kw)


def replay_context(fx, tmp):
    """Context whose RPC/HTTP layers can only answer from the recorded responses."""
    from smr.context import Context
    tmp = str(tmp)
    s = default_settings(data_dir=tmp, cache_db=os.path.join(tmp, "cache.db"), graph_db=os.path.join(tmp, "funding_graph.db"),
                         thresholds_file=os.path.join(tmp, "thresholds.json"), cache_mode="replay", **fx["settings_overrides"])
    db = sqlite3.connect(os.path.join(tmp, "launches.db"))
    db.execute("CREATE TABLE IF NOT EXISTS stream (signature TEXT PRIMARY KEY, slot INTEGER, block_time INTEGER, err INTEGER)")
    db.executemany("INSERT OR REPLACE INTO stream VALUES (?,?,?,?)", fx["stream_rows"]); db.commit(); db.close()
    ctx = Context(s)
    ctx.cache.load_fixture(fx["cache"])
    ctx.clock = lambda: fx["as_of"] + 86400
    return ctx
