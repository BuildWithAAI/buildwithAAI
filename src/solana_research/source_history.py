"""Bounded, resumable source acquisition; one writer, immutable attempts, no trading."""
from __future__ import annotations

import base64
from contextlib import contextmanager
from datetime import datetime, timezone
import os
from pathlib import Path
import stat
import time

from . import coin_evidence as ev
from . import evidence_capture as capture

MAX_SEGMENTS = 64
MAX_ATTEMPTS = 3
MAX_STORED_BYTES = 128 * 1024**2
MAX_SECONDS = 900
ANCHOR_LIMIT = 65_536
WINDOW_PROTOCOL = "AAI_CONTIGUOUS_SOURCE_WINDOW_V1"


def window_pin(pins):
    return ev.digest({"protocol": WINDOW_PROTOCOL, "archive_sha256s": pins})


def contiguous_groups(archives):
    """Verify parent links before treating adjacent requested intervals as one window."""
    groups, previous, last_block, window_start = [], None, None, None
    for archive in archives:
        blocks, _ = ev.archive_blocks(archive)
        start = archive["requested_start_slot"]
        ev.require(previous is None or start > previous["requested_end_slot"], "HISTORY_OVERLAP")
        adjacent = previous is not None and start == previous["requested_end_slot"] + 1
        if adjacent:
            ev.require(archive["endpoint"] == previous["endpoint"], "HISTORY_ENDPOINT_CHANGED")
        else:
            groups.append([])
            last_block, window_start = None, start
        for block in blocks:
            if last_block is not None:
                ev.require(block["parent_slot"] == last_block["slot"]
                           and block["previous_blockhash"] == last_block["blockhash"],
                           "HISTORY_BLOCK_LINKAGE_GAP")
            else:
                ev.require(block["parent_slot"] < window_start, "HISTORY_BLOCK_LINKAGE_GAP")
            last_block = block
        groups[-1].append(archive)
        previous = archive
    return groups


def _layout(root):
    ev.require(root.is_dir() and not root.is_symlink(), "SESSION_DIRECTORY")
    total = 0
    allowed = {"anchor.json", "request.json", "session-manifest.json", "writer.lock"}
    segment_names = {f"segment_{i:03}" for i in range(MAX_SEGMENTS)}
    for item in root.iterdir():
        ev.require(not item.is_symlink(), "SESSION_SYMLINK")
        if item.name in allowed:
            ev.require(item.is_file(), "SESSION_FILE_TYPE")
            total += item.stat().st_size
        else:
            ev.require(item.name in segment_names and item.is_dir(), "SESSION_LAYOUT")
            for attempt in item.iterdir():
                ev.require(not attempt.is_symlink() and attempt.is_dir()
                           and attempt.name in {f"attempt_{i:03}" for i in range(MAX_ATTEMPTS)},
                           "SESSION_ATTEMPT_LAYOUT")
                for source in attempt.iterdir():
                    ev.require(source.name == "archive.json" and source.is_file()
                               and not source.is_symlink(), "SESSION_ARCHIVE_LAYOUT")
                    total += source.stat().st_size
        ev.require(total <= MAX_STORED_BYTES, "SESSION_STORAGE_BOUND")
    return total


