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


def arc_path(cx, cy, rx, ry, a0, a1, move=False):
    """Elliptical arc from angle a0 to a1 (degrees, y-down space: 270 = top) as cubic segments of <= 45 deg.
    Returns ' C ...' pieces (or 'M .. C ..' when move=True) in the same space as the centre."""
    import math
    n = max(1, int(math.ceil(abs(a1 - a0) / 45.0)))
    out = []
    for i in range(n):
        t0 = math.radians(a0 + (a1 - a0) * i / n)
        t1 = math.radians(a0 + (a1 - a0) * (i + 1) / n)
        k = 4.0 / 3.0 * math.tan((t1 - t0) / 4.0)
        p0 = (cx + rx * math.cos(t0), cy + ry * math.sin(t0))
        p3 = (cx + rx * math.cos(t1), cy + ry * math.sin(t1))
        c1 = (p0[0] - k * rx * math.sin(t0), p0[1] + k * ry * math.cos(t0))
        c2 = (p3[0] + k * rx * math.sin(t1), p3[1] - k * ry * math.cos(t1))
        if i == 0 and move:
            out.append('M %.2f %.2f' % p0)
        out.append('C %.2f %.2f %.2f %.2f %.2f %.2f' % (c1 + c2 + p3))
    return ' '.join(out)
