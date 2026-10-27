"""Actual AE-014 CLI, independent lifecycle audits and checkpoint evidence."""
from __future__ import annotations
import copy,csv,io,json,os,platform,subprocess,sys,tempfile,time
from pathlib import Path
from authorization_audit import inspect_run,inspect_campaign,run_hash,campaign_hash
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'target/validation-evidence';OUT.mkdir(parents=True,exist_ok=True)
NAME='zoora-review-market'+('.exe' if os.name=='nt' else '');BINARY=ROOT/'target/release'/NAME
HEAD=os.environ.get('SOURCE_HEAD_SHA') or subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
EXPECTED='7f5788cfba1fe2d6a7953bdd3094a7798c0e28e1b4e921a4f14a1cd7e06e0465';TESTS=[]
def check(name,truth=True):
 assert truth,name
 TESTS.append(name)
def cli(*args,ok=True,profile='release'):
 p=subprocess.run([str(ROOT/'target'/profile/NAME),*map(str,args)],cwd=ROOT,text=True,capture_output=True,timeout=240)
 assert (p.returncode==0)==ok,(args,p.stdout[-1000:],p.stderr)
 return p
def coordinator(config,folder,*flags,ok=True):
 p=subprocess.run([sys.executable,str(ROOT/'scripts/run_economy_campaign.py'),'--model','authorization','--config',str(config),'--output-dir',str(folder),*map(str,flags)],cwd=ROOT,text=True,capture_output=True,timeout=360)
 assert (p.returncode==0)==ok,(p.stdout[-1000:],p.stderr)
 return p
