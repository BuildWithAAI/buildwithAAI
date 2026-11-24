PY ?= .venv/bin/python
BILLY ?= .venv/bin/billy

.PHONY: install test ingest parse data backtest report signals all daily clean

install:
	python3 -m venv .venv && .venv/bin/pip install -q -e ".[dev]"

test:
	$(PY) -m pytest -q --cov=billy --cov-report=term-missing

ingest:
	$(BILLY) ingest
parse:
	$(BILLY) parse
data:
	$(BILLY) data
backtest:
	$(BILLY) backtest
report:
	$(BILLY) report
signals:
	$(BILLY) signals --paper

all: test ingest parse data backtest report signals

# daily job: new posts already saved to data/inbox/ by the agent
daily: ingest parse data signals

clean:
	rm -rf reports/artifacts reports/*.png reports/*.md reports/*.json .pytest_cache .coverage
