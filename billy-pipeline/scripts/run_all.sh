#!/usr/bin/env bash
# Full pipeline: tests -> ingest -> parse -> market data -> backtest (+walk-forward/grid) -> report -> paper signals.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -x .venv/bin/billy ] || { python3 -m venv .venv && .venv/bin/pip install -q -e ".[dev]"; }
.venv/bin/python -m pytest -q
.venv/bin/billy ingest
.venv/bin/billy parse > /dev/null
.venv/bin/billy data > /dev/null
.venv/bin/billy backtest
.venv/bin/billy report
.venv/bin/billy signals --paper ${BILLY_NOTIFY:+--notify}
