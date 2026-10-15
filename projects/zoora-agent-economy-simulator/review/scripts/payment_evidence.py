"""Exercise actual AE-013 CLI modes, independent audits, checkpoint recovery and exports."""
from __future__ import annotations
import copy,csv,hashlib,io,json,os,platform,subprocess,sys,tempfile,time
from pathlib import Path
from payment_audit import inspect_run,inspect_campaign,run_hash,campaign_hash
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'target/validation-evidence';OUT.mkdir(parents=True,exist_ok=True)
NAME='zoora-review-market'+('.exe' if os.name=='nt' else '')
BINARY=ROOT/'target/release'/NAME
HEAD=os.environ.get('SOURCE_HEAD_SHA') or subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
EXPECTED='a233a0aba0aa77f0a7e9a4533f4271248963e329e99adff89338c64297b29fa3'
TESTS=[]
def check(name,truth=True):
 assert truth,name
 TESTS.append(name)
def cli(*args,ok=True,profile='release'):
 p=subprocess.run([str(ROOT/'target'/profile/NAME),*map(str,args)],cwd=ROOT,text=True,capture_output=True,timeout=240)
 assert (p.returncode==0)==ok,(args,p.stdout[-1000:],p.stderr)
 return p
def coordinator(config,folder,*flags,ok=True):
 p=subprocess.run([sys.executable,str(ROOT/'scripts/run_economy_campaign.py'),'--model','payment','--config',str(config),'--output-dir',str(folder),*flags],cwd=ROOT,text=True,capture_output=True,timeout=360)
 assert (p.returncode==0)==ok,(p.stdout[-1000:],p.stderr)
 return p
