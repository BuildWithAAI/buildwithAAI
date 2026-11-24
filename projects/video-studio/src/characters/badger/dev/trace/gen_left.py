"""Generate the LEFT-view body rig (world units) from traces made over
reference/crops/badger_coat_left.png ("CL" pixel space, 2x crop of the approved sheet).

CL -> world mapping (binding scale from badger_size_comparison.png, ZOO = 900 units):
  withers outer edge CL y=144 -> -312.6 ; ground CL y=443 -> 0              => ky = 1.0455
  chest front (outer) CL x=137 .. rump rear (outer) CL x=505 = 368 px -> 346 => kx = 0.9398
  origin x: centre of the footprint (far-front toe CL 133 .. near-hind heel CL 527) -> 0
"""
import json
import sys
sys.path.insert(0, __import__('os').path.dirname(__file__))
from pathmap import map_path, ellipse_path, arc_path
from erode import erode_seg

# Legs are drawn stroke-under-fill (parts/Leg.tsx): fills and strokes are inset by half the outline width so the visible
# outline keeps the traced silhouette (erode.py). Joint disks shrink by the same inset.
INSET = 3.5 / 2

KX, KY = 0.9398, 1.0455
OX = -310.1


def W(x, y):
    return (KX * x + OX, KY * (y - 443))


def rnd(p):
    return {'x': round(p[0], 1), 'y': round(p[1], 1)}


def local(origin_cl):
    ox, oy = W(*origin_cl)

    def f(x, y):
        X, Y = W(x, y)
        return (X - ox, Y - oy)
    return f


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1])


def P(d, origin):
    return map_path(d, local(origin))


def E(cx, cy, rx, ry, rot, origin):
    return map_path(ellipse_path(cx, cy, rx, ry, rot), local(origin))


# ---------------------------------------------------------------- pivots (CL px)
TORSO_O = (330, 215)
NECK_O = (188, 168)          # neck base pivot
HEAD_MOUNT = (155, 100)      # top of neck, where the head view attaches
FRONT_SHOULDER = (218, 262)  # near front leg root (before stance offset)
FRONT_WRIST = (214, 398)
FRONT_PAW = (207, 416.5)    # centre of the round paw cap (r 15.5), hidden under the pastern at rest
HIND_HIP = (458, 222)
HIND_HOCK = (506, 372)      # centre of the round hock cap (r 20) = middle of the upper's bottom cut
HIND_PAW = (506.5, 418)     # centre of the round paw cap (r 17.5)
TAIL_ROOT = (490, 200)

# stance offsets (CL px) taken from badger_size_comparison.png: the far legs stand forward
FRONT_NEAR_DX = 10
FRONT_FAR_DX = 10 - 38
HIND_NEAR_DX = 0
HIND_FAR_DX = -33

# ---------------------------------------------------------------- torso
# Round-2 repair (decision BADGER-D35): the part of the torso hidden behind the near thigh at rest is a real contour, stroked
# all the way round: the rump continues down into a small rounded buttock that tucks forward under the hip, and the belly
# line turns down past the stifle into the flank fold (it fills the angle between belly and thigh when the thigh swings back). When the thigh swings in the walk, whatever it uncovers is
# outlined (it used to be an unstroked polygon that showed as white wedges behind and in front of the thigh).
torso_fill = '''M 226 124 C 236 133 243 140 254 143 C 290 147 345 146 400 146
C 438 146 462 151 478 163 C 492 175 500 192 503 212 C 506 232 506 252 504 272
C 502 283 497 291 489 295 C 479 299 466 297 457 290 C 449 284 438 275 427 273 C 421 272 417 270 415 266
C 412 259 408 249 402 248
C 386 248 372 254 356 262 C 330 275 298 283 262 288 C 240 291 205 290 186 282
C 168 272 154 256 146 238 C 140 222 137 205 138 192 C 139 184 140 180 141 176 L 226 124 Z'''
torso_strokes = [
    'M 228 128 C 237 135 244 140 254 143 C 290 147 345 146 400 146 C 438 146 462 151 478 163 C 492 175 500 192 503 212 '
    'C 506 232 506 252 504 272 C 502 283 497 291 489 295 C 479 299 466 297 457 290 C 449 284 438 275 427 273 '
    'C 421 272 417 270 415 266 C 412 259 408 249 402 248 C 386 248 372 254 356 262 C 330 275 298 283 262 288 C 240 291 205 290 186 282 '
    'C 168 272 154 256 146 238 C 140 222 137 205 138 192 C 139 184 140 180 141 176',
]
torso_details = ['M 169 241 C 173 249 176 257 179 266']