@contextmanager
def _writer(root, *, create=False):
    """OS advisory locks release after a crashed process; the one-byte file is retained."""
    path = root / "writer.lock"
    ev.require(not path.is_symlink(), "SESSION_SYMLINK")
    flags = os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags | (os.O_CREAT | os.O_EXCL if create else 0), 0o600)
    locked = False
    try:
        ev.require(stat.S_ISREG(os.fstat(descriptor).st_mode), "SESSION_LOCK_TYPE")
        if create:
            os.write(descriptor, b"0")
        ev.require(os.fstat(descriptor).st_size == 1, "SESSION_LOCK_TYPE")
        try:
            if os.name == "nt":
                import msvcrt
                os.lseek(descriptor, 0, os.SEEK_SET)
                msvcrt.locking(descriptor, msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            locked = True
        except OSError as error:
            raise ev.EvidenceError("SESSION_WRITER_BUSY") from error
        yield
    finally:
        if locked:
            if os.name == "nt":
                import msvcrt
                os.lseek(descriptor, 0, os.SEEK_SET)
                msvcrt.locking(descriptor, msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(descriptor, fcntl.LOCK_UN)
        os.close(descriptor)


def _transport(transport):
    source = capture.fetch if transport is None else transport
    started, previous = time.monotonic(), None

    def bounded(request, endpoint, limit):
        nonlocal previous
        ev.require(time.monotonic() - started < MAX_SECONDS, "SESSION_TIME_BOUND")
        if transport is None and previous is not None:
            time.sleep(max(0, 0.8 - (time.monotonic() - previous)))
        previous = time.monotonic()
        return source(request, endpoint, limit)
    return bounded


def _anchor(root, endpoint, transport):
    request = {"jsonrpc": "2.0", "id": 1, "method": "getSlot",
               "params": [{"commitment": "finalized"}]}
    before = time.monotonic()
    status, raw, error = transport(request, endpoint, ANCHOR_LIMIT)
    ev.require(type(raw) is bytes, "TRANSPORT_BYTES")
    if len(raw) > ANCHOR_LIMIT:
        raw, error = raw[:ANCHOR_LIMIT], "ANCHOR_RESPONSE_BOUND"
    record = {"request": request, "request_sha256": ev.digest(request),
              "received_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
              "elapsed_ms": round((time.monotonic() - before) * 1000), "http_status": status,
              "response_base64": base64.b64encode(raw).decode(), "response_sha256": ev.sha(raw),
              "error": error}
    anchor = {"protocol": "AAI_FINALIZED_SESSION_ANCHOR_V1", "endpoint": endpoint, "record": record}
    ev.write(root / "anchor.json", anchor)  # Retain failed response bytes as well.
    _, payload, _ = ev.unwrap(record)
    return anchor, ev.integer(payload["result"])


def _request(root):
    _layout(root)
    anchor = ev.read(root / "anchor.json")
    ev.exact(anchor, ("protocol", "endpoint", "record"))
    ev.require(anchor["protocol"] == "AAI_FINALIZED_SESSION_ANCHOR_V1"
               and anchor["endpoint"] in ev.ENDPOINTS, "SESSION_ANCHOR")
    request, payload, size = ev.unwrap(anchor["record"])
    ev.require(size <= ANCHOR_LIMIT and request["method"] == "getSlot"
               and request["params"] == [{"commitment": "finalized"}], "SESSION_ANCHOR")
    finalized = ev.integer(payload["result"])
    settings = ev.read(root / "request.json")
    ev.exact(settings, ("protocol", "product", "endpoint", "anchor_sha256", "capture_code_sha256",
                        "start_slot", "end_slot", "segment_slots", "max_attempts"))
    ev.require(settings["protocol"] == "AAI_SOURCE_SESSION_REQUEST_V1"
               and settings["product"] == "AAI.fun" and settings["endpoint"] == anchor["endpoint"]
               and settings["anchor_sha256"] == ev.digest(anchor)
               and type(settings["segment_slots"]) is int and settings["segment_slots"] == 1
               and type(settings["max_attempts"]) is int and settings["max_attempts"] == MAX_ATTEMPTS,
               "SESSION_REQUEST")
    code = settings["capture_code_sha256"]
    ev.require(type(code) is str and len(code) == 64
               and all(c in "0123456789abcdef" for c in code), "SESSION_CODE_PIN")
    start, end = ev.integer(settings["start_slot"]), ev.integer(settings["end_slot"])
    ev.require(0 <= end - start < MAX_SEGMENTS and end <= finalized, "SESSION_FINALIZED_RANGE")
    allowed = {f"segment_{i:03}" for i in range(end - start + 1)}
    ev.require(all(not p.name.startswith("segment_") or p.name in allowed for p in root.iterdir()),
               "SESSION_SEGMENT_OUT_OF_RANGE")
    return settings


def _derive(root, settings):
    archives, segments, blocks, signatures = [], [], [], set()
    raw_bytes, trades, transactions, failed, unmapped = 0, 0, 0, 0, 0
    prefix = True
    for index, slot in enumerate(range(settings["start_slot"], settings["end_slot"] + 1)):
        directory = root / f"segment_{index:03}"
        attempts, selected, archive = [], None, None
        if directory.exists():
            paths = sorted(directory.iterdir())
            ev.require([p.name for p in paths] == [f"attempt_{i:03}" for i in range(len(paths))],
                       "SESSION_ATTEMPT_SEQUENCE")
            for number, path in enumerate(paths):
                ev.require(selected is None, "SESSION_ATTEMPT_AFTER_SUCCESS")
                source = path / "archive.json"
                if not source.exists():
                    attempts.append({"attempt": number, "archive_sha256": None, "status": "INTERRUPTED"})
                    continue
                candidate = ev.read(source)
                ev.require(type(candidate) is dict and candidate.get("protocol") == "AAI_SOLANA_RAW_BLOCK_ARCHIVE_V1"
                           and candidate.get("classification") == "RPC_CAPTURE"
                           and candidate.get("endpoint") == settings["endpoint"]
                           and candidate.get("requested_start_slot") == slot
                           and candidate.get("status") in ("COMPLETE", "INCOMPLETE"), "SESSION_ARCHIVE")
                attempts.append({"attempt": number, "archive_sha256": ev.digest(candidate),
                                 "status": candidate["status"]})
                if candidate["status"] == "COMPLETE":
                    ev.require(candidate["requested_end_slot"] == slot, "SESSION_SEGMENT_RANGE")
                    selected, archive = number, candidate
            ev.require(prefix, "SESSION_OUT_OF_ORDER_ATTEMPT")
        segments.append({"index": index, "slot": slot, "attempts": attempts, "selected_attempt": selected})
        if archive is None:
            prefix = False
            continue
        tape = ev.reconstruct(archive)
        current = {t["signature"] for t in tape["transactions"]}
        ev.require(not signatures & current, "SESSION_DUPLICATE_TRANSACTION")
        signatures.update(current)
        archive_blocks, _ = ev.archive_blocks(archive)
        for block in archive_blocks:
            if blocks:
                ev.require(block["parent_slot"] == blocks[-1]["slot"]
                           and block["previous_blockhash"] == blocks[-1]["blockhash"],
                           "HISTORY_BLOCK_LINKAGE_GAP")
            else:
                ev.require(block["parent_slot"] < settings["start_slot"], "HISTORY_BLOCK_LINKAGE_GAP")
            blocks.append({k: block[k] for k in
                           ("slot", "parent_slot", "blockhash", "previous_blockhash", "raw_response_sha256")})
        raw_bytes += sum(len(ev.unbase64(r["response_base64"])) for r in archive["records"])
        trades += len(tape["trades"])
        transactions += len(tape["transactions"])
        failed += tape["failed_transaction_count"]
        unmapped += tape["other_or_unmapped_cpi_events"]
        archives.append(archive)
    complete = len(archives) == settings["end_slot"] - settings["start_slot"] + 1
    manifest = {"protocol": "AAI_CONTIGUOUS_SOURCE_SESSION_V1", "product": "AAI.fun",
                "classification": "RPC_CAPTURE", "status": "COMPLETE" if complete else "INCOMPLETE",
                "request_sha256": ev.digest(settings), "anchor_sha256": settings["anchor_sha256"],
                "endpoint": settings["endpoint"], "start_slot": settings["start_slot"],
                "end_slot": settings["end_slot"], "segments": segments, "blocks": blocks,
                "archive_count": len(archives), "produced_block_count": len(blocks),
                "skipped_slots": [a["requested_start_slot"] for a in archives if not ev.archive_blocks(a)[0]],
                "raw_response_bytes": raw_bytes, "transaction_count": transactions, "trade_count": trades,
                "failed_transaction_count": failed, "other_or_unmapped_cpi_events": unmapped,
                "source_attestation": "SINGLE_RPC_ASSERTION_NOT_INDEPENDENT",
                "historical_observer_availability_known": False, "execution_quotes_available": False,
                "training_performed": False, "market_validation_established": False,
                "live_execution_allowed": False}
    return archives, manifest


def verify(directory):
    root = Path(directory)
    settings = _request(root)
    archives, manifest = _derive(root, settings)
    ev.require(manifest["status"] == "COMPLETE", "SESSION_INCOMPLETE")
    ev.require(ev.canonical(manifest) == ev.canonical(ev.read(root / "session-manifest.json")),
               "SESSION_MANIFEST_RECONSTRUCTION_MISMATCH")
    return archives, manifest


def summary(manifest):
    return {k: v for k, v in manifest.items() if k not in ("segments", "blocks")}


def _continue(root, transport):
    settings = _request(root)
    if (root / "session-manifest.json").exists():
        return summary(verify(root)[1])
    ev.require(settings["capture_code_sha256"] == ev.sha(Path(__file__).read_bytes()), "SESSION_RESUME_CODE_CHANGED")
    archives, manifest = _derive(root, settings)
    prior = manifest["blocks"][-1] if manifest["blocks"] else None
    for index in range(len(archives), settings["end_slot"] - settings["start_slot"] + 1):
        ev.require(_layout(root) + ev.MAX_FILE < MAX_STORED_BYTES, "SESSION_STORAGE_BOUND")
        segment = root / f"segment_{index:03}"
        segment.mkdir(mode=0o700, exist_ok=True)
        number = len(list(segment.iterdir()))
        ev.require(number < MAX_ATTEMPTS, "SESSION_ATTEMPTS_EXHAUSTED")
        # Each failure or interrupted process gets a new immutable directory.
        captured = capture.capture(segment / f"attempt_{number:03}", endpoint=settings["endpoint"],
                        start_slot=settings["start_slot"] + index, count=1, transport=transport)
        for block in ev.archive_blocks(captured)[0]:
            if prior is not None:
                ev.require(block["parent_slot"] == prior["slot"]
                           and block["previous_blockhash"] == prior["blockhash"],
                           "HISTORY_BLOCK_LINKAGE_GAP")
            else:
                ev.require(block["parent_slot"] < settings["start_slot"], "HISTORY_BLOCK_LINKAGE_GAP")
            prior = block
    _, manifest = _derive(root, settings)
    ev.require(manifest["status"] == "COMPLETE", "SESSION_INCOMPLETE")
    ev.write(root / "session-manifest.json", manifest)
    return summary(verify(root)[1])


def collect(output, *, slot_count=8, start_slot=None, endpoint=ev.ENDPOINTS[0], transport=None):
    ev.integer(slot_count, 1, MAX_SEGMENTS)
    ev.require(endpoint in ev.ENDPOINTS, "UNAPPROVED_PUBLIC_ENDPOINT")
    if start_slot is not None:
        ev.integer(start_slot)
    root = Path(output)
    root.mkdir(mode=0o700, parents=True, exist_ok=False)
    bounded = _transport(transport)
    with _writer(root, create=True):
        anchor, finalized = _anchor(root, endpoint, bounded)
        start = finalized - slot_count + 1 if start_slot is None else start_slot
        end = start + slot_count - 1
        ev.require(0 <= start <= end <= finalized, "SESSION_FINALIZED_RANGE")
        settings = {"protocol": "AAI_SOURCE_SESSION_REQUEST_V1", "product": "AAI.fun", "endpoint": endpoint,
                    "anchor_sha256": ev.digest(anchor), "capture_code_sha256": ev.sha(Path(__file__).read_bytes()),
                    "start_slot": start, "end_slot": end, "segment_slots": 1, "max_attempts": MAX_ATTEMPTS}
        ev.write(root / "request.json", settings)
        return _continue(root, bounded)


def resume(directory, *, transport=None):
    root = Path(directory)
    ev.require(root.is_dir() and not root.is_symlink(), "SESSION_DIRECTORY")
    with _writer(root):
        return _continue(root, _transport(transport))
