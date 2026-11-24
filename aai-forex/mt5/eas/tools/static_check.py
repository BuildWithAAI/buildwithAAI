#!/usr/bin/env python3
"""Dependency-free lexical/policy checks. NOT an MQL5 compiler or correctness proof."""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
errors = []
checks = 0

def check(condition, message):
    global checks
    checks += 1
    if not condition:
        errors.append(message)

def strip_literals_comments(text):
    # Preserve newlines/positions and check unterminated comments/strings as well as balance.
    out=[];i=0;state='code'
    while i<len(text):
        c=text[i];n=text[i+1:i+2]
        if state=='code':
            if c=='/' and n=='/':out.extend('  ');i+=2;state='line';continue
            if c=='/' and n=='*':out.extend('  ');i+=2;state='block';continue
            if c in ('"', "'"):state=c;out.append(' ')
            else:out.append(c)
        elif state=='line':
            out.append('\n' if c=='\n' else ' ')
            if c=='\n':state='code'
        elif state=='block':
            if c=='*' and n=='/':out.extend('  ');i+=2;state='code';continue
            out.append('\n' if c=='\n' else ' ')
        else:
            if c=='\\':out.extend('  ');i+=2;continue
            out.append('\n' if c=='\n' else ' ')
            if c==state:state='code'
        i+=1
    check(state in ('code','line'), 'Unterminated literal/comment')
    return ''.join(out)

def check_delimiters(code, path):
    stack=[];pairs={')':'(',']':'[','}':'{'}
    for i,c in enumerate(code):
        if c in '([{':stack.append((c,i))
        elif c in ')]}':
            if not stack or stack[-1][0]!=pairs[c]:
                check(False, f'{path}: mismatched {c} near offset {i}');return
            stack.pop()
    check(not stack, f'{path}: unclosed delimiters {stack}')

experts=sorted((ROOT/'Experts/AAI').glob('*.mq5'))
includes=sorted((ROOT/'Include/AAI').glob('*.mqh'))
check(len(experts)==25,'Expected exactly 25 EAs')
check(len(includes)>=1,'Missing shared include')
common=(ROOT/'Include/AAI/AAI_Common.mqh').read_text()
cc=strip_literals_comments(common)
magics=[];signal_hashes=[]
manifest=json.loads((ROOT/'strategy_manifest.json').read_text())
check(len(manifest)==25,'Manifest must contain 25 strategies')
for path in experts+includes:
    text=path.read_text();code=strip_literals_comments(text)
    check_delimiters(code,path.name)
    for pattern in (r'\bWebRequest\s*\(',r'^\s*#import\b',r'\b(?:ShellExecute|WinExec|OrderSend|OrderSendAsync)\s*\(',r'\b(?:lot|lots|volume)\s*\*?=\s*[^;\n]*\*\s*(?:2(?:\.0)?|Multiplier)\b'):
        check(not re.search(pattern,code,re.M|re.I),f'{path.name}: forbidden call/lot-growth pattern {pattern}')
    check(not re.search(r'\bbar\s*\[\s*0\s*\]',code),f'{path.name}: current unfinished signal bar used')
    if path.suffix=='.mq5':
        for fn in ('OnInit','OnTick','OnDeinit','StrategySignal','StrategyReady','StrategyExit'):
            check(bool(re.search(r'\b'+fn+r'\s*\(',code)),f'{path.name}: missing {fn}')
        check('#include <AAI/AAI_Common.mqh>' in text,f'{path.name}: missing common include')
        check('#property strict' in text,f'{path.name}: missing strict property')
        check(bool(re.search(r'/\*.*?Rationale:.*?Failure modes:.*?\*/',text,re.S)),f'{path.name}: header rationale/failure missing')
        magic=re.search(r'#define\s+AAI_MAGIC\s+(\d+)',text)
        check(magic is not None,f'{path.name}: magic missing')
        if magic:magics.append(int(magic.group(1)))
        for fn in ('CommonInit','DailyOK','AuditPosition','TimedManagement','NewBar','Enter','CommonDeinit'):
            check(fn+'(' in code,f'{path.name}: common safety function missing: {fn}')
        # Entry orders are centralized, never sent independently in a strategy.
        check(not re.search(r'\.(?:Buy|Sell|PositionOpen)\s*\(',code),f'{path.name}: bypasses common entry')
        # Each generated source must match its manifest hypothesis, name and number.
        row=next((s for s in manifest if s['filename']==path.name),None)
        check(row is not None,f'{path.name}: missing manifest row')
        if row:
            check(row['magic']==int(magic.group(1)),f'{path.name}: manifest magic mismatch')
        sig=code.split('int StrategySignal(',1)[1].split('bool StrategyExit(',1)[0]
        signal_hashes.append(hashlib.sha256(re.sub(r'\s+','',sig).encode()).hexdigest())
        own_inputs=re.findall(r'^input\s+(?!group\b)\w+\s+(\w+)\s*=',code,re.M)
        common_inputs=re.findall(r'^input\s+(?!group\b)\w+\s+(\w+)\s*=',cc,re.M)
        check(len(own_inputs+common_inputs)==len(set(own_inputs+common_inputs)),f'{path.name}: duplicate inputs')