# ---------------------------------------------------------------- neck
# the hidden extension below the collar stays inside the chest for neck rotations of -5..+22 deg
# Round-4 repair (R3 review, major: outline break at the nape of the left profile). On badger_coat_left.png the neck's back
# line leaves the dark ear at its lower-back corner, steep at first (rows 78-90: x 184 -> 190, slope 0.5), and runs into the
# old line. The rig's line used to start 2.8 px inside the ear's lower edge but under the profile head's skull fill, which
# bulged past it, so between the ear and the line only the unstroked skull edge showed (no outline at rows 385-388 of the
# review render), and the neck fill ran 2-5 px outside the line at the top (a coat sliver). Now:
#  * NAPE_J (the ear outline's lower-back corner) is where the line leaves the ear, steeper at first (slope 0.62; the sheet
#    0.5) and landing on the old line's end tangent above the collar (at most 1.3 px wider than before), and a straight
#    extension runs 12 px further up INSIDE the ear (the ear, drawn later with the head, hides it and its cap at any head
#    tilt within +-8 deg);
#  * the neck fill's back edge IS the stroke's centre line (it can no longer poke out past it);
#  * the profile head's skull fill tucks inside the line below NAPE_J and the head strokes its own back contour down to
#    NAPE_J (gen_heads.py PROFILE_L), so a folded ear (worried, judge) uncovers an outlined nape, not an open edge.
# KEEP IN SYNC with gen_heads.py NAPE_L_J.
NAPE_J = (187.0, 76.0)
NAPE_BACK = 'M 180.4 66 C 182.6 69.33 184.8 72.67 187 76 C 194.4 87.9 207.3 109 216 120'
neck_fill = ('M 180.4 66 C 182.6 69.33 184.8 72.67 187 76 C 194.4 87.9 207.3 109 216 120 '
             'C 226 132 236 142 248 148 L 238 168 L 186 196 L 152 194 '
             'L 142 183 C 141 176 141 168 139 158 C 136 146 131 133 126 120 C 122 108 132 92 150 84 C 162 78 172 70 180.4 66 Z')
neck_strokes = [
    NAPE_BACK + ' C 220 125 224 128 229 132',
    'M 125 118 C 130 130 135 143 139 156 C 141 165 141 172 141 179',
]
collar_fill = 'M 138 173 C 165 158 196 140 220 121 C 225 123 228 127 230 131 C 205 150 174 170 145 186 C 141 184 138 179 138 173 Z'
collar_shadow = 'M 230 131 C 205 150 174 170 145 186 C 143 185 142 184 141 182 C 168 167 199 148 228 128 Z'
tag_ring = 'M 144 184 C 141 186 141 191 145 192 C 149 193 151 188 148 185'
tag = E(147, 201, 5.2, 9.5, 4, NECK_O)
tag_shadow = 'M 150.5 193.5 C 154 198 154 206 150 210 C 148.5 211.5 147 210 148 208 C 151 203 151 198 150.5 193.5 Z'

