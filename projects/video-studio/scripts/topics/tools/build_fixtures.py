#!/usr/bin/env python3
"""Builds scripts/topics/fixtures/api/db.json: a SYNTHETIC YouTube database for the fake API (tests and --fixtures).

Nothing here is a real channel or video. Ids are derived from names with SHA-256, view histories are drawn from a
seeded log-normal around each channel's target median, and every channel title ends in "(synthetic)". The scenarios
cover what the topic finder must get right; each candidate's `scenario` field says which check it exercises.

    python3 scripts/topics/tools/build_fixtures.py          # rewrite the database (deterministic)
    python3 scripts/topics/tools/build_fixtures.py --check  # exit 1 if the committed file is out of date
"""

import argparse
import base64
import datetime as dt
import hashlib
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "fixtures", "api", "db.json")
NOW = dt.datetime(2026, 11, 24, 12, 0, 0, tzinfo=dt.timezone.utc)
OWN_CHANNEL = "UCjNibXSaZqeXSD36V6dyIVQ"  # Zoora AI (content/zoora-ai/CHANNEL.md)


def _b64(key, n):
    raw = base64.urlsafe_b64encode(hashlib.sha256(key.encode()).digest()).decode().rstrip("=")
    return raw[:n]


def video_id(key):
    return _b64("video:" + key, 11)


def channel_id(key):
    return "UC" + _b64("channel:" + key, 22)


def iso(days_ago, hour=15):
    moment = (NOW - dt.timedelta(days=days_ago)).replace(hour=hour, minute=0, second=0)
    return moment.isoformat().replace("+00:00", "Z")


def duration(seconds):
    h, rem = divmod(int(seconds), 3600)
    m, s = divmod(rem, 60)
    out = "PT"
    if h:
        out += f"{h}H"
    if m:
        out += f"{m}M"
    if s or out == "PT":
        out += f"{s}S"
    return out


FILLER = {
    "en": ["Weekly security wrap #{n}", "Viewer questions #{n}", "Behind the scenes #{n}", "Tools I use, episode {n}", "Community Q&A {n}"],
    "es": ["Resumen semanal #{n}", "Preguntas de la comunidad #{n}", "Episodio {n}: lo que aprendimos", "Directo resumido #{n}"],
    "pt": ["Resumo semanal #{n}", "Perguntas da comunidade #{n}", "Episodio {n}: o que aprendemos", "Live resumida #{n}"],
}


def uploads(rng, key, lang, count, median, start_days, step_days, fmt="long", sigma=0.35, titles=None):
    out = []
    for i in range(count):
        days = start_days + i * step_days
        views = max(1, int(rng.lognormvariate(0, sigma) * median))
        if fmt == "short":
            secs, aspect = rng.randint(20, 58), "9:16"
        else:
            secs, aspect = rng.randint(420, 1100), "16:9"
        title = (titles[i % len(titles)] if titles else FILLER[lang][i % len(FILLER[lang])]).format(n=count - i)
        out.append({
            "id": video_id(f"{key}:upload:{fmt}:{i}"),
            "title": title,
            "description": "Synthetic fixture upload.",
            "tags": [],
            "publishedAt": iso(days, hour=14),
            "duration": duration(secs),
            "aspect": aspect,
            "viewCount": views,
            "likeCount": int(views * rng.uniform(0.02, 0.045)),
            "commentCount": int(views * rng.uniform(0.002, 0.006)),
            "lang": lang,
        })
    return out


