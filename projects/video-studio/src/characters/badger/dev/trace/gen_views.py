"""Generate BADGER's FRONT, BACK and THREE-QUARTER body views (world units) from traces over the turnaround
crops (reference/crops/badger_turn_front.png, badger_turn_back.png, badger_turn_34.png; 2x the sheet).

All three turnaround crops share one scale. It is set by the turnaround side view, whose withers (329 px
above the ground line at y=484) must equal the binding withers height 312.6 (size panel, decision D01):
    s = 312.6 / 329 = 0.950 units per crop px,  ground (y=484) -> 0,  x origin = centre of the footprint.
The replaceable heads keep their own (size-panel) size in every view (decision V-HEAD-SIZE).

Each view is a list of parts in draw order. Paths are in VIEW-ROOT world space (origin = ground contact point);
animated groups (neck, tail, torso breathing) rotate/scale about pivots that are also in root space.
Markings: front/3-4 use the coat-map ids as seen from that side (R- right, L- left) plus the front-only midline
chest spot M-CHEST; the back keeps the top-coat-map identities (T- ids with sameAs) at the size and place the turnaround
back draws them, plus the leg spots seen from behind. Nothing is mirrored from another view.
"""
import json
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
from pathmap import map_path
from spline import spline, blob

HERE = os.path.dirname(__file__)
S = 312.6 / 329.0
GROUND = 484


def load(name):
    return json.load(open(os.path.join(HERE, 'traces', name)))


def P(view_cx):
    def f(x, y):
        return ((x - view_cx) * S, (y - GROUND) * S)
    return f


def pts(T, name, ymin=None, ymax=None):
    out = []
    for p in T[name]:
        if ymin is not None and p[1] < ymin:
            continue
        if ymax is not None and p[1] > ymax:
            continue
        out.append(tuple(p))
    return out


def rev(a):
    return list(reversed(a))


def straight_past(points, y0, y1, ys):
    """Replace the traced points strictly between y0 and y1 by points on the straight line joining the points at y0
    and y1. Used where a trace followed the edge of a spot that touches the outline: the sheet's contour runs straight
    past the spot (the spot stays inside the fill clip)."""
    a = next(p for p in points if p[1] == y0)
    b = next(p for p in points if p[1] == y1)
    out = []
    for p in points:
        if y0 < p[1] < y1:
            continue
        out.append(p)
        if p is a:
            out.extend((round(a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]), 1), y) for y in ys)
    return out


def refit_x_of_y(points, n=6, pin_first=True, pin_last=True):
    """Round 3 (R2 final review minor): a near-vertical traced edge refitted as x = cubic(y) by least squares and resampled
    at n points evenly in y, so the spline through them has no tracing wobble (S-bends, notches, foot hooks). The ends that
    meet other contours keep their traced positions (pin_first / pin_last)."""
    P = [(float(p[0]), float(p[1])) for p in points]
    ys = [p[1] for p in P]
    y0, y1 = min(ys), max(ys)
    m = (y0 + y1) / 2.0
    h = (y1 - y0) / 2.0 or 1.0
    # normal equations for x = a0 + a1 t + a2 t^2 + a3 t^3, t = (y - m) / h
    A = [[0.0] * 4 for _ in range(4)]
    b = [0.0] * 4
    for x, y in P:
        t = (y - m) / h
        v = [1.0, t, t * t, t * t * t]
        for i in range(4):
            b[i] += v[i] * x
            for j in range(4):
                A[i][j] += v[i] * v[j]
    for i in range(4):  # Gauss-Jordan
        piv = max(range(i, 4), key=lambda r: abs(A[r][i]))
        A[i], A[piv] = A[piv], A[i]
        b[i], b[piv] = b[piv], b[i]
        for r in range(4):
            if r != i:
                f = A[r][i] / A[i][i]
                for c in range(4):
                    A[r][c] -= f * A[i][c]
                b[r] -= f * b[i]
    a = [b[i] / A[i][i] for i in range(4)]
    fx = lambda y: a[0] + a[1] * ((y - m) / h) + a[2] * ((y - m) / h) ** 2 + a[3] * ((y - m) / h) ** 3
    first, last = P[0], P[-1]
    out = []
    for k in range(n):
        y = first[1] + (last[1] - first[1]) * k / (n - 1)
        out.append((round(fx(y), 2), round(y, 2)))
    if pin_first:
        d = first[0] - out[0][0]
        out = [(round(x + d * (1 - k / (n - 1)), 2), y) for k, (x, y) in enumerate(out)]
    if pin_last:
        d = last[0] - out[-1][0]
        out = [(round(x + d * (k / (n - 1)), 2), y) for k, (x, y) in enumerate(out)]
    return out