start=time.perf_counter()
with tempfile.TemporaryDirectory() as tmp:
 tmp=Path(tmp);text=(ROOT/'configs/authorization-campaign.toml').read_text();smoke=tmp/'smoke.toml';smoke.write_text(text.replace('[7, 11, 19, 31, 42, 59, 73, 89, 101, 127]','[42]'))
 folder=tmp/'checkpoint';coordinator(smoke,folder,'--max-new-runs','3');progress=json.loads((folder/'progress.json').read_text());check('paused authorization campaign remains INCOMPLETE',progress['state']=='INCOMPLETE' and progress['completed_runs']==3 and progress['expected_runs']==24)
 originals={p.name:p.read_bytes() for p in (folder/'runs').glob('*.json')};coordinator(smoke,folder,'--resume');progress=json.loads((folder/'progress.json').read_text());check('resumed three-policy matrix completes 24 runs',progress['state']=='COMPLETE' and progress['completed_runs']==24);check('resume preserves cached bytes',all((folder/'runs'/n).read_bytes()==raw for n,raw in originals.items()))
 audits=[inspect_run(json.loads(p.read_text())) for p in sorted((folder/'runs').glob('*.json'))];check('24 full journals independently reconcile capability lifecycle, FIFO, capacity, wallets and exposure')
 optimized=subprocess.run([sys.executable,'-O',str(ROOT/'scripts/authorization_audit.py'),str(next((folder/'runs').glob('*.json')))],text=True,capture_output=True);check('Python -O cannot silently bypass audit',optimized.returncode!=0 and 'without -O' in optimized.stderr)
 coordinator(smoke,folder,ok=False);check('existing output refuses implicit overwrite')
 changed=tmp/'changed.toml';changed.write_text(smoke.read_text().replace('evidence_grace = 6','evidence_grace = 5'));coordinator(changed,folder,'--resume',ok=False);check('changed evidence window refuses resume')
 fake=tmp/NAME;fake.write_bytes(BINARY.read_bytes()+b'changed');coordinator(smoke,folder,'--resume','--binary',fake,ok=False);check('changed executable refuses resume before execution')
 victim=next((folder/'runs').glob('*.json'));raw=victim.read_bytes();victim.write_text('{broken');coordinator(smoke,folder,'--resume',ok=False);check('corrupt cached evidence prevents completion',json.loads((folder/'progress.json').read_text())['state']=='INCOMPLETE');victim.write_bytes(raw)
 live=tmp/'changing-input';proc=subprocess.Popen([sys.executable,str(ROOT/'scripts/run_economy_campaign.py'),'--model','authorization','--config',str(smoke),'--output-dir',str(live)],cwd=ROOT,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 try:
  deadline=time.monotonic()+10
  while not (live/'progress.json').exists() and proc.poll() is None and time.monotonic()<deadline: time.sleep(.005)
  assert (live/'progress.json').exists();(live/'config.toml').write_text(smoke.read_text().replace('evidence_grace = 6','evidence_grace = 5'));stdout,stderr=proc.communicate(timeout=60)
  check('checkpoint config mutation during execution prevents completion',proc.returncode!=0 and json.loads((live/'progress.json').read_text())['state']=='INCOMPLETE')
 finally:
  if proc.poll() is None: proc.kill();proc.communicate()
 campaign=OUT/'authorization-campaign.json';cli('authorization-campaign',ROOT/'configs/authorization-campaign.toml',campaign);cli('replay-authorization-campaign',campaign);data=json.loads(campaign.read_text());inspect_campaign(data);check('240 unique configurations match pinned fingerprint',len(data['runs'])==240 and data['fingerprint']==EXPECTED);check('all scenarios and policies use matched seed intentions')
 cli('authorization-csv',campaign,OUT/'authorization-campaign.csv');rows=list(csv.DictReader(io.StringIO((OUT/'authorization-campaign.csv').read_text())));check('CSV retains all configurations and fingerprints',len(rows)==240 and all(r['campaign_fingerprint']==EXPECTED and r['classification']=='SYNTHETIC' for r in rows))
 cli('authorization-viewer',campaign,OUT/'authorization-campaign.html');html=(OUT/'authorization-campaign.html').read_text();check('offline viewer denies external connections and escapes its data boundary',"connect-src 'none'" in html and html.count('</script>')==2)
 for policy in ['UNRESERVED_PAYMENT','FUNDING_WINDOW_HOLD','EVIDENCE_WINDOW_HOLD']:
  raw=[]
  for profile in ['debug','release']:
   path=tmp/(profile+policy+'.json');cli('authorization-run',smoke,42,'OBSERVATION_LAG',policy,path,profile=profile);cli('replay-authorization',path,profile=profile);raw.append(path.read_bytes())
  check(policy+' debug/release journals are byte-identical',raw[0]==raw[1]);run=json.loads(raw[0]);inspect_run(run);row=next(r for r in data['runs'] if r['seed']==42 and r['scenario']=='OBSERVATION_LAG' and r['policy']==policy);check(policy+' full journal matches campaign metrics and rounds',row['metrics']==run['metrics'] and row['rounds']==run['rounds'])
  bad=copy.deepcopy(run);bad['permits'][0]['binding']['amount']+=1;bad['fingerprint']=run_hash(bad);path=tmp/(policy+'forged.json');path.write_text(json.dumps(bad));cli('replay-authorization',path,ok=False);check(policy+' rehashed false permit rejected')
 bad=copy.deepcopy(data);bad['runs'].pop();bad['fingerprint']=campaign_hash(bad);path=tmp/'missing.json';path.write_text(json.dumps(bad));cli('replay-authorization-campaign',path,ok=False)
 for mode,suffix in [('authorization-csv','csv'),('authorization-viewer','html')]:
  output=tmp/('forbidden.'+suffix);cli(mode,path,output,ok=False);assert not output.exists()
 check('incomplete rehashed matrix cannot replay or export')
 bad=copy.deepcopy(data);bad['runs'][0]['metrics']['amounts']['unacknowledged_net_units']='0';bad['fingerprint']=campaign_hash(bad);path=tmp/'false-exposure.json';path.write_text(json.dumps(bad));cli('replay-authorization-campaign',path,ok=False);check('rehashed false exposure rejected')
 invalid=tmp/'invalid.toml';invalid.write_text(text.replace('send_window = 2','send_window = 1'));output=tmp/'invalid.json';cli('authorization-campaign',invalid,output,ok=False);check('invalid timing bound creates no output',not output.exists())
 cli('authorization-campaign',smoke,campaign,ok=False);check('existing campaign cannot be overwritten')
 total=lambda scenario,policy,key:sum(r['metrics']['counts'][key] for r in data['runs'] if r['scenario']==scenario and r['policy']==policy)
 check('evidence hold prevents paid ordinary requests without a start inside the modeled window',all(r['metrics']['counts']['paid_work_not_started']==0 for r in data['runs'] if r['policy']=='EVIDENCE_WINDOW_HOLD' and r['scenario']!='EVIDENCE_AFTER_EXPIRY'))
 check('payments outside a capacity hold retain paid-without-start exposure',total('PAID_FLOOD','UNRESERVED_PAYMENT','paid_work_not_started')>0)
 check('beyond-window evidence remains a paid but unstarted fact',total('EVIDENCE_AFTER_EXPIRY','EVIDENCE_WINDOW_HOLD','paid_work_not_started')>0)
 check('renewing unpaid reservations harm ordinary throughput',total('RENEWING_UNPAID','EVIDENCE_WINDOW_HOLD','acknowledged_work')<total('UNPAID_BURST','EVIDENCE_WINDOW_HOLD','acknowledged_work'))
 check('paid attackers still occupy reserved slots',total('PAID_FLOOD','EVIDENCE_WINDOW_HOLD','started_attacks')>0)
 check('duplicate authorization refuses another payment',total('DUPLICATE_AUTHORIZATION','EVIDENCE_WINDOW_HOLD','duplicate_send_refusals')>0)
 check('provider outage preserves payment exposure without fabricated refunds',all(round['metrics']['counts']['acknowledged_work']==0 and int(round['metrics']['amounts']['voluntary_returns_sent'])==0 for r in data['runs'] if r['scenario']=='PROVIDER_OUTAGE' for round in r['rounds'] if round['phase']=='STRESS'))
summary={'source_head_sha':HEAD,'source_tree_dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT)), 'classification':'SYNTHETIC','unit':'SIMULATED_UNITS','platform':platform.platform(),'campaign_runs':240,'campaign_fingerprint':EXPECTED,'independently_audited_full_runs':24,'tests':TESTS,'elapsed_seconds':round(time.perf_counter()-start,3),'timing_scope':'SINGLE_ACCEPTANCE_SAMPLE_NOT_LIVE_THROUGHPUT','network_or_signer':False}
(OUT/'authorization-evidence.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
