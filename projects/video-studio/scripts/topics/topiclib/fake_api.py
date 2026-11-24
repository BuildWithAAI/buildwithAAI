"""A stand-in for the YouTube Data API v3, served from a fixture database, for tests and --fixtures runs.

It answers the four methods with resources shaped like the real ones (discovery rev 20261123: counts as strings,
player sizes only with maxHeight/maxWidth, hidden subscriber counts omitted), applies the `fields` selector,
paginates with nextPageToken, and rejects what the real API documents as errors (missing part, maxResults out of
range, more than 50 ids, maxResults together with id on videos.list, unknown parameters, a bad relevanceLanguage,
an unknown playlist). It can also inject failures (quotaExceeded, 5xx, auth errors) from fixtures/api/errors/.

Its search is a small keyword engine: q alternatives split on '|', every word of one alternative must appear in the
title, tags or description (accent-insensitive), '-word' excludes; results are filtered by publishedAfter and by the
fixture video's language when relevanceLanguage is set, then sorted by order."""

import base64
import json
import os
import re

from . import contracts, fields
from .http import classify_error
from .text import fold, parse_time

_KNOWN = {
    "search.list": {"part", "q", "type", "order", "publishedAfter", "publishedBefore", "maxResults", "pageToken", "relevanceLanguage", "regionCode", "safeSearch", "videoDuration", "channelId", "fields", "prettyPrint"},
    "videos.list": {"part", "id", "chart", "maxHeight", "maxWidth", "hl", "pageToken", "maxResults", "regionCode", "fields", "prettyPrint"},
    "channels.list": {"part", "id", "forHandle", "forUsername", "maxResults", "pageToken", "hl", "fields", "prettyPrint"},
    "playlistItems.list": {"part", "playlistId", "id", "maxResults", "pageToken", "videoId", "fields", "prettyPrint"},
}
_PARTS = {
    "search.list": {"snippet", "id"},
    "videos.list": {"brandPartner", "contentDetails", "fileDetails", "id", "liveStreamingDetails", "localizations", "paidProductPlacementDetails", "player", "processingDetails", "recordingDetails", "snippet", "statistics", "status", "suggestions", "topicDetails"},
    "channels.list": {"auditDetails", "brandingSettings", "contentDetails", "contentOwnerDetails", "id", "localizations", "snippet", "statistics", "status", "topicDetails"},
    "playlistItems.list": {"contentDetails", "id", "snippet", "status"},
}
_VIDEO_ONLY_FILTERS = {"videoDuration", "eventType", "videoCaption", "videoCategoryId", "videoDefinition", "videoDimension", "videoEmbeddable", "videoLicense", "videoSyndicated", "videoType"}


class FakeError(Exception):
    pass


