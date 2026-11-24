"""YouTube Data API v3 contracts and YouTube API Services policies the topic finder relies on.

Every value below was read directly on 2026-11-24 from the official pages (developers.google.com answered through
the session proxy that day) and from the live discovery document. Page dates are each page's "Last updated" line.

API (all four methods are GET; an API key is enough for public data):
- Discovery document rev 20261123, https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest : rootUrl
  https://youtube.googleapis.com/ , paths youtube/v3/search, youtube/v3/videos, youtube/v3/channels,
  youtube/v3/playlistItems. Global parameters include key ("API key ... Required unless you provide an OAuth 2.0
  token"), fields ("Selector specifying which fields to include in a partial response") and prettyPrint. Counts
  (viewCount, likeCount, commentCount, subscriberCount, videoCount) and player.embedWidth/embedHeight are JSON
  strings (uint64/int64); pageInfo.totalResults is an integer.
- search.list (updated 2026-11-12), https://developers.google.com/youtube/data/reference/rest/v3/search/list :
  "Quota impact: 100 calls per day. A call to this method has a quota cost of 1 unit in the Search Queries quota
  bucket." part=snippet is required. maxResults 0-50, default 5; "The API may return fewer items than the requested
  maxResults per page ... Always rely on the nextPageToken". order=viewCount sorts "from highest to lowest number of
  views", but "Specifying a sort order other than relevance might result in a smaller or incomplete result set,
  particularly when combined with date filters like publishedAfter", and "the strict filtering of the type parameter
  might occasionally be affected, resulting in unexpected resource types in the response" (so non-video results are
  filtered out here). publishedAfter is RFC 3339. q supports OR (|, sent URL-escaped as %7C) and NOT (-).
  relevanceLanguage is "typically an ISO 639-1 two-letter language code". To list a channel's recent uploads, "do not
  use search.list. Instead, use the playlistItems.list method to fetch the channel's uploads playlist."
- videos.list, channels.list, playlistItems.list (each updated 2026-11-12): "Quota impact: A call to this method has
  a quota cost of 1 unit." id takes a comma-separated list; maxResults is not supported together with id on
  videos.list. player.embedWidth/embedHeight are "only returned if the request specified a value for the maxHeight
  and/or maxWidth parameters and the video's aspect ratio is known" (used here to tell vertical Shorts from
  long-form). channels contentDetails.relatedPlaylists.uploads is "The ID of the playlist that contains the
  channel's uploaded videos". statistics.dislikeCount is private since 2021-12-13.
- Quota Calculator (updated 2026-11-12), https://developers.google.com/youtube/data/determine_quota_cost : "default
  quota allocation of 100 search.list calls, 100 videos.insert calls, and 10,000 units per day combined for all other
  endpoints"; "The search.list and videos.insert methods have their own quota buckets ... The quota cost is 1 per
  call"; "each request to retrieve an additional page of results incurs the estimated quota cost"; "All API
  requests, including invalid requests, incur a quota cost of at least one point"; quotas reset at midnight Pacific
  Time. The task brief's "search.list = 100 units" is the pre-2026-06-01 figure (revision history 2026-06-01:
  "API calls to the videos.insert and search.list methods will be charged to their own respective quota buckets").
  The costs live in scripts/topics/quota.json so a change needs no code edit.
- Errors (updated 2026-11-18), https://developers.google.com/youtube/data/reference/rest/v3/errors : core errors
  forbidden (403) and quotaExceeded (403); common 400s incompatibleParameters, invalidFilters, invalidPageToken,
  missingRequiredParameter, unexpectedParameter; search.list 400s invalidChannelId, invalidLocation,
  invalidRelevanceLanguage, invalidSearchFilter; channels.list 404 channelNotFound; playlistItems.list 403
  playlistItemsNotAccessible and 404 playlistNotFound; videos.list 404 videoNotFound.
- View counting (revision history, updated 2026-11-17): Shorts count every start or replay from 2025-03-31; all
  formats count "the moment a video begins to play (includes autoplay, hold the pointer over, and click/tap to
  play)" from 2026-08-27; co-views on TV screens are included from 2026-11-16. VIEW_COUNT_EPOCHS below.
- Credentials (updated 2026-11-12), https://developers.google.com/youtube/data/guides/authentication : "Use an API key
  for requests that only retrieve public data, such as public video metadata or search results"; "Restrict the key
  before using it in production". The key travels in the x-goog-api-key header (Google Cloud's documented header for
  API keys; its page, docs.cloud.google.com, is blocked in this session, so that page was read only through a search
  extract, which also says the key query parameter exposes the key in URLs). --key-in-query switches to the
  documented key query parameter if a project ever rejects the header.

Policies (these decide what the tool may compute and keep):
- Developer Policies (updated 2026-11-06), https://developers.google.com/youtube/terms/developer-policies :
  III.E.4: "Your API Clients must not ... (ii) access or use API Data to create new or derived data or metrics", and
  Non-Authorized Data (public data fetched with an API key) may be stored "not longer than 30 calendar days"; "an API
  Client must not store statistics retrieved as Non-Authorized Data for more than 30 days". III.D: "you must create
  exactly one (1) API Project for that API Client" and must not "embed your API Credentials in open source
  projects". III.E.2: do not aggregate API Data "to gain insights into YouTube's usage, revenue, or any other aspects
  of YouTube's business". III.L: the derived-metrics allowances apply "only ... to audited developers with analytics
  use cases that have explicitly applied for permission to create additional metrics ... through the standard quota
  extension request from (starting June 01, 2026)".
- Additional policies for derived metrics and data storage (updated 2026-09-14),
  https://developers.google.com/youtube/terms/derived-metrics-policy : "Custom Channel Scores and Ratios" ("scores ...
  based on independently calculated averages, sums, or ratios of API Data") and "Content Categorization and Tagging"
  are acceptable after accepting the amendment in the Audit and Quota Extension Form ("select 'Section 5: Use Cases,
  API Integration, and Feature Implementation' then 'Analytics & Reporting'"); "You must distinguish these metrics
  from metrics sourced from API Data"; titles, creator names and descriptions keep the 30-day rule.
  So the outlier score, the engagement score and the ranking are allowed only once the owner's project has accepted
  that amendment. Live runs refuse to start until config.json records it (pipeline.compliance_gate).
"""

