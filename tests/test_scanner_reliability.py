"""Offline recovery evidence: no actual provider calls or market values."""
import io
import json
import unittest
import urllib.error
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from unittest.mock import patch
from src.aai_scanner.config import Config
from src.aai_scanner.market import WRAPPED_SOL
from src.aai_scanner.service import Scanner
from src.aai_scanner.storage import Store
from src.aai_scanner.telegram import Commands
from src.aai_scanner.transport import (MAINNET_GENESIS, ProviderError, RpcClient, RpcPool,
                                       fetch_json, retry_after_seconds)
from tests.scanner_fixtures import ACCOUNT, MINT, FakeMarket, FakeRPC


class RecoveryTests(unittest.TestCase):
    def network(self, url, payload, **kwargs):
        result = MAINNET_GENESIS if payload['method'] == 'getGenesisHash' else {'context':{'slot':77},'value':0}
        return {'jsonrpc':'2.0','id':1,'result':result}, 'synthetic-digest'

    def test_rate_limit_metadata_is_safe_and_preserves_retry_after(self):
        failure = urllib.error.HTTPError('https://rpc.test/SECRET',429,'SECRET',{'Retry-After':'120'},io.BytesIO(b'SECRET'))
        with patch('urllib.request.build_opener') as opener:
            opener.return_value.open.side_effect = failure
            with self.assertRaises(ProviderError) as caught: fetch_json('https://rpc.test/SECRET')
        self.assertEqual(caught.exception.retry_after,120)
        self.assertTrue(caught.exception.retryable)
        self.assertNotIn('SECRET',str(caught.exception)+json.dumps(caught.exception.details()))

    def test_http_date_retry_after_is_supported(self):
        value = format_datetime(datetime.now(timezone.utc)+timedelta(seconds=60))
        self.assertTrue(58 <= retry_after_seconds(value) <= 61)
        for invalid in (None,'invalid','-5','1.5'):
            self.assertIsNone(retry_after_seconds(invalid))
        self.assertEqual(retry_after_seconds('99999999'),99999999)

    def test_429_is_not_immediately_retried_and_cooldown_is_shared(self):
        client = RpcClient('https://rpc.test')
        error = ProviderError('Provider HTTP 429',code='HTTP_ERROR',http_status=429,retry_after=120)
        with patch('src.aai_scanner.transport.fetch_json',side_effect=error) as request:
            for _ in range(2):
                with self.assertRaises(ProviderError): client.call('getBalance',[ACCOUNT])
            self.assertEqual(request.call_count,1)
        self.assertGreaterEqual(client.diagnostics()['cooldown_seconds'],119)

    def test_retry_after_expiry_allows_recovery(self):
        client = RpcClient('https://rpc.test')
        with patch('src.aai_scanner.transport.time.monotonic',return_value=100),patch('src.aai_scanner.transport.fetch_json',side_effect=ProviderError('limited',http_status=429,retry_after=5)):
            with self.assertRaises(ProviderError): client.call('getBalance',[ACCOUNT])
        with patch('src.aai_scanner.transport.time.monotonic',return_value=106),patch('src.aai_scanner.transport.fetch_json',side_effect=self.network):
            self.assertEqual(client.call('getBalance',[ACCOUNT])['result']['value'],0)

    def test_configured_backup_verifies_network_and_preserves_actual_source(self):
        pool=RpcPool(('https://first.test/private-key','https://second.test/?key=hidden'))
        def call(url,payload,**kwargs):
            if 'first.test' in url:raise ProviderError('limited',http_status=429,retry_after=60)
            return self.network(url,payload,**kwargs)
        with patch('src.aai_scanner.transport.fetch_json',side_effect=call) as request:
            result=pool.call('getBalance',[ACCOUNT])
        self.assertEqual(request.call_count,3)
        proof=result['_evidence']
        self.assertEqual(proof['endpoint_host'],'second.test')
        self.assertEqual(proof['network_evidence']['endpoint_host'],'second.test')
        self.assertEqual(proof['provider_id'],'rpc-2')
        self.assertIn('RPC_FAILOVER_USED',proof['quality_flags'])
        self.assertEqual(proof['recovery_attempts'][0]['http_status'],429)
        self.assertNotIn('private-key',json.dumps(result)+json.dumps(pool.diagnostics()))
        self.assertNotIn('hidden',json.dumps(result)+json.dumps(pool.diagnostics()))

    def test_wrong_network_is_not_hidden_by_fallback(self):
        pool=RpcPool(('https://first.test','https://second.test'))
        with patch('src.aai_scanner.transport.fetch_json',return_value=({'jsonrpc':'2.0','id':1,'result':'DEVNET'},'digest')) as request:
            with self.assertRaises(ProviderError) as error:pool.call('getBalance',[ACCOUNT])
        self.assertEqual(error.exception.code,'NETWORK_MISMATCH')
        self.assertEqual(request.call_count,1)
        self.assertIsNone(pool.network_receipt)

    def test_bad_data_is_not_hidden_by_fallback(self):
        pool=RpcPool(('https://first.test','https://second.test'))
        with patch('src.aai_scanner.transport.fetch_json',return_value=({'jsonrpc':'2.0','id':True,'result':MAINNET_GENESIS},'digest')) as request:
            with self.assertRaises(ProviderError):pool.call('getBalance',[ACCOUNT])
        self.assertEqual(request.call_count,1)

    def test_backup_network_mismatch_prevents_read(self):
        pool=RpcPool(('https://first.test','https://second.test'))
        def call(url,payload,**kwargs):
            if 'first.test' in url:raise ProviderError('timeout',code='CONNECTION_FAILED')
            return {'jsonrpc':'2.0','id':1,'result':'DEVNET'},'digest'
        with patch('src.aai_scanner.transport.fetch_json',side_effect=call) as request:
            with self.assertRaises(ProviderError):pool.call('getBalance',[ACCOUNT])
        self.assertEqual(request.call_count,2)

    def test_all_provider_failures_retain_attempts_and_stay_missing(self):
        pool=RpcPool(('https://first.test','https://second.test'))
        with patch('src.aai_scanner.transport.fetch_json',side_effect=ProviderError('timeout',code='CONNECTION_FAILED')):
            with self.assertRaises(ProviderError) as error:pool.call('getBalance',[ACCOUNT])
        self.assertEqual(len(error.exception.attempts),2)
        self.assertIsNone(pool.network_receipt)

    def test_no_fallback_or_execution_without_explicit_configuration(self):
        pool=RpcPool((Config().rpc_url,))
        self.assertEqual(len(pool.clients),1)
        with patch('src.aai_scanner.transport.fetch_json') as request:
            with self.assertRaises(ValueError):pool.call('sendTransaction',[])
            request.assert_not_called()

    def test_genesis_cache_is_reverified_after_five_minutes(self):
        client=RpcClient('https://rpc.test')
        with patch('src.aai_scanner.transport.time.monotonic',return_value=100),patch('src.aai_scanner.transport.fetch_json',side_effect=self.network):
            client.ensure_mainnet()
        with patch('src.aai_scanner.transport.time.monotonic',return_value=401),patch('src.aai_scanner.transport.fetch_json',return_value=({'jsonrpc':'2.0','id':1,'result':'DEVNET'},'digest')):
            with self.assertRaises(ProviderError):client.call('getBalance',[ACCOUNT])
        self.assertIsNone(client.network_receipt)

    def test_config_requires_bounded_distinct_https_fallbacks(self):
        for urls in (('http://backup.test',),(Config().rpc_url,),('https://a.test',)*2,('https://a.test','https://b.test','https://c.test')):
            with self.subTest(urls=urls),self.assertRaises(ValueError):replace(Config(),rpc_fallback_urls=urls).validate()
        with patch.dict('os.environ',{'AAI_RPC_FALLBACK_URLS':'https://a.test, https://b.test'},clear=True):
            self.assertEqual(Config.from_env().rpc_fallback_urls,('https://a.test','https://b.test'))


