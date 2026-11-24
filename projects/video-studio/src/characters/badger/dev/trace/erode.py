"""Inset ("erode") a traced leg segment by half an outline width, for the stroke-under-fill leg construction.

parts/Leg.tsx draws every exterior stroke of a leg at TWICE the outline width first and the segment fills on top, so the
fills hide every interior seam and the visible outline is one continuous silhouette. That outline lies entirely OUTSIDE
the fill edge, so the fills and strokes are moved inward by LINE.width / 2 here: the visible outline then covers exactly
the band the old centred stroke covered (traced edge +- LINE.width / 2) and the leg keeps its traced width.

Only the EXTERIOR parts of a fill boundary (the parts that coincide with one of the part's open strokes) move inward.
Cut lines between segments and edges hidden inside the body stay where they are, so parent and child still meet on the
same cut. Bezier segments are offset with the Tiller-Hanson construction (end points and their handles move along the
end normals; joins use the mitre point), which is accurate for an offset of 1.75 units on these curves.
"""
import math
import re

TOK = re.compile(r'[MLCZ]|-?\d*\.?\d+(?:e-?\d+)?')


def parse(d):
    """Absolute M/L/C/Z path -> list of subpaths {'start': p, 'segs': [(cmd, [points])], 'closed': bool}."""
    toks = TOK.findall(d)
    subs = []
    i = 0
    cmd = None
    cur = None
    while i < len(toks):
        t = toks[i]
        if t in 'MLCZ':
            cmd = t
            i += 1
            if cmd == 'Z':
                cur['closed'] = True
            continue
        if cmd == 'M':
            cur = {'start': (float(toks[i]), float(toks[i + 1])), 'segs': [], 'closed': False}
            subs.append(cur)
            i += 2
            cmd = 'L'
        elif cmd == 'L':
            cur['segs'].append(('L', [(float(toks[i]), float(toks[i + 1]))]))
            i += 2
        elif cmd == 'C':
            v = [float(x) for x in toks[i:i + 6]]
            cur['segs'].append(('C', [(v[0], v[1]), (v[2], v[3]), (v[4], v[5])]))
            i += 6
        else:
            raise ValueError('unsupported path: ' + d)
    return subs


def fmt(v):
    s = '%.2f' % v
    s = s.rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s


def emit(sub):
    out = ['M %s %s' % (fmt(sub['start'][0]), fmt(sub['start'][1]))]
    for c, ps in sub['segs']:
        out.append(c + ' ' + ' '.join('%s %s' % (fmt(p[0]), fmt(p[1])) for p in ps))
    if sub['closed']:
        out.append('Z')
    return ' '.join(out)


def bez(p0, c1, c2, p3, t):
    u = 1 - t
    return (u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0],
            u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1])


def seg_points(p0, seg, n=12):
    c, ps = seg
    if c == 'L':
        return [(p0[0] + (ps[0][0] - p0[0]) * k / n, p0[1] + (ps[0][1] - p0[1]) * k / n) for k in range(n + 1)]
    return [bez(p0, ps[0], ps[1], ps[2], k / n) for k in range(n + 1)]


def sample(d, n=12):
    out = []
    for sub in parse(d):
        p0 = sub['start']
        segs = list(sub['segs'])
        if sub['closed'] and (abs(segs[-1][1][-1][0] - p0[0]) > 1e-6 or abs(segs[-1][1][-1][1] - p0[1]) > 1e-6):
            segs.append(('L', [p0]))
        for s in segs:
            out.extend(seg_points(p0, s, n))
            p0 = s[1][-1]
    return out


def inside(pt, poly):
    x, y = pt
    c = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi:
            c = not c
        j = i
    return c


def unit(v):
    L = math.hypot(v[0], v[1])
    return (v[0] / L, v[1] / L) if L > 1e-9 else (0.0, 0.0)