API_ROOT = "https://youtube.googleapis.com/youtube/v3"
DISCOVERY_REVISION = "20261123"
CHECKED = "2026-11-24"

ENDPOINTS = {
    "search.list": "search",
    "videos.list": "videos",
    "channels.list": "channels",
    "playlistItems.list": "playlistItems",
}

KEY_HEADER = "x-goog-api-key"
KEY_ENV = "YOUTUBE_API_KEY"

MAX_PAGE_SIZE = 50  # search.list, channels.list and playlistItems.list maxResults 0-50
MAX_IDS_PER_CALL = 50  # videos.list / channels.list id lists, kept at the page size

SEARCH_ORDERS = ("date", "rating", "relevance", "title", "videoCount", "viewCount")
SAFE_SEARCH = ("none", "moderate", "strict")

# Parts and partial-response selectors (getting-started "How to use the fields parameter", updated 2026-11-12:
# comma lists, a(b,c) groups and a/b nesting). Only what the tool uses is requested, which also keeps the amount
# of stored Non-Authorized Data small (Developer Policies III.E.4.d: "limited amounts").
PARTS = {
    "search.list": "snippet",
    "videos.list": "snippet,statistics,contentDetails,player",
    "videos.list:baseline": "snippet,statistics,contentDetails,player",
    "channels.list": "snippet,statistics,contentDetails",
    "playlistItems.list": "contentDetails",
}
FIELDS = {
    "search.list": "nextPageToken,pageInfo(totalResults,resultsPerPage),items(id(kind,videoId))",
    "videos.list": (
        "items(id,snippet(publishedAt,channelId,title,description,channelTitle,tags,categoryId,"
        "liveBroadcastContent,defaultLanguage,defaultAudioLanguage),statistics(viewCount,likeCount,commentCount),"
        "contentDetails(duration),player(embedWidth,embedHeight))"
    ),
    "videos.list:baseline": (
        "items(id,snippet(publishedAt,liveBroadcastContent),statistics(viewCount,likeCount,commentCount),"
        "contentDetails(duration),player(embedWidth,embedHeight))"
    ),
    "channels.list": (
        "items(id,snippet(title,customUrl,publishedAt,country,defaultLanguage),"
        "statistics(viewCount,subscriberCount,hiddenSubscriberCount,videoCount),contentDetails(relatedPlaylists(uploads)))"
    ),
    "playlistItems.list": "nextPageToken,items(contentDetails(videoId,videoPublishedAt))",
}
# Any value in 72-8192 makes videos.list return player.embedWidth/embedHeight when the aspect ratio is known.
PLAYER_MAX_HEIGHT = 360

