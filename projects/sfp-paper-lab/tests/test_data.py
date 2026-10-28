import unittest

from helpers import csv_bytes, dataset, delayed, gap, prefix, unaligned, value

from zoora_sfp.data import (
    HOUR,
    Config,
    D,
    ResearchError,
    canonical,
    decode,
    parse_dataset,
)
from zoora_sfp.importer import import_csv


class DataTests(unittest.TestCase):
    def test_exact_decimals_and_fixture_classification(self):
        ds = dataset()
        self.assertEqual(ds.bars[240].h, D("103.4"))
        self.assertEqual(ds.classification, "SYNTHETIC")
        self.assertEqual(len(ds.bars), 380)

    def test_duplicate_json_fields_are_rejected(self):
        with self.assertRaisesRegex(ResearchError, "DUPLICATE"):
            decode(b'{"x":1,"x":2}')

    def test_nonfinite_and_unparseable_json_are_rejected(self):
        for raw in [b'{"x":NaN}', b"{", b"\xff"]:
            with self.subTest(raw=raw), self.assertRaises(ResearchError):
                decode(raw)

    def test_unknown_fields_including_secret_fields_are_rejected(self):
        v = value()
        v["private_key"] = "SYNTHETIC_REJECTED_INPUT"
        with self.assertRaisesRegex(ResearchError, "INVALID_FIELDS"):
            dataset(v)

    def test_float_and_nonfinite_prices_are_rejected(self):
        for price in [1.1, "NaN", "Infinity", "1e2", True]:
            v = value()
            v["bars"][10]["open"] = price
            with self.subTest(price=price), self.assertRaises(ResearchError):
                dataset(v)

    def test_boolean_timestamp_is_rejected(self):
        v = value()
        v["bars"][0]["open_ms"] = True
        with self.assertRaises(ResearchError):
            dataset(v)

    def test_ohlc_invariant(self):
        v = value()
        v["bars"][0]["low"] = "200"
        with self.assertRaisesRegex(ResearchError, "OHLC"):
            dataset(v)

    def test_unfinished_and_early_availability(self):
        for field in ["captured_ms", "available_ms"]:
            v = value()
            if field == "captured_ms":
                v[field] -= 1
            else:
                v["bars"][0][field] = v["bars"][0]["open_ms"]
            with self.subTest(field=field), self.assertRaises(ResearchError):
                dataset(v)

    def test_overlap_and_nonmonotonic_receipt_fail_visibly(self):
        v = value()
        v["bars"][1] = dict(v["bars"][0])
        with self.assertRaisesRegex(ResearchError, "OVERLAPPING"):
            dataset(v)
        v = value()
        v["bars"][1]["available_ms"] = v["bars"][4]["available_ms"]
        with self.assertRaisesRegex(ResearchError, "AVAILABILITY_ORDER"):
            dataset(v)

    def test_gaps_are_not_zero_filled(self):
        ds = dataset(gap(value(), 100))
        self.assertEqual(len(ds.bars), 379)
        self.assertEqual(ds.gaps[0]["missing_hours"], 1)

    def test_interval_is_one_hour(self):
        with self.assertRaisesRegex(ResearchError, "INTERVAL"):
            dataset(unaligned(value()))

    def test_synthetic_label_cannot_be_presented_as_user_history(self):
        v = value()
        v["purpose"] = "USER_SUPPLIED_HISTORY_NOT_INDEPENDENTLY_VERIFIED"
        with self.assertRaises(ResearchError):
            dataset(v)

    def test_config_rejects_float_money_bad_rates_and_bool(self):
        for kwargs in [{"initial_cash": 100.0}, {"risk_bps": True}, {"fee_bps": -1},
                       {"risk_bps": 51, "daily_loss_bps": 50},
                       {"buy_burn_scenario_bps": 10_001}, {"fixed_cost": D("NaN")}]:
            with self.subTest(kwargs=kwargs), self.assertRaises(ResearchError):
                Config(**kwargs)

    def test_csv_import_preserves_prices_and_labels_reconstructed_time(self):
        v = prefix(40)
        raw, status = import_csv(csv_bytes(v), base="SOL", quote="USDC", venue="KRAKEN",
                                 source_id="USER-supplied", captured_ms=v["captured_ms"])
        ds = parse_dataset(raw)
        self.assertEqual(ds.bars[20].c, D(v["bars"][20]["close"]))
        self.assertEqual(ds.availability, "SYNTHETIC_RECONSTRUCTION")
        self.assertEqual(ds.classification, "SOURCE_ASSERTED_OBSERVATIONS")
        self.assertEqual(status["source_verification"], "UNAVAILABLE")

    def test_csv_unfinished_bar_excluded_and_header_supported(self):
        v = prefix(5)
        raw = b"timestamp,open,high,low,close,volume,trades\n" + csv_bytes(v)
        body, status = import_csv(raw, base="SOL", quote="USDC", venue="KRAKEN",
                                 source_id="USER", captured_ms=v["captured_ms"] - 1)
        self.assertEqual(status["unfinished_or_not_yet_available"], 1)
        self.assertEqual(len(parse_dataset(body).bars), 4)

    def test_csv_gaps_duplicate_rows_and_malformed_quotes(self):
        v = gap(prefix(6), 3)
        _, status = import_csv(csv_bytes(v), base="SOL", quote="USDC", venue="KRAKEN",
                              source_id="USER", captured_ms=v["captured_ms"])
        self.assertEqual(status["coverage_gaps"], 1)
        for raw in [csv_bytes(prefix(2)) * 2, b'"unterminated\n', b"x,1,2,0,1,2,1\n"]:
            with self.subTest(raw=raw), self.assertRaises(ResearchError):
                import_csv(raw, base="SOL", quote="USDC", venue="KRAKEN", source_id="USER",
                           captured_ms=v["captured_ms"])

    def test_csv_delay_changes_only_declared_availability(self):
        v = prefix(5)
        body, _ = import_csv(csv_bytes(v), base="SOL", quote="USDC", venue="KRAKEN",
                             source_id="USER", captured_ms=v["captured_ms"] + HOUR, delay_ms=100)
        self.assertEqual(parse_dataset(body).bars[0].available_ms,
                         v["bars"][0]["close_ms"] + 100)

    def test_stale_dataset_is_retained_as_declared_input(self):
        ds = dataset(delayed(value(), 2 * HOUR))
        self.assertEqual(ds.bars[0].available_ms - ds.bars[0].close_ms, 2 * HOUR)
        self.assertEqual(ds.dataset_sha256, parse_dataset(canonical(delayed(value(), 2 * HOUR))).dataset_sha256)


if __name__ == "__main__":
    unittest.main()