# ---------------------------------------------------------------- front leg (near geometry; far reuses it)
fu_fill = '''M 190 236 C 204 226 234 228 247 240 C 247 256 244 272 240 290 C 236 318 233 355 231 398
L 197 398 C 196 360 193 322 190 292 C 188 270 184 248 190 236 Z'''
fu_strokes = [
    'M 190 292 C 193 322 196 360 197 398',
    'M 240 290 C 236 318 233 355 231 398',
]
# the top of each front-leg contour runs INSIDE the leg up into the chest (elbow / brisket creases): drawn on top of the
# fill at full outline width, in traced (un-inset) coordinates, so it joins the inset edge stroke seamlessly
fu_creases = ['M 199 250 C 194 262 191 276 190 292', 'M 239 263 C 240 272 240 282 240 290']
# Round-2 repair (D35): the top of the upper leg (above the visible edges, hidden in the chest at rest) is outlined in the
# under-torso 'underlay' pass, so a fore leg swung forward in the walk never shows an unoutlined wedge at the elbow
fu_underlay = 'M 190 292 C 188 270 184 248 190 236 C 204 226 234 228 247 240 C 247 256 244 272 240 290'
# Joints are round cut-out joints (Leg.tsx): parent and child meet on a flat cut through the joint pivot and a
# disk of the joint radius behind them closes the outline when the joint bends (walk). Visible edges unchanged.
fl_fill = 'M 188 413 C 193 410 196 404 197 398 L 231 398 C 230 405 228 410 224 416 L 222.5 416.5 L 191.5 416.5 Z'
fl_strokes = ['M 197 398 C 196 404 193 410 188 413', 'M 231 398 C 230 405 228 410 224 416']
fp_fill = ('M 188 413 C 178 413 168 419 163 427 C 159 434 160 441 168 442 L 214 443 C 220 443 223 438 223 430 '
           'C 223 425 223 420 224 416 L 222.5 416.5 L 191.5 416.5 Z')
fp_strokes = ['M 188 413 C 178 413 168 419 163 427 C 159 434 160 441 168 442 L 214 443 C 220 443 223 438 223 430 C 223 425 223 420 224 416']
fp_details = ['M 172 431 C 170 435 170 439 172 442', 'M 182 432 C 180 436 180 439 182 442']

# ---------------------------------------------------------------- hind leg
# Round-2 repair (D35): above the stifle the front edge of the thigh runs straight on, high up into the flank (it used to
# turn back at once, so a thigh swung back or dropped by the pelvis slide showed a notch or a nub under the belly; now the
# visible front edge simply meets the belly line). Hidden inside the body at rest. The dome behind the hip stays low, so even
# with the walk's pelvis slide the (invisible) top of the thigh never covers the croup spot L-02.
hu_fill = '''M 388 195 C 396 194 405 200 414 207 C 428 218 446 229 466 231 C 482 232 496 228 505 230 C 506 250 503 270 501 290
C 499 310 499 325 504 338 C 510 348 518 352 524 356 C 526 362 526 367 526 372 L 486 372 C 485 366 483 361 481 357
C 474 352 462 345 452 333 C 440 318 428 302 418 282 C 412 268 407 258 402 248 C 398 233 393 214 388 195 Z'''
hu_strokes = [
    'M 402 248 C 407 258 412 268 418 282 C 428 302 440 318 452 333 C 462 345 474 352 481 357 C 484 361 485 366 486 372',
    'M 504 338 C 510 348 518 352 524 356 C 526 362 526 367 526 372',
]
# Round-2 repair (D35): the top of the thigh (stifle -> hip dome -> back of the thigh) is outlined in a pass drawn UNDER the
# torso (parts/Leg.tsx 'underlay'), so when the thigh swings back and its top pushes out past the rump, that edge has a line,
# while inside the body the torso hides it.
# The back of the thigh is outlined in that pass too, down to the hock region (drawn over the torso it left a free-ending
# tick on the buttock when the thigh swung forward).
hu_underlay = ['M 402 248 C 398 233 393 214 388 195 C 396 194 405 200 414 207 C 428 218 446 229 466 231 C 482 232 496 228 505 230 '
               'C 506 250 503 270 501 290 C 499 310 499 325 504 338']
hl_fill = 'M 488 417 C 488 404 487 388 486 372 L 526 372 C 526 390 526 405 525 418 L 524 418 L 489 418 Z'
hl_strokes = ['M 486 372 C 487 388 488 404 488 417', 'M 526 372 C 526 390 526 405 525 418']
hp_fill = ('M 488 417 C 482 418 477 424 476 431 C 475 438 478 442 484 443 L 520 443 C 525 443 527 439 527 433 '
           'C 527 428 526 423 525 418 L 524 418 L 489 418 Z')
