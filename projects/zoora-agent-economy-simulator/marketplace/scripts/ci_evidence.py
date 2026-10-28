"""Execute real CLI paths and independently reproduce the schema-1 JSON fingerprint."""
import hashlib,json,os,pathlib,subprocess,tempfile,platform
root=pathlib.Path(__file__).resolve().parents[1]
out=root/'target'/'validation-evidence';out.mkdir(parents=True,exist_ok=True)
suffix='.exe' if os.name=='nt' else ''
def run(profile,*args,ok=True):
    p=subprocess.run([str(root/'target'/profile/('zoora-task-market'+suffix)),*map(str,args)],cwd=root,capture_output=True,text=True,timeout=120)
    assert (p.returncode==0)==ok,(args,p.returncode,p.stdout,p.stderr)
    return p.stdout
reports={}
golden={'default':'1d8284e43872298c5a1dbf3778a72c31bd27e56802fd8e3d1f95935d6d1e4d16','no-budget':'5f2bb3492d0df6536e84d39c72e3feb02e2c9dd52f1be8fe34d044299590cc9e'}
with tempfile.TemporaryDirectory() as directory:
    temp=pathlib.Path(directory)
    for config in ['default','no-budget']:
        paths=[]
        for profile in ['debug','release']:
            path=temp/(config+'-'+profile+'.json');run(profile,'run','configs/'+config+'.toml',path);run(profile,'replay',path);paths.append(path)
            run(profile,'run','configs/'+config+'.toml',path,ok=False)
        assert paths[0].read_bytes()==paths[1].read_bytes()
        data=json.loads(paths[0].read_bytes());reports[config]=data
        payload=[data[k] for k in ['schema_version','model','classification','units','rng','scenario','config','final_state','metrics','journal']]
        digest=hashlib.sha256(b'ZOORA_AE002_JSON_FINGERPRINT_V1\0'+json.dumps(payload,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
        assert digest==data['fingerprint']==golden[config],(digest,data['fingerprint'],golden[config])
        (out/(config+'.json')).write_bytes(paths[0].read_bytes())
    invalid=temp/'invalid.toml';invalid.write_text('agent_count = -1\n');run('release','run',invalid,temp/'bad.json',ok=False)
    run('release','nonsense',ok=False)
    tampered=reports['default'].copy();tampered['classification']='OBSERVED';path=temp/'tampered.json';path.write_text(json.dumps(tampered));run('release','replay',path,ok=False)
    oversized=temp/'huge.toml';oversized.write_bytes(b' '* (1024*1024+1));run('release','run',oversized,temp/'huge.json',ok=False)
    if os.name!='nt':
        link=temp/'linked.toml';link.symlink_to(root/'configs'/'default.toml');run('release','run',link,temp/'link.json',ok=False)
    run('release','benchmark',out/'scaling.json')
    scaling=json.loads((out/'scaling.json').read_text());assert [s['agents'] for s in scaling]==[100,1000,10000];assert all(s['tasks']==5000 for s in scaling)
(out/'environment.json').write_text(json.dumps({'source_head_sha':os.environ['SOURCE_HEAD_SHA'],'platform':platform.platform(),'rustc':subprocess.check_output(['rustc','--version'],text=True).strip(),'independent_json_fingerprint_verified':True,'debug_release_byte_identical':True},indent=2)+'\n')
print(json.dumps({'fingerprints':{k:v['fingerprint'] for k,v in reports.items()},'scaling':scaling},indent=2))
