"""GeckoTerminal call budget shared by the local daemons (1-min exit watcher + 5-min scanner).

GeckoTerminal's keyless API returns 429 well below its nominal 30/min (LEARNINGS), so the two processes share ONE rolling
60-s window (default 4 calls/min in total) and ONE pause: a 429 seen by either process stops GT calls in both for
GT_PAUSE_S. State lives in a small JSON file next to the ledger (data/gt_share.json), updated under an fcntl lock."""
from __future__ import annotations
import fcntl, json, os, time

DEFAULT_PER_MIN = 4
PAUSE_S = 300


class GtShare:
    def __init__(self, path, per_min=DEFAULT_PER_MIN, clock=time.time):
        self.path, self.per_min, self.clock = path, per_min, clock

    def _locked(self, fn):
        with open(self.path + ".lock", "a+") as lk:
            fcntl.flock(lk, fcntl.LOCK_EX)
            try:
                with open(self.path) as f:
                    st = json.load(f)
            except (OSError, ValueError):
                st = {}
            now = self.clock()
            st["calls"] = [t for t in st.get("calls") or [] if isinstance(t, (int, float)) and now - 60 < t <= now + 5]
            res, changed = fn(st, now)
            if changed:
                tmp = self.path + ".tmp"
                with open(tmp, "w") as f:
                    json.dump(st, f)
                os.replace(tmp, self.path)
            return res

    def try_acquire(self, who="?", n=1):
        """Take n calls from the shared window. False when paused (after a 429) or the window is full."""
        def fn(st, now):
            if float(st.get("pause_until") or 0) > now or len(st["calls"]) + n > self.per_min:
                return False, False
            st["calls"] += [now] * n
            st.setdefault("by", {})[who] = st.get("by", {}).get(who, 0) + n
            return True, True
        return self._locked(fn)

    def penalize(self, who="?", pause_s=PAUSE_S):
        def fn(st, now):
            st["pause_until"] = max(float(st.get("pause_until") or 0), now + pause_s)
            st["last_429"] = {"by": who, "at": now}
            return None, True
        return self._locked(fn)

    def state(self):
        def fn(st, now):
            pu = float(st.get("pause_until") or 0)
            return {"calls_last_minute": len(st["calls"]), "per_min": self.per_min, "paused_for_s": round(max(0.0, pu - now)),
                    "total_by": st.get("by") or {}, "last_429": st.get("last_429")}, False
        return self._locked(fn)
