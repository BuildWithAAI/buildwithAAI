import unittest

from src.solana_research.model import RawEnvelope, sha256_json
from src.solana_research.normalize import UnsupportedTransactionVersion, normalize_block
from src.solana_research.replay import ReplayMode, replay
from src.solana_research.fixture import detect_gaps, jsonl, parse_jsonl, records_hash


def envelope(version=0, received_at="2026-10-05T12:00:00Z", error=None):
    payload = {"jsonrpc":"2.0","id":1,"result":{
        "blockHeight":99,"blockTime":1791200000,"blockhash":"blockhash",
        "previousBlockhash":"previous","parentSlot":41,"rewards":None,
        "transactions":[{"version":version,"meta":{
            "err":error,"fee":5000,"computeUnitsConsumed":123,
            "preBalances":[10],"postBalances":[5],"preTokenBalances":None,
            "postTokenBalances":None,"loadedAddresses":None,
            "innerInstructions":None,"logMessages":None},
            "transaction":{"signatures":["sig"],
                           "message":{"accountKeys":["a"],"instructions":[]}}}]}}
    return RawEnvelope.from_rpc(source_id="fixture", method="getBlock", params=[42],
        requested_commitment="finalized", payload=payload,
        parser_target_version=1, ingestion_build="test", received_at=received_at)


class HarnessTests(unittest.TestCase):
    def test_canonical_hash_is_order_independent(self):
        self.assertEqual(sha256_json({"b":2,"a":1}), sha256_json({"a":1,"b":2}))

    def test_normalization_is_deterministic(self):
        env=envelope()
        self.assertEqual(normalize_block(env,slot=42,commitment="finalized"),
                         normalize_block(env,slot=42,commitment="finalized"))

    def test_failed_transaction_is_preserved(self):
        block=normalize_block(envelope(error={"InstructionError":[0,"x"]}),
                              slot=42,commitment="finalized")
        self.assertFalse(block["transactions"][0]["success"])
        self.assertIsNotNone(block["transactions"][0]["error"])

    def test_null_fields_are_not_zero_filled(self):
        block=normalize_block(envelope(),slot=42,commitment="finalized")
        self.assertIsNone(block["transactions"][0]["pre_token_balances"])

    def test_unsupported_version_fails_closed(self):
        with self.assertRaises(UnsupportedTransactionVersion):
            normalize_block(envelope(version=2),slot=42,commitment="finalized",
                            max_supported_transaction_version=1)

    def test_available_time_cutoff(self):
        early=normalize_block(envelope(received_at="2026-10-05T12:00:00Z"),
                              slot=42,commitment="processed")
        late=normalize_block(envelope(received_at="2026-10-05T12:01:00Z"),
                             slot=43,commitment="finalized")
        result=replay([late,early],mode=ReplayMode.AVAILABLE_TIME,
                      cutoff_time="2026-10-05T12:00:30Z")
        self.assertEqual([r["slot"] for r in result],[42])

    def test_commitment_filter(self):
        processed=normalize_block(envelope(),slot=42,commitment="processed")
        finalized=normalize_block(envelope(received_at="2026-10-05T12:02:00Z"),
                                  slot=42,commitment="finalized")
        result=replay([processed,finalized],mode=ReplayMode.COMMITMENT_FILTERED,
                      minimum_commitment="finalized")
        self.assertEqual(len(result),1)
        self.assertEqual(result[0]["commitment"],"FINALIZED")

    def test_cluster_is_recorded_explicitly(self):
        block=normalize_block(envelope(),slot=42,commitment="finalized",cluster="devnet")
        self.assertEqual(block["cluster"],"devnet")

    def test_gap_detection_distinguishes_available_slots(self):
        self.assertEqual(detect_gaps(range(40,44),[40,42,43]),[41])

    def test_jsonl_round_trip_and_hash_are_deterministic(self):
        records=[{"slot":42,"b":2,"a":1},{"slot":43}]
        payload=jsonl(records)
        self.assertEqual(parse_jsonl(payload),records)
        self.assertEqual(records_hash(records),records_hash(parse_jsonl(payload)))

    def test_canonical_replay_is_deterministic(self):
        a=normalize_block(envelope(received_at="2026-10-05T12:01:00Z"),
                          slot=43,commitment="finalized")
        b=normalize_block(envelope(received_at="2026-10-05T12:00:00Z"),
                          slot=42,commitment="finalized")
        self.assertEqual(replay([a,b],mode=ReplayMode.CANONICAL_ORDER),
                         replay([b,a],mode=ReplayMode.CANONICAL_ORDER))


class CollectorTests(unittest.TestCase):
    def test_bounded_collector_tracks_skips_and_manifest(self):
        from src.solana_research.collector import collect_bounded_fixture
        result=collect_bounded_fixture(
            start_slot=42,end_slot=44,cluster="mainnet-beta",source_id="fixture",
            commitment="finalized",max_supported_transaction_version=1,
            ingestion_build="test",normalizer_version="test",
            available_blocks=lambda start,end:[42,44],
            acquire_block=lambda slot: envelope(received_at=f"2026-10-05T12:00:{slot-42:02d}Z"))
        self.assertEqual(result.skipped_slots,[43])
        self.assertEqual(result.manifest.raw_record_count,2)
        self.assertEqual(result.manifest.normalized_block_count,2)
        self.assertEqual(result.manifest.failure_count,0)
        self.assertEqual(len(result.manifest.records_hash),64)

    def test_collector_refuses_unbounded_window(self):
        from src.solana_research.collector import collect_bounded_fixture
        with self.assertRaises(ValueError):
            collect_bounded_fixture(
                start_slot=1,end_slot=100,cluster="mainnet-beta",source_id="fixture",
                commitment="finalized",max_supported_transaction_version=1,
                ingestion_build="test",normalizer_version="test",
                available_blocks=lambda start,end:[],acquire_block=lambda slot: envelope())

    def test_collector_records_acquisition_failure(self):
        from src.solana_research.collector import collect_bounded_fixture
        def fail(slot):
            raise TimeoutError("fixture timeout")
        result=collect_bounded_fixture(
            start_slot=42,end_slot=42,cluster="mainnet-beta",source_id="fixture",
            commitment="finalized",max_supported_transaction_version=1,
            ingestion_build="test",normalizer_version="test",
            available_blocks=lambda start,end:[42],acquire_block=fail)
        self.assertEqual(result.manifest.failure_count,1)
        self.assertEqual(result.failures[0]["error_type"],"TimeoutError")


if __name__ == "__main__":
    unittest.main()
