"""Quota accounting: the cost table (quota.json), a strict per-run budget per quota bucket, and a small ledger of
what this tool spent per Pacific-Time day (YouTube quotas reset at midnight PT).

The budget charges a call BEFORE it is sent and refuses any call that would cross the cap, so a run can never
spend more than --max-units / --max-searches. Retries are charged too: Google counts every request, invalid ones
included, at least once. The ledger is this tool's own estimate; the Google Cloud console Quotas page is the
authority."""

import datetime as dt
import json
import os
import zoneinfo
from collections import Counter

QUOTA_TIME_ZONE = "America/Los_Angeles"
LEDGER_KEEP_DAYS = 14


class QuotaConfigError(ValueError):
    pass


class BudgetExceeded(Exception):
    def __init__(self, method, bucket, cost, spent, cap, reason="cap"):
        self.method, self.bucket, self.cost, self.spent, self.cap, self.reason = method, bucket, cost, spent, cap, reason
        if reason == "exhausted":
            msg = f"{method}: the {bucket} quota bucket is exhausted for this run (the API answered quotaExceeded)"
        else:
            msg = f"{method} needs {cost} {bucket} unit(s) but only {max(0, cap - spent)} of this run's {cap} remain"
        super().__init__(msg)


class QuotaTable:
    def __init__(self, data, source="quota.json"):
        if not isinstance(data, dict) or data.get("version") != 1:
            raise QuotaConfigError(f"{source}: expected {{\"version\": 1, \"dailyLimits\": ..., \"methods\": ...}}")
        limits = data.get("dailyLimits")
        methods = data.get("methods")
        if not isinstance(limits, dict) or not limits:
            raise QuotaConfigError(f"{source}: dailyLimits must map each bucket to its daily allowance")
        for bucket, limit in limits.items():
            if not isinstance(limit, int) or isinstance(limit, bool) or limit < 1:
                raise QuotaConfigError(f"{source}: dailyLimits.{bucket} must be a whole number of at least 1")
        if not isinstance(methods, dict) or not methods:
            raise QuotaConfigError(f"{source}: methods must list the cost of every API method the tool calls")
        self.methods = {}
        for method, spec in methods.items():
            if not isinstance(spec, dict) or spec.get("bucket") not in limits:
                raise QuotaConfigError(f"{source}: methods.{method}.bucket must be one of {', '.join(sorted(limits))}")
            cost = spec.get("cost")
            if not isinstance(cost, int) or isinstance(cost, bool) or cost < 1:
                raise QuotaConfigError(f"{source}: methods.{method}.cost must be a whole number of at least 1")
            self.methods[method] = (spec["bucket"], cost)
        self.daily_limits = dict(limits)
        self.reset_time_zone = data.get("resetTimeZone", QUOTA_TIME_ZONE)
        self.source = source
        self.raw = data

    @classmethod
    def load(cls, path):
        with open(path, encoding="utf-8") as fh:
            return cls(json.load(fh), source=path)

    def cost(self, method):
        if method not in self.methods:
            raise QuotaConfigError(f"{self.source}: no cost is configured for {method}")
        return self.methods[method]

    def buckets(self):
        return sorted(self.daily_limits)


