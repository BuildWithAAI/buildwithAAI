"""YouTube Data API v3 client for the topic finder: search.list, videos.list, channels.list, playlistItems.list.

- Every request is charged to the QuotaBudget before it is sent (retries included); a call the budget cannot afford
  is never sent (BudgetExceeded).
- Answers are normalized to small records and cached per request (search, uploads) or per id (videos, channels),
  so a re-run within the TTL costs nothing.
- quotaExceeded marks the bucket exhausted for the rest of the run; rate limits, 5xx and network errors are retried
  with full-jitter backoff; 404s and per-item 400s are recorded and skipped; auth and 'blocked' errors stop the run.
"""

import random
import time

from . import contracts
from .http import ApiError
from .quota import BudgetExceeded
from .text import parse_duration, rfc3339, truncate

__all__ = ["YouTubeClient", "ApiError", "BudgetExceeded", "normalize_video", "normalize_channel", "to_int"]


def to_int(value):
    """API counts are JSON strings (uint64). Missing or malformed -> None (e.g. hidden likes, disabled comments)."""
    if value is None or isinstance(value, bool):
        return None
    try:
        return int(str(value))
    except ValueError:
        return None


def normalize_video(item, detail="full"):
    vid = item.get("id")
    if not isinstance(vid, str) or not vid:
        return None
    sn = item.get("snippet") or {}
    st = item.get("statistics") or {}
    cd = item.get("contentDetails") or {}
    pl = item.get("player") or {}
    rec = {
        "id": vid,
        "detail": detail,
        "publishedAt": sn.get("publishedAt"),
        "liveBroadcastContent": sn.get("liveBroadcastContent") or "none",
        "durationSec": parse_duration(cd.get("duration")),
        "views": to_int(st.get("viewCount")),
        "likes": to_int(st.get("likeCount")),
        "comments": to_int(st.get("commentCount")),
        "embedWidth": to_int(pl.get("embedWidth")),
        "embedHeight": to_int(pl.get("embedHeight")),
    }
    if detail == "full":
        tags = sn.get("tags") if isinstance(sn.get("tags"), list) else []
        rec.update({
            "channelId": sn.get("channelId"),
            "channelTitle": sn.get("channelTitle"),
            "title": sn.get("title") or "",
            "description": truncate(sn.get("description") or "", 600),
            "tags": [str(t) for t in tags[:25]],
            "categoryId": sn.get("categoryId"),
            "defaultLanguage": sn.get("defaultLanguage"),
            "defaultAudioLanguage": sn.get("defaultAudioLanguage"),
        })
    return rec


def normalize_channel(item):
    cid = item.get("id")
    if not isinstance(cid, str) or not cid:
        return None
    sn = item.get("snippet") or {}
    st = item.get("statistics") or {}
    related = ((item.get("contentDetails") or {}).get("relatedPlaylists") or {})
    return {
        "id": cid,
        "title": sn.get("title") or "",
        "customUrl": sn.get("customUrl"),
        "publishedAt": sn.get("publishedAt"),
        "country": sn.get("country"),
        "defaultLanguage": sn.get("defaultLanguage"),
        "viewCount": to_int(st.get("viewCount")),
        "subscriberCount": None if st.get("hiddenSubscriberCount") else to_int(st.get("subscriberCount")),
        "hiddenSubscriberCount": bool(st.get("hiddenSubscriberCount")),
        "videoCount": to_int(st.get("videoCount")),
        "uploadsPlaylistId": related.get("uploads"),
    }


def _chunks(items, size):
    for i in range(0, len(items), size):
        yield items[i:i + size]


