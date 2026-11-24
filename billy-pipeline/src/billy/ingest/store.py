"""Canonical post store (JSONL, newest first) + incremental state file."""
from __future__ import annotations

import hashlib
import json
import shutil
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..config import Settings
from ..logging_utils import get_logger
from ..models import Post
from .sources import DropFolderSource, JsonlFileSource, PostSource

log = get_logger(__name__)


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class PostStore:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.posts: dict[str, Post] = {}
        if self.path.exists():
            for line in self.path.read_text().splitlines():
                if line.strip():
                    p = Post.model_validate_json(line)
                    self.posts[p.id] = p

    def add(self, post: Post) -> bool:
        if post.id in self.posts:
            return False
        self.posts[post.id] = post
        return True

    def sorted(self) -> list[Post]:
        return sorted(self.posts.values(), key=lambda p: p.id_int, reverse=True)

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        with open(tmp, "w") as f:
            for p in self.sorted():
                f.write(p.model_dump_json() + "\n")
        tmp.replace(self.path)


def load_state(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text()) if path.exists() else {}


def save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2, default=str))


@dataclass
class IngestResult:
    seen: int = 0
    added: int = 0
    files_processed: list[str] = field(default_factory=list)
    files_skipped: list[str] = field(default_factory=list)
    total: int = 0
    newest_id: str | None = None
    newest_ts: str | None = None


def run_ingest(settings: Settings, move_processed: bool = True) -> IngestResult:
    paths = settings.paths
    store = PostStore(paths.posts_store)
    state = load_state(paths.state_file)
    done_hashes: set[str] = set(state.get("processed_file_hashes", []))
    res = IngestResult()

    sources: list[tuple[PostSource, Path | None]] = [
        (JsonlFileSource(p, settings.handle), None) for p in paths.seed_posts
    ]
    drop = DropFolderSource(paths.inbox_dir, settings.handle)
    for f in drop.files():
        h = _sha(f)
        if h in done_hashes:
            res.files_skipped.append(f.name)
            continue
        sources.append((drop.source_for(f), f))

    for src, fpath in sources:
        try:
            for post in src.iter_posts():
                res.seen += 1
                if store.add(post):
                    res.added += 1
        except (ValueError, json.JSONDecodeError) as e:
            log.error("source failed", extra={"source": src.name, "err": str(e)})
            continue
        if fpath is not None:
            done_hashes.add(_sha(fpath))
            res.files_processed.append(fpath.name)
            if move_processed:
                dest = paths.inbox_dir / "processed"
                dest.mkdir(parents=True, exist_ok=True)
                shutil.move(str(fpath), dest / fpath.name)

    store.save()
    ordered = store.sorted()
    res.total = len(ordered)
    if ordered:
        res.newest_id, res.newest_ts = ordered[0].id, ordered[0].created_at.isoformat()
    state.update(
        {
            "handle": settings.handle,
            "user_id": settings.user_id,
            "last_post_id": res.newest_id,
            "last_post_ts": res.newest_ts,
            "oldest_post_id": ordered[-1].id if ordered else None,
            "oldest_post_ts": ordered[-1].created_at.isoformat() if ordered else None,
            "total_posts": res.total,
            "processed_file_hashes": sorted(done_hashes),
            "last_ingest_run_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "how_to_fetch_next": (
                f"x.get_users_posts(id={settings.user_id}, since_id=last_post_id, exclude=['retweets'], "
                "max_results=25, paginate) -> save raw JSON to data/inbox/<UTCdate>_<n>.json -> billy ingest"
            ),
        }
    )
    save_state(paths.state_file, state)
    log.info("ingest done", extra={"seen": res.seen, "added": res.added, "total": res.total})
    return res
