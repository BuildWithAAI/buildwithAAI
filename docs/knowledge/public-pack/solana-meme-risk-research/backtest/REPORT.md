# Backtest report - pump.fun launch risk (generated 2026-11-06T13:27:59Z)

**Read this first:** small sample, one ~2-day period, free public data. Treat as a sanity check of the rules, not a proof of edge.

## Setup
- Dataset: `backtest/dataset.jsonl` - 1756 usable launches (random sample of pump.fun creates with >=15 successful txs in the first 5 min)
- Scoring time: launch + 300 s, point-in-time (as-of anchored RPC queries; no data after as_of is used for features)
- Label: bad_24h = (price(as_of+24h) <= 0.5 x price(as_of)) OR (not graduated AND price(as_of+24h) <= 1.10 x launch price AND <= 0.8 x entry); as_of = launch + 300 s; prices from on-chain bonding-curve / PumpSwap pool balances
- Split: time-ordered; train n=1053 (2026-10-31T10:27Z -> 2026-11-02T21:45Z), test n=703 (2026-11-02T21:45Z -> 2026-11-03T03:48Z)
- Fitted on train only: skip_score >= 40, reduced_score >= 35 (defaults 60/30); objective: balanced accuracy on TRAIN: skip_score vs bad_24h; reduced_score vs adverse_24h (bad_24h OR return_24h <= -10%)

- **Deployment:** fitted thresholds NOT deployed; documented defaults remain live (deploy fitted thresholds/weights only if held-out AUC >= 0.6, it beats the live version, and a fresh holdout (>= 30 launches, >= 5 bad, created after every launch used so far) also has AUC >= 0.6)
- Weight variant picked on TRAIN AUC: both_off -> weights {'creator_sold': 0, 'serial_deployer': 0}; live version held-out AUC 0.7803
- Variants (train / test AUC): live 0.6489 / 0.7803; creator_sold_off 0.6844 / 0.7803; serial_off 0.6862 / 0.7803; both_off 0.7132 / 0.7803; both_half 0.6872 / 0.7803

## Held-out TEST results (fitted thresholds)
| tier | n | bad | ok | bad rate |
|---|---:|---:|---:|---:|
| SKIP | 289 | 56 | 233 | 0.1938 |
| REDUCED | 125 | 2 | 123 | 0.016 |
| NORMAL | 289 | 4 | 285 | 0.0138 |

- n: 703
- base_rate_bad: 0.0882
- skip_precision_bad: 0.1938
- skip_recall_bad: 0.9032
- skip_or_reduced_precision_bad: 0.1401
- skip_or_reduced_recall_bad: 0.9355
- normal_precision_ok: 0.9862
- normal_recall_ok: 0.4446
- mean_sized_return_pct_of_bankroll: -0.0185

- bootstrap 95% CI (test): {'skip_precision_bad': [0.1479, 0.2391], 'skip_recall_bad': [0.8269, 0.9692], 'mean_sized_return_pct_of_bankroll': [-0.0296, -0.0086]}
- AUC of raw rule points vs bad_24h: train 0.7132, test 0.7803
- AUC of raw rule points vs adverse_24h (bad OR return <= -10%): {'train': 0.6943, 'test': 0.7633}
- TEST balanced accuracy: {'skip_vs_bad': 0.7698656333350108, 'reduced_vs_adverse': 0.6791566222967543, 'adverse_base_rate': 0.1337}
- Fit notes: []

### Baselines on TEST
- all_NORMAL: {'n': 703, 'tier': 'NORMAL', 'base_rate_bad': 0.0882, 'mean_sized_return_pct_of_bankroll': -0.1612}
- all_REDUCED: {'n': 703, 'tier': 'REDUCED', 'base_rate_bad': 0.0882, 'mean_sized_return_pct_of_bankroll': -0.0537}

### TEST with default (unfitted) thresholds
| tier | n | bad | ok | bad rate |
|---|---:|---:|---:|---:|
| SKIP | 159 | 34 | 125 | 0.2138 |
| REDUCED | 443 | 25 | 418 | 0.0564 |
| NORMAL | 101 | 3 | 98 | 0.0297 |

