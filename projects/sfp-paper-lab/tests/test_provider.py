"""Provider contract, bounded transport, exact raw mapping and notebook integration."""

import io
import json
import tempfile
import unittest
import urllib.error
from copy import deepcopy
from pathlib import Path
from unittest.mock import Mock, patch

from test_study import fast_plan

from scripts.make_study_demo import study_demo
from zoora_sfp.data import HOUR, ResearchError, canonical, decode, digest
from zoora_sfp.notebook import (
    capture_source,
    evaluate_notebook,
    load_notebook,
    notebook_status,
    open_notebook,
)
from zoora_sfp.notebook_reports import render_notebook, verify_notebook_export
from zoora_sfp.provider import (
    HOST,
    TARGETS,
    NoRedirect,
    capture_public,
    make_capture,
    ohlc_csv,
    parse_capture,
    parse_pair,
    request_public,
)
from zoora_sfp.reports import publish
from zoora_sfp.source_reports import render_source, save_source, verify_source


def fixture(start=0, end=721):
    bars = study_demo()["bars"][start:end]
    pair = {"error": [], "result": {"SOL/USD": {"base": "SOL", "quote": "USD", "altname": "SOLUSD",
            "wsname": "SOL/USD", "aclass_base": "currency", "aclass_quote": "currency", "status": "online"}}}
    rows = [[b["open_ms"] // 1000, b["open"], b["high"], b["low"], b["close"], b["close"], "100", 2]
            for b in bars]
    return pair, {"error": [], "result": {"SOL/USD": rows, "last": rows[-1][0]}}, bars[-1]["open_ms"] + HOUR // 2


def synthetic_capture(start=0, end=721, **kwargs):
    pair, ohlc, stamp = fixture(start, end)
    return make_capture(canonical(pair), canonical(ohlc), captured_ms=stamp, classification="SYNTHETIC", **kwargs)


def reseal(value):
    value.pop("capture_sha256")
    value["capture_sha256"] = digest(value)
    return canonical(value)


class FakeResponse:
    status = 200

    def __init__(self, body, headers=None, url=None):
        self.stream = io.BytesIO(body)
        self.headers = {"Content-Type": "application/json", **(headers or {})}
        self.url = url or "https://" + HOST + TARGETS["PAIR"]
        self.closed = False

    def getheader(self, name, default=None):
        return self.headers.get(name, default)

    def geturl(self):
        return self.url

    def read1(self, size):
        return self.stream.read(size)

    def close(self):
        self.closed = True
        self.stream.close()


class ProviderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = synthetic_capture()

    def test_market_identity_requires_display_names_and_spot_classes(self):
        pair, _, _ = fixture()
        self.assertEqual(parse_pair(canonical(pair))["instrument"], "SPOT_NOT_AAI_TOKEN_OR_DERIVATIVE")
        for key, bad in [("base", "AAI"), ("quote", "USDC"), ("aclass_base", "tokenized_asset")]:
            changed = deepcopy(pair)
            changed["result"]["SOL/USD"][key] = bad
            with self.subTest(key=key), self.assertRaisesRegex(ResearchError, "IDENTITY"):
                parse_pair(canonical(changed))

    def test_unknown_pair_key_or_legacy_format_is_rejected(self):
        pair, _, _ = fixture()
        pair["result"]["SOLUSD"] = pair["result"].pop("SOL/USD")
        with self.assertRaisesRegex(ResearchError, "IDENTITY"):
            parse_pair(canonical(pair))

    def test_provider_errors_and_duplicate_json_fields_fail(self):
        for raw in [b'{"error":["EGeneral:Busy"],"result":{}}',
                    b'{"error":[],"error":[],"result":{}}', b"null"]:
            with self.subTest(raw=raw), self.assertRaises(ResearchError):
                parse_pair(raw)

    def test_final_row_is_excluded_even_if_supplied_capture_time_is_later(self):
        _, ohlc, stamp = fixture(end=5)
        csv, counts = ohlc_csv(canonical(ohlc), stamp + HOUR * 5, 0)
        self.assertEqual(len(csv.splitlines()), 4)
        self.assertEqual(counts["uncommitted_final_rows_excluded"], 1)

    def test_721_compatibility_is_bounded_and_disclosed(self):
        parsed = parse_capture(self.raw)
        self.assertEqual(parsed["quality"]["bars"], 720)
        self.assertEqual(parsed["quality"]["provider_contract_warnings"],
                         ["OBSERVED_721_ROWS_VS_DOCUMENTED_720_LIMIT"])
        _, ohlc, stamp = fixture(end=722)
        with self.assertRaisesRegex(ResearchError, "ROW_LIMIT"):
            ohlc_csv(canonical(ohlc), stamp, 0)

    def test_documented_720_rows_have_no_compatibility_warning(self):
        parsed = parse_capture(synthetic_capture(end=720))
        self.assertEqual(parsed["quality"]["bars"], 719)
        self.assertEqual(parsed["quality"]["provider_contract_warnings"], [])

    def test_delay_cannot_make_closed_but_unavailable_rows_usable(self):
        parsed = parse_capture(synthetic_capture(delay_ms=HOUR))
        self.assertEqual(parsed["quality"]["bars"], 719)
        self.assertEqual(parsed["quality"]["other_not_yet_available_rows_excluded"], 1)

    def test_ohlc_order_shape_future_time_and_numeric_types_are_strict(self):
        _, original, stamp = fixture(end=5)
        for change in ["duplicate", "unaligned", "float_time", "bad_range", "bool_count", "future"]:
            ohlc = deepcopy(original)
            rows = ohlc["result"]["SOL/USD"]
            if change == "duplicate":
                rows[1][0] = rows[0][0]
            if change == "unaligned":
                rows[1][0] += 1
            if change == "float_time":
                rows[0][0] = float(rows[0][0])
            if change == "bad_range":
                rows[0][2] = "0.1"
            if change == "bool_count":
                rows[0][7] = True
            if change == "future":
                rows[-1][0] += 3 * 3600
            with self.subTest(change=change), self.assertRaises(ResearchError):
                ohlc_csv(canonical(ohlc), stamp, 0)

    def test_missing_intervals_remain_gaps(self):
        pair, ohlc, stamp = fixture()
        del ohlc["result"]["SOL/USD"][300]
        parsed = parse_capture(make_capture(canonical(pair), canonical(ohlc), captured_ms=stamp,
                                            classification="SYNTHETIC"))
        self.assertEqual(len(parsed["dataset"].gaps), 1)
        self.assertIn("MISSING_HOURLY_INTERVALS", parsed["quality"]["flags"])
        self.assertEqual(parsed["quality"]["local_data_screen"], "BLOCKED")

    def test_stale_data_and_nononline_market_are_visible(self):
        pair, ohlc, stamp = fixture()
        pair["result"]["SOL/USD"]["status"] = "cancel_only"
        parsed = parse_capture(make_capture(canonical(pair), canonical(ohlc), captured_ms=stamp + 3 * HOUR,
                                            classification="SYNTHETIC"))
        self.assertIn("STALE_LATEST_COMPLETED_BAR", parsed["quality"]["flags"])
        self.assertIn("MARKET_NOT_ONLINE_AT_CAPTURE", parsed["quality"]["flags"])

    def test_original_raw_bytes_and_csv_mapping_are_bound(self):
        parsed = parse_capture(self.raw)
        self.assertEqual(parsed["dataset"].source_sha256, parsed["capture"]["capture_sha256"])
        self.assertEqual(parsed["csv_raw"].splitlines()[0].decode().split(",")[-2:], ["100", "2"])
        self.assertEqual(parsed["dataset"].market["quote"], "USD")
        self.assertEqual(parsed["capture"]["mode"], "LOCAL_FILE_IMPORT_NOT_WITNESSED")

    def test_capture_checksum_and_rehashed_receipt_edits_fail(self):
        value = decode(self.raw)
        value["delay_ms"] = 1
        with self.assertRaisesRegex(ResearchError, "CAPTURE_HASH"):
            parse_capture(canonical(value))
        value = decode(self.raw)
        value["requests"][1]["body_sha256"] = "0" * 64
        with self.assertRaisesRegex(ResearchError, "RECEIPT_MISMATCH"):
            parse_capture(reseal(value))

    def test_receipts_cannot_target_private_endpoints_or_fake_timing(self):
        for key, bad in [("url", "https://api.kraken.com/0/private/AddOrder"), ("method", "POST"),
                         ("status", True), ("started_ms", -1)]:
            value = decode(self.raw)
            value["requests"][0][key] = bad
            with self.subTest(key=key), self.assertRaises(ResearchError):
                parse_capture(reseal(value))

    def test_https_label_requires_observations_and_producer_identity_is_bounded(self):
        value = decode(self.raw)
        value["mode"] = "PUBLIC_HTTPS_GET_LOCAL_RECEIPT_NOT_EXTERNAL_ATTESTATION"
        with self.assertRaisesRegex(ResearchError, "CLASSIFICATION"):
            parse_capture(reseal(value))
        for head in [True, "VERIFIED", "F" * 40]:
            with self.subTest(head=head), self.assertRaisesRegex(ResearchError, "SOURCE_HEAD"):
                synthetic_capture(source_head=head)

    def test_bad_base64_and_nonfinite_provider_json_fail(self):
        value = decode(self.raw)
        value["ohlc_base64"] = "invalid***"
        with self.assertRaisesRegex(ResearchError, "BASE64"):
            parse_capture(reseal(value))
        with self.assertRaises(ResearchError):
            parse_pair(b'{"error":[],"result":{"SOL/USD":NaN}}')

    def test_public_transport_uses_fixed_get_validated_tls_and_no_order_headers(self):
        response = FakeResponse(b'{"error":[],"result":{}}')
        opener = Mock()
        opener.open.return_value = response
        with patch("zoora_sfp.provider.urllib.request.build_opener", return_value=opener):
            raw, receipt = request_public("PAIR")
        request = opener.open.call_args.args[0]
        self.assertEqual(request.get_method(), "GET")
        self.assertEqual(request.full_url, "https://" + HOST + TARGETS["PAIR"])
        self.assertFalse(request.has_header("Authorization"))
        self.assertEqual(receipt["body_bytes"], len(raw))
        self.assertTrue(response.closed)

    def test_public_transport_rejects_redirect_content_encoding_and_body_limits(self):
        cases = [FakeResponse(b"{}", url="https://evil.invalid/data"),
                 FakeResponse(b"{}", {"Content-Type": "text/html"}),
                 FakeResponse(b"{}", {"Content-Encoding": "gzip"}),
                 FakeResponse(b"{}", {"Content-Length": "99999999"}),
                 FakeResponse(b"{}", {"Content-Length": "3"}),
                 FakeResponse(b"x" * (256 * 1024 + 1))]
        for response in cases:
            opener = Mock()
            opener.open.return_value = response
            with (self.subTest(headers=response.headers),
                  patch("zoora_sfp.provider.urllib.request.build_opener", return_value=opener),
                  self.assertRaises(ResearchError)):
                request_public("PAIR")
            self.assertTrue(response.closed)

    def test_redirect_handler_and_endpoint_allowlist_cannot_follow_other_urls(self):
        self.assertIsNone(NoRedirect().redirect_request(None, None, 302, None, None, "https://evil.invalid"))
        with self.assertRaisesRegex(ResearchError, "ENDPOINT_NOT_ALLOWED"):
            request_public("https://evil.invalid")

    def test_http_errors_timeouts_and_deadlines_are_bounded_codes(self):
        for exc in [urllib.error.HTTPError("safe", 429, "rate limit", {}, None), TimeoutError("private detail")]:
            with (patch("zoora_sfp.provider.urllib.request.build_opener") as opener,
                  self.assertRaisesRegex(ResearchError, "PUBLIC_")):
                opener.return_value.open.side_effect = exc
                request_public("PAIR")
        with (patch("zoora_sfp.provider.urllib.request.build_opener") as opener,
              patch("zoora_sfp.provider.time.monotonic", side_effect=[0, 20]),
              self.assertRaisesRegex(ResearchError, "DEADLINE")):
            opener.return_value.open.return_value = FakeResponse(b"{}")
            request_public("PAIR")

    def test_mocked_https_capture_uses_exactly_two_fixed_requests(self):
        parsed = parse_capture(self.raw)
        receipts = deepcopy(parsed["capture"]["requests"])
        with patch("zoora_sfp.provider.request_public", side_effect=[
                (parsed["pair_raw"], receipts[0]), (parsed["ohlc_raw"], receipts[1])]) as get:
            observed = parse_capture(capture_public())
        self.assertEqual([x.args[0] for x in get.call_args_list], ["PAIR", "OHLC"])
        self.assertEqual(observed["quality"]["classification"], "SOURCE_ASSERTED_OBSERVATIONS")
        self.assertIn("NOT_EXTERNAL_ATTESTATION", observed["quality"]["transport"])

    def test_malformed_market_stops_before_price_request(self):
        with (patch("zoora_sfp.provider.request_public", return_value=(b"{}", {})) as get,
              self.assertRaises(ResearchError)):
            capture_public()
        self.assertEqual(get.call_count, 1)

    def test_source_bundle_verifies_raw_and_derived_mapping(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary) / "source"
            save_source(folder, self.raw)
            parsed = verify_source(folder)
            self.assertEqual(parsed["raw"], self.raw)
            self.assertEqual(len(list(folder.iterdir())), 9)
            with self.assertRaisesRegex(ResearchError, "ALREADY_EXISTS"):
                save_source(folder, self.raw)

    def test_source_manifest_tamper_and_nonobjects_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary) / "source"
            publish(folder, render_source(self.raw))
            with (folder / "history.csv").open("ab") as stream:
                stream.write(b"edited")
            with self.assertRaisesRegex(ResearchError, "EVIDENCE_HASH"):
                verify_source(folder)
            (folder / "manifest.json").write_bytes(b"null")
            with self.assertRaisesRegex(ResearchError, "INVALID_MANIFEST"):
                verify_source(folder)

    def test_rehashed_derived_quality_forgery_fails_reconstruction(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary) / "source"
            publish(folder, render_source(self.raw))
            quality = json.loads((folder / "quality.json").read_bytes())
            quality["source_verification"] = "VERIFIED"
            raw = canonical(quality)
            (folder / "quality.json").write_bytes(raw)
            manifest = decode((folder / "manifest.json").read_bytes())
            from zoora_sfp.provider import sha
            manifest["members"]["quality.json"] = {"sha256": sha(raw), "bytes": len(raw)}
            manifest.pop("manifest_sha256")
            manifest["manifest_sha256"] = digest(manifest)
            (folder / "manifest.json").write_bytes(canonical(manifest))
            with self.assertRaisesRegex(ResearchError, "DERIVED_SOURCE"):
                verify_source(folder)

    def test_source_directory_rejects_unexpected_members(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary) / "source"
            publish(folder, render_source(self.raw))
            (folder / "extra").write_bytes(b"extra")
            with self.assertRaisesRegex(ResearchError, "UNEXPECTED_EVIDENCE"):
                verify_source(folder)

    def test_invalid_modes_classifications_and_market_status_are_bounded_errors(self):
        for key, bad in [("mode", []), ("classification", {})]:
            value = decode(self.raw)
            value[key] = bad
            with self.subTest(key=key), self.assertRaises(ResearchError):
                parse_capture(reseal(value))
        pair, _, _ = fixture()
        pair["result"]["SOL/USD"]["status"] = []
        with self.assertRaises(ResearchError):
            parse_pair(canonical(pair))

    def test_invalid_head_rejects_before_network_request(self):
        with (patch("zoora_sfp.provider.request_public") as get,
              self.assertRaisesRegex(ResearchError, "SOURCE_HEAD")):
            capture_public(source_head="wrong")
        get.assert_not_called()

    def test_existing_output_rejects_before_network_request(self):
        import contextlib

        from zoora_sfp.__main__ import main
        with tempfile.TemporaryDirectory() as temporary, patch("zoora_sfp.__main__.capture_public") as get:
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(main(["capture-kraken", "--out", temporary]), 2)
            get.assert_not_called()


class ProviderNotebookTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.path = self.root / "research.sqlite3"
        self.initial = synthetic_capture(end=261)
        self.source = parse_capture(self.initial)
        self.plan = fast_plan(self.source["dataset"])
        open_notebook(self.path, self.initial, self.plan, source_capture=True)

    def test_open_preserves_both_original_provider_responses(self):
        state = load_notebook(self.path)
        self.assertEqual(state["events"][0]["kind"], "OPEN_SOURCE")
        self.assertEqual(state["artifacts"][0], self.initial)
        self.assertEqual(notebook_status(state)["provider_response_events"], 1)

    def test_provider_append_retains_receipt_and_all_earlier_results(self):
        evaluate_notebook(self.path)
        old = load_notebook(self.path)["evaluations"][0]["report"]
        capture_source(self.path, synthetic_capture(start=259, end=380))
        evaluate_notebook(self.path)
        state = load_notebook(self.path, rerun=True)
        self.assertEqual(state["events"][2]["kind"], "CAPTURE_SOURCE")
        self.assertEqual(state["evaluations"][0]["report"], old)
        self.assertEqual(notebook_status(state)["provider_response_events"], 2)
        self.assertEqual(state["captures"][0]["uncommitted_final_rows_excluded"], 1)
        self.assertEqual(state["captures"][0]["total_bars"], 379)
        folder = self.root / "export"
        publish(folder, render_notebook(state))
        self.assertEqual(verify_notebook_export(folder, rerun=True)["evaluations_verified"], 2)

    def test_source_classification_and_delay_must_match_notebook(self):
        raw = synthetic_capture(start=259, end=380, delay_ms=1)
        with self.assertRaisesRegex(ResearchError, "CONTRACT_MISMATCH"):
            capture_source(self.path, raw)

    def test_provider_overlap_revision_does_not_append_event(self):
        pair, ohlc, stamp = fixture(start=259, end=380)
        row = ohlc["result"]["SOL/USD"][0]
        row[1:6] = ["200", "201", "199", "200", "200"]
        raw = make_capture(canonical(pair), canonical(ohlc), captured_ms=stamp, classification="SYNTHETIC")
        with self.assertRaisesRegex(ResearchError, "HISTORICAL_REVISION"):
            capture_source(self.path, raw)
        self.assertEqual(len(load_notebook(self.path)["events"]), 1)

    def test_repeated_provider_capture_is_not_an_event(self):
        raw = synthetic_capture(start=259, end=380)
        result = capture_source(self.path, raw)
        with self.assertRaisesRegex(ResearchError, "DUPLICATE_CAPTURE"):
            capture_source(self.path, raw)
        self.assertEqual(load_notebook(self.path)["head_sha256"], result["head_sha256"])

    def test_notebook_cannot_record_a_future_provider_receipt(self):
        value = decode(self.initial)
        value["requests"][1]["received_ms"] += 2
        raw = reseal(value)
        source = parse_capture(raw)
        with (patch("zoora_sfp.notebook._clock", return_value=source["dataset"].captured_ms + 1),
              self.assertRaisesRegex(ResearchError, "RECEIPT_AFTER_NOTEBOOK")):
            open_notebook(self.root / "bad.sqlite3", raw, fast_plan(source["dataset"]), source_capture=True)


if __name__ == "__main__":
    unittest.main()
