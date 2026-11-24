"""Generate the RIGHT-view body rig (world units) from traces over
reference/crops/badger_coat_right.png ("CR" pixel space, 2x crop of the approved sheet).

The dog faces SCREEN RIGHT and its ANATOMICAL RIGHT side faces the camera. Nothing here is mirrored from
the left view: every outline was traced on coat_right (traces/right.json holds the outline centre-line
points, followed along the sheet's line skeleton) and every marking is a right-side marking (R-..).

CR -> world mapping (binding scale from badger_size_comparison.png, ZOO = 900 units, decision D01):
  withers outer edge CR y=139 -> -312.6 ; ground CR y=443 -> 0                     => ky = 1.0283
  chest front centre line CR x=467 .. rump (thigh line) CR x=112 = 355 px, rendered
  outer-to-outer length 348.1 units (same as the left view)                         => kx = 0.9734
  origin x: centre of the footprint (near-hind heel CR 91 .. far-front toe CR 456+30)
"""
import json
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
from pathmap import map_path
from spline import spline, blob, arc_over

HERE = os.path.dirname(__file__)
T = json.load(open(os.path.join(HERE, 'traces', 'right.json')))

KX, KY = 0.9734, 1.0283
FRONT_FAR_DX = 30   # far (anatomical LEFT) front paw stands 30 CR px forward (decision R-STANCE) ...
FRONT_FAR_MOUNT_DX = 6  # ... its shoulder only 6 px forward; the stand pose rotates the leg (IK) to reach the paw spot
HIND_FAR_DX = 26    # far hind leg 26 CR px forward, as drawn on coat_right
FOOT_MIN, FOOT_MAX = 91, 456 + FRONT_FAR_DX
OX = -KX * (FOOT_MIN + FOOT_MAX) / 2


def W(x, y):
    return (KX * x + OX, KY * (y - 443))


def rnd(p):
    return {'x': round(p[0], 1), 'y': round(p[1], 1)}


def local(origin):
    ox, oy = W(*origin)

    def f(x, y):
        X, Y = W(x, y)
        return (X - ox, Y - oy)
    return f


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1])


def pts(name, a=None, b=None):
    """Trace points of one outline, optionally cut to the index range [a, b)."""
    return [tuple(p) for p in T[name][a:b]]


def until(name, ymax=None, ymin=None):
    out = []
    for p in T[name]:
        if ymax is not None and p[1] > ymax:
            break
        if ymin is not None and p[1] < ymin:
            continue
        out.append(tuple(p))
    return out


def rev(ps):
    return list(reversed(ps))


def S(points, origin, closed=False):
    return map_path(spline(points, closed=closed), local(origin))


def seg(fill_pts, strokes, origin, details=()):
    return {'fill': S(fill_pts, origin, True), 'strokes': [S(s, origin) for s in strokes], 'details': [S(s, origin) for s in details]}


# ---------------------------------------------------------------- pivots (CR px)
TORSO_O = (282, 215)
NECK_O = (443, 164)          # neck base pivot (inside the chest, under the collar)
HEAD_MOUNT = (477, 100)      # top of the neck; the right profile head was traced with this origin
FRONT_SHOULDER = (412, 262)
FRONT_WRIST = (404.5, 398)   # centre of the leg at the upper segment's bottom cut (half-width 16.3)
FRONT_PAW = (409, 408)       # centre of the pastern at the paw cut (half-width 14)
HIND_HIP = (165, 228)
HIND_HOCK = (108, 368)       # half-width 16
HIND_PAW = (106.5, 410)      # half-width 13.5
TAIL_ROOT = (126, 186)
TAG_ANCHOR = (477, 180)

# ---------------------------------------------------------------- torso
back = pts('torso_back')                    # under the collar -> withers -> croup -> down the thigh line
belly = pts('torso_belly')                  # stifle -> elbow
chest = pts('torso_chest')                  # collar -> chest front -> front-leg junction
under_leg = [(400, 293), (425, 285)]        # hidden behind the near front leg
torso_fill = (back + [(130, 296, 'c'), (170, 300), (200, 262)] + belly + under_leg + rev(chest)
              + [(462, 166, 'c'), (440, 150), (418, 136)])
torso = seg(torso_fill, [back, belly + under_leg + rev(chest)], TORSO_O, [pts('chest_detail')])

