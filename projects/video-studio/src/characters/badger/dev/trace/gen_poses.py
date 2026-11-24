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
import math
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
# Round-4 repair (sliced spots): the torso fill's lower front corner (it was (240, 282)) reached down over the FAR foreleg,
# drawn before the torso, so the far forearm's edge mark (L-09 here, R-08 on the left-facing body) was cut along that
# unstroked edge (23-30% of it hidden, a flat top). The corner now sits at (241, 266), just under the end of the torso's
# chest stroke (y 268): the far leg's own fill and its chest-line stroke carry the outline below it, as before, and the
# near leg (drawn after the torso) still covers its side of the corner.
sp.part('torso', [(203, 124, 'c')] + back + [(128, 352), (152, 346), (172, 330), (184, 300), (186, 280), (191, 258), (204, 248), (226, 256), (241, 266)]
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
# Round-4 repair (R3 review minor, sliced spots): R-01 sat 10% under the haunch fill (drawn over the torso), so its lower
# corner was cut off along the haunch's UNSTROKED top edge. It now sits where badger_pose_sitting.png draws the croup spot
# (moments of its dark component: centre (136.1, 241.8), long axis -66 deg), fully above the thigh (dev check: 0% covered).
sp.spot('R-01', 'right', 'torso', (136.1, 241.8, 17.2 * K, 10.8 * K, -66), 'croup spot R-01 (where the sitting panel draws it, clear of the thigh)')
sp.spot('R-02', 'right', 'torso', (161, 214, 15.8 * K, 8.8 * K, -58), 'mid-back spot R-02 (the sheet draws the left withers patch here; coat maps control)')
sp.spot('R-03', 'right', 'torso', (166, 246, 9.9 * K, 8.3 * K, -40), 'mid-flank spot R-03')
sp.spot('R-04', 'right', 'torso', (197.1, 196.5, 10.8 * K, 7.4 * K, -84.5), 'right shoulder spot R-04')
sp.spot('R-05', 'right', 'torso', (188, 232, 8.1 * K, 5.8 * K, -60), 'lower-ribs spot R-05')
sp.spot('L-WITHERS', 'left', 'torso', [(190, 134, 'c'), (188, 148), (187, 160), (187, 170), (185, 180), (181, 189), (172, 197), (160, 203, 'c'),
                                       (146, 204), (158, 180), (172, 160), (182, 140)],
        'withers patch L-WITHERS along the sloping back (traced from badger_pose_sitting.png; the tilted back shows its dorsal surface, decision BADGER-D16)')
sp.spot('M-CHEST', 'midline', 'torso', (261.9, 184.5, 7.8, 4.2, 86.7), 'midline chest spot, turned with the chest')
# Round-4 repair (sliced spots): the far forearm's own fill and its chest-line stroke only start at y 268 (chest_lo; above
# it the far leg runs on behind the brisket, under the torso), so the panel-traced mark at y 272.1 was cut flat along the
# unstroked top of the far leg's fill (20% of it hidden). It now sits just below that: its top 1 px under y 268.
SIT_FAR_VISIBLE_TOP = 268.0
sp.spot('L-09', 'left', 'legFrontFar', (263.4, SIT_FAR_VISIBLE_TOP + 8.4 + 1.0, 8.4, 4.4, -85.4), 'left forearm L-09 on the far front leg (edge)')
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
# Round-4 repair (sliced spots): 2.5% of R-01 lay under the haunch fill's unstroked top edge (a straight cut); moved 4 px
# up the rump so it clears the thigh.
lp.spot('R-01', 'right', 'torso', (116, 148, 17.2 * K, 10.8 * K, -55), 'croup spot R-01 (top of the rump, above the folded haunch)')
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

    def spot(self, sid, side, part, shape, desc, size_k=KL, ref=None):
        """shape: (cx, cy, rx, ry, rot) in the right-facing pose's crop px (rx/ry in coat-map px scaled by size_k), or a
        point list in crop px. Placed on the left-facing body. ref: optional (crop, x, y) of the source drawing."""
        f = lambda x, y: (-(x - self.src.cx) * self.src.s, (y - self.src.ground) * self.src.s)
        if isinstance(shape, tuple):
            cx, cy, rx, ry, rot = shape
            pts = blob(cx, cy, rx * size_k, ry * size_k, rot)
            at = (self.crop, cx, cy)
        else:
            pts = shape
            at = (self.crop,) + tuple(shape[0][:2])
        crop, rx_, ry_ = ref or at
        d = map_path(spline(pts, closed=True), f)
        self.spots.append({'id': sid, 'side': side, 'part': part, 'path': d,
                           'ref': {'crop': crop, 'x': rx_, 'y': ry_}, 'desc': desc})


sl = MirroredPose(sp, 'sitLeft')
# torso (sit: the back slopes up to the withers; coat_left puts each left spot a little further back than its right-side
# neighbour, so they sit a little lower along the back than the right-sit R- spots)
sl.spot('L-WITHERS', 'left', 'torso', [(190, 133, 'c'), (198, 156), (198, 173), (191, 186), (178, 197), (157, 204, 'c'), (148, 200), (170, 160), (185, 135)],
        'the large LEFT withers patch on the near side, along the sloping back at the withers (coat_left)')
sl.spot('L-01', 'left', 'torso', (155, 227, 13, 7.2, -50), 'mid back behind the withers patch')
# Round-4 repair (R3 review minor, sliced spots): L-02 and L-04 lay 12% and 62% under the haunch fill (drawn over the
# torso): L-02 was cut along the haunch's unstroked top edge and L-04 showed only as a cap above the thigh line. Each now
# sits fully on the torso, and takes coat_left's OWN shape: its size and its tilt on badger_coat_left.png, turned by how
# much the sit turns that body region (the sitting panel's croup spot against coat_right's R-01: -22.4 deg; the flank:
# the sit's R-03 against coat_right's R-03, -22.2 deg). L-02: the croup, 3 px toward the tail from where the panel draws
# the croup spot (coat_left puts the left spots a little further back); coat_left tilt -28 deg (long axis 14 px) ->
# 118 deg mirrored + -22.4 = 95.6 deg.
sl.spot('L-02', 'left', 'torso', (135.0, 244.6, 14, 10.5, 95.6), 'croup / top of the rump (clear of the thigh)')
sl.spot('L-03', 'left', 'torso', (194, 204, 10, 11.5, -60), 'shoulder blade')
# L-04: the mid flank just above the thigh line (2 px clear of its stroke), 6 px further back than the sit's R-03;
# coat_left tilt -8 deg (long axis 10 px) -> 8 deg mirrored + -22.2 = -14.2 deg.
sl.spot('L-04', 'left', 'torso', (160, 245, 10, 8, -14.2), 'mid flank, above the thigh line')
sl.spot('L-05', 'left', 'torso', (183, 242, 8.5, 5.5, -50), 'lower ribs above the brisket line')
sl.spot('M-CHEST', 'midline', 'torso', (261.9, 184.5, 7.8, 4.2, 86.7), 'midline chest spot, turned with the chest', size_k=1.0)
sl.spot('L-06', 'left', 'haunch', (171, 298, 7.5, 11.5, -60), 'front of the left thigh (on the folded haunch)')
sl.spot('L-07', 'left', 'haunch', (125, 300, 5, 9.2, -40), 'back of the left thigh (rear of the folded haunch)')
sl.spot('L-08', 'left', 'haunch', (124, 331, 4.6, 6, -70), 'left gaskin, low on the folded haunch above the hock')
# Round-4 repair (R3 review minor): every forearm record of the left-facing bodies is placed from ITS OWN coat map
# (dev/trace/coatmaps.py, measured on badger_coat_left.png / badger_coat_right.png): how far down the forearm (elbow tip ->
# wrist cut), how far across from the front contour, the map's own size and its own tilt. Round 3 had placed L-09 at the
# right sit's / right lie's R-08 centre (0.6 / 0.8 units from an x-mirror of R-08); now nothing here is placed from a
# right-side record. Positions are written in the right-facing panel's px (where the anatomy was located, front = +x,
# back = -x) and placed on the left-facing body (x -> -x, which keeps front as front and back as back).
from coatmaps import along as _along, across_from_front as _across, size_units as _size_units, tilt_back as _tilt_back, EDGE_K


def _edge_at(line, y):
    """x where a traced edge (points top -> bottom) crosses height y."""
    for a, b in zip(line, line[1:]):
        if (a[1] - y) * (b[1] - y) <= 0 and a[1] != b[1]:
            t = (y - a[1]) / (b[1] - a[1])
            return a[0] + (b[0] - a[0]) * t
    raise ValueError('edge does not reach y=%s' % y)


def _edge_at_x(line, x):
    """y where a traced edge (points left -> right) crosses x."""
    for a, b in zip(line, line[1:]):
        if (a[0] - x) * (b[0] - x) <= 0 and a[0] != b[0]:
            t = (x - a[0]) / (b[0] - a[0])
            return a[1] + (b[1] - a[1]) * t
    raise ValueError('edge does not reach x=%s' % x)


def _axis_deg(p, q):
    """Angle (deg, y down) of the direction p -> q (proximal -> distal along a forearm)."""
    return math.degrees(math.atan2(q[1] - p[1], q[0] - p[0]))


# blob(cx, cy, rx, ry, rot): rx lies along the direction rot. Forearm records put rx along the forearm (rot = the forearm
# axis pointing from the elbow to the wrist) and lean the proximal end toward the BACK (-x in these right-facing panel px)
# by the map's own tilt, which subtracts it from the axis angle.
K_SIT = 0.97 / 1.196
_SIT = load('sit.json')
SIT_NEAR_BACK = [tuple(p[:2]) for p in _SIT['nf_left']]    # near forearm's rear contour (right-facing panel: back = -x)
SIT_NEAR_FRONT = [tuple(p[:2]) for p in _SIT['nf_right']]  # near forearm's front contour
# near forearm of the sit panel: the rear contour reaches its rearmost point (the elbow) at y 236 and both contours kink out
# above the paw (the wrist) at y 338; the far forearm runs from its elbow crease (y 238, the diagonal crease between the
# legs) to the wrist above the paw (y 338)
SIT_NEAR_ELBOW_Y, SIT_NEAR_WRIST_Y = 236.0, 338.0
SIT_FAR_ELBOW_Y, SIT_FAR_WRIST_Y = 238.0, 338.0
SIT_FAR_EDGE = [tuple(p[:2]) for p in _SIT['chest']]   # far leg's front edge (right-facing panel px)

# L-09 on the near (anatomical LEFT) forearm: coat_left's own place on its forearm (37.2% down, 38.5% across from the front)
_y = SIT_NEAR_ELBOW_Y + _along('L-09') * (SIT_NEAR_WRIST_Y - SIT_NEAR_ELBOW_Y)
_xf, _xb = _edge_at(SIT_NEAR_FRONT, _y), _edge_at(SIT_NEAR_BACK, _y)
_x = _xf - _across('L-09') * (_xf - _xb)
_mid = lambda yy: ((_edge_at(SIT_NEAR_FRONT, yy) + _edge_at(SIT_NEAR_BACK, yy)) / 2, yy)
_rot = _axis_deg(_mid(_y - 14), _mid(_y + 14)) - _tilt_back('L-09')
_ac, _al = _size_units('L-09')
sl.spot('L-09', 'left', 'legFrontNear', (round(_x, 2), round(_y, 2), round(_al / 0.97, 2), round(_ac / 0.97, 2), round(_rot, 1)),
        'forearm of the near (left) front leg, placed from badger_coat_left.png L-09', ref=('badger_coat_left.png', 209, 314))

# R-08 on the far (anatomical RIGHT) forearm: badger_coat_right.png's own R-08 (35.7% down that forearm), coat_right's own
# size with the across-leg axis foreshortened to EDGE_K (only the far leg's outer edge shows: the sit panel draws its far
# forearm mark about 4.5 px wide against a 6.2-6.5 px half-width), its own tilt on this far leg's axis, centred on the far
# leg's front edge (the outline of the mirrored, unmarked silhouette) so the leg clip shows the half that wraps round it.
_ac, _al = _size_units('R-08', edge=True)
# the far forearm's visible edge starts at y 268 (SIT_FAR_VISIBLE_TOP, above it the leg is behind the brisket): if the map's
# place would put the top of the mark above that, it moves down just far enough to show whole (no flat cut)
_y = max(SIT_FAR_ELBOW_Y + _along('R-08') * (SIT_FAR_WRIST_Y - SIT_FAR_ELBOW_Y), SIT_FAR_VISIBLE_TOP + _al / 0.97 * K_SIT + 1.0)
_x = _edge_at(SIT_FAR_EDGE, _y)
_rot = _axis_deg((_edge_at(SIT_FAR_EDGE, _y - 12), _y - 12), (_edge_at(SIT_FAR_EDGE, _y + 12), _y + 12)) - _tilt_back('R-08')
sl.spot('R-08', 'right', 'legFrontFar', (round(_x, 2), round(_y, 2), round(_al / 0.97, 2), round(_ac / 0.97, 2), round(_rot, 1)),
        'right forearm R-08 on the far front leg (its outer edge), authored from badger_coat_right.png R-08',
        ref=('badger_coat_right.png', 408, 314))
sl.spot('L-NECK', 'left', 'neck', (208, 110, 4.6, 7.4, -20), 'side of the neck below the dark left ear, above the collar')

ll = MirroredPose(lp, 'lieLeft')
KLL = 0.97 / 1.124
ll.spot('L-WITHERS', 'left', 'torso', [(212, 113, 'c'), (218, 130), (230, 145), (250, 153), (270, 149), (284, 136), (290, 116, 'c'), (250, 108)],
        'the large LEFT withers patch on the near side, high on the back at the withers (coat_left)', size_k=KLL)
ll.spot('L-01', 'left', 'torso', (169, 136, 13, 7.2, -4), 'mid back behind the withers patch', size_k=KLL)
# Round-4 repair (sliced spots): L-02 lay 9% under the haunch fill's unstroked top edge (a straight cut, like the right
# lie's R-01); moved 4 px up the rump so it clears the thigh.
ll.spot('L-02', 'left', 'torso', (116, 148, 10.5, 14, -40), 'croup / top of the rump, above the folded haunch', size_k=KLL)
ll.spot('L-03', 'left', 'torso', (271, 184, 10, 11.5, -25), 'shoulder blade', size_k=KLL)
# Round-4 repair (R3 review minor): L-04 (torso) and L-06 (haunch) both straddled the thigh's front contour and read as
# two offset half-moons split by the thigh line. As coat_left places them, L-04 is on the flank AHEAD of the thigh edge
# (4 px clear of its stroke) and L-06 is inside the thigh, about a quarter of the thigh's width behind its front edge
# (coat_left: 24 of 98 px). Shapes are coat_left's own: L-04 tilt -8 deg -> 8 deg mirrored + the lie's flank turn
# (its R-03 against coat_right's R-03: -52.2 deg) = -44.2 deg; L-06 tilt -8 deg (long axis 11.5 px) -> 98 deg mirrored +
# the thigh turn (the lie's R-06 against coat_right's R-06: +9 deg) = 107 deg.
ll.spot('L-04', 'left', 'torso', (205, 172, 10, 8, -44.2), 'mid flank, ahead of the thigh', size_k=KLL)
ll.spot('L-05', 'left', 'torso', (238, 214, 8.5, 5.5, -6), 'lower ribs above the brisket line', size_k=KLL)
ll.spot('L-06', 'left', 'haunch', (167, 190, 11.5, 7.5, 107), 'front of the left thigh (inside the folded haunch)', size_k=KLL)
ll.spot('L-07', 'left', 'haunch', (124, 186, 5, 9.2, -20), 'back of the left thigh (rear of the folded haunch)', size_k=KLL)
ll.spot('L-08', 'left', 'haunch', (130, 214, 4.6, 6, -50), 'left gaskin, low on the folded haunch', size_k=KLL)
# L-09 on the near (anatomical LEFT) forearm, which lies forward along the ground: coat_left's own place on its forearm,
# measured from the elbow tip (x 313, the rear foot of the elbow contour) to the wrist (x 458, where the forearm's top
# contour turns down into the paw) and across from the forearm's FRONT surface, which faces up once the leg lies forward
# (top contour nf_top; the ground-side contour nf_bottom). Round 3 had put it on the right lie's R-08 centre.
_LIE = load('lie.json')
LIE_NEAR_TOP = [tuple(p[:2]) for p in _LIE['nf_top']]
LIE_NEAR_BOTTOM = [tuple(p[:2]) for p in _LIE['nf_bottom']]
LIE_NEAR_ELBOW_X, LIE_NEAR_WRIST_X = 313.0, 458.0
_x = LIE_NEAR_ELBOW_X + _along('L-09') * (LIE_NEAR_WRIST_X - LIE_NEAR_ELBOW_X)
_yt, _yb = _edge_at_x(LIE_NEAR_TOP, _x), _edge_at_x(LIE_NEAR_BOTTOM, _x)
_y = _yt + _across('L-09') * (_yb - _yt)
_mid = lambda xx: (xx, (_edge_at_x(LIE_NEAR_TOP, xx) + _edge_at_x(LIE_NEAR_BOTTOM, xx)) / 2)
_rot = _axis_deg(_mid(_x - 14), _mid(_x + 14)) - _tilt_back('L-09')
_ac, _al = _size_units('L-09')
KLL = 0.97 / 1.124
ll.spot('L-09', 'left', 'legFrontNear', (round(_x, 2), round(_y, 2), round(_al / 0.97, 2), round(_ac / 0.97, 2), round(_rot, 1)),
        'forearm of the near (left) front leg, lying along the ground; placed from badger_coat_left.png L-09', size_k=KLL,
        ref=('badger_coat_left.png', 209, 314))
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
