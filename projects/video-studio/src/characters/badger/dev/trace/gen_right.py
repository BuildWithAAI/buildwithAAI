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
from spline import spline, blob, arc_over, f2
from erode import erode_seg

# Legs are drawn stroke-under-fill (parts/Leg.tsx): fills and strokes are inset by half the outline width (erode.py).
INSET = 3.5 / 2

HERE = os.path.dirname(__file__)
T = json.load(open(os.path.join(HERE, 'traces', 'right.json')))

KX, KY = 0.9734, 1.0283
FRONT_FAR_DX = 30   # far (anatomical LEFT) front paw stands 30 CR px forward (decision R-STANCE) ...
FRONT_FAR_MOUNT_DX = 0  # ... from the same shoulder: the stand pose rotates the leg (IK) to reach the paw spot
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


def closed_run(points, p_start, p_end):
    """The piece of spline(points, closed=True) from point p_start forward (wrapping) to point p_end, with the closed
    spline's own tangents (CR px). Points are matched by position (spline() drops repeated points)."""
    full = spline(points, closed=True).replace(' Z', '')
    segs = full.split(' C ')
    body = segs[1:]
    n = len(body)
    xy = lambda t: tuple(float(v) for v in t.split()[-2:])
    # segment k runs from the end of segment k - 1 (segment 0 from the M point)
    starts = [xy(segs[0][2:])] + [xy(b) for b in body[:-1]]
    ends = [xy(b) for b in body]
    near = lambda a, b: abs(a[0] - b[0]) < 0.06 and abs(a[1] - b[1]) < 0.06
    k = next(i for i in range(n) if near(starts[i], p_start))
    out = ['M %s %s' % (f2(starts[k][0]), f2(starts[k][1]))]
    for _ in range(n):
        out.append('C ' + body[k])
        if near(ends[k], p_end):
            break
        k = (k + 1) % n
    return ' '.join(out)


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
# Round-2 repair (decision BADGER-D35): the part of the torso hidden behind the near thigh at rest is a real contour, stroked
# all the way round: the rump line tucks into a small rounded buttock under the hip and runs on, as the flank fold, into the
# belly line at the stifle (the fold fills the angle between belly and thigh when the thigh swings back). When the thigh swings in the walk, whatever it uncovers is outlined (it used to be an unstroked polygon that
# showed as white wedges behind and in front of the thigh). The belly line still owns the stifle corner (its first traced
# point is shared with the thigh's front edge), so the thigh stroke starts one point lower.
hidden = [(118, 267), (124, 275), (133, 281), (145, 284), (157, 283), (170, 279), (183, 276), (195, 270), (203, 261)]
stifle = [tuple(T['hl_front'][1])]
torso_fill = (back + hidden + stifle + belly + under_leg + rev(chest)
              + [(462, 166, 'c'), (440, 150), (418, 136)])
torso = seg(torso_fill, [back + hidden + stifle + belly + under_leg + rev(chest)], TORSO_O, [pts('chest_detail')])

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
ff = until('fl_front', ymax=397) + [(420.8, 398, 'c')]
fr = until('fl_rear', ymax=397) + [(388.2, 398, 'c')]
fu_fill = [(381, 250, 'c'), (396, 238), (425, 236), (447, 250, 'c')] + ff + [(388.2, 398, 'c')] + rev(fr)
front_upper = seg(fu_fill, [ff, fr], FRONT_SHOULDER)
# Round-2 repair (D35): the top of the upper leg (above the traced edges, hidden in the chest at rest) is outlined in the
# under-torso 'underlay' pass, so a fore leg swung forward in the walk never shows an unoutlined wedge at the elbow
front_upper['underlay'] = [map_path(closed_run(fu_fill, fr[0][:2], ff[0][:2]), local(FRONT_SHOULDER))]
# lower (pastern): round top centred on the wrist pivot (hidden under the upper at rest), flat bottom at the paw cut
fl_rear = [(395, 408, 'c'), (392, 404), (388.2, 398, 'c')]
fl_front = [(420.8, 398, 'c'), (422, 403), (423, 408, 'c')]
front_lower = seg(fl_rear + [(388.2, 398, 'c'), (420.8, 398, 'c')] + fl_front + [(423, 408, 'c'), (395, 408, 'c')],
                  [fl_rear[::-1], fl_front], FRONT_WRIST)
fp = pts('fp_outline')
fp_vis = [(395, 408), (397, 412)] + [p for p in fp if p[1] >= 414] + [(424, 412), (423, 408)]
front_paw = seg(fp_vis + [(423, 408, 'c'), (395, 408, 'c')], [fp_vis], FRONT_PAW, [[(437, 431), (437, 436), (438, 440)], [(447, 432), (447, 436), (448, 439)]])

# ---------------------------------------------------------------- hind leg
hr = until('hl_rear', ymax=366) + [(92, 368, 'c')]
hf = until('hl_front', ymax=366) + [(124, 368, 'c')]
# Round-2 repair (D35): above the stifle the front edge of the thigh runs straight on, high up into the flank (it used to
# turn back at a corner, so a thigh swung back or dropped by the pelvis slide showed a notch or a nub under the belly; now
# the visible front edge simply meets the belly line). Hidden inside the body at rest. The dome behind the hip stays low, so
# even with the walk's pelvis slide the (invisible) top of the thigh never covers the croup spot R-01.
hu_top = [(216, 241), (220, 231), (223, 220), (226, 208), (228, 197, 'c'), (214, 203), (198, 214), (182, 226), (164, 233),
          (144, 234), (126, 233), (116, 240)]
