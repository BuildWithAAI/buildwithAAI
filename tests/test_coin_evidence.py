"""Synthetic source-schema regressions; these fixtures are never historical market evidence."""
from copy import deepcopy
from fractions import Fraction
import base64
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from src.solana_research import coin_evidence as ev
from src.solana_research.evidence_capture import capture
from src.solana_research.normalize import UnsupportedTransactionVersion

ROOT = Path(__file__).resolve().parents[1]


def address(number):
    return ev.b58encode(bytes((number,)) * 32)


def event(side="BUY", quote=1_000_000_000, base=2_000_000):
    values = [1000, base, 99, 100, 200, 300, 400, quote, 20, 2, 5, 1, min(quote + 2, 2**64 - 1), min(quote + 3, 2**64 - 1)]
    raw = (ev.BUY if side == "BUY" else ev.SELL) + b"".join(
        value.to_bytes(8, "little", signed=i == 0) for i, value in enumerate(values))
    return raw + b"".join(bytes((n,)) * 32 for n in (1, 2, 3, 4)) + b"opaque-current-fields"


def transaction(number, side="BUY", quote=1_000_000_000, failed=False):
    keys = [ev.PROGRAM, address(1), address(2), address(3), address(4)]
    balances = [{"accountIndex": i, "mint": address(mint),
                 "uiTokenAmount": {"decimals": decimals, "amount": "10000000000",
                                   "uiAmount": 10.0, "uiAmountString": "10"}}
                for i, mint, decimals in ((3, 5, 6), (4, 6, 9))]
    return {"version": 0, "transaction": {"signatures": [ev.b58encode(bytes((number,)) * 64)],
            "message": {"accountKeys": keys, "instructions": [{"programIdIndex": 0, "accounts": [], "data": "1"}]}},
            "meta": {"err": {"InstructionError": [0, "fixture"]} if failed else None, "fee": 5000,
                     "loadedAddresses": {"writable": [], "readonly": []},
                     "preTokenBalances": deepcopy(balances), "postTokenBalances": deepcopy(balances),
                     "innerInstructions": [{"index": 0, "instructions": [
                         {"programIdIndex": 0, "accounts": [1, 2, 3, 4], "stackHeight": 2,
                          "data": ev.b58encode(ev.EVENT_CPI + event(side, quote))}]}],
                     "logMessages": ["Program data: " + base64.b64encode(event(side, quote)).decode()]}}


def record(method, params, result, index):
    request = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    raw = ev.canonical({"jsonrpc": "2.0", "id": 1, "result": result}).encode()
    return {"request": request, "request_sha256": ev.digest(request),
            "received_at": f"2026-10-20T18:00:{index:02d}Z", "elapsed_ms": 10, "http_status": 200,
            "response_base64": base64.b64encode(raw).decode(), "response_sha256": ev.sha(raw), "error": None}


def archive():
    records = [record("getGenesisHash", [], ev.MAINNET_GENESIS, 0),
               record("getSlot", [{"commitment": "finalized"}], 51, 1),
               record("getBlocks", [50, 51, {"commitment": "finalized"}], [50, 51], 2)]
    for index, slot in enumerate((50, 51)):
        block = {"blockhash": address(slot), "previousBlockhash": address(slot - 1), "parentSlot": slot - 1,
                 "blockHeight": slot, "blockTime": 1000 + index, "transactions": [
                     transaction(10 + index*3, quote=(1 + index)*1_000_000_000),
                     transaction(11 + index*3, "SELL", (2 + index)*1_000_000_000),
                     transaction(12 + index*3, failed=True)]}
        records.append(record("getBlock", [slot, {
            "commitment": "finalized", "encoding": "json", "transactionDetails": "full",
            "rewards": False, "maxSupportedTransactionVersion": 1}], block, index + 3))
    return {"protocol": "AAI_SOLANA_RAW_BLOCK_ARCHIVE_V1", "classification": "SYNTHETIC_FIXTURE",
            "endpoint": ev.ENDPOINTS[0], "status": "COMPLETE", "error": None, "requested_start_slot": 50,
            "requested_end_slot": 51, "capture_code_sha256": "f" * 64, "records": records}


def edit_result(data, index, change):
    item = data["records"][index]
    payload = ev.parse(ev.unbase64(item["response_base64"]))
    change(payload["result"])
    raw = ev.canonical(payload).encode()
    item["response_base64"], item["response_sha256"] = base64.b64encode(raw).decode(), ev.sha(raw)


class CoinEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.data = archive()

    def test_exact_observed_price_volume_and_failed_fees_are_reconstructed(self):
        tape = ev.reconstruct(self.data)
        self.assertEqual(len(tape["trades"]), 4)
        self.assertEqual(tape["failed_transaction_count"], 2)
        self.assertEqual(tape["known_fee_lamports"], 30_000)
        self.assertEqual(tape["markets"][0]["quote_volume_atoms"], 8_000_000_000)
        self.assertEqual(ev.price(tape["trades"][0]), Fraction(1, 2))
        self.assertEqual(tape["classification"], "SYNTHETIC_FIXTURE")
        self.assertFalse(tape["execution_quotes_available"])
        self.assertFalse(tape["historical_observer_availability_known"])

    def test_raw_response_byte_tampering_is_rejected(self):
        self.data["records"][3]["response_sha256"] = "a" * 64
        with self.assertRaisesRegex(ev.EvidenceError, "RESPONSE_HASH"):
            ev.reconstruct(self.data)

    def test_request_tampering_is_rejected(self):
        self.data["records"][3]["request"]["params"][0] = 49
        with self.assertRaisesRegex(ev.EvidenceError, "REQUEST_HASH"):
            ev.reconstruct(self.data)

    def test_wrong_cluster_and_short_caip_identifier_are_rejected(self):
        for genesis in ("devnet", ev.MAINNET_GENESIS[:32]):
            self.data = archive()
            self.data["records"][0] = record("getGenesisHash", [], genesis, 0)
            with self.assertRaisesRegex(ev.EvidenceError, "WRONG_GENESIS"):
                ev.reconstruct(self.data)

    def test_endpoint_credentials_and_unknown_fields_are_rejected(self):
        self.data["endpoint"] += "?api-key=fixture-secret"
        with self.assertRaises(ev.EvidenceError):
            ev.reconstruct(self.data)
        self.data = archive()
        self.data["future_rug"] = True
        with self.assertRaises(ev.EvidenceError):
            ev.reconstruct(self.data)

    def test_non_read_only_rpc_method_is_rejected(self):
        request = self.data["records"][0]["request"]
        request["method"] = "sendTransaction"
        self.data["records"][0]["request_sha256"] = ev.digest(request)
        with self.assertRaisesRegex(ev.EvidenceError, "READ_ONLY"):
            ev.reconstruct(self.data)

    def test_incomplete_capture_and_rpc_error_are_rejected(self):
        self.data["status"] = "INCOMPLETE"
        with self.assertRaises(ev.EvidenceError):
            ev.reconstruct(self.data)
        self.data = archive()
        self.data["records"][0]["error"] = "HTTP_429"
        with self.assertRaises(ev.EvidenceError):
            ev.reconstruct(self.data)

    def test_duplicate_json_nonfinite_and_invalid_base58_are_rejected(self):
        for raw in (b'{"x":1,"x":2}', b'{"x":NaN}'):
            with self.assertRaises(ev.EvidenceError):
                ev.parse(raw)
        with self.assertRaises(ev.EvidenceError):
            ev.b58decode("O0Il")

    def test_clock_reversal_is_not_reinterpreted_as_historical_latency(self):
        self.data["records"][4]["received_at"] = "2026-10-19T18:00:00Z"
        with self.assertRaisesRegex(ev.EvidenceError, "CAPTURE_CLOCK_REVERSED"):
            ev.reconstruct(self.data)

    def test_future_or_uncovered_block_window_is_rejected(self):
        self.data["requested_end_slot"] = 52
        with self.assertRaisesRegex(ev.EvidenceError, "FINALIZED_BOUNDARY"):
            ev.reconstruct(self.data)
        self.data = archive()
        self.data["records"].pop()
        with self.assertRaisesRegex(ev.EvidenceError, "BLOCK_COVERAGE_GAP"):
            ev.reconstruct(self.data)

    def test_skipped_slot_is_distinguished_from_unavailable_produced_block(self):
        data = archive()
        data["records"][2] = record("getBlocks", [50, 51, {"commitment": "finalized"}], [51], 2)
        data["records"].pop(3)
        tape = ev.reconstruct(data)
        self.assertEqual(tape["skipped_slots"], [50])
        self.assertEqual(tape["captured_block_count"], 1)

    def test_parent_hash_mismatch_is_rejected(self):
        edit_result(self.data, 4, lambda b: b.update(previousBlockhash=address(9)))
        with self.assertRaisesRegex(ev.EvidenceError, "BLOCK_LINKAGE_GAP"):
            ev.reconstruct(self.data)

    def test_null_block_and_unsupported_transaction_version_fail_closed(self):
        self.data["records"][3] = record("getBlock", self.data["records"][3]["request"]["params"], None, 3)
        with self.assertRaises(ev.EvidenceError):
            ev.reconstruct(self.data)
        self.data = archive()
        edit_result(self.data, 3, lambda b: b["transactions"][0].update(version=2))
        with self.assertRaises(UnsupportedTransactionVersion):
            ev.reconstruct(self.data)

    def test_duplicate_transaction_cannot_inflate_volume(self):
        edit_result(self.data, 3, lambda b: b["transactions"].append(deepcopy(b["transactions"][0])))
        with self.assertRaisesRegex(ev.EvidenceError, "DUPLICATE_TRANSACTION"):
            ev.reconstruct(self.data)

    def test_unknown_result_and_fee_stay_unknown(self):
        edit_result(self.data, 3, lambda b: b["transactions"][0].update(meta=None))
        tape = ev.reconstruct(self.data)
        self.assertEqual(tape["unknown_result_count"], 1)
        self.assertEqual(tape["unknown_fee_count"], 1)
        self.assertIsNone(tape["transactions"][0]["success"])
        self.assertIsNone(tape["transactions"][0]["fee_lamports"])

    def test_cpi_and_duplicate_log_event_are_counted_once(self):
        tape = ev.reconstruct(self.data)
        self.assertEqual(len(tape["trades"]), 4)

    def test_spoofed_program_logs_are_not_treated_as_executed_swaps(self):
        def change(block):
            block["transactions"][0]["meta"]["innerInstructions"] = []
        edit_result(self.data, 3, change)
        self.assertEqual(len(ev.reconstruct(self.data)["trades"]), 3)

    def test_wrong_program_tag_and_event_discriminator_do_not_match(self):
        cases = ("program", "tag", "event")
        for case in cases:
            data = archive()
            def change(block, case=case):
                instruction = block["transactions"][0]["meta"]["innerInstructions"][0]["instructions"][0]
                if case == "program":
                    instruction["programIdIndex"] = 1
                elif case == "tag":
                    instruction["data"] = ev.b58encode(b"notanchor" + event())
                else:
                    instruction["data"] = ev.b58encode(ev.EVENT_CPI + b"nottrade" + event()[8:])
            edit_result(data, 3, change)
            self.assertEqual(len(ev.reconstruct(data)["trades"]), 3)

    def test_truncated_supported_event_cannot_be_silently_dropped(self):
        with self.assertRaisesRegex(ev.EvidenceError, "TRUNCATED"):
            ev.decode_prefix(ev.BUY + b"short")

    def test_loaded_addresses_resolve_event_token_accounts(self):
        def change(block):
            tx = block["transactions"][0]
            keys = tx["transaction"]["message"]["accountKeys"]
            tx["meta"]["loadedAddresses"]["writable"] = keys[3:]
            del keys[3:]
        edit_result(self.data, 3, change)
        self.assertEqual(len(ev.reconstruct(self.data)["trades"]), 4)

    def test_mint_identity_conflict_is_not_zero_filled_or_guessed(self):
        def change(block):
            block["transactions"][0]["meta"]["postTokenBalances"][0]["mint"] = address(7)
        edit_result(self.data, 3, change)
        with self.assertRaisesRegex(ev.EvidenceError, "TOKEN_IDENTITY_CONFLICT"):
            ev.reconstruct(self.data)

    def test_missing_token_identity_is_explicitly_unmapped(self):
        def change(block):
            tx = block["transactions"][0]["meta"]
            tx["preTokenBalances"], tx["postTokenBalances"] = None, None
        edit_result(self.data, 3, change)
        tape = ev.reconstruct(self.data)
        self.assertEqual(len(tape["trades"]), 3)
        self.assertEqual(tape["other_or_unmapped_cpi_events"], 1)

    def test_large_integer_atoms_and_opaque_tail_are_retained(self):
        result = ev.decode_prefix(event(quote=2**64 - 1))
        self.assertEqual(result["quote_atoms"], 2**64 - 1)
        self.assertEqual(result["opaque_tail_bytes"], len(b"opaque-current-fields"))
        self.assertNotIn("virtual_quote_reserves", result)

    def test_different_quote_assets_never_share_volume_or_candles(self):
        def change(block):
            for field in ("preTokenBalances", "postTokenBalances"):
                block["transactions"][0]["meta"][field][1]["mint"] = address(7)
        edit_result(self.data, 3, change)
        self.assertEqual(len(ev.reconstruct(self.data)["markets"]), 2)

    def test_future_changes_do_not_change_replay_prefix(self):
        first = ev.replay(ev.reconstruct(self.data), alias_salt="1" * 64, max_events=2)
        edit_result(self.data, 4, lambda b: b.update(blockTime=9999))
        second = ev.replay(ev.reconstruct(self.data), alias_salt="1" * 64, max_events=2)
        self.assertEqual(first, second)

    def test_replay_hides_chain_identity_and_never_invents_a_fill(self):
        trace = ev.replay(ev.reconstruct(self.data), alias_salt="2" * 64)
        raw = ev.canonical(trace)
        for private in (address(1), address(5), address(6), "signature", "captured_at", "fee_lamports"):
            self.assertNotIn(private, raw)
        previous = "0" * 64
        for item in trace["events"]:
            self.assertEqual(item["previous_sha256"], previous)
            self.assertEqual(item["sha256"], ev.digest({"previous_sha256": previous, "event": item["event"]}))
            self.assertEqual(item["event"]["execution"], "OBSERVATION_ONLY_NO_SIMULATED_FILL")
            previous = item["sha256"]

    def test_actual_offline_cli_reconstruction_verification_and_tamper_rejection(self):
        with tempfile.TemporaryDirectory() as folder:
            source, output = Path(folder) / "source.json", Path(folder) / "result"
            source.write_text(ev.canonical(self.data), encoding="utf-8")
            for args in (["build", "--archive", str(source), "--output", str(output)],
                         ["verify", "--directory", str(output)]):
                process = subprocess.run([sys.executable, "-bb", "-X", "dev", "-W", "error",
                    str(ROOT / "scripts/coin_evidence.py"), *args], capture_output=True, text=True, timeout=30)
                self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
                self.assertEqual(json.loads(process.stdout)["classification"], "SYNTHETIC_FIXTURE")
            tape = ev.read(output / "trade-tape.json")
            tape["trades"][0]["quote_atoms"] += 1
            (output / "trade-tape.json").write_text(ev.canonical(tape), encoding="utf-8")
            with self.assertRaisesRegex(ev.EvidenceError, "RECONSTRUCTION_MISMATCH"):
                ev.verify_outputs(output)


