# BT-005 source acceptance snapshot — October 14, 2026

**SYNTHETIC SOFTWARE TEST DATA. NOT REAL TRADING OR PERFORMANCE EVIDENCE.**

Source commit: e175443ca9d3691b0e6ad0b37da13928e81744bf. [Source CI run](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/38605707606) passed 59 tests in normal and optimized modes, lint and six acceptance checks on Linux Python 3.12.15/3.14.8 and Windows Python 3.14.8. Signals, future labels, normalized dataset hashes and numerical outputs agree. Windows package-byte fingerprints differ because its Python checkout uses CRLF; these hashes were verified against committed LF bytes converted to CRLF.

[CI_SOURCE_RECORD.json](CI_SOURCE_RECORD.json) records exact source/run/job/artifact identifiers and verified archive/report hashes. [acceptance.json](acceptance.json) is copied from Linux 3.12 CI. The complete [base-report](base-report/COMMUNITY_UPDATE.md) is retained: its JSON, Markdown and manifest are byte-identical to that archive; its three CSVs were regenerated from the exact source and match every CI manifest hash. Original archives contain four summary files and expire October 28; this record and reproducible source remain.

From projects/sfp-paper-lab:

```sh
python -m zoora_sfp verify --report-dir evidence/2026-10-14-source-e175443/base-report
```

The verifier checks five bound exports and internal accounting consistency. It does not certify historical source truth or profitability. This snapshot names its source commit. Later current-head CI proof is recorded in [PR #24](https://github.com/BuildWithAAI/buildwithAAI/pull/24); a later regenerated run has a different identity.

All prices, fills and costs are synthetic. The budget is unselected/zero. Funds moved, tokens purchased and tokens burned are zero; no AAI mint or transaction is asserted.
