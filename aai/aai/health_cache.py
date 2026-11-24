"""Cached `aai healthcheck` report for GET /api/health.

The full networked healthcheck takes 30-45 s (it runs other agents' live pipelines), which made /api/health block
every caller for that long. This cache serves the last report instantly with its age, and refreshes it in one
background thread (single-flight) once it is older than the TTL. The status code stays honest: 200 only when the
cached report's overall is "pass", else 503. `?fresh=1` still forces a synchronous run.
"""
from __future__ import annotations
import threading, time
from typing import Callable


class HealthReportCache:
    def __init__(self, runner: Callable[[bool], dict], ttl: float = 120.0, clock: Callable[[], float] = time.time):
        self.runner, self.ttl, self.clock = runner, float(ttl), clock
        self.lock = threading.Lock()
        self.reports: dict[bool, dict] = {}      # network flag -> {"report", "at"}
        self.running: set[bool] = set()
        self.last_error: dict[bool, str] = {}

    def _run(self, network: bool):
        try:
            rep = self.runner(network)
            with self.lock:
                self.reports[network] = {"report": rep, "at": self.clock()}
                self.last_error.pop(network, None)
        except Exception as e:  # noqa: BLE001  keep serving the last good report
            with self.lock:
                self.last_error[network] = f"{type(e).__name__}: {e}"[:240]
        finally:
            with self.lock:
                self.running.discard(network)

    def kick(self, network: bool) -> bool:
        """Start a background refresh unless one is already running. Returns True if one was started."""
        with self.lock:
            if network in self.running:
                return False
            self.running.add(network)
        threading.Thread(target=self._run, args=(network,), daemon=True, name=f"aai-health-{int(network)}").start()
        return True

    def put(self, network: bool, report: dict):
        """Store a report produced elsewhere (e.g. the Zoora 'healthcheck' intent) so readers see it at once."""
        with self.lock:
            self.reports[network] = {"report": report, "at": self.clock()}


    def peek(self, network: bool = True) -> dict | None:
        """Read-only cache view for overview / HUD chips. Never runs or kicks a refresh. None if empty."""
        with self.lock:
            hit = self.reports.get(network)
            refreshing = network in self.running
            err = self.last_error.get(network)
        if hit is None:
            return None
        age = max(0.0, self.clock() - hit["at"])
        meta = {"source": "cache", "age_sec": round(age, 1), "ttl_sec": self.ttl, "stale": age >= self.ttl,
                "refreshing": refreshing, "generated_at": hit["at"]}
        if err:
            meta["last_refresh_error"] = err
        return {"report": hit["report"], "cache": meta}

    def get(self, network: bool = True, fresh: bool = False) -> dict:
        """Return {"report", "cache": {...}}. With no cached report yet (or fresh=True) it runs synchronously."""
        with self.lock:
            hit = self.reports.get(network)
        if fresh or hit is None:
            self._run_sync(network)
            with self.lock:
                hit = self.reports.get(network)
            if hit is None:
                raise RuntimeError(self.last_error.get(network) or "healthcheck failed")
            src = "fresh"
            refreshing = False
        else:
            src = "cache"
            refreshing = False
            if self.clock() - hit["at"] >= self.ttl:
                refreshing = self.kick(network) or (network in self.running)
        with self.lock:
            refreshing = refreshing or network in self.running
            err = self.last_error.get(network)
        age = max(0.0, self.clock() - hit["at"])
        meta = {"source": src, "age_sec": round(age, 1), "ttl_sec": self.ttl, "stale": age >= self.ttl,
                "refreshing": refreshing, "generated_at": hit["at"]}
        if err:
            meta["last_refresh_error"] = err
        return {"report": hit["report"], "cache": meta}

    def _run_sync(self, network: bool):
        # single-flight: if a background run is in progress, wait for it instead of starting a second one
        with self.lock:
            busy = network in self.running
            if not busy:
                self.running.add(network)
        if not busy:
            self._run(network)
            return
        deadline = self.clock() + 90
        while self.clock() < deadline:
            with self.lock:
                if network not in self.running:
                    return
            time.sleep(0.2)
