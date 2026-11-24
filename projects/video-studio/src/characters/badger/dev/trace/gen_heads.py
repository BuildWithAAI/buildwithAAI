"""Generate BADGER head views (head-local world units) from traces over the approved sheet crops.

Spaces (all crops are 2x the approved sheet):
  NF = reference/crops/badger_expr_neutral.png (front head). Skull width 116..292 px -> ~98 units
       (size-comparison panel: skull ~101 units). s = 0.5556, origin NF (208, 215) (mouth centre).
  CL = reference/crops/badger_coat_left.png (left profile). Body factors kx 0.9398, ky 1.0455 so the
       profile keeps the coat map's head:body ratio. Origin CL (155, 100) = top of the neck.
  CR = reference/crops/badger_coat_right.png (right profile), same factors, origin CR (477, 100).
Construction (recorded in manifest.ts):
  * threeQuarterLeft/RightScreen: the FRONT head turned with a depth field (features move by depth,
    each ear keeps its own front-view shape, colour and marking). Nothing is mirrored.
  * upLeft/RightScreen: the matching profile pitched nose-up about the head pivot, plus a throat bridge.
All markings are authored per view on their ANATOMICAL side.
"""
import json
import math
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
from pathmap import map_path, ellipse_path

OUT_TS, OUT_JSON = sys.argv[1], sys.argv[2]


def mp(d, f):
    return map_path(d, f)


def me(cx, cy, rx, ry, rot, f):
    return map_path(ellipse_path(cx, cy, rx, ry, rot), f)


def pt(x, y, f):
    X, Y = f(x, y)
    return {'x': round(X, 2), 'y': round(Y, 2)}


def lin(ox, oy, kx, ky):
    def f(x, y):
        return ((x - ox) * kx, (y - oy) * ky)
    return f


def compose(*fs):
    def f(x, y):
        for g in fs:
            x, y = g(x, y)
        return (x, y)
    return f


def rotate_about(deg, cx=0.0, cy=0.0):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)

    def f(x, y):
        X, Y = x - cx, y - cy
        return (cx + X * c - Y * s, cy + X * s + Y * c)
    return f


heads = {}
markings = {'H-EAR-R-SPOT': {}, 'H-CHEEK-L': {}, 'H-CHEEK-R': {}}

# =============================================================================== FRONT source (NF px)
S_NF = 0.5556
F = lin(208, 215, S_NF, S_NF)