def load_db(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _error_body(code, reason, message, status=None, domain="global", info_reason=None):
    err = {"code": code, "message": message, "errors": [{"message": message, "domain": domain, "reason": reason}]}
    if status:
        err["status"] = status
    if info_reason:
        err["details"] = [{"@type": "type.googleapis.com/google.rpc.ErrorInfo", "reason": info_reason, "domain": "googleapis.com", "metadata": {"service": "youtube.googleapis.com"}}]
    return {"error": err}


def _token(offset):
    return base64.urlsafe_b64encode(f"o:{offset}".encode()).decode().rstrip("=")


def _offset(token):
    try:
        raw = base64.urlsafe_b64decode(token + "=" * (-len(token) % 4)).decode()
        if raw.startswith("o:"):
            return int(raw[2:])
    except (ValueError, UnicodeDecodeError):
        pass
    return None


class FakeYouTube:
    def __init__(self, db, failures=None, errors_dir=None):
        self.db = db
        self.videos = {v["id"]: v for v in db.get("videos", [])}
        self.channels = {c["id"]: c for c in db.get("channels", [])}
        self.playlists = {c["uploadsPlaylistId"]: c["id"] for c in db.get("channels", []) if c.get("uploadsPlaylistId") and not c.get("uploadsMissing")}
        self.loosen_type_filter = bool(db.get("loosenTypeFilter"))
        self.failures = [dict(f) for f in (failures or [])]
        self.errors_dir = errors_dir
        self.calls = []
        self.counts = {}

    # -- entry point ---------------------------------------------------------------------------------------------

    def get(self, method, params):
        if method not in _KNOWN:
            raise FakeError(f"unknown method {method}")
        params = {k: str(v) for k, v in params.items()}
        if "key" in params:
            raise FakeError("the API key must travel in the x-goog-api-key header, not the query string")
        self.calls.append((method, dict(params)))
        self.counts[method] = self.counts.get(method, 0) + 1
        self._maybe_fail(method)
        unknown = sorted(set(params) - _KNOWN[method])
        if unknown:
            self._raise(method, 400, _error_body(400, "unexpectedParameter", f"The request specifies an unexpected parameter: {', '.join(unknown)}.", "INVALID_ARGUMENT"))
        part = params.get("part")
        if not part:
            self._raise(method, 400, _error_body(400, "missingRequiredParameter", "No filter selected. Expected one of: part", "INVALID_ARGUMENT"))
        parts = [p.strip() for p in part.split(",") if p.strip()]
        bad = [p for p in parts if p not in _PARTS[method]]
        if bad:
            self._raise(method, 400, _error_body(400, "unknownPart", f"'{bad[0]}'", "INVALID_ARGUMENT"))
        handler = {"search.list": self._search, "videos.list": self._videos, "channels.list": self._channels, "playlistItems.list": self._playlist_items}[method]
        body = handler(params, set(parts))
        if params.get("fields"):
            try:
                tree = fields.parse(params["fields"])
            except fields.FieldsError as err:
                self._raise(method, 400, _error_body(400, "invalidParameter", f"Invalid field selection: {err}", "INVALID_ARGUMENT"))
            body = fields.apply(tree, body)
        return json.loads(json.dumps(body))

    # -- failures ------------------------------------------------------------------------------------------------

    def _maybe_fail(self, method):
        for f in self.failures:
            if f.get("method") not in (method, "*"):
                continue
            if self.counts[method] <= f.get("after", 0) or f.get("times", 1) <= 0:
                continue
            f["times"] = f.get("times", 1) - 1
            status = f.get("status", 500)
            if "rawBody" in f:
                raise classify_error(method, status, f["rawBody"].encode("utf-8"))
            body = f.get("body")
            if body is None and f.get("error") and self.errors_dir:
                with open(os.path.join(self.errors_dir, f["error"] + ".json"), encoding="utf-8") as fh:
                    body = json.load(fh)
                    status = body.get("error", {}).get("code", status)
            self._raise(method, status, body or _error_body(status, "backendError", "Backend Error"))

    @staticmethod
    def _raise(method, status, body):
        raise classify_error(method, status, json.dumps(body).encode("utf-8"))

    def _max_results(self, method, params, default=5, low=0):
        raw = params.get("maxResults")
        if raw is None:
            return default
        if not re.fullmatch(r"\d+", raw) or not low <= int(raw) <= 50:
            self._raise(method, 400, _error_body(400, "invalidValue", f"Invalid value '{raw}'. Values must be within the range: [{low}, 50]", "INVALID_ARGUMENT"))
        return int(raw)

    def _ids(self, method, params):
        ids = [i for i in params["id"].split(",") if i]
        if len(ids) > 50:
            self._raise(method, 400, _error_body(400, "invalidValue", "The request specifies more than 50 ids.", "INVALID_ARGUMENT"))
        return ids

    # -- search.list ---------------------------------------------------------------------------------------------

    def _search(self, params, parts):
        method = "search.list"
        if "q" not in params:
            self._raise(method, 400, _error_body(400, "missingRequiredParameter", "q is required by this fake", "INVALID_ARGUMENT"))
        if params.get("type", "video,channel,playlist") != "video" and _VIDEO_ONLY_FILTERS & set(params):
            self._raise(method, 400, _error_body(400, "invalidSearchFilter", "The request contains an invalid combination of search filters and/or restrictions.", "INVALID_ARGUMENT", domain="youtube.search"))
        order = params.get("order", "relevance")
        if order not in contracts.SEARCH_ORDERS:
            self._raise(method, 400, _error_body(400, "invalidValue", f"Invalid value '{order}' for order", "INVALID_ARGUMENT"))
        lang = params.get("relevanceLanguage")
        if lang is not None and not re.fullmatch(r"[a-z]{2,3}(-Han[st])?", lang):
            self._raise(method, 400, _error_body(400, "invalidRelevanceLanguage", "The relevanceLanguage parameter value was formatted incorrectly.", "INVALID_ARGUMENT", domain="youtube.search"))
        after = parse_time(params["publishedAfter"]) if "publishedAfter" in params else None
        if "publishedAfter" in params and after is None:
            self._raise(method, 400, _error_body(400, "invalidValue", "Invalid value for publishedAfter", "INVALID_ARGUMENT"))
        size = self._max_results(method, params)
        alternatives, excluded = self._parse_q(params["q"])
        hits = []
        for v in self.db.get("videos", []):
            if after and parse_time(v["publishedAt"]) < after:
                continue
            if lang and v.get("lang") != lang:
                continue
            blob = fold(" ".join([v.get("title", ""), " ".join(v.get("tags", [])), v.get("description", "")]))
            if any(self._has(blob, w) for w in excluded):
                continue
            matched = sum(1 for alt in alternatives if alt and all(self._has(blob, w) for w in alt))
            if matched:
                hits.append((matched, v))
        if order == "viewCount":
            hits.sort(key=lambda h: (-int(h[1]["viewCount"]), h[1]["id"]))
        elif order == "date":
            hits.sort(key=lambda h: (h[1]["publishedAt"], h[1]["id"]), reverse=True)
        else:
            hits.sort(key=lambda h: (-h[0], -int(h[1]["viewCount"]), h[1]["id"]))
        items = [self._search_item(v) for _m, v in hits]
        if self.loosen_type_filter and order != "relevance" and len(items) >= 3:
            items.insert(2, {"kind": "youtube#searchResult", "etag": "fixture", "id": {"kind": "youtube#channel", "channelId": hits[0][1]["channelId"]}, "snippet": {"title": "channel result"}})
        start = _offset(params["pageToken"]) if params.get("pageToken") else 0
        if start is None:
            self._raise(method, 400, _error_body(400, "invalidPageToken", "The request specifies an invalid page token.", "INVALID_ARGUMENT"))
        page = items[start:start + size]
        body = {"kind": "youtube#searchListResponse", "etag": "fixture", "regionCode": params.get("regionCode", "US"),
                "pageInfo": {"totalResults": len(items), "resultsPerPage": size}, "items": page}
        if start + size < len(items):
            body["nextPageToken"] = _token(start + size)
        return body

    @staticmethod
    def _parse_q(q):
        excluded = [fold(t[1:]) for t in q.split() if t.startswith("-") and len(t) > 1]
        positive = " ".join(t for t in q.split() if not (t.startswith("-") and len(t) > 1))
        alternatives = [[w for w in fold(alt).split() if w] for alt in positive.split("|")]
        return alternatives, excluded

    @staticmethod
    def _has(blob, word):
        return re.search(r"(?<![a-z0-9])" + re.escape(word) + r"(?![a-z0-9])", blob) is not None

    def _search_item(self, v):
        ch = self.channels.get(v["channelId"], {})
        return {"kind": "youtube#searchResult", "etag": "fixture", "id": {"kind": "youtube#video", "videoId": v["id"]},
                "snippet": {"publishedAt": v["publishedAt"], "channelId": v["channelId"], "title": v["title"], "description": v.get("description", "")[:160],
                            "thumbnails": {"default": {"url": f"https://i.ytimg.com/vi/{v['id']}/default.jpg", "width": 120, "height": 90}},
                            "channelTitle": ch.get("title", ""), "liveBroadcastContent": v.get("liveBroadcastContent", "none"), "publishTime": v["publishedAt"]}}

    # -- videos.list ---------------------------------------------------------------------------------------------

    def _videos(self, params, parts):
        method = "videos.list"
        filters = [k for k in ("id", "chart", "myRating") if k in params]
        if len(filters) != 1:
            self._raise(method, 400, _error_body(400, "missingRequiredParameter", "Specify exactly one of id, chart, myRating.", "INVALID_ARGUMENT"))
        if "id" not in params:
            self._raise(method, 400, _error_body(400, "invalidFilters", "Only id is supported by this fake.", "INVALID_ARGUMENT"))
        if "maxResults" in params or "pageToken" in params:
            self._raise(method, 400, _error_body(400, "incompatibleParameters", "maxResults and pageToken are not supported with id.", "INVALID_ARGUMENT"))
        for dim in ("maxHeight", "maxWidth"):
            if dim in params and (not params[dim].isdigit() or not 72 <= int(params[dim]) <= 8192):
                self._raise(method, 400, _error_body(400, "invalidValue", f"{dim} must be 72-8192", "INVALID_ARGUMENT"))
        items = []
        for vid in self._ids(method, params):
            v = self.videos.get(vid)
            if v:
                items.append(self._video_resource(v, parts, params))
        return {"kind": "youtube#videoListResponse", "etag": "fixture", "items": items, "pageInfo": {"totalResults": len(items), "resultsPerPage": len(items)}}

    def _video_resource(self, v, parts, params):
        ch = self.channels.get(v["channelId"], {})
        res = {"kind": "youtube#video", "etag": "fixture", "id": v["id"]}
        if "snippet" in parts:
            sn = {"publishedAt": v["publishedAt"], "channelId": v["channelId"], "title": v["title"], "description": v.get("description", ""),
                  "thumbnails": {"default": {"url": f"https://i.ytimg.com/vi/{v['id']}/default.jpg", "width": 120, "height": 90}},
                  "channelTitle": ch.get("title", ""), "categoryId": v.get("categoryId", "28"), "liveBroadcastContent": v.get("liveBroadcastContent", "none"),
                  "localized": {"title": v["title"], "description": v.get("description", "")}}
            if v.get("tags"):
                sn["tags"] = list(v["tags"])
            for k in ("defaultLanguage", "defaultAudioLanguage"):
                if v.get(k):
                    sn[k] = v[k]
            res["snippet"] = sn
        if "contentDetails" in parts:
            res["contentDetails"] = {"duration": v["duration"], "dimension": "2d", "definition": "hd", "caption": "false", "licensedContent": False, "contentRating": {}, "projection": "rectangular"}
        if "statistics" in parts:
            st = {"viewCount": str(v["viewCount"]), "favoriteCount": "0"}
            if v.get("likeCount") is not None:
                st["likeCount"] = str(v["likeCount"])
            if v.get("commentCount") is not None:
                st["commentCount"] = str(v["commentCount"])
            res["statistics"] = st
        if "player" in parts:
            player = {"embedHtml": f"<iframe width=\"480\" height=\"270\" src=\"//www.youtube.com/embed/{v['id']}\" frameborder=\"0\" allowfullscreen></iframe>"}
            aspect = v.get("aspect")
            max_h = int(params["maxHeight"]) if params.get("maxHeight") else None
            max_w = int(params["maxWidth"]) if params.get("maxWidth") else None
            if aspect and (max_h or max_w):
                aw, ah = (int(x) for x in aspect.split(":"))
                if max_h and (not max_w or max_h * aw / ah <= max_w):
                    h, w = max_h, round(max_h * aw / ah)
                else:
                    w, h = max_w, round(max_w * ah / aw)
                player["embedWidth"], player["embedHeight"] = str(w), str(h)
            res["player"] = player
        return res

    # -- channels.list -------------------------------------------------------------------------------------------

    def _channels(self, params, parts):
        method = "channels.list"
        filters = [k for k in ("id", "forHandle", "forUsername") if k in params]
        if len(filters) != 1:
            self._raise(method, 400, _error_body(400, "invalidCriteria", "A maximum of one of the following filters may be specified: id, forHandle, forUsername.", "INVALID_ARGUMENT", domain="youtube.channel"))
        if "id" not in params:
            self._raise(method, 400, _error_body(400, "invalidFilters", "Only id is supported by this fake.", "INVALID_ARGUMENT"))
        items = []
        for cid in self._ids(method, params):
            c = self.channels.get(cid)
            if not c:
                continue
            res = {"kind": "youtube#channel", "etag": "fixture", "id": c["id"]}
            if "snippet" in parts:
                sn = {"title": c["title"], "description": c.get("description", ""), "customUrl": c.get("customUrl"), "publishedAt": c["publishedAt"],
                      "thumbnails": {"default": {"url": "https://yt3.ggpht.com/fixture", "width": 88, "height": 88}}, "localized": {"title": c["title"], "description": ""}}
                for k in ("country", "defaultLanguage"):
                    if c.get(k):
                        sn[k] = c[k]
                res["snippet"] = {k: v for k, v in sn.items() if v is not None}
            if "contentDetails" in parts:
                res["contentDetails"] = {"relatedPlaylists": {"likes": "", "uploads": c.get("uploadsPlaylistId", "")}}
            if "statistics" in parts:
                st = {"viewCount": str(c["viewCount"]), "hiddenSubscriberCount": bool(c.get("hiddenSubscriberCount")), "videoCount": str(c["videoCount"])}
                if not c.get("hiddenSubscriberCount"):
                    st["subscriberCount"] = str(c.get("subscriberCount", 0))
                res["statistics"] = st
            items.append(res)
        return {"kind": "youtube#channelListResponse", "etag": "fixture", "pageInfo": {"totalResults": len(items), "resultsPerPage": len(items)}, "items": items}

    # -- playlistItems.list --------------------------------------------------------------------------------------

    def _playlist_items(self, params, parts):
        method = "playlistItems.list"
        if ("playlistId" in params) == ("id" in params):
            self._raise(method, 400, _error_body(400, "playlistIdRequired", "Specify exactly one of playlistId and id.", "INVALID_ARGUMENT", domain="youtube.playlistItem"))
        pid = params.get("playlistId")
        cid = self.playlists.get(pid)
        if not cid:
            self._raise(method, 404, _error_body(404, "playlistNotFound", "The playlist identified with the request's <code>playlistId</code> parameter cannot be found.", "NOT_FOUND", domain="youtube.playlistItem"))
        size = self._max_results(method, params)
        uploads = sorted((v for v in self.db.get("videos", []) if v["channelId"] == cid), key=lambda v: (v["publishedAt"], v["id"]), reverse=True)
        start = _offset(params["pageToken"]) if params.get("pageToken") else 0
        if start is None:
            self._raise(method, 400, _error_body(400, "invalidPageToken", "The request specifies an invalid page token.", "INVALID_ARGUMENT"))
        page = uploads[start:start + size]
        items = []
        for v in page:
            item = {"kind": "youtube#playlistItem", "etag": "fixture", "id": f"PLI{v['id']}"}
            if "contentDetails" in parts:
                item["contentDetails"] = {"videoId": v["id"], "videoPublishedAt": v["publishedAt"]}
            items.append(item)
        body = {"kind": "youtube#playlistItemListResponse", "etag": "fixture", "items": items, "pageInfo": {"totalResults": len(uploads), "resultsPerPage": size}}
        if start + size < len(uploads):
            body["nextPageToken"] = _token(start + size)
        return body