class View:
    def __init__(self, name, cx):
        self.name = name
        self.f = P(cx)
        self.parts = []
        self.spots = []
        self.pivots = {}

    def path(self, points, closed=False):
        return map_path(spline(points, closed=closed), self.f)

    def pt(self, x, y):
        X, Y = self.f(x, y)
        return {'x': round(X, 1), 'y': round(Y, 1)}

    def part(self, pid, fill, strokes, details=(), color='coat', group=None, z=None):
        self.parts.append({'id': pid, 'color': color, 'group': group,
                           'fill': self.path(fill, True),
                           'strokes': [self.path(s) for s in strokes],
                           'details': [self.path(d) for d in details]})

    def raw(self, pid, d, color, group=None, stroke=True, strokeWidth=None):
        """A part given as a ready path (collar band, tag) in crop px."""
        self.parts.append({'id': pid, 'color': color, 'group': group, 'fill': map_path(d, self.f),
                           'strokes': [map_path(d, self.f)] if stroke else [], 'details': [],
                           **({'strokeWidth': strokeWidth} if strokeWidth else {})})

    def spot(self, sid, side, part, shape, ref, crop, desc, same=None):
        d = self.path(blob(*shape), True) if isinstance(shape, tuple) else self.path(shape, True)
        rec = {'id': sid, 'side': side, 'part': part, 'path': d, 'ref': {'crop': crop, 'x': ref[0], 'y': ref[1]}, 'desc': desc}
        if same:
            rec['sameAs'] = same
        self.spots.append(rec)

    def pivot(self, name, x, y):
        self.pivots[name] = self.pt(x, y)


# =====================================================================================================  FRONT
F = load('front.json')
fv = View('front', 156)
CF = 'badger_turn_front.png'
# the far hind leg shows only as a narrow strip inside the screen-left gap between the front legs (single shadow
# tone); the rest of the gap is background, as on the sheet
# round-1 repair: the strip's line runs down into the inner contour of the leg in front of it (the trace ended in a
# U-hook that read as a stepped outline)
hl = pts(F, 'hind_line')[:-2] + [(134.5, 446)]
# round 3 (R2 review minor): the strip carried an S-wiggle at y 384-400 and a hook at its foot; refitted as one smooth
# curve (its traced top corner and its foot on the leg's inner contour are kept)
hl = hl[:2] + refit_x_of_y(hl[1:], n=6)[1:]
fv.part('hindBehind', [(134, 298, 'c'), (147, 301, 'c')] + hl[1:] + [(131, 446, 'c'), (131, 380)],
        [hl], color='coat')  # coat white, as the turnaround draws it
# round-1 repair: the outer forearm contours were traced round the inner edge of the forearm spots R-08 / L-09 (a
# V-notch with the spot bulging outside it); badger_turn_front.png runs the contour straight past each spot
outL = straight_past(pts(F, 'out_L'), 339, 362, (348, 355))
outR = straight_past(pts(F, 'out_R'), 339, 362, (348, 355))
oLt = [p for p in outL if p[1] <= 292]
oRt = [p for p in outR if p[1] <= 292]
fv.part('torso', [(113, 150, 'c')] + oLt + [(104, 300, 'c'), (137, 301)] + pts(F, 'brisket')[1:-1] + [(176, 300), (212, 300, 'c')] + rev(oRt) + [(203, 150, 'c')],
        [oLt, oRt, pts(F, 'brisket')], group='torso')
