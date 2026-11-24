"""Bounded runner for Security's /workspace/agent-guard/audit.py (improvement-contract step 5).
That script is owned by the Security agent and is never edited here; this only runs it with a hard timeout so an
improvement cycle records "timed out" instead of blocking. Output is treated as untrusted text: it is only tailed and
length-capped, never parsed into actions."""
from __future__ import annotations
import json, os, re, signal, subprocess, sys, tempfile, time

DEFAULT_SCRIPT = os.path.join(os.environ.get("AGENT_GUARD_HOME") or "/workspace/agent-guard", "audit.py")
DEFAULT_TIMEOUT = 240
TAIL_LINES, TAIL_CHARS = 12, 2000


def _tail(b: bytes | str | None) -> str:
    s = b.decode("utf-8", "replace") if isinstance(b, bytes) else (b or "")
    s = "\n".join(s.strip().splitlines()[-TAIL_LINES:])
    return s[-TAIL_CHARS:]


# The audit's markdown output carries one line like "Summary: {'CRITICAL': 5, 'HIGH': 9, 'MEDIUM': 1, 'LOW': 0}".
# Only those four integers are ever taken from the output (strict, anchored match; anything else -> None).
SEVERITIES = ("CRITICAL", "HIGH", "MEDIUM", "LOW")
_SUMMARY_RE = re.compile(r"^Summary: \{'CRITICAL': (\d{1,6}), 'HIGH': (\d{1,6}), 'MEDIUM': (\d{1,6}), 'LOW': (\d{1,6})\}\s*$", re.M)


def parse_summary(b: bytes | str | None) -> dict | None:
    s = b.decode("utf-8", "replace") if isinstance(b, bytes) else (b or "")
    ms = _SUMMARY_RE.findall(s[:200_000])
    if len(ms) != 1:  # none, or ambiguous (several summary lines): record nothing rather than guess
        return None
    return dict(zip(SEVERITIES, (int(x) for x in ms[0])))


def _findings(v) -> dict | None:
    """Typed copy of a findings dict (4 non-negative ints) or None."""
    if not isinstance(v, dict):
        return None
    try:
        out = {k: int(v[k]) for k in SEVERITIES}
    except (KeyError, TypeError, ValueError):
        return None
    if any(isinstance(v[k], bool) or out[k] < 0 or out[k] > 999_999 for k in SEVERITIES):
        return None
    return out


# The audit child inherits only this allowlist. No tokens, secrets, or LUMEN_* values.
_AUDIT_ENV_ALLOW = ("PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TMPDIR")


def child_env(src: dict | None = None) -> dict[str, str]:
    """Minimal environment for audit.py: PATH, HOME, LANG (and locale/tmp if already set)."""
    env = os.environ if src is None else src
    out: dict[str, str] = {}
    for k in _AUDIT_ENV_ALLOW:
        v = env.get(k)
        if v is not None:
            out[k] = v
    if "LANG" not in out and "LC_ALL" not in out:
        out["LANG"] = "C.UTF-8"
    return out


def run(script: str = DEFAULT_SCRIPT, timeout: float = DEFAULT_TIMEOUT, python: str = "python3") -> dict:
    t0 = time.monotonic()
    res = {"script": script, "timeout_sec": timeout}
    if not os.path.isfile(script):
        return {**res, "status": "missing", "ok": False, "elapsed_sec": 0.0, "detail": "audit script not found"}
    # own process group so a timeout also kills any children the audit spawned
    p = subprocess.Popen([python, script], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         start_new_session=True, env=child_env())
    try:
        outb, _ = p.communicate(timeout=timeout)
        rc = p.returncode
        status = "pass" if rc == 0 else "fail"
        return {**res, "status": status, "ok": rc == 0, "rc": rc, "elapsed_sec": round(time.monotonic() - t0, 1), "tail": _tail(outb),
                "findings": parse_summary(outb)}
    except subprocess.TimeoutExpired:
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            p.kill()
        outb, _ = p.communicate()
        return {**res, "status": "timed_out", "ok": False, "rc": None, "elapsed_sec": round(time.monotonic() - t0, 1),
                "tail": _tail(outb), "detail": f"agent-guard audit exceeded {timeout:g}s and was stopped (Security's script, unchanged)"}


