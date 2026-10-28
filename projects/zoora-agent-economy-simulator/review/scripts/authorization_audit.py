"""Independent AE-014 arithmetic and capability lifecycle audit, not real authentication."""
from __future__ import annotations
from collections import Counter,defaultdict
import hashlib,json,sys
from pathlib import Path
if not __debug__: raise RuntimeError('Audit requires assertions; run without -O')
def digest(domain,value):
 return hashlib.sha256(domain.encode()+b'\0'+json.dumps(value,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
def run_hash(d):
 return digest('ZOORA_AE014_AUTHORIZATION_RUN_V1',[[d[k] for k in ['schema_version','model','classification','unit','rng']],*[d[k] for k in ['config','seed','scenario','policy','intentions','intentions_fingerprint','jobs','permits','authorizations','transfers','observations','final_balances','rounds','metrics','direct']]])
def campaign_hash(d):
 return digest('ZOORA_AE014_AUTHORIZATION_CAMPAIGN_V1',[d[k] for k in ['schema_version','model','classification','unit','rng','config','runs']])
def inspect_campaign(d):
 assert d['classification']=='SYNTHETIC' and d['unit']=='SIMULATED_UNITS' and d['fingerprint']==campaign_hash(d)
 cfg=d['config'];policies=['UNRESERVED_PAYMENT','FUNDING_WINDOW_HOLD','EVIDENCE_WINDOW_HOLD']
 assert [(r['seed'],r['scenario'],r['policy']) for r in d['runs']]==[(s,x,p) for s in cfg['seeds'] for x in cfg['scenarios'] for p in policies]
 for s in cfg['seeds']: assert len({r['intentions_fingerprint'] for r in d['runs'] if r['seed']==s})==1
 for row in d['runs']: assert int(row['metrics']['amounts']['opening_units'])==int(row['metrics']['amounts']['final_wallet_units'])
def inspect_run(d):
 assert d['classification']=='SYNTHETIC' and d['unit']=='SIMULATED_UNITS' and d['fingerprint']==run_hash(d)
 assert d['intentions_fingerprint']==digest('ZOORA_AE014_AUTHORIZATION_INTENTIONS_V1',d['intentions'])
 return inspect_transcript(d)
def inspect_transcript(d,attempts_by_agreement=None):
 cfg=d['config'];jobs={j['binding']['agreement_id']:j for j in d['jobs']};assert len(jobs)==len(d['jobs'])
 permits={p['token']:p for p in d['permits']};assert len(permits)==len(d['permits'])<=cfg['max_authorizations']
 agreements={a['terms']['agreement_id']:a for a in d['direct']['agreements']};assert set(agreements)=={i for i,j in jobs.items() if j['quoted']}
 opening=cfg['agents']*cfg['starting_balance'];balances=[cfg['starting_balance']]*cfg['agents'];refs=set();payment=Counter();returns=Counter();facts={}
 for n,f in enumerate(d['transfers']):
  r=f['receipt'];assert f['sequence']==n and r['transaction_ref'] not in refs;refs.add(r['transaction_ref']);b=jobs[r['agreement_id']]['binding']
  assert r['transaction_ref']==digest('ZOORA_AE004_DIRECT_FIXTURE_V1',[r['agreement_id'],0 if f['kind']=='PAYMENT' else 1,r['sender'],r['recipient'],r['amount'],r['simulation_tick']])
  assert r['asset']=='SYNTHETIC_UNIT' and r['source']=='OFFLINE_FIXTURE_V1' and r['classification']=='SYNTHETIC' and r['commitment']=='SIMULATED_FINAL' and r['slot'] is None
  assert r['simulation_tick']<=r['availability_tick'];a=r['amount'];assert 0<a<=b['amount']
  assert (r['sender'],r['recipient'])==((b['client'],b['provider']) if f['kind']=='PAYMENT' else (b['provider'],b['client']))
  balances[r['sender']]-=a;balances[r['recipient']]+=a;assert min(balances)>=0 and sum(balances)==opening
  (payment if f['kind']=='PAYMENT' else returns)[r['agreement_id']]+=a
  if f['kind']=='PAYMENT': assert r['agreement_id'] not in facts;facts[r['agreement_id']]=f
 assert balances==[int(b['units']) for b in d['final_balances']]
 observations={};ready={};full_returns={}
 for n,o in enumerate(d['observations']):
  seq=o['transfer_sequence'];f=d['transfers'][seq];r=o['receipt'];assert o['sequence']==n and seq not in observations and f['receipt']==r and o['recorded'] is True;observations[seq]=o
  j=jobs[r['agreement_id']];p=permits[j['token']]
  expected=f['kind']=='VOLUNTARY_RETURN' or r['simulation_tick']<p['send_before'] and r['availability_tick']<p['observe_before'];assert o['timely']==expected
  if f['kind']=='PAYMENT' and expected: ready[j['token']]=(n,r['availability_tick'])
  if f['kind']=='VOLUNTARY_RETURN' and returns[r['agreement_id']]==payment[r['agreement_id']]: full_returns[r['agreement_id']]=r['availability_tick']
 assert len(observations)==len(d['transfers'])
 state={};occupied=defaultdict(set);peaks=Counter();last=-1;granted=0;send_events={}
 for n,e in enumerate(d['authorizations']):
  assert e['sequence']==n and e['tick']>=last;last=tick=e['tick'];token=e['token'];action=e['action'];j=jobs[e['agreement_id']];b=j['binding'];provider=b['provider'];assert e['provider']==provider
  if action=='GRANTED':
   p=permits[token];assert token not in state and p['ordinal']==granted;granted+=1
   assert p['binding']==b and p['issued_tick']==tick and p['send_before']==tick+cfg['send_window'] and p['observe_before']==p['send_before']+cfg['evidence_grace']
   assert p['observe_before']+cfg['service_ticks']<b['delivery_deadline'] and token==digest('ZOORA_AE014_CAPACITY_PERMIT_V1',[p['ordinal'],b,tick,p['send_before'],p['observe_before']])
   held=d['policy']!='UNRESERVED_PAYMENT';state[token]={'held':held,'expired':False,'released':False,'consumed':None,'started':None}
   if held: assert len(occupied[provider])<cfg['provider_capacity'];occupied[provider].add(token)
  elif action in ['CAPACITY_REFUSED','DEADLINE_REFUSED','METADATA_REFUSED']:
   assert token is None
   if action=='CAPACITY_REFUSED': assert d['policy']!='UNRESERVED_PAYMENT' and len(occupied[provider])>=cfg['provider_capacity']
   if action=='DEADLINE_REFUSED': assert tick+cfg['send_window']+cfg['evidence_grace']+cfg['service_ticks']>=b['delivery_deadline']
   if action=='METADATA_REFUSED': assert granted>=cfg['max_authorizations']
  else:
   assert token in state;p=permits[token];s=state[token]
   if action=='SEND_ALLOWED':
    assert s['consumed'] is None and not s['expired'] and not s['released'] and p['issued_tick']<tick<p['send_before'];s['consumed']=tick;send_events[token]=tick
    f=facts[b['agreement_id']];assert f['receipt']['simulation_tick']==tick and f['receipt']['amount']==b['amount'] and jobs[b['agreement_id']]['token']==token
   elif action=='ALREADY_CONSUMED': assert s['consumed'] is not None
   elif action=='SEND_EXPIRED': assert s['consumed'] is None and not (p['issued_tick']<tick<p['send_before'])
   elif action=='HOLD_EXPIRED':
    assert s['held'] and s['started'] is None and tick==(p['send_before'] if d['policy']=='FUNDING_WINDOW_HOLD' else p['observe_before']);s['held']=False;occupied[provider].remove(token)
   elif action=='AUTHORIZATION_EXPIRED': assert not s['expired'] and s['started'] is None and tick==p['observe_before'];s['expired']=True
   elif action=='STARTED':
    assert s['consumed'] is not None and s['started'] is None and not s['expired'] and tick<p['observe_before'] and tick+cfg['service_ticks']+1<b['delivery_deadline']
    assert token in ready and ready[token][1]<=tick
    waiting=[ready[t][0] for t,v in state.items() if t in ready and ready[t][1]<=tick and v['started'] is None and not v['expired'] and permits[t]['binding']['provider']==provider]
    assert ready[token][0]==min(waiting)
    if not s['held']: assert len(occupied[provider])<cfg['provider_capacity'];occupied[provider].add(token);s['held']=True
    s['started']=tick;assert j['started_tick']==tick
   elif action in ['RELEASED','DELIVERY_DEADLINE']:
    assert s['held'] and s['started'] is not None and not s['released']
    if action=='DELIVERY_DEADLINE': assert tick==b['delivery_deadline']
    else: assert j['acknowledged'] and tick==j['started_tick']+cfg['service_ticks']+1 or full_returns.get(b['agreement_id'])==tick
    occupied[provider].remove(token);s['held']=False;s['released']=True
   else: raise AssertionError('Unexpected fixture authorization action '+action)
  assert len(occupied[provider])<=cfg['provider_capacity'];peaks[(tick-3)//32]=max(peaks[(tick-3)//32],len(occupied[provider]))
 assert granted==len(permits) and all(not slots for slots in occupied.values())
 for token,p in permits.items():
  s=state[token];assert (p['holds_capacity'],p['expired'],p['released'],p['consumed_tick'],p['started_tick'])==(s['held'],s['expired'],s['released'],s['consumed'],s['started'])
 assert len(send_events)==len(facts)
 assert all(v is False for v in d['direct']['wallet_boundary'].values())
 for key,j in jobs.items():
  if j['quoted']: assert j['acknowledged']==agreements[key]['delivery_acknowledged']
  assert j['sent']==(payment[key]>0)
  if j['token'] is not None and (not j['intention']['attack_fixture'] or d['scenario']=='PAID_FLOOD'):
   ticks=attempts_by_agreement[key] if attempts_by_agreement is not None else [permits[j['token']]['issued_tick']+1];refused=False;client=j['binding']['client']
   for tick in ticks:
    balance=cfg['starting_balance']
    for f in d['transfers']:
     r=f['receipt'];earlier=r['simulation_tick']<tick or r['simulation_tick']==tick and (f['kind']=='VOLUNTARY_RETURN' or r['agreement_id']<key)
     if earlier: balance+=r['amount']*((r['recipient']==client)-(r['sender']==client))
    refused|=balance<cfg['price']
   assert j['budget_refused']==refused
  else: assert j['budget_refused'] is False
  if j['started_tick'] is not None: assert permits[j['token']]['started_tick']==j['started_tick']
 def totals(round_number=None):
  selected={k:j for k,j in jobs.items() if round_number is None or j['intention']['round']==round_number};counts=Counter();amounts=Counter(opening_units=opening,final_wallet_units=opening)
  for k,j in selected.items():
   paid=payment[k]>0;started=j['started_tick'] is not None;ack=j['acknowledged'];net=payment[k]-returns[k];amounts['payments_sent']+=payment[k];amounts['voluntary_returns_sent']+=returns[k]
   if j['intention']['attack_fixture']: counts['attack_requests']+=1;counts['started_attacks']+=started
   else:
    counts['intended_work']+=1;counts['quoted_work']+=j['quoted'];counts['paid_work']+=paid;counts['started_work']+=started;counts['acknowledged_work']+=ack;counts['paid_work_not_started']+=paid and not started;counts['insufficient_budget']+=j['budget_refused']
    if paid and not started: amounts['paid_work_not_started_net_units']+=net
   if not ack: amounts['unacknowledged_net_units']+=net
  event_fields={'GRANTED':'permits_granted','CAPACITY_REFUSED':'capacity_refusals','DEADLINE_REFUSED':'deadline_refusals','METADATA_REFUSED':'metadata_refusals','HOLD_EXPIRED':'expired_holds','ALREADY_CONSUMED':'duplicate_send_refusals'}
  for e in d['authorizations']:
   if e['agreement_id'] in selected and e['action'] in event_fields: counts[event_fields[e['action']]]+=1
  counts['late_observations']=sum(not o['timely'] and d['transfers'][o['transfer_sequence']]['kind']=='PAYMENT' for o in d['observations'] if o['receipt']['agreement_id'] in selected)
  counts['peak_provider_slots']=max(peaks.values(),default=0) if round_number is None else peaks[round_number]
  return counts,amounts
 for r in [*d['rounds'],{'round':None,'metrics':d['metrics']}]:
  c,a=totals(r['round']);assert all(c[k]==v for k,v in r['metrics']['counts'].items());assert all(a[k]==int(v) for k,v in r['metrics']['amounts'].items())
 assert sum(payment.values())==int(d['direct']['metrics']['payments_recorded']) and sum(returns.values())==int(d['direct']['metrics']['voluntary_refunds_recorded'])
 return {'permits':len(permits),'authorizations':len(d['authorizations']),'transfers':len(d['transfers']),'observations':len(d['observations'])}
if __name__=='__main__':
 if len(sys.argv)!=2: raise SystemExit('usage: authorization_audit.py REPORT.json')
 p=Path(sys.argv[1]);assert not p.is_symlink() and p.is_file() and p.stat().st_size<=128*1024*1024;d=json.loads(p.read_text())
 if d.get('model')=='zoora-authorization-run/0.1.0': result=inspect_run(d)
 elif d.get('model')=='zoora-authorization-campaign/0.1.0': inspect_campaign(d);result={'runs':len(d['runs'])}
 else: raise SystemExit('Unsupported authorization model')
 print(json.dumps({'classification':'SYNTHETIC','verified':result,'native_replay_also_required':True,'external_authentication':False}))
