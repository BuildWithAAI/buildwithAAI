"""Exercise real CLI commands and independently hash/reconcile AE-004 outputs."""
import copy,hashlib,json,os,pathlib,platform,subprocess,tempfile
root=pathlib.Path(__file__).resolve().parents[1]
out=root/'target'/'validation-evidence';out.mkdir(parents=True,exist_ok=True)
suffix='.exe' if os.name=='nt' else ''
fields={
 'allocation':('ZOORA_AE004_ALLOCATION_V1',['schema_version','model','classification','allocation','review','allocation_journal','metrics']),
 'experiments':('ZOORA_AE004_EXPERIMENTS_V1',['schema_version','model','classification','rng','config','experiments']),
 'direct':('ZOORA_AE004_DIRECT_V1',['schema_version','model','classification','payment_mode','config','wallet_boundary','agreements','metrics','journal']),
 'review':('ZOORA_AE003_JSON_FINGERPRINT_V1',['schema_version','model','classification','policy','rng','scenario','config','market','cases','metrics','operations','journal']),
}
def fingerprint(kind,data):
 prefix,keys=fields[kind]
 return hashlib.sha256(prefix.encode()+b'\0'+json.dumps([data[k] for k in keys],ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
def run(profile,*args,ok=True):
 p=subprocess.run([str(root/'target'/profile/('zoora-review-market'+suffix)),*map(str,args)],cwd=root,capture_output=True,text=True,timeout=180)
 assert (p.returncode==0)==ok,(args,p.returncode,p.stdout,p.stderr)
 return p.stdout
def accounting(review):
 m=review['market']['metrics'];assert int(m['escrow_funded'])==sum(int(m[k]) for k in ['worker_payments','fees_collected','client_refunds'])
 state=review['market']['final_state'];assert all(not a['refundable_escrow'] for a in state['accounts'])
 assert sum(a['balance'] for a in state['accounts'])+int(state['treasury'])==review['config']['market']['agent_count']*review['config']['market']['starting_balance']
 assert review['fingerprint']==fingerprint('review',review)
with tempfile.TemporaryDirectory() as directory:
 temp=pathlib.Path(directory)
 reports={}
 golden={'experiments': 'caad08ff832700c7bc3ae47d9233b344374310aebb1bd7728ba5c31ac9e2db9e', 'direct': 'd80b7f813b2e6afae0995131248a4817f8026e8a024e21ca06859b919c59bc94'}
 for kind in ['experiments','direct']:
  paths=[]
  for profile in ['debug','release']:
   path=temp/(kind+'-'+profile+'.json')
   args=['experiments','configs/experiments.toml',path] if kind=='experiments' else ['direct-demo',path]
   run(profile,*args);run(profile,'replay-'+kind,path);paths.append(path)
   run(profile,*args,ok=False)
  assert paths[0].read_bytes()==paths[1].read_bytes()
  data=json.loads(paths[0].read_bytes());assert data['fingerprint']==fingerprint(kind,data)==golden[kind]
  reports[kind]=data;(out/(kind+'.json')).write_bytes(paths[0].read_bytes())
  viewer=out/(kind+'.html');run('release','viewer',paths[0],viewer);run('release','viewer',paths[0],viewer,ok=False)
  html=viewer.read_text(encoding='utf-8');assert 'REPLAY_VERIFIED_AT_EXPORT' in html and 'connect-src \'none\'' in html
  assert html.count('</script>')==2 and '<script src=' not in html
  import re,base64
  js=re.findall(r'<script>(.*?)</script>',html,re.S)[0];css=re.findall(r'<style>(.*?)</style>',html,re.S)[0]
  assert "script-src 'sha256-"+base64.b64encode(hashlib.sha256(js.encode()).digest()).decode()+"'" in html
  assert "style-src 'sha256-"+base64.b64encode(hashlib.sha256(css.encode()).digest()).decode()+"'" in html
 suite=reports['experiments'];assert [e['name'] for e in suite['experiments']]==['balanced','declared_aliases','capacity_stress','collusion_attempts','spam_missing_reviews']
 for e in suite['experiments']:
  expected=hashlib.sha256(b'ZOORA_AE004_INTENTIONS_V1\0'+json.dumps(e['intents'],ensure_ascii=False,separators=(',',':')).encode()).hexdigest();assert expected==e['workload_fingerprint']
  accounting(e['baseline']);allocation=e['allocated'];accounting(allocation['review']);assert allocation['fingerprint']==fingerprint('allocation',allocation)
  assert allocation['metrics']['active_at_finish']==0
  assert all(n<=allocation['allocation']['max_active_per_operator'] for n in allocation['metrics']['peak_active_by_operator'].values())
 assert suite['experiments'][0]['allocated']['metrics']['decisions_by_operator']==suite['experiments'][1]['allocated']['metrics']['decisions_by_operator']
 assert len(suite['experiments'][2]['allocated']['review']['cases'])==16
 assert len(suite['experiments'][4]['allocated']['review']['cases'])==32
 allocation=copy.deepcopy(suite['experiments'][0]['allocated']);path=temp/'allocated.json';path.write_text(json.dumps(allocation));run('release','replay-allocated',path)
 allocation['allocation_journal'][0]['reviewer']=99;allocation['fingerprint']=fingerprint('allocation',allocation);path.write_text(json.dumps(allocation));run('release','replay-allocated',path,ok=False)
 failed_output=temp/'must-not-export.html';run('release','viewer',path,failed_output,ok=False);assert not failed_output.exists()
 for name in ['direct.json','direct.html']:
  assert (root/'examples'/name).read_bytes()==(out/name).read_bytes(),('committed example differs',name)
 direct=reports['direct'];assert all(not b for b in direct['wallet_boundary'].values())
 assert [direct['metrics'][k] for k in ['payments_recorded','voluntary_refunds_recorded','net_transferred']]==['500','150','350']
 assert int(direct['metrics']['payments_recorded'])==int(direct['metrics']['net_transferred'])+int(direct['metrics']['voluntary_refunds_recorded'])
 assert direct['agreements'][1]['status']=='REFUND_REQUESTED' and direct['agreements'][1]['voluntary_refunds_received']=='0'
 assert direct['agreements'][3]['status']=='PAID' and direct['agreements'][3]['voluntary_refunds_received']=='0'
 assert all(r['command']['receipt']['classification']=='SYNTHETIC' for r in direct['journal'] if 'receipt' in r['command'])
 forged=copy.deepcopy(direct);forged['wallet_boundary']['can_freeze_wallets']=True;forged['fingerprint']=fingerprint('direct',forged)
 path=temp/'forged-direct.json';path.write_text(json.dumps(forged));run('release','replay-direct',path,ok=False);run('release','viewer',path,failed_output,ok=False);assert not failed_output.exists()
 forged=copy.deepcopy(suite);forged['experiments'][0]['description']='invented outcome';forged['fingerprint']=fingerprint('experiments',forged)
 path=temp/'forged-suite.json';path.write_text(json.dumps(forged));run('release','replay-experiments',path,ok=False)
 invalid=temp/'bad.toml';invalid.write_text('seed=42\ntasks=501\n');run('release','experiments',invalid,temp/'bad.json',ok=False)
run('release','benchmark-allocated',out/'allocation-scaling.json')
scaling=json.loads((out/'allocation-scaling.json').read_text());assert [s['agents'] for s in scaling]==[100,1000,10000];assert all(s['tasks']==5000 and s['metrics']['active_at_finish']==0 for s in scaling)
summary={'source_head_sha':os.environ['SOURCE_HEAD_SHA'],'platform':platform.platform(),'fingerprints':{k:v['fingerprint'] for k,v in reports.items()},
 'independent_hashes_verified':True,'matched_workload_accounting_verified':True,'debug_release_byte_identical':True,'forged_allocation_and_boundary_rejected':True,'verified_viewer_export_verified':True,
 'chain_integration_verified':False,'experiment_results':[{'name':e['name'],'baseline_decisions':e['baseline']['metrics']['decisions_by_reviewer'],
 'allocated_metrics':e['allocated']['metrics'],'baseline_tasks':len(e['baseline']['cases']),'allocated_tasks':len(e['allocated']['review']['cases'])} for e in suite['experiments']],
 'direct_metrics':direct['metrics']}
(out/'ae004-environment.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
