"""Narrative / meta signal for the paper 'momentum' book (SIMULATION ONLY; unproven).

Finds the hot themes right now by clustering coin names, symbols and (DexScreener profile/boost) descriptions into
keyword themes with plain normalized token matching: no LLM, and nothing from token metadata is ever executed or
followed. Every text field is attacker-chosen: it goes through safe_field first, is lowercased and split into
[a-z0-9] words, and only those words are kept (theme labels are such a word, so they are inert by construction).

Sources (all free, light):
  DexScreener /token-boosts/latest/v1, /token-boosts/top/v1, /token-profiles/latest/v1 (Solana rows; 3 calls, cached
  10 min) + one /tokens/v1/solana batch per 30 addresses for names, symbols, h1/h6 volume and price change
  our graduations feed data/backtest/work/graduations.jsonl (tools/collect_graduations.py; addresses only)
  our own launch index: data/paper.db launches scored in the window (sanitized symbol/name, peak return we observed)

A coin "ran" if it gained >= runner_h6_change % in 6 h, traded >= runner_h1_volume in 1 h, graduated to PumpSwap in
the window, or 2x'd in our own marks. A theme is a keyword shared by >= theme_min_coins coins; its heat counts runners
(boosted/profiled coins that did not run add 0.5 each: paid attention, not performance). A theme is fading when its
runners' median 1 h price change is below fading_h1_change, or their 1 h volume is under half their 6 h hourly average.
A coin scores higher in a theme with several OTHER runners and lower in a fading theme; a coin created long after the
theme's first runner in a fading theme is a late copycat."""
from __future__ import annotations
import json, os, re, statistics, time, unicodedata
from .paper.sanitize import safe_field
from .momentum import MomentumConfig, _f

DEX_LISTS = ("/token-boosts/top/v1", "/token-boosts/latest/v1", "/token-profiles/latest/v1")
MAX_LOOKUP = 120
STOP = set("""the and for with this that from your you our are was has have will its not all new get now who can one out more most
just than then them they their there here what when where which while into onto over under about also only very much many
coin coins token tokens sol solana pump pumpfun fun official meme memes memecoin community first launch launched project holders
buy sell hold ca dex dexscreener twitter telegram website www com https http org xyz net app io the1 inu2 token2 v2 v3
2024 2025 2026 like make made back best real true time day days world global every people let lets dont don cant can't
being been some any even way next big little top live go going gonna want need still ever never always
everyone platform stand reward rewards powered meet team social join built build building power future home based
around through across together higher lower fees fee earn earning support supported official2 thing things love life""".split())
SHORT_OK = {"ai", "gm", "og", "cz", "x"}
_word = re.compile(r"[a-z0-9]+")


def words(text, max_words=40):
    """Untrusted text -> a set of normalized keyword tokens (no other text survives)."""
    s = safe_field(text, max_len=240).lower()
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    out = []
    for w in _word.findall(s)[:max_words]:
        if w.isdigit() or w in STOP:
            continue
        if len(w) < 3 and w not in SHORT_OK:
            continue
        if len(w) >= 6 and w.endswith("s") and not w.endswith("ss"):
            w = w[:-1]
        out.append(w[:24])
    return set(out)


def compact(text):
    s = unicodedata.normalize("NFKD", safe_field(text, max_len=64).lower()).encode("ascii", "ignore").decode()
    return "".join(_word.findall(s))


def coin_words(c):
    return words(c.get("symbol")) | words(c.get("name")) | words(c.get("description"), max_words=25)


def is_runner(c, cfg):
    return bool(c.get("graduated") or (c.get("max_ret") or 0) >= 1.0 or (c.get("chg_h6") or 0) >= cfg.runner_h6_change
                or (c.get("vol_h1") or 0) >= cfg.runner_h1_volume)


