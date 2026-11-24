"""Disk cache for API answers (normalized records, never raw responses), plus the 30-day retention sweep.

A cache hit costs no quota. Entries expire after their method's TTL, and nothing is ever kept longer than 30
calendar days: YouTube's Developer Policies (III.E.4.d) let a client keep Non-Authorized Data "not longer than 30
calendar days", and statistics no longer than that either. prune() deletes anything older, and every run calls it.
The API key is never part of a cache key or entry."""

import datetime as dt
import hashlib
import json
import os
import re

from . import text

SCHEMA = 1
HARD_MAX_DAYS = 30


def clamp_days(days):
    """Retention is configurable downward only."""
    try:
        days = float(days)
    except (TypeError, ValueError):
        return HARD_MAX_DAYS
    return max(0.0, min(float(HARD_MAX_DAYS), days))


class DiskCache:
    def __init__(self, root, ttl_hours, now_fn, read=True, write=True):
        self.root = root
        self.ttl_hours = dict(ttl_hours or {})
        self.now_fn = now_fn
        self.read = read and bool(root)
        self.write = write and bool(root)
        self.hits = 0
        self.misses = 0
        self.writes = 0

    @staticmethod
    def key(namespace, params):
        clean = {k: v for k, v in params.items() if k.lower() not in ("key", "x-goog-api-key")}
        blob = json.dumps({"v": SCHEMA, "ns": namespace, "p": clean}, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(blob.encode("utf-8")).hexdigest()

    def _path(self, namespace, key):
        safe_ns = re.sub(r"[^A-Za-z0-9_.-]", "_", namespace)
        return os.path.join(self.root, safe_ns, key[:2], key + ".json")

    def _ttl(self, namespace):
        hours = self.ttl_hours.get(namespace, self.ttl_hours.get(namespace.split(":")[0], 24))
        return min(float(hours), HARD_MAX_DAYS * 24.0)

    def get(self, namespace, params):
        if not self.read:
            return None
        path = self._path(namespace, self.key(namespace, params))
        try:
            with open(path, encoding="utf-8") as fh:
                entry = json.load(fh)
        except (OSError, ValueError):
            self.misses += 1
            return None
        fetched = text.parse_time(entry.get("fetchedAt")) if isinstance(entry, dict) else None
        if fetched is None or entry.get("schema") != SCHEMA:
            self.misses += 1
            return None
        age_hours = (self.now_fn() - fetched).total_seconds() / 3600.0
        if age_hours < 0 or age_hours > self._ttl(namespace):
            self.misses += 1
            return None
        self.hits += 1
        return entry.get("data")

    def put(self, namespace, params, data):
        if not self.write:
            return
        path = self._path(namespace, self.key(namespace, params))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        entry = {"schema": SCHEMA, "namespace": namespace, "fetchedAt": text.rfc3339(self.now_fn()), "data": data}
        tmp = f"{path}.{os.getpid()}.tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(entry, fh, sort_keys=True, separators=(",", ":"))
        os.replace(tmp, path)
        self.writes += 1

    def stats(self):
        return {"hits": self.hits, "misses": self.misses, "writes": self.writes, "enabled": self.read or self.write}


def prune_cache(root, now, max_days=HARD_MAX_DAYS):
    """Delete cache entries fetched more than max_days ago (and unreadable ones). Returns the number deleted."""
    if not root or not os.path.isdir(root):
        return 0
    limit = clamp_days(max_days)
    deleted = 0
    for dirpath, _dirs, files in os.walk(root, topdown=False):
        for name in files:
            if not name.endswith(".json") and not name.endswith(".tmp"):
                continue
            path = os.path.join(dirpath, name)
            fetched = None
            if name.endswith(".json"):
                try:
                    with open(path, encoding="utf-8") as fh:
                        entry = json.load(fh)
                    fetched = text.parse_time(entry.get("fetchedAt")) if isinstance(entry, dict) else None
                except (OSError, ValueError):
                    fetched = None
            if fetched is None or text.days_between(fetched, now) > limit:
                try:
                    os.remove(path)
                    deleted += 1
                except OSError:
                    pass
        if dirpath != root:
            try:
                os.rmdir(dirpath)
            except OSError:
                pass
    return deleted


_REPORT_NAME = re.compile(r"^(\d{4}-\d{2}-\d{2})(?:\..+)?\.(?:json|md)$")


def prune_reports(out_dir, today, max_days=HARD_MAX_DAYS):
    """Delete topic-finder reports (out/topics/<date>*.json|md) whose run date is more than max_days before today.
    They quote YouTube titles, channel names and counts, which may not be kept longer than 30 days."""
    if not out_dir or not os.path.isdir(out_dir):
        return []
    limit = clamp_days(max_days)
    removed = []
    for dirpath, _dirs, files in os.walk(out_dir):
        for name in sorted(files):
            m = _REPORT_NAME.match(name)
            if not m:
                continue
            try:
                run_date = dt.date.fromisoformat(m.group(1))
            except ValueError:
                continue
            if (today - run_date).days > limit:
                path = os.path.join(dirpath, name)
                try:
                    os.remove(path)
                    removed.append(os.path.relpath(path, out_dir))
                except OSError:
                    pass
    return removed