hp_strokes = ['M 488 417 C 482 418 477 424 476 431 C 475 438 478 442 484 443 L 520 443 C 525 443 527 439 527 433 C 527 428 526 423 525 418']
hp_details = ['M 486 432 C 484 436 484 439 486 442', 'M 495 433 C 493 437 493 440 495 442']

# ---------------------------------------------------------------- tail (authored outline, CL px)
# Broad sabre: outer edge continues the croup line, inner edge nearly horizontal toward the tip.
# Round-2 repair (D35): the underside runs on as a smooth curve up to the root, and the WHOLE outline is stroked. The root
# stays inside the torso at every carriage the rig uses (tail -10..+45 deg), so a raised tail shows its underside outlined
# until it meets the rump (it used to end in an unstroked straight edge 40-50 units long).
tail_fill = '''M 499 188 C 510 200 521 225 531 250 C 541 274 553 293 568 306
C 577 313 584 318 590 321 C 580 324 566 323 551 320 C 534 316 518 308 507 299 C 498 292 490 278 485 261
C 481 247 479 231 480 217 C 481 204 489 192 499 188 Z'''
tail_strokes = [tail_fill]
TAIL_TIP = (590, 321)

# ---------------------------------------------------------------- spots (CL px) -> part local
spots = []


def spot(sid, part, segment, d_or_ellipse, origin, ref, desc, side='left', crop='badger_coat_left.png'):
    if isinstance(d_or_ellipse, str):
        d = P(d_or_ellipse, origin)
    else:
        d = E(*d_or_ellipse, origin)
    spots.append({'id': sid, 'side': side, 'part': part, 'segment': segment, 'path': d,
                  'ref': {'crop': crop, 'x': ref[0], 'y': ref[1]}, 'desc': desc})


# L-WITHERS: large irregular patch high on the back by the left withers (shares the top line; clipped)
# Retraced 2026-11-24 (decision BADGER-D28): coat_left's own top line over the patch lies ~5 px lower than the rig's (which
# is pinned to the binding withers height), so the lower edge sits 5 px higher than the raw trace to keep coat_left's depth
# below the top line (aspect ~2.3, as on coat_left and the size panel); the front tip starts 7 px further back so the
# default left view keeps the size panel's clear gap behind the collar.
spot('L-WITHERS', 'torso', None,
     'M 243 137 C 252 140 266 141 282 141 C 300 141 318 140 332 140 C 333 153 328 166 314 175 C 300 183 281 183 267 177 C 255 171 247 156 243 137 Z',
     TORSO_O, (286, 162), 'large irregular dark patch high on the back at the left withers')
spot('L-01', 'torso', None, (391, 166, 13, 7.2, -4), TORSO_O, (391, 166), 'mid back, behind the withers patch')       # mid back, behind the patch
spot('L-02', 'torso', None, (464, 198, 10.5, 14, -28), TORSO_O, (464, 198), 'croup / top of the rump')     # croup / rump
spot('L-03', 'torso', None, (249, 218, 10, 11.5, -25), TORSO_O, (249, 218), 'shoulder blade')     # shoulder
spot('L-04', 'torso', None, (350, 206, 10, 8, -8), TORSO_O, (350, 206), 'mid flank')         # mid flank
spot('L-05', 'torso', None, (290, 251, 8.5, 5.5, -6), TORSO_O, (290, 251), 'lower ribs above the brisket line')      # lower ribs / belly
spot('L-NECK', 'neck', None, (164, 128, 4.6, 7.4, 12), NECK_O, (164, 128), 'side of the neck below the ear, above the collar')        # side of neck under the ear
spot('L-06', 'legHindNear', 'upper', (430, 253, 7.5, 11.5, -8), HIND_HIP, (430, 253), 'front of the thigh (hip)')   # hip / upper thigh
spot('L-07', 'legHindNear', 'upper', (481, 272, 5, 9.2, -6), HIND_HIP, (481, 272), 'back of the thigh')      # rear thigh
spot('L-08', 'legHindNear', 'upper', (501, 348, 4.6, 6, -30), HIND_HIP, (501, 348), 'gaskin, just above the hock')     # just above the hock
spot('L-09', 'legFrontNear', 'upper', (210, 314, 7.6, 12.2, -3), FRONT_SHOULDER, (210, 314), 'forearm of the near (left) front leg')  # forearm