def build_themes(coins, now=None, cfg: MomentumConfig | None = None):
    """coins: dicts with mint, symbol, name, description, created_at (s), chg_h1, chg_h6, vol_h1, vol_h6, graduated,
    max_ret, attention (boosted/profiled). -> {theme: stats} for themes with >= theme_min_coins coins."""
    cfg = cfg or MomentumConfig()
    now = now or time.time()
    by_mint = {}
    for c in coins:
        m = c.get("mint")
        if not m:
            continue
        prev = by_mint.get(m)
        if prev:   # merge sources for the same mint
            for k, v in c.items():
                if v and not prev.get(k):
                    prev[k] = v
            prev["graduated"] = prev.get("graduated") or c.get("graduated")
            prev["attention"] = prev.get("attention") or c.get("attention")
        else:
            by_mint[m] = dict(c)
    idx = {}
    for m, c in by_mint.items():
        c["_name_words"] = words(c.get("symbol")) | words(c.get("name"))
        c["_words"] = c["_name_words"] | words(c.get("description"), max_words=25)
        c["_runner"] = is_runner(c, cfg)
        for w in c["_words"]:
            idx.setdefault(w, []).append(c)
    themes = {}
    for w, cs in idx.items():
        # a theme must be in at least one coin's NAME or SYMBOL (description-only words are too generic)
        if len(cs) < cfg.theme_min_coins or not any(w in c["_name_words"] for c in cs):
            continue
        runners = [c for c in cs if c["_runner"]]
        attn = [c for c in cs if not c["_runner"] and c.get("attention")]
        chg = [c["chg_h1"] for c in runners if c.get("chg_h1") is not None]
        v1 = sum(c.get("vol_h1") or 0 for c in runners)
        v6 = sum(c.get("vol_h6") or 0 for c in runners)
        med = statistics.median(chg) if chg else None
        fading = bool(runners) and ((med is not None and med < cfg.fading_h1_change) or (v6 > 0 and v1 < 0.5 * v6 / 6))
        first = min((c.get("created_at") or now for c in runners), default=None)
        themes[w] = {"theme": safe_field(w, 24), "coins": len(cs), "runners": len(runners), "attention_only": len(attn),
                     "heat": len(runners) + 0.5 * len(attn), "median_h1_change_pct": None if med is None else round(med, 1),
                     "runner_vol_h1_usd": round(v1), "fading": fading, "first_runner_created_at": first,
                     "mints": [c["mint"] for c in cs], "runner_mints": [c["mint"] for c in runners]}
    return themes


def hot_themes(themes, n=8):
    ts = [t for t in themes.values() if t["runners"] > 0]
    ts.sort(key=lambda t: (t["fading"], -t["heat"], -t["runner_vol_h1_usd"]))
    return [{k: t[k] for k in ("theme", "coins", "runners", "heat", "median_h1_change_pct", "runner_vol_h1_usd", "fading")} for t in ts[:n]]


def score_coin(themes, coin, now=None, cfg: MomentumConfig | None = None):
    """Narrative score 0..100 for one coin from the themes it belongs to (its own run is excluded)."""
    cfg = cfg or MomentumConfig()
    now = now or time.time()
    ws = coin_words(coin)
    pieces = [x for x in (compact(coin.get("symbol")), compact(coin.get("name"))) if x]
    # also catch compact symbols like BABYPEPE / PEPE2: words >= 4 letters anywhere, 3-letter words as prefix/suffix
    ws |= {t for t in themes for x in pieces if (len(t) >= 4 and t in x) or (len(t) == 3 and (x.startswith(t) or x.endswith(t)))}
    best = None
    for w in ws:
        t = themes.get(w)
        if not t:
            continue
        others = [m for m in t["runner_mints"] if m != coin.get("mint")]
        attn = t["attention_only"] - (1 if coin.get("mint") in t["mints"] and coin.get("mint") not in t["runner_mints"] and coin.get("attention") else 0)
        heat = len(others) + 0.5 * max(0, attn)
        s = 100 * min(1.0, heat / max(1, cfg.narrative_runners_full))
        late = False
        if t["fading"]:
            s *= 0.4
            ca = coin.get("created_at")
            if ca and t["first_runner_created_at"] and ca - t["first_runner_created_at"] > cfg.late_copycat_after_s:
                late = True; s *= 0.25 / 0.4
        cand = {"score": round(s, 1), "theme": t["theme"], "theme_runners_other": len(others), "theme_coins": t["coins"],
                "fading": t["fading"], "late_copycat": late}
        if best is None or cand["score"] > best["score"] or (cand["score"] == best["score"] and cand["theme_coins"] > best["theme_coins"]):
            best = cand
    if best is None:
        return {"score": 0.0, "theme": None, "theme_runners_other": 0, "theme_coins": 0, "fading": False, "late_copycat": False,
                "matched": []}
    best["matched"] = sorted(w for w in ws if w in themes)[:6]
    return best


