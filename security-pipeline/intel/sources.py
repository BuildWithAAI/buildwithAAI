"""Source fetchers. Each returns a list of partially-normalized dicts:
   {time_utc, source, source_type, title, url, summary, chain?, entity?, category?, loss_usd?, status?, raw?}
Fetchers raise on failure; the ingest layer isolates failures per source."""
from __future__ import annotations
import json, logging, re
from datetime import timedelta
from urllib.parse import quote_plus
import feedparser
from bs4 import BeautifulSoup
from common import http
from common.util import iso, now_utc, parse_time, strip_html
from . import normalize as N

log = logging.getLogger("intel.sources")
CRYPTO_RE = re.compile(r"\b(crypto\w*|bitcoin|blockchain|wallet|defi|token|ethereum|solana|metatrader|mt5|forex|exchange|stablecoin|nft|web3|binance|bybit|coinbase)\b", re.I)


class SourceBlocked(Exception):
    pass


# ---------------- DeFiLlama hacks ----------------
def _llama_category(x: dict) -> str:
    cls = (x.get("classification") or "").lower()
    tech = (x.get("technique") or "").lower()
    tgt = (x.get("targetType") or "").lower()
    if any(k in tech for k in ("phish", "drainer", "social engineering", "address poisoning", "impersonat")):
        return "drainer_phishing"
    if "rug" in cls or "rug" in tech or "exit scam" in tech:
        return "rug_pull"
    if tgt == "cex":
        return "exchange_hack"
    if x.get("bridgeHack") or "bridge" in cls or "cross-chain" in cls:
        return "bridge_exploit"
    if "supply chain" in tech or "frontend" in tech or "dns" in tech or "frontend" in cls:
        return "supply_chain"
    if "malware" in tech:
        return "malware"
    return "defi_exploit"


def fetch_defillama(src: dict, max_age_days: int = 20000) -> list[dict]:
    data = http.get_json(src["url"], timeout=45)
    if not isinstance(data, list) or not data or "date" not in data[0]:
        raise ValueError("unexpected DeFiLlama schema")
    cutoff = now_utc() - timedelta(days=max_age_days)
    out = []
    for x in data:
        t = parse_time(x.get("date"))
        if not t or t < cutoff:
            continue
        chains = x.get("chain") or []
        desc = x.get("description") or ""
        status = None
        if x.get("returnedFunds"):
            status = "mitigated"
        elif N.RESOLVED.search(desc):
            status = "mitigated"
        name = x.get("name") or "unknown"
        title = f"{name}: {x.get('technique') or x.get('classification') or 'incident'}"
        if x.get("amount"):
            title += f" (${x['amount']/1e6:,.2f}M)"
        out.append({
            "natural_key": f"defillama|{name}|{t.date().isoformat()}",
            "time_utc": iso(t), "source": src["name"], "source_type": "incident_db",
            "title": title, "url": x.get("source") or "https://defillama.com/hacks",
            "summary": desc, "chain": ",".join(chains[:4]) if chains else None,
            "entity": re.sub(r"\s+CEX$", "", name), "category": _llama_category(x),
            "loss_usd": float(x["amount"]) if x.get("amount") else None, "status": status,
            "raw": x,
        })
    return out


# ---------------- rekt.news ----------------
def fetch_rekt(src: dict, **_) -> list[dict]:
    html = http.get(src["url"]).text
    soup = BeautifulSoup(html, "html.parser")
    out = []
    for art in soup.select("article.post"):
        a = art.select_one(".post-title a")
        tm = art.select_one("time")
        if not a or not tm:
            continue
        title = a.get_text(" ", strip=True)
        excerpt = art.select_one(".post-excerpt p")
        summary = excerpt.get_text(" ", strip=True) if excerpt else ""
        tags = [t.get_text(strip=True) for t in art.select(".post-meta p a")]
        t = parse_time(tm.get_text(strip=True))
        if not t:
            continue
        entity = tags[0] if tags and tags[0].lower() not in {"rekt", "rekt news"} else None
        text = f"{title} {summary}"
        out.append({
            "time_utc": iso(t), "source": src["name"], "source_type": "analysis",
            "title": title, "url": "https://rekt.news" + a["href"] if a["href"].startswith("/") else a["href"],
            "summary": summary, "entity": entity,
            "category": N.classify(text) if N.classify(text) != "other" else "defi_exploit" if "rekt" in title.lower() else "other",
            "loss_usd": N.extract_loss(text), "raw": {"tags": tags},
        })
    if not out:
        raise ValueError("rekt.news layout changed: 0 articles parsed")
    return out