FRONT = {
    'skull_fill': ('M 141 31 C 165 23 245 22 262 29 L 289 92 C 293 118 294 148 288 162 C 284 170 280 174 277 177 '
                   'C 271 192 262 205 252 216 C 244 230 228 243 208 244 C 188 243 172 230 164 216 '
                   'C 154 205 145 192 139 177 C 135 173 131 169 127 162 C 120 148 115 125 116 100 L 122 40 Z'),
    'skull_strokes': [
        'M 158 31 C 175 25 195 22 207 22 C 225 22 245 26 258 32',
        'M 113 104 C 112 125 114 145 119 158 C 122 165 125 170 129 175',
        'M 293 100 C 295 120 294 145 289 158 C 286 165 282 171 278 176',
    ],
    'shadows': [('M 190 193 C 200 199 216 199 226 193 C 230 203 236 212 246 216 C 240 232 226 246 208 247 '
                 'C 190 246 176 232 170 216 C 180 212 186 203 190 193 Z', 'coatShadow')],
    'cheekR': (134, 160, 4.8, 8.6, -16),
    'cheekL': (282, 158, 4.3, 8.2, 16),
    'nose': ('M 208 154 C 224 154 236 159 236 170 C 236 181 226 190 215 196 C 211 198 205 198 201 196 '
             'C 190 190 185 181 185 170 C 185 159 192 154 208 154 Z'),
    'philtrum': 'M 208 197 L 208 211',
    # eyes: (cx, cy, half-width, up, low, inner-corner drop, inner dir, iris r, iris dx, iris dy, side)
    'eyes': [(156, 103, 21, 10.5, 10, 10, 1, 10.6, 0.5, 1, 'R'), (259, 103, 21, 10.5, 10, 10, -1, 10.6, -0.5, 1, 'L')],
    'brows': [((139, 85), (157, 76), (176, 81), 'R'), ((277, 85), (259, 76), (240, 81), 'L')],
    'mouth': {
        'neutral': {'strokes': ['M 129 175 C 137 190 147 204 160 214 C 176 219 193 217 208 211 C 223 217 240 219 252 214 C 261 204 270 191 278 176'],
                    'details': ['M 185 228 C 197 231 219 231 231 228'], 'fills': []},
        'happy': {'strokes': ['M 129 175 C 133 183 137 189 142 194 C 152 205 166 213 182 216 C 194 218 202 216 208 212 '
                              'C 214 216 222 218 234 216 C 250 213 264 205 274 194 C 279 189 282 183 286 176'],
                  'details': ['M 178 225 C 194 240 222 240 238 225'], 'fills': []},
        'worried': {'strokes': ['M 129 175 C 137 190 147 205 161 215 C 176 216 192 222 208 217 C 222 213 238 220 252 215 C 261 204 270 191 278 176'],
                    'details': ['M 190 231 C 200 228 216 228 226 231'], 'fills': []},
        'shocked': {'strokes': ['M 129 175 C 137 190 148 206 164 216', 'M 278 176 C 270 191 260 206 252 216',
                                'M 184 213 C 190 203 226 203 232 213 C 236 226 224 240 208 240 C 192 240 180 226 184 213 Z'],
                    'details': [],
                    'fills': [('M 184 213 C 190 203 226 203 232 213 C 236 226 224 240 208 240 C 192 240 180 226 184 213 Z', 'mouth'),
                              ('M 190 231 C 198 225 218 225 226 231 C 222 238 194 238 190 231 Z', 'tongue')]},
    },
    # pale ANATOMICAL RIGHT ear (screen left in the front view): flap + pink ribbon + small spot
    'earR': {
        'pivot': (126, 66), 'backRot': -6, 'backSx': 0.68,
        'fills': [
            ('M 158 31 C 150 25 136 17 122 17 C 109 17 97 26 86 35 C 72 45 52 55 40 66 C 34 72 35 86 42 93 '
             'C 50 102 60 113 70 116 C 77 117 83 111 89 104 C 96 107 104 111 113 113 C 114 100 118 82 124 66 '
             'C 129 56 135 50 141 47 C 147 42 153 36 158 31 Z', 'coat', False),
            ('M 92 102 C 96 85 100 68 106 55 C 110 45 116 37 123 35 C 128 34 133 38 136 45 C 132 52 127 59 124 66 '
             'C 118 80 115 92 113 106 C 105 104 98 103 92 102 Z', 'earPaleInner', True),
            (ellipse_path(88, 51, 4.6, 9.0, 28), 'spot', True),
        ],
        'strokes': [
            'M 158 31 C 150 25 136 17 122 17 C 109 17 97 26 86 35 C 72 45 52 55 40 66 C 34 72 35 86 42 93 '
            'C 50 102 60 113 70 116 C 77 117 83 111 89 104 C 96 107 104 111 113 113',
            'M 92 102 C 96 85 100 68 106 55 C 110 45 116 37 123 35 C 128 34 133 38 136 45',
            'M 141 47 C 135 52 128 58 124 66 C 118 80 115 92 113 106',
        ],
        'details': ['M 121 62 C 122 66 122 70 122 74'],
        'spot': (88, 51, 4.6, 9.0, 28),
    },
    # dark-capped ANATOMICAL LEFT ear (screen right in the front view)
    'earL': {
        'pivot': (285, 60), 'backRot': 6, 'backSx': 0.68,
        'fills': [
            ('M 296 104 C 297 92 299 80 303 70 C 310 60 325 58 334 64 C 337 68 338 72 337 75 '
             'C 330 84 316 94 303 106 C 300 108 297 107 296 104 Z', 'earPaleInner', False),
            ('M 254 33 C 264 24 278 17 292 17 C 312 19 335 38 352 52 C 362 60 366 72 365 84 C 364 94 360 101 354 101 '
             'C 349 100 345 93 341 86 C 338 79 336 70 332 65 C 324 58 310 57 301 63 C 294 68 291 78 291 88 '
             'C 291 94 292 98 293 101 C 288 90 280 70 272 55 C 266 45 260 38 254 33 Z', 'earCap', False),
        ],
        'strokes': [
            'M 337 75 C 330 84 316 94 303 106 C 300 108 297 108 295 104',
            'M 254 33 C 264 24 278 17 292 17 C 312 19 335 38 352 52 C 362 60 366 72 365 84 C 364 94 360 101 354 101 '
            'C 349 100 345 93 341 86 C 338 79 336 70 332 65 C 324 58 310 57 301 63 C 294 68 291 78 291 88 '
            'C 291 94 292 98 293 101 C 288 90 280 70 272 55 C 266 45 260 38 254 33 Z',
        ],
        'details': [],
    },
}


def build_ear(src, f, side, sx_extra=1.0):
    return {'side': side, 'pivot': pt(*src['pivot'], f), 'backRot': src['backRot'], 'backSx': src['backSx'] * sx_extra,
            'fills': [{'d': mp(d, f), 'color': c, **({'clip': True} if clip else {})} for (d, c, clip) in src['fills']],
            'strokes': [mp(d, f) for d in src['strokes']], 'details': [mp(d, f) for d in src['details']]}


