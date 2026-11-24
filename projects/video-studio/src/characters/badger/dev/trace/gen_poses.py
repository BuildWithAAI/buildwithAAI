"""Generate BADGER's SIT and LIE pose bodies (world units) from traces over the pose panels
(reference/crops/badger_pose_sitting.png, badger_pose_lying.png; 2x the sheet).

Both panels face SCREEN RIGHT (the sit is turned three-quarters toward the camera), so both carry the RIGHT-side
markings (R- ids) plus what the turn shows of the front (M-CHEST) and the far forearm (L-09). The sheet draws the
large LEFT withers patch on both; the coat maps control body markings, so it shows only as its top-line edge
(decision P-PATCH). Every marking keeps its coat-map id and sits on the same anatomical part as in the side view.

Scale: each panel is scaled so its head matches the shared replaceable 3/4 head (eye spacing 46.4 units). Check:
the sit's front leg (elbow to ground) comes out at 179 units against 180 in the standing three-quarter view.
"""
import json
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
from pathmap import map_path
from spline import spline, blob

HERE = os.path.dirname(__file__)


def load(name):
    return json.load(open(os.path.join(HERE, 'traces', name)))


def rev(a):
    return list(reversed(a))


class Pose:
    def __init__(self, name, s, cx, ground, crop):
        self.name, self.s, self.cx, self.ground, self.crop = name, s, cx, ground, crop
        self.parts, self.spots, self.pivots = [], [], {}

    def f(self, x, y):
        return ((x - self.cx) * self.s, (y - self.ground) * self.s)

    def path(self, points, closed=False):
        return map_path(spline(points, closed=closed), self.f)

    def pt(self, x, y):
        X, Y = self.f(x, y)
        return {'x': round(X, 1), 'y': round(Y, 1)}

    def part(self, pid, fill, strokes, details=(), color='coat', group=None):
        self.parts.append({'id': pid, 'color': color, 'group': group, 'fill': self.path(fill, True),
                           'strokes': [self.path(s) for s in strokes], 'details': [self.path(d) for d in details]})

    def spot(self, sid, side, part, shape, desc, ref=None):
        d = self.path(blob(*shape), True) if isinstance(shape, tuple) else self.path(shape, True)
        r = ref or ((shape[0], shape[1]) if isinstance(shape, tuple) else shape[0][:2])
        self.spots.append({'id': sid, 'side': side, 'part': part, 'path': d,
                           'ref': {'crop': self.crop, 'x': r[0], 'y': r[1]}, 'desc': desc})

    def pivot(self, name, x, y):
        self.pivots[name] = self.pt(x, y)


def cut(ps, ymin=None, ymax=None):
    return [tuple(p) for p in ps if (ymin is None or p[1] >= ymin) and (ymax is None or p[1] <= ymax)]


# =====================================================================================================  SIT
T = load('sit.json')
K = 0.97 / 1.196  # coat_right spot size (CR px) -> sit panel px
sp = Pose('sit', 1.196, 209, 370, 'badger_pose_sitting.png')
P = lambda k: [tuple(p) for p in T[k]]
tail = P('tail')
sp.part('tail', tail + [(126, 352), (118, 340)], [tail], [P('tail_fold')], group='tail')
chest = P('chest')
nfr = P('nf_right')
nfl = P('nf_left')
chest_lo = cut(chest, ymin=262)
ffp = P('ffpaw')
sp.part('legFrontFar', [(252, 222, 'c')] + nfr[3:] + ffp[1:] + rev(chest_lo)[1:], [chest_lo, ffp])
hn = P('haunch')
sp.part('farSide', [(190, 250, 'c'), (204, 252)] + cut(nfl, ymin=255) + [(214, 346, 'c'), (176, 346, 'c')] + rev(cut(hn, ymin=280)),
        [], [P('far_hind')], color='coatShadow')
back = P('back')
chest_up = cut(chest, ymax=270)
sp.part('torso', [(203, 124, 'c')] + back + [(128, 352), (152, 346), (172, 330), (184, 300), (186, 280), (191, 258), (204, 248), (226, 256), (240, 282)]
        + rev(chest_up) + [(240, 138, 'c')], [back, chest_up], group='torso')
sp.part('haunch', hn + [(132, 352), (112, 338), (110, 300), (124, 274)], [hn])
hp = P('hpaw')
sp.part('pawHindNear', hp, [hp + [hp[0]]], [[(196, 358), (196, 363), (196, 368)], [(205, 359), (205, 364), (205, 368)]])
nfp = P('nfpaw')
sp.part('legFrontNear', [(222, 205, 'c')] + nfl + nfp[1:] + rev(nfr)[1:], [nfl, nfp, nfr],
        [[(240, 360), (240, 364), (240, 369)], [(251, 361), (251, 365), (251, 369)]])
