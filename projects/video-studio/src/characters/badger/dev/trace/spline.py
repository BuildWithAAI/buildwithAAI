"""Smooth cubic-bezier paths through traced points (Bessel / chord-length Hermite tangents).

A point is (x, y) or (x, y, flag). flag 'c' = a corner: the incoming and outgoing tangents are split
(each points along its own chord), so the curve keeps a crisp join there. Used by the view tracers
(gen_right.py, gen_views.py) whose point lists were snapped to the centre line of the sheet outlines.
"""
import math


def _d(a, b):
    return math.hypot(b[0] - a[0], b[1] - a[1]) or 1e-6


def _tangents(P, closed):
    n = len(P)
    tin, tout = [None] * n, [None] * n
    for i in range(n):
        has_prev = closed or i > 0
        has_next = closed or i < n - 1
        a = P[(i - 1) % n] if has_prev else None
        c = P[(i + 1) % n] if has_next else None
        b = P[i]
        corner = len(b) > 2 and b[2] == 'c'
        if a is not None and c is not None and not corner:
            d0, d1 = _d(a, b), _d(b, c)
            u0 = ((b[0] - a[0]) / d0, (b[1] - a[1]) / d0)
            u1 = ((c[0] - b[0]) / d1, (c[1] - b[1]) / d1)
            t = ((u0[0] * d1 + u1[0] * d0) / (d0 + d1), (u0[1] * d1 + u1[1] * d0) / (d0 + d1))
            tin[i] = tout[i] = t
        else:
            if a is not None:
                d0 = _d(a, b)
                tin[i] = ((b[0] - a[0]) / d0, (b[1] - a[1]) / d0)
            if c is not None:
                d1 = _d(b, c)
                tout[i] = ((c[0] - b[0]) / d1, (c[1] - b[1]) / d1)
            if tin[i] is None:
                tin[i] = tout[i]
            if tout[i] is None:
                tout[i] = tin[i]
    return tin, tout


def f2(v):
    s = '%.1f' % v
    return s[:-2] if s.endswith('.0') else s


def spline(points, closed=False, tension=1.0):
    """Points in any space -> absolute 'M .. C ..' path string (Z when closed)."""
    P = [tuple(p) for p in points]
    n = len(P)
    tin, tout = _tangents(P, closed)
    out = ['M %s %s' % (f2(P[0][0]), f2(P[0][1]))]
    segs = n if closed else n - 1
    for i in range(segs):
        a, b = P[i], P[(i + 1) % n]
        L = _d(a, b) / 3 * tension
        c1 = (a[0] + tout[i][0] * L, a[1] + tout[i][1] * L)
        c2 = (b[0] - tin[(i + 1) % n][0] * L, b[1] - tin[(i + 1) % n][1] * L)
        out.append('C %s %s %s %s %s %s' % (f2(c1[0]), f2(c1[1]), f2(c2[0]), f2(c2[1]), f2(b[0]), f2(b[1])))
    if closed:
        out.append('Z')
    return ' '.join(out)


def blob(cx, cy, rx, ry, rot=0.0, wob=()):
    """Irregular spot outline: an ellipse with optional per-quadrant radius factors `wob` (8 values),
    returned as a closed point list for spline(..., closed=True)."""
    a = math.radians(rot)
    ca, sa = math.cos(a), math.sin(a)
    k = list(wob) + [1.0] * (8 - len(wob))
    pts = []
    for i in range(8):
        t = i * math.pi / 4
        x, y = rx * math.cos(t) * k[i], ry * math.sin(t) * k[i]
        pts.append((cx + x * ca - y * sa, cy + x * sa + y * ca))
    return pts


def arc_over(cx, cy, r, step=30):
    """Points of the upper half circle around a joint pivot, from its rear/left side (angle 180) over the top
    to the other side (angle 360), in y-down space. Used for round joint caps that stay hidden under the
    parent segment at rest and close the outline when the joint bends."""
    out = []
    a = 180
    while a <= 360 + 1e-6:
        t = math.radians(a)
        out.append((cx + r * math.cos(t), cy + r * math.sin(t)))
        a += step
    return out
