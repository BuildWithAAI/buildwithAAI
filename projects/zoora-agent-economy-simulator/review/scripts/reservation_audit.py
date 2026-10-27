"""Independent rule-decision reconstruction plus shared capability/wallet auditing.

This audit does not regenerate fixture requests or authenticate external owners.
Run native replay as well. Original Rust-emitted field order is retained for hashes.
"""
from __future__ import annotations
from collections import Counter,defaultdict
import json,sys
from pathlib import Path
from authorization_audit import digest,inspect_transcript
if not __debug__:raise RuntimeError('Audit requires assertions; run without -O')
POLICIES=['EVIDENCE_HOLD','PENDING_QUOTA','QUOTA_COOLDOWN']
BASE={'CONCENTRATED_UNPAID':'RENEWING_UNPAID','ROTATING_UNPAID':'RENEWING_UNPAID','SLOW_PAYER':'NORMAL_DELAY'}
def run_hash(d):return digest('ZOORA_AE015_RESERVATION_RUN_V1',[[d[k] for k in ['schema_version','model','classification','unit','rng']],*[d[k] for k in ['config','seed','scenario','policy','intentions_fingerprint','work','decisions','controls','wallets']]])
def campaign_hash(d):return digest('ZOORA_AE015_RESERVATION_CAMPAIGN_V1',[d[k] for k in ['schema_version','model','classification','unit','rng','config','runs']])
def inspect_campaign(d):
 assert d['classification']=='SYNTHETIC' and d['unit']=='SIMULATED_UNITS' and d['fingerprint']==campaign_hash(d)
 cfg=d['config'];assert [(r['seed'],r['scenario'],r['policy']) for r in d['runs']]==[(s,x,p) for s in cfg['authorization']['seeds'] for x in cfg['scenarios'] for p in POLICIES]
 for s in cfg['authorization']['seeds']:assert len({r['intentions_fingerprint'] for r in d['runs'] if r['seed']==s})==1
 for r in d['runs']:
  a=r['metrics']['amounts'];g=r['controls'];assert int(a['opening_units'])==int(a['final_wallet_units']) and g['attempts']==g['eligible_attempts']+g['quota_refusals']+g['cooldown_refusals']
