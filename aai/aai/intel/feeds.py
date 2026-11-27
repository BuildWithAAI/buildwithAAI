"""Feed registry: one entry per live source with its refresh interval and staleness budget (seconds)."""
from __future__ import annotations
from .core import Breaker, Feed
from .adapters import blofin, cftc, defillama, deribit, edgar, fear_greed, ff_calendar, fred, okx, treasury, xbrl, yahoo

M, H, D = 60, 3600, 86400


def registry() -> dict[str, Feed]:
    fs = [
        Feed("markets", "Cross-asset quotes", "Yahoo Finance chart API (keyless, unofficial)", "https://finance.yahoo.com/",
             2 * M, 20 * M, yahoo.fetch, "markets", "Equities/ETFs may be up to 15 min delayed; closed markets keep the last session close."),
        Feed("sectors", "US sector ETFs (breadth)", "Yahoo Finance chart API (keyless, unofficial)", "https://www.sectorspdrs.com/",
             5 * M, 30 * M, yahoo.fetch_sectors, "equities", "11 SPDR Select Sector ETFs; up to 15 min delayed; closed markets keep the last session close."),
        Feed("rates", "US Treasury par yield curve", "U.S. Treasury (home.treasury.gov)", treasury.PAGE,
             30 * M, 4 * D, treasury.fetch, "macro", "Published once per business day after ~3:30 pm ET."),
        Feed("fred", "FRED macro series", "Federal Reserve Bank of St. Louis (FRED fredgraph CSV)", "https://fred.stlouisfed.org/",
             30 * M, 5 * D, fred.fetch, "macro", "Daily series lag 1-3 business days at the source."),
        Feed("calendar", "Economic calendar (this week)", "ForexFactory via faireconomy.media JSON", ff_calendar.URL,
             15 * M, 3 * H, ff_calendar.fetch, "macro", "Forecast and previous only; this feed has no actual prints."),
        Feed("deriv_blofin", "Perp funding / OI / basis", "Blofin public API", "https://openapi.blofin.com",
             1 * M, 5 * M, blofin.fetch, "crypto"),
        Feed("deriv_okx", "Perp funding / OI / basis", "OKX public API v5", "https://www.okx.com/docs-v5/en/",
             1 * M, 5 * M, okx.fetch, "crypto"),
        Feed("options_deribit", "Options: DVOL + put/call OI", "Deribit public API", "https://www.deribit.com/statistics/BTC/volatility-index",
             5 * M, 30 * M, deribit.fetch, "crypto"),
        Feed("fear_greed", "Crypto Fear & Greed", "alternative.me", "https://alternative.me/crypto/fear-and-greed-index/",
             1 * H, 30 * H, fear_greed.fetch, "crypto", "Updates once a day (00:00 UTC)."),
        Feed("stablecoins", "Stablecoin supply", "DefiLlama stablecoins API", "https://defillama.com/stablecoins",
             1 * H, 6 * H, defillama.fetch, "crypto"),
        Feed("cot", "CFTC Commitments of Traders", "CFTC Public Reporting (Socrata)", cftc.PAGE,
             6 * H, 10 * D, cftc.fetch, "positioning", "Tuesday positions, released Friday 3:30 pm ET.",
             breaker=Breaker(threshold=3, base_cooloff=600)),
        Feed("filings", "SEC filings: Form 4 + 8-K", "SEC EDGAR (data.sec.gov)", "https://www.sec.gov/edgar/search/",
             10 * M, 2 * H, edgar.fetch, "equities", "Watchlist only; last 30 days. Form 4 code P = open-market purchase.",
             breaker=Breaker(threshold=2, base_cooloff=600)),
        Feed("fundamentals", "Fundamentals: SEC XBRL company facts", "SEC EDGAR XBRL API (data.sec.gov)", "https://www.sec.gov/search-filings/edgar-application-programming-interfaces",
             6 * H, 3 * D, xbrl.fetch, "equities", "Watchlist only; from each issuer's latest 10-Q/10-K. Filings arrive quarterly, so 6-hourly is plenty.",
             breaker=Breaker(threshold=2, base_cooloff=1800)),
        Feed("watch_quotes", "Watchlist quotes (for multiples)", "Yahoo Finance chart API (keyless, unofficial)", "https://finance.yahoo.com/",
             10 * M, 90 * M, yahoo.fetch_watch, "equities", "Last price per watchlist name, up to 15 min delayed; closed markets keep the last close. "
             "Used only to price the SEC fundamentals (market cap, EV, P/S, FCF yield)."),
    ]
    return {f.name: f for f in fs}