def build_from_front(src, fFace, fSkull, fEarR, fEarL, view, eye_w=(1.0, 1.0), ears_behind=()):
    """Map the front source through per-feature mappers (identity turn for the front view)."""
    def eye(e, wk):
        cx, cy, w, up, low, drop, inner, ir, idx, idy, side = e
        c = pt(cx, cy, fFace)
        # local x-scale of the face mapper at the eye (finite difference) handles turn compression
        x1 = fFace(cx - w, cy)[0]
        x2 = fFace(cx + w, cy)[0]
        ww = abs(x2 - x1) / 2 * wk
        return {'side': side, 'c': c, 'w': round(ww, 2), 'up': round(up * S_NF, 2), 'low': round(low * S_NF, 2),
                'drop': round(drop * S_NF, 2), 'inner': inner, 'irisR': round(ir * S_NF, 2),
                'irisDX': round(idx * S_NF, 2), 'irisDY': round(idy * S_NF, 2), 'profile': False, 'rot': 0}

    cheekR = me(*src['cheekR'], fFace)
    cheekL = me(*src['cheekL'], fFace)
    markings['H-CHEEK-R'][view] = cheekR
    markings['H-CHEEK-L'][view] = cheekL
    markings['H-EAR-R-SPOT'][view] = me(*src['earR']['spot'], fEarR)
    earR = build_ear(src['earR'], fEarR, 'R')
    earL = build_ear(src['earL'], fEarL, 'L')
    behind = [e for e, s in ((earR, 'R'), (earL, 'L')) if s in ears_behind]
    front = [e for e, s in ((earR, 'R'), (earL, 'L')) if s not in ears_behind]
    return {
        'earsBehind': behind,
        'skull': {'fill': mp(src['skull_fill'], fSkull), 'strokes': [mp(d, fSkull) for d in src['skull_strokes']], 'details': []},
        'shadows': [{'d': mp(d, fFace), 'color': c} for d, c in src['shadows']],
        'markings': [{'id': 'H-CHEEK-R', 'd': cheekR}, {'id': 'H-CHEEK-L', 'd': cheekL}],
        'nose': {'d': mp(src['nose'], fFace)},
        'philtrum': mp(src['philtrum'], fFace),
        'eyes': [eye(e, eye_w[i]) for i, e in enumerate(src['eyes'])],
        'brows': [{'side': s, 'outer': pt(*o, fFace), 'mid': pt(*m, fFace), 'inner': pt(*i, fFace)} for (o, m, i, s) in src['brows']],
        'mouth': {k: {'strokes': [mp(d, fFace) for d in v['strokes']], 'details': [mp(d, fFace) for d in v['details']],
                      'fills': [{'d': mp(d, fFace), 'color': c} for d, c in v['fills']]} for k, v in src['mouth'].items()},
        'earsFront': front,
    }


heads['front'] = build_from_front(FRONT, F, F, F, F, 'front')

# ------------------------------------------------------------------------------- 3/4 via depth-field turn
R_DEPTH = 85.0   # head depth radius in NF px; with 36 deg this puts near eye / nose at 0.43 / 0.88 of the
                 # head width, as measured on badger_turn_34.png


def depth(x, y):
    """How far a front-view point sits toward the camera (0 = skull side plane, 1 = nose tip)."""
    m = min(1.0, max(0.0, (y - 120) / 45.0))  # 0 at eye level, 1 on the muzzle
    centre = math.exp(-((x - 208) / 52.0) ** 2)
    return 0.28 + (0.72 * centre) * (0.35 + 0.65 * m)


def turn_face(theta):
    c, s = math.cos(math.radians(theta)), math.sin(math.radians(theta))

    def f(x, y):
        return (208 + (x - 208) * c + depth(x, y) * R_DEPTH * s, y)
    return f


def turn_skull(theta):
    # skull silhouette: near side widens a little, far side narrows (rounded head keeps its width)
    s = math.sin(math.radians(theta))

    def f(x, y):
        X = x - 208
        near = (X < 0) if theta > 0 else (X > 0)
        k = 1 + 0.10 * abs(s) if near else 1 - 0.16 * abs(s)
        shift = 0.10 * R_DEPTH * s * math.exp(-((y - 200) / 40.0) ** 2)  # jaw/muzzle base follows the face
        return (208 + X * k + shift, y)
    return f


def turn_ear(theta, side):
    """Ears sit behind the face centre: they slide opposite to the nose; the far ear foreshortens."""
    s = math.sin(math.radians(theta))
    far = (side == 'L') if theta > 0 else (side == 'R')
    px = 283 if side == 'L' else 128
    k = 0.78 if far else 1.04
    shift = -0.22 * R_DEPTH * s + (-(px - 208) * 0.18 if far else 0)

    def f(x, y):
        return (px + (x - px) * k + shift, y)
    return f


