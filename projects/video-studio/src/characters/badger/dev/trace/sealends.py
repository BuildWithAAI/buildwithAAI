"""Round 5 (R4 review, seal check): a part's fill is ONE closed spline through its traced points, while each stroke is an
OPEN spline through a run of the same points. Where a stroke ends but the fill runs on, the closed spline's tangent at
that point is blended with the next fill point, so between the stroke's last two points the fill bulged up to 2 units past
the line: an unoutlined coat edge beside the stroke (the front view's hind-leg strip, the back view's tail root, the 3/4
belly corner, the right rig's neck). seal_ends() flags every stroke end that is a fill point as a corner ('c') in the fill,
so the fill takes the stroke's own end tangent there and its edge runs exactly along the line. A point some stroke passes
THROUGH is left smooth, and points already flagged keep their flag."""


def _key(p):
    return (round(float(p[0]), 4), round(float(p[1]), 4))


def seal_ends(fill, strokes):
    ends, inner = set(), set()
    for s in strokes:
        s = [p for p in s]
        if len(s) < 2:
            continue
        ends.add(_key(s[0]))
        ends.add(_key(s[-1]))
        for p in s[1:-1]:
            inner.add(_key(p))
    out = []
    for p in fill:
        k = _key(p)
        if k in ends and k not in inner and not (len(p) > 2 and p[2] == 'c'):
            out.append((p[0], p[1], 'c'))
        else:
            out.append(p)
    return out
