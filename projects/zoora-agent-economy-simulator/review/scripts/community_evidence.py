"""Exercise actual CLI profiles; independently reconcile synthetic reports and exports."""
import copy,csv,hashlib,io,json,os,pathlib,platform,re,subprocess,tempfile,base64
root=pathlib.Path(__file__).resolve().parents[1]
out=root/'target'/'validation-evidence';out.mkdir(parents=True,exist_ok=True)
suffix='.exe' if os.name=='nt' else ''
fields={
 'community':('ZOORA_AE005_COMMUNITY_V1',['schema_version','model','classification','provenance','config','agents','projects','posts','offers','orders','direct','metrics','journal']),
 'run':('ZOORA_AE005_RUN_V1',['schema_version','model','classification','rng','config','scenario','intents','intentions_fingerprint','community']),
 'batch':('ZOORA_AE005_BATCH_V1',['schema_version','model','classification','rng','config','runs']),
 'direct':('ZOORA_AE004_DIRECT_V1',['schema_version','model','classification','payment_mode','config','wallet_boundary','agreements','metrics','journal'])}
def fingerprint(kind,data):
 prefix,keys=fields[kind]
 return hashlib.sha256(prefix.encode()+b'\0'+json.dumps([data[k] for k in keys],ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
def run(profile,*args,ok=True):
 p=subprocess.run([str(root/'target'/profile/('zoora-review-market'+suffix)),*map(str,args)],cwd=root,capture_output=True,text=True,timeout=180)
 assert (p.returncode==0)==ok,(args,p.returncode,p.stdout,p.stderr)
 return p.stdout
def inspect(data):
 assert data['classification']=='SYNTHETIC' and data['fingerprint']==fingerprint('run',data)
 intents=hashlib.sha256(b'ZOORA_AE005_INTENTIONS_V1\0'+json.dumps(data['intents'],ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
 assert intents==data['intentions_fingerprint']
 c=data['community'];assert c['fingerprint']==fingerprint('community',c)
 d=c['direct'];assert d['fingerprint']==fingerprint('direct',d) and all(v is False for v in d['wallet_boundary'].values())
 assert c['provenance']['slot'] is None and c['provenance']['observed_at'] is None and c['provenance']['available_at'] is None
 assert len({a['registration']['wallet_label'] for a in c['agents']})==len(c['agents'])
 handles=[h['handle'] for a in c['agents'] for h in a['handle_history']];assert len(handles)==len(set(handles))
 m=d['metrics'];assert int(m['payments_recorded'])==int(m['voluntary_refunds_recorded'])+int(m['net_transferred'])
 assert int(m['payments_recorded'])==sum(int(a['payments_received']) for a in d['agreements'])
 assert int(m['voluntary_refunds_recorded'])==sum(int(a['voluntary_refunds_received']) for a in d['agreements'])
 terms={a['terms']['agreement_id']:a['terms'] for a in d['agreements']}
 assert len(c['orders'])==len(terms)==c['metrics']['accepted_orders']
 for order in c['orders']:
  t=terms[order['agreement_id']];offer=next(o for o in c['offers'] if o['offer_id']==order['offer_id'])
  assert (t['client'],t['provider'],t['amount'],t['criteria_digest'])==(order['client'],order['provider'],offer['amount'],offer['criteria_digest'])
 for r in d['journal']:
  if 'receipt' in r['command']:assert r['command']['receipt']['classification']=='SYNTHETIC'
with tempfile.TemporaryDirectory() as directory:
 temp=pathlib.Path(directory);reports={}
 for scenario in ['BALANCED','SPAM_RESERVATIONS','PROVIDER_OFFLINE']:
  outputs=[]
  for profile in ['debug','release']:
   path=temp/(scenario+'-'+profile+'.json');run(profile,'community-run','configs/community.toml',scenario,path);run(profile,'replay-community',path)
   run(profile,'community-run','configs/community.toml',scenario,path,ok=False);outputs.append(path)
  assert outputs[0].read_bytes()==outputs[1].read_bytes()
  data=json.loads(outputs[0].read_bytes());inspect(data);reports[scenario]=data
  name='community-'+scenario.lower();(out/(name+'.json')).write_bytes(outputs[0].read_bytes())
  run('release','community-csv',outputs[0],out/(name+'.csv'))
  run('release','viewer',outputs[0],out/(name+'.html'))
  rows=list(csv.DictReader(io.StringIO((out/(name+'.csv')).read_text())));assert len(rows)==data['community']['metrics']['accepted_orders']
  assert all(row['classification']=='SYNTHETIC' and row['slot']=='UNAVAILABLE' and row['observed_at']=='UNAVAILABLE' for row in rows)
  html=(out/(name+'.html')).read_text(encoding='utf-8');assert 'connect-src \'none\'' in html and html.count('</script>')==2
  js=re.findall(r'<script>(.*?)</script>',html,re.S)[0];css=re.findall(r'<style>(.*?)</style>',html,re.S)[0]
  for directive,body in [('script',js),('style',css)]:assert directive+"-src 'sha256-"+base64.b64encode(hashlib.sha256(body.encode()).digest()).decode()+"'" in html
 balanced=reports['BALANCED'];spam=reports['SPAM_RESERVATIONS'];offline=reports['PROVIDER_OFFLINE']
 assert balanced['intents']==spam['intents']==offline['intents']
 assert spam['community']['metrics']['accepted_orders']==160 and spam['community']['metrics']['unpaid_at_finish']==160
 assert spam['community']['metrics']['provider_capacity_rejections']==100 and spam['community']['direct']['metrics']['payments_recorded']=='0'
 assert spam['community']['metrics']['post_rate_rejections']==3
 batch_paths=[]
 for profile in ['debug','release']:
  path=temp/('batch-'+profile+'.json');run(profile,'community-batch','configs/community-batch.toml',path);run(profile,'replay-community-batch',path);batch_paths.append(path)
 assert batch_paths[0].read_bytes()==batch_paths[1].read_bytes();batch=json.loads(batch_paths[0].read_bytes());assert batch['fingerprint']==fingerprint('batch',batch)
 assert len(batch['runs'])==9
 for seed in batch['config']['seeds']:assert len({r['intentions_fingerprint'] for r in batch['runs'] if r['seed']==seed})==1
 (out/'community-batch.json').write_bytes(batch_paths[0].read_bytes());run('release','community-csv',batch_paths[0],out/'community-batch.csv')
 batch_rows=list(csv.DictReader(io.StringIO((out/'community-batch.csv').read_text())));assert len(batch_rows)==9
 assert all(row['observed_at']=='UNAVAILABLE' and row['available_at']=='UNAVAILABLE' and row['slot']=='UNAVAILABLE' for row in batch_rows)
 forged=copy.deepcopy(balanced);forged['community']['orders'][0]['offer_id']=999;forged['community']['fingerprint']=fingerprint('community',forged['community']);forged['fingerprint']=fingerprint('run',forged)
 path=temp/'forged.json';path.write_text(json.dumps(forged));run('release','replay-community',path,ok=False)
 for command,extension in [('viewer','html'),('community-csv','csv')]:
  failed=temp/('must-not-export.'+extension);run('release',command,path,failed,ok=False);assert not failed.exists()
 forged=copy.deepcopy(batch);forged['runs'][0]['direct_metrics']['net_transferred']='999';forged['fingerprint']=fingerprint('batch',forged)
 path=temp/'forged-batch.json';path.write_text(json.dumps(forged));run('release','replay-community-batch',path,ok=False)
 invalid=temp/'invalid.toml';invalid.write_text('seed=42\nagents=20\ntasks=501\nmax_pending_per_provider=16\nposts_per_agent_per_tick=3\n');run('release','community-run',invalid,'BALANCED',temp/'invalid.json',ok=False)
summary={'source_head_sha':os.environ['SOURCE_HEAD_SHA'],'platform':platform.platform(),'independent_hashes_verified':True,'scripted_not_llm':True,'chain_integration_verified':False,
 'run_fingerprints':{s:r['fingerprint'] for s,r in reports.items()},'batch_fingerprint':batch['fingerprint'],'scenarios':{s:{'community':r['community']['metrics'],'direct':r['community']['direct']['metrics']} for s,r in reports.items()},
 'batch_runs':batch['runs'],'csv_missingness_verified':True,'debug_release_byte_identical':True,'rehashed_forgery_rejected':True}
(out/'ae005-environment.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