check(len(magics)==len(set(magics))==25,'Magic numbers must be unique')
check(len(signal_hashes)==len(set(signal_hashes))==25,'Exact duplicate strategy signals')
for token in ('RiskPercent=1.0','MaxRiskPercent=2.0','FixedLot=0.0','MaxRiskPercent>2.0',
              'SYMBOL_TRADE_TICK_VALUE_LOSS','SYMBOL_TRADE_TICK_SIZE','SYMBOL_VOLUME_MIN',
              'SYMBOL_VOLUME_STEP','SYMBOL_VOLUME_MAX','SYMBOL_TRADE_STOPS_LEVEL',
              'SYMBOL_TRADE_FREEZE_LEVEL','MaxSpreadPoints','ServerGMTOffsetMinutes',
              'DailyLossLimitPercent','MaxTradesPerDay','OrderCalcProfit','OrderCalcMargin',
              'SetExpertMagicNumber','SetTypeFillingBySymbol','SetAsyncMode(false)',
              'ResultRetcode','ArraySetAsSeries','CopyBuffer','IndicatorRelease',
              'MathFloor','MQL_TESTER','DEAL_ORDER','DEAL_COMMISSION','DEAL_FEE',
              'ACCOUNT_MARGIN_MODE_RETAIL_HEDGING'):
    check(token in cc,f'Common safety/API token absent: {token}')
check('aai_trade.Buy(lots,_Symbol,0,sl,tp' in cc,'Buy must attach SL and TP arguments')
check('aai_trade.Sell(lots,_Symbol,0,sl,tp' in cc,'Sell must attach SL and TP arguments')
check('lots*loss>cap' in cc,'Missing risk cap veto')
check('if(!MQLInfoInteger(MQL_TESTER))' in cc,'Missing hard outside-tester execution lock')
check('SignalTF==PERIOD_H1' in experts[2].read_text(),'Sniper must enforce H1')
road=(ROOT/'ROADMAP.md').read_text()
road_ids=[int(x) for x in re.findall(r'^(\d{3})\.',road,re.M)]
check(road_ids==list(range(26,101)),'Roadmap must contain exactly ideas 026–100')
for name in ('STRATEGY_CATALOG.md','ROADMAP.md','BACKTESTING_GUIDE.md','TRIAL_LOG_TEMPLATE.csv'):
    check((ROOT/name).stat().st_size>100,f'Deliverable missing/empty: {name}')
report={'status':'PASS' if not errors else 'FAIL','checks':checks,'experts':len(experts),
        'includes':len(includes),'roadmap_ideas':len(road_ids),'unique_magics':len(set(magics)),
        'errors':errors,'scope':'Lexical/policy tokens only: not MQL5 compilation, runtime testing, or profitability validation.'}
(ROOT/'STATIC_CHECK_RESULTS.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
raise SystemExit(1 if errors else 0)