# ---------------- RSS / Atom ----------------
def _keep(text: str, flt: str) -> bool:
    if flt == "all":
        return True
    if flt == "crypto_security":
        return N.is_security_relevant(text) and bool(CRYPTO_RE.search(text))
    return N.is_security_relevant(text)


def fetch_rss(src: dict, max_age_days: int = 120) -> list[dict]:
    r = http.get(src["url"])
    feed = feedparser.parse(r.content)
    if feed.bozo and not feed.entries:
        raise ValueError(f"unparseable feed: {feed.bozo_exception}")
    age = src.get("max_age_days", max_age_days)
    cutoff = now_utc() - timedelta(days=age)
    out, newest = [], None
    for e in feed.entries:
        t = parse_time(e.get("published") or e.get("updated") or e.get("created"))
        if not t:
            continue
        newest = max(newest or t, t)
        if t < cutoff:
            continue
        title = strip_html(e.get("title", ""))
        summary = strip_html(e.get("summary", ""))[:1500]
        text = f"{title}. {summary}"
        flt = src.get("filter", "security")
        if flt != "all" and not (_keep(title, flt) or (_keep(text, flt) and N.LOSS_CTX.search(title))):
            continue
        out.append({"time_utc": iso(t), "source": src["name"], "source_type": "news",
                    "title": title, "url": e.get("link"), "summary": summary})
    if newest and newest < cutoff:
        raise SourceBlocked(f"stale feed: newest entry {iso(newest)}")
    return out


# ---------------- Google News search RSS ----------------
def fetch_google_news(src: dict, max_age_days: int = 120) -> list[dict]:
    window = src.get("window", "30d")
    q = quote_plus(f"{src['query']} when:{window}")
    url = f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"
    feed = feedparser.parse(http.get(url).content)
    out = []
    for e in feed.entries:
        t = parse_time(e.get("published"))
        if not t:
            continue
        title = strip_html(e.get("title", ""))
        publisher = (e.get("source") or {}).get("title") or ""
        if publisher and title.endswith(" - " + publisher):
            title = title[: -len(publisher) - 3]
        if re.search(r"referral code|sign[- ]?up bonus|welcome (bonus|rewards)|promo code|youtube", f"{title} {publisher}", re.I):
            continue
        if not N.is_security_relevant(title):
            continue
        out.append({"time_utc": iso(t), "source": src["name"], "source_type": "news_search",
                    "title": title, "url": e.get("link"), "summary": f"via {publisher}" if publisher else "",
                    "raw": {"publisher": publisher}})
    return out


# ---------------- Bybit announcements ----------------
BYBIT_KEEP_CATS = {"maintenance_updates", "latest_bybit_news", "delistings", "product_updates", "Security"}


def fetch_bybit(src: dict, **_) -> list[dict]:
    html = http.get(src["url"]).text
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    if not m:
        raise ValueError("Bybit announcements: __NEXT_DATA__ not found (layout changed or blocked)")
    data = json.loads(m.group(1))
    found = []

    def walk(o):
        if isinstance(o, dict):
            if "articleInitEntity" in o and isinstance(o["articleInitEntity"], dict):
                found.extend(o["articleInitEntity"].get("list") or [])
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(data)
    if not found:
        raise ValueError("Bybit announcements: 0 articles in page data")
    out = []
    for a in found:
        cat_key = (a.get("category") or {}).get("key", "")
        title = a.get("title") or ""
        sec = N.classify(title)
        if cat_key not in BYBIT_KEEP_CATS and sec == "other":
            continue
        t = parse_time(a.get("publish_time") or a.get("date_timestamp"))
        if not t:
            continue
        url = "https://announcements.bybit.com/en" + a["url"] if a.get("url", "").startswith("/") else a.get("url")
        out.append({"time_utc": iso(t), "source": src["name"], "source_type": "official",
                    "title": title, "url": url, "summary": (a.get("description") or "")[:500],
                    "entity": "Bybit", "category": sec if sec not in ("other", "regulatory") else "exchange_notice",
                    "raw": {"category": cat_key, "topics": a.get("topics")}})
    return out


def fetch_blofin(src: dict, **_) -> list[dict]:
    r = http.session().get(src["url"], timeout=20)
    if r.status_code in (403, 503) or "cf-chl" in r.text or "Just a moment" in r.text:
        raise SourceBlocked(f"HTTP {r.status_code}: Cloudflare bot protection blocks unattended fetch")
    r.raise_for_status()
    raise ValueError("BloFin page fetched but no parser implemented for its current layout")


FETCHERS = {"defillama_hacks": fetch_defillama, "rekt": fetch_rekt, "rss": fetch_rss,
            "google_news": fetch_google_news, "bybit_announcements": fetch_bybit,
            "blofin_announcements": fetch_blofin}