class CoverageTests(unittest.TestCase):
    def setUp(self):
        self.store=Store(':memory:')
        self.rpc,self.market=FakeRPC(),FakeMarket()
        self.scanner=Scanner(Config(),self.store,self.rpc,self.market)
        self.addCleanup(self.store.close)

    def test_optional_source_gap_makes_coverage_partial(self):
        self.rpc.fail.add('getTokenLargestAccounts')
        report=self.scanner.scan(MINT)
        self.assertFalse(report['coverage']['complete'])
        self.assertEqual(report['coverage']['missing_sections'],['largest_token_accounts'])
        self.assertIsNone(report['accounting']['realized_pnl_usd'])
        self.assertIn('largest_token_accounts',Commands(self.scanner,'https://scanner.test').answer('/scan '+MINT))

    def test_missing_sol_reference_is_a_coverage_gap(self):
        pools=self.market.pools
        def reference(mint):
            if mint == WRAPPED_SOL:raise ProviderError('Synthetic reference failure')
            return pools(mint)
        with patch.object(self.market,'pools',side_effect=reference): report=self.scanner.scan(MINT)
        self.assertIn('sol_price',report['coverage']['missing_sections'])
        self.assertEqual(report['market']['price_usd']['status'],'AVAILABLE')
        self.assertIsNone(report['market']['price_sol']['value'])

    def test_wrapped_sol_reuses_one_actual_market_snapshot(self):
        report=self.scanner.scan(WRAPPED_SOL)
        self.assertEqual(self.market.calls,[WRAPPED_SOL])
        self.assertEqual(report['market']['price_sol']['value'],'1')
        self.assertNotIn('NON_ATOMIC_PRICE_SNAPSHOTS',report['market']['price_sol']['quality_flags'])

    def test_provider_changes_are_flagged_even_when_slots_match(self):
        self.rpc.account['_evidence']={'provider':'Synthetic RPC','endpoint_host':'rpc.test','provider_id':'rpc-1'}
        original=self.rpc.call
        def call(method,params):
            result=original(method,params)
            result['_evidence']['provider_id']='rpc-1' if method=='getAccountInfo' else 'rpc-2'
            return result
        with patch.object(self.rpc,'call',side_effect=call): report=self.scanner.scan(MINT)
        self.assertIn('NON_ATOMIC_PROVIDERS',report['holders']['quality_flags'])

    def test_provider_failure_details_survive_collection_without_fake_values(self):
        error=ProviderError('Provider HTTP 429',code='HTTP_ERROR',http_status=429,retry_after=60)
        result,gap=self.scanner._collect(lambda: (_ for _ in ()).throw(error),'Solana RPC','https://rpc.test/?key=hidden','getBalance')
        self.assertIsNone(result)
        self.assertEqual(gap['error']['retry_after_seconds'],60)
        self.assertNotIn('hidden',json.dumps(gap))