def build():
    rng = random.Random(20261124)
    channels, videos = [], []

    def channel(key, title, lang, extra_views=0, extra_videos=0, hidden_subs=False, uploads_missing=False, subs=50000, cid=None, country=None):
        cid = cid or channel_id(key)
        rec = {"id": cid, "key": key, "title": title, "customUrl": "@" + key.lower().replace("_", ""), "publishedAt": "2021-03-01T12:00:00Z",
               "defaultLanguage": lang, "subscriberCount": subs, "hiddenSubscriberCount": hidden_subs,
               "uploadsPlaylistId": "UU" + cid[2:], "uploadsMissing": uploads_missing, "_extraViews": extra_views, "_extraVideos": extra_videos}
        if country:
            rec["country"] = country
        channels.append(rec)
        return cid

    def add(cid, items):
        for v in items:
            v["channelId"] = cid
            videos.append(v)

    def cand(key, cid, scenario, title, days, views, likes, comments, secs, aspect="16:9", lang="en", tags=(), description="", audio=None, live="none"):
        v = {"id": video_id(key), "channelId": cid, "scenario": scenario, "title": title, "description": description or "Synthetic fixture video.",
             "tags": list(tags), "publishedAt": iso(days, hour=16), "duration": duration(secs), "aspect": aspect, "viewCount": views,
             "lang": lang, "liveBroadcastContent": live}
        if likes is not None:
            v["likeCount"] = likes
        if comments is not None:
            v["commentCount"] = comments
        if audio:
            v["defaultAudioLanguage"] = audio
        videos.append(v)
        return v

    # A: clean long-form outlier on permit signatures, found by two queries (merged), same-epoch baseline.
    a = channel("ChainSafetyLab", "Chain Safety Lab (synthetic)", "en", extra_views=900000, extra_videos=60)
    add(a, uploads(rng, "A", "en", 36, 9000, 6, 4, titles=["Crypto security basics, part {n}", "Weekly security wrap #{n}", "Viewer questions #{n}"]))
    add(a, [{"id": video_id("A:old-drainer"), "title": "Wallet drainer basics (old upload)", "description": "Synthetic fixture upload outside the window.", "tags": ["wallet drainer"],
             "publishedAt": iso(120), "duration": duration(700), "aspect": "16:9", "viewCount": 400000, "likeCount": 9000, "commentCount": 900, "lang": "en"}])
    cand("A1", a, "clean long-form outlier; two queries; same-epoch baseline", "I Signed One Message and Lost Everything (wallet drainer explained)", 19, 186000, 7900, 1140, 852,
         tags=["wallet drainer", "signature phishing", "crypto security"], description="One off-chain signature handed over a whole wallet. Crypto security breakdown of how wallet drainers abuse signatures.")

    # B: mixed channel, Shorts ~30k and long-form ~4k: the long-form outlier only shows with a per-format baseline.
    b = channel("ShortsLab", "Shorts Lab (synthetic)", "en", extra_views=400000, extra_videos=40)
    add(b, uploads(rng, "B", "en", 24, 30000, 3, 4, fmt="short"))
    add(b, uploads(rng, "B", "en", 12, 4000, 5, 8))
    cand("B1", b, "per-format baseline (mixed median would hide it)", "The airdrop that wasn't free: wallet drainer breakdown", 26, 41000, 2100, 260, 740,
         tags=["airdrop", "wallet drainer"], description="Free airdrop claim pages ask for one approval.")
    cand("B2", b, "Short above the Shorts floor and 3x its Shorts median", "Never claim this airdrop #shorts", 12, 95000, 5200, 90, 41, aspect="9:16",
         tags=["wallet drainer", "airdrop"], description="Unexpected airdrop? Do not claim it.")

    # C: big channel, high views but only 1.6x its median: not an outlier.
    c = channel("BigTechDaily", "Big Tech Daily (synthetic)", "en", extra_views=90000000, extra_videos=400, subs=2400000)
    add(c, uploads(rng, "C", "en", 30, 400000, 4, 3))
    cand("C1", c, "big channel, ratio below the threshold", "AI agents are getting hacked with prompt injection", 15, 650000, 21000, 3100, 980,
         tags=["prompt injection", "AI security"], description="Prompt injection explained for AI agents.")

    # D: tiny channel (median 40 views): the 1,000-view floor caps the ratio; aspect unknown and 95 s long.
    d = channel("TinyDeskSecurity", "Tiny Desk Security (synthetic)", "en", extra_views=2000, extra_videos=10, subs=300)
    add(d, uploads(rng, "D", "en", 20, 40, 8, 5))
    cand("D1", d, "baseline floor; format assumed (no aspect, 95 s)", "Address poisoning: I almost sent everything to the wrong address", 33, 14000, 600, 85, 95, aspect=None,
         tags=["crypto scam", "address poisoning"], description="A lookalike address in my history.")

    # E: Spanish deepfake giveaway livestream: matches an existing Scam of the Week idea (evidence, not a new idea).
    e = channel("SeguridadCriptoHoy", "Seguridad Cripto Hoy (synthetic)", "es", extra_views=150000, extra_videos=30, country="MX")
    add(e, uploads(rng, "E", "es", 30, 3000, 6, 5))
    cand("E1", e, "Spanish; duplicate of an existing backlog idea", "Estafa con deepfake en directo: así te roban con un sorteo falso", 35, 61000, 3900, 410, 640, lang="es", audio="es",
         tags=["deepfake", "estafa cripto"], description="Un directo falso con un deepfake promete duplicar tus criptomonedas.")

    # G: income-claim source on memecoin sniping: kept, flagged, and pitched from the cautionary side.
    g = channel("MoneyHustleDaily", "Money Hustle Daily (synthetic)", "en", extra_views=3000000, extra_videos=120, subs=180000)
    add(g, uploads(rng, "G", "en", 30, 15000, 5, 4))
    cand("G1", g, "income-claim flag; cautionary angle", "How I Made $50,000 Sniping Memecoins on Pump.fun", 40, 210000, 9800, 1500, 1120,
         tags=["memecoin", "pump.fun", "rug pull", "sniping"], description="My memecoin sniping strategy on pump.fun.")

    # H: attack tutorial: excluded.
    h = channel("ExploitTutorials", "Exploit Tutorials (synthetic)", "en", extra_views=500000, extra_videos=40)
    add(h, uploads(rng, "H", "en", 10, 9000, 9, 6))
    cand("H1", h, "attack tutorial: excluded", "How to build a wallet drainer (full script tutorial)", 20, 90000, 3000, 800, 1500,
         tags=["wallet drainer"], description="Drainer script walkthrough.")

    # I: our own channel: excluded.
    i = channel("ZooraAI", "Zoora AI", "en", cid=OWN_CHANNEL, extra_views=0, extra_videos=0, subs=3)
    cand("I1", i, "our own channel: excluded", "Wallet drainers explained (test upload)", 10, 20000, 900, 40, 600,
         tags=["wallet drainer"], description="Test upload.")

    # J: upcoming live: excluded.
    j = channel("LiveDesk", "Live Desk (synthetic)", "en", extra_views=80000, extra_videos=20)
    add(j, uploads(rng, "J", "en", 10, 3000, 7, 6))
    cand("J1", j, "upcoming broadcast: excluded", "LIVE: wallet drainer Q&A", 1, 0, 0, 0, 0, live="upcoming", tags=["wallet drainer"])

    # K: AI agent with a crypto wallet: a Zoora AI POV story (story cue), new idea.
    k = channel("AgentBuilders", "Agent Builders (synthetic)", "en", extra_views=4000000, extra_videos=150, subs=210000)
    add(k, uploads(rng, "K", "en", 30, 20000, 5, 4))
    cand("K1", k, "story cue -> POV story; agent wallets", "I gave an AI agent my crypto wallet for 30 days", 22, 300000, 14000, 2100, 1260,
         tags=["AI agent", "crypto", "AI trading"], description="An autonomous AI agent with its own wallet, tested for a month.")

    # L: likes and comments hidden; voice clone (duplicate of an existing Scam of the Week).
    l_ = channel("HiddenLikes", "Hidden Likes Channel (synthetic)", "en", extra_views=700000, extra_videos=60, hidden_subs=True)
    add(l_, uploads(rng, "L", "en", 25, 6000, 6, 5))
    cand("L1", l_, "likes hidden: neutral engagement; duplicate", "Voice clone scam call: what it really sounds like", 30, 77000, None, None, 760,
         tags=["voice clone", "AI scam"], description="Hear a cloned voice scam call.")

    # M: new uploader with 2 public videos: lifetime-average estimate without the candidate.
    m = channel("NewUploader", "New Uploader (synthetic)", "en", extra_views=0, extra_videos=0, subs=900)
    add(m, [{"id": video_id("M:first"), "title": "My first video", "description": "Synthetic fixture upload.", "tags": [], "publishedAt": iso(60), "duration": duration(500),
             "aspect": "16:9", "viewCount": 3000, "likeCount": 90, "commentCount": 12, "lang": "en"}])
    cand("M1", m, "estimated baseline (lifetime average minus the candidate)", "Fake job interview malware: the take-home test that stole my wallet", 25, 35000, 1700, 240, 820,
         tags=["crypto scam", "fake job"], description="A recruiter, a coding test and malware.")

    # N: long-form channel whose uploads mostly predate the 2026-08-27 view-counting change.
    n = channel("EpochChannel", "Epoch Channel (synthetic)", "en", extra_views=1200000, extra_videos=80)
    add(n, uploads(rng, "N:new", "en", 3, 9000, 20, 20))
    add(n, uploads(rng, "N:old", "en", 20, 5000, 95, 8))
    cand("N1", n, "baseline spans the view-counting change", "Seed phrase mistakes that empty wallets", 30, 60000, 2900, 330, 900,
         tags=["seed phrase"], description="Wallet security basics: where seed phrases leak.")

    # O: uploads playlist missing (404): estimated baseline; fake wallet app (phishing), new idea.
    o = channel("PlaylistGone", "Playlist Gone (synthetic)", "en", uploads_missing=True, subs=40000)
    cand("O1", o, "uploads playlist 404 -> estimated baseline", "Fake MetaMask in the app store: how a copycat wallet stole my seed", 45, 52000, 2500, 300, 700,
         tags=["crypto scam", "fake app"], description="A copycat wallet listing.")
    o_rec = channels[-1]
    o_rec["_fixedViewCount"], o_rec["_fixedVideoCount"] = 400000, 50

    # P: 2-day-old video: young flag; approvals (duplicate of an existing explainer that tags approvals).
    p = channel("YoungVideo", "Young Video Channel (synthetic)", "en", extra_views=300000, extra_videos=40)
    add(p, uploads(rng, "P", "en", 25, 5000, 8, 4))
    cand("P1", p, "young video flag; duplicate", "Approval scam alert: revoke these permissions now", 2, 25000, 1500, 210, 540,
         tags=["approvals"], description="Wallet drainer approvals explained.")

    # S: second channel on fake airdrops: groups with B1 (breadth bonus).
    s = channel("WalletWise", "Wallet Wise (synthetic)", "en", extra_views=1500000, extra_videos=90)
    add(s, uploads(rng, "S", "en", 30, 10000, 5, 4))
    cand("S1", s, "second channel on the same idea: breadth bonus", "Free airdrop scam: why the claim page wants your approval", 16, 120000, 5100, 700, 690,
         tags=["crypto scam", "airdrop", "wallet drainer"], description="Claim pages and approvals.")

    # T: Spanish seed phrase: groups with N1 (two languages, one idea).
    t = channel("CriptoSegura", "Cripto Segura (synthetic)", "es", extra_views=90000, extra_videos=40, country="ES")
    add(t, uploads(rng, "T", "es", 25, 2000, 6, 5))
    cand("T1", t, "Spanish; groups with N1", "Frase semilla: el error que vació mi billetera en un minuto", 28, 33000, 1900, 260, 610, lang="es", audio="es-419",
         tags=["frase semilla"], description="Seguridad cripto: cómo proteger tu frase semilla.")

    # U: Portuguese voice clone: duplicate evidence with L1.
    u = channel("GolpesDigitais", "Golpes Digitais (synthetic)", "pt", extra_views=200000, extra_videos=50, country="BR")
    add(u, uploads(rng, "U", "pt", 25, 4000, 6, 5))
    cand("U1", u, "Portuguese; duplicate evidence", "Golpe da voz clonada: a ligação falsa do 'seu filho' pedindo dinheiro", 21, 80000, 4600, 520, 480, lang="pt", audio="pt-BR",
         tags=["golpe", "voz clonada"], description="Como funciona o golpe da voz clonada.")

    # V: Portuguese honeypot memecoin: a new Zoora AI POV idea.
    v = channel("CriptoBrasil", "Cripto Brasil (synthetic)", "pt", extra_views=120000, extra_videos=40, country="BR")
    add(v, uploads(rng, "V", "pt", 30, 2500, 6, 5))
    cand("V1", v, "Portuguese; new POV idea", "Comprei a memecoin e não consigo vender: o golpe do honeypot", 55, 48000, 2600, 380, 720, lang="pt", audio="pt-BR",
         tags=["memecoin", "golpe"], description="Um token que deixa comprar, mas não vender.")

    # W: price prediction: excluded.
    w = channel("PriceTalk", "Price Talk (synthetic)", "en", extra_views=8000000, extra_videos=300)
    add(w, uploads(rng, "W", "en", 10, 50000, 5, 6))
    cand("W1", w, "price content: excluded", "Bitcoin price prediction and crypto security for your gains", 14, 400000, 9000, 2000, 1300, tags=["bitcoin"])

    # X: matched a query, but no topic of ours: off-niche.
    x = channel("OffNicheTech", "Off Niche Tech (synthetic)", "en", extra_views=2000000, extra_videos=200)
    add(x, uploads(rng, "X", "en", 10, 20000, 5, 6))
    cand("X1", x, "off-niche", "New GPU driver vulnerability patched (and what AI labs said)", 18, 90000, 2000, 300, 600, tags=["gpu"])

    # Y: below the view floor.
    y = channel("BelowFloor", "Below Floor (synthetic)", "en", extra_views=20000, extra_videos=20, subs=1200)
    add(y, uploads(rng, "Y", "en", 15, 500, 6, 5))
    cand("Y1", y, "below the view floor", "Rug pull warning signs (quick guide)", 50, 6000, 300, 40, 420, tags=["rug pull"])

    # Channel totals consistent with the uploads (plus older history not in the fixture).
    for ch in channels:
        mine = [vv for vv in videos if vv["channelId"] == ch["id"]]
        ch["viewCount"] = ch.pop("_fixedViewCount", None) or (sum(vv["viewCount"] for vv in mine) + ch["_extraViews"])
        ch["videoCount"] = ch.pop("_fixedVideoCount", None) or (len([vv for vv in mine if vv.get("liveBroadcastContent", "none") == "none"]) + ch["_extraVideos"])
        del ch["_extraViews"], ch["_extraVideos"]
    videos.sort(key=lambda vv: vv["id"])
    return {
        "version": 1,
        "note": "SYNTHETIC fixture data shaped like YouTube Data API v3 resources (discovery rev 20261123). No real channel or video is described here, except the owner's own channel id, used to test that it is excluded. Built by scripts/topics/tools/build_fixtures.py.",
        "recordedAt": NOW.isoformat().replace("+00:00", "Z"),
        "loosenTypeFilter": True,
        "channels": channels,
        "videos": videos,
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args(argv)
    data = json.dumps(build(), indent=1, ensure_ascii=False) + "\n"
    if args.check:
        with open(OUT, encoding="utf-8") as fh:
            same = fh.read() == data
        print("fixtures are up to date" if same else "fixtures are out of date: run tools/build_fixtures.py")
        return 0 if same else 1
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(data)
    print(f"wrote {OUT} ({len(data):,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