hu_fill = hu_top + hr + [(124, 368, 'c')] + rev(hf[1:])
# the back of the thigh down to the gaskin is outlined in the under-torso pass (below); drawn over the torso it left a
# free-ending tick on the buttock when the thigh swung forward
REAR_UNDER = 6   # hr[6] = (117, 314)
hind_upper = seg(hu_fill, [hr[REAR_UNDER:], hf[1:]], HIND_HIP)
# Round-2 repair (D35): the top of the thigh (stifle -> hip dome -> back of the thigh) is outlined in a pass drawn UNDER the
# torso (parts/Leg.tsx 'underlay'): when the thigh swings back and its top pushes out past the rump, that edge has a line,
# while inside the body the torso hides it. Cut from the closed fill spline, so it lies exactly on the fill edge.
hind_upper['underlay'] = [map_path(closed_run(hu_fill, hf[1][:2], hr[REAR_UNDER + 1][:2]), local(HIND_HIP))]
hl_rear = [(93, 410, 'c'), (92.5, 390), (92, 368, 'c')]
hl_front = [(124, 368, 'c'), (122.5, 382), (120.5, 396), (120, 410, 'c')]
hind_lower = seg(hl_rear + [(92, 368, 'c'), (124, 368, 'c')] + hl_front + [(120, 410, 'c'), (93, 410, 'c')],
                 [hl_rear[::-1], hl_front], HIND_HOCK)
hp = pts('hp_outline')
hp_vis = [(93, 410)] + [p for p in hp if p[1] >= 418 or p[0] < 100] + [(121, 413), (120, 410)]
hind_paw = seg(hp_vis + [(120, 410, 'c'), (93, 410, 'c')], [hp_vis], HIND_PAW, [[(125, 431), (125, 436), (126, 440)], [(133, 432), (133, 436), (134, 440)]])

# ---------------------------------------------------------------- tail (behind the torso and near thigh)
tt = pts('tail_top')
tb = pts('tail_bot')
# Round-2 repair (D35): the underside runs on as a smooth curve up to the root, and the WHOLE outline is stroked. The root
# stays inside the torso at every carriage the rig uses (tail -10..+45 deg), so a raised tail shows its underside outlined
# until it meets the rump (it used to end in an unstroked straight edge 40-50 units long).
tail_fill = [(142, 166, 'c')] + tt + tb + [(121, 262), (121, 240), (124, 218), (130, 200), (136, 190)]
tail = {'fill': S(tail_fill, TAIL_ROOT, True), 'strokes': [S(tail_fill, TAIL_ROOT, True)], 'details': [],
        'tip': rnd(sub(W(*tt[-1][:2]), W(*TAIL_ROOT)))}

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
# The withers patch L-WITHERS seen from the right (decision BADGER-D16, revised in round 2, 2026-11-24). The three coat maps
# disagree here: coat_right draws only a thickened top line, coat_top puts the front half of the patch across the spine
# (0.84 of the right half-width, which a level side view sees as a deep lobe below the top line). The turnaround (which
# controls identity and anatomy) breaks the tie, with the walking and looking-up panels: traced from badger_turn_side.png's
# rounded irregular lens (about 82 x 38 units below the top line, its front about 22 px behind the collar as on the sheet)
# and mapped into coat_right space by the collar's back edge on the top line (turn_side (424, 137) -> coat_right (407, 125))
# and the D17 / D14 scales (x 0.976, depth 0.924). The previous pointed wedge (a compromise that no drawing shows) is gone.
# The part above the top line is clipped by the torso. Authored on its own; never mirrored from the left record.
# OWNER CONFIRMATION REQUESTED: the alternative is coat_right's thin edge.
spot('L-WITHERS', 'torso', None,
     [(387, 137, 'c'), (385.5, 146), (381.5, 158), (376, 169.5), (368, 179), (357.5, 185.5), (344.5, 187), (331.5, 185),
      (319.5, 179.5), (309.5, 171), (302.5, 161), (299, 151), (298, 141, 'c'), (320, 138), (345, 137.5), (368, 137)],
     TORSO_O, (343, 165), 'right lobe of the withers patch L-WITHERS (it straddles the spine at the withers), seen from the right as badger_turn_side.png draws it', side='left')

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
        'upper': erode_seg(front_upper, INSET),
        'lowerPivot': rnd(sub(W(*FRONT_WRIST), W(*FRONT_SHOULDER))),
        'lower': erode_seg(front_lower, INSET),
        'pawPivot': rnd(sub(W(*FRONT_PAW), W(*FRONT_WRIST))),
        'paw': erode_seg(front_paw, INSET),
        'lowerJointR': round(15.8 * KX - INSET, 2),  # 0.5 px inside the leg's half-width at the cut, minus the inset
        'pawJointR': round(13.5 * KX - INSET, 2),
        'inset': INSET,
    },
    'legHind': {
        'upper': erode_seg(hind_upper, INSET),
        'lowerPivot': rnd(sub(W(*HIND_HOCK), W(*HIND_HIP))),
        'lower': erode_seg(hind_lower, INSET),
        'pawPivot': rnd(sub(W(*HIND_PAW), W(*HIND_HOCK))),
        'paw': erode_seg(hind_paw, INSET),
        'lowerJointR': round(15.5 * KX - INSET, 2),
        'pawJointR': round(13 * KX - INSET, 2),
        'inset': INSET,
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
                       'plus the right lobe of the withers patch (id L-WITHERS, side left) that the top coat map puts across the spine '
                       '(decision BADGER-D16). Paths are in RIGHT_RIG part-local space.'),
               'spots': spots}, fh, indent=1)
print('ok', len(spots), 'right-view spots; footprint centre CR', (FOOT_MIN + FOOT_MAX) / 2,
      '; far-front stand reach (units):', round(KX * (FRONT_FAR_DX - FRONT_FAR_MOUNT_DX), 1))