nb = P('neck_back')
th = P('throat')
sp.part('neck', nb + [(204, 140, 'c'), (262, 142, 'c')] + rev(th) + [(240, 92), (214, 92)], [nb, th], group='neck')
col = P('collar')
sp.part('collar', col, [col + [col[0]]], color='collar', group='neck')
top = col[1:9]
bot = col[12:20]
mid = [((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 1) for a, b in zip(top, rev(bot))]
sp.part('collarShadow', mid + bot[1:-1], [], color='collarShadow', group='neck')
ring = [(250, 142), (249.5, 147), (253, 149.5), (256.5, 147), (256, 142)]
sp.part('tagRing', ring, [], [ring], color='none', group='tag')
tagp = blob(253, 156, 6.4, 7.6, 0)
sp.part('tag', tagp, [tagp + [tagp[0]]], color='tag', group='tag')
sp.part('tagShadow', [(255.5, 149.5), (258.5, 153), (258.8, 158), (255, 162.5, 'c'), (256.8, 157.5), (256.6, 152.5)], [], color='tagShadow', group='tag')
sp.pivot('tailRoot', 114, 350)
sp.pivot('neck', 236, 132)
sp.pivot('tagAnchor', 253, 142)
sp.pivot('breath', 200, 200)
sp.pivot('headCentroid', 255.0, 61.2)   # eyes+nose centroid of the sheet's sitting head (3/4 head is mounted on it)
sp.spot('R-01', 'right', 'torso', (128, 262, 17.2 * K, 10.8 * K, -62), 'croup spot R-01 (the croup tilts down when sitting)')
sp.spot('R-02', 'right', 'torso', (161, 214, 15.8 * K, 8.8 * K, -58), 'mid-back spot R-02 (the sheet draws the left withers patch here; coat maps control)')
sp.spot('R-03', 'right', 'torso', (166, 246, 9.9 * K, 8.3 * K, -40), 'mid-flank spot R-03')
sp.spot('R-04', 'right', 'torso', (197.1, 196.5, 10.8 * K, 7.4 * K, -84.5), 'right shoulder spot R-04')
sp.spot('R-05', 'right', 'torso', (188, 232, 8.1 * K, 5.8 * K, -60), 'lower-ribs spot R-05')
sp.spot('L-WITHERS', 'left', 'torso', [(173, 175, 'c'), (181, 163), (189, 148, 'c'), (188, 157), (183, 167)], 'edge of the left withers patch over the top line')
sp.spot('M-CHEST', 'midline', 'torso', (261.9, 184.5, 7.8, 4.2, 86.7), 'midline chest spot, turned with the chest')
sp.spot('L-09', 'left', 'legFrontFar', (263.0, 272.1, 8.4, 4.4, -85.4), 'left forearm L-09 on the far front leg (edge)')
sp.spot('R-06', 'right', 'haunch', (171, 298, 11.6 * K, 7.2 * K, -69), 'front of the right thigh R-06 (on the folded haunch)')
sp.spot('R-07', 'right', 'haunch', (122, 329, 11.1 * K, 6.1 * K, -80), 'right gaskin R-07, low on the folded haunch above the hock')
sp.spot('R-08', 'right', 'legFrontNear', (226.1, 270.6, 10.1, 5.7, 86.7), 'right forearm R-08')
sp.spot('R-NECK', 'right', 'neck', (210, 104, 6.9 * K, 4.0 * K, -73), 'right neck spot R-NECK')


# =====================================================================================================  LIE
T = load('lie.json')
K = 0.97 / 1.124
lp = Pose('lie', 46.4 / 41.3, 296, 252, 'badger_pose_lying.png')
P = lambda k: [tuple(p) for p in T[k]]
tail = P('tail')
lp.part('tail', tail + [(122, 238), (92, 226)], [tail], [P('tail_fold')], group='tail')
fft = P('ff_top')
ffp = P('ff_paw')
lp.part('legFrontFar', fft + ffp[1:] + [(470, 250), (400, 240), (360, 228), (345, 214), (372, 200, 'c')], [fft, ffp])
back = P('back')
bg = P('belly_ground')
ch = P('chest')
lp.part('torso', [(312, 100, 'c')] + back[1:] + [(96, 248), (150, 248), (200, 248)] + bg + [(313, 250), (340, 240), (392, 215)] + rev(ch)
        + [(345, 120, 'c')], [back, bg, ch], [P('crease1'), P('crease2')], group='torso')
hn = P('haunch')
lp.part('haunch', hn + [(140, 231), (118, 222), (108, 200), (112, 175), (125, 157)], [hn])
hp = P('hpaw')
lp.part('pawHindNear', hp + [(120, 240), (132, 230)], [hp], [[(194, 241), (194, 246), (194, 251)], [(205, 240), (205, 245), (205, 250)]])
el = P('elbow')
nfb = P('nf_bottom')
nfp = P('nf_paw')
nft = P('nf_top')
lp.part('legFrontNear', el + nfb[1:] + nfp[1:] + rev(nft)[1:] + [(322, 212, 'c')], [el, nfb, nfp, nft],
        [[(488, 247), (488, 251), (488, 255)]])
nb = P('neck_back')
th = P('throat')
lp.part('neck', nb + [(306, 132, 'c'), (375, 142, 'c')] + rev(th) + [(350, 78), (318, 78)], [nb, th], group='neck')
col = P('collar')
lp.part('collar', col, [col + [col[0]]], color='collar', group='neck')
top = col[1:9]
bot = col[11:19]
mid = [((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 1) for a, b in zip(top, rev(bot))]
lp.part('collarShadow', mid + bot[1:-1], [], color='collarShadow', group='neck')
ring = [(363, 141), (362.5, 146), (366, 148.5), (369.5, 146), (369, 141)]
lp.part('tagRing', ring, [], [ring], color='none', group='tag')
tagp = blob(366, 156, 6.8, 8.0, 0)
lp.part('tag', tagp, [tagp + [tagp[0]]], color='tag', group='tag')
lp.part('tagShadow', [(368.5, 148.5), (371.8, 152.5), (372, 158), (368, 163, 'c'), (369.8, 157.5), (369.6, 152)], [], color='tagShadow', group='tag')
lp.pivot('tailRoot', 88, 230)
lp.pivot('neck', 340, 125)
lp.pivot('tagAnchor', 366, 141)
lp.pivot('breath', 240, 125)
lp.pivot('headCentroid', 377.7, 44.0)   # eyes+nose centroid of the sheet's lying head
lp.spot('R-01', 'right', 'torso', (118, 152, 17.2 * K, 10.8 * K, -55), 'croup spot R-01 (top of the rump, above the folded haunch)')
lp.spot('R-02', 'right', 'torso', (196.4, 134.4, 15.8 * K, 8.8 * K, -2.6), 'mid-back spot R-02')
lp.spot('R-03', 'right', 'torso', (215.0, 172.1, 9.9 * K, 8.3 * K, -70), 'mid-flank spot R-03')
lp.spot('R-04', 'right', 'torso', (285.8, 182.2, 10.8 * K, 7.4 * K, -68.6), 'right shoulder spot R-04')
lp.spot('R-05', 'right', 'torso', (259.4, 214.0, 8.1 * K, 5.8 * K, 2.1), 'lower-ribs spot R-05')
lp.spot('L-WITHERS', 'left', 'torso', [(244, 126.5, 'c'), (262, 129), (282, 125.5, 'c'), (276, 133), (262, 135), (250, 132.5)], 'edge of the left withers patch over the top line')
lp.spot('R-06', 'right', 'haunch', (176, 188, 11.6 * K, 7.2 * K, -60), 'front of the right thigh R-06 (on the folded haunch)')
lp.spot('R-07', 'right', 'haunch', (127, 213, 11.1 * K, 6.1 * K, -62.7), 'right gaskin R-07, low on the folded haunch')
lp.spot('R-08', 'right', 'legFrontNear', (392, 238, 12.8 * K, 8.4 * K, -5), 'right forearm R-08 (forearm lies along the ground)')
lp.spot('R-NECK', 'right', 'neck', (328.0, 101.0, 6.9 * K, 4.0 * K, 81.7), 'right neck spot R-NECK')

poses = [sp, lp]

out = {p.name: {'parts': p.parts, 'pivots': p.pivots} for p in poses}
with open(sys.argv[1], 'w') as fh:
    fh.write('/**\n * SIT and LIE pose bodies of BADGER, world units (ZOO = 900). GENERATED by\n'
             ' * src/characters/badger/dev/trace/gen_poses.py from traces over the pose panels. Edit the tracer.\n'
             ' * Paths are in pose-root space (origin = ground contact point = centre of the footprint).\n */\n')
    fh.write('export const POSE_RIGS = ' + json.dumps(out, indent='\t') + ' as const;\n')
blocks = [{'const': '%s_SPOTS' % p.name.upper(), 'doc': 'Markings of the %s pose body (%s; faces screen right, right-side set). Pose-root space.' % (p.name.upper(), p.crop),
           'spots': p.spots} for p in poses]
with open(sys.argv[2], 'w') as fh:
    json.dump(blocks, fh, indent=1)
print('poses ok', {p.name: len(p.spots) for p in poses})