def tangents(p0, seg):
    """Unit tangents at the start and end of a segment."""
    c, ps = seg
    if c == 'L':
        t = unit((ps[0][0] - p0[0], ps[0][1] - p0[1]))
        return t, t
    c1, c2, p3 = ps
    t0 = unit((c1[0] - p0[0], c1[1] - p0[1]))
    if t0 == (0.0, 0.0):
        t0 = unit((c2[0] - p0[0], c2[1] - p0[1]))
    t1 = unit((p3[0] - c2[0], p3[1] - c2[1]))
    if t1 == (0.0, 0.0):
        t1 = unit((p3[0] - c1[0], p3[1] - c1[1]))
    return t0, t1


def inward(p, t, poly):
    """Of the two normals of tangent t at p, the one pointing into the fill polygon."""
    n = (-t[1], t[0])
    for k in (1.0, 2.0, 0.5):
        a = (p[0] + n[0] * k, p[1] + n[1] * k)
        b = (p[0] - n[0] * k, p[1] - n[1] * k)
        ia, ib = inside(a, poly), inside(b, poly)
        if ia != ib:
            return n if ia else (-n[0], -n[1])
    return n


def mitre(n1, n2, dist):
    dot = n1[0] * n2[0] + n1[1] * n2[1]
    if 1 + dot < 0.3:
        m = unit((n1[0] + n2[0], n1[1] + n2[1]))
        return (m[0] * dist, m[1] * dist)
    return ((n1[0] + n2[0]) / (1 + dot) * dist, (n1[1] + n2[1]) / (1 + dot) * dist)


def _offset_sub(sub, exterior, poly, dist):
    """Offset the exterior segments of one subpath inward by dist; move the neighbours' shared anchors with them."""
    segs = sub['segs']
    n = len(segs)
    starts = [sub['start']] + [s[1][-1] for s in segs[:-1]]
    norms = []
    for k, s in enumerate(segs):
        if not exterior[k]:
            norms.append(None)
            continue
        t0, t1 = tangents(starts[k], s)
        mid = seg_points(starts[k], s, 2)[1]
        tm = unit((t0[0] + t1[0], t1[1] + t0[1]))
        side = inward(mid, tm, poly)
        # both end normals on the same side as the mid normal
        def oriented(t):
            nn = (-t[1], t[0])
            return nn if nn[0] * side[0] + nn[1] * side[1] >= 0 else (-nn[0], -nn[1])
        end = s[1][-1]
        chord = math.hypot(end[0] - starts[k][0], end[1] - starts[k][1])
        if chord < 4 * dist:
            # a short (often sharply curved) segment would loop under a Tiller-Hanson offset: move it rigidly
            norms.append((side, side))
        else:
            norms.append((oriented(t0), oriented(t1)))
    closed = sub['closed'] and abs(segs[-1][1][-1][0] - sub['start'][0]) < 1e-6 and abs(segs[-1][1][-1][1] - sub['start'][1]) < 1e-6
    # anchor k = start of segment k (k = 0..n-1); anchor n = end of the last segment
    def along_cut(nrm, cut_t):
        """Slide a corner along the (unmoved) cut line until it is `dist` inside the exterior edge."""
        c = cut_t[0] * nrm[0] + cut_t[1] * nrm[1]
        if c < 0.33:
            return (nrm[0] * dist, nrm[1] * dist)
        a = dist / c
        return (cut_t[0] * a, cut_t[1] * a)
    disp = []
    for k in range(n + 1):
        prev = k - 1 if k > 0 else (n - 1 if closed else None)
        nxt = k if k < n else (0 if closed else None)
        a = norms[prev][1] if prev is not None and norms[prev] else None
        b = norms[nxt][0] if nxt is not None and norms[nxt] else None
        if a and b:
            disp.append(mitre(a, b, dist))
        elif a and nxt is not None:
            t0, _ = tangents(starts[nxt], segs[nxt])  # the following segment is a cut: slide along it
            disp.append(along_cut(a, t0))
        elif b and prev is not None:
            _, t1 = tangents(starts[prev], segs[prev])  # the preceding segment is a cut: slide back along it
            disp.append(along_cut(b, (-t1[0], -t1[1])))
        elif a:
            disp.append((a[0] * dist, a[1] * dist))
        elif b:
            disp.append((b[0] * dist, b[1] * dist))
        else:
            disp.append((0.0, 0.0))
    if closed:
        disp[n] = disp[0]
    # Round-2 repair (D35): a corner between two cut segments stays put, so when its neighbour on a SHORT cut (a tracing
    # nub at the bottom of a pastern or the top of a paw) slides along that cut past it, the fill grew a tiny ear outside the
    # eroded edge (it notched the outline at every wrist / hock / pastern). Such a corner now moves with that neighbour.
    seg_len = lambda k: math.hypot(segs[k][1][-1][0] - starts[k][0], segs[k][1][-1][1] - starts[k][1])
    for _ in range(2):
        for k in range(n + 1):
            if disp[k] != (0.0, 0.0):
                continue
            cands = []
            if k > 0 and not norms[k - 1] and seg_len(k - 1) < 3.0 and disp[k - 1] != (0.0, 0.0):
                cands.append(disp[k - 1])
            if k < n and not norms[k] and seg_len(k) < 3.0 and disp[k + 1] != (0.0, 0.0):
                cands.append(disp[k + 1])
            if k == 0 and closed and not norms[n - 1] and seg_len(n - 1) < 3.0 and disp[n - 1] != (0.0, 0.0):
                cands.append(disp[n - 1])
            if cands:
                disp[k] = cands[0]
        if closed:
            disp[n] = disp[0]
    mv = lambda p, d: (p[0] + d[0], p[1] + d[1])
    out = {'start': mv(sub['start'], disp[0]), 'segs': [], 'closed': sub['closed']}
    for k, (c, ps) in enumerate(segs):
        d0, d1 = disp[k], disp[k + 1]
        if c == 'L':
            out['segs'].append(('L', [mv(ps[0], d1)]))
        elif norms[k]:
            n0, n1 = norms[k]
            out['segs'].append(('C', [mv(ps[0], (n0[0] * dist, n0[1] * dist)), mv(ps[1], (n1[0] * dist, n1[1] * dist)), mv(ps[2], d1)]))
        else:
            out['segs'].append(('C', [mv(ps[0], d0), mv(ps[1], d1), mv(ps[2], d1)]))
    return out