start=time.perf_counter()
with tempfile.TemporaryDirectory() as tmp:
 tmp=Path(tmp);text=(ROOT/'configs/payment-campaign.toml').read_text()
 smoke=tmp/'smoke.toml';smoke.write_text(text.replace('[7, 11, 19, 31, 42, 59, 73, 89, 101, 127]','[42]'))
 folder=tmp/'checkpoint';coordinator(smoke,folder,'--max-new-runs','3')
 d=json.loads((folder/'progress.json').read_text());check('paused payment campaign remains INCOMPLETE',d['state']=='INCOMPLETE' and d['completed_runs']==3 and d['expected_runs']==24)
 originals={p.name:p.read_bytes() for p in (folder/'runs').glob('*.json')}
 coordinator(smoke,folder,'--resume');d=json.loads((folder/'progress.json').read_text())
 check('resumed three-policy matrix completes all 24 runs',d['state']=='COMPLETE' and d['completed_runs']==24)
 check('resuming preserves cached run bytes',all((folder/'runs'/n).read_bytes()==raw for n,raw in originals.items()))
 audits=[]
 for p in sorted((folder/'runs').glob('*.json')):audits.append(inspect_run(json.loads(p.read_text())))
 check('24 full journals independently reconcile balances, receipts, work causality and FIFO capacity')
 optimized=subprocess.run([sys.executable,'-O',str(ROOT/'scripts/payment_audit.py'),str(next((folder/'runs').glob('*.json')))],cwd=ROOT,text=True,capture_output=True)
 check('optimized Python cannot silently bypass independent audit assertions',optimized.returncode!=0 and 'without -O' in optimized.stderr)
 coordinator(smoke,folder,ok=False);check('existing output cannot be silently overwritten')
 changed=tmp/'changed.toml';changed.write_text(smoke.read_text().replace('evidence_grace = 6','evidence_grace = 5'))
 coordinator(changed,folder,'--resume',ok=False);check('resume refuses a changed grace parameter')
 fake=tmp/NAME;fake.write_bytes(BINARY.read_bytes()+b'changed')
 coordinator(smoke,folder,'--resume','--binary',str(fake),ok=False);check('resume refuses a changed executable before running it')
 victim=next((folder/'runs').glob('*.json'));raw=victim.read_bytes();victim.write_text('{broken')
 coordinator(smoke,folder,'--resume',ok=False);check('corrupt cached journal prevents completion',json.loads((folder/'progress.json').read_text())['state']=='INCOMPLETE');victim.write_bytes(raw)
 campaign=OUT/'payment-campaign.json';cli('payment-campaign',ROOT/'configs/payment-campaign.toml',campaign);cli('replay-payment-campaign',campaign)
 data=json.loads(campaign.read_text());inspect_campaign(data)
 check('published 240-run matrix matches pinned campaign fingerprint',len(data['runs'])==240 and data['fingerprint']==EXPECTED)
 check('all scenarios and policies share an intention fingerprint for each seed')
 cli('payment-csv',campaign,OUT/'payment-campaign.csv');rows=list(csv.DictReader(io.StringIO((OUT/'payment-campaign.csv').read_text())))
 check('CSV preserves all 240 runs and their campaign provenance',len(rows)==240 and all(r['campaign_fingerprint']==EXPECTED and r['classification']=='SYNTHETIC' for r in rows))
 cli('payment-viewer',campaign,OUT/'payment-campaign.html');html=(OUT/'payment-campaign.html').read_text()
 check('viewer is self-contained with denied connections and safe JSON boundary',"connect-src 'none'" in html and html.count('</script>')==2)
 for policy in ['RESERVE_ON_QUOTE','STRICT_OBSERVATION','EVIDENCE_GRACE']:
  raw=[]
  for profile in ['debug','release']:
   path=tmp/(profile+policy+'.json');cli('payment-run',smoke,42,'OBSERVATION_LAG',policy,path,profile=profile);cli('replay-payment',path,profile=profile);raw.append(path.read_bytes())
  check(policy+' debug/release full journals are byte-identical',raw[0]==raw[1]);run=json.loads(raw[0]);inspect_run(run)
  row=next(r for r in data['runs'] if r['seed']==42 and r['scenario']=='OBSERVATION_LAG' and r['policy']==policy)
  check(policy+' full transcript matches large-campaign metrics and rounds',row['metrics']==run['metrics'] and row['rounds']==run['rounds'])
  bad=copy.deepcopy(run);bad['transfers'][0]['receipt']['amount']+=1;bad['fingerprint']=run_hash(bad)
  path=tmp/(policy+'forged.json');path.write_text(json.dumps(bad));cli('replay-payment',path,ok=False);check(policy+' rehashed false transfer rejected')
 bad=copy.deepcopy(data);bad['runs'].pop();bad['fingerprint']=campaign_hash(bad);path=tmp/'incomplete.json';path.write_text(json.dumps(bad))
 cli('replay-payment-campaign',path,ok=False)
 for command,suffix in [('payment-viewer','html'),('payment-csv','csv')]:
  output=tmp/('forbidden.'+suffix);cli(command,path,output,ok=False);assert not output.exists()
 check('incomplete rehashed matrix cannot replay or export')
 bad=copy.deepcopy(data);bad['runs'][0]['metrics']['amounts']['observed_unapplied_payment_units']='999';bad['fingerprint']=campaign_hash(bad);path=tmp/'false-amounts.json';path.write_text(json.dumps(bad));cli('replay-payment-campaign',path,ok=False);check('rehashed false unapplied exposure rejected')
 invalid=tmp/'invalid.toml';invalid.write_text(text.replace('provider_capacity = 4','provider_capacity = 17'));output=tmp/'invalid.json';cli('payment-campaign',invalid,output,ok=False);check('dimension bound refusal creates no output',not output.exists())
 cli('payment-campaign',smoke,campaign,ok=False);check('existing campaign output is refused')
 # The policy results must retain negative outcomes as well as gains.
 total=lambda scenario,policy,key:sum(r['metrics']['counts'][key] for r in data['runs'] if r['scenario']==scenario and r['policy']==policy)
 check('unpaid identities never start funded attack work',total('UNPAID_SYBIL_FLOOD','EVIDENCE_GRACE','started_attacks')==0)
 check('bounded grace improves acknowledged work under observation lag',total('OBSERVATION_LAG','EVIDENCE_GRACE','acknowledged_work')>total('OBSERVATION_LAG','STRICT_OBSERVATION','acknowledged_work'))
 check('paid spam remains a measured admission failure',total('PAID_SYBIL_FLOOD','EVIDENCE_GRACE','paid_work_not_started')>0 and total('PAID_SYBIL_FLOOD','EVIDENCE_GRACE','started_attacks')>0)
 check('grace does not authorize actually late payments',all(r['counts']['started_work']==0 for row in data['runs'] if row['scenario']=='LATE_PAYMENT' and row['policy']=='EVIDENCE_GRACE' for r in row['rounds'] if r['phase']=='STRESS'))
summary={'source_head_sha':HEAD,'source_tree_dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT)),
 'classification':'SYNTHETIC','unit':'SIMULATED_UNITS','platform':platform.platform(),'campaign_runs':240,'campaign_fingerprint':EXPECTED,
 'independently_audited_full_runs':24,'tests':TESTS,'elapsed_seconds':round(time.perf_counter()-start,3),'timing_scope':'SINGLE_ACCEPTANCE_SAMPLE_NOT_LIVE_THROUGHPUT','network_or_signer':False}
(OUT/'payment-evidence.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