# ---- live index (light, cached) -------------------------------------------------------------------------------------
def _ds_pairs_rows(pairs):
    best = {}
    for p in pairs or []:
        bt = p.get("baseToken") or {}
        m = bt.get("address")
        if not m:
            continue
        liq = _f((p.get("liquidity") or {}).get("usd")) or 0
        if m not in best or liq > best[m][0]:
            best[m] = (liq, p)
    out = {}
    for m, (_, p) in best.items():
        v, ch = p.get("volume") or {}, p.get("priceChange") or {}
        out[m] = {"mint": m, "symbol": safe_field(bt_get(p, "symbol"), 32), "name": safe_field(bt_get(p, "name"), 64),
                  "vol_h1": _f(v.get("h1")), "vol_h6": _f(v.get("h6")), "chg_h1": _f(ch.get("h1")), "chg_h6": _f(ch.get("h6")),
                  "created_at": (_f(p.get("pairCreatedAt")) or 0) / 1000 or None}
    return out


def bt_get(p, k):
    return (p.get("baseToken") or {}).get(k)


def read_graduations(path, since):
    out = []
    try:
        with open(path) as f:
            for line in f:
                try:
                    r = json.loads(line)
                except ValueError:
                    continue
                if (r.get("seen_at") or 0) >= since and isinstance(r.get("mint"), str):
                    out.append(r["mint"][:64])
    except OSError:
        pass
    return out


def build_index(ctx, led=None, now=None, cfg: MomentumConfig | None = None, grads_path=None):
    """-> {"themes", "hot", "sources", "errors"}. Never raises: missing sources just shrink the index."""
    cfg = cfg or MomentumConfig()
    now = now or time.time()
    since = now - cfg.narrative_window_s
    coins, errors, src = [], [], {}
    order = []
    desc = {}
    if ctx is not None:
        for path in DEX_LISTS:
            try:
                rows = ctx.dex.h.get_json(path, ttl=600) or []
            except Exception as e:
                errors.append(f"dexscreener {path}: {type(e).__name__}"[:120]); rows = []
            sol = [r for r in rows if isinstance(r, dict) and r.get("chainId") == "solana" and isinstance(r.get("tokenAddress"), str)]
            src[path] = len(sol)
            for r in sol:
                m = r["tokenAddress"][:64]
                order.append(m)
                desc.setdefault(m, safe_field(r.get("description"), 200))
    grads = read_graduations(grads_path or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                                         "data", "backtest", "work", "graduations.jsonl"), since)
    src["graduations"] = len(grads)
    look = list(dict.fromkeys(grads + order))[:MAX_LOOKUP]
    info = {}
    if ctx is not None:
        for i in range(0, len(look), 30):
            chunk = look[i:i + 30]
            try:
                pairs = ctx.dex.h.get_json(f"/tokens/v1/solana/{','.join(chunk)}", ttl=600) or []
                if isinstance(pairs, dict):
                    pairs = pairs.get("pairs") or []
                info.update(_ds_pairs_rows(pairs))
            except Exception as e:
                errors.append(f"dexscreener tokens: {type(e).__name__}"[:120])
    gset = set(grads)
    for m in look:
        c = dict(info.get(m) or {"mint": m})
        c["description"] = desc.get(m, "")
        c["graduated"] = m in gset
        c["attention"] = m in desc
        coins.append(c)
    if led is not None:
        try:
            rows = led.q("SELECT mint, symbol, name, created_at, max_ret FROM launches WHERE status='scored' AND void_reason IS NULL "
                         "AND created_at >= ?", (since,))
        except Exception:
            rows = []
        src["own_launches"] = len(rows)
        for r in rows:
            coins.append({"mint": r["mint"], "symbol": r["symbol"], "name": r["name"], "created_at": r["created_at"], "max_ret": r["max_ret"]})
    themes = build_themes(coins, now, cfg)
    return {"themes": themes, "hot": hot_themes(themes), "sources": src, "coins": len({c['mint'] for c in coins}), "errors": errors[:5],
            "built_at": now}
