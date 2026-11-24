"""Vet gate configuration. Every threshold is tagged with where it comes from:
  owner      Zoorped standing rule
  default    existing pipeline default in smr.config.Thresholds (hand-set, not calibrated as a hard gate)
  proposal   new number proposed for the gate, NOT backed by data yet
The pipeline's score has no proven predictive edge for this use (old held-out AUC 0.47; the live score's fresh
holdout #8 was 0.675 with 95% CI 0.53-0.81), so these are conservative safety floors, not predictors."""
from __future__ import annotations
from dataclasses import dataclass, asdict, field

CONFIG_VERSION = "vetcfg-20261117-v6"


@dataclass(frozen=True)
class VetThresholds:
    # market / owner rules
    min_market_cap_usd: float = 30_000.0          # owner
    max_mcap_source_divergence: float = 2.0       # proposal: on-chain vs DexScreener mcap ratio beyond this -> UNKNOWN
    min_liquidity_usd: float = 2_000.0            # default (min_liq_usd_any)
    # holders (top10 excludes bonding curve / pool / infra / program-owned accounts)
    max_top10_pct: float = 30.0                   # default top10_warn; data: >30 -> bad 76% vs 6.4% (flags 1.3%)
    max_top1_pct: float = 10.0                    # proposal; data: >10 -> bad 62% vs 5.8% (flags 2.7%)
    max_creator_pct: float = 10.0                 # default creator_high; data: >10 -> bad 67% vs 6.7% (flags 1.1%)
    min_holder_count: int = 75                    # default min_holders_normal (not testable: dataset is at create+5 min)
    max_fresh_wallet_ratio: float = 0.5           # default fresh_ratio_high; WARN only (inverted in data at 0.5-1.0)
    min_fresh_known_buyers: int = 10              # proposal: fewer traced buyers -> fresh ratio UNKNOWN
    # bundle / sniper
    max_same_slot_buyers: int = 3                 # default same_slot_heavy; data: >=3 -> bad 14.6% vs 6.8% (flags 23%)
    max_same_slot_supply_pct: float = 5.0         # default same_slot_supply_heavy; data: >=5 -> 14.6% vs 6.5% (flags 26%)
    max_sniper_supply_bought_pct: float = 20.0    # proposal; data: >=20 -> bad 28.3% vs 7.1% (flags 7.4%)
    max_sniper_held_now_pct: float = 10.0         # proposal, no data (current balance not in the dataset)
    # creator history
    max_prior_launches: int = 10                  # default serial_high; WARN only: data inverted (4.9% vs 12.9%)
    max_bad_outcome_ratio: float = 0.8            # default serial_bad_ratio; data: no separation (10.1% vs 8.5%) -> safety floor only
    min_measured_for_ratio: int = 3               # proposal
    # funding graph
    max_cluster_supply_pct: float = 20.0          # default cluster_supply_high; data: weak (12.2% vs 8.3%)
    max_deployer_cluster_supply_pct: float = 10.0 # proposal; data: weak (11.9% vs 8.2%)
    min_trace_coverage: float = 0.6               # proposal: share of traced wallets with a usable trace


@dataclass(frozen=True)
class VetConfig:
    thresholds: VetThresholds = field(default_factory=VetThresholds)
    budget_s: float = 45.0               # cold vet wall-clock budget (proposal: measured full-path p95 35.4 s, max 44.7 s)
    fast_stage_s: float = 8.0            # curve/mint/price/pool reads
    max_fast_age_s: float = 15.0         # curve/mint/pool/price facts older than this at evaluation -> UNKNOWN
    max_holders_age_s: float = 30.0      # holder list (getProgramAccounts on mainnet-beta, ~1-6 s) older than this -> UNKNOWN
    refresh_reserve_s: float = 8.0       # budget kept for the final re-read of mutable facts
    slow_ttl_s: float = 1800.0           # reuse early-buyer/trace/serial facts this long (they describe the launch)
    result_ttl_s: float = 15.0           # executor must re-vet if the result is older than this at send time
    early_buyers_n: int = 40
    max_launch_txs: int = 150            # txs fetched from the create window (pipeline: 800 for exact holdings; gate needs first 40 buyers)
    early_windows_s: tuple = (300, 60, 15)   # first buyers: 5 min after create (backtest as-of), shrunk for very hot launches
    serial_lookback_h: float = 24.0      # proposal: free RPC can only backfill ~33 h of the create stream (pipeline uses 72)
    max_sig_pages: int = 10              # > 10k txs before creation is reached -> early-buyer facts UNKNOWN
    trace_hops: int = 2                  # pipeline default (hop 2 marks hub funders so they do not falsely link wallets)
    serial_measure: bool = True
    version: str = CONFIG_VERSION

    def public(self):
        return asdict(self)
