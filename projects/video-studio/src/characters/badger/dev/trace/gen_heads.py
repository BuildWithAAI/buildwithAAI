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
        # happy (retraced from badger_expr_happy.png, mapped by the nose): the jaw runs on from the cheeks, a separate
        # wide smile with raised corners sits inside it with a notch at the philtrum, short upturned creases at the
        # corners, and a lower-lip arc below
        'happy': {'strokes': ['M 129 175 C 134 187 141 198 150 206', 'M 278 176 C 273 188 266 198 257 206',
                              'M 142 185 C 148 199 157 209 168 213 C 181 218 197 216 208 207 C 219 216 235 218 248 213 C 259 209 268 199 274 185'],
                  'details': ['M 142 185 C 139.5 182 138.5 178 139.5 174', 'M 274 185 C 276.5 182 277.5 178 276.5 174',
                              'M 178 226 C 193 235 223 235 238 226'], 'fills': []},
        'worried': {'strokes': ['M 129 175 C 137 190 147 205 161 215 C 176 216 192 222 208 217 C 222 213 238 220 252 215 C 261 204 270 191 278 176'],
                    'details': ['M 190 231 C 200 228 216 228 226 231'], 'fills': []},
        # shocked (retraced from badger_expr_shocked.png): a small open mouth, about nose width and 0.45 of the nose height,
        # directly under the philtrum (which stays), with a pink lower lip; the jaw contour stays continuous below it
        'shocked': {'strokes': ['M 129 175 C 138 196 152 216 172 230 C 186 239 198 243 208 243 C 220 243 233 238 245 230 '
                                'C 263 217 272 196 278 176',
                                'M 185 214 C 195 210.5 221 210.5 231 214 C 233 223 223 233 208 233 C 193 233 183 223 185 214 Z'],
                    'details': [],
                    'fills': [('M 185 214 C 195 210.5 221 210.5 231 214 C 233 223 223 233 208 233 C 193 233 183 223 185 214 Z', 'mouth'),
                              ('M 192 227 C 198 222.5 218 222.5 224 227 C 220 232 196 232 192 227 Z', 'tongue')]},
    },
    # pale ANATOMICAL RIGHT ear (screen left in the front view): flap + pink ribbon + small spot
    'earR': {
        # worried / earsBack: the flap swings down and out about its base (~20 deg) and keeps its width (round-1 repair)
        'pivot': (126, 66), 'backRot': -20, 'backSx': 0.96,
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
        'pivot': (285, 60), 'backRot': 20, 'backSx': 0.96,
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
    # round-1 repair: the far cheek is pulled in below the far eye so the muzzle projects past it with the nose at its
    # tip (badger_turn_34.png), and the far contour continues round the muzzle and the chin (the chin is outlined)
    far = ('C 284 99 285.5 108 284.5 117 C 282 128 274 139 266 148 C 263 152 262 156 263 160 '
           'C 268 168 275 178 276.5 190 C 277 199 275.5 207 271.5 214 C 268 227 261 239 249 244 '
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
        far_rev = map_path('M 209.5 244 C 221 246 236 247 249 244 C 261 239 268 227 271.5 214 C 275.5 207 277 199 276.5 190 '
                           'C 275 178 268 168 263 160 C 262 156 263 152 266 148 C 274 139 282 128 284.5 117 '
                           'C 285.5 108 284 99 281.4 92', mx)
        corner = map_path('M 122 40', ts)
        fill_t = near + ' ' + far_rev[far_rev.index('C'):] + ' L ' + corner[2:] + ' Z'
    heads[view]['skull']['fill'] = mp(fill_t, F)
    # one far contour: temple -> far cheek -> stop -> far side of the muzzle round the nose -> chin (closed jaw)
    contour = map_path('M 281.4 92 C 284 99 285.5 108 284.5 117 C 282 128 274 139 266 148 C 263 152 262 156 263 160 '
                       'C 268 168 275 178 276.5 190 C 277 199 275.5 207 271.5 214 C 268 227 261 239 249 244 '
                       'C 240 246.5 230 247 222 246', mx)
    lip_far = map_path('M 274 195 C 274.5 203 273.5 209 271.5 214', mx)
    # near cheek outline continues down the jaw toward the throat (the front head drew this edge with the lip line,
    # which now starts lower)
    fSkull = compose(ts, F)
    # the near cheek runs down to the jaw and stops (it used to curl into the lip line and read as a grin)
    near_cheek = ('M 113 104 C 112 125 114 145 119 158 C 122 165 125 170 129 175 C 132 181 135 186 139 191' if right else
                  'M 293 100 C 295 120 294 145 289 158 C 286 165 282 171 278 176 C 275 182 272 187 268 192')
    heads[view]['skull']['strokes'] = [heads[view]['skull']['strokes'][0], mp(near_cheek, fSkull), mp(contour, F)]
    heads[view]['skull']['details'] = []
    heads[view]['philtrum'] = mp(lip_far, F)
    # mouth: start the near side low on the cheek (t=0.7 of the cheek segment), keep the rest of each library line
    trim = trim_start if right else trim_end
    tt = 0.7 if right else 0.3
    src = FRONT['mouth']
    m = heads[view]['mouth']
    def drop_far(d):
        segs = d.split(' C ')
        return ' C '.join(segs[:-1]) if right else ('M ' + _fmt(_pts(segs[1])[-1:]) + ' C ' + ' C '.join(segs[2:]))
    m['neutral']['strokes'] = [mp(drop_far(trim(src['neutral']['strokes'][0], tt)), fFace)]
    m['worried']['strokes'] = [mp(drop_far(trim(src['worried']['strokes'][0], tt)), fFace)]
    # happy: the smile only (clipped to the skull; the far end disappears behind the muzzle)
    m['happy']['strokes'] = [mp(src['happy']['strokes'][2], fFace)]
    m['happy']['details'] = [mp(src['happy']['details'][0 if right else 1], fFace)]
    # shocked: only the open mouth; the front's jaw line would leave stray dashes beside it in a 3/4 turn
    m['shocked']['strokes'] = [mp(src['shocked']['strokes'][-1], fFace)]
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
    # round-1 repair: the far ear shows its outer side only (badger_turn_34.png draws the far dark ear solid), and the
    # irises fill more of the almond, as on the sheet's 3/4 head
    for e in heads[view]['earsBehind']:
        for fl in e['fills']:
            if fl['color'] == 'earPaleInner':
                fl['color'] = 'earCap' if e['side'] == 'L' else 'coat'
    for e in heads[view]['eyes']:
        e['irisR'] = round(e['irisR'] * 1.15, 2)
    # the chin is outlined now (fix_three_quarter), so the front head's lower-lip detail would double it
    for k in ('neutral', 'happy', 'worried'):
        heads[view]['mouth'][k]['details'] = []
    # the nose sits at the tip of the projecting muzzle: 3 units toward the far side
    sh = 3.0 if theta > 0 else -3.0
    heads[view]['nose']['d'] = map_path(heads[view]['nose']['d'], lambda x, y: (x + sh, y))
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
# Retraced 2026-11-24 (round-1 repair) on reference/crops/badger_coat_left.png at 5x: deeper stop at the eye, muzzle
# underside 2.5 px lower, a nose the sheet's size (outer 20 x 21 px once outlined) shaped as the rounded tip of the muzzle,
# a small dark almond eye, and a short commissure mark instead of a second lip stroke over the jaw line.
KX_CL, KY_CL = 0.9398, 1.0455
C = lin(155, 100, KX_CL, KY_CL)
EAR_PL = ('M 139 39 C 150 36 162 36 172 40 C 182 44 192 51 195 59 C 197 66 194 72 187 76 '
          'C 180 80 172 85 163 89 C 159 90 155 89 152 86 C 147 80 143 68 141 56 C 140 50 139 44 139 39 Z')
PROFILE_L = {
    'skull_fill': ('M 50 76 C 64 71 79 66 86 60 C 90 55 94 49 101 45 C 112 40 127 37 142 37 C 165 37 185 43 192 57 '
                   'C 196 65 194 76 186 84 C 178 96 168 108 152 116 C 140 120 132 122 126 122 C 118 119 108 118 96 118 '
                   'C 80 119 64 117 54 112 C 47 108 45 100 46 92 C 46 85 47 79 50 76 Z'),
    'skull_strokes': ['M 141 37 C 127 37 112 40 101 45 C 94 49 90 55 86 60 C 79 66 64 71 49 77',
                      'M 46 99 C 50 107 57 112 67 115 C 83 119 101 118 113 119 C 119 120 123 122 127 124'],
    'details': ['M 154 101 C 151 107 146 111 139 114'],
    'nose': 'M 49 77.5 C 44 76.5 38 77.5 35 80.5 C 32.5 83.5 32.5 89 35.5 92 C 38 94.5 42 95 45 93.5 C 48 92 49.5 89 49.5 85.5 C 49.5 82 49.5 79.5 49 77.5 Z',
    'eye': (103.5, 67, 8.5, 4.6, 3.6, 2.5, -1, 4.9, -1.6, 0.4, 'L'),
    'brow': ((112, 57.5), (104, 55), (96, 58), 'L'),
    'mouth': {
        'neutral': {'strokes': [], 'details': ['M 110 118.6 C 113.5 118 116.5 117 118.5 115.5'], 'fills': []},
        'happy': {'strokes': [], 'details': ['M 105 118.4 C 111 118 116 115.5 119.5 111'], 'fills': []},
        'worried': {'strokes': [], 'details': ['M 108 118.4 C 112.5 119 116 120.5 118.5 123'], 'fills': []},
        # shocked: the open mouth is a closed, outlined wedge INSIDE the head silhouette, between the raised upper lip
        # and the lip line, from the commissure to just behind the nose (mouth colour + a sliver of tongue)
        'shocked': {'strokes': ['M 112 119 C 100 113 80 108 57 104.5 C 54 106 53.5 109 55 111.5 C 66 115.5 88 118.5 112 119 Z'], 'details': [],
                    'fills': [('M 112 119 C 100 113 80 108 57 104.5 C 54 106 53.5 109 55 111.5 C 66 115.5 88 118.5 112 119 Z', 'mouth'),
                              ('M 62 112 C 72 114.6 86 116.8 99 117.6 C 88 115.6 74 113.6 62 112 Z', 'tongue')]},
    },
    'ear': {'side': 'L', 'pivot': (150, 44), 'backRot': -24, 'backSx': 0.92,
            'fills': [(EAR_PL, 'earCap', False)], 'strokes': [EAR_PL], 'details': []},
}

# =============================================================================== PROFILE RIGHT (CR, coat_right.png)
# Traced directly on reference/crops/badger_coat_right.png at 5x (round-1 repair; it used to be the left profile mirrored).
# The pale RIGHT ear is a rose flap hanging from the top of the skull: its outline runs over the top of the head and
# down the back to a rounded tip, its front edge is the fold, and the turnaround side view shows the ear's pink inner as a
# band in front of the fold at the base. Small spot H-EAR-R-SPOT on the flap, as on coat_right.
CRF = lin(477, 100, KX_CL, KY_CL)
EAR_PR = ('M 496 42 C 491 36 480 31 468 32 C 456 34 444 42 437 51 C 433 56 433 61 436 65 C 442 72 452 80 461 85 '
          'C 465 87 469 86 471 83 C 476 74 481 64 485 57 C 489 51 493 47 496 42 Z')
EAR_PR_FOLD = 'M 491 38 C 487 46 482 56 478 67 C 476 74 473 80 471 83'
EAR_PR_INNER = ('M 491 38 C 493 39 495 40 496 42 C 493 47 489 51 485 57 C 482 62 480 67 478 71 '
                'C 478.5 69 478 68 478 67 C 482 56 487 46 491 38 Z')
PROFILE_R = {
    'skull_fill': ('M 583 76 C 571 70 557 65 549 61 C 543 57 539 52 534 47 C 527 41 514 36 500 35 C 474 35 452 40 443 52 '
                   'C 437 62 439 76 447 84 C 455 96 465 108 481 116 C 492 120 499 121 504 121 C 512 115 522 113 534 113 '
                   'C 550 114 566 112 578 107 C 585 103 589 97 589 90 C 589 84 587 79 583 76 Z'),
    'skull_strokes': ['M 498 35 C 514 36 527 41 534 47 C 539 52 543 57 549 61 C 557 65 571 70 584 76',
                      'M 588 95 C 585 102 578 107 568 110 C 552 113 532 113 520 114 C 512 115 508 117 504 121'],
    'details': ['M 477 99 C 480 104 485 108 492 111'],
    'nose': 'M 581 77 C 585.5 76 590.5 77 593.5 80 C 595.5 83 595 88 592 91 C 589.5 93.5 585.5 93.5 583.5 91.5 C 581.5 89.5 580.5 86 580.5 83 C 580.5 80.5 580.5 78.5 581 77 Z',
    'eye': (528, 64, 8.5, 4.6, 3.6, 2.5, 1, 4.9, 1.6, 0.4, 'R'),
    'brow': ((520, 55), (528, 52), (536, 55.5), 'R'),
    'mouth': {
        'neutral': {'strokes': [], 'details': ['M 523 113.6 C 519.5 113 516.5 112 514.5 110.5'], 'fills': []},
        'happy': {'strokes': [], 'details': ['M 528 113.4 C 522 113 517 110.5 513.5 106'], 'fills': []},
        'worried': {'strokes': [], 'details': ['M 525 113.4 C 520.5 114 517 115.5 514.5 118'], 'fills': []},
        'shocked': {'strokes': ['M 516 115 C 530 110 552 104 575 100.5 C 578 102 578.5 105 577 107.5 C 566 111.5 542 114 516 115 Z'], 'details': [],
                    'fills': [('M 516 115 C 530 110 552 104 575 100.5 C 578 102 578.5 105 577 107.5 C 566 111.5 542 114 516 115 Z', 'mouth'),
                              ('M 570 108 C 560 110.8 546 112.8 533 113.6 C 544 111.8 558 109.8 570 108 Z', 'tongue')]},
    },
    # near ear = pale ANATOMICAL RIGHT ear: flap (coat) + pink inner band at the base of the fold + small dark spot
    'ear': {'side': 'R', 'pivot': (488, 40), 'backRot': 24, 'backSx': 0.92,
            'fills': [(EAR_PR, 'coat', False),
                      (EAR_PR_INNER, 'earPaleInner', True),
                      (ellipse_path(475, 55.5, 3.2, 5.6, 10), 'spot', True)],
            'strokes': [EAR_PR], 'details': [EAR_PR_FOLD],
            'spot': (475, 55.5, 3.2, 5.6, 10)},
}


def build_profile(src, f, view, pitch=0.0, base=None):
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
        base = base or (C if src is PROFILE_L else CRF)
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

# =============================================================================== LOOKING UP (round-1 repair)
# The matching profile pitched nose-up about the head pivot, joined to the rig's own neck so every outline is closed:
#  * the lip line ends at the commissure and ONE throat stroke runs from there onto the neck's throat line; a coat band
#    behind it hides the neck's old upper throat line (no forks, no stubs);
#  * the pitched skull's back contour is stroked from the skull top down past the point where it crosses the neck's
#    back line, so there is no gap above or below the hanging ear;
#  * the hanging ear shows a band of its inner surface at the fold, as the looking-up panel draws it.
# The neck lines come from the side rigs (parts/rigLeft.ts, parts/rigRight.ts; build.sh generates them first) and are
# moved into head-local space with the head mount of the matching facing. KEEP IN SYNC with Badger.tsx
# LEFT_HEAD_MOUNT.upLeftScreen and RIGHT_HEAD_MOUNT.upRightScreen (dx, dy).
UP_PITCH = 40.0
UP_MOUNT = {'upLeftScreen': (0.0, 0.0), 'upRightScreen': (-7.0, 1.0)}
HERE = os.path.dirname(__file__)
sys.path.insert(0, HERE)
from erode import parse as _parse, bez as _bez


def _rig(name):
    src = open(os.path.join(HERE, '..', '..', 'parts', name)).read()
    return json.loads(src[src.index('{'):src.rindex('}') + 1])


def _neck_lines_head_local(rig, view):
    """The rig's neck strokes [back, throat] moved into head-local space (head mount + per-view offset)."""
    hm = rig['neck']['headMount']
    dx, dy = UP_MOUNT[view]
    ox, oy = hm['x'] + dx, hm['y'] + dy
    return [map_path(d, lambda x, y: (x - ox, y - oy)) for d in rig['neck']['strokes']]


def _samples(d, n=40):
    out = []
    for sub in _parse(d):
        p0 = sub['start']
        for c, ps in sub['segs']:
            for k in range(1, n + 1):
                t = k / n
                out.append(_bez(p0, ps[0], ps[1], ps[2], t) if c == 'C' else (p0[0] + (ps[0][0] - p0[0]) * t, p0[1] + (ps[0][1] - p0[1]) * t))
            p0 = ps[-1]
    return out


def _at_y(pts, y):
    """Point (and unit tangent) of a sampled polyline where it first reaches height y (y down)."""
    for a, b in zip(pts, pts[1:]):
        if (a[1] - y) * (b[1] - y) <= 0 and a[1] != b[1]:
            t = (y - a[1]) / (b[1] - a[1])
            p = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            L = math.hypot(b[0] - a[0], b[1] - a[1]) or 1
            return p, ((b[0] - a[0]) / L, (b[1] - a[1]) / L)
    return pts[-1], (0.0, 1.0)


def _seg_x(p1, p2, p3, p4):
    """Do segments p1-p2 and p3-p4 intersect?"""
    def o(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    d1, d2, d3, d4 = o(p3, p4, p1), o(p3, p4, p2), o(p1, p2, p3), o(p1, p2, p4)
    return d1 * d2 < 0 and d3 * d4 < 0


def _smooth(pts):
    """Dense sample list -> a smooth cubic path through every 3rd point (Catmull-Rom)."""
    P = pts[::3] + ([pts[-1]] if (len(pts) - 1) % 3 else [])
    out = ['M %.1f %.1f' % P[0]]
    for i in range(len(P) - 1):
        p0 = P[i - 1] if i else P[i]
        p1, p2 = P[i], P[i + 1]
        p3 = P[i + 2] if i + 2 < len(P) else p2
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        out.append('C %.1f %.1f %.1f %.1f %.1f %.1f' % (c1 + c2 + p2))
    return ' '.join(out)


def _unit(v):
    L = math.hypot(v[0], v[1]) or 1
    return (v[0] / L, v[1] / L)


def build_up(view, src, base, sign, rig_name, lip_cut, back_path, inner_band=None):
    pitch = sign * UP_PITCH
    fp = compose(base, rotate_about(pitch))
    if inner_band:
        src = dict(src)
        ear = dict(src['ear'])
        ear['fills'] = list(ear['fills']) + [(inner_band, 'earPaleInner', True)]
        src['ear'] = ear
    g = build_profile(src, fp, view, pitch, base=base)
    back_line, throat_line = _neck_lines_head_local(_rig(rig_name), view)
    # lip line ends at the commissure; the skull's back contour is outlined (the hanging ear no longer covers it) down to
    # where it crosses the neck's back line, plus a short overlap; below that the neck's own back line carries the nape
    bk = _samples(mp(back_path, fp), 60)
    nb = _samples(back_line, 60)
    cut = len(bk) - 1
    for i in range(len(bk) - 1):
        hit = False
        for k in range(len(nb) - 1):
            if _seg_x(bk[i], bk[i + 1], nb[k], nb[k + 1]):
                hit = True
                break
        if hit:
            cut = min(len(bk) - 1, i + 4)
            break
    back_d = 'M ' + ' L '.join('%.1f %.1f' % p for p in bk[:cut + 1])
    g['skull']['strokes'] = [g['skull']['strokes'][0], mp(lip_cut, fp), _smooth(bk[:cut + 1])]
    lip = _samples(mp(lip_cut, fp))
    J = lip[-1]
    tJ = _unit((lip[-1][0] - lip[-4][0], lip[-1][1] - lip[-4][1]))
    tp = _samples(throat_line, 60)
    q = lambda p: '%.1f %.1f' % p
    inward = (1.0, 0.0) if base is C else (-1.0, 0.0)  # toward the nape
    # landing point L1 on the neck's throat line: the lowest one (within reach) whose bridge passes IN FRONT of the old
    # upper throat line, so a thin band behind the bridge can hide that old line completely
    best = None
    for idx in range(min(len(tp) - 2, 70), -1, -2):
        L1 = tp[idx]
        if L1[1] - J[1] > 60:
            continue
        nxt = tp[min(idx + 1, len(tp) - 1)]
        tL = _unit((nxt[0] - L1[0], nxt[1] - L1[1]))
        k0 = math.hypot(L1[0] - J[0], L1[1] - J[1]) * 0.42
        c1 = (J[0] + tJ[0] * k0, J[1] + tJ[1] * k0)
        c2 = (L1[0] - tL[0] * k0, L1[1] - tL[1] * k0)
        br = [_bez(J, c1, c2, L1, k / 30) for k in range(31)]
        old = tp[:idx]
        crosses = any(_seg_x(br[i], br[i + 1], old[k], old[k + 1]) for i in range(len(br) - 3) for k in range(len(old) - 1))
        # every old sample above L1 must lie on the nape side of the bridge
        def side(pnt):
            j = min(range(len(br)), key=lambda i: math.hypot(br[i][0] - pnt[0], br[i][1] - pnt[1]))
            return (pnt[0] - br[j][0]) * inward[0] + (pnt[1] - br[j][1]) * inward[1]
        if not crosses and all(side(o) >= -0.5 for o in old):
            best = (L1, c1, c2, idx)
            break
    if best is None:
        L1 = tp[0]
        nxt = tp[1]
        tL = _unit((nxt[0] - L1[0], nxt[1] - L1[1]))
        k0 = math.hypot(L1[0] - J[0], L1[1] - J[1]) * 0.42
        best = (L1, (J[0] + tJ[0] * k0, J[1] + tJ[1] * k0), (L1[0] - tL[0] * k0, L1[1] - tL[1] * k0), 0)
    L1, c1, c2, idx = best
    stroke = 'M %s C %s %s %s' % (q(J), q(c1), q(c2), q(L1))
    # band: bridge, then back up the old throat line offset 6 units toward the nape, then into the head
    old = tp[:idx + 1]
    def off(i):
        a, b = old[max(0, i - 1)], old[min(len(old) - 1, i + 1)]
        t = _unit((b[0] - a[0], b[1] - a[1]))
        n = (-t[1], t[0])
        if n[0] * inward[0] + n[1] * inward[1] < 0:
            n = (-n[0], -n[1])
        return (old[i][0] + n[0] * 6.0, old[i][1] + n[1] * 6.0)
    back_pts = [off(i) for i in range(len(old) - 1, -1, -1)] if len(old) > 1 else []
    tail = [(J[0] + inward[0] * 8.0, J[1] - 4.0)]
    fill = stroke + ''.join(' L %s' % q(p) for p in back_pts + tail) + ' Z'
    g['throat'] = {'fill': fill, 'stroke': stroke}
    return g


heads['upLeftScreen'] = build_up(
    'upLeftScreen', PROFILE_L, C, 1, 'rigLeft.ts',
    lip_cut='M 46 99 C 50 107 57 112 67 115 C 83 119 101 118 113 119 C 115 119.3 117 119.6 118.5 120',
    back_path='M 142 37 C 165 37 185 43 192 57 C 196 65 194 76 186 84 C 182 89 177 95 171 101',
    inner_band='M 139 39 C 140 44 141 50 141 56 C 143 68 147 80 152 86 C 153 80 151 70 149 60 C 147 52 144 45 139 39 Z')
heads['upRightScreen'] = build_up(
    'upRightScreen', PROFILE_R, CRF, -1, 'rigRight.ts',
    lip_cut='M 588 95 C 585 102 578 107 568 110 C 552 113 532 113 520 114 C 518 114.2 516 114.6 514.5 115',
    back_path='M 498 35 C 474 35 452 40 443 52 C 437 62 439 76 447 84 C 451 90 456 96 462 102',
    # the hanging pale ear shows its pink inner over the front half of the flap (badger_pose_looking_up.png)
    inner_band='M 496 42 C 490 48 485 56 481 64 C 478 71 475 78 471 83 C 466 77 464 69 466 61 C 468 52 474 45 482 40 C 488 37 493 38 496 42 Z')
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
