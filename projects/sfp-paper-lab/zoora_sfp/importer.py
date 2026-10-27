"""Offline Kraken-format CSV import; no provider request or approved source."""

import csv
import hashlib
import io

from .data import (
    HOUR,
    MAX_BARS,
    MAX_BYTES,
    ResearchError,
    canonical,
    integer,
    number,
    parse_dataset,
    require,
)


def _rows(text):
    try:
        yield from csv.reader(io.StringIO(text), strict=True)
    except csv.Error as exc:
        raise ResearchError("INVALID_CSV") from exc


def import_csv(raw, *, base, quote, venue, source_id, captured_ms, delay_ms=0,
               classification="SOURCE_ASSERTED_OBSERVATIONS"):
    require(isinstance(raw, bytes) and len(raw) <= MAX_BYTES, "INPUT_SIZE_LIMIT")
    integer(captured_ms, 0, 253_402_300_799_000)
    integer(delay_ms, 0, 24 * HOUR)
    require(classification in {"SYNTHETIC", "SOURCE_ASSERTED_OBSERVATIONS"},
            "INVALID_CLASSIFICATION")
    try:
        text = raw.decode("utf-8")
    except UnicodeError as exc:
        raise ResearchError("INVALID_CSV_ENCODING") from exc
    rows = []
    rejected_unfinished = 0
    reader = _rows(text)
    for n, row in enumerate(reader):
        require(n <= MAX_BARS, "BAR_COUNT_LIMIT")
        if n == 0 and row == ["timestamp", "open", "high", "low", "close", "volume", "trades"]:
            continue
        require(len(row) == 7 and row[0].isascii() and row[0].isdigit() and
                len(row[0]) <= 12, "INVALID_CSV_ROW")
        start = integer(int(row[0]) * 1000, 0, 253_402_300_795_000)
        for value in row[1:6]:
            number(value)
        require(row[6].isascii() and row[6].isdigit() and len(row[6]) <= 12,
                "INVALID_CSV_TRADE_COUNT")
        end = start + HOUR
        if end + delay_ms > captured_ms:
            rejected_unfinished += 1
            continue
        rows.append({"open_ms": start, "close_ms": end, "available_ms": end + delay_ms,
                     "open": row[1], "high": row[2], "low": row[3], "close": row[4]})
    require(rows, "NO_COMPLETED_BARS")
    value = {"protocol": "ZOORA_SFP_DATASET_V1",
             "market": {"base": base, "quote": quote, "venue": venue, "source_id": source_id},
             "classification": classification,
             "availability": "SYNTHETIC_RECONSTRUCTION",
             "source_sha256": hashlib.sha256(raw).hexdigest(),
             "captured_ms": captured_ms,
             "purpose": "ENGINE_ACCEPTANCE_NOT_STRATEGY_EVIDENCE" if classification == "SYNTHETIC"
             else "USER_SUPPLIED_HISTORY_NOT_INDEPENDENTLY_VERIFIED", "bars": rows}
    body = canonical(value) + b"\n"
    dataset = parse_dataset(body)
    return body, {"bars_imported": len(rows), "unfinished_or_not_yet_available": rejected_unfinished,
                  "coverage_gaps": len(dataset.gaps), "source_verification": "UNAVAILABLE",
                  "availability": "SYNTHETIC_RECONSTRUCTION"}