oLb = [p for p in outL if p[1] >= 280]
oRb = [p for p in outR if p[1] >= 280]
pawL = pts(F, 'paw_L')
pawR = pts(F, 'paw_R')
# round 3 (R2 review minor): the inner contours of both forelegs carried tracing S-bends and notches near the paws;
# badger_turn_front.png draws straight, smooth columns. Refitted (their ends at the brisket and the paws are kept).
inL = refit_x_of_y(pts(F, 'in_L'), n=6)
inR = refit_x_of_y(pts(F, 'in_R'), n=6)
fv.part('legFrontRight', oLb + pawL[1:] + rev(inL)[1:] + [(118, 276, 'c')], [oLb, pawL, inL],
        [[(104, 469), (103.5, 476), (103, 483)], [(119, 470), (118.5, 476), (118, 483)]])
fv.part('legFrontLeft', [(195, 276, 'c')] + inR + pawR[1:] + rev(oRb)[1:], [oRb, pawR, inR],
        [[(198, 470), (198, 476), (198, 483)], [(213, 470), (213, 476), (213, 483)]])
fv.spot('R-04', 'right', 'torso', (91.7, 231.4, 11.2, 5.2, -84.1), (92, 231), CF, 'right shoulder spot R-04 seen from the front (screen left, on the outline)')
fv.spot('L-03', 'left', 'torso', (217.3, 204.2, 7.0, 4.1, 80.6), (217, 204), CF, 'left shoulder spot L-03 seen from the front (screen right, on the outline)')
fv.spot('M-CHEST', 'midline', 'torso', (157.5, 236.8, 10.0, 6.0, -88.6), (158, 237), CF, 'midline chest spot below the tag (front only; side maps cannot show the midline)')
fv.spot('R-08', 'right', 'legFrontRight', (108.2, 353.1, 11.4, 7.3, -89.8), (108, 353), CF, 'right forearm spot R-08 seen from the front')
fv.spot('L-09', 'left', 'legFrontLeft', (206.4, 353.0, 11.2, 7.0, 89.1), (206, 353), CF, 'left forearm spot L-09 seen from the front')
# neck, collar and tag (front): traced on badger_turn_front.png
nL = pts(F, 'neck_L')
nR = pts(F, 'neck_R')
fv.part('neck', nL + [(116, 172, 'c'), (198, 172, 'c')] + rev(nR) + [(180, 92), (134, 92)], [nL, nR], group='neck')
col_top = [(114, 152), (124, 157.5), (132, 163.5), (140, 167.5), (148, 169.5), (156, 169.5), (164, 170.5), (172, 168.5), (180, 164.5), (188, 158.5), (198, 151)]
col_bot = [(196, 164.5), (188, 171.5), (180, 176.5), (172, 178.5), (164, 180), (156, 181), (148, 179.5), (140, 178.5), (132, 175.5), (124, 170.5), (114, 165)]
col = [(col_top[0][0], col_top[0][1], 'c')] + col_top[1:-1] + [(198, 151, 'c'), (200.5, 158), (col_bot[0][0], col_bot[0][1], 'c')] + col_bot[1:-1] + [(114, 165, 'c'), (111.5, 158.5)]
fv.part('collar', col, [col + [col[0]]], color='collar', group='neck')
cmid = [((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 1.5) for a, b in zip(col_top[1:-1], rev(col_bot[1:-1]))]
fv.part('collarShadow', cmid + col_bot[1:-1], [], color='collarShadow', group='neck')
ring = [(155.5, 182), (154.5, 186.5), (158.5, 189.5), (162.5, 186.5), (161.5, 182)]
fv.part('tagRing', ring, [ring + [ring[0]]], color='silver', group='tag')
tagp = blob(158.5, 197, 8.2, 9.0, 0)
fv.part('tag', tagp, [tagp + [tagp[0]]], color='tag', group='tag')
fv.part('tagShadow', [(162, 189.5), (166, 194), (166.5, 200), (162, 205.5, 'c'), (163.8, 199.5), (163.5, 193.5)], [], color='tagShadow', group='tag')
fv.spot('R-NECK', 'right', 'neck', (127.0, 141.0, 2.6, 7.0, 0), (127, 141), CF, 'right neck spot R-NECK seen from the front (screen left)')
fv.spot('L-NECK', 'left', 'neck', (187.0, 141.0, 2.6, 7.0, 0), (187, 141), CF, 'left neck spot L-NECK seen from the front (screen right)')
fv.pivot('neck', 157, 160)
fv.pivot('headCentroid', 157.4, 81.9)   # eyes+nose centroid of the sheet's front head
fv.pivot('tagAnchor', 158.5, 182)
fv.pivot('breath', 156, 190)

# =====================================================================================================  BACK
B = load('back.json')
bv = View('back', 130.5)
CB = 'badger_turn_back.png'
# head from behind (drawn first: it is the farthest part)
skull = pts(B, 'skull_top')
# round 3 (R2 review minor): the traced skull sides ended in a small hooked jog where they meet the neck (side_L ran down
# to (95, 107), back up to (99, 105) and down again; side_R turned a corner at (175, 108)); the panel draws one smooth
# concave curve from the skull side into the neck. The skull side now stops where the neck line takes over, along the
# same tangent, and the neck line runs from there to the collar.
sideL = pts(B, 'side_L')[:-2]
sideR = pts(B, 'side_R')[:-1] + [(177, 106)]
bv.part('headBack', skull + [(183, 45), (182, 58)] + sideR + [(137, 112, 'c')] + rev(sideL) + [(97, 60), (104, 44)],
        [skull, sideL, sideR], group='headBack')
earR = pts(B, 'earR')
bv.part('earRightBack', earR + [(176, 50), (178, 36)], [earR], [pts(B, 'earR_fold1'), pts(B, 'earR_fold2')], group='headBack')
bv.part('earLeftBack', pts(B, 'earL'), [pts(B, 'earL') + [pts(B, 'earL')[0]]], color='earCap', group='headBack')
nL = [(95, 107), (96.6, 113)] + pts(B, 'neck_L')[2:]
nR = [(177, 106), (175.6, 112)] + pts(B, 'neck_R')[1:]
bv.part('neckBack', [(100, 104, 'c'), (174, 104, 'c')] + nR + [(176, 150, 'c'), (98, 150, 'c')] + rev(nL), [nL, nR], group='neckBack')
bodyL = pts(B, 'body_L')
bodyR = pts(B, 'body_R')
bLt = [p for p in bodyL if p[1] <= 262]
bRt = [p for p in bodyR if p[1] <= 262]
bv.part('torso', [(98, 132, 'c')] + bLt + [(84, 300), (118, 334), (160, 342), (196, 300)] + rev(bRt) + [(176, 132, 'c'), (137, 126)],
        [bLt, bRt], [pts(B, 'inner_L'), pts(B, 'inner_R')], group='torso')
# the collar band sits in front of the top of the back
ct = pts(B, 'collar_top')
cb = pts(B, 'collar_bot')
bv.part('collarBack', ct + cb, [ct + cb + [ct[0]]], color='collar', group='neckBack')
mid = [((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 2) for a, b in zip(ct, rev(cb))]
bv.part('collarBackShadow', mid + cb[1:-1], [], color='collarShadow', group='neckBack')
bLb = [p for p in bodyL if p[1] >= 250]
bRb = [p for p in bodyR if p[1] >= 250]
pL = pts(B, 'paw_L')
pR = pts(B, 'paw_R')
lL = pts(B, 'legin_L')
lR = pts(B, 'legin_R')
# round 3 (R2 review minor): from behind only the heels show (badger_turn_back.png draws no toe splits on the hind paws)
bv.part('legHindLeft', bLb + pL[1:] + rev(lL)[1:] + [(108, 262, 'c')], [bLb, pL, lL])
bv.part('legHindRight', [(168, 262, 'c')] + lR + pR[1:] + rev(bRb)[1:], [bRb, pR, lR])
tl = pts(B, 'tail_L')
tr_ = pts(B, 'tail_R')
bv.part('tail', [(126, 255, 'c'), (155, 255, 'c')] + tr_ + rev(tl)[1:], [tl, tr_], group='tail')
bv.pivot('tailRoot', 140, 266)
bv.pivot('neck', 137, 145)
bv.pivot('breath', 137, 150)
# leg markings seen from behind (same physical markings as the side coat maps)
bv.spot('L-07', 'left', 'legHindLeft', (84.3, 271.8, 12.2, 5.3, -89.2), (84, 272), CB, 'back of the left thigh, L-07 seen from behind')
bv.spot('L-08', 'left', 'legHindLeft', (87.1, 387.3, 9.4, 6.3, -87.8), (87, 387), CB, 'left gaskin above the hock, L-08 seen from behind')
bv.spot('R-07', 'right', 'legHindRight', (189.2, 389.4, 8.3, 5.6, 81.5), (189, 389), CB, 'right gaskin above the hock, R-07 seen from behind')

# ---- back markings (decision BADGER-D20, revised 2026-11-24). Identity comes from the top coat map (T- ids name the side
# marking they continue, sameAs); size, shape and placement are traced from badger_turn_back.png, because an eye-level
# camera behind the dog sees the back as the turnaround draws it, not as a foreshortened projection of the top map (the
# projection shrank the spots to specks below the outline width). What the turnaround shows, and nothing else:
#   * T-PATCH = L-WITHERS: the domed crescent under the collar (85 x 23 units);
#   * T-05 = R-01 and T-08 = L-02: the two croup spots, seen from behind as the two large ovals (by height they match the
#     side maps' croup spots, 254 / 256 units, not the mid-back pair at 283 / 290 units);
#   * L-07, L-08, R-07 (above): back of the left thigh and both hocks.
# The other top-map spots (T-01 / T-02 on the spine, T-03 / T-06 = R-04 / L-03 on the shoulder edges, T-04 / T-07 =
# R-02 / L-01 on the mid back) lie on the receding dorsal surface and are hidden at eye level, as on the turnaround.
CT = 'badger_coat_top.png'
crescent = [(97.5, 172.5, 'c'), (100.5, 165), (106, 158), (115, 151), (124, 147), (133, 145), (141, 144.5), (151, 146),
            (160, 149), (169, 154), (178, 161), (184, 167), (188, 172, 'c'), (183, 175.5), (176, 171.5), (166, 168),
            (152, 168.5), (139, 169.5), (126, 167.5), (115, 166.5), (106, 168.5), (100.5, 172)]
bv.spot('T-PATCH', 'left', 'torso', crescent, (141, 158), CB,
        'large withers patch L-WITHERS seen from behind: the domed crescent under the collar (badger_turn_back.png); '
        'the top map (badger_coat_top.png) places it across the spine at the withers', same='L-WITHERS')
bv.spot('T-05', 'right', 'torso', (181.1, 208.4, 15.6, 8.6, 62.7), (181, 208), CB,
        'right croup spot R-01 seen from behind (screen right): the right oval of the turnaround back; top-map T-05', same='R-01')
bv.spot('T-08', 'left', 'torso', (100.7, 198.5, 14.1, 7.3, -50.9), (101, 199), CB,
        'left croup spot L-02 seen from behind (screen left): the left oval of the turnaround back; top-map T-08', same='L-02')

# =====================================================================================================  3/4
Q = load('threeQuarter.json')
qv = View('threeQuarter', 227.5)
CQ = 'badger_turn_34.png'
fhF = pts(Q, 'fh_front')
fhR = pts(Q, 'fh_rear')
pfh = pts(Q, 'paw_fh')
qv.part('legHindFar', [(190, 262, 'c')] + fhF + rev(pfh)[1:-1] + rev(fhR) + [(170, 280, 'c')], [fhF, pfh, fhR], color='coatShadow')
chest = pts(Q, 'chest')
chT = [p for p in chest if p[1] <= 302]
chB = [p for p in chest if p[1] >= 290]
ffi = pts(Q, 'ff_inner')
pff = pts(Q, 'paw_ff')
qv.part('legFrontFar', [(300, 278, 'c')] + ffi + pff[1:-1] + rev(chB) + [(330, 268, 'c')], [ffi, pff, chB],
        [[(335, 465), (335, 468), (335, 471)]])
tt = pts(Q, 'tail_top')
tb = pts(Q, 'tail_bot')
qv.part('tail', [(118, 250, 'c')] + tt + tb[1:] + [(116, 320), (118, 290)], [tt, tb], group='tail')
back = pts(Q, 'back')
thigh = pts(Q, 'thigh')
belly = pts(Q, 'belly')
bris = pts(Q, 'brisket')
qv.part('torso', [(262, 140, 'c')] + back + [p for p in thigh if p[1] <= 330][1:] + [(130, 330, 'c'), (160, 300)] + belly
        + [(258, 302), (275, 304)] + bris + rev(chT) + [(320, 176, 'c'), (285, 160)],
        [back, belly, bris, chT], group='torso')
nhF = pts(Q, 'nh_front')
pnh = pts(Q, 'paw_nh')
qv.part('legHindNear', [(138, 262, 'c')] + thigh + pnh[1:] + rev(nhF)[1:],
        [thigh, pnh, nhF], [[(115, 458), (115, 465), (115, 472)], [(127, 460), (127, 466), (127, 472)]])
nfR = pts(Q, 'nf_rear')
nfF = pts(Q, 'nf_front')
pnf = pts(Q, 'paw_nf')
qv.part('legFrontNear', [(262, 248, 'c')] + nfR + pnf[1:] + rev(nfF)[1:], [nfR, pnf, nfF],
        [[(264, 470), (264, 476), (264, 483)], [(280, 472), (280, 477), (280, 483)]])
nb = pts(Q, 'neck_back')
th = pts(Q, 'throat')
qv.part('neck', nb + [(262, 168, 'c'), (320, 196), (343, 186, 'c')] + rev(th) + [(330, 96), (296, 84)], [nb, th], group='neck')
col = pts(Q, 'collar')
qv.part('collar', col, [col + [col[0]]], color='collar', group='neck')
ctop = col[1:12]
cbot = col[14:25]
cmid = [((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 1) for a, b in zip(ctop, rev(cbot))]
qv.part('collarShadow', cmid + cbot[1:-1] + [(256, 154)], [], color='collarShadow', group='neck')
qv.part('tagRing', [(319, 186), (318, 191), (322, 194), (326, 191), (325, 186)], [[(319, 186), (318, 191), (322, 194), (326, 191), (325, 186)] + [(319, 186)]], color='silver', group='tag')
qv.part('tag', blob(322, 202, 7.4, 8.6, 0), [blob(322, 202, 7.4, 8.6, 0) + [blob(322, 202, 7.4, 8.6, 0)[0]]], color='tag', group='tag')
qv.part('tagShadow', [(325, 195), (329, 200), (329, 206), (324, 210.5, 'c'), (326.5, 205), (326.5, 199)], [], color='tagShadow', group='tag')
qv.pivot('tailRoot', 105, 262)
qv.pivot('headCentroid', 349.4, 78.3)   # eyes+nose centroid of the sheet's 3/4 head
qv.pivot('neck', 300, 175)
qv.pivot('tagAnchor', 322, 186)
qv.pivot('breath', 230, 160)
# markings: right side (R-) as the 3/4 shows the right flank, plus the front-visible chest and far-side forearm/shoulder
qv.spot('R-01', 'right', 'torso', (139.3, 188.7, 13.5, 8.0, -41.3), (139, 189), CQ, 'croup spot R-01')
qv.spot('R-02', 'right', 'torso', (165.0, 193.0, 9.5, 6.2, -12.0), (165, 193), CQ, 'mid-back spot R-02, just behind the withers patch (foreshortened by the turn)')
qv.spot('R-03', 'right', 'torso', (163.2, 226.0, 8.5, 6.5, 80.0), (163, 226), CQ, 'mid-flank spot R-03')
qv.spot('R-04', 'right', 'torso', (228.4, 233.8, 11.6, 6.6, -79.6), (228, 234), CQ, 'right shoulder spot R-04')
qv.spot('R-05', 'right', 'torso', (203.0, 256.0, 7.0, 5.0, -15.0), (203, 256), CQ, 'lower-ribs spot R-05 (not drawn on the 3/4 sheet; placed from coat_right)')
qv.spot('L-WITHERS', 'left', 'torso', [(181, 166, 'c'), (182, 176), (186, 186), (193, 194), (205, 198.5), (216, 196), (226, 186), (233, 172),
                                       (238, 158, 'c'), (225, 151), (205, 154), (190, 159)], (208, 176), CQ,
        'withers patch L-WITHERS on top of the back: the elevated 3/4 camera sees the dorsal surface where the patch straddles the spine (traced from badger_turn_34.png, decision BADGER-D16)')
qv.spot('M-CHEST', 'midline', 'torso', (323.0, 236.0, 9.0, 4.2, -88.0), (323, 236), CQ, 'midline chest spot, turned with the chest')
qv.spot('L-03', 'left', 'torso', (339.0, 180.5, 9.0, 5.5, -42.6), (337, 180), CQ, 'left shoulder spot L-03 at the far edge of the chest')
qv.spot('R-06', 'right', 'legHindNear', (151.0, 300.0, 9.5, 5.6, -69.0), (151, 300), CQ, 'front of the right thigh R-06 (placed from coat_right)')
qv.spot('R-07', 'right', 'legHindNear', (114.2, 375.9, 9.3, 4.6, -75.1), (114, 376), CQ, 'right gaskin above the hock R-07')
qv.spot('R-08', 'right', 'legFrontNear', (251.6, 353.4, 11.6, 6.2, 89.4), (252, 353), CQ, 'right forearm R-08')
qv.spot('L-09', 'left', 'legFrontFar', (329.4, 353.1, 12.2, 5.1, -82.5), (329, 353), CQ, 'left forearm L-09 on the far front leg (outer edge)')
qv.spot('R-NECK', 'right', 'neck', (284.0, 140.4, 7.3, 3.6, 86.9), (284, 140), CQ, 'right neck spot R-NECK')

out = {v.name: {'parts': v.parts, 'pivots': v.pivots} for v in (fv, bv, qv)}
spots = {v.name: v.spots for v in (fv, bv, qv)}
with open(sys.argv[1], 'w') as fh:
    fh.write('/**\n * FRONT, BACK and THREE-QUARTER body views of BADGER, world units (ZOO = 900). GENERATED by\n'
             ' * src/characters/badger/dev/trace/gen_views.py from traces over the turnaround crops. Edit the tracer.\n'
             ' * Paths are in view-root space (origin = ground contact point = centre of the footprint).\n */\n')
    fh.write('export const VIEW_RIGS = ' + json.dumps(out, indent='\t') + ' as const;\n')
blocks = [
    {'const': 'FRONT_SPOTS', 'doc': 'Markings of the FRONT view (badger_turn_front.png): side-map spots seen from the front plus the midline chest spot M-CHEST. View-root space.', 'spots': spots['front']},
    {'const': 'BACK_SPOTS', 'doc': ('Markings of the BACK view (badger_turn_back.png): the withers patch as the crescent under the collar (T-PATCH = L-WITHERS), '
                                    'the two croup spots (T-05 = R-01, T-08 = L-02) and the leg spots seen from behind. T- records name the side-map marking '
                                    'they continue (sameAs); the other top-map spots are hidden on the receding back at eye level (decision BADGER-D20). View-root space.'), 'spots': spots['back']},
    {'const': 'THREE_QUARTER_SPOTS', 'doc': 'Markings of the THREE-QUARTER view (badger_turn_34.png, right flank toward camera). View-root space.', 'spots': spots['threeQuarter']},
]
with open(sys.argv[2], 'w') as fh:
    json.dump(blocks, fh, indent=1)
print('views ok', {k: len(v) for k, v in spots.items()})
