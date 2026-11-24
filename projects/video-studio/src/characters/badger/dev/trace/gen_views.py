"""Generate BADGER's FRONT, BACK and THREE-QUARTER body views (world units) from traces over the turnaround
crops (reference/crops/badger_turn_front.png, badger_turn_back.png, badger_turn_34.png; 2x the sheet).

All three turnaround crops share one scale. It is set by the turnaround side view, whose withers (329 px
above the ground line at y=484) must equal the binding withers height 312.6 (size panel, decision D01):
    s = 312.6 / 329 = 0.950 units per crop px,  ground (y=484) -> 0,  x origin = centre of the footprint.
The replaceable heads keep their own (size-panel) size in every view (decision V-HEAD-SIZE).

Each view is a list of parts in draw order. Paths are in VIEW-ROOT world space (origin = ground contact point);
animated groups (neck, tail, torso breathing) rotate/scale about pivots that are also in root space.
Markings: front/3-4 use the coat-map ids as seen from that side (R- right, L- left) plus the front-only midline
chest spot M-CHEST; the back uses the top coat map (T- ids, projected onto the back) plus the leg spots seen
from behind. Nothing is mirrored from another view.
"""
import json
import math
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
# far hind legs seen between the front legs (single shadow tone), drawn first
fv.part('hindBehind', [(131, 296, 'c'), (182, 296, 'c'), (183, 380), (184, 446, 'c'), (130, 446, 'c'), (129, 380)],
        [[(134, 446), (157, 448), (181, 446)]], [pts(F, 'hind_line')], color='coatShadow')
outL = pts(F, 'out_L')
outR = pts(F, 'out_R')
oLt = [p for p in outL if p[1] <= 292]
oRt = [p for p in outR if p[1] <= 292]
fv.part('torso', [(112, 150, 'c')] + oLt + [(104, 300, 'c'), (137, 301)] + pts(F, 'brisket')[1:-1] + [(176, 300), (212, 300, 'c')] + rev(oRt) + [(203, 150, 'c')],
        [oLt, oRt, pts(F, 'brisket')], group='torso')
oLb = [p for p in outL if p[1] >= 280]
oRb = [p for p in outR if p[1] >= 280]
pawL = pts(F, 'paw_L')
pawR = pts(F, 'paw_R')
inL = pts(F, 'in_L')
inR = pts(F, 'in_R')
fv.part('legFrontRight', oLb + pawL[1:] + rev(inL)[1:] + [(118, 276, 'c')], [oLb, pawL, inL],
        [[(104, 469), (103.5, 476), (103, 483)], [(119, 470), (118.5, 476), (118, 483)]])
fv.part('legFrontLeft', [(195, 276, 'c')] + inR + pawR[1:] + rev(oRb)[1:], [oRb, pawR, inR],
        [[(198, 470), (198, 476), (198, 483)], [(213, 470), (213, 476), (213, 483)]])
fv.spot('R-04', 'right', 'torso', (91.7, 231.4, 11.2, 5.2, -84.1), (92, 231), CF, 'right shoulder spot R-04 seen from the front (screen left, on the outline)')
fv.spot('L-03', 'left', 'torso', (217.3, 204.2, 7.0, 4.1, 80.6), (217, 204), CF, 'left shoulder spot L-03 seen from the front (screen right, on the outline)')
fv.spot('M-CHEST', 'midline', 'torso', (157.5, 236.8, 10.0, 6.0, -88.6), (158, 237), CF, 'midline chest spot below the tag (front only; side maps cannot show the midline)')
fv.spot('R-08', 'right', 'legFrontRight', (108.2, 353.1, 11.4, 7.3, -89.8), (108, 353), CF, 'right forearm spot R-08 seen from the front')
fv.spot('L-09', 'left', 'legFrontLeft', (206.4, 353.0, 11.2, 7.0, 89.1), (206, 353), CF, 'left forearm spot L-09 seen from the front')
fv.pivot('neckFront', 158, 168)          # where the front neck/collar bust (parts/Neck.tsx NeckFront) sits
fv.pivot('breath', 156, 190)

# =====================================================================================================  BACK
B = load('back.json')
bv = View('back', 130.5)
CB = 'badger_turn_back.png'
# head from behind (drawn first: it is the farthest part)
skull = pts(B, 'skull_top')
sideL = pts(B, 'side_L')
sideR = pts(B, 'side_R')
bv.part('headBack', skull + [(183, 45), (182, 58)] + sideR + [(137, 112, 'c')] + rev(sideL) + [(97, 60), (104, 44)],
        [skull, sideL, sideR], group='headBack')
