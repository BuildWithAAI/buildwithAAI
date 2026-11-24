import datetime as dt
import os

HERE = os.path.dirname(os.path.abspath(__file__))
RADAR = os.path.dirname(HERE)
FIXTURES = os.path.join(RADAR, "fixtures")
SOURCES = os.path.join(RADAR, "sources.json")
RUN_DATE = dt.date(2026, 11, 24)
CTX = {"runDate": RUN_DATE, "maxAgeDays": 120}


def fixture(name, mode="rb"):
    with open(os.path.join(FIXTURES, name), mode) as fh:
        return fh.read()


def source(sid):
    import json
    with open(SOURCES, encoding="utf-8") as fh:
        for src in json.load(fh)["sources"]:
            if src["id"] == sid:
                return src
    raise KeyError(sid)