# Last-result file the HUD reads for its agent-guard chip. Zoora-owned (not Security's state dir); tests point
# AAI_GUARD_AUDIT_STATE at a tmp path. Only small, typed fields are persisted: never the audit's output text.
_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATUSES = ("pass", "fail", "timed_out", "missing")


def state_path() -> str:
    return os.environ.get("AAI_GUARD_AUDIT_STATE") or os.path.join(_REPO, "data", "guard_audit_last.json")


HISTORY_MAX = 20          # ring buffer of compact past runs kept beside the last result
STALE_AFTER_SEC = 24 * 3600
TIMEOUT_STREAK_ALARM = 3


def _entry(d: dict) -> dict | None:
    """Compact, typed history entry; anything malformed is dropped (never raises)."""
    try:
        st, ts = d.get("status"), float(d.get("finished_at"))
    except (TypeError, ValueError, AttributeError):
        return None
    if st not in STATUSES:
        return None
    e = {"status": st, "elapsed_sec": round(float(d.get("elapsed_sec") or 0.0), 1), "finished_at": ts}
    f = _findings(d.get("findings"))
    if f is not None:
        e["findings"] = f
    return e


def _history(d: dict) -> list[dict]:
    raw = d.get("history") if isinstance(d.get("history"), list) else None
    if raw is None:  # file written before history existed: its last run is the only history
        e = _entry(d)
        return [e] if e else []
    return [e for e in (_entry(x) for x in raw[-4 * HISTORY_MAX:] if isinstance(x, dict)) if e][-HISTORY_MAX:]


def save(res: dict, path: str | None = None, now: float | None = None) -> dict:
    rec = {"status": res.get("status") if res.get("status") in STATUSES else "fail",
           "rc": res.get("rc") if isinstance(res.get("rc"), int) else None,
           "elapsed_sec": float(res.get("elapsed_sec") or 0.0), "timeout_sec": float(res.get("timeout_sec") or 0.0),
           "finished_at": float(now if now is not None else time.time())}
    f = _findings(res.get("findings")) if rec["status"] in ("pass", "fail") else None
    if f is not None:
        rec["findings"] = f
    path = path or state_path()
    try:
        with open(path) as f:
            prev = json.load(f)
        hist = _history(prev) if isinstance(prev, dict) else []
    except (OSError, ValueError):
        hist = []
    hist = (hist + [_entry(rec)])[-HISTORY_MAX:]
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path) or ".", prefix=".guard_audit.")
    with os.fdopen(fd, "w") as f:
        json.dump({**rec, "history": hist}, f)
    os.replace(tmp, path)
    return rec


def _timeout_streak(hist: list[dict]) -> int:
    n = 0
    for e in reversed(hist):
        if e["status"] != "timed_out":
            break
        n += 1
    return n


def load_last(path: str | None = None, now: float | None = None) -> dict | None:
    """Last persisted run with its age, or None. A malformed file reads as None (never raises into the HUD)."""
    try:
        with open(path or state_path()) as f:
            d = json.load(f)
        st, ts = d.get("status"), float(d.get("finished_at"))
    except (OSError, ValueError, TypeError, AttributeError):
        return None
    if st not in STATUSES:
        return None
    now = time.time() if now is None else now
    return {"status": st, "rc": d.get("rc") if isinstance(d.get("rc"), int) else None,
            "elapsed_sec": round(float(d.get("elapsed_sec") or 0.0), 1), "timeout_sec": round(float(d.get("timeout_sec") or 0.0), 1),
            "finished_at": ts, "age_sec": round(max(0.0, now - ts)),
            "history": (h := _history(d)), "timeout_streak": _timeout_streak(h), **_findings_trend(h)}


def _findings_trend(hist: list[dict]) -> dict:
    """Latest recorded findings counts and the change vs the previous run that also recorded them."""
    fh = [e for e in hist if e.get("findings")]
    if not fh:
        return {"findings": None, "findings_prev": None, "findings_delta": None}
    cur = fh[-1]["findings"]
    prev = fh[-2]["findings"] if len(fh) > 1 else None
    return {"findings": cur, "findings_at": fh[-1]["finished_at"], "findings_prev": prev,
            "findings_delta": {k: cur[k] - prev[k] for k in SEVERITIES} if prev else None}