# ---------------------------------------------------------------- neck + collar + tag
nb = pts('neck_back')                       # ear base -> collar
nt = pts('neck_throat')                     # jaw -> collar
neck_fill = nb + [(392, 146, 'c'), (412, 176), (450, 196), (466, 192, 'c')] + rev(nt) + [(497, 100), (482, 84), (462, 72)]
collar = T['collar']
collar_pts = [tuple(p) for p in collar]
# lower half of the band: bottom edge + a line 45% of the way up
top_edge = [(424, 131.5), (440, 146.5), (456, 159.5), (470, 167)]
bot_edge = [(464, 179.5), (456, 174.5), (448, 169.5), (440, 162.5), (432, 155.5), (424, 148.5), (416, 141.5), (408, 134.5)]
mid_edge = [(410, 128.5), (424, 140.5), (440, 155), (456, 167.5), (468, 172.5)]
collar_shadow = mid_edge + [(480, 175, 'c')] + [(480, 179, 'c')] + bot_edge + [(402, 131, 'c'), (403, 128, 'c')]
tag_ring = [(474, 180), (473, 185), (477, 188), (481, 185), (479, 180)]
tag = blob(477, 198, 6.2, 9.6, -3)
tag_shadow = [(479.5, 190.5), (483, 196), (483, 203), (479, 207.5, 'c'), (480.5, 202), (480.5, 195)]
neck = {
    **seg(neck_fill, [nb, nt], NECK_O),
    'headMount': rnd(sub(W(*HEAD_MOUNT), W(*NECK_O))),
    'collar': S(collar_pts, NECK_O, True),
    'collarShadow': S(collar_shadow, NECK_O, True),
    'tagRing': S(tag_ring, NECK_O),
    'tag': S(tag, NECK_O, True),
    'tagShadow': S(tag_shadow, NECK_O, True),
    'tagAnchor': rnd(sub(W(*TAG_ANCHOR), W(*NECK_O))),
}

# ---------------------------------------------------------------- front leg (near = anatomical RIGHT; far reuses it)
ff = until('fl_front', ymax=397) + [(420.8, 398)]
fr = until('fl_rear', ymax=397) + [(388.2, 398)]
fu_fill = [(381, 250, 'c'), (396, 238), (425, 236), (447, 250, 'c')] + ff + [(388.2, 398, 'c')] + rev(fr)
front_upper = seg(fu_fill, [ff, fr], FRONT_SHOULDER)
# lower (pastern): round top centred on the wrist pivot (hidden under the upper at rest), flat bottom at the paw cut
fl_rear = [(395, 408), (392, 404), (388.2, 398)]
fl_front = [(420.8, 398), (422, 403), (423, 408)]
front_lower = seg(fl_rear + [(388.2, 398, 'c'), (420.8, 398, 'c')] + fl_front + [(423, 408, 'c'), (395, 408, 'c')],
                  [fl_rear[::-1], fl_front], FRONT_WRIST)
fp = pts('fp_outline')
fp_vis = [(395, 408), (397, 412)] + [p for p in fp if p[1] >= 414] + [(424, 412), (423, 408)]
front_paw = seg(fp_vis + [(423, 408, 'c'), (395, 408, 'c')], [fp_vis], FRONT_PAW, [[(437, 431), (437, 436), (438, 440)], [(447, 432), (447, 436), (448, 439)]])

# ---------------------------------------------------------------- hind leg
hr = until('hl_rear', ymax=366) + [(92, 368)]
hf = until('hl_front', ymax=366) + [(124, 368)]
hu_fill = ([(220, 244, 'c'), (206, 222), (176, 210), (146, 208), (124, 214), (113, 232)] + hr + [(124, 368, 'c')] + rev(hf))
hind_upper = seg(hu_fill, [hr, hf], HIND_HIP)
hl_rear = [(93, 410), (92.5, 390), (92, 368)]
hl_front = [(124, 368), (122.5, 382), (120.5, 396), (120, 410)]
hind_lower = seg(hl_rear + [(92, 368, 'c'), (124, 368, 'c')] + hl_front + [(120, 410, 'c'), (93, 410, 'c')],
                 [hl_rear[::-1], hl_front], HIND_HOCK)
hp = pts('hp_outline')
hp_vis = [(93, 410)] + [p for p in hp if p[1] >= 418 or p[0] < 100] + [(121, 413), (120, 410)]
hind_paw = seg(hp_vis + [(120, 410, 'c'), (93, 410, 'c')], [hp_vis], HIND_PAW, [[(125, 431), (125, 436), (126, 440)], [(133, 432), (133, 436), (134, 440)]])

# ---------------------------------------------------------------- tail (behind the torso and near thigh)
tt = pts('tail_top')
tb = pts('tail_bot')
tail_fill = [(142, 166, 'c')] + tt + tb + [(124, 256), (127, 222), (136, 192)]
tail = {**seg(tail_fill, [tt, tb], TAIL_ROOT), 'tip': rnd(sub(W(*tt[-1][:2]), W(*TAIL_ROOT)))}

# ---------------------------------------------------------------- right-side markings (CR px) -> part local
spots = []


def spot(sid, part, segment, shape, origin, ref, desc, side='right'):
    if isinstance(shape, tuple):
        d = S(blob(*shape), origin, True)
    else:
        d = S(shape, origin, True)
    spots.append({'id': sid, 'side': side, 'part': part, 'segment': segment, 'path': d,
                  'ref': {'crop': 'badger_coat_right.png', 'x': ref[0], 'y': ref[1]}, 'desc': desc})