def inspect_run(d):
 assert d['classification']=='SYNTHETIC' and d['unit']=='SIMULATED_UNITS' and d['fingerprint']==run_hash(d)
 w=d['work'];cfg=d['config']['authorization'];cooldown=d['config']['cooldown_ticks'];assert 1<=cooldown<=16
 assert d['intentions_fingerprint']==digest('ZOORA_AE015_RESERVATION_INTENTIONS_V1',w['intentions'])
 attempts=defaultdict(list);jobs={j['binding']['agreement_id']:j for j in w['jobs']}
 for key,j in jobs.items():
  related=[p for p in w['permits'] if p['binding']['agreement_id']==key]
  for n,p in enumerate(related):
   round=j['intention']['round'];stress=cfg['rounds']//3<=round<cfg['rounds']*2//3;slow=d['scenario']=='SLOW_PAYER' and stress and not j['intention']['attack_fixture'] and n==0;tick=p['issued_tick']+(cfg['send_window'] if slow else 1)
   if n+1<len(related) and related[n+1]['issued_tick']<=tick:continue
   attempts[key].append(tick)
  expected=cfg['agents']-1 if d['scenario']=='CONCENTRATED_UNPAID' and j['intention']['attack_fixture'] else j['intention']['client'];assert j['binding']['client']==expected
 shared=dict(w,config=cfg,scenario=BASE.get(d['scenario'],d['scenario']),policy='EVIDENCE_WINDOW_HOLD');result=inspect_transcript(shared,attempts)
 permits={p['token']:p for p in w['permits']};outcomes=[e for e in w['authorizations'] if e['action'] in ['GRANTED','CAPACITY_REFUSED','DEADLINE_REFUSED','METADATA_REFUSED']];visible=[];cursor=0;last=(-1,-1);controls=Counter(attempts=len(d['decisions']))
 for n,e in enumerate(d['decisions']):
  assert e['sequence']==n;b=e['binding'];tick=e['tick'];assert (tick,b['agreement_id'])>=last;last=(tick,b['agreement_id']);assert b==jobs[b['agreement_id']]['binding']
  relevant=[p for p in visible if (p['binding']['client'],p['binding']['provider'])==(b['client'],b['provider'])]
  pending=[p for p in relevant if (p['consumed_tick'] is None or p['consumed_tick']>=tick) and tick<p['observe_before']]
  expired=[p for p in relevant if p['consumed_tick'] is None and p['observe_before']<=tick<p['observe_before']+cooldown]
  reason='ELIGIBLE';blocking=None;until=None
  if d['policy']!='EVIDENCE_HOLD' and pending:reason='PENDING_QUOTA';blocking=pending[0]['token']
  elif d['policy']=='QUOTA_COOLDOWN' and expired:
   p=max(expired,key=lambda p:(p['observe_before'],p['ordinal']));reason='EXPIRY_COOLDOWN';blocking=p['token'];until=p['observe_before']+cooldown
  assert (e['reason'],e['blocking_token'],e['blocked_until'])==(reason,blocking,until)
  if reason=='ELIGIBLE':
   controls['eligible_attempts']+=1;assert cursor<len(outcomes);o=outcomes[cursor];cursor+=1;assert (o['tick'],o['agreement_id'],o['provider'])==(tick,b['agreement_id'],b['provider'])
   if o['action']=='GRANTED':visible.append(permits[o['token']])
  elif reason=='PENDING_QUOTA':controls['quota_refusals']+=1
  else:controls['cooldown_refusals']+=1
 assert cursor==len(outcomes) and len(visible)==len(permits)
 pending=defaultdict(set)
 for e in w['authorizations']:
  token=e['token']
  if token is None:continue
  p=permits[token];key=(p['binding']['client'],p['binding']['provider']);a=e['action']
  if a=='GRANTED':pending[key].add(token)
  elif a in ['SEND_ALLOWED','HOLD_EXPIRED']:pending[key].discard(token)
  elif a=='AUTHORIZATION_EXPIRED':controls['unused_authorization_expiries' if p['consumed_tick'] is None else 'paid_authorization_expiries']+=1
  elif a=='SEND_EXPIRED':controls['expired_client_send_attempts']+=1
  controls['peak_pending_wallet_provider']=max(controls['peak_pending_wallet_provider'],len(pending[key]))
 wallets={}
 for j in w['jobs']:
  if j['intention']['attack_fixture']:continue
  client=j['binding']['client'];wallets.setdefault(client,dict(wallet=client,intended=0,paid=0,started=0,acknowledged=0));v=wallets[client];v['intended']+=1;v['paid']+=j['sent'];v['started']+=j['started_tick'] is not None;v['acknowledged']+=j['acknowledged']
 assert [wallets[k] for k in sorted(wallets)]==d['wallets'];controls['ordinary_wallets_with_demand']=len(wallets);controls['ordinary_wallets_acknowledged']=sum(w['acknowledged']>0 for w in wallets.values());controls['minimum_acknowledged_per_demanded_wallet']=min((w['acknowledged'] for w in wallets.values()),default=0)
 assert all(controls[k]==v for k,v in d['controls'].items())
 if d['policy']!='EVIDENCE_HOLD':assert controls['peak_pending_wallet_provider']<=1
 result.update(rule_decisions=len(d['decisions']));return result
if __name__=='__main__':
 if len(sys.argv)!=2:raise SystemExit('usage: reservation_audit.py REPORT.json')
 p=Path(sys.argv[1]);assert p.is_file() and not p.is_symlink() and p.stat().st_size<=128*1024*1024;d=json.loads(p.read_text())
 if d.get('model')=='zoora-reservation-run/0.1.0':result=inspect_run(d)
 elif d.get('model')=='zoora-reservation-campaign/0.1.0':inspect_campaign(d);result={'runs':len(d['runs'])}
 else:raise SystemExit('Unsupported reservation model')
 print(json.dumps({'classification':'SYNTHETIC','verified':result,'native_replay_also_required':True,'external_authentication':False}))