def near_any(p, pts, tol):
    return any(math.hypot(p[0] - q[0], p[1] - q[1]) < tol for q in pts)


def split_seg(p0, seg, t):
    c, ps = seg
    lerp = lambda a, b: (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
    if c == 'L':
        m = lerp(p0, ps[0])
        return ('L', [m]), ('L', [ps[0]])
    c1, c2, p3 = ps
    a, b, cc = lerp(p0, c1), lerp(c1, c2), lerp(c2, p3)
    d, e = lerp(a, b), lerp(b, cc)
    m = lerp(d, e)
    return ('C', [a, d, m]), ('C', [e, cc, p3])


def closest_t(p0, seg, q, n=240):
    best = (1e9, 0.0)
    for k in range(n + 1):
        t = k / n
        pt = seg_points(p0, seg, n)[k] if False else (bez(p0, *seg[1], t) if seg[0] == 'C' else (p0[0] + (seg[1][0][0] - p0[0]) * t, p0[1] + (seg[1][0][1] - p0[1]) * t))
        d = math.hypot(pt[0] - q[0], pt[1] - q[1])
        if d < best[0]:
            best = (d, t)
    return best


def erode_part(fill, strokes, dist, tol=0.8):
    """(fill, strokes) of one leg segment -> the same shapes inset by dist. Details (toe lines) are left alone."""
    poly = sample(fill)
    spts = [q for s in strokes for q in sample(s, 24)]
    sub = parse(fill)[0]
    # make an implicit closing segment explicit, so the corner it forms is handled like any other cut corner
    last = sub['segs'][-1][1][-1]
    if sub['closed'] and math.hypot(last[0] - sub['start'][0], last[1] - sub['start'][1]) > 1e-6:
        sub['segs'].append(('L', [sub['start']]))
    # split fill segments where a stroke starts or ends part-way along them, so the exterior part is its own segment
    for st in strokes:
        ss = parse(st)[0]
        for q in (ss['start'], ss['segs'][-1][1][-1]):
            starts = [sub['start']] + [x[1][-1] for x in sub['segs'][:-1]]
            best = (1e9, None, 0.0)
            for k, sg in enumerate(sub['segs']):
                d, t = closest_t(starts[k], sg, q)
                if d < best[0]:
                    best = (d, k, t)
            d, k, t = best
            if k is not None and d < 0.6 and 0.03 < t < 0.97:
                a, b = split_seg(starts[k], sub['segs'][k], t)
                sub['segs'][k:k + 1] = [a, b]
    starts = [sub['start']] + [s[1][-1] for s in sub['segs'][:-1]]
    exterior = []
    for k, s in enumerate(sub['segs']):
        pts = seg_points(starts[k], s, 4)[1:-1]
        end = s[1][-1]
        # a short straight nub next to a stroke end lies within `tol` of that end and used to count as exterior; it is a
        # cut (round-2 repair, D35: treating it as an edge pushed the corner after it up and left an ear outside the edge)
        nub = s[0] == 'L' and math.hypot(end[0] - starts[k][0], end[1] - starts[k][1]) < 3.0
        exterior.append(not nub and all(near_any(p, spts, tol) for p in pts))
    moved = _offset_sub(sub, exterior, poly, dist)
    new_fill = emit(moved)
    anchors = [(starts[k], (moved['segs'][k - 1][1][-1] if k else moved['start'])) for k in range(len(starts))]
    new_strokes = []
    for s in strokes:
        ss = parse(s)[0]
        st = _offset_sub(ss, [True] * len(ss['segs']), poly, dist)
        # an open stroke ending on a fill corner takes that corner's displacement, so stroke and fill stay together
        ends = [(ss['start'], 'start'), (ss['segs'][-1][1][-1], 'end')]
        for (p, which) in ends:
            for (orig, new) in anchors:
                if math.hypot(p[0] - orig[0], p[1] - orig[1]) < 0.3:
                    d = (new[0] - orig[0], new[1] - orig[1])
                    if which == 'start':
                        old_start = st['start']
                        st['start'] = (p[0] + d[0], p[1] + d[1])
                        c, ps = st['segs'][0]
                        if c == 'C':
                            shift = (st['start'][0] - old_start[0], st['start'][1] - old_start[1])
                            st['segs'][0] = ('C', [(ps[0][0] + shift[0], ps[0][1] + shift[1]), ps[1], ps[2]])
                    else:
                        c, ps = st['segs'][-1]
                        old_end = ps[-1]
                        nend = (p[0] + d[0], p[1] + d[1])
                        shift = (nend[0] - old_end[0], nend[1] - old_end[1])
                        if c == 'C':
                            st['segs'][-1] = ('C', [ps[0], (ps[1][0] + shift[0], ps[1][1] + shift[1]), nend])
                        else:
                            st['segs'][-1] = ('L', [nend])
                    break
        new_strokes.append(emit(st))
    return new_fill, new_strokes


def erode_seg(seg, dist):
    """A rig segment dict {'fill', 'strokes', 'details'[, 'underlay']} (part-local world units) inset by dist.

    'underlay' (optional): exterior outline pieces that stay hidden inside the torso at rest (the top of a thigh). They are
    eroded with the strokes, so the fill edge under them moves inward too, and parts/Leg.tsx draws them in a pass UNDER the
    torso: wherever a rotating leg pushes that edge outside the body it is outlined, and inside the body the torso hides it.
    """
    under = list(seg.get('underlay', []))
    f, s = erode_part(seg['fill'], list(seg['strokes']) + under, dist)
    out = {'fill': f, 'strokes': s[:len(seg['strokes'])], 'details': seg['details']}
    if under:
        out['underlay'] = s[len(seg['strokes']):]
    return out
