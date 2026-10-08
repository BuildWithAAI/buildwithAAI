"""Offline regression checks for P0 audit defects; no live acquisition."""
import copy
import unittest
from unittest.mock import patch
from test_solana_research import envelope
from src.solana_research.collector import collect_bounded_fixture
from src.solana_research.model import RawEnvelope
from src.solana_research.normalize import NormalizationError, UnsupportedTransactionVersion, normalize_block
from src.solana_research.replay import replay
from src.solana_research.rpc import rpc_call, get_blocks, MAX_RESPONSE_BYTES


def changed_payload(transform):
    payload = copy.deepcopy(envelope().payload)
    transform(payload)
    return RawEnvelope.from_rpc(source_id='fixture',method='getBlock',params=[42],
                               requested_commitment='finalized',payload=payload,
                               parser_target_version=1,ingestion_build='test')


class AuditRegressions(unittest.TestCase):
    def test_missing_meta_is_not_success(self):
        env = changed_payload(lambda p: p['result']['transactions'][0].update(meta=None))
        tx = normalize_block(env,slot=42,commitment='finalized')['transactions'][0]
        self.assertIsNone(tx['success'])
        self.assertIn('TRANSACTION_RESULT_UNAVAILABLE',tx['quality_flags'])

    def test_missing_err_is_not_success(self):
        env = changed_payload(lambda p: p['result']['transactions'][0]['meta'].pop('err'))
        self.assertIsNone(normalize_block(env,slot=42,commitment='finalized')['transactions'][0]['success'])

    def test_invalid_versions_fail_closed(self):
        for version in (None,True,-1,'future',1.2):
            with self.subTest(version=version),self.assertRaises(UnsupportedTransactionVersion):
                normalize_block(envelope(version=version),slot=42,commitment='finalized')

    def test_legacy_version_remains_supported(self):
        self.assertEqual(normalize_block(envelope(version='legacy'),slot=42,commitment='finalized')['transaction_count'],1)

    def test_raw_input_is_copied_and_mutation_detected(self):
        payload = copy.deepcopy(envelope().payload)
        env=RawEnvelope.from_rpc(source_id='fixture',method='getBlock',params=[42],
                                 requested_commitment='finalized',payload=payload,
                                 parser_target_version=1,ingestion_build='test')
        payload['result']['blockHeight']=0
        self.assertEqual(env.payload['result']['blockHeight'],99)
        env.payload['result']['blockHeight']=1
        with self.assertRaises(NormalizationError):normalize_block(env,slot=42,commitment='finalized')
        with self.assertRaises(ValueError):env.to_dict()

    def test_timezone_cutoff_compares_instants(self):
        records=[{'slot':42,'available_time':'2026-10-05T13:00:00+01:00','commitment':'FINALIZED'}]
        self.assertEqual(len(replay(records,mode='AVAILABLE_TIME',cutoff_time='2026-10-05T12:00:00Z')),1)
        self.assertEqual(replay(records,mode='AVAILABLE_TIME',cutoff_time='2026-10-05T11:59:59Z'),[])

    def test_string_mode_filters_commitment(self):
        records=[{'slot':42,'available_time':'2026-10-05T12:00:00Z','commitment':'PROCESSED'}]
        self.assertEqual(replay(records,mode='COMMITMENT_FILTERED',minimum_commitment='finalized'),[])

    def test_unknown_mode_and_naive_timestamp_rejected(self):
        with self.assertRaises(ValueError):replay([],mode='UNKNOWN')
        with self.assertRaises(ValueError):replay([],mode='AVAILABLE_TIME',cutoff_time='2026-10-05T12:00:00')

    def test_huge_window_rejected_before_network_or_allocation(self):
        with self.assertRaises(ValueError):
            collect_bounded_fixture(start_slot=0,end_slot=10**100,cluster='mainnet-beta',source_id='fixture',
                commitment='finalized',max_supported_transaction_version=1,ingestion_build='test',
                normalizer_version='test',available_blocks=lambda *_: self.fail('network reached'),acquire_block=lambda _:envelope())

    def test_rpc_rejects_execution_and_unsafe_endpoint(self):
        with patch('src.solana_research.rpc.build_opener') as opener:
            for endpoint,method in [('https://rpc.test','sendTransaction'),('http://rpc.test','getBlock'),
                                    ('https://user:secret@rpc.test','getBlock')]:
                with self.assertRaises(ValueError):rpc_call(endpoint,method,[])
            opener.assert_not_called()

    def test_rpc_response_is_bounded(self):
        with patch('src.solana_research.rpc.build_opener') as opener:
            response=opener.return_value.open.return_value.__enter__.return_value
            response.read.return_value=b'x'*(MAX_RESPONSE_BYTES+1)
            with self.assertRaises(RuntimeError):rpc_call('https://rpc.test','getBlock',[42])
            response.read.assert_called_once_with(MAX_RESPONSE_BYTES+1)

    def test_get_blocks_rejects_missing_result_and_wide_window(self):
        with patch('src.solana_research.rpc.rpc_call',return_value={'jsonrpc':'2.0','id':1}):
            with self.assertRaises(RuntimeError):get_blocks('https://rpc.test',42,43)
        with self.assertRaises(ValueError):get_blocks('https://rpc.test',0,10**100)