def _split(p0, p1, p2, p3, t):
    """de Casteljau: the two halves of a cubic at t."""
    L = lambda a, b: (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
    a, b, c = L(p0, p1), L(p1, p2), L(p2, p3)
    d, e = L(a, b), L(b, c)
    m = L(d, e)
    return (p0, a, d, m), (m, e, c, p3)


def _pts(s):
    v = [float(x) for x in s.replace(',', ' ').split()]
    return [(v[i], v[i + 1]) for i in range(0, len(v), 2)]


def _fmt(ps):
    return ' '.join('%.2f %.2f' % p for p in ps)


def trim_start(d, t):
    """Drop the part of the FIRST cubic segment before parameter t (path: 'M p C a b c C ...')."""
    head, rest = d.split(' C ', 1)
    first, *more = rest.split(' C ')
    p0 = _pts(head[2:])[0]
    p1, p2, p3 = _pts(first)
    _, (m, e, c, p3) = _split(p0, p1, p2, p3, t)
    return 'M ' + _fmt([m]) + ' C ' + _fmt([e, c, p3]) + ''.join(' C ' + s for s in more)


def trim_end(d, t):
    """Keep the LAST cubic segment only up to parameter t."""
    segs = d.split(' C ')
    prev_end = _pts(segs[-2])[-1]
    p1, p2, p3 = _pts(segs[-1])
    (p0, a, dd, m), _ = _split(prev_end, p1, p2, p3, t)
    return ' C '.join(segs[:-1]) + ' C ' + _fmt([a, dd, m])


def fix_three_quarter(view, theta, fFace):
    """Integration fix INT-B1 (2026-11-24), checked against badger_turn_34.png at 3x:
    * the far outline hugs the OUTSIDE of the far eye and runs into the top of the nose, and the muzzle wraps
      under the nose to the far lip corner, so the nose sits at the tip of the muzzle (it used to hang off the
      edge of the skull fill, with the far contour crossing the far eye and the nose);
    * a short far upper-lip line runs from the nose down to the mouth (replaces the snout line through the far eye);
    * the lip line starts low on the near cheek, as on the sheet (the front W-line began at the cheek and read as a grin);
    * the far eye and brow are narrowed (0.72 of the near eye) as on the sheet.
    The far outline is authored in the TURNED space (depth-turned NF px, mapped to head-local units by F only)
    for the screen-right turn; the screen-left turn reuses that far outline of the (unmarked, symmetric) skull with
    x -> 416 - x, as the original fill34 pair did, while its near side is the front skull's own anatomical-left
    outline. Ears, eyes, cheek spots and every marking keep their own per-side mapping: no marking is mirrored."""
    right = theta > 0
    ts = turn_skull(theta)
    mx = (lambda x, y: (x, y)) if right else (lambda x, y: (416 - x, y))
    # far outline + muzzle in turned space (screen-right turn), mirrored for the screen-left turn
    far = ('C 284 99 285.5 108 284.5 117 C 283 129 278 141 272 151 C 270 155 269.5 158 269.5 162 '
           'C 272.5 171 273.5 183 271.5 193 C 271.5 200 271 207 268 213 C 266 227 260 239 249 244 '
           'C 236 247 221 246 209.5 244')
    far_t = map_path('M 281.4 92 ' + far, mx)
    if right:
        near_top = map_path('M 141 31 C 165 23 245 22 262 29 L 289 92', ts)
        near_rest = map_path('M 208 244 C 188 243 172 230 164 216 C 154 205 145 192 139 177 C 135 173 131 169 127 162 '
                             'C 120 148 115 125 116 100 L 122 40 Z', ts)
        fill_t = near_top + ' ' + far_t[far_t.index('C'):] + ' ' + near_rest[near_rest.index('C'):]
    else:
        # screen-left turn: the near side is the front skull's own anatomical-LEFT outline (x > 208), then the far
        # outline from the chin back up to the far temple, then the far top corner
        near = map_path('M 141 31 C 165 23 245 22 262 29 L 289 92 C 293 118 294 148 288 162 C 284 170 280 174 277 177 '
                        'C 271 192 262 205 252 216 C 244 230 228 243 208 244', ts)
        far_rev = map_path('M 209.5 244 C 221 246 236 247 249 244 C 260 239 266 227 268 213 C 271 207 271.5 200 271.5 193 '
                           'C 273.5 183 272.5 171 269.5 162 C 269.5 158 270 155 272 151 C 278 141 283 129 284.5 117 '
                           'C 285.5 108 284 99 281.4 92', mx)
        corner = map_path('M 122 40', ts)
        fill_t = near + ' ' + far_rev[far_rev.index('C'):] + ' L ' + corner[2:] + ' Z'
    heads[view]['skull']['fill'] = mp(fill_t, F)
    contour = map_path('M 281.4 92 C 284 99 285.5 108 284.5 117 C 283 129 278 141 272 151 C 270 155 269.5 158 269.5 162', mx)
    lip_far = map_path('M 271.5 187 C 271.5 198 271 207 268 213', mx)
    # near cheek outline continues down the jaw toward the throat (the front head drew this edge with the lip line,
    # which now starts lower)
    fSkull = compose(ts, F)
    near_cheek = ('M 113 104 C 112 125 114 145 119 158 C 122 165 125 170 129 175 C 135 186 143 197 152 206' if right else
                  'M 293 100 C 295 120 294 145 289 158 C 286 165 282 171 278 176 C 273 187 266 197 257 206')
    heads[view]['skull']['strokes'] = [heads[view]['skull']['strokes'][0], mp(near_cheek, fSkull), mp(contour, F)]
    heads[view]['skull']['details'] = []
    heads[view]['philtrum'] = mp(lip_far, F)
    # mouth: start the near side low on the cheek (t=0.7 of the cheek segment), keep the rest of each library line
    trim = trim_start if right else trim_end
    tt = 0.7 if right else 0.3
    src = FRONT['mouth']
    m = heads[view]['mouth']
    m['neutral']['strokes'] = [mp(trim(src['neutral']['strokes'][0], tt), fFace)]
    m['worried']['strokes'] = [mp(trim(src['worried']['strokes'][0], tt), fFace)]
    happy = src['happy']['strokes'][0].split(' C ')  # drop the cheek segment on the near side
    happy = ('M ' + _fmt(_pts(happy[1])[-1:]) + ' C ' + ' C '.join(happy[2:])) if right else ' C '.join(happy[:-1])
    m['happy']['strokes'] = [mp(happy, fFace)]
    # shocked: only the open mouth; the front's cheek lines leave stray dashes beside it in a 3/4 turn
    m['shocked']['strokes'] = [mp(src['shocked']['strokes'][2], fFace)]
    # far eye and brow: 0.72 of the near eye width (was 0.86), brow compressed toward the eye centre
    far_side = 'L' if right else 'R'
    for e in heads[view]['eyes']:
        if e['side'] == far_side:
            e['w'] = round(e['w'] * 0.72 / 0.86, 2)
            cx = e['c']['x']
    for b in heads[view]['brows']:
        if b['side'] == far_side:
            for k in ('outer', 'mid', 'inner'):
                b[k]['x'] = round(cx + (b[k]['x'] - cx) * 0.72 / 0.86, 2)


for view, theta in (('threeQuarterRightScreen', 36.0), ('threeQuarterLeftScreen', -36.0)):
    fFace = compose(turn_face(theta), F)
    fSkull = compose(turn_skull(theta), F)
    fEarR = compose(turn_ear(theta, 'R'), F)
    fEarL = compose(turn_ear(theta, 'L'), F)
    far_side = 'L' if theta > 0 else 'R'
    eye_w = (1.0, 0.86) if theta > 0 else (0.86, 1.0)
    heads[view] = build_from_front(FRONT, fFace, fSkull, fEarR, fEarL, view, eye_w=eye_w, ears_behind=(far_side,))
    # true 3/4: the far cheek below the eye is hidden by the snout; the far outline runs from under the far
    # ear into the far side of the nose, and the mouth is clipped to the skull so the far lip line disappears
    if theta > 0:
        fill34 = ('M 141 31 C 165 23 245 22 262 29 L 289 92 C 291 105 290 118 285 128 C 272 140 254 150 242 158 '
                  'L 244 200 C 238 226 226 243 208 244 C 188 243 172 230 164 216 C 154 205 145 192 139 177 '
                  'C 135 173 131 169 127 162 C 120 148 115 125 116 100 L 122 40 Z')
        strokes34 = [FRONT['skull_strokes'][0], FRONT['skull_strokes'][1],
                     'M 293 100 C 294 112 291 122 285 128 C 272 140 254 150 242 158']
    else:
        fill34 = ('M 141 31 C 165 23 245 22 262 29 L 289 92 C 293 118 294 148 288 162 C 284 170 280 174 277 177 '
                  'C 271 192 262 205 252 216 C 244 230 228 243 208 244 C 190 243 178 226 172 200 L 174 158 '
                  'C 162 150 144 140 131 128 C 126 122 125 112 123 100 L 122 40 Z')
        strokes34 = [FRONT['skull_strokes'][0], FRONT['skull_strokes'][2],
                     'M 113 100 C 112 112 115 122 121 128 C 134 140 152 150 174 158']
    heads[view]['skull']['fill'] = mp(fill34, fSkull)
    heads[view]['skull']['strokes'] = [mp(d, fSkull) for d in strokes34]
    heads[view]['clipMouth'] = True
    # far side of the snout (stop -> nose -> lip) becomes a visible contour in a true 3/4
    snout = ('M 243 129 C 242 140 240 150 237 160' if theta > 0 else 'M 173 129 C 174 140 176 150 179 160')
    chin = ('M 176 233 C 188 242 200 245 212 244 C 221 243 228 240 233 235' if theta > 0 else
            'M 240 233 C 228 242 216 245 204 244 C 195 243 188 240 183 235')
    heads[view]['skull']['details'] = [mp(snout, fFace)]
    heads[view]['chin'] = None  # tried a lower-jaw contour; it floated below the jaw on the body, so the muzzle shadow carries the chin
    del chin
    fix_three_quarter(view, theta, fFace)

# =============================================================================== PROFILE LEFT (CL)
KX_CL, KY_CL = 0.9398, 1.0455
C = lin(155, 100, KX_CL, KY_CL)
EAR_PL = ('M 139 39 C 150 36 162 36 172 40 C 182 44 192 51 195 59 C 197 66 194 72 187 76 '
          'C 180 80 172 85 163 89 C 159 90 155 89 152 86 C 147 80 143 68 141 56 C 140 50 139 44 139 39 Z')
PROFILE_L = {
    'skull_fill': ('M 50 76 C 62 72 78 68 88 63 C 92 58 97 52 104 48 C 115 42 128 39 142 38 C 165 38 185 43 192 57 '
                   'C 196 65 194 76 186 84 C 178 96 168 108 152 116 C 140 120 132 121 126 121 C 118 117 108 115 96 115 '
                   'C 80 117 64 115 54 110 C 46 105 44 96 46 86 C 47 80 48 78 50 76 Z'),
    'skull_strokes': ['M 141 38 C 128 39 115 42 104 48 C 97 52 92 58 88 63 C 78 68 62 72 49 77',
                      'M 45 99 C 49 105 56 110 66 113 C 82 117 100 116 112 117 C 118 118 122 119 126 122'],
    'details': ['M 153 98 C 150 104 145 108 138 111'],
    'nose': 'M 50 77 C 43 75 35 79 33 86 C 32 93 36 99 43 100 C 48 100 52 96 52 90 C 52 84 52 79 50 77 Z',
    'eye': (100, 66.5, 11.5, 5.4, 4.0, 3.5, -1, 5.4, -3.2, 0.3, 'L'),
    'brow': ((111, 57), (103, 54), (94, 57), 'L'),
    'mouth': {
        'neutral': {'strokes': [], 'details': ['M 110 114 C 115 115 119 117 122 121'], 'fills': []},
        'happy': {'strokes': [], 'details': ['M 104 116 C 111 115 116 112 119 107'], 'fills': []},
        'worried': {'strokes': [], 'details': ['M 106 115 C 112 117 116 120 118 125'], 'fills': []},
        'shocked': {'strokes': ['M 50 106 C 70 117 98 121 118 118'], 'details': [],
                    'fills': [('M 47 103 C 70 113 100 115 120 116 C 104 121 78 122 58 116 C 52 113 49 108 47 103 Z', 'mouth')]},
    },
    'ear': {'side': 'L', 'pivot': (150, 44), 'backRot': -24, 'backSx': 0.92,
            'fills': [(EAR_PL, 'earCap', False)], 'strokes': [EAR_PL], 'details': []},
}

# =============================================================================== PROFILE RIGHT (CR, coat_right.png)
CRF = lin(477, 100, KX_CL, KY_CL)
# outline: the rose-ear shape of the left profile ear at the position traced on coat_right (ear shapes are
# anatomically symmetric; colour, fold and the small spot are the RIGHT ear's own, from badger_coat_right.png)
EAR_PR = 'M 493 39 C 482 36 470 36 460 40 C 450 44 440 51 437 59 C 435 66 438 72 445 76 C 452 80 460 85 469 89 C 473 90 477 89 480 86 C 485 80 489 68 491 56 C 492 50 493 44 493 39 Z'
PROFILE_R = {
    'skull_fill': ('M 584 76 C 572 70 556 62 546 57 C 541 52 536 46 528 42 C 517 37 502 35 488 36 C 467 37 448 42 441 55 '
                   'C 437 65 439 76 447 84 C 455 96 465 108 481 116 C 492 120 499 121 504 121 C 512 117 522 115 534 115 '
                   'C 550 116 566 114 578 109 C 588 105 592 97 590 88 C 589 82 588 79 584 76 Z'),
    'skull_strokes': ['M 487 36 C 502 35 517 37 528 42 C 536 46 541 52 546 57 C 556 62 572 70 585 76',
                      'M 590 98 C 586 105 578 109 568 112 C 552 116 532 115 520 116 C 512 117 508 118 504 121'],
    'details': ['M 477 98 C 480 104 485 108 492 111'],
    'nose': 'M 582 77 C 589 75 597 79 599 86 C 600 93 596 99 589 100 C 584 100 580 96 580 90 C 580 84 580 79 582 77 Z',
    'eye': (532, 62, 11.5, 5.4, 4.0, 3.5, 1, 5.4, 3.2, 0.3, 'R'),
    'brow': ((521, 53), (529, 50), (538, 53), 'R'),
    'mouth': {
        'neutral': {'strokes': [], 'details': ['M 522 113 C 517 114 513 116 510 120'], 'fills': []},
        'happy': {'strokes': [], 'details': ['M 528 115 C 521 114 516 111 513 106'], 'fills': []},
        'worried': {'strokes': [], 'details': ['M 526 114 C 520 116 516 119 514 124'], 'fills': []},
        'shocked': {'strokes': ['M 584 105 C 564 116 536 120 516 117'], 'details': [],
                    'fills': [('M 587 102 C 564 112 534 114 514 115 C 530 120 556 121 576 115 C 582 112 585 107 587 102 Z', 'mouth')]},
    },
    # near ear = pale ANATOMICAL RIGHT ear, with its small dark spot (badger_coat_right.png)
    'ear': {'side': 'R', 'pivot': (466, 44), 'backRot': 24, 'backSx': 0.92,
            'fills': [(EAR_PR, 'coat', False),
                      ('M 493 39 C 486 44 482 54 482 64 C 482 72 482 80 480 87 C 486 84 489 78 490 68 C 491 58 492 48 493 39 Z', 'earPaleInner', True),
                      (ellipse_path(471, 55, 3.6, 7.0, 8), 'spot', True)],
            'strokes': [EAR_PR], 'details': ['M 491 42 C 485 48 482 57 482 66 C 482 74 482 81 480 87'],
            'spot': (471, 55, 3.6, 7.0, 8)},
}


def build_profile(src, f, view, pitch=0.0):
    e = src['eye']
    cx, cy, w, up, low, drop, inner, ir, idx, idy, side = e
    k = KY_CL
    eye = {'side': side, 'c': pt(cx, cy, f), 'w': round(w * KX_CL, 2), 'up': round(up * k, 2), 'low': round(low * k, 2),
           'drop': round(drop * k, 2), 'inner': inner, 'irisR': round(ir * k, 2), 'irisDX': round(idx * KX_CL, 2),
           'irisDY': round(idy * k, 2), 'profile': True, 'rot': pitch}
    o, m, i, bs = src['brow']
    ear = src['ear']
    fe = f
    if pitch:
        base = C if src is PROFILE_L else CRF
        px, py = base(*ear['pivot'])
        # the ear hangs (counter-rotates part of the pitch) and folds a little smaller, as on the looking-up pose
        def fold(x, y, px=px, py=py):
            return (px + (x - px) * 0.86, py + (y - py) * 0.9)
        fe = compose(base, fold, rotate_about(-0.35 * pitch, px, py), rotate_about(pitch))
    ear_g = {'side': ear['side'], 'pivot': pt(*ear['pivot'], fe), 'backRot': ear['backRot'], 'backSx': ear['backSx'],
             'fills': [{'d': mp(d, fe), 'color': c, **({'clip': True} if clip else {})} for (d, c, clip) in ear['fills']],
             'strokes': [mp(d, fe) for d in ear['strokes']], 'details': [mp(d, fe) for d in ear['details']]}
    if 'spot' in ear:
        markings['H-EAR-R-SPOT'][view] = me(*ear['spot'], fe)
    return {
        'earsBehind': [],
        'throat': None,
        'skull': {'fill': mp(src['skull_fill'], f), 'strokes': [mp(d, f) for d in src['skull_strokes']],
                  'details': [mp(d, f) for d in src['details']]},
        'shadows': [],
        'markings': [],
        'nose': {'d': mp(src['nose'], f)},
        'philtrum': None,
        'eyes': [eye],
        'brows': [{'side': bs, 'outer': pt(*o, f), 'mid': pt(*m, f), 'inner': pt(*i, f)}],
        'mouth': {k2: {'strokes': [mp(d, f) for d in v['strokes']], 'details': [mp(d, f) for d in v['details']],
                       'fills': [{'d': mp(d, f), 'color': c} for d, c in v['fills']]} for k2, v in src['mouth'].items()},
        'earsFront': [ear_g],
    }


heads['profileLeftScreen'] = build_profile(PROFILE_L, C, 'profileLeftScreen')
heads['profileRightScreen'] = build_profile(PROFILE_R, CRF, 'profileRightScreen')
# looking up: the profile pitched nose-up about the head pivot (+ = clockwise in SVG space)
UP_PITCH = 34.0
heads['upLeftScreen'] = build_profile(PROFILE_L, compose(C, rotate_about(UP_PITCH)), 'upLeftScreen', UP_PITCH)
heads['upRightScreen'] = build_profile(PROFILE_R, compose(CRF, rotate_about(-UP_PITCH)), 'upRightScreen', -UP_PITCH)
# the throat bridge is drawn un-pitched (it belongs to the neck) so the jaw-to-neck line stays connected


def throat_bridge(fp, f0, jaw_end, neck_pt, ctrl):
    """Jaw-to-neck bridge: starts exactly at the pitched jaw end and lands on the neck's throat line."""
    j = fp(*jaw_end)
    n = f0(*neck_pt)
    c1 = f0(*ctrl[0])
    c2 = f0(*ctrl[1])
    back = f0(*ctrl[2])
    q = lambda p: '%.1f %.1f' % p
    stroke = 'M %s C %s %s %s' % (q(j), q(c1), q(c2), q(n))
    fill = stroke + ' L %s L %s Z' % (q(back), q(fp(jaw_end[0] + (14 if jaw_end[0] < 300 else -14), jaw_end[1] - 18)))
    return {'fill': fill, 'stroke': stroke}


heads['upLeftScreen']['throat'] = throat_bridge(compose(C, rotate_about(UP_PITCH)), C, (126, 122), (139, 157),
                                                ((126, 132), (134, 146), (166, 150)))
heads['upRightScreen']['throat'] = throat_bridge(compose(CRF, rotate_about(-UP_PITCH)), CRF, (504, 122), (491, 157),
                                                 ((504, 132), (496, 146), (464, 150)))
for v in ('front', 'threeQuarterLeftScreen', 'threeQuarterRightScreen'):
    heads[v]['throat'] = None
for v in heads:
    heads[v].setdefault('clipMouth', False)
    heads[v].setdefault('chin', None)

# =============================================================================== FRONT NECK (bust)
FN = lin(208, 250, S_NF, S_NF)
front_neck_geom = {
    'fill': mp('M 128 170 L 280 170 C 281 200 282 230 284 252 C 300 280 318 305 330 330 L 80 330 C 92 305 108 280 124 252 C 126 230 127 200 128 170 Z', FN),
    'strokes': [mp('M 129 175 C 128 205 127 230 125 252', FN), mp('M 279 176 C 280 205 281 230 283 252', FN),
                mp('M 122 268 C 108 285 95 302 82 318', FN), mp('M 288 268 C 302 285 315 302 328 318', FN)],
    'details': [],
    'collar': mp('M 119 246 C 135 262 170 272 208 272 C 246 272 281 262 291 246 C 293 254 294 262 293 270 '
                 'C 282 285 248 296 208 296 C 168 296 134 285 122 270 C 120 262 119 254 119 246 Z', FN),
    'collarShadow': mp('M 121 265 C 134 280 168 290 208 290 C 248 290 282 280 293 265 L 293 270 '
                       'C 282 285 248 296 208 296 C 168 296 134 285 122 270 Z', FN),
    'tagRing': mp('M 203 291 C 201 296 202 301 208 302 C 214 301 215 296 213 291', FN),
    'tag': me(208, 315, 13.5, 13.5, 0, FN),
    'tagShadow': mp('M 219 306 C 224 314 222 324 213 328 C 209 329 206 327 208 325 C 216 321 219 314 219 306 Z', FN),
}
front_neck = [
    {'id': 'L-NECK', 'side': 'left', 'path': me(260, 243, 4.6, 11, 6, FN),
     'ref': {'crop': 'badger_expr_neutral.png', 'x': 260, 'y': 243},
     'desc': 'left neck spot seen from the front (same marking as the left-view L-NECK)'},
    {'id': 'R-NECK', 'side': 'right', 'path': me(154, 240, 6, 13, -8, FN),
     'ref': {'crop': 'badger_expr_neutral.png', 'x': 154, 'y': 240},
     'desc': 'right neck spot (badger_coat_right.png, below the pale ear) seen from the front'},
]

with open(OUT_TS, 'w') as fh:
    fh.write('/**\n * BADGER head views, head-local world units (origin = head pivot). GENERATED by\n'
             ' * src/characters/badger/dev/trace/gen_heads.py from traces over the approved sheet crops.\n'
             ' * Edit the tracer, not this file. Markings are authored per view on their anatomical side.\n */\n')
    fh.write('export const HEAD_GEOM = ' + json.dumps(heads, indent='\t') + ' as const;\n\n')
    fh.write('export const FRONT_NECK_GEOM = ' + json.dumps(front_neck_geom, indent='\t') + ' as const;\n')

mk = [
    {'id': 'H-EAR-L-CAP', 'side': 'left', 'desc': 'dark cap: the whole outer flap of the anatomical LEFT ear (screen right in the front head; near ear in left-facing views)', 'paths': {}},
    {'id': 'H-EAR-R-SPOT', 'side': 'right', 'desc': 'small dark spot on the outer flap of the pale anatomical RIGHT ear', 'paths': markings['H-EAR-R-SPOT']},
    {'id': 'H-CHEEK-R', 'side': 'right', 'desc': 'spot on the right cheek beside the muzzle (screen left in the front head); hidden in profiles as on the sheet', 'paths': markings['H-CHEEK-R']},
    {'id': 'H-CHEEK-L', 'side': 'left', 'desc': 'spot on the left cheek beside the muzzle (screen right in the front head); hidden in profiles as on the sheet', 'paths': markings['H-CHEEK-L']},
]
with open(OUT_JSON, 'w') as fh:
    json.dump({'head': mk, 'frontNeck': front_neck}, fh, indent=1)
print('heads:', list(heads))
