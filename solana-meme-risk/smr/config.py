"""Typed configuration. Everything tunable lives here or in data/thresholds.json (calibrated, versioned).

Environment variables (all optional):
  HELIUS_API_KEY        enables the Helius RPC endpoint (preferred when set)
  SOLANA_RPC_URLS       comma-separated extra/override public RPC URLs
  SMR_DATA_DIR          data directory (default ./data)
  SMR_CACHE_MODE        readwrite | replay | off   (replay = deterministic, cache-only, fails on miss)
  SMR_LOG_LEVEL         DEBUG/INFO/WARNING (default WARNING)
  SMR_WORKERS           thread-pool size for tracing (default 8)
"""
from __future__ import annotations
import json, os
from dataclasses import dataclass, field, asdict
from typing import Optional

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
PUMP_AMM_PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"
PUMP_MINT_AUTHORITY = "TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM"   # signs every pump.fun create
SYSTEM_PROGRAM = "11111111111111111111111111111111"
WSOL_MINT = "So11111111111111111111111111111111111111112"
TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
INCINERATOR = "1nc1nerator11111111111111111111111111111111"
PUMP_TOTAL_SUPPLY_RAW = 1_000_000_000 * 10**6
PUMP_INITIAL_REAL_TOKEN_RAW = 793_100_000 * 10**6
PUMP_VIRTUAL_TOKEN_OFFSET_RAW = 279_900_000 * 10**6   # virtual - real token reserves (verified on-chain 2026-10-31)
PUMP_CURVE_RESERVED_RAW = 206_900_000 * 10**6         # curve ATA balance - real_token_reserves (migration reserve, verified 2026-10-31)

INFRA_OWNERS = {
    INCINERATOR: "incinerator/burn",
    SYSTEM_PROGRAM: "system",
    "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1": "raydium_v4_authority",
    "GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL": "raydium_cpmm_authority",
    "39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg": "pump_migration",
    # pump.fun "Mayhem mode" agent: receives an extra 1e15 raw tokens in every CreateV2 with
    # InitializeMayhemState (~93% of creates in our 2026-10 sample) and trades them; not a holder/buyer signal.
    "BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s": "pump_mayhem_agent",
}


@dataclass(frozen=True)
class Endpoint:
    name: str
    url: str
    rps: float
    burst: int = 5
    supports_gpa: bool = True
    # getTransaction history this endpoint actually serves (None = full archive). A tx older than this is not even
    # tried there when the caller knows its blockTime (measured 2026-11-03: ~2 days earlier; s89 18:3x CST: null past ~34 h, so default 33).
    tx_history_hours: Optional[float] = None


@dataclass(frozen=True)
class Thresholds:
    # rule thresholds (calibrated values override via data/thresholds.json)
    same_slot_min: int = 1
    same_slot_heavy: int = 3
    same_slot_supply_heavy: float = 5.0
    cluster_supply_warn: float = 10.0
    cluster_supply_high: float = 20.0
    serial_warn: int = 3
    serial_high: int = 10
    serial_bad_ratio: float = 0.8
    creator_warn: float = 5.0
    creator_high: float = 10.0
    top10_warn: float = 30.0
    top10_high: float = 50.0
    early_supply_high: float = 50.0
    fresh_ratio_warn: float = 0.3
    fresh_ratio_high: float = 0.5
    fresh_deployer_hours: float = 48.0
    # decision thresholds
    skip_score: int = 60
    reduced_score: int = 30
    min_liq_usd_any: float = 2_000.0
    min_liq_usd_normal: float = 10_000.0
    min_holders_normal: int = 75