class OperationalTests(unittest.TestCase):
    def test_finalized_receipt_matches_actual_request_options(self):
        replies=[({'jsonrpc':'2.0','id':1,'result':MAINNET_GENESIS},'genesis'),
                 ({'jsonrpc':'2.0','id':1,'result':{'context':{'slot':12},'value':0}},'balance')]
        with patch('src.aai_scanner.transport.fetch_json',side_effect=replies) as request:
            params=[ACCOUNT]
            result=RpcClient('https://rpc.test').call('getBalance',params)
        self.assertEqual(request.call_args.args[1]['params'][1]['commitment'],'finalized')
        self.assertEqual(params,[ACCOUNT])
        self.assertEqual(result['_evidence']['commitment_basis'],'REQUESTED')

    def test_unfinalized_options_are_rejected_before_network(self):
        with patch('src.aai_scanner.transport.fetch_json') as request:
            with self.assertRaises(ValueError):RpcClient('https://rpc.test').call('getBalance',[ACCOUNT,{'commitment':'processed'}])
            request.assert_not_called()

    def test_identity_wait_is_bounded_by_recovery_deadline(self):
        client=RpcClient('https://rpc.test')
        client._network_lock.acquire()
        try:
            with self.assertRaises(ProviderError) as error:client.ensure_mainnet(deadline=0)
            self.assertEqual(error.exception.code,'DEADLINE_EXCEEDED')
        finally:client._network_lock.release()

    def test_failed_receipt_names_last_attempted_provider(self):
        store=Store(':memory:')
        try:
            scanner=Scanner(Config(),store,FakeRPC(),FakeMarket())
            error=ProviderError('Provider HTTP 403',http_status=403)
            error.attempts=[{'provider_id':'rpc-1','endpoint_host':'first.test'},
                            {'provider_id':'rpc-2','endpoint_host':'second.test'}]
            _,gap=scanner._collect(lambda: (_ for _ in ()).throw(error),'Solana RPC','https://first.test/hidden','getBalance')
            self.assertEqual(gap['endpoint_host'],'second.test')
            self.assertEqual(gap['provider_id'],'rpc-2')
            self.assertIn('MULTIPLE_RPC_PROVIDERS_ATTEMPTED',gap['quality_flags'])
        finally:store.close()

    def test_strict_smoke_exits_failure_when_required_holders_are_missing(self):
        from src.aai_scanner import __main__ as cli
        def scanner(config,store):
            rpc=FakeRPC()
            rpc.fail.add('getTokenLargestAccounts')
            rpc.diagnostics=lambda: []
            return Scanner(config,store,rpc,FakeMarket())
        for optional,expected in (([],0),(['--require-holders'],1),(['--require-activity'],0)):
            output=io.StringIO()
            with patch('sys.argv',['scanner','smoke','--mint',MINT]+optional),patch.object(cli.Config,'from_env',return_value=Config(database=':memory:')),patch.object(cli,'Scanner',side_effect=scanner),patch('sys.stdout',output):
                self.assertEqual(cli.main(),expected)
            evidence=json.loads(output.getvalue())
            self.assertFalse(evidence['coverage']['complete'])
            self.assertEqual(evidence['holder_status'],'FAILED')

    def test_status_exposes_report_coverage_without_running_new_provider_calls(self):
        store=Store(':memory:')
        try:
            from src.aai_scanner.web import Application
            rpc=FakeRPC();rpc.fail.add('getTokenLargestAccounts')
            scanner=Scanner(Config(),store,rpc,FakeMarket())
            scanner.scan(MINT)
            calls=len(rpc.calls)
            app=Application(Config(),store,scanner)
            environ={'PATH_INFO':'/api/status','REQUEST_METHOD':'GET','HTTP_HOST':'127.0.0.1:8787','REMOTE_ADDR':'127.0.0.1'}
            result=json.loads(b''.join(app(environ,lambda *_:None)))
            self.assertEqual(result['scope'],'PROCESS_ONLY')
            self.assertFalse(result['last_report_coverage']['complete'])
            self.assertEqual(calls,len(rpc.calls))
        finally:store.close()


class SnapshotIdentityTests(unittest.TestCase):
    def test_separate_but_equal_receipts_are_still_non_atomic(self):
        from src.aai_scanner.market import summarize_market
        pools,source=FakeMarket().pools(MINT)
        sol,_=FakeMarket().pools(WRAPPED_SOL)
        result=summarize_market(pools,source,sol,dict(source))
        self.assertIn('NON_ATOMIC_PRICE_SNAPSHOTS',result['price_sol']['quality_flags'])
