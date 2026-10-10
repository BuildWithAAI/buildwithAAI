"""Run the real review CLI and independently verify report hashes/accounting."""
import copy,hashlib,json,os,pathlib,subprocess,tempfile,platform
root=pathlib.Path(__file__).resolve().parents[1]
out=root/'target'/'validation-evidence';out.mkdir(parents=True,exist_ok=True)
suffix='.exe' if os.name=='nt' else ''
def run(profile,*args,ok=True):
    p=subprocess.run([str(root/'target'/profile/('zoora-review-market'+suffix)),*map(str,args)],cwd=root,capture_output=True,text=True,timeout=120)
    assert (p.returncode==0)==ok,(args,p.returncode,p.stdout,p.stderr)
    return p.stdout
fields=['schema_version','model','classification','policy','rng','scenario','config','market','cases','metrics','operations','journal']
reports={}
golden={'default':'2084161175d885e7ec66a1d381e2d2a60fc609b5acef3b036dd348f6490b9c12','no-budget':'8c7623df42223be79bde2fc6550716cb37b28d097b232ed3e45a9535d00e6525'}
with tempfile.TemporaryDirectory() as directory:
    temp=pathlib.Path(directory)
    for config in ['default','no-budget']:
        paths=[]
        for profile in ['debug','release']:
            path=temp/(config+'-'+profile+'.json');run(profile,'run','configs/'+config+'.toml',path);run(profile,'replay',path);paths.append(path)
            run(profile,'run','configs/'+config+'.toml',path,ok=False)
        assert paths[0].read_bytes()==paths[1].read_bytes()
        data=json.loads(paths[0].read_bytes());reports[config]=data
        digest=hashlib.sha256(b'ZOORA_AE003_JSON_FINGERPRINT_V1\0'+json.dumps([data[k] for k in fields],ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
        assert digest==data['fingerprint']==golden[config],(digest,data['fingerprint'],golden[config])
        market=data['market'];m=market['metrics'];assert int(m['escrow_funded'])==sum(int(m[k]) for k in ['worker_payments','fees_collected','client_refunds'])
        state=market['final_state'];assert all(not a['refundable_escrow'] for a in state['accounts']);assert sum(a['balance'] for a in state['accounts'])+int(state['treasury'])==data['config']['market']['agent_count']*data['config']['market']['starting_balance']
        (out/(config+'.json')).write_bytes(paths[0].read_bytes())
    invalid=temp/'invalid.toml';invalid.write_text('secret = "ignored"\n');run('release','run',invalid,temp/'bad.json',ok=False)
    run('release','nonsense',ok=False)
    data=copy.deepcopy(reports['default']);data['journal'][0]['outcome']={'status':'TIMER_NOOP'}
    data['fingerprint']=hashlib.sha256(b'ZOORA_AE003_JSON_FINGERPRINT_V1\0'+json.dumps([data[k] for k in fields],ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
    path=temp/'forged.json';path.write_text(json.dumps(data));run('release','replay',path,ok=False)
    oversized=temp/'huge.toml';oversized.write_bytes(b' '*(4*1024*1024+1));run('release','run',oversized,temp/'huge.json',ok=False)
    if os.name!='nt':
        link=temp/'linked.toml';link.symlink_to(root/'configs'/'default.toml');run('release','run',link,temp/'link.json',ok=False)
    run('release','benchmark',out/'scaling.json');scaling=json.loads((out/'scaling.json').read_text());assert [s['agents'] for s in scaling]==[100,1000,10000];assert all(s['tasks']==5000 for s in scaling)
(out/'environment.json').write_text(json.dumps({'source_head_sha':os.environ['SOURCE_HEAD_SHA'],'platform':platform.platform(),'rustc':subprocess.check_output(['rustc','--version'],text=True).strip(),'independent_json_fingerprint_verified':True,'independent_supply_accounting_verified':True,'forged_journal_with_recomputed_hash_rejected':True,'debug_release_byte_identical':True},indent=2)+'\n')
print(json.dumps({'fingerprints':{k:v['fingerprint'] for k,v in reports.items()},'scaling':scaling},indent=2))
