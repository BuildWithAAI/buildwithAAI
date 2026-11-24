"""Post source adapters.

On the Grok Bot box, X reads happen through the bot's `x` MCP tools, which a
Python process cannot call. The daily job therefore works like this:

  1. The agent calls x.get_users_posts(id=<user_id>, since_id=<state.last_post_id>,
     exclude=retweets, max_results=25) (paginating) and writes the raw responses
     verbatim into data/inbox/ as *.json / *.txt (X API v2 payloads) or *.jsonl
     (one normalised post per line).
  2. `billy ingest` reads the seed file(s) + every inbox file through the
     adapters below, dedups by post id and moves inbox files to inbox/processed/.

XLiveSourceStub documents where a direct X API client would plug in; it is not
implemented (no credentials are stored or requested by this project).
"""
from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import datetime
from pathlib import Path
from typing import Any, Protocol

from ..logging_utils import get_logger
from ..models import Post

log = get_logger(__name__)


def _parse_dt(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _url(handle: str, pid: str) -> str:
    return f"https://x.com/{handle}/status/{pid}"


def normalise_record(rec: dict[str, Any], handle: str, source: str) -> Post | None:
    """Accept either our normalised JSONL schema or an X API v2 post object."""
    pid = str(rec.get("id", "")).strip()
    text = rec.get("text")
    ts = rec.get("date") or rec.get("created_at")
    if not pid or not pid.isdigit() or not text or not ts:
        return None
    # agent-guard: tweets are hostile input. Normalise (NFKC, strip invisible/bidi chars) before the
    # regex parser; posts with HIGH injection flags are dropped from signal generation (still kept in raw files).
    import sys as _s; _s.path.insert(0, "/workspace/agent-guard")
    from agent_guard.sanitize import detect_injection, max_severity, normalize
    flags = detect_injection(str(text))
    if flags and max_severity(flags) == "HIGH":
        return None
    text = normalize(str(text))
    return Post(
        id=pid,
        created_at=_parse_dt(ts),
        text=text,
        url=rec.get("url") or _url(handle, pid),
        source=rec.get("source") or source,
        metrics=rec.get("metrics") or rec.get("public_metrics"),
    )


class PostSource(Protocol):
    name: str

    def iter_posts(self) -> Iterator[Post]: ...


class JsonlFileSource:
    """One JSON object per line (the research raw_posts.jsonl format)."""

    def __init__(self, path: Path, handle: str):
        self.path, self.handle, self.name = Path(path), handle, f"jsonl:{Path(path).name}"

    def iter_posts(self) -> Iterator[Post]:
        if not self.path.exists():
            log.warning("source missing", extra={"path": str(self.path)})
            return
        with open(self.path) as f:
            for n, line in enumerate(f, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    p = normalise_record(json.loads(line), self.handle, self.name)
                except (json.JSONDecodeError, ValueError) as e:
                    log.warning("bad jsonl line", extra={"path": str(self.path), "line": n, "err": str(e)})
                    continue
                if p:
                    yield p


def _extract_payload(raw: str) -> dict[str, Any]:
    """MCP tool dumps may wrap the JSON in other text; find the first {"data" object."""
    i = raw.find('{"data"')
    if i < 0:
        i = raw.find("{")
    if i < 0:
        raise ValueError("no JSON object found")
    obj, _ = json.JSONDecoder().raw_decode(raw[i:])
    return obj


class XApiPayloadSource:
    """A saved X API v2 response ({"data": [...], "meta": {...}})."""

    def __init__(self, path: Path, handle: str):
        self.path, self.handle, self.name = Path(path), handle, f"xapi:{Path(path).name}"

    def iter_posts(self) -> Iterator[Post]:
        payload = _extract_payload(self.path.read_text())
        for rec in payload.get("data", []) or []:
            if any(r.get("type") == "retweeted" for r in rec.get("referenced_tweets", []) or []) \
                    or str(rec.get("text", "")).startswith("RT @"):
                continue
            p = normalise_record(rec, self.handle, self.name)
            if p:
                yield p


class DropFolderSource:
    """Every *.jsonl / *.json / *.txt file in the inbox folder."""

    def __init__(self, folder: Path, handle: str):
        self.folder, self.handle, self.name = Path(folder), handle, f"inbox:{Path(folder).name}"

    def files(self) -> list[Path]:
        if not self.folder.exists():
            return []
        return sorted(p for p in self.folder.iterdir() if p.is_file() and p.suffix in {".jsonl", ".json", ".txt"})

    def source_for(self, path: Path) -> PostSource:
        return JsonlFileSource(path, self.handle) if path.suffix == ".jsonl" else XApiPayloadSource(path, self.handle)

    def iter_posts(self) -> Iterator[Post]:
        for f in self.files():
            yield from self.source_for(f).iter_posts()


class XLiveSourceStub:
    """Placeholder for a direct X API v2 client. Intentionally unimplemented."""

    name = "x-live-stub"

    def iter_posts(self) -> Iterator[Post]:
        raise NotImplementedError(
            "Direct X API access is not implemented. Drop X API payloads into data/inbox/ "
            "(see README 'Daily ingest job') and run `billy ingest`."
        )