def findings_alarm(last: dict | None) -> dict | None:
    """WARN when the newest audit reports more CRITICAL or HIGH findings than the previous counted run.
    Chimes once per run (id carries that run's finish time). Shrinking or flat counts -> None."""
    if not last or not last.get("findings_delta"):
        return None
    d, cur = last["findings_delta"], last["findings"]
    up = [f"{k} {cur[k] - d[k]}→{cur[k]}" for k in ("CRITICAL", "HIGH") if d.get(k, 0) > 0]
    if not up:
        return None
    return {"id": f"ga_findings_up_{int(last.get('findings_at') or 0)}", "sev": "warn",
            "title": "agent-guard findings increased", "detail": " · ".join(up) + " · Security's audit (shown, not fixed)",
            "source": "agent-guard", "chime": True}


# The HUD renders a RUN AUDIT button inside alarm cards carrying this action. It only *offers* the same bounded
# one-click run (POST /api/zoora/guard-audit/run, single-flight + cooldown); nothing is ever started automatically.
ALARM_ACTION = "guard_audit_run"


def staleness_alarm(last: dict | None, max_age: float = STALE_AFTER_SEC, streak: int = TIMEOUT_STREAK_ALARM) -> dict | None:
    """WARN alarm when the recorded guard-audit is older than 24 h, or timed out `streak`+ runs in a row.
    Nothing recorded yet -> None (the chip already says so). The id carries the finish time so it chimes once per run."""
    if not last:
        return None
    ts = int(last.get("finished_at") or 0)
    if (last.get("age_sec") or 0) > max_age:
        return {"id": f"ga_stale_{ts}", "sev": "warn", "title": "agent-guard audit not run in over 24h",
                "detail": f"last run {last['status'].replace('_', ' ')} {round(last['age_sec'] / 3600)}h ago · run aai guard-audit",
                "source": "agent-guard", "chime": True, "action": ALARM_ACTION}
    n = int(last.get("timeout_streak") or 0)
    if n >= streak:
        return {"id": f"ga_timeouts_{ts}", "sev": "warn", "title": f"agent-guard audit timed out {n} runs in a row",
                "detail": f"limit {round(last.get('timeout_sec') or 0)}s each · Security's audit.py, unchanged (shown, not fixed)",
                "source": "agent-guard", "chime": True, "action": ALARM_ACTION}
    return None


# --- one-click HUD run (localhost POST) -------------------------------------------------------------------------
# The HUD's "RUN AUDIT" button starts the same bounded runner in a background thread so the trend fills without an
# improvement cycle. At most one run in flight, a cooldown between starts, and the result goes through `save` exactly
# like the CLI. Nothing from the audit's output reaches the client except the typed fields `load_last` already exposes.
RUN_COOLDOWN_SEC = 300


class BackgroundAudit:
    def __init__(self, runner=None, saver=None, cooldown: float = RUN_COOLDOWN_SEC, timeout: float = DEFAULT_TIMEOUT):
        import threading
        self._lock = threading.Lock()
        self._runner = runner or (lambda: run(timeout=timeout))
        self._saver = saver or save
        self.cooldown = cooldown
        self.timeout = timeout
        self.running = False
        self.started_at: float | None = None
        self.last_error: str | None = None
        self._thread = None

    def state(self, now: float | None = None) -> dict:
        now = time.time() if now is None else now
        with self._lock:
            wait = 0.0
            if not self.running and self.started_at is not None:
                wait = max(0.0, self.cooldown - (now - self.started_at))
            return {"running": self.running, "started_at": self.started_at, "cooldown_sec": round(wait),
                    "limit_sec": self.timeout, "error": self.last_error}

    def start(self, now: float | None = None) -> dict:
        import threading
        now = time.time() if now is None else now
        with self._lock:
            if self.running:
                return {"started": False, "reason": "already running"}
            if self.started_at is not None and now - self.started_at < self.cooldown:
                return {"started": False, "reason": f"cooldown: next run in {round(self.cooldown - (now - self.started_at))}s"}
            self.running, self.started_at, self.last_error = True, now, None
            self._thread = threading.Thread(target=self._work, name="guard-audit", daemon=True)
            self._thread.start()
        return {"started": True, "reason": None}

    def _work(self):
        err = None
        try:
            self._saver(self._runner())
        except Exception as e:  # noqa: BLE001  a crash is reported as a short typed string, never raised into the HUD
            err = type(e).__name__
        with self._lock:
            self.running, self.last_error = False, err

    def join(self, timeout: float | None = None):
        t = self._thread
        if t is not None:
            t.join(timeout)
