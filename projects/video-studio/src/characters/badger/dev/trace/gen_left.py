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
torso_fill = '''M 226 124 C 236 133 243 140 254 143 C 290 147 345 146 400 146
C 438 146 462 151 478 163 C 492 175 500 192 503 212 C 506 232 506 252 504 272
L 470 300 L 412 262 L 402 248
C 386 248 372 254 356 262 C 330 275 298 283 262 288 C 240 291 205 290 186 282
C 168 272 154 256 146 238 C 140 222 137 205 138 192 C 139 184 140 180 141 176 L 226 124 Z'''
torso_strokes = [
    'M 228 128 C 237 135 244 140 254 143 C 290 147 345 146 400 146 C 438 146 462 151 478 163 C 492 175 500 192 503 212 C 506 232 506 252 504 272',
    'M 402 248 C 386 248 372 254 356 262 C 330 275 298 283 262 288 C 240 291 205 290 186 282 C 168 272 154 256 146 238 C 140 222 137 205 138 192 C 139 184 140 180 141 176',
]
torso_details = ['M 169 241 C 173 249 176 257 179 266']

# ---------------------------------------------------------------- neck
# the hidden extension below the collar stays inside the chest for neck rotations of -5..+22 deg
neck_fill = '''M 186 72 C 196 90 206 106 216 120 C 226 132 236 142 248 148 L 238 168 L 186 196 L 152 194
L 142 183 C 141 176 141 168 139 158 C 136 146 131 133 126 120 C 122 108 132 92 150 84 C 164 77 176 71 186 72 Z'''
neck_strokes = [
    'M 183 76 C 194 90 205 106 216 120 C 220 125 224 128 229 132',
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
    'M 199 250 C 194 262 191 276 190 292 C 193 322 196 360 197 398',
    'M 239 263 C 240 272 240 282 240 290 C 236 318 233 355 231 398',
]
# Joints are round cut-out joints: each child segment has a cap centred on its pivot that stays hidden under
# the parent at rest and closes the outline when the joint bends (walk). Visible edges are unchanged.
fl_line = 'M 188 413 C 193 410 196 404 197 398 ' + arc_path(214, 398, 17, 17, 180, 360) + ' C 230 405 228 410 224 416'
fl_fill = fl_line + ' L 222.5 418.5 L 190 418.5 Z'
fl_strokes = [fl_line]
fp_line = ('M 188 413 C 178 413 168 419 163 427 C 159 434 160 441 168 442 L 214 443 C 220 443 223 438 223 430 '
           'C 223 425 223 420 224 416 L 222.5 416.5 ' + arc_path(207, 416.5, 15.5, 15.5, 360, 180))
fp_fill = fp_line + ' L 188 413 Z'
fp_strokes = [fp_line]
fp_details = ['M 172 431 C 170 435 170 439 172 442', 'M 182 432 C 180 436 180 439 182 442']

# ---------------------------------------------------------------- hind leg
hu_fill = '''M 404 238 C 424 222 470 213 505 230 C 506 250 503 270 501 290 C 499 310 499 325 504 338
C 510 348 518 352 524 356 C 526 362 526 367 526 372 L 486 372 C 485 366 483 361 481 357
C 474 352 462 345 452 333 C 440 318 428 302 418 282 C 412 268 407 258 402 248 C 401 244 402 241 404 238 Z'''
hu_strokes = [
    'M 402 248 C 407 258 412 268 418 282 C 428 302 440 318 452 333 C 462 345 474 352 481 357 C 484 361 485 366 486 372',
    'M 504 268 C 503 278 501 285 500 292 C 499 310 499 325 504 338 C 510 348 518 352 524 356 C 526 362 526 367 526 372',
]
hl_line = 'M 488 417 C 488 404 487 388 486 372 ' + arc_path(506, 372, 20, 20, 180, 360) + ' C 526 390 526 405 525 418'
hl_fill = hl_line + ' L 524 420.5 L 488 420.5 Z'
hl_strokes = [hl_line]
hp_line = ('M 488 417 C 482 418 477 424 476 431 C 475 438 478 442 484 443 L 520 443 C 525 443 527 439 527 433 '
           'C 527 428 526 423 525 418 L 524 418 ' + arc_path(506.5, 418, 17.5, 17.5, 360, 180))
hp_fill = hp_line + ' L 488 417 Z'
hp_strokes = [hp_line]
hp_details = ['M 486 432 C 484 436 484 439 486 442', 'M 495 433 C 493 437 493 440 495 442']

# ---------------------------------------------------------------- tail (authored outline, CL px)
# Broad sabre: outer edge continues the croup line, inner edge nearly horizontal toward the tip.
tail_fill = '''M 478 210 C 486 198 493 190 499 188 C 510 200 521 225 531 250 C 541 274 553 293 568 306
C 577 313 584 318 590 321 C 580 324 566 323 551 320 C 534 316 518 308 507 299 C 498 292 490 278 484 258 Z'''
tail_strokes = [
    'M 499 188 C 510 200 521 225 531 250 C 541 274 553 293 568 306 C 577 313 584 318 590 321',
    'M 590 321 C 580 324 566 323 551 320 C 534 316 518 308 507 299 C 504 297 502 295 500 292',
]
TAIL_TIP = (590, 321)

# ---------------------------------------------------------------- spots (CL px) -> part local
spots = []


def spot(sid, part, segment, d_or_ellipse, origin, ref, desc):
    if isinstance(d_or_ellipse, str):
        d = P(d_or_ellipse, origin)
    else:
        d = E(*d_or_ellipse, origin)
    spots.append({'id': sid, 'side': 'left', 'part': part, 'segment': segment, 'path': d,
                  'ref': {'crop': 'badger_coat_left.png', 'x': ref[0], 'y': ref[1]}, 'desc': desc})


# L-WITHERS: large irregular patch high on the back by the left withers (shares the top line; clipped)
spot('L-WITHERS', 'torso', None,
     'M 236 136 C 246 139 262 141 280 141 C 300 141 318 140 332 140 C 333 156 327 172 312 181 C 298 189 278 188 263 180 C 250 172 242 157 236 136 Z',
     TORSO_O, (284, 164), 'large irregular dark patch high on the back at the left withers')
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
        'upper': seg(fu_fill, fu_strokes, FRONT_SHOULDER),
        'lowerPivot': rnd(sub(W(*FRONT_WRIST), W(*FRONT_SHOULDER))),
        'lower': seg(fl_fill, fl_strokes, FRONT_WRIST),
        'pawPivot': rnd(sub(W(*FRONT_PAW), W(*FRONT_WRIST))),
        'paw': seg(fp_fill, fp_strokes, FRONT_PAW, fp_details),
    },
    'legHind': {
        'upper': seg(hu_fill, hu_strokes, HIND_HIP),
        'lowerPivot': rnd(sub(W(*HIND_HOCK), W(*HIND_HIP))),
        'lower': seg(hl_fill, hl_strokes, HIND_HOCK),
        'pawPivot': rnd(sub(W(*HIND_PAW), W(*HIND_HOCK))),
        'paw': seg(hp_fill, hp_strokes, HIND_PAW, hp_details),
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