class QuotaBudget:
    def __init__(self, table, caps, ledger=None):
        missing = [b for b in table.buckets() if b not in caps]
        if missing:
            raise QuotaConfigError(f"no per-run cap for quota bucket(s): {', '.join(missing)}")
        for bucket, cap in caps.items():
            if not isinstance(cap, int) or isinstance(cap, bool) or cap < 0:
                raise QuotaConfigError(f"the per-run cap for {bucket} must be a whole number of 0 or more")
        self.table = table
        self.caps = dict(caps)
        self.spent = {b: 0 for b in table.buckets()}
        self.calls = Counter()
        self.refused = Counter()
        self.exhausted = set()
        self.ledger = ledger

    def affordable(self, method, calls=1):
        bucket, cost = self.table.cost(method)
        if bucket in self.exhausted:
            return False
        return self.spent[bucket] + cost * calls <= self.caps[bucket]

    def affordable_all(self, calls):
        """True when every (method, count) in calls fits together in what is left of each bucket."""
        need = {}
        for method, count in calls:
            bucket, cost = self.table.cost(method)
            if bucket in self.exhausted:
                return False
            need[bucket] = need.get(bucket, 0) + cost * count
        return all(self.spent[b] + n <= self.caps[b] for b, n in need.items())

    def charge(self, method):
        bucket, cost = self.table.cost(method)
        if bucket in self.exhausted:
            self.refused[method] += 1
            raise BudgetExceeded(method, bucket, cost, self.spent[bucket], self.caps[bucket], reason="exhausted")
        if self.spent[bucket] + cost > self.caps[bucket]:
            self.refused[method] += 1
            raise BudgetExceeded(method, bucket, cost, self.spent[bucket], self.caps[bucket])
        self.spent[bucket] += cost
        self.calls[method] += 1
        if self.ledger is not None:
            self.ledger.add(bucket, cost)

    def mark_exhausted(self, method):
        bucket, _ = self.table.cost(method)
        self.exhausted.add(bucket)

    def remaining(self, bucket):
        return max(0, self.caps[bucket] - self.spent[bucket])

    def summary(self):
        return {
            "caps": dict(self.caps),
            "spent": dict(self.spent),
            "calls": dict(sorted(self.calls.items())),
            "refused": dict(sorted(self.refused.items())),
            "exhausted": sorted(self.exhausted),
        }


class Ledger:
    """Units this tool charged per Pacific-Time day, so separate runs on one day share the project's daily
    allowance. path=None keeps it in memory (fixture runs and tests)."""

    def __init__(self, path=None, now_fn=None, time_zone=QUOTA_TIME_ZONE):
        self.path = path
        self.now_fn = now_fn or (lambda: dt.datetime.now(dt.timezone.utc))
        self.zone = zoneinfo.ZoneInfo(time_zone)
        self.time_zone = time_zone
        self.days = {}
        if path and os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as fh:
                    data = json.load(fh)
                days = data.get("days", {}) if isinstance(data, dict) else {}
                for day, buckets in days.items():
                    if isinstance(buckets, dict):
                        self.days[day] = {b: int(v) for b, v in buckets.items() if isinstance(v, int) and not isinstance(v, bool)}
            except (OSError, ValueError):
                self.days = {}

    def day_key(self, moment=None):
        moment = moment or self.now_fn()
        return moment.astimezone(self.zone).date().isoformat()

    def spent_today(self, bucket):
        return self.days.get(self.day_key(), {}).get(bucket, 0)

    def add(self, bucket, units):
        key = self.day_key()
        day = self.days.setdefault(key, {})
        day[bucket] = day.get(bucket, 0) + units
        self._save()

    def _save(self):
        if not self.path:
            return
        keep = sorted(self.days)[-LEDGER_KEEP_DAYS:]
        self.days = {k: self.days[k] for k in keep}
        os.makedirs(os.path.dirname(os.path.abspath(self.path)), exist_ok=True)
        tmp = f"{self.path}.{os.getpid()}.tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump({"version": 1, "timeZone": self.time_zone, "note": "Units the topic finder charged per Pacific-Time day (its own estimate; the Cloud console is authoritative).", "days": self.days}, fh, indent=2, sort_keys=True)
            fh.write("\n")
        os.replace(tmp, self.path)


def effective_caps(table, requested, ledger):
    """Per-run caps, lowered so today's ledger total plus this run never passes the project's daily allowance."""
    caps, notes = {}, []
    for bucket in table.buckets():
        want = requested.get(bucket, 0)
        left = max(0, table.daily_limits[bucket] - (ledger.spent_today(bucket) if ledger else 0))
        caps[bucket] = min(want, left)
        if caps[bucket] < want:
            notes.append(f"{bucket}: cap lowered from {want} to {caps[bucket]} because the ledger shows {table.daily_limits[bucket] - left} of {table.daily_limits[bucket]} already charged today (Pacific Time)")
    return caps, notes
