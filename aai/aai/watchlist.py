"""Owner-edited EDGAR filings watchlist (T9 stocks desk). CLI-only writer: `aai filings-watch list|add|remove|reset`.

config/default.toml `[intel].watchlist` stays the shipped default. When `data/watchlist.json` exists (gitignored; path
overridable with AAI_WATCHLIST) it replaces that list at config load, so the owner can change which companies the filings
panel watches without editing tracked config. Nothing else writes the file: no HUD endpoint, voice intent, LLM or other
agent's report can add a ticker. Tickers are validated (letters/digits/dot/dash, max 10 chars, max 25 names) and
de-duplicated. Read-only research data only; nothing here creates ideas, tickets or orders."""
from __future__ import annotations

import json
import os
import re
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_FILE = ROOT / "data" / "watchlist.json"
MAX_NAMES = 25  # edgar.fetch already caps at 25 (SEC fair-access: one submissions request per name per refresh)
_TICK = re.compile(r"^[A-Z][A-Z0-9]{0,5}([.-][A-Z0-9]{1,3})?$")


class WatchlistError(ValueError):
    pass


def path() -> Path:
    p = os.environ.get("AAI_WATCHLIST")
    return Path(p) if p else DEFAULT_FILE


def norm(t) -> str:
    s = str(t or "").strip().upper()
    if not _TICK.match(s):
        raise WatchlistError(f"not a ticker: {str(t)[:20]!r} (letters/digits, optional .X or -X class suffix)")
    return s


def read(p: Path | None = None) -> dict | None:
    """The saved list, or None when there is no file. A corrupt or invalid file is reported, never half-applied."""
    p = Path(p or path())
    if not p.exists():
        return None
    try:
        d = json.loads(p.read_text())
        names = d.get("tickers") if isinstance(d, dict) else None
        if not isinstance(names, list) or not names or len(names) > MAX_NAMES:
            raise WatchlistError("tickers must be a non-empty list of at most 25 names")
        out = []
        for t in names:
            n = norm(t)
            if n not in out:
                out.append(n)
        return {"tickers": out, "updated_at": d.get("updated_at") if isinstance(d.get("updated_at"), (int, float)) else None,
                "history": [h for h in (d.get("history") or []) if isinstance(h, dict)][-20:]}
    except (OSError, ValueError) as e:
        raise WatchlistError(f"{p.name} is unreadable ({type(e).__name__}: {str(e)[:120]}); fix or `aai filings-watch reset`")


def effective(cfg: dict, p: Path | None = None) -> dict:
    """What the filings feed will watch: the owner's file if valid, else the config default (with the reason)."""
    ic = cfg.get("intel", {})
    default = [str(t).upper() for t in (ic.get("watchlist_default") or ic.get("watchlist") or [])][:MAX_NAMES]
    try:
        d = read(p)
    except WatchlistError as e:
        return {"source": "config", "tickers": default, "error": str(e), "file": str(Path(p or path()))}
    if d is None:
        return {"source": "config", "tickers": default, "file": str(Path(p or path()))}
    return {"source": "file", "tickers": d["tickers"], "updated_at": d["updated_at"], "file": str(Path(p or path())),
            "added_vs_default": [t for t in d["tickers"] if t not in default],
            "removed_vs_default": [t for t in default if t not in d["tickers"]]}


def apply(cfg: dict, p: Path | None = None) -> dict:
    """Called by config.load: overlay a valid owner file onto cfg['intel']['watchlist'] (invalid file = default kept)."""
    ic = cfg.setdefault("intel", {})
    ic.setdefault("watchlist_default", list(ic.get("watchlist") or []))  # the tracked config's list, kept for diffs/reset
    eff = effective(cfg, p)
    if eff["source"] == "file":
        cfg.setdefault("intel", {})["watchlist"] = list(eff["tickers"])
    cfg.setdefault("intel", {})["watchlist_source"] = eff["source"]
    return cfg


def _write(tickers: list[str], action: str, names: list[str], p: Path) -> dict:
    prev = None
    try:
        prev = read(p)
    except WatchlistError:
        prev = None
    hist = (prev or {}).get("history", []) + [{"ts": round(time.time(), 1), "action": action, "tickers": names}]
    doc = {"tickers": tickers, "updated_at": round(time.time(), 1), "history": hist[-20:],
           "note": "Owner-edited EDGAR filings watchlist. Written only by `aai filings-watch`. Read-only research data."}
    p.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=p.parent, prefix=".watchlist.", suffix=".tmp")
    with os.fdopen(fd, "w") as f:
        json.dump(doc, f, indent=2)
    os.replace(tmp, p)
    return doc


def edit(cfg: dict, action: str, names=(), p: Path | None = None) -> dict:
    """add / remove / reset. Starts from the effective list (config default when no file). Returns the new state."""
    p = Path(p or path())
    cur = effective(cfg, p)
    if action == "reset":
        existed = p.exists()
        if existed:
            p.unlink()
        return {"ok": True, "action": "reset", "removed_file": existed, **effective(cfg, p), "takes_effect": _NOTE}
    clean = []
    for t in names:
        n = norm(t)
        if n not in clean:
            clean.append(n)
    if not clean:
        raise WatchlistError("name at least one ticker")
    tickers = list(cur["tickers"])
    if action == "add":
        changed = [t for t in clean if t not in tickers]
        tickers += changed
        if len(tickers) > MAX_NAMES:
            raise WatchlistError(f"watchlist would have {len(tickers)} names; the max is {MAX_NAMES} (remove some first)")
    elif action == "remove":
        changed = [t for t in clean if t in tickers]
        tickers = [t for t in tickers if t not in clean]
        if not tickers:
            raise WatchlistError("that would empty the watchlist; use `aai filings-watch reset` to go back to the default")
    else:
        raise WatchlistError(f"unknown action {action!r}")
    if changed:
        _write(tickers, action, changed, p)
    return {"ok": True, "action": action, "changed": changed, "unchanged": [t for t in clean if t not in changed],
            **effective(cfg, p), "takes_effect": _NOTE}


_NOTE = ("next HUD restart (scripts/hud_restart.sh); the running HUD keeps the list it started with. "
         "Tickers EDGAR can't map to a CIK are skipped and listed as unresolved in the filings panel")