class CaptureTests(unittest.TestCase):
    def transport(self, request, endpoint, limit):
        self.calls.append(request["method"])
        for record_value in self.data["records"]:
            if record_value["request"] == request:
                return 200, ev.unbase64(record_value["response_base64"]), None
        raise AssertionError("unexpected request")

    def setUp(self):
        self.data, self.calls = archive(), []

    def test_capture_retains_raw_bytes_and_only_reads_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "capture"
            result = capture(output, start_slot=50, count=2, transport=self.transport)
            self.assertEqual(result["status"], "COMPLETE")
            self.assertEqual(len(ev.reconstruct(result)["trades"]), 4)
            self.assertEqual(set(self.calls), {"getGenesisHash", "getSlot", "getBlocks", "getBlock"})
            with self.assertRaises(FileExistsError):
                capture(output, transport=self.transport)

    def test_failed_acquisition_is_retained_and_cannot_be_replayed(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "failed"
            with self.assertRaisesRegex(ev.EvidenceError, "CAPTURE_INCOMPLETE"):
                capture(output, transport=lambda request, endpoint, limit: (429, b"rate limited", "HTTP_429"))
            saved = ev.read(output / "archive.json")
            self.assertEqual(saved["status"], "INCOMPLETE")
            self.assertEqual(saved["records"][0]["http_status"], 429)
            with self.assertRaises(ev.EvidenceError):
                ev.reconstruct(saved)

    def test_endpoint_and_acquisition_bounds_are_enforced_before_transport(self):
        with tempfile.TemporaryDirectory() as folder:
            for settings in ({"endpoint": "https://example.com"}, {"count": 5}, {"start_slot": -1}):
                with self.assertRaises(ev.EvidenceError):
                    capture(Path(folder) / "blocked", transport=self.transport, **settings)
            self.assertEqual(self.calls, [])

    def test_response_size_overrun_is_incomplete_not_a_partial_success(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "overrun"
            with self.assertRaisesRegex(ev.EvidenceError, "CAPTURE_INCOMPLETE"):
                capture(output, transport=lambda request, endpoint, limit: (200, b"x" * (limit + 1), None))
            saved = ev.read(output / "archive.json")
            self.assertEqual(saved["records"][0]["error"], "RESPONSE_EXCEEDS_CAPTURE_BUDGET")


if __name__ == "__main__":
    unittest.main()