- n: 703
- base_rate_bad: 0.0882
- skip_precision_bad: 0.2138
- skip_recall_bad: 0.5484
- skip_or_reduced_precision_bad: 0.098
- skip_or_reduced_recall_bad: 0.9516
- normal_precision_ok: 0.9703
- normal_recall_ok: 0.1529
- mean_sized_return_pct_of_bankroll: -0.032

## TRAIN results (in-sample, optimistic)
| tier | n | bad | ok | bad rate |
|---|---:|---:|---:|---:|
| SKIP | 502 | 81 | 421 | 0.1614 |
| REDUCED | 145 | 9 | 136 | 0.0621 |
| NORMAL | 406 | 6 | 400 | 0.0148 |

- n: 1053
- base_rate_bad: 0.0912
- skip_precision_bad: 0.1614
- skip_recall_bad: 0.8438
- skip_or_reduced_precision_bad: 0.1391
- skip_or_reduced_recall_bad: 0.9375
- normal_precision_ok: 0.9852
- normal_recall_ok: 0.418
- mean_sized_return_pct_of_bankroll: -0.0094

## Per-rule hit rates (all rows / test)
| rule | fired (all) | hit rate | bad rate fired | bad rate not fired | lift | no data | test fired | test lift |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| authority_not_revoked | 0 | 0.0 | None | 0.09 | None | 0 | 0 | None |
| creator_holds | 39 | 0.0222 | 0.4615 | 0.0815 | 5.663 | 51 | 18 | 5.64 |
| creator_sold | 274 | 0.156 | 0.062 | 0.0951 | 0.652 | 0 | 0 | None |
| early_concentration | 435 | 0.2477 | 0.2161 | 0.0484 | 4.465 | 51 | 161 | 6.118 |
| fresh_deployer | 1550 | 0.8827 | 0.0923 | 0.0728 | 1.268 | 44 | 635 | 1.553 |
| fresh_wallet_ratio | 1635 | 0.9311 | 0.0948 | 0.0248 | 3.823 | 72 | 655 | 2.197 |
| same_slot_bundle | 638 | 0.3633 | 0.1458 | 0.0581 | 2.509 | 0 | 205 | 3.364 |
| serial_deployer | 223 | 0.127 | 0.0448 | 0.0965 | 0.464 | 0 | 0 | None |
| shared_funder_cluster | 921 | 0.5245 | 0.1336 | 0.0419 | 3.189 | 0 | 391 | 3.322 |

## Secondary labels (TEST)
- loss50_24h: {'base_rate': 0.0413, 'auc': 0.7651}
- dead_24h: {'base_rate': 0.0811, 'auc': 0.7823}
- crash_24h: {'base_rate': 0.0, 'auc': None}
- bad_1h: {'base_rate': 0.0683, 'auc': 0.7887}
- bad_6h: {'base_rate': 0.0754, 'auc': 0.7795}

## Outcome mix (all)
- {'graduated_24h': 9, 'median_return_24h': 0}

## Interpretation (hand-written; re-check when the data changes)
- Held-out AUC near 0.5 means the combined score did not separate bad from ok launches in this sample. Do not read the tier sizes as validated.
- Most qualifying launches simply stop trading within minutes and sit near their 5-minute price. Under this label that is 'ok' (you can still sell back to the curve), so the bad class is rare (~9%) and the effective sample of bad launches is small (~28 overall, 11 in test).
- creator_sold and serial_deployer show lift < 1: when the creator has already dumped (or is a serial launcher) by +5 min, the drop has usually happened before entry, so the coin flatlines afterwards instead of falling another 50%. These rules predict 'dead coin', not 'further loss', Since 2026-11-03 their weight is chosen by the train-AUC weight experiment (currently 0: kept as informational evidence, no points).
- early_concentration and creator_holds have the most consistent lift (train and test), but they fire rarely.
