"""Generate BADGER's SIT and LIE pose bodies (world units) from traces over the pose panels
(reference/crops/badger_pose_sitting.png, badger_pose_lying.png; 2x the sheet).

Both panels face SCREEN RIGHT (the sit is turned three-quarters toward the camera), so both carry the RIGHT-side
markings (R- ids) plus what the turn shows of the front (M-CHEST) and the far forearm (L-09). The withers patch
L-WITHERS straddles the spine (top coat map); the tilted back of the sit and the low body of the lie show its dorsal
surface, traced from the panels (decision BADGER-D16, revised). Every marking keeps its coat-map id and sits on the same anatomical part as in the side view.

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
# round-1 repair (open contours): the chest line starts under the collar's bottom edge, as on the panel (it stopped
# 6 px below the collar, leaving the silhouette unoutlined between them)
chest = [(269.5, 137)] + chest
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
# round-1 repair (open contours): the back-of-neck line runs up under the ear (badger_pose_sitting.png draws it from the
# ear to the collar, with the cheek line branching off it), so it meets the head's near contour instead of stopping
# short of it; the neck fill reaches up under the head and closes the nape
nb = [(203.5, 62), (204, 75), (204.3, 88)] + nb
sp.part('neck', nb + [(204, 140, 'c'), (262, 142, 'c')] + rev(th) + [(240, 92), (214, 92)], [nb, th], group='neck')
col = P('collar')
# the collar's front end sits about where the panel ends it (it stuck out 5 px further in front of the throat)
col[9:12] = [(270.5, 128.5), (272.5, 133), (270.5, 137.5)]
sp.part('collar', col, [col + [col[0]]], color='collar', group='neck')
top = col[1:9]
bot = col[12:20]
mid = [((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 1) for a, b in zip(top, rev(bot))]
sp.part('collarShadow', mid + bot[1:-1], [], color='collarShadow', group='neck')
ring = [(250, 142), (249.5, 147), (253, 149.5), (256.5, 147), (256, 142)]
sp.part('tagRing', ring, [ring + [ring[0]]], color='silver', group='tag')
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
sp.spot('L-WITHERS', 'left', 'torso', [(190, 134, 'c'), (188, 148), (187, 160), (187, 170), (185, 180), (181, 189), (172, 197), (160, 203, 'c'),
                                       (146, 204), (158, 180), (172, 160), (182, 140)],
        'withers patch L-WITHERS along the sloping back (traced from badger_pose_sitting.png; the tilted back shows its dorsal surface, decision BADGER-D16)')
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
# round-1 repair (open contours): the belly underline runs on to the foot of the elbow line, as on the panel (it stopped
# 13 px short)
lp.part('torso', [(312, 100, 'c')] + back[1:] + [(96, 248), (150, 248), (200, 248)] + bg + [(313, 250), (340, 240), (392, 215)] + rev(ch)
        + [(345, 120, 'c')], [back, bg + [(313, 250.5)], ch], [P('crease1'), P('crease2')], group='torso')
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
# round-1 repair (open contours): the back-of-neck line runs up under the ear as on badger_pose_lying.png (it was an
# orphan stroke joined to neither head nor body), the neck fill closes the nape under the head, and the throat line
# runs on into the chest line (it was split in two at the collar)
nb = [(312.3, 33), (312, 50), (311.3, 70)] + nb
lp.part('neck', nb + [(306, 132, 'c'), (375, 142, 'c')] + rev(th) + [(350, 78), (334, 70), (324, 50), (318, 36)], [nb, th + [(378, 128)]],
        group='neck')
col = P('collar')
# the collar's front end reaches the neck-front line, as on the panel (it stopped about 6 px short of it)
col[9:12] = [(375.5, 131), (379.5, 136.5), (376.5, 142)]
lp.part('collar', col, [col + [col[0]]], color='collar', group='neck')
top = col[1:9]
bot = col[11:19]
mid = [((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 1) for a, b in zip(top, rev(bot))]
lp.part('collarShadow', mid + bot[1:-1], [], color='collarShadow', group='neck')
ring = [(363, 141), (362.5, 146), (366, 148.5), (369.5, 146), (369, 141)]
lp.part('tagRing', ring, [ring + [ring[0]]], color='silver', group='tag')
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
lp.spot('L-WITHERS', 'left', 'torso', [(221, 118, 'c'), (224, 132), (231, 144), (242, 151), (254, 150), (263, 141), (268, 126), (269, 113, 'c'), (245, 112)],
        'withers patch L-WITHERS on top of the back (traced from badger_pose_lying.png; the low body shows its dorsal surface, decision BADGER-D16)')
lp.spot('R-06', 'right', 'haunch', (176, 188, 11.6 * K, 7.2 * K, -60), 'front of the right thigh R-06 (on the folded haunch)')
lp.spot('R-07', 'right', 'haunch', (127, 213, 11.1 * K, 6.1 * K, -62.7), 'right gaskin R-07, low on the folded haunch')
lp.spot('R-08', 'right', 'legFrontNear', (392, 238, 12.8 * K, 8.4 * K, -5), 'right forearm R-08 (forearm lies along the ground)')
lp.spot('R-NECK', 'right', 'neck', (328.0, 101.0, 6.9 * K, 4.0 * K, 81.7), 'right neck spot R-NECK')

# =====================================================================================================  LEFT-FACING SIT / LIE
# Round-1 repair (decision BADGER-D23, revised): a left-facing sit / lie reuses ONLY the unmarked silhouette of the traced
# pose (outline parts, collar and tag are bilaterally symmetric; mirrored about the root, as the 3/4-left skull is) and
# carries the LEFT coat map's own markings, authored here at the anatomical places that coat_left gives them (positions
# are written in the right-facing pose's crop px, where the anatomy was located, then placed on the left-facing body).
# No marking path is flipped from a right-side record. Near legs are the anatomical LEFT legs; the far forearm shows the
# edge of R-08; the head is threeQuarterLeftScreen (dark ear near).
KL = 0.97 / 1.196  # coat_left spot size (CL px) -> sit panel px


class MirroredPose:
    def __init__(self, src, name):
        self.name, self.src, self.crop = name, src, src.crop
        flip = lambda d: map_path(d, lambda x, y: (-x, y))
        self.parts = [{**p, 'fill': flip(p['fill']), 'strokes': [flip(d) for d in p['strokes']],
                       'details': [flip(d) for d in p['details']]} for p in src.parts]
        self.pivots = {k: {'x': round(-v['x'], 1), 'y': v['y']} for k, v in src.pivots.items()}
        self.spots = []

    def spot(self, sid, side, part, shape, desc, size_k=KL):
        """shape: (cx, cy, rx, ry, rot) in the right-facing pose's crop px (rx/ry in coat-map px scaled by size_k), or a
        point list in crop px. Placed on the left-facing body."""
        f = lambda x, y: (-(x - self.src.cx) * self.src.s, (y - self.src.ground) * self.src.s)
        if isinstance(shape, tuple):
            cx, cy, rx, ry, rot = shape
            pts = blob(cx, cy, rx * size_k, ry * size_k, rot)
            ref = (cx, cy)
        else:
            pts = shape
            ref = shape[0][:2]
        d = map_path(spline(pts, closed=True), f)
        self.spots.append({'id': sid, 'side': side, 'part': part, 'path': d,
                           'ref': {'crop': self.crop, 'x': ref[0], 'y': ref[1]}, 'desc': desc})


sl = MirroredPose(sp, 'sitLeft')
# torso (sit: the back slopes up to the withers; coat_left puts each left spot a little further back than its right-side
# neighbour, so they sit a little lower along the back than the right-sit R- spots)
sl.spot('L-WITHERS', 'left', 'torso', [(190, 133, 'c'), (198, 156), (198, 173), (191, 186), (178, 197), (157, 204, 'c'), (148, 200), (170, 160), (185, 135)],
        'the large LEFT withers patch on the near side, along the sloping back at the withers (coat_left)')
sl.spot('L-01', 'left', 'torso', (155, 227, 13, 7.2, -50), 'mid back behind the withers patch')
sl.spot('L-02', 'left', 'torso', (128, 262, 10.5, 14, -70), 'croup / top of the rump')
sl.spot('L-03', 'left', 'torso', (194, 204, 10, 11.5, -60), 'shoulder blade')
sl.spot('L-04', 'left', 'torso', (160, 258, 10, 8, -45), 'mid flank')
sl.spot('L-05', 'left', 'torso', (183, 242, 8.5, 5.5, -50), 'lower ribs above the brisket line')
sl.spot('M-CHEST', 'midline', 'torso', (261.9, 184.5, 7.8, 4.2, 86.7), 'midline chest spot, turned with the chest', size_k=1.0)
sl.spot('L-06', 'left', 'haunch', (171, 298, 7.5, 11.5, -60), 'front of the left thigh (on the folded haunch)')
sl.spot('L-07', 'left', 'haunch', (125, 300, 5, 9.2, -40), 'back of the left thigh (rear of the folded haunch)')
sl.spot('L-08', 'left', 'haunch', (124, 331, 4.6, 6, -70), 'left gaskin, low on the folded haunch above the hock')
sl.spot('L-09', 'left', 'legFrontNear', (226.1, 270.6, 7.6, 12.2, -3), 'forearm of the near (left) front leg')
sl.spot('R-08', 'right', 'legFrontFar', (263.0, 272.1, 8.4, 4.4, -85.4), 'right forearm R-08 on the far front leg (edge)', size_k=1.0)
sl.spot('L-NECK', 'left', 'neck', (208, 110, 4.6, 7.4, -20), 'side of the neck below the dark left ear, above the collar')

ll = MirroredPose(lp, 'lieLeft')
KLL = 0.97 / 1.124
ll.spot('L-WITHERS', 'left', 'torso', [(212, 113, 'c'), (218, 130), (230, 145), (250, 153), (270, 149), (284, 136), (290, 116, 'c'), (250, 108)],
        'the large LEFT withers patch on the near side, high on the back at the withers (coat_left)', size_k=KLL)
ll.spot('L-01', 'left', 'torso', (169, 136, 13, 7.2, -4), 'mid back behind the withers patch', size_k=KLL)
ll.spot('L-02', 'left', 'torso', (118, 152, 10.5, 14, -40), 'croup / top of the rump, above the folded haunch', size_k=KLL)
ll.spot('L-03', 'left', 'torso', (271, 184, 10, 11.5, -25), 'shoulder blade', size_k=KLL)
ll.spot('L-04', 'left', 'torso', (191, 174, 10, 8, -8), 'mid flank', size_k=KLL)
ll.spot('L-05', 'left', 'torso', (238, 214, 8.5, 5.5, -6), 'lower ribs above the brisket line', size_k=KLL)
ll.spot('L-06', 'left', 'haunch', (176, 188, 7.5, 11.5, -40), 'front of the left thigh (on the folded haunch)', size_k=KLL)
ll.spot('L-07', 'left', 'haunch', (124, 186, 5, 9.2, -20), 'back of the left thigh (rear of the folded haunch)', size_k=KLL)
ll.spot('L-08', 'left', 'haunch', (130, 214, 4.6, 6, -50), 'left gaskin, low on the folded haunch', size_k=KLL)
ll.spot('L-09', 'left', 'legFrontNear', (392, 238, 12.2, 7.6, -5), 'forearm of the near (left) front leg, lying along the ground', size_k=KLL)
ll.spot('L-NECK', 'left', 'neck', (326, 104, 4.6, 7.4, -10), 'side of the neck below the dark left ear, above the collar', size_k=KLL)

poses = [sp, lp, sl, ll]

out = {p.name: {'parts': p.parts, 'pivots': p.pivots} for p in poses}
with open(sys.argv[1], 'w') as fh:
    fh.write('/**\n * SIT and LIE pose bodies of BADGER, world units (ZOO = 900). GENERATED by\n'
             ' * src/characters/badger/dev/trace/gen_poses.py from traces over the pose panels. Edit the tracer.\n'
             ' * Paths are in pose-root space (origin = ground contact point = centre of the footprint).\n */\n')
    fh.write('export const POSE_RIGS = ' + json.dumps(out, indent='\t') + ' as const;\n')
CONST = {'sit': 'SIT_SPOTS', 'lie': 'LIE_SPOTS', 'sitLeft': 'SIT_LEFT_SPOTS', 'lieLeft': 'LIE_LEFT_SPOTS'}
DOC = {
    'sit': 'Markings of the SIT pose body (badger_pose_sitting.png; faces screen right, right-side set). Pose-root space.',
    'lie': 'Markings of the LIE pose body (badger_pose_lying.png; faces screen right, right-side set). Pose-root space.',
    'sitLeft': ('Markings of the LEFT-FACING SIT body (the unmarked sit silhouette facing screen left; LEFT coat-map set authored on it, '
                'decision BADGER-D23). Pose-root space.'),
    'lieLeft': ('Markings of the LEFT-FACING LIE body (the unmarked lie silhouette facing screen left; LEFT coat-map set authored on it, '
                'decision BADGER-D23). Pose-root space.'),
}
blocks = [{'const': CONST[p.name], 'doc': DOC[p.name], 'spots': p.spots} for p in poses]
with open(sys.argv[2], 'w') as fh:
    json.dump(blocks, fh, indent=1)
print('poses ok', {p.name: len(p.spots) for p in poses})