# Round-4 repair (R3 review minor): the FAR front leg is the anatomical RIGHT foreleg. badger_pose_walking.png shows its
# forearm mark as a dark edge on the far foreleg's BACK contour (the sit, lie and 3/4 bodies show theirs too), so the walk
# rigs carry an edge record on legFrontFar (parts/SideBody.tsx draws far-leg spots for edge records only). It is R-08,
# authored from badger_coat_right.png's OWN R-08 (dev/trace/coatmaps.py: 35.7% down the forearm from the elbow tip to the
# wrist cut, coat_right's own size, the across axis foreshortened to EDGE_K, its own 1.6 deg tilt), placed on this rig's
# forearm back contour (the far leg reuses the near leg's unmarked outline), centred on the contour so the leg clip shows
# the part that wraps round that edge (its centre 2.3 units inside the contour, so about 6 units show, as on the walking
# panel). Nothing here comes from L-09 or any other left record.
from coatmaps import along as _along, size_units as _size_units, tilt_back as _tilt_back
import math as _m


def _cubic_at_y(d, y):
    """x and unit tangent (pointing down) where the one-segment cubic path d crosses height y (CL px)."""
    v = [float(t) for t in d.replace('M', ' ').replace('C', ' ').split()]
    p0, p1, p2, p3 = (v[0], v[1]), (v[2], v[3]), (v[4], v[5]), (v[6], v[7])
    B = lambda t, i: (1 - t) ** 3 * p0[i] + 3 * (1 - t) ** 2 * t * p1[i] + 3 * (1 - t) * t * t * p2[i] + t ** 3 * p3[i]
    lo, hi = 0.0, 1.0
    for _ in range(60):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if B(mid, 1) < y else (lo, mid)
    t = (lo + hi) / 2
    dx, dy = B(t + 1e-4, 0) - B(t - 1e-4, 0), B(t + 1e-4, 1) - B(t - 1e-4, 1)
    L = _m.hypot(dx, dy)
    return B(t, 0), (dx / L, dy / L)


FL_ELBOW_Y, FL_WRIST_Y = 265.0, FRONT_WRIST[1]       # this rig's forearm, traced on coat_left (coatmaps.py rule)
_y_r08 = FL_ELBOW_Y + _along('R-08') * (FL_WRIST_Y - FL_ELBOW_Y)
_x_r08, (_tx, _ty) = _cubic_at_y(fu_strokes[1], _y_r08)    # the forearm's back contour (left-facing: back = +x)
_ac, _al = _size_units('R-08', edge=True)
# badger_pose_walking.png draws the far mark about 6 units wide inside the back contour, so the centre sits EDGE_IN units
# inside the traced contour (toward -x here): about 6 units of it show inside the leg's outline
EDGE_IN = 2.3
_x_r08 -= EDGE_IN / KX
# ellipse_path: rx across (x), ry along (y), rotated; the long axis follows the contour, its top leaning back (+x) by the
# map's own tilt
_rot_r08 = _m.degrees(_m.atan2(-_tx, _ty)) + _tilt_back('R-08')
spot('R-08', 'legFrontFar', 'upper', (round(_x_r08, 2), round(_y_r08, 2), round(_ac / KX, 2), round(_al / KY, 2), round(_rot_r08, 1)),
     FRONT_SHOULDER, (408, 314), 'right forearm R-08 on the far front leg (its back edge, as badger_pose_walking.png shows the far forearm mark), '
     'authored from badger_coat_right.png R-08', side='right', crop='badger_coat_right.png')


