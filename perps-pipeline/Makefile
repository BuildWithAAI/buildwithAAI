PY ?= python3.13
VENV := .venv
BIN := $(VENV)/bin

.PHONY: venv install test lint typecheck check backfill research backtest paper report quality tick journal clean

venv:
	uv venv --python $(PY) $(VENV) || $(PY) -m venv $(VENV)

install: venv
	uv pip install --python $(BIN)/python -r requirements.lock && uv pip install --python $(BIN)/python -e ".[dev]" \
	  || ($(BIN)/pip install -r requirements.lock && $(BIN)/pip install -e ".[dev]")

test:
	$(BIN)/pytest -q

lint:
	$(BIN)/ruff check src tests

typecheck:
	$(BIN)/mypy src

check: lint typecheck test

backfill:            ## make backfill EXCHANGE=blofin
	$(BIN)/perps backfill --exchange $(or $(EXCHANGE),blofin)

quality:
	$(BIN)/perps quality

research:            ## full IS/OOS + sweep + walk-forward + report
	$(BIN)/perps research

backtest:            ## make backtest STRAT=ema_pullback TF=1H SYMS=BTC-USDT
	$(BIN)/perps backtest $(or $(STRAT),ema_pullback) --tf $(or $(TF),1H) --symbols $(or $(SYMS),BTC-USDT)

paper:               ## legacy one-shot paper step (superseded by `make tick`)
	$(BIN)/perps paper

report:              ## orchestrator status JSON + markdown
	$(BIN)/perps report --out state/status

tick:                ## one arena step (cron runs this every 5 min)
	$(BIN)/perps tick

journal:             ## arena trade journal
	$(BIN)/perps journal

clean:
	rm -rf .pytest_cache .mypy_cache .ruff_cache build *.egg-info
