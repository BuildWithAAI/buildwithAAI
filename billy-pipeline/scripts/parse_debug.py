"""Print parser output next to post text for manual review."""
import random, sys
sys.path.insert(0, 'src')
from billy.ingest.sources import JsonlFileSource
from billy.parse import parse_posts
posts = list(JsonlFileSource(sys.argv[1], 'cryptoWZRD_').iter_posts())
sigs = parse_posts(posts)
mode = sys.argv[2] if len(sys.argv) > 2 else 'sample'
random.seed(int(sys.argv[3]) if len(sys.argv) > 3 else 0)
sel = {'sample': lambda: random.sample(sigs, 25), 'unknown': lambda: [s for s in sigs if s.close_label == 'unknown'],
       'notrade': lambda: [s for s in sigs if s.parse_status == 'no_trade']}[mode]()
for s in sel:
    print('==', s.asset, s.post_ts.date(), s.close_label, s.parse_status, s.direction, s.trigger, s.targets, 'inv', s.invalidation, s.condition_type)
    print('  ', s.text.split('\n', 1)[-1].rsplit('https', 1)[0].strip())
    for sc in s.scenarios: print('    -', sc.side, sc.cond, sc.level, sc.target, sc.kind, 'X' if sc.explicit else '')