def seg(fill, strokes, origin, details=None):
    return {'fill': P(fill, origin), 'strokes': [P(s, origin) for s in strokes], 'details': [P(s, origin) for s in (details or [])]}


tw = W(*TORSO_O)


def mount(cl, dx=0):
    p = W(cl[0] + dx, cl[1])
    return rnd(sub(p, tw))


rig = {
    'torso': {'pivot': rnd(tw), **seg(torso_fill, torso_strokes, TORSO_O, torso_details)},
    'mounts': {
        'neck': mount(NECK_O),
        'tail': mount(TAIL_ROOT),
        'legFrontNear': mount(FRONT_SHOULDER, FRONT_NEAR_DX),
        'legFrontFar': mount(FRONT_SHOULDER, FRONT_FAR_DX),
        'legHindNear': mount(HIND_HIP, HIND_NEAR_DX),
        'legHindFar': mount(HIND_HIP, HIND_FAR_DX),
    },
    'neck': {**seg(neck_fill, neck_strokes, NECK_O), 'headMount': rnd(sub(W(*HEAD_MOUNT), W(*NECK_O))),
             'collar': P(collar_fill, NECK_O), 'collarShadow': P(collar_shadow, NECK_O),
             'tagRing': P(tag_ring, NECK_O), 'tag': tag, 'tagShadow': P(tag_shadow, NECK_O),
             'tagAnchor': rnd(sub(W(146, 186), W(*NECK_O)))},
    'legFront': {
        'upper': {**erode_seg({**seg(fu_fill, fu_strokes, FRONT_SHOULDER), 'underlay': [P(fu_underlay, FRONT_SHOULDER)]}, INSET),
                  'creases': [P(c, FRONT_SHOULDER) for c in fu_creases]},
        'lowerPivot': rnd(sub(W(*FRONT_WRIST), W(*FRONT_SHOULDER))),
        'lower': erode_seg(seg(fl_fill, fl_strokes, FRONT_WRIST), INSET),
        'pawPivot': rnd(sub(W(*FRONT_PAW), W(*FRONT_WRIST))),
        'paw': erode_seg(seg(fp_fill, fp_strokes, FRONT_PAW, fp_details), INSET),
        'lowerJointR': round(16.5 * KX - INSET, 2),  # 0.5 px inside the leg's half-width at the cut, minus the inset
        'pawJointR': round(15 * KX - INSET, 2),
        'inset': INSET,
    },
    'legHind': {
        'upper': erode_seg({**seg(hu_fill, hu_strokes, HIND_HIP), 'underlay': [P(u, HIND_HIP) for u in hu_underlay]}, INSET),
        'lowerPivot': rnd(sub(W(*HIND_HOCK), W(*HIND_HIP))),
        'lower': erode_seg(seg(hl_fill, hl_strokes, HIND_HOCK), INSET),
        'pawPivot': rnd(sub(W(*HIND_PAW), W(*HIND_HOCK))),
        'paw': erode_seg(seg(hp_fill, hp_strokes, HIND_PAW, hp_details), INSET),
        'lowerJointR': round(19.5 * KX - INSET, 2),
        'pawJointR': round(17 * KX - INSET, 2),
        'inset': INSET,
    },
    'tail': {**seg(tail_fill, tail_strokes, TAIL_ROOT), 'tip': rnd(sub(W(*TAIL_TIP), W(*TAIL_ROOT)))},
}

out = sys.argv[1]
with open(out, 'w') as fh:
    fh.write('/**\n * LEFT-view body rig of BADGER, world units (ZOO = 900). GENERATED by\n'
             ' * src/characters/badger/dev/trace/gen_left.py from traces over reference/crops/badger_coat_left.png,\n'
             ' * rescaled to the binding size-comparison dimensions (see manifest.ts). Edit the tracer, not this file.\n'
             ' * Every path is in its PART\'s local space (origin = the part\'s pivot).\n */\n')
    fh.write('export const LEFT_RIG = ' + json.dumps(rig, indent='\t') + ' as const;\n')

with open(sys.argv[2], 'w') as fh:
    json.dump(spots, fh, indent=1)
print('ok', len(spots), 'spots')
