"""Replay fixtures: record every cache key a live run touches, export as gzipped JSON, and replay it
offline through a DiskCache in `replay` mode (raises CacheMiss on anything not recorded)."""
from __future__ import annotations
import contextlib, gzip, json, os, tempfile
from .cache import DiskCache


@contextlib.contextmanager
def recording(cache: DiskCache):
    cache.recorder = {}
    try:
        yield cache.recorder
    finally:
        pass


def save_fixture(entries: dict, path: str, meta: dict | None = None) -> None:
    with gzip.open(path, "wt") as f:
        json.dump({"meta": meta or {}, "entries": entries}, f, separators=(",", ":"))


def load_fixture(path: str) -> dict:
    with gzip.open(path, "rt") as f:
        return json.load(f)


def replay_cache(path: str, tmpdir: str | None = None) -> tuple[DiskCache, dict]:
    fx = load_fixture(path)
    db = os.path.join(tmpdir or tempfile.mkdtemp(prefix="aai-replay-"), "replay.db")
    DiskCache(db, "readwrite").load_fixture(fx["entries"])
    return DiskCache(db, "replay"), fx["meta"]