# Error reasons (errors page and Google's error envelope). Kinds drive what the client does.
QUOTA_REASONS = {"quotaExceeded", "dailyLimitExceeded", "dailyLimitExceededUnreg"}
RATE_REASONS = {"rateLimitExceeded", "userRateLimitExceeded", "RATE_LIMIT_EXCEEDED"}
SERVER_REASONS = {"backendError", "internalError", "serviceUnavailable"}
AUTH_REASONS = {
    "keyInvalid", "keyExpired", "accessNotConfigured", "forbidden", "ipRefererBlocked",
    "API_KEY_INVALID", "API_KEY_SERVICE_BLOCKED", "API_KEY_HTTP_REFERRER_BLOCKED", "API_KEY_IP_ADDRESS_BLOCKED",
    "API_KEY_ANDROID_APP_BLOCKED", "API_KEY_IOS_APP_BLOCKED", "SERVICE_DISABLED", "ACCESS_DENIED", "CONSUMER_INVALID",
}
NOT_FOUND_REASONS = {"playlistNotFound", "channelNotFound", "videoNotFound", "playlistItemsNotAccessible", "channelForbidden"}
RETRIABLE_STATUS = (500, 502, 503, 504)

# Public view counts changed meaning on these dates (revision history). A baseline should compare like with like:
# the pipeline prefers baseline uploads published on or after the latest epoch that applies to the candidate.
VIEW_COUNT_EPOCHS = (
    {"date": "2025-03-31", "formats": ("short",), "change": "Shorts views count every start or replay (revision history 2025-03-26)"},
    {"date": "2026-08-27", "formats": ("short", "long"), "change": "all formats count from the first frame, including autoplay and hover (revision history 2026-08-27)"},
)
VIEW_COUNT_NOTES = (
    "2026-11-16: co-views (several people watching one TV) are included in public view counts for all formats "
    "(revision history). Candidates and baselines are read at the same moment, so it shifts both; it is not modelled.",
)

POLICY = {
    "developerPolicies": "https://developers.google.com/youtube/terms/developer-policies",
    "derivedMetrics": "https://developers.google.com/youtube/terms/derived-metrics-policy",
    "auditForm": "https://support.google.com/youtube/contact/yt_api_form",
    "termsOfService": "https://developers.google.com/youtube/terms/api-services-terms-of-service",
    "youtubeTerms": "https://www.youtube.com/t/terms",
    "googlePrivacy": "https://policies.google.com/privacy",
    "quotaCalculator": "https://developers.google.com/youtube/data/determine_quota_cost",
    "retentionDays": 30,
}

WATCH_URL = "https://www.youtube.com/watch?v={id}"
CHANNEL_URL = "https://www.youtube.com/channel/{id}"
