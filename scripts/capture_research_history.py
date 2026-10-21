"""One bounded retry of transient history intake, preserving its fixed requested range."""
import argparse
from pathlib import Path
import time

import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.solana_research import coin_evidence as ev  # noqa: E402
from src.solana_research import source_history as history  # noqa: E402


def failure_record(output):
    paths = sorted(output.glob("segment_*/attempt_*/archive.json"))
    if paths:
        archive = ev.read(paths[-1])
        records = archive.get("records", [])
        record = records[-1] if records else {}
    elif (output / "anchor.json").is_file():
        record = ev.read(output / "anchor.json")["record"]
    else:
        record = {}
    return {"method": record.get("request", {}).get("method"),
            "http_status": record.get("http_status"), "error": record.get("error"),
            "response_sha256": record.get("response_sha256")}


def run(output, *, slot_count=3, start_slot=None, transport=None):
    output = Path(output)
    receipt_path = output.with_name(output.name + "-recovery.json")
    if output.exists() or receipt_path.exists():
        raise FileExistsError("RESEARCH_CAPTURE_OUTPUT_EXISTS")
    ev.integer(slot_count, 1, history.MAX_SEGMENTS)
    if start_slot is not None:
        ev.integer(start_slot)
    try:
        result = history.collect(output, slot_count=slot_count, start_slot=start_slot, transport=transport)
    except ev.EvidenceError:
        reason = failure_record(output)
        fixed = (output / "request.json").is_file()
        transient = (reason["http_status"] in (429, 500, 502, 503, 504)
                     or str(reason["error"]).startswith("TRANSPORT_"))
        receipt = {"protocol": "AAI_RESEARCH_CAPTURE_RECOVERY_V1", "failure": reason,
                   "fixed_range_present": fixed, "transient_failure": transient,
                   "retry_requested": fixed and transient, "retry_count": 0,
                   "live_execution_allowed": False}
        if not fixed or not transient:
            ev.write(receipt_path, {**receipt, "status": "NOT_RETRIED"})
            print(ev.canonical({**receipt, "status": "NOT_RETRIED"}), flush=True)
            raise
        settings = ev.read(output / "request.json")
        receipt.update(start_slot=settings["start_slot"], end_slot=settings["end_slot"], retry_count=1)
        if transport is None:
            time.sleep(2)
        try:
            result = history.resume(output, transport=transport)
        except (ValueError, OSError, RuntimeError):
            ev.write(receipt_path, {**receipt, "status": "RECOVERY_FAILED"})
            print(ev.canonical({**receipt, "status": "RECOVERY_FAILED"}), flush=True)
            raise
        ev.write(receipt_path, {**receipt, "status": "RECOVERED"})
        print(ev.canonical({**receipt, "status": "RECOVERED"}), flush=True)
    print(ev.canonical(result), flush=True)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--slots", type=int, default=3)
    parser.add_argument("--start-slot", type=int)
    args = parser.parse_args()
    try:
        run(args.output, slot_count=args.slots, start_slot=args.start_slot)
    except (ValueError, OSError, RuntimeError) as error:
        print(ev.canonical({"status": "RESEARCH_CAPTURE_REJECTED", "error": str(error),
                           "live_execution_allowed": False}), flush=True)
        raise SystemExit(2) from None