# ellipses measured from the dark blobs of coat_right (centre, semi-axes, rotation in degrees)
spot('R-01', 'torso', None, (159.1, 196.3, 16.2, 10.2, -43.6), TORSO_O, (159, 196), 'large spot on the croup / top of the right rump')
spot('R-02', 'torso', None, (255.0, 168.2, 15.0, 8.4, 4.5), TORSO_O, (255, 168), 'mid back behind the withers (right side)')
spot('R-03', 'torso', None, (291.0, 211.2, 9.4, 7.9, -17.8), TORSO_O, (291, 211), 'mid flank')
spot('R-04', 'torso', None, (377.8, 217.5, 10.2, 7.0, -54.4), TORSO_O, (378, 218), 'right shoulder')
spot('R-05', 'torso', None, (340.5, 252.7, 7.6, 5.4, -10.6), TORSO_O, (341, 253), 'lower ribs above the brisket line')
spot('R-NECK', 'neck', None, (460.2, 124.4, 6.5, 3.8, -73.2), NECK_O, (460, 124), 'side of the neck below the pale right ear, above the collar')
spot('R-06', 'legHindNear', 'upper', (189.9, 253.4, 11.0, 6.8, -69.0), HIND_HIP, (190, 253), 'front of the right thigh (stifle)')
spot('R-07', 'legHindNear', 'upper', (115.9, 347.1, 10.5, 5.8, -57.4), HIND_HIP, (116, 347), 'right gaskin, just above the hock')
spot('R-08', 'legFrontNear', 'upper', (408.0, 313.8, 12.2, 8.0, 88.5), FRONT_SHOULDER, (408, 314), 'forearm of the near (right) front leg')
# the large LEFT withers patch shows from the right only as a thin edge along the top line
spot('L-WITHERS', 'torso', None,
     [(340, 141, 'c'), (360, 140.5), (382, 137, 'c'), (378, 147), (366, 152), (352, 151.5), (344, 148.5)],
     TORSO_O, (360, 149), 'edge of the LEFT withers patch L-WITHERS where it wraps over the top line (seen from the right)', side='left')

tw = W(*TORSO_O)


def mount(cr, dx=0):
    return rnd(sub(W(cr[0] + dx, cr[1]), tw))


rig = {
    'torso': {'pivot': rnd(tw), **torso},
    'mounts': {
        'neck': mount(NECK_O),
        'tail': mount(TAIL_ROOT),
        'legFrontNear': mount(FRONT_SHOULDER),
        'legFrontFar': mount(FRONT_SHOULDER, FRONT_FAR_MOUNT_DX),
        'legHindNear': mount(HIND_HIP),
        'legHindFar': mount(HIND_HIP, HIND_FAR_DX),
    },
    'neck': neck,
    'legFront': {
        'upper': front_upper,
        'lowerPivot': rnd(sub(W(*FRONT_WRIST), W(*FRONT_SHOULDER))),
        'lower': front_lower,
        'pawPivot': rnd(sub(W(*FRONT_PAW), W(*FRONT_WRIST))),
        'paw': front_paw,
        'lowerJointR': round(16.3 * KX, 2),
        'pawJointR': round(14 * KX, 2),
    },
    'legHind': {
        'upper': hind_upper,
        'lowerPivot': rnd(sub(W(*HIND_HOCK), W(*HIND_HIP))),
        'lower': hind_lower,
        'pawPivot': rnd(sub(W(*HIND_PAW), W(*HIND_HOCK))),
        'paw': hind_paw,
        'lowerJointR': round(16 * KX, 2),
        'pawJointR': round(13.5 * KX, 2),
    },
    'tail': tail,
}

with open(sys.argv[1], 'w') as fh:
    fh.write('/**\n * RIGHT-view body rig of BADGER, world units (ZOO = 900). GENERATED by\n'
             ' * src/characters/badger/dev/trace/gen_right.py from traces over reference/crops/badger_coat_right.png\n'
             ' * (dog faces screen right, anatomical RIGHT side to camera; nothing is mirrored from the left view).\n'
             ' * Edit the tracer, not this file. Every path is in its PART\'s local space (origin = the part\'s pivot).\n */\n')
    fh.write('export const RIGHT_RIG = ' + json.dumps(rig, indent='\t') + ' as const;\n')

with open(sys.argv[2], 'w') as fh:
    json.dump({'const': 'RIGHT_SPOTS',
               'doc': ('Right-side markings for the RIGHT-view rig (badger_coat_right.png): 9 R- spots (R-01..R-08, R-NECK) '
                       'plus the thin top-line edge of the LEFT withers patch (id L-WITHERS, side left), as the coat map shows it. '
                       'Paths are in RIGHT_RIG part-local space.'),
               'spots': spots}, fh, indent=1)
print('ok', len(spots), 'right-view spots; footprint centre CR', (FOOT_MIN + FOOT_MAX) / 2,
      '; far-front stand reach (units):', round(KX * (FRONT_FAR_DX - FRONT_FAR_MOUNT_DX), 1))