class YouTubeClient:
    def __init__(self, transport, budget, cache=None, log=None, max_attempts=4, sleep=time.sleep, rng=random.random,
                 page_size=contracts.MAX_PAGE_SIZE, max_backoff=32.0):
        if not 1 <= page_size <= contracts.MAX_PAGE_SIZE:
            raise ValueError("page_size must be 1-50")
        self.transport = transport
        self.budget = budget
        self.cache = cache
        self.log = log or (lambda msg: None)
        self.max_attempts = max(1, max_attempts)
        self.sleep = sleep
        self.rng = rng
        self.page_size = page_size
        self.max_backoff = max_backoff
        self.errors = []
        self.stopped = []
        self.sent = 0

    # -- plumbing ------------------------------------------------------------------------------------------------

    def _cache_get(self, namespace, params):
        return self.cache.get(namespace, params) if self.cache else None

    def _cache_put(self, namespace, params, data):
        if self.cache:
            self.cache.put(namespace, params, data)

    def _call(self, method, params):
        attempt = 0
        while True:
            attempt += 1
            self.budget.charge(method)
            self.sent += 1
            try:
                return self.transport.get(method, params)
            except ApiError as err:
                if err.kind == "quota":
                    self.budget.mark_exhausted(method)
                    raise
                if err.retriable and attempt < self.max_attempts and self.budget.affordable(method):
                    delay = err.retry_after if err.retry_after is not None else self.rng() * min(self.max_backoff, 2.0 ** attempt)
                    self.log(f"  retry {attempt}/{self.max_attempts - 1} for {method} after {err.kind} ({delay:.1f} s)")
                    self.sleep(delay)
                    continue
                raise

    def _record(self, err, context):
        entry = err.to_dict()
        entry["context"] = context
        self.errors.append(entry)

    # -- methods -------------------------------------------------------------------------------------------------

    def search(self, q, published_after, order="viewCount", relevance_language=None, region_code=None, pages=1, safe_search=None):
        """Video ids for one query, best first. Returns {'ids': [...], 'pages': n, 'nonVideo': n, 'totalResults': n}."""
        if order not in contracts.SEARCH_ORDERS:
            raise ValueError(f"order must be one of {', '.join(contracts.SEARCH_ORDERS)}")
        ids, seen, token, fetched, non_video, total = [], set(), None, 0, 0, None
        for _ in range(max(1, pages)):
            params = {
                "part": contracts.PARTS["search.list"],
                "type": "video",
                "q": q,
                "order": order,
                "publishedAfter": rfc3339(published_after),
                "maxResults": str(self.page_size),
                "fields": contracts.FIELDS["search.list"],
            }
            if relevance_language:
                params["relevanceLanguage"] = relevance_language
            if region_code:
                params["regionCode"] = region_code
            if safe_search:
                params["safeSearch"] = safe_search
            if token:
                params["pageToken"] = token
            page = self._cache_get("search.list", params)
            if page is None:
                try:
                    data = self._call("search.list", params)
                except BudgetExceeded:
                    if not fetched:
                        raise
                    self.stopped.append({"method": "search.list", "reason": "cap reached before the next page", "query": q})
                    break
                page = {"videoIds": [], "nonVideo": 0, "nextPageToken": data.get("nextPageToken"), "totalResults": (data.get("pageInfo") or {}).get("totalResults")}
                for item in data.get("items") or []:
                    rid = (item or {}).get("id") or {}
                    if rid.get("kind") == "youtube#video" and rid.get("videoId"):
                        page["videoIds"].append(rid["videoId"])
                    else:
                        page["nonVideo"] += 1  # order=viewCount can loosen the type filter (search.list docs)
                self._cache_put("search.list", params, page)
            fetched += 1
            non_video += page.get("nonVideo", 0)
            total = page.get("totalResults", total)
            for vid in page.get("videoIds", []):
                if vid not in seen:
                    seen.add(vid)
                    ids.append(vid)
            token = page.get("nextPageToken")
            if not token:
                break
        return {"ids": ids, "pages": fetched, "nonVideo": non_video, "totalResults": total}

    def videos(self, ids, detail="full"):
        """{id: record} for the ids YouTube returned (deleted or private ids are simply absent)."""
        key = "videos.list" if detail == "full" else "videos.list:baseline"
        out, missing = {}, []
        for vid in dict.fromkeys(ids):
            rec = self._cache_get("videos.list", {"id": vid})
            if rec and (detail == "baseline" or rec.get("detail") == "full"):
                out[vid] = rec
            else:
                missing.append(vid)
        chunks = list(_chunks(sorted(missing), min(self.page_size, contracts.MAX_IDS_PER_CALL)))
        for idx, chunk in enumerate(chunks):
            params = {
                "part": contracts.PARTS[key],
                "id": ",".join(chunk),
                "maxHeight": str(contracts.PLAYER_MAX_HEIGHT),
                "fields": contracts.FIELDS[key],
            }
            try:
                data = self._call("videos.list", params)
            except BudgetExceeded as err:
                self.stopped.append({"method": "videos.list", "detail": detail, "reason": str(err), "unfetched": sum(len(c) for c in chunks[idx:])})
                break
            except ApiError as err:
                if err.kind in ("not-found", "bad-request"):
                    self._record(err, f"videos.list for {len(chunk)} id(s)")
                    continue
                if err.kind == "quota":
                    self._record(err, f"videos.list ({detail})")
                    break
                raise
            for item in data.get("items") or []:
                rec = normalize_video(item, detail)
                if rec:
                    out[rec["id"]] = rec
                    self._cache_put("videos.list", {"id": rec["id"]}, rec)
        return out

    def channels(self, ids):
        out, missing = {}, []
        for cid in dict.fromkeys(ids):
            rec = self._cache_get("channels.list", {"id": cid})
            if rec:
                out[cid] = rec
            else:
                missing.append(cid)
        chunks = list(_chunks(sorted(missing), min(self.page_size, contracts.MAX_IDS_PER_CALL)))
        for idx, chunk in enumerate(chunks):
            # No maxResults: like videos.list, an id list returns every channel it names (up to 50).
            params = {
                "part": contracts.PARTS["channels.list"],
                "id": ",".join(chunk),
                "fields": contracts.FIELDS["channels.list"],
            }
            try:
                data = self._call("channels.list", params)
            except BudgetExceeded as err:
                self.stopped.append({"method": "channels.list", "reason": str(err), "unfetched": sum(len(c) for c in chunks[idx:])})
                break
            except ApiError as err:
                if err.kind in ("not-found", "bad-request"):
                    self._record(err, f"channels.list for {len(chunk)} id(s)")
                    continue
                if err.kind == "quota":
                    self._record(err, "channels.list")
                    break
                raise
            items = data.get("items") or []
            if data.get("nextPageToken") and len(items) < len(chunk):
                # Not expected for an id list (videos.list documents that id lists are not paged); recorded so the
                # first live runs show it if channels.list ever pages one.
                self.errors.append({"method": "channels.list", "kind": "paged-id-list", "status": None, "reason": None,
                                    "message": f"{len(items)} of {len(chunk)} channels came back with a nextPageToken; the rest were not read",
                                    "context": "channels.list id list"})
            for item in items:
                rec = normalize_channel(item)
                if rec:
                    out[rec["id"]] = rec
                    self._cache_put("channels.list", {"id": rec["id"]}, rec)
        return out

    def uploads(self, playlist_id, pages=1):
        """Most recent uploads of a channel [{'videoId', 'videoPublishedAt'}], or None if the playlist is gone."""
        items, token = [], None
        for _ in range(max(1, pages)):
            params = {
                "part": contracts.PARTS["playlistItems.list"],
                "playlistId": playlist_id,
                "maxResults": str(self.page_size),
                "fields": contracts.FIELDS["playlistItems.list"],
            }
            if token:
                params["pageToken"] = token
            page = self._cache_get("playlistItems.list", params)
            if page is None:
                try:
                    data = self._call("playlistItems.list", params)
                except ApiError as err:
                    if err.kind in ("not-found", "bad-request"):
                        self._record(err, f"uploads playlist {playlist_id}")
                        self._cache_put("playlistItems.list", params, {"notFound": True})
                        return None if not items else items
                    raise
                page = {"items": [], "nextPageToken": data.get("nextPageToken")}
                for item in data.get("items") or []:
                    cd = (item or {}).get("contentDetails") or {}
                    if cd.get("videoId"):
                        page["items"].append({"videoId": cd["videoId"], "videoPublishedAt": cd.get("videoPublishedAt")})
                self._cache_put("playlistItems.list", params, page)
            if page.get("notFound"):
                return None if not items else items
            items.extend(page.get("items", []))
            token = page.get("nextPageToken")
            if not token:
                break
        return items
