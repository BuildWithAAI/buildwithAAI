"""Tiny SVG-path mapper: parse absolute M/L/C/S/Q/Z paths, map every coordinate pair, emit compact strings."""
import re

TOK = re.compile(r'[MLCSQTZmlcsqtz]|-?\d*\.?\d+(?:e-?\d+)?')


def fmt(v):
    s = ('%.1f' % v)
    if s.endswith('.0'):
        s = s[:-2]
    if s == '-0':
        s = '0'
    return s


def map_path(d, f):
    toks = TOK.findall(d)
    out = []
    i = 0
    cmd = None
    while i < len(toks):
        t = toks[i]
        if re.match(r'[A-Za-z]', t):
            cmd = t
            if cmd.islower():
                raise ValueError('relative commands not supported: ' + d)
            out.append(cmd)
            i += 1
            if cmd in 'Zz':
                continue
            continue
        # coordinate pair
        x = float(toks[i]); y = float(toks[i + 1]); i += 2
        X, Y = f(x, y)
        out.append(fmt(X) + ' ' + fmt(Y))
    return ' '.join(out)


def ellipse_path(cx, cy, rx, ry, rot_deg=0.0):
    """Ellipse as 4 cubic beziers (kappa), rotated; returns absolute path in the same space."""
    import math
    k = 0.5522847498
    a = math.radians(rot_deg)
    ca, sa = math.cos(a), math.sin(a)

    def P(x, y):
        return (cx + x * ca - y * sa, cy + x * sa + y * ca)
    pts = [
        ('M', [P(rx, 0)]),
        ('C', [P(rx, k * ry), P(k * rx, ry), P(0, ry)]),
        ('C', [P(-k * rx, ry), P(-rx, k * ry), P(-rx, 0)]),
        ('C', [P(-rx, -k * ry), P(-k * rx, -ry), P(0, -ry)]),
        ('C', [P(k * rx, -ry), P(rx, -k * ry), P(rx, 0)]),
    ]
    s = ''
    for c, ps in pts:
        s += c + ' ' + ', '.join('%.2f %.2f' % p for p in ps) + ' '
    return s + 'Z'