earR = pts(B, 'earR')
bv.part('earRightBack', earR + [(176, 50), (178, 36)], [earR], [pts(B, 'earR_fold1'), pts(B, 'earR_fold2')], group='headBack')
bv.part('earLeftBack', pts(B, 'earL'), [pts(B, 'earL') + [pts(B, 'earL')[0]]], color='earCap', group='headBack')
nL = pts(B, 'neck_L')
nR = pts(B, 'neck_R')
bv.part('neckBack', [(100, 104, 'c'), (174, 104, 'c')] + nR + [(176, 150, 'c'), (98, 150, 'c')] + rev(nL), [nL, nR], group='neckBack')
ct = pts(B, 'collar_top')
cb = pts(B, 'collar_bot')
bv.part('collarBack', ct + cb, [ct + cb + [ct[0]]], color='collar', group='neckBack')
mid = [((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 2) for a, b in zip(ct, rev(cb))]
bv.part('collarBackShadow', mid + cb[1:-1], [], color='collarShadow', group='neckBack')
bodyL = pts(B, 'body_L')
bodyR = pts(B, 'body_R')
bLt = [p for p in bodyL if p[1] <= 262]
bRt = [p for p in bodyR if p[1] <= 262]
bv.part('torso', [(98, 132, 'c')] + bLt + [(84, 300), (118, 334), (160, 342), (196, 300)] + rev(bRt) + [(176, 132, 'c'), (137, 126)],
        [bLt, bRt], [pts(B, 'inner_L'), pts(B, 'inner_R')], group='torso')
bLb = [p for p in bodyL if p[1] >= 250]
bRb = [p for p in bodyR if p[1] >= 250]
pL = pts(B, 'paw_L')
pR = pts(B, 'paw_R')
lL = pts(B, 'legin_L')
lR = pts(B, 'legin_R')
bv.part('legHindLeft', bLb + pL[1:] + rev(lL)[1:] + [(108, 262, 'c')], [bLb, pL, lL],
        [[(62, 470), (62, 476), (62, 482)], [(78, 471), (78, 476), (78, 482)]])
bv.part('legHindRight', [(168, 262, 'c')] + lR + pR[1:] + rev(bRb)[1:], [bRb, pR, lR],
        [[(195, 471), (195, 476), (195, 482)]])
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

# ---- top coat map (badger_coat_top.png, "TT" px) projected onto the back.
# Orientation: the top map is a true dorsal view with the head at screen left, so its image TOP is the dog's
# anatomical RIGHT (decision T-ORIENT). Seen from behind, anatomical right is SCREEN RIGHT.
# Length axis (TT x, withers 195 .. tail root 505) -> back-view height (TB y): the back is foreshortened,
# the rear of the croup turns down toward the tail root. Width axis (TT y, spine 162) -> TB x around the spine.
SPINE_Y = 162.0
LEN_MAP = [(195, 142.0), (260, 156.0), (330, 172.0), (380, 184.0), (440, 202.0), (470, 222.0), (505, 262.0)]
HALF_W_TT = 54.0                      # top map half width (spine to the side outline)
HALF_W_TB = [(142, 40.0), (175, 52.0), (205, 63.0), (240, 68.0), (265, 69.0)]  # back-view half width by height


def interp(tab, v):
    if v <= tab[0][0]:
        return tab[0][1]
    for (a, A), (b, Bv) in zip(tab, tab[1:]):
        if v <= b:
            return A + (Bv - A) * (v - a) / (b - a)
    return tab[-1][1]


def top_to_back(x, y):
    """Orthographic: the lateral offset seen from above is the lateral offset seen from behind; points away
    from the spine sit lower on the rounded back (cross-section treated as a half ellipse, 15 px deep)."""
    u = (SPINE_Y - y) / HALF_W_TT          # +1 = anatomical right edge (TT image top)
    base = interp(LEN_MAP, x)
    hw = interp(HALF_W_TB, base)
    by = base + 15.0 * (1 - math.sqrt(max(0.0, 1 - u * u)))
    return (137.0 + hw * u, by)


def proj_blob(cx, cy, rx, ry, rot, n=12):
    a = math.radians(rot)
    out = []
    for i in range(n):
        t = 2 * math.pi * i / n
        x = cx + rx * math.cos(t) * math.cos(a) - ry * math.sin(t) * math.sin(a)
        y = cy + rx * math.cos(t) * math.sin(a) + ry * math.sin(t) * math.cos(a)
        out.append(top_to_back(x, y))
    return out


CT = 'badger_coat_top.png'
# T-PATCH outline traced on the top map (TT px), then projected
patch_tt = [(222, 122), (238, 120), (258, 124), (276, 133), (292, 143), (308, 150), (320, 158), (324, 168), (318, 178),
            (300, 186), (280, 192), (258, 200), (238, 204), (226, 198), (222, 180), (224, 160), (220, 140)]
T_SPOTS = [
    ('T-PATCH', 'left', [top_to_back(*p) for p in patch_tt], (262, 167), 'L-WITHERS',
     'large withers patch from above: centred on the spine, wraps mostly to the left side (top map)'),
    ('T-01', 'midline', proj_blob(376.7, 146.5, 12.5, 7.5, 0.7), (377, 147), None, 'spine spot mid back (top map)'),
    ('T-02', 'midline', proj_blob(460.4, 170.8, 14.5, 10.4, -50.2), (460, 171), None, 'spine spot on the croup above the tail (top map)'),
    ('T-03', 'right', proj_blob(221.6, 109.2, 7.7, 4.2, 1.8), (222, 109), None, 'right shoulder edge spot (top map)'),
    ('T-04', 'right', proj_blob(327.4, 113.8, 18.7, 7.2, 2.6), (327, 114), 'R-02', 'right mid-back edge spot (top map), the top of R-02'),
    ('T-05', 'right', proj_blob(465.2, 115.5, 11.5, 4.9, 18.6), (465, 116), 'R-01', 'right croup edge spot (top map), the top of R-01'),
    ('T-06', 'left', proj_blob(221.5, 216.7, 8.6, 4.3, -0.2), (222, 217), None, 'left shoulder edge spot (top map)'),
    ('T-07', 'left', proj_blob(331.4, 212.8, 18.3, 6.4, -3.9), (331, 213), 'L-01', 'left mid-back edge spot (top map), the top of L-01'),
    ('T-08', 'left', proj_blob(465.0, 212.3, 10.6, 4.3, -16.6), (465, 212), 'L-02', 'left croup edge spot (top map), the top of L-02'),
]
for sid, side, poly, ref, same, desc in T_SPOTS:
    bv.spot(sid, side, 'torso', poly, ref, CT, desc + '; projected onto the back view', same)

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
qv.part('tagRing', [(319, 186), (318, 191), (322, 194), (326, 191), (325, 186)], [], [[(319, 186), (318, 191), (322, 194), (326, 191), (325, 186)]], color='none', group='tag')
qv.part('tag', blob(322, 202, 7.4, 8.6, 0), [blob(322, 202, 7.4, 8.6, 0) + [blob(322, 202, 7.4, 8.6, 0)[0]]], color='tag', group='tag')
qv.part('tagShadow', [(325, 195), (329, 200), (329, 206), (324, 210.5, 'c'), (326.5, 205), (326.5, 199)], [], color='tagShadow', group='tag')
qv.pivot('tailRoot', 105, 262)
qv.pivot('neck', 300, 175)
qv.pivot('tagAnchor', 322, 186)
qv.pivot('breath', 230, 160)
# markings: right side (R-) as the 3/4 shows the right flank, plus the front-visible chest and far-side forearm/shoulder
qv.spot('R-01', 'right', 'torso', (139.3, 188.7, 13.5, 8.0, -41.3), (139, 189), CQ, 'croup spot R-01')
qv.spot('R-02', 'right', 'torso', (190.0, 182.0, 12.0, 7.2, -8.0), (190, 182), CQ, 'mid-back spot R-02 (the sheet draws the left withers patch here; coat maps control, decision Q-PATCH)')
qv.spot('R-03', 'right', 'torso', (163.2, 226.0, 8.5, 6.5, 80.0), (163, 226), CQ, 'mid-flank spot R-03')
qv.spot('R-04', 'right', 'torso', (228.4, 233.8, 11.6, 6.6, -79.6), (228, 234), CQ, 'right shoulder spot R-04')
qv.spot('R-05', 'right', 'torso', (203.0, 256.0, 7.0, 5.0, -15.0), (203, 256), CQ, 'lower-ribs spot R-05 (not drawn on the 3/4 sheet; placed from coat_right)')
qv.spot('L-WITHERS', 'left', 'torso', [(214, 161.5, 'c'), (230, 158.5), (246, 153, 'c'), (240, 162), (227, 166), (215, 165.5)], (230, 160), CQ,
        'edge of the left withers patch over the top line (as coat_right shows it)')
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
    {'const': 'BACK_SPOTS', 'doc': ('Markings of the BACK view: the top coat map (T- ids, badger_coat_top.png) projected onto the back, plus the leg spots seen from behind. '
                                    'T- records name the side-map marking they continue (sameAs). View-root space.'), 'spots': spots['back']},
    {'const': 'THREE_QUARTER_SPOTS', 'doc': 'Markings of the THREE-QUARTER view (badger_turn_34.png, right flank toward camera). View-root space.', 'spots': spots['threeQuarter']},
]
with open(sys.argv[2], 'w') as fh:
    json.dump(blocks, fh, indent=1)
print('views ok', {k: len(v) for k, v in spots.items()})