@dataclass(frozen=True)
class Settings:
    data_dir: str
    cache_db: str
    graph_db: str
    labels_file: str
    thresholds_file: str
    cache_mode: str
    endpoints: tuple
    helius_api_key: Optional[str]
    pumpfun_api: str = "https://frontend-api-v3.pump.fun"
    dexscreener_api: str = "https://api.dexscreener.com"
    geckoterminal_api: str = "https://api.geckoterminal.com/api/v2"
    http_ua: str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    pumpfun_rps: float = 3.0
    dexscreener_rps: float = 4.0       # documented 300 req/min for pairs endpoints
    geckoterminal_rps: float = 0.45    # documented ~30 calls/min on the free tier
    workers: int = 8
    # pipeline tunables
    early_buyers_n: int = 40
    score_delay_s: int = 300           # as-of scoring: score at creation + 5 min
    max_launch_txs: int = 800          # cap on transactions fetched between create and as_of
    trace_hops: int = 2
    trace_sig_pages: int = 2           # pages of 1000 signatures walked back from the anchor per wallet
    trace_oldest_k: int = 3            # oldest txs fetched when the wallet's history start is reached
    trace_recent_k: int = 5            # most recent txs before the anchor (inside the window) fetched
    trace_funders_per_wallet: int = 3
    trace_tx_concurrency: int = 3      # getTransaction fetches in flight per wallet probe (global rate still set by the endpoint bucket)
    hub_sig_threshold: int = 1000
    funding_window_hours: float = 72.0
    fresh_wallet_hours: float = 48.0
    min_transfer_sol: float = 0.01
    serial_prior_coins_checked: int = 8
    serial_lookback_hours: float = 72.0
    thresholds: Thresholds = field(default_factory=Thresholds)
    thresholds_version: str = "default"
    weights: dict = field(default_factory=dict)

    def public(self) -> dict:
        d = asdict(self)
        d["helius_api_key"] = "set" if self.helius_api_key else None
        d["endpoints"] = [{"name": e.name, "rps": e.rps} for e in self.endpoints]
        return d


def _endpoints(helius_key: Optional[str]) -> tuple:
    eps = []
    if helius_key:
        eps.append(Endpoint("helius", f"https://mainnet.helius-rpc.com/?api-key={helius_key}", rps=8.0, burst=10))
    extra = [u.strip() for u in os.environ.get("SOLANA_RPC_URLS", "").split(",") if u.strip()]
    for i, u in enumerate(extra):
        eps.append(Endpoint(f"custom{i}", u, rps=float(os.environ.get("SMR_CUSTOM_RPS", "5"))))
    if not extra:
        # publicnode: free, no key; we self-limit well below what it tolerates (see README, measured 2026-10-31)
        eps.append(Endpoint("publicnode", "https://solana-rpc.publicnode.com", rps=float(os.environ.get("SMR_PUBLICNODE_RPS", "25")), burst=10,
                            tx_history_hours=float(os.environ.get("SMR_PUBLICNODE_TX_HISTORY_H", "33"))))
        # mainnet-beta documents 100 req/10 s per IP and 40 req/10 s per method; it is the only free endpoint serving v1 txs
        eps.append(Endpoint("mainnet-beta", "https://api.mainnet-beta.solana.com", rps=float(os.environ.get("SMR_MAINNET_BETA_RPS", "3.5")), burst=3))
    return tuple(eps)


def load_thresholds(path: str) -> tuple[Thresholds, str, dict]:
    if not os.path.exists(path):
        return Thresholds(), "default", {}
    j = json.load(open(path))
    known = {k: v for k, v in (j.get("thresholds") or {}).items() if k in Thresholds.__dataclass_fields__}
    return Thresholds(**known), j.get("version", "unversioned"), dict(j.get("weights") or {})


def load_settings(**overrides) -> Settings:
    data_dir = overrides.pop("data_dir", None) or os.environ.get("SMR_DATA_DIR") or os.path.join(ROOT, "data")
    os.makedirs(data_dir, exist_ok=True)
    key = os.environ.get("HELIUS_API_KEY") or None
    tfile = os.path.join(data_dir, "thresholds.json")
    th, tver, weights = load_thresholds(tfile)
    s = dict(
        data_dir=data_dir,
        cache_db=os.path.join(data_dir, "cache.db"),
        graph_db=os.path.join(data_dir, "funding_graph.db"),
        labels_file=os.path.join(ROOT, "data", "labels", "known_entities.json"),
        thresholds_file=tfile,
        cache_mode=os.environ.get("SMR_CACHE_MODE", "readwrite"),
        endpoints=_endpoints(key),
        helius_api_key=key,
        workers=int(os.environ.get("SMR_WORKERS", "8")),
        trace_tx_concurrency=max(1, int(os.environ.get("SMR_TRACE_TX_CONCURRENCY", "3"))),
        thresholds=th, thresholds_version=tver, weights=weights,
    )
    s.update(overrides)
    return Settings(**s)
