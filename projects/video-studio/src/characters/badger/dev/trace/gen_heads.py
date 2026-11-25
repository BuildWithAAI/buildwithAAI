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

# =============================================================================== SHOCKED MOUTH (round 3)
# Round-3 repair (R2 final review, major): the shocked mouth was drawn upside down: a nearly flat top over a deep round
# bowl, a 'D' on its side, so with the wide eyes it read as an open-mouthed grin (and so did every sound-clip mouthOpen,
# which grows this shape). Re-traced from badger_expr_shocked.png by column scans of its outline, mapped into NF px by the
# nose (the panel's nose is 56 x 47 px, NF's 51 x 44: k 0.92, nose bottoms aligned, centred on the philtrum). It is a
# gasp: the top edge arches up from the corners to an apex under the philtrum (15.8 NF px = 8.8 units above the corners),
# the corners are pointed and drop steeply, the bottom is a shallow curve 3.1 px (1.7 units) below the corners, and a thin
# pink tongue crescent lies on the bottom edge (about 6.5 x 30 px). Width 45.6 px = 25.3 units (0.89 of the nose width),
# height 19 px = 10.5 units (0.43 of the nose height). The panel draws it a little off-centre (that head is tilted); the
# rig's front head is symmetric, so each half takes the averaged half-profile, fitted with one cubic (least squares on
# the scanned drops 2.3 / 3.7 / 6.0 / 8.7 / 12.0 / 15.8 px at 0.33 / 0.5 / 0.67 / 0.84 / 0.95 / 1 of the half-width).
# The template is in apex-relative NF px; each head maps it with its own point map (front: NF px; 3/4: foreshortened,
# in head-local units).
SHOCK_TOP = [(-22.8, 15.8), (-22.5, 7.0), (-5.0, 0.0), (0.0, 0.0), (5.0, 0.0), (22.5, 7.0), (22.8, 15.8)]
SHOCK_BOTTOM = [(22.8, 15.8), (16.0, 20.2), (-16.0, 20.2), (-22.8, 15.8)]
# the tongue: a thin pink lens low in the opening, as the panel draws it (scanned: 27.6 px wide, from 9.9 px below the apex
# to 15.9 px, just above the bottom outline at 18 px); its tips sit 14.6 px below the apex, 13.8 px either side
SHOCK_TONGUE = [(13.8, 14.6), (6.0, 9.6), (-6.0, 9.6), (-13.8, 14.6), (-6.0, 17.3), (6.0, 17.3)]


def shocked_mouth(T):
    """(opening, tongue) paths of the shocked mouth, every template point mapped by T(x, y)."""
    q = lambda p: '%.2f %.2f' % T(*p)
    t = SHOCK_TOP
    b = SHOCK_BOTTOM
    opening = ('M %s C %s %s %s C %s %s %s C %s %s %s Z'
               % (q(t[0]), q(t[1]), q(t[2]), q(t[3]), q(t[4]), q(t[5]), q(t[6]), q(b[1]), q(b[2]), q(b[3])))
    g = SHOCK_TONGUE
    tongue = 'M %s C %s %s %s C %s %s %s Z' % (q(g[0]), q(g[1]), q(g[2]), q(g[3]), q(g[4]), q(g[5]), q(g[0]))
    return opening, tongue


SHOCK_APEX_NF = (208.0, 210.4)   # under the philtrum ('M 208 197 L 208 211' ends inside the outline)
SHOCK_OPEN_NF, SHOCK_TONGUE_NF = shocked_mouth(lambda x, y: (SHOCK_APEX_NF[0] + x, SHOCK_APEX_NF[1] + y))


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
    # round 3 (R2 review minor): the sheet's irises fill more of the eye and tuck under the upper lid (iris 0.24-0.25 of the
    # eye spacing on badger_expr_neutral.png, eye opening 0.45 of it); was half-width 21 and iris r 10.6 (0.21 and 0.41)
    'eyes': [(156, 103, 22.5, 10.5, 10, 10, 1, 12.2, 0.5, 1, 'R'), (259, 103, 22.5, 10.5, 10, 10, -1, 12.2, -0.5, 1, 'L')],
    'brows': [((139, 85), (157, 76), (176, 81), 'R'), ((277, 85), (259, 76), (240, 81), 'L')],
    'mouth': {
        'neutral': {'strokes': ['M 129 175 C 137 190 147 204 160 214 C 176 219 193 217 208 211 C 223 217 240 219 252 214 C 261 204 270 191 278 176'],
                    'details': ['M 185 228 C 197 231 219 231 231 228'], 'fills': []},
        # happy, round-3 repair (R2 review minor; badger_expr_happy.png, normalised by the eye spacing): the panel's smile is ONE
        # interior line about 0.75 of the face width at that height (ends 19 px inside the face edge, 23 px above the philtrum
        # notch, low points 8 px below it), with only a small upturn at each end; the jaw line leaves the cheek and stops
        # short, outside the smile, instead of running parallel to it (that read as a doubled cheek line and a broad double
        # smile); the lower-lip arc sits about 19 px under the smile's low points, as on the panel
        # happy, round-4 repair (R3 review minor): the R3 jaw stubs left the face contour at the jaw corners and stopped in
        # round caps (a thorn on each side of the face outline), and the 3.5-unit end curls, separate detail strokes folding
        # back over the smile's end, read as knobs. badger_expr_happy.png has a smooth face contour (it runs on into the neck
        # line) and single-line curls: the stubs are gone and each curl is the smile stroke itself, continued 9.5 px up past
        # its end along its own curvature (tangent-continuous at (153, 183) / (263, 183), the tip leaning slightly out).
        # round 4, second pass: dropping the stubs left the lower face OPEN wherever the front head sits on a SIDE rig (the
        # default left view): there the face's jaw edge meets the background, not the front neck, and nothing stroked it
        # (seal check: 400-500 px of coat touching background at 2.4 px/u, left and right rigs; neutral, worried and
        # shocked close it with their own jaw lines). On side mounts only, happy carries the face contour smoothly past
        # the jaw: ONE stroke from each cheek's end down the neutral mouth's jaw line, along the lower-lip arc and up the
        # other side (tangent-continuous at every join, no free end). In the bust and the front view the jaw edge lies on
        # the neck, so they keep the panel's open lower face (smile + lower-lip arc, no stub).
        'happy': {'strokes': ['M 150.8 173.5 C 150.9 176.5 151.6 179.6 153 183 C 157 196 164 207 175 211 C 187 215 199 213 208 206 '
                              'C 217 213 229 215 241 211 C 252 207 259 196 263 183 C 264.4 179.6 265.1 176.5 265.2 173.5'],
                  'details': ['M 178 224.5 C 193 233.5 223 233.5 238 224.5'], 'fills': [],
                  # drawn only when the head is mounted on a SIDE rig (Head prop `mounted`), see the comment above
                  'sideStrokes': ['M 129 175 C 137 190 147 204 160 214 C 166 218.2 172 221.6 178 224.5 C 193 233.5 223 233.5 238 224.5 '
                                  'C 243.5 221.6 248 218.2 252 214 C 261 204 270 191 278 176']},
        # worried, round-4 repair (R3 review minor): it was a nearly straight bar right across the lower face, meeting both
        # cheek contours at hard corners (91 NF px wide against the neutral mouth's 67) with a short frown floating 14 px
        # below, so the lower face read as a box jaw. badger_expr_worried.png (column scans) draws the same closed LENS as
        # the neutral panel (upper lip 10.5 px above the corners at the middle, lower lip 7.5 px below them) but narrower,
        # with the cheek lines running steeply straight into drooping corners (no gull-wing hook). Retraced as the neutral
        # construction with the corners 4.5 px (2.5 units) lower and 4 px further in each side (59 px wide), the lower lip
        # 7 px under the corners, the cheek contours running into the corners; the floating frown is gone.
        'worried': {'strokes': ['M 129 175 C 139 192 158 212 178.5 224.5 C 187 218 198 211.5 208 210.5 C 218 211.5 229 218 237.5 224.5 '
                                'C 258 212 270 193 278 176',
                                'M 178.5 224.5 C 188 229.5 198 231.5 208 231.5 C 218 231.5 228 229.5 237.5 224.5'],
                    'details': [], 'fills': []},
        # shocked: the round-3 gasp (SHOCKED MOUTH above) under the philtrum; the jaw contour stays continuous below it
        'shocked': {'strokes': ['M 129 175 C 138 196 152 216 172 230 C 186 239 198 243 208 243 C 220 243 233 238 245 230 '
                                'C 263 217 272 196 278 176',
                                SHOCK_OPEN_NF],
                    'details': [],
                    'fills': [(SHOCK_OPEN_NF, 'mouth'), (SHOCK_TONGUE_NF, 'tongue')],
                    # round 5: this jaw line is the whole lower contour, so a side mount's jaw closure is not drawn with it
                    'fullJaw': True},
    },
    # pale ANATOMICAL RIGHT ear (screen left in the front view): flap + pink ribbon + small spot
    'earR': {
        # worried / earsBack: the flap swings down and out about its base (~20 deg) and keeps its width (round-1 repair)
        # round-2 repair (BADGER-D38): worried / earsBack splays the flap out and down as on badger_expr_worried.png: a
        # smaller swing (-11.5 deg at full) plus a lengthwise stretch along the root-to-tip axis (1.36 at full; at the worried
        # 0.7: about 10 units out and 10 down at the tip)
        'pivot': (126, 66), 'backRot': -11.5, 'backSx': 0.96, 'stretch': 1.36, 'tip': (40, 80),
        'fills': [
            ('M 158 31 C 150 25 136 17 122 17 C 109 17 97 26 86 35 C 72 45 52 55 40 66 C 34 72 35 86 42 93 '
             'C 50 102 60 113 70 116 C 77 117 83 111 89 104 C 96 107 104 111 113 113 C 114 100 118 82 124 66 '
             'C 129 56 135 50 141 47 C 147 42 153 36 158 31 Z', 'coat', False),
            # round-2 repair (BADGER-D38): the pink band runs to the flap's inner edge and bottom (clipped to the flap), so no
            # white sliver shows under it or beside the fold
            ('M 91.4 105 C 91.6 104 91.8 103 92 102 C 96 85 100 68 106 55 C 110 45 116 37 123 35 C 128 34 133 38 136 45 '
             'C 137 46.2 138.4 47 139.8 47.6 L 150 48 L 122 120 L 88 112 Z', 'earPaleInner', True),
            (ellipse_path(88, 51, 4.6, 9.0, 28), 'spot', True),
        ],
        # round-2 repair (BADGER-D38): ONE closed flap outline (it used to stop at the root and beside the band, leaving a
        # shelf stub at the base and a tick at the top of the fold) plus the band's free edge; the interior tick is gone
        'strokes': [
            'M 158 31 C 150 25 136 17 122 17 C 109 17 97 26 86 35 C 72 45 52 55 40 66 C 34 72 35 86 42 93 '
            'C 50 102 60 113 70 116 C 77 117 83 111 89 104 C 96 107 104 111 113 113 C 114 100 118 82 124 66 '
            'C 129 56 135 50 141 47 C 147 42 153 36 158 31 Z',
            'M 91.4 105 C 91.6 104 91.8 103 92 102 C 96 85 100 68 106 55 C 110 45 116 37 123 35 C 128 34 133 38 136 45 '
            'C 137 46.2 138.4 47 139.8 47.6',
        ],
        'details': [],
        'spot': (88, 51, 4.6, 9.0, 28),
    },
    # dark-capped ANATOMICAL LEFT ear (screen right in the front view)
    'earL': {
        # round-2 repair (BADGER-D38): with the stretch the dark tip drops about 14 units at the worried 0.7
        'pivot': (285, 60), 'backRot': 20, 'backSx': 0.96, 'stretch': 1.21, 'tip': (355, 100),
        'fills': [
            # round-2 repair (BADGER-D38): the pale inner runs on under the cap's hollow edge (a white sliver of skull showed
            # between them)
            ('M 295 104 C 289 94 288 80 294 68 C 301 57 322 54 335 62 C 339 66 340 72 337 75 '
             'C 330 84 316 94 303 106 C 300 108 297 108 295 104 Z', 'earPaleInner', False),
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
    piv = pt(*src['pivot'], f)
    out = {'side': side, 'pivot': piv, 'backRot': src['backRot'], 'backSx': src['backSx'] * sx_extra,
           'fills': [{'d': mp(d, f), 'color': c, **({'clip': True} if clip else {})} for (d, c, clip) in src['fills']],
           'strokes': [mp(d, f) for d in src['strokes']], 'details': [mp(d, f) for d in src['details']]}
    if src.get('stretch'):
        tip = pt(*src['tip'], f)
        out['stretch'] = src['stretch']
        out['axis'] = round(math.degrees(math.atan2(tip['y'] - piv['y'], tip['x'] - piv['x'])), 2)
    return out


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
                      'fills': [{'d': mp(d, fFace), 'color': c} for d, c in v['fills']],
                      **({'sideStrokes': [mp(d, fFace) for d in v['sideStrokes']]} if 'sideStrokes' in v else {}),
                      **({'fullJaw': True} if v.get('fullJaw') else {})}
                  for k, v in src['mouth'].items()},
        'earsFront': front,
    }


heads['front'] = build_from_front(FRONT, F, F, F, F, 'front')
# Round-2 repair (BADGER-D38), front head:
#  * the skull's top corners under the ears are rounded and the skull outline is ONE stroke from the left jaw over the top
#    to the right jaw (it used to stop at the ear roots, so folding an ear opened a gap in the outline);
#  * the neutral mouth is the sheet's closed mouth: the jaw lines run into the gull-wing upper lip at the corners
#    (badger_expr_neutral.png: corners about 33 px either side of the philtrum) and the lower lip joins it there (it was a
#    floating dash and the right jaw ended in a stub below the corner). The sheet draws no chin outline; neither do we;
#  * two nostril curls on the nose (line colour only; no highlight tone).
FRONT_SKULL_ROUND = ('M 141 31 C 165 23 245 22 262 29 C 274.2 34.3 283.6 43.3 287.2 57.3 C 290.4 69.9 290.4 81.8 289 92 '
                     'C 293 118 294 148 288 162 C 284 170 280 174 277 177 C 271 192 262 205 252 216 C 244 230 228 243 208 244 '
                     'C 188 243 172 230 164 216 C 154 205 145 192 139 177 C 135 173 131 169 127 162 C 120 148 115 125 116 100 '
                     'C 116.7 81.1 120.9 62 127.7 48.7 C 133.5 37.9 138.5 33.6 141 31 Z')
FRONT_OUTLINE = ('M 129 175 C 125 170 122 165 119 158 C 114 145 112 125 113 104 C 113.8 85.1 118.4 63 126.6 48.7 '
                 'C 133.3 37.4 144.3 35.9 158 31 C 175 25 195 22 207 22 C 225 22 245 26 258 32 C 271 37.9 282.2 46.2 287.6 59.1 '
                 'C 293 72.1 291.5 85.9 293 100 C 295 120 294 145 289 158 C 286 165 282 171 278 176')
FRONT_NEUTRAL_MOUTH = ['M 129 175 C 138 191 156 210 174.5 220 C 186 214 198 210 208 209 C 218 210 230 214 241.5 220 '
                       'C 260 210 270 193 278 176',
                       'M 174.5 220 C 186 228 197 230.5 208 230.5 C 219 230.5 230 228 241.5 220']
FRONT_NOSTRILS = ['M 205 173.5 C 201.5 172.8 199 175.2 199.5 178.2 C 200 180.6 203 181.6 205.5 180.2',
                  'M 216 173.5 C 219.5 172.8 222 175.2 221.5 178.2 C 221 180.6 218 181.6 215.5 180.2']
# Round 5 (R4 review minor, seal check): the skull fill ran 2.8 units inside the outline's centre line along both cheeks
# (FRONT_SKULL_ROUND, rounded under the ears), so a 1-unit sliver of whatever lay behind the head showed between the outline
# and the coat, background wherever no neck was behind it (it read as a light line inside the cheek contour on the side
# rigs, worst with the shocked jaw: 242 px at 3.2 px/u). The fill now runs ALONG the outline from the left jaw corner over
# the crown to the right one, and keeps the old jaw-to-chin edge below.
# Below the jaw corners the fill follows the OUTER jaw contour (the shocked mouth's jaw line, the lowest of the
# expressions' jaw lines): it used to tuck 3-4 units inside the neutral / worried jaw lines, which left a background sliver
# inside the jaw on the side rigs; there the side-mount jaw closure (mountJaws) strokes this edge on the throat side and
# the expression's own jaw line reads as the lip line inside it. In the bust and the front view the neck lies behind it.
FRONT_JAW_EDGE = 'C 272 196 263 217 245 230 C 233 238 220 243 208 243 C 198 243 186 239 172 230 C 152 216 138 196 129 175'
FRONT_SKULL_FILL = 'M 129 175 ' + FRONT_OUTLINE[len('M 129 175 '):] + ' ' + FRONT_JAW_EDGE + ' Z'
heads['front']['skull']['fill'] = mp(FRONT_SKULL_FILL, F)
heads['front']['skull']['strokes'] = [mp(FRONT_OUTLINE, F)]
heads['front']['mouth']['neutral'] = {'strokes': [mp(d, F) for d in FRONT_NEUTRAL_MOUTH], 'details': [], 'fills': []}
heads['front']['nose']['details'] = [mp(d, F) for d in FRONT_NOSTRILS]

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
    m['happy']['strokes'] = [mp(src['happy']['strokes'][0], fFace)]
    m['happy']['details'] = []
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
    # the front head's side-mount jaw closure is drawn in front-face space; the 3/4 heads close their own jaw (chin line)
    for _m in heads[view]['mouth'].values():
        _m.pop('sideStrokes', None)
    # round-1 repair: the far ear shows its outer side only (badger_turn_34.png draws the far dark ear solid), and the
    # irises fill more of the almond, as on the sheet's 3/4 head
    for e in heads[view]['earsBehind']:
        for fl in e['fills']:
            if fl['color'] == 'earPaleInner':
                fl['color'] = 'earCap' if e['side'] == 'L' else 'coat'
    # round 3: the front eye grew (half-width 21 -> 22.5, iris 10.6 -> 12.2 NF px); the 3/4 heads keep the eye width and the
    # iris they were fitted to on badger_turn_34.png (iris 1.15 x the old front iris, now the same as the new front iris)
    for e in heads[view]['eyes']:
        e['irisR'] = round(e['irisR'] * 1.15 * 10.6 / 12.2, 2)
        e['w'] = round(e['w'] * 21.0 / 22.5, 2)
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

# ------------------------------------------------------------------------------- 3/4 lower face, round-2 repair
# Round-2 repair (decision BADGER-D36), measured on badger_turn_34.png warped into head-local units (eyes aligned:
# 50 crop px = 46.4 units): the muzzle projects past the far eye with the nose at its tip (nose centre 7 units beyond the
# far eye, 32 units below the eye line; it used to sit under the far eye, 9 units lower), the far silhouette runs from
# under the far ear straight to the nose, the mouth rises to the far lip corner under the nose, the chin line is outlined
# and sits about 15 units higher than the front head's (the sheet's 3/4 lower face is shorter), a bridge line runs from
# below the far eye to the nose, and the far upper lip under the nose is in shadow left of the philtrum.
# The skull outline is ONE stroke: over the top, round the (rounded) far-top corner behind the far ear, down the far
# temple, round the muzzle behind the nose, down the far muzzle side and along the chin line, so nothing shows between the
# far ear and the skull at any ear fold. The far ear is one solid silhouette with one outline (its front-view inner and fold
# fills and strokes are gone, they left a white crescent and a black needle at the ear root).
# Authored for the screen-right turn; the screen-left turn uses the same UNMARKED outline, nose and mouth geometry with
# x -> -x (as INT-B1 already did for the far outline). Ears, eyes and every marking keep their own per-side construction.
# Round-3 repair (R2 final review, major): the crown stroke used to start at (-29.4,-102.2), 3.8 units right of the near pale
# ear's root corner (-33.2,-102.2), so a notch of unstroked skull top showed between them (and on the screen-left turn's
# mirrored construction). The crown now STARTS UNDER THE EAR: TQ_CROWN_UNDER_EAR continues the dome's first segment backward
# (G1 at (-29.4,-102.2), on the dome's own osculating circle, R 73.3 units, 10.5 units of arc) down to E (-39.1,-98.1). The
# ear is drawn after the skull strokes (earsFront), so its fill hides the overlap and the crown emerges from under the ear's
# outline. The fill's top-left corner follows the same curve (it had a flat shoulder under the ear), so the outline stays on
# the fill's edge when the ear swings back.
TQ_CROWN_UNDER_EAR = 'M -39.1 -98.1 C -36 -99.7 -32.7 -101.07 '
TQ_SKULL_TOP_FAR = (TQ_CROWN_UNDER_EAR + '-29.4 -102.2 C -19.4 -105.6 -7.6 -107.2 -0.6 -107.2 C 7.5 -107.2 15.5 -105.8 21.5 -103.2 '
                    'C 28 -100.4 33.2 -94.6 36.6 -87.2 C 39.8 -80.4 41.8 -72.4 42.4 -64.6 C 42.6 -60.6 42.6 -57 43.2 -53.5 '
                    'C 44.8 -48.8 47.8 -44.6 50.4 -41.2 C 51.6 -39.2 52.1 -35.5 52.2 -31.5 C 52.3 -27.5 52.4 -24.2 52.9 -21.6 '
                    'C 53.5 -18.5 53.2 -14.6 51.6 -11.2 C 50 -7.8 47 -4.4 42.6 -2.3 C 37.5 0 30 0.7 23.5 0.3 '
                    'C 17.5 -0.1 12 -1.6 8 -3.4')
# Round-4 repair (R3 review minor): the near cheek stroke started 3 units beside the near ear's bottom-inner corner (a
# visible round-cap tick), and above it the skull fill's near edge ran 2-5 units inside the ear's inner edge, so a wedge of
# background (up to 3 units, rows -78 .. -62) showed between the pale ear and the face on the screen-right head.
# badger_turn_34.png runs the near cheek contour out from under the ear's bottom corner. Now the cheek stroke STARTS UNDER
# THE EAR (2.5 units inside its inner edge), passes the ear's bottom-inner corner (-59.2, -56.2) and rejoins the old cheek
# line at (-51.4, -31.7) along its own tangent; the skull fill's near edge follows the new cheek line 1.2 units inside and
# then runs up under the ear (1.5 units inside its inner edge) to the old root at (-51.57, -88), so no background shows
# between ear and face at any ear fold. Unmarked geometry: the screen-left head uses it with x -> -x (D36), where it lies
# under the dark ear (checked: 3+ units inside its inner edge from row -92 to its corner).
TQ_NEAR_CHEEK = ('M -61.2 -65 C -60.9 -60.2 -60.1 -56.2 -59.1 -52.4 C -57.6 -46.3 -55.2 -38.8 -51.4 -31.7 '
                 'C -49.3 -27.8 -47.2 -25 -44.6 -22.2 C -43 -20 -41.6 -18.2 -40.2 -16.6')
TQ_EAR_INNER_R = [(-58.9, -60), (-58.25, -64), (-57.5, -68), (-56.5, -72), (-55.25, -76), (-54.0, -80), (-52.25, -84), (-49.75, -88)]


def _tq_near_edge():
    """The skull fill's near edge from (-46.5, -29.4) up to (-51.57, -88): 1.2 units inside the (new) near cheek stroke,
    then 1.5 units inside the near ear's inner edge (round 4). Returned as cubic segments ('C ...') through the points."""
    segs = TQ_NEAR_CHEEK.replace('M ', '').split(' C ')
    p0 = tuple(float(v) for v in segs[0].split())
    c = [tuple(float(v) for v in segs[1].split()[i:i + 2]) for i in (0, 2, 4)]
    pts = []
    q0 = p0
    for seg in segs[1:3]:
        v = [float(t) for t in seg.split()]
        a, b, e = (v[0], v[1]), (v[2], v[3]), (v[4], v[5])
        for k in range(0, 21):
            t = k / 20
            u = 1 - t
            x = u ** 3 * q0[0] + 3 * u * u * t * a[0] + 3 * u * t * t * b[0] + t ** 3 * e[0]
            y = u ** 3 * q0[1] + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t ** 3 * e[1]
            dx = 3 * u * u * (a[0] - q0[0]) + 6 * u * t * (b[0] - a[0]) + 3 * t * t * (e[0] - b[0])
            dy = 3 * u * u * (a[1] - q0[1]) + 6 * u * t * (b[1] - a[1]) + 3 * t * t * (e[1] - b[1])
            L = math.hypot(dx, dy) or 1
            # inside = to the right of the downward-running near cheek (+x side of its normal)
            pts.append((x - dy / L * 1.2 * (-1), y + dx / L * 1.2 * (-1)))
        q0 = e
    # keep the offset curve from the old fill corner (y -29.4) up to the ear's corner, then hug the ear's inner edge
    run = [p for p in pts if -57.5 <= p[1] <= -31.0]
    run.sort(key=lambda p: -p[1])
    run = run[::5] + ([run[-1]] if (len(run) - 1) % 5 else [])
    ear = [(x - 1.5, y) for x, y in TQ_EAR_INNER_R]
    P = [(-46.5, -29.4)] + run + ear + [(-51.57, -88.0)]
    out = []
    for i in range(len(P) - 1):
        a0 = P[i - 1] if i else P[i]
        a1, a2 = P[i], P[i + 1]
        a3 = P[i + 2] if i + 2 < len(P) else a2
        c1 = (a1[0] + (a2[0] - a0[0]) / 6, a1[1] + (a2[1] - a0[1]) / 6)
        c2 = (a2[0] - (a3[0] - a1[0]) / 6, a2[1] - (a3[1] - a1[1]) / 6)
        out.append('C %.2f %.2f %.2f %.2f %.2f %.2f' % (c1 + c2 + a2))
    return ' '.join(out)


TQ_SKULL_NEAR_BOTTOM = ('C 9.4 0.2 9.6 4.4 7.2 7.6 C 3.6 10 -3.4 9.9 -9.6 7.6 C -16.6 4.6 -21.6 -1 -25.6 -6.6 '
                        'C -30 -12.6 -34.4 -16.6 -38.6 -21.1 C -41.2 -23.3 -43.8 -25.6 -46.5 -29.4 '
                        + _tq_near_edge() + ' C -50.98 -93.66 -44.17 -95.52 -39.1 -98.1 Z')
TQ_SKULL_FILL = TQ_SKULL_TOP_FAR + ' ' + TQ_SKULL_NEAR_BOTTOM
# round 4: the bridge starts 2.5 units further in, under the far eye's new place (TQ_FAR_EYE_IN), and keeps its end at the nose
TQ_BRIDGE = 'M 29.1 -55 C 34.4 -51.3 40.4 -46.9 46.6 -42.4 C 47.6 -41.4 48.4 -40.4 49 -39.4'
# Round-4 repair (R3 review minor): the far eye's outer corner touched the far contour, and with the full-weight bridge the
# three lines made a dark knot; badger_turn_34.png draws the far eye as a full almond with white between it and the contour
# (eye-aligned row scans: the far contour sat about 3 crop px, 2.8 units, too close to the far iris). The far eye and its
# brow move 2.5 units toward the face centre; the bridge is drawn at detail weight (parts/heads/Head.tsx).
TQ_FAR_EYE_IN = 2.5
TQ_NOSE = ('M 39 -38.8 C 45.3 -39 50.6 -37.6 52.6 -33.8 C 54.1 -30.4 53.2 -26.1 50.2 -23.7 C 47.5 -21.7 44 -21 41.2 -21.3 '
           'C 37.8 -21.6 33.1 -23.2 30.3 -26.4 C 27.9 -29.2 28.1 -33.6 30.7 -36.2 C 32.9 -38.2 35.8 -38.8 39 -38.8 Z')
TQ_PHILTRUM = 'M 41.3 -21.6 C 41 -17.7 40.6 -14.3 40.3 -11.2'
TQ_SHOCK_APEX = (40.4, -11.8)
TQ_SHOCK_OPEN, TQ_SHOCK_TONGUE = (map_path(d, lambda x, y: (x, y)) for d in shocked_mouth(
    lambda x, y: (TQ_SHOCK_APEX[0] + x * S_NF * (0.86 if x < 0 else 0.59), TQ_SHOCK_APEX[1] + y * S_NF * 0.76)))
TQ_MOUTH = {
    'neutral': {'strokes': ['M -17.5 -11.5 C -12.5 -7 -6.5 -4.6 1 -4.3 C 10 -4 21 -6 31 -7.8 C 37 -8.9 42 -9.8 45.6 -10.6'],
                'details': [], 'fills': []},
    # round 4: the near curl is the smile stroke continued up past its end (tangent-continuous), not a separate detail stroke
    # folding back over it (that read as a knob)
    'happy': {'strokes': ['M -20.6 -20.4 C -20.5 -18.4 -19.9 -16.1 -18.6 -14.2 C -13.6 -7.2 -6.6 -3.8 1.6 -3.3 C 12.2 -2.6 24.2 -4.8 33.6 -7.4 '
                          'C 38.6 -8.8 42.6 -10.4 46.2 -12.4'],
              'details': [], 'fills': []},
    'worried': {'strokes': ['M -16.2 -5.2 C -12.6 -7.4 -7 -6.8 0 -6.2 C 9 -5.6 19 -7.2 29 -8.4 C 35.6 -9.1 41 -9.8 45.6 -10.6'],
                'details': [], 'fills': []},
    # round 3: the same gasp, foreshortened for the turn (near half 0.86, far half 0.59 of the front's width, height 0.76 so
    # it stays about 0.45 of this view's smaller nose), its apex at the end of the philtrum
    'shocked': {'strokes': [TQ_SHOCK_OPEN], 'details': [],
                'fills': [{'d': TQ_SHOCK_OPEN, 'color': 'mouth'}, {'d': TQ_SHOCK_TONGUE, 'color': 'tongue'}]},
}
TQ_SHADOWS = [
    # underside of the jaw below the mouth (soft-edged grey on the sheet), clipped to the skull
    {'d': 'M -14 -8.8 C -8 -5.4 0 -4.6 8.6 -4.8 C 11.6 -1.6 12.6 2.6 11.6 6.6 C 6 9.8 -1 10 -7.6 8.2 C -11.6 4 -13.6 -2 -14 -8.8 Z',
     'color': 'coatShadow'},
    # far upper lip under the nose, left of the philtrum
    {'d': 'M 30.4 -25 C 33.6 -22.2 37.2 -21.2 41 -21.3 C 40.8 -17.6 40.6 -14.2 40.3 -11 C 36.8 -10.4 33.4 -10.2 30.6 -10 C 29 -14.8 29 -20 30.4 -25 Z',
     'color': 'coatShadow'},
]
TQ_CHEEK_NEAR = (-30.6, -29.6)   # near cheek spot centre (badger_turn_34.png), head-local units, screen-right turn
EAR_L_UNION = ('M 254 33 C 264 24 278 17 292 17 C 312 19 335 38 352 52 C 362 60 366 72 365 84 C 364 94 360 101 354 101 '
               'C 349 100 345 93 341 86 C 339.5 82.5 338.3 78.6 337 75 C 330 84 316 94 303 106 C 300 108 297 107 296 104 '
               'C 295 103 294 102 293 101 C 288 90 280 70 272 55 C 266 45 260 38 254 33 Z')
EAR_R_FLAP = FRONT['earR']['fills'][0][0]


def _mx(d):
    return map_path(d, lambda x, y: (-x, y))


def rebuild_three_quarter(view, theta):
    right = theta > 0
    g = heads[view]
    m = (lambda d: d) if right else _mx
    g['skull']['fill'] = m(TQ_SKULL_FILL)
    g['skull']['strokes'] = [m(TQ_SKULL_TOP_FAR), m(TQ_NEAR_CHEEK)]
    # the far eye (anatomical left in the screen-right turn) and its brow move toward the face centre
    far_eye_side = 'L' if right else 'R'
    inward = -TQ_FAR_EYE_IN if right else TQ_FAR_EYE_IN
    for e in g['eyes']:
        if e['side'] == far_eye_side:
            e['c'] = {'x': round(e['c']['x'] + inward, 2), 'y': e['c']['y']}
    for b in g['brows']:
        if b['side'] == far_eye_side:
            for k in ('outer', 'mid', 'inner'):
                b[k] = {'x': round(b[k]['x'] + inward, 2), 'y': b[k]['y']}
    g['skull']['details'] = []
    g['bridge'] = m(TQ_BRIDGE)
    g['chin'] = None
    g['nose'] = {'d': m(TQ_NOSE)}
    g['philtrum'] = m(TQ_PHILTRUM)
    g['mouth'] = {k: {'strokes': [m(d) for d in v['strokes']], 'details': [m(d) for d in v['details']],
                      'fills': [{'d': m(f['d']), 'color': f['color']} for f in v['fills']]} for k, v in TQ_MOUTH.items()}
    g['shadows'] = [{'d': m(x['d']), 'color': x['color']} for x in TQ_SHADOWS]
    g['clipMouth'] = True
    # markings: the near cheek spot sits where the sheet draws it; the far cheek spot is hidden behind the muzzle (as the
    # profiles hide both, D05). Each spot keeps its own side: the near cheek is the anatomical RIGHT one in the screen-right
    # turn and the anatomical LEFT one in the screen-left turn.
    near_id, far_id = ('H-CHEEK-R', 'H-CHEEK-L') if right else ('H-CHEEK-L', 'H-CHEEK-R')
    cx, cy = TQ_CHEEK_NEAR
    src = FRONT['cheekR'] if right else FRONT['cheekL']
    # round-3 repair: the screen-left turn's near cheek is the anatomical LEFT spot, placed by its OWN front-view position
    # relative to the right one (badger_expr_neutral.png: both 74 px from the face centre, the left one 2 px higher), so it
    # is not the right cheek's 3/4 position mirrored (tests/spotsNoMirror.test.ts measured that pair 0.32 units apart)
    if not right:
        cx = cx - ((FRONT['cheekL'][0] - 208) - (208 - FRONT['cheekR'][0])) * S_NF
        cy = cy + (FRONT['cheekL'][1] - FRONT['cheekR'][1]) * S_NF
    spot = me(0, 0, src[2] * S_NF * 0.92, src[3] * S_NF, src[4], lambda x, y: (x + (cx if right else -cx), y + cy))
    g['markings'] = [{'id': near_id, 'd': spot}]
    markings[near_id][view] = spot
    markings[far_id].pop(view, None)
    # far ear: one solid silhouette with one outline, behind the skull
    fEar = compose(turn_ear(theta, 'L' if right else 'R'), F)
    for e in g['earsBehind']:
        if right:
            e['fills'] = [{'d': mp(EAR_L_UNION, fEar), 'color': 'earCap'}]
            e['strokes'] = [mp(EAR_L_UNION, fEar)]
        else:
            flap = mp(EAR_R_FLAP, fEar)
            e['fills'] = [{'d': flap, 'color': 'coat'}, {'d': me(*FRONT['earR']['spot'], fEar), 'color': 'spot', 'clip': True}]
            e['strokes'] = [flap]
        e['details'] = []


for _v, _t in (('threeQuarterRightScreen', 36.0), ('threeQuarterLeftScreen', -36.0)):
    rebuild_three_quarter(_v, _t)

def _crown_under_ear(seg, x_to):
    """Round-3 repair (R2 final review, major): a profile's crown stroke starts UNDER the ear. seg is the skull fill's top
    cubic that leaves the visible crown at its first point P0 and runs on under the ear; the stroke takes that cubic from
    where it reaches x = x_to back to P0 (de Casteljau), so it lies exactly on the fill's edge, the ear (drawn later, in
    earsFront) hides it, and the crown line emerges from under the ear's outline instead of stopping short of it with a
    round cap (that left a white notch between the ear's corner and the crown). Returns 'M .. C .. P0'."""
    p0, p1, p2, p3 = seg
    def x_at(t):
        u = 1 - t
        return u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0]
    lo, hi = 0.0, 1.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if (x_at(mid) - x_to) * (p0[0] - x_to) > 0:
            lo = mid
        else:
            hi = mid
    (a0, a1, a2, a3), _ = _split(p0, p1, p2, p3, (lo + hi) / 2)
    return 'M %.2f %.2f C %.2f %.2f %.2f %.2f %.2f %.2f' % (a3 + a2 + a1 + a0)


# =============================================================================== PROFILE LEFT (CL)
# Retraced 2026-11-24 (round-1 repair) on reference/crops/badger_coat_left.png at 5x: deeper stop at the eye, muzzle
# underside 2.5 px lower, a nose the sheet's size (outer 20 x 21 px once outlined) shaped as the rounded tip of the muzzle,
# a small dark almond eye, and a short commissure mark instead of a second lip stroke over the jaw line.
KX_CL, KY_CL = 0.9398, 1.0455
C = lin(155, 100, KX_CL, KY_CL)
EAR_PL = ('M 139 39 C 150 36 162 36 172 40 C 182 44 192 51 195 59 C 197 66 194 72 187 76 '
          'C 180 80 172 85 163 89 C 159 90 155 89 152 86 C 147 80 143 68 141 56 C 140 50 139 44 139 39 Z')
# Round-4 repair (R3 review, major: outline break at the left profile's nape, every left walk frame). The neck's back line
# (gen_left.py NAPE_BACK) now leaves the dark ear at NAPE_L_J, on the ear's outline at its lower-back corner, as on
# badger_coat_left.png. The skull fill used to bulge 3-5 px past that line between the ear and row 84, over the line's
# start (the head is drawn after the neck), so only its unstroked edge showed there. Now the skull's back edge comes down
# from the occiput INTO NAPE_L_J (a 118 deg nape notch, hidden under the ear at rest: the back contour stays 2+ px inside the
# ear's outline until it meets it at NAPE_L_J) and then tucks inside the neck line (clear of its inner edge below the ear
# outline), and the head strokes that back edge from under the crown down to NAPE_L_J, so a
# folded ear (worried 0.7, judge, earsBack 1) uncovers an outlined occiput and nape instead of an open edge. The ear
# covers NAPE_L_J at rest; with headTilt the ear moves with it and still covers the line's start (gen_left.py extends the
# neck line 12 px up inside the ear). KEEP IN SYNC with gen_left.py NAPE_J.
NAPE_L_J = (187.0, 76.0)
PL_CROWN_BACK = ((142, 37), (165, 37), (185, 43), (192, 57))
PL_OCCIPUT = 'C 193.6 60.2 193.4 66 191.4 69.4 C 190.1 71.6 188.4 73.6 187 76'
_pl_crown_tail = _split(*PL_CROWN_BACK, 0.7)[1]
PL_BACK_STROKE = ('M %.2f %.2f C %.2f %.2f %.2f %.2f %.2f %.2f ' % (_pl_crown_tail[0] + _pl_crown_tail[1] + _pl_crown_tail[2]
                                                                    + _pl_crown_tail[3])) + PL_OCCIPUT
# round 4: the jaw line starts inside the nose (tangent into the chin curve), and the skull fill's chin follows the jaw stroke exactly (it bulged up to
# 1.5 px past it, a pale sliver outside the outline at the chin on every left profile and up-left frame)
PL_JAW_START = 'M 44.5 90 C 45.1 92.5 45.3 97.6 46 99 '
PROFILE_L = {
    'skull_fill': ('M 50 76 C 64 71 79 66 86 60 C 90 55 94 49 101 45 C 112 40 127 37 142 37 C 165 37 185 43 192 57 '
                   + PL_OCCIPUT + ' C 185.2 78.2 183.2 81.4 181.2 85.2 C 177.6 92.2 167.4 108.6 152 116 '
                   'C 140 120 132 122 126 122 C 118 119 108 118 96 118 '
                   'C 86.9 118 76.6 117.4 67 115 C 57 112 50 107 46 99 C 45.3 97.6 45.1 92.5 44.5 90 C 46 85 47 79 50 76 Z'),
    'skull_strokes': [_crown_under_ear(((142, 37), (165, 37), (185, 43), (192, 57)), 152) + ' C 127 37 112 40 101 45 C 94 49 90 55 86 60 C 79 66 64 71 49 77',
                      # round 4: starts 6 px up, under the nose (drawn later), so no unstroked gap is left between the
                      # nose's outline and the jaw line (it showed 2-3 units of bare fill edge on every left walk frame)
                      PL_JAW_START + 'C 50 107 57 112 67 115 C 83 119 101 118 113 119 C 119 120 123 122 127 124',
                      PL_BACK_STROKE],
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
# Round-3 repair: the crown stroke starts under the pale ear (_crown_under_ear) and the fill's crown control at x 514 sits
# on y 35 (was 36), so the top contour is tangent-continuous at (500, 35) where the crown runs on under the ear (the 4 deg
# corner there showed as a jog on the pitched look-up head).
PROFILE_R = {
    'skull_fill': ('M 583 76 C 571 70 557 65 549 61 C 543 57 539 52 534 47 C 527 41 514 35 500 35 C 474 35 452 40 443 52 '
                   'C 437 62 439 76 447 84 C 455 96 465 108 481 116 C 492 120 499 121 504 121 C 512 115 522 113 534 113 '
                   'C 550 114 566 112 578 107 C 585 103 589 97 589 90 C 589 84 587 79 583 76 Z'),
    'skull_strokes': [_crown_under_ear(((500, 35), (474, 35), (452, 40), (443, 52)), 470) + ' C 514 35 527 41 534 47 C 539 52 543 57 549 61 C 557 65 571 70 584 76',
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


from erode import parse as _parse, bez as _bez  # noqa: E402 (also used by the look-up section below)


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


# --- Round-4 repair (R3 review minor): the profile and look-up heads' sound-clip mouth (mouthOpen) now DROPS THE JAW.
# The lower jaw is the lens between the mouth line (commissure P -> lip front F, one cubic) and the jaw's underside
# contour (F -> P, the skull's own lower stroke). Head.tsx rotates that lens about the commissure by `deg` x the amount
# (front down), fills the gap between the fixed mouth line and the rotated one with the mouth colour (a wedge with its
# vertex at the commissure, outlined, the tongue on the lower jaw inside it) and outlines the rotated underside, so the
# chin visibly drops instead of the old thin wedge inside an unchanged muzzle.
JAW_MAX_DEG = 14.0


def _jaw(lower_stroke, wedge_vertex, f_t, lip_c1, lip_c2, deg):
    """Jaw geometry in source px: P = the point of the lower stroke nearest the shocked wedge's vertex; F = the lower stroke
    at parameter f_t of its first segment (just under the nose); lip = P -> F (one cubic, handles given); contour = the
    lower stroke from F back to P; tongue = a crescent on the lip line (it rides on the lower jaw), 30-85 % along it."""
    sub = _parse(lower_stroke)[0]
    segs, p0 = [], sub['start']
    for c, ps in sub['segs']:
        segs.append((p0, ps[0], ps[1], ps[2]))
        p0 = ps[2]
    best = None
    for si, s in enumerate(segs):
        for k in range(201):
            q_ = _bez(*s, k / 200)
            dd = math.hypot(q_[0] - wedge_vertex[0], q_[1] - wedge_vertex[1])
            if best is None or dd < best[0]:
                best = (dd, si, k / 200)
    _, si_p, t_p = best
    _, first_rest = _split(*segs[0], f_t)
    F = first_rest[0]
    parts = [first_rest] + segs[1:si_p] if si_p > 0 else []
    if si_p == 0:
        (a, _b) = _split(*segs[0], t_p)
        parts = [_split(*a, f_t / t_p)[1]]
        P = a[3]
    else:
        head_, _tail = _split(*segs[si_p], t_p)
        parts.append(head_)
        P = head_[3]
    contour = 'M %.2f %.2f ' % F + ' '.join('C %.2f %.2f %.2f %.2f %.2f %.2f' % (s[1] + s[2] + s[3]) for s in parts)
    lip_pts = (P, lip_c1, lip_c2, F)
    lip = 'M %.2f %.2f C %.2f %.2f %.2f %.2f %.2f %.2f' % (P + lip_c1 + lip_c2 + F)
    # tongue: on the lip line, bulging away from the lower jaw (toward the upper jaw) up to 3.2 px
    lower_mid = _bez(*segs[min(1, len(segs) - 1)], 0.5)
    top, bot = [], []
    for k in range(12):
        u = 0.30 + 0.55 * k / 11
        a_ = _bez(*lip_pts, u)
        b_ = _bez(*lip_pts, min(1.0, u + 0.01))
        tx, ty = _unit((b_[0] - a_[0], b_[1] - a_[1]))
        n = (-ty, tx)
        if (lower_mid[0] - a_[0]) * n[0] + (lower_mid[1] - a_[1]) * n[1] > 0:
            n = (-n[0], -n[1])
        h = 3.2 * math.sin(math.pi * (u - 0.30) / 0.55)
        bot.append(a_)
        top.append((a_[0] + n[0] * h, a_[1] + n[1] * h))
    tongue = _smooth(bot + top[::-1][1:-1] + [bot[0]]) + ' Z'
    return {'pivot': P, 'lip': lip, 'contour': contour, 'tongue': tongue, 'deg': deg}


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
        'jaw': {'pivot': pt(*src['jaw']['pivot'], f), 'lip': mp(src['jaw']['lip'], f), 'contour': mp(src['jaw']['contour'], f),
                'tongue': mp(src['jaw']['tongue'], f), 'deg': src['jaw']['deg']} if 'jaw' in src else None,
    }


# jaws (source px): P = the commissure, where the shocked wedge's vertex sits on the lower stroke; F = the lower stroke's
# start, just under the nose (so no piece of the old lower stroke is left above the opening); the mouth line bows toward the upper jaw, about parallel to the muzzle's lower contour, which leaves a
# lower-jaw lens 8-9 px deep at mid-muzzle (a jaw, not a lip line, drops). Front down = clockwise for the right-facing
# profile, counter-clockwise for the left-facing one.
PROFILE_L['jaw'] = _jaw(PROFILE_L['skull_strokes'][1], (112, 119), 0.0, (96, 113.5), (70, 106.5), -JAW_MAX_DEG)
PROFILE_R['jaw'] = _jaw(PROFILE_R['skull_strokes'][1], (516, 115), 0.0, (532, 109.5), (558, 102.5), JAW_MAX_DEG)
heads['profileLeftScreen'] = build_profile(PROFILE_L, C, 'profileLeftScreen')
heads['profileRightScreen'] = build_profile(PROFILE_R, CRF, 'profileRightScreen')


def _profile_r_back():
    """Round 5 (R4 review minor, seal check: 18 px at the pale ear's root at rest, 26-49 px with the ear folded back, 11-19 px
    in every right walk phase): between the pale ear's lower edge and the point where the right rig's neck back line leaves
    the skull, the right profile's skull fill showed its unstroked back edge, and a folded ear (worried, judge, earsBack)
    uncovered more of it up the back of the skull. As the left profile does since round 4 (PROFILE_L back stroke into
    NAPE_L_J), the head now strokes its own back contour: from where the crown stroke starts under the ear, back over the
    occiput and down the skull fill's edge to its crossing with the right rig's neck back line, then TURN_JOIN units down
    that line (head-local; the right profile mounts on its own rig with no offset), so ear, skull and nape read as one
    outline at any ear fold."""
    g = heads['profileRightScreen']
    r = _rig('rigRight.ts')
    hm = r['neck']['headMount']
    back = _dense(map_path(r['neck']['strokes'][0], lambda x, y: (x - hm['x'], y - hm['y'])), 80)
    edge_src = 'M 470 35.4 C 461 35.9 451.2 41.3 443 52 C 437 62 439 76 447 84'
    _a = _split((500, 35), (474, 35), (452, 40), (443, 52), 0.0)
    # the crown segment from x 470 back to (443, 52), exactly on the fill's edge (de Casteljau, as _crown_under_ear)
    seg = ((500, 35), (474, 35), (452, 40), (443, 52))
    lo, hi = 0.0, 1.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if _bez(*seg, mid)[0] > 470:
            lo = mid
        else:
            hi = mid
    _, tail = _split(*seg, (lo + hi) / 2)
    edge_src = ('M %.2f %.2f C %.2f %.2f %.2f %.2f %.2f %.2f ' % (tail[0] + tail[1] + tail[2] + tail[3])
                + 'C 437 62 439 76 447 84 C 455 96 465 108 481 116')
    edge = _dense(mp(edge_src, CRF), 60)
    # first crossing with the neck's back line, then TURN_JOIN units further along the skull edge
    acc = _arclen(edge)
    hit = None
    for i in range(len(edge) - 1):
        for k in range(len(back) - 1):
            if _seg_x(edge[i], edge[i + 1], back[k], back[k + 1]):
                hit = i
                break
        if hit is not None:
            break
    if hit is None:
        raise SystemExit('profileRightScreen: back contour never meets the neck back line')
    # the crossing itself, then TURN_JOIN units down the NECK's back line (drawn over it: the skull edge turns forward into
    # the neck past the crossing and would leave an interior tick), joined with a plain corner (the nape notch)
    X = edge[hit]
    kb = min(range(len(back)), key=lambda k: math.hypot(back[k][0] - X[0], back[k][1] - X[1]))
    acb = _arclen(back)
    tail = [p for k, p in enumerate(back) if k > kb and acb[k] - acb[kb] <= TURN_JOIN]
    head_part = _cr_path(_resample(edge[:hit + 1], 2.0))
    g['skull']['strokes'].append(head_part + ''.join(' L %.2f %.2f' % p for p in tail))
    return X


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


def build_up(view, src, base, sign, rig_name, lip_cut, back_path, inner_band=None, cheek=None, lip_lead_segs=0):
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
    # round 3: the back contour starts exactly at back_path's first point (where the crown stroke, now extended under the
    # ear along the same edge, passes), not 1/60 of a segment in, so the two strokes coincide and leave no step
    _bp = mp(back_path, fp)
    bk = [tuple(float(v) for v in _bp[2:].split(' C ')[0].split()[:2])] + _samples(_bp, 60)
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
        c1, c2 = _throat_ctrl(J, tJ, L1, tL)
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
        c1, c2 = _throat_ctrl(J, tJ, L1, tL)
        best = (L1, c1, c2, 0)
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
    # Round-2 repair (BADGER-D39), badger_pose_looking_up.png: the mouth is a lip line INSIDE the muzzle, parallel to its
    # lower contour, from just under the nose back over about 60% of the muzzle (the lower contour itself is the underside
    # of the jaw in a raised head); no commissure hook at the jaw/throat junction; the cheek mark is a short diagonal curve
    # below the ear that follows the jaw (the profile's cheek line, pitched, read as a smile on the throat).
    cont = _samples(mp(lip_cut, fp), 40)
    acc = [0.0]
    for a_, b_ in zip(cont, cont[1:]):
        acc.append(acc[-1] + math.hypot(b_[0] - a_[0], b_[1] - a_[1]))
    eye_c = (g['eyes'][0]['c']['x'], g['eyes'][0]['c']['y'])
    def lip_pts(t0, t1, offs):
        out = []
        for i, p_ in enumerate(cont):
            u = acc[i] / acc[-1]
            if u < t0 or u > t1:
                continue
            a_, b_ = cont[max(0, i - 1)], cont[min(len(cont) - 1, i + 1)]
            t_ = _unit((b_[0] - a_[0], b_[1] - a_[1]))
            n_ = (-t_[1], t_[0])
            if (eye_c[0] - p_[0]) * n_[0] + (eye_c[1] - p_[1]) * n_[1] < 0:
                n_ = (-n_[0], -n_[1])
            out.append((p_[0] + n_[0] * offs, p_[1] + n_[1] * offs))
        return out
    # round 3 (R2 review minor): 4.5 units inside the pitched jaw contour the lip line merged with it into one thick muzzle
    # outline at the proof scale; badger_pose_looking_up.png draws it clearly apart, starting a little behind the nose.
    # Now 8.5 units inside the contour, from 6 units behind the nose tip, at detail weight (LINE.detailWidth).
    # round 4: lip_lead_segs leading segments of lip_cut run up under the nose (PL_JAW_START); the lip line still starts
    # 6 units behind where the jaw line leaves the nose
    LIP_IN, LIP_START = 8.5, (6.0 + acc[40 * lip_lead_segs]) / acc[-1]
    lip_line = _smooth(lip_pts(LIP_START, 0.62, LIP_IN))
    ends = lip_pts(0.55, 0.62, LIP_IN)
    e0, e1 = ends[0], ends[-1]
    te = _unit((e1[0] - e0[0], e1[1] - e0[1]))
    toward_eye = _unit((eye_c[0] - e1[0], eye_c[1] - e1[1]))
    def curl(k_up):
        tip = (e1[0] + te[0] * 3.0 + toward_eye[0] * k_up, e1[1] + te[1] * 3.0 + toward_eye[1] * k_up)
        return 'M %.1f %.1f C %.1f %.1f %.1f %.1f %.1f %.1f' % (e1[0], e1[1], e1[0] + te[0] * 2.2, e1[1] + te[1] * 2.2,
                                                                tip[0] - toward_eye[0] * k_up * 0.4, tip[1] - toward_eye[1] * k_up * 0.4,
                                                                tip[0], tip[1])
    g['mouth']['neutral'] = {'strokes': [], 'details': [lip_line], 'fills': []}
    g['mouth']['happy'] = {'strokes': [], 'details': [lip_line, curl(3.2)], 'fills': []}
    g['mouth']['worried'] = {'strokes': [], 'details': [lip_line, curl(-2.6)], 'fills': []}
    if cheek:
        ex, ey = eye_c
        g['skull']['details'] = [map_path(cheek, lambda x, y: (x + ex, y + ey))]
    # round 4: nape fillet + one concave throat on a dedicated look-up neck (see _neck_up)
    rig = _rig(rig_name)
    hm = rig['neck']['headMount']
    dx, dy = UP_MOUNT[view]
    head_back, head_throat, neck_up = _neck_up(g, view, rig, hm['x'] + dx, hm['y'] + dy, bk, nb, J, tJ, throat_line,
                                               'left' if base is C else 'right')
    g['skull']['strokes'] = [g['skull']['strokes'][0], g['skull']['strokes'][1], head_back, head_throat]
    g['throat'] = None
    g['neckUp'] = neck_up
    return g


def _poly_inside(p, poly):
    x, y = p
    c = False
    for i in range(len(poly)):
        a, b = poly[i], poly[i - 1]
        if (a[1] > y) != (b[1] > y) and x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]:
            c = not c
    return c


def _poly_dist(p, poly):
    best = 1e9
    for i in range(len(poly)):
        a, b = poly[i], poly[i - 1]
        vx, vy = b[0] - a[0], b[1] - a[1]
        L2 = vx * vx + vy * vy
        t = max(0.0, min(1.0, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2)) if L2 else 0.0
        best = min(best, math.hypot(p[0] - a[0] - vx * t, p[1] - a[1] - vy * t))
    return best


NAPE_EAR_COVER = 3.5   # the look-up nape leaves the skull this far inside the hanging ear's fill (its join stays hidden)
NAPE_HANDLE = (0.40, 0.30)   # nape cubic handles, as fractions of its chord (ear end, collar end)


def _neck_up(g, view, rig, ox, oy, bk, nb, J, tJ, throat_line, rig_side):
    """Round-4 repair (R3 review minor, look-up heads): ONE nape line from under the ear to the collar and ONE concave
    throat from the jaw angle to the collar, carried by a dedicated look-up neck for the head's own rig.

    * Nape: the skull's back contour used to end in a round-capped stub that jutted past the neck's back line (a 'Z' step
      behind the ear). Below the hanging ear the pitched skull's back contour runs FORWARD (toward the throat) while the
      neck's back line runs back to the shoulders, so any join of the two near their crossing is an S: the occiput bulges
      out under the ear and the neck dents in under it (a fillet there, tried first, still read as a knob). The look-up
      panel draws neither: one smooth, nearly straight nape from under the ear down to the collar. So the nape is now ONE
      cubic from A, the last point of the skull's back contour that is still NAPE_EAR_COVER units inside the hanging ear's
      fill (its join with the contour is hidden by the ear, drawn later), leaving along the contour's own tangent, to Q,
      where the neck's back line goes under the collar, arriving along that line. It lies behind the skull's lower back
      contour, and the look-up neck's fill fills the wedge between them.
    * Throat: the head's bridge kinked at the jaw and bowed convex toward the collar (the side rigs' neck front sits
      forward of the raised jaw). badger_pose_looking_up.png draws one concave line from the jaw angle to the collar, so the
      look-up neck carries that line: one cubic from the jaw angle J (the end of the jaw underside) to the point where the
      rig's throat line enters the collar, bowing toward the nape. The neck fill's front edge IS that curve (the old neck
      fill no longer sticks out in front of it).
    The head draws the top of each line, where it runs along / under the skull fill's edge, on top of the skull (so the
    line keeps its full weight there); the neck draws each whole line under the collar.
    Returned geometry is NECK-local (the neck part's space): neck = head + (ox, oy)."""
    q = lambda p: '%.2f %.2f' % p
    collar = [p for poly in [_samples(map_path(rig['neck']['collar'], lambda x, y: (x - ox, y - oy)), 12)] for p in poly]
    skull = [p for poly in [_samples(g['skull']['fill'], 12)] for p in poly]
    # --- nape (head-local): A under the ear -> Q under the collar's top edge
    ear = _samples(g['earsFront'][0]['fills'][0]['d'], 12)
    under = [i for i, p in enumerate(bk) if _poly_inside(p, ear) and _poly_dist(p, ear) >= NAPE_EAR_COVER]
    iA = under[-1]
    A = bk[iA]
    tA = _unit((bk[min(iA + 1, len(bk) - 1)][0] - bk[iA - 1][0], bk[min(iA + 1, len(bk) - 1)][1] - bk[iA - 1][1]))
    iQ = next(k for k, p in enumerate(nb) if _poly_inside(p, collar))
    Q = nb[iQ]
    tQ = _unit((nb[min(iQ + 1, len(nb) - 1)][0] - nb[iQ - 1][0], nb[min(iQ + 1, len(nb) - 1)][1] - nb[iQ - 1][1]))
    dn = math.hypot(Q[0] - A[0], Q[1] - A[1])
    f1 = (A[0] + tA[0] * dn * NAPE_HANDLE[0], A[1] + tA[1] * dn * NAPE_HANDLE[0])
    f2 = (Q[0] - tQ[0] * dn * NAPE_HANDLE[1], Q[1] - tQ[1] * dn * NAPE_HANDLE[1])
    nape = [_bez(A, f1, f2, Q, k / 80) for k in range(81)]
    # the nape must stay outside the skull fill (no coat poking out behind it); report the worst incursion
    inc = max((_poly_dist(p, skull) for p in nape[8:] if _poly_inside(p, skull)), default=0.0)
    if inc > 0.6:
        raise SystemExit('%s: look-up nape runs %.2f units inside the skull fill' % (view, inc))
    kN = next((k for k, p in enumerate(nape) if not _poly_inside(p, skull) and _poly_dist(p, skull) > 3.0
               and not _poly_inside(p, ear)), 30)
    (n0, n1, n2, n3), _ = _split(A, f1, f2, Q, kN / 80)
    head_back = _smooth(bk[:iA + 1]) + ' C %s %s %s' % (q(n1), q(n2), q(n3))
    # --- throat (head-local): J -> C, C where the rig's throat line enters the collar
    tp = _samples(throat_line, 80)
    iC = next(i for i, p in enumerate(tp) if _poly_inside(p, collar))
    Cp = tp[iC]
    tC = _unit((tp[min(iC + 2, len(tp) - 1)][0] - tp[max(iC - 2, 0)][0], tp[min(iC + 2, len(tp) - 1)][1] - tp[max(iC - 2, 0)][1]))
    Cx = (Cp[0] + tC[0] * 2.5, Cp[1] + tC[1] * 2.5)     # end 2.5 units under the collar
    ch = _unit((Cp[0] - J[0], Cp[1] - J[1]))
    d = math.hypot(Cp[0] - J[0], Cp[1] - J[1])
    u0 = _unit((tJ[0] * 0.55 + ch[0] * 0.45, tJ[1] * 0.55 + ch[1] * 0.45))
    t1 = (J[0] + u0[0] * d * 0.36, J[1] + u0[1] * d * 0.36)
    t2 = (Cp[0] - tC[0] * d * 0.36, Cp[1] - tC[1] * d * 0.36)
    thr = [_bez(J, t1, t2, Cp, k / 80) for k in range(81)]
    # the head draws the top of the throat, where it runs along / under the skull fill's edge, up to 3 units past it
    kP = next((k for k, p in enumerate(thr) if not _poly_inside(p, skull) and _poly_dist(p, skull) > 3.0), 20)
    (a0, a1, a2, a3), _ = _split(J, t1, t2, Cp, kP / 80)
    head_throat = 'M %s C %s %s %s' % (q(a0), q(a1), q(a2), q(a3))
    # --- neck-local outputs
    N = lambda p: (p[0] + ox, p[1] + oy)
    back_rest = nb[iQ + 1:]
    neck_back = 'M %s C %s %s %s' % (q(N(A)), q(N(f1)), q(N(f2)), q(N(Q)))
    if len(back_rest) > 1:
        neck_back += ' ' + _smooth([N(Q)] + [N(p) for p in back_rest])[len('M %.1f %.1f' % N(Q)):]
    neck_throat = 'M %s C %s %s %s L %s' % (q(N(J)), q(N(t1)), q(N(t2)), q(N(Cp)), q(N(Cx)))
    # fill: the nape, down the neck's back line under the collar, round the original fill's bottom (under torso and
    # collar), up to the collar point, the new throat back up to the jaw, and across the head (inside the skull) to A
    of = [p for poly in [_samples(rig['neck']['fill'], 12)] for p in poly]
    nb_end = N(nb[-1])
    iB = min(range(len(of)), key=lambda i: math.hypot(of[i][0] - nb_end[0], of[i][1] - nb_end[1]))
    iF = min(range(len(of)), key=lambda i: math.hypot(of[i][0] - N(Cx)[0], of[i][1] - N(Cx)[1]))
    bottom = of[iB:iF + 1] if iB <= iF else of[iB:] + of[:iF + 1]
    pts = [N(p) for p in back_rest] + bottom + [N(Cx), N(Cp)]
    fill = ('M %s C %s %s %s L ' % (q(N(A)), q(N(f1)), q(N(f2)), q(N(Q))) + ' L '.join(q(p) for p in pts)
            + ' C %s %s %s L %s Z' % (q(N(t2)), q(N(t1)), q(N(J)), q(N(A))))
    # --- 'over': the same neck ABOVE the collar's centre line, which SideBody draws again after the torso (and before the
    # collar). The look-up mounts turn the neck 12-20 deg about its base, which carries the collar's nape end down the back
    # and leaves the start of the torso's back stroke (the withers, under the collar at rest) as a short stray tick inside
    # the neck above the collar (left look-up, every frame). Everything of the torso inside the neck's silhouette above the
    # collar belongs behind the neck, so the neck's upper part is simply drawn in front of it. Its bottom edge runs along
    # the collar band's centre line (hidden by the collar), and its strokes stop 2.5 units under the collar's edge.
    band = _samples(map_path(rig['neck']['collar'], lambda x, y: (x - ox, y - oy)), 24)
    n = len(band)
    ia, ib = max(((i, k) for i in range(0, n, 2) for k in range(i + 1, n, 2)),
                 key=lambda ik: math.hypot(band[ik[0]][0] - band[ik[1]][0], band[ik[0]][1] - band[ik[1]][1]))
    side1 = band[ia:ib + 1]
    side2 = (band[ib:] + band[:ia + 1])[::-1]

    def resample(poly, m):
        acc = [0.0]
        for a, b in zip(poly, poly[1:]):
            acc.append(acc[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
        out, j = [], 0
        for k in range(m + 1):
            s = acc[-1] * k / m
            while j < len(acc) - 2 and acc[j + 1] < s:
                j += 1
            seg = (acc[j + 1] - acc[j]) or 1
            u = (s - acc[j]) / seg
            out.append((poly[j][0] + (poly[j + 1][0] - poly[j][0]) * u, poly[j][1] + (poly[j + 1][1] - poly[j][1]) * u))
        return out
    s1, s2 = resample(side1, 60), resample(side2, 60)
    mid = [((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) for a, b in zip(s1, s2)]
    Qx = (Q[0] + tQ[0] * 2.5, Q[1] + tQ[1] * 2.5)
    mq = min(range(len(mid)), key=lambda k: math.hypot(mid[k][0] - Q[0], mid[k][1] - Q[1]))
    mc = min(range(len(mid)), key=lambda k: math.hypot(mid[k][0] - Cp[0], mid[k][1] - Cp[1]))
    run = mid[mq:mc + 1] if mq <= mc else mid[mc:mq + 1][::-1]
    for p in [Qx, Cx] + run:
        if not _poly_inside(p, band):
            raise SystemExit('%s: look-up neck over-layer edge leaves the collar band at %.1f %.1f' % (view, p[0], p[1]))
    over_fill = ('M %s C %s %s %s L %s L ' % (q(N(A)), q(N(f1)), q(N(f2)), q(N(Q)), q(N(Qx)))
                 + ' L '.join(q(N(p)) for p in run) + ' L %s L %s' % (q(N(Cx)), q(N(Cp)))
                 + ' C %s %s %s L %s Z' % (q(N(t2)), q(N(t1)), q(N(J)), q(N(A))))
    over_back = 'M %s C %s %s %s L %s' % (q(N(A)), q(N(f1)), q(N(f2)), q(N(Q)), q(N(Qx)))
    return head_back, head_throat, {'rig': rig_side, 'fill': fill, 'strokes': [neck_back, neck_throat],
                                    'over': {'fill': over_fill, 'strokes': [over_back, neck_throat]}}


def _throat_ctrl(J, tJ, L1, tL):
    """Round-2 repair (BADGER-D39): the throat leaves the jaw along the chord to its landing point (a soft jaw angle) and
    arrives along the neck's throat line, so it is one smooth concave curve; following the jaw's own tangent made it an S
    with a bump whenever the jaw end sat straight above the landing."""
    d = math.hypot(L1[0] - J[0], L1[1] - J[1])
    ch = _unit((L1[0] - J[0], L1[1] - J[1]))
    u = _unit((ch[0] * 0.8 + tJ[0] * 0.2, ch[1] * 0.8 + tJ[1] * 0.2))
    k0 = d * 0.36
    return (J[0] + u[0] * k0, J[1] + u[1] * k0), (L1[0] - tL[0] * k0, L1[1] - tL[1] * k0)


# the look-up head keeps the v1 skull back (its own nape construction, back_path below)
PROFILE_L_UP = dict(PROFILE_L, skull_fill=('M 50 76 C 64 71 79 66 86 60 C 90 55 94 49 101 45 C 112 40 127 37 142 37 '
                                           'C 165 37 185 43 192 57 C 196 65 194 76 186 84 C 178 96 168 108 152 116 '
                                           'C 140 120 132 122 126 122 C 118 119 108 118 96 118 '
                                           'C 86.9 118 76.6 117.4 67 115 C 57 112 50 107 46 99 C 45.3 97.6 45.1 92.5 44.5 90 C 46 85 47 79 50 76 Z'))
heads['upLeftScreen'] = build_up(
    'upLeftScreen', PROFILE_L_UP, C, 1, 'rigLeft.ts',
    lip_cut=PL_JAW_START + 'C 50 107 57 112 67 115 C 83 119 101 118 113 119 C 115 119.3 117 119.6 118.5 120',
    back_path='M 142 37 C 165 37 185 43 192 57 C 196 65 194 76 186 84 C 182 89 177 95 171 101',
    inner_band='M 139 39 C 140 44 141 50 141 56 C 143 68 147 80 152 86 C 153 80 151 70 149 60 C 147 52 144 45 139 39 Z',
    cheek='M 30 42.6 C 26 48.1 20 51.8 13 53.2', lip_lead_segs=1)
heads['upRightScreen'] = build_up(
    'upRightScreen', PROFILE_R, CRF, -1, 'rigRight.ts',
    lip_cut='M 588 95 C 585 102 578 107 568 110 C 552 113 532 113 520 114 C 518 114.2 516 114.6 514.5 115',
    back_path='M 500 35 C 474 35 452 40 443 52 C 437 62 439 76 447 84 C 451 90 456 96 462 102',
    # the hanging pale ear shows its pink inner over the front half of the flap (badger_pose_looking_up.png)
    inner_band='M 496 42 C 490 48 485 56 481 64 C 478 71 475 78 471 83 C 466 77 464 69 466 61 C 468 52 474 45 482 40 C 488 37 493 38 496 42 Z',
    cheek='M -30 42.6 C -26 48.1 -20 51.8 -13 53.2')
# =============================================================================== HEAD SCALE (decision BADGER-D55, round 5)
# D55 (recorded in round 4) found the heads' sizes inconsistent with the turnaround, which controls head size relative to the
# body (identity and anatomy; the size panel only sets the overall scale, D01). Round 5 re-measured every view against its
# turnaround panel at the turnaround's own scale (the views' trace scale S = 312.6 / 329 units per crop px, heads placed as
# the rigs place them), with a similarity fit of the head ink (uniform scale about the face centroid + shift, symmetric
# chamfer cost, ears included, the collar excluded) and with landmarks:
#  * front head vs badger_turn_front.png: best scale 0.900-0.925 by the fit (cost 2.58 -> 1.14); eye spacing 57.2 units vs
#    49.4-51.3 (iris centres), crown-to-lower-lip 115.8 vs 101.7, skull width at the cheeks 101 vs 92 (0.87-0.91): the
#    whole head was about 11% big, in height as much as in width, so it is scaled UNIFORMLY, not in width only;
#  * 3/4 heads vs badger_turn_34.png: best scale 0.970-0.975 (cost nearly flat to 1.0): eye-to-nose 63.3 vs 62.5 units,
#    crown above the eye line 45 vs 41.8;
#  * profiles vs badger_turn_side.png (eye-aligned): best scale 1.030-1.035 with the cost flat within 0.5% of 1.0; the
#    top and underside contours sit within 1-3 units of the panel's from 20 units behind the eye to the nose, eye-to-nose
#    66.0 vs 67.1 units, the neck's back line within 1-2 units. The 181-vs-162 px ear-back-to-nose gap D55 measured comes
#    from the EAR: turn_side hangs the flap 17-24 units further back from the eye than coat_right (which the profiles were
#    traced on). A uniform x1.10 would make the face 10% too big while closing only half of that, so the profiles keep
#    their size (the look-up heads follow them) and the ear placement is left as a recorded shape difference.
# So the front head is scaled by HEAD_SCALE_FRONT and the 3/4 heads by HEAD_SCALE_34 (each near its own panel; the 3/4
# heads stay 5% larger than the front head, as the turnaround draws its 3/4 head larger than its front head, rather than 7%
# smaller than turn_34), about the head-local origin (the head pivot: on a side rig the jaw/neck junction stays put and
# the crown comes down). The brow offsets of the expressions are scaled with them (HeadViewGeom.scale) and the bust neck
# (FRONT_NECK_GEOM) with the front head, so every expression keeps its proportions; the turned mounts below are fitted to
# the scaled heads.
HEAD_SCALE_FRONT = 0.90
HEAD_SCALE_34 = 0.95


def _scale_pt(p, k):
    return {'x': round(p['x'] * k, 2), 'y': round(p['y'] * k, 2)}


def scale_head(view, k):
    """Uniform scale of one generated head view about its origin (paths, points, eye and brow sizes, markings)."""
    g = heads[view]
    S_ = lambda d: map_path(d, lambda x, y: (x * k, y * k)) if d else d
    g['skull'] = {'fill': S_(g['skull']['fill']), 'strokes': [S_(d) for d in g['skull']['strokes']],
                  'details': [S_(d) for d in g['skull']['details']]}
    g['shadows'] = [{**x, 'd': S_(x['d'])} for x in g['shadows']]
    g['markings'] = [{**x, 'd': S_(x['d'])} for x in g['markings']]
    g['nose'] = {**g['nose'], 'd': S_(g['nose']['d']), **({'details': [S_(d) for d in g['nose']['details']]} if g['nose'].get('details') else {})}
    for key in ('philtrum', 'chin', 'bridge'):
        if g.get(key):
            g[key] = S_(g[key])
    for e in g['eyes']:
        e['c'] = _scale_pt(e['c'], k)
        for key in ('w', 'up', 'low', 'drop', 'irisR', 'irisDX', 'irisDY'):
            e[key] = round(e[key] * k, 2)
    for b in g['brows']:
        for key in ('outer', 'mid', 'inner'):
            b[key] = _scale_pt(b[key], k)
    for m in g['mouth'].values():
        m['strokes'] = [S_(d) for d in m['strokes']]
        m['details'] = [S_(d) for d in m['details']]
        m['fills'] = [{**x, 'd': S_(x['d'])} for x in m['fills']]
        if 'sideStrokes' in m:
            m['sideStrokes'] = [S_(d) for d in m['sideStrokes']]
    for e in g['earsBehind'] + g['earsFront']:
        e['pivot'] = _scale_pt(e['pivot'], k)
        e['fills'] = [{**x, 'd': S_(x['d'])} for x in e['fills']]
        e['strokes'] = [S_(d) for d in e['strokes']]
        e['details'] = [S_(d) for d in e['details']]
    if g.get('throat'):
        g['throat'] = {'fill': S_(g['throat']['fill']), 'stroke': S_(g['throat']['stroke'])}
    for mid in markings:
        if view in markings[mid]:
            markings[mid][view] = S_(markings[mid][view])
    g['scale'] = k


scale_head('front', HEAD_SCALE_FRONT)
scale_head('threeQuarterRightScreen', HEAD_SCALE_34)
scale_head('threeQuarterLeftScreen', HEAD_SCALE_34)


# =============================================================================== TURNED 3/4 MOUNTS (round 5)
# R4 final review (major, filed under integration): with the 3/4-right head on the LEFT rig (the head looks back over the
# shoulder; Preview10s f97-f189) the near jaw had no outline from the end of the near cheek stroke (TQ_NEAR_CHEEK) to the
# start of the neck's front line: the skull fill's jaw edge met the background (seal check 322 px at 3.2 px/u, about 30
# units of contour; 31-33 px on every proof frame of that beat at 0.88 px/u). A second leak (61 px) sat at the far dark
# ear's root, where the hand-written D37 nape fill stopped short of the ear. The 3/4-left head on the RIGHT rig, the same
# construction turned the other way, leaked in the same two places (389 px).
# badger_turn_34.png runs the near contour of a 3/4 head as ONE line from under the ear down the cheek into the neck. On a
# turned mount the neck's front line is where that contour must arrive, so each turned mount now carries, generated here
# from the head and its own rig's neck (after any head rescale, so the joins follow the head):
#  * jaw (HEAD-local; Head.tsx draws it only when the head is mounted on that rig): ONE cubic that leaves the near cheek
#    stroke's end along its own tangent and lands on the rig's throat line TURN_JOIN units below the point where that line
#    leaves the skull fill, along the throat's tangent, then follows the throat TURN_JAW_OVERLAP units further (the head
#    draws it over the neck's own line, so a head tilt of a few degrees never opens the join; the cubic is checked to stay
#    outside the skull and neck fills). A coat fill drawn first in the head covers the gap between this line and the
#    fills: the line, then back inside the coat (up the throat 2 units into the neck, then the skull's jaw edge 2 units in);
#  * nape (NECK-local; replaces the hand-written D37 napes of Badger.tsx): the crest line from under the far ear (where it
#    is TURN_EAR_COVER inside the ear's fill) to the end of the neck's back line under the collar, arriving along that
#    line, and a coat fill bounded by the crest, the old back line (covered, TURN_BACK_COVER past it) and, hidden under
#    the head, the skull's far contour and the far ear (TURN_HIDE inside them), so the neck reaches up into the ear's root.
# KEEP IN SYNC with Badger.tsx LEFT_HEAD_MOUNT.threeQuarterRightScreen and RIGHT_HEAD_MOUNT.threeQuarterLeftScreen (dx, dy).
TURNED_MOUNTS = {'threeQuarterRightScreen': ('left', 'rigLeft.ts', -8.0, 16.0),
                 'threeQuarterLeftScreen': ('right', 'rigRight.ts', 8.0, 16.0)}
TURN_JOIN = 4.0
TURN_EDGE_OUT = 0.4
TURN_JAW_HANDLE = 0.38
TURN_JAW_OVERLAP = 7.0
TURN_EAR_COVER = 4.0
TURN_BACK_COVER = 2.8
TURN_HIDE = 4.0
TURN_EAR_HIDE = 8.0


def _dense(d, n=40):
    sub = _parse(d)[0]
    pts, p0 = [sub['start']], sub['start']
    for c, ps in sub['segs']:
        for k in range(1, n + 1):
            t = k / n
            pts.append(_bez(p0, ps[0], ps[1], ps[2], t) if c == 'C' else (p0[0] + (ps[0][0] - p0[0]) * t, p0[1] + (ps[0][1] - p0[1]) * t))
        p0 = ps[-1]
    return pts


def _arclen(pts):
    acc = [0.0]
    for a, b in zip(pts, pts[1:]):
        acc.append(acc[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    return acc


def _resample(pts, step):
    """Polyline -> points every `step` units of arc length (first and last kept)."""
    acc = _arclen(pts)
    out, j = [], 0
    n = max(1, int(round(acc[-1] / step)))
    for k in range(n + 1):
        s = acc[-1] * k / n
        while j < len(acc) - 2 and acc[j + 1] < s:
            j += 1
        seg = (acc[j + 1] - acc[j]) or 1.0
        u = (s - acc[j]) / seg
        out.append((pts[j][0] + (pts[j + 1][0] - pts[j][0]) * u, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * u))
    return out


def _normals(pts):
    out = []
    for i in range(len(pts)):
        a, b = pts[max(0, i - 1)], pts[min(len(pts) - 1, i + 1)]
        t = _unit((b[0] - a[0], b[1] - a[1]))
        out.append((-t[1], t[0]))
    return out


def _cr_path(P, t0=None):
    """Smooth cubic path through every point of P (Catmull-Rom); optional unit tangent t0 at the first point."""
    out = ['M %.2f %.2f' % P[0]]
    for i in range(len(P) - 1):
        p0 = P[i - 1] if i else P[i]
        p1, p2 = P[i], P[i + 1]
        p3 = P[i + 2] if i + 2 < len(P) else p2
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        if i == 0 and t0 is not None:
            L = math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 3
            c1 = (p1[0] + t0[0] * L, p1[1] + t0[1] * L)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        out.append('C %.2f %.2f %.2f %.2f %.2f %.2f' % (c1 + c2 + p2))
    return ' '.join(out)


def _turned_jaw(g, view, throat_hl, neck_fill_hl):
    """Head-local jaw line + coat fill for a turned 3/4 mount (see TURNED 3/4 MOUNTS)."""
    skull = _samples(g['skull']['fill'], 24)
    neck = _samples(neck_fill_hl, 24)
    cheek = _dense(g['skull']['strokes'][1], 40)
    E = cheek[-1]
    tE = _unit((cheek[-1][0] - cheek[-4][0], cheek[-1][1] - cheek[-4][1]))
    tp = _dense(throat_hl, 80)
    acc = _arclen(tp)
    # where the throat line leaves the skull fill (its visible part starts there)
    iX = next(i for i, p in enumerate(tp) if not _poly_inside(p, skull) and _poly_dist(p, skull) > 0.3)
    X = tp[iX]
    iJ = next(i for i in range(iX, len(tp)) if acc[i] - acc[iX] >= TURN_JOIN)
    J = tp[iJ]
    tJ = _unit((tp[iJ + 2][0] - tp[iJ - 2][0], tp[iJ + 2][1] - tp[iJ - 2][1]))
    # ONE cubic from the cheek's end (its own tangent) onto the throat line (the throat's tangent), then the throat itself
    dJ = math.hypot(J[0] - E[0], J[1] - E[1])
    c1 = (E[0] + tE[0] * dJ * TURN_JAW_HANDLE, E[1] + tE[1] * dJ * TURN_JAW_HANDLE)
    c2 = (J[0] - tJ[0] * dJ * TURN_JAW_HANDLE, J[1] - tJ[1] * dJ * TURN_JAW_HANDLE)
    iK = next((i for i in range(iJ, len(tp)) if acc[i] - acc[iJ] >= TURN_JAW_OVERLAP), len(tp) - 1)
    run = _resample(tp[iJ:iK + 1], 2.5)
    stroke = 'M %.2f %.2f C %.2f %.2f %.2f %.2f %.2f %.2f ' % (E + c1 + c2 + J) + _cr_path(run, tJ)[len('M %.2f %.2f' % run[0]):]
    line = [_bez(E, c1, c2, J, k / 60) for k in range(61)] + run[1:]
    # the line must stay outside the coat (skull and neck fills): an edge outside it would be a leak
    # (on its last stretch the cubic runs onto the throat stroke itself; the right rig's neck fill bulges up to 1.9 units
    # past its own throat stroke near the top, which the stroke's width covers)
    worst = max([_poly_dist(p, skull) for p in line[4:] if _poly_inside(p, skull)] +
                [_poly_dist(p, neck) for p in line[:50] if _poly_inside(p, neck)] + [0.0])
    if worst > 1.4:
        raise SystemExit('%s: turned jaw line runs %.2f units inside the coat' % (view, worst))
    # fill: the line, then back INSIDE the coat: down into the neck at its end, up the throat 2 units in, then the skull's
    # jaw edge 2 units in from the throat's exit back to the cheek's end; it covers every gap between line and coat
    def inset(pts, poly, d):
        out = []
        for p, n in zip(pts, _normals(pts)):
            q = (p[0] + n[0] * d, p[1] + n[1] * d)
            out.append(q if _poly_inside(q, poly) else (p[0] - n[0] * d, p[1] - n[1] * d))
        return out
    back_throat = inset(_resample(tp[iX:iK + 1], 2.0), neck, 2.0)[::-1]
    i_e = min(range(len(skull)), key=lambda i: math.hypot(skull[i][0] - E[0], skull[i][1] - E[1]))
    i_x = min(range(len(skull)), key=lambda i: math.hypot(skull[i][0] - X[0], skull[i][1] - X[1]))
    n_ = len(skull)
    fwd = [(i_x + k) % n_ for k in range((i_e - i_x) % n_ + 1)]
    bwd = [(i_x - k) % n_ for k in range((i_x - i_e) % n_ + 1)]
    jaw_idx = fwd if len(fwd) <= len(bwd) else bwd
    jaw_edge = inset([skull[i] for i in jaw_idx], skull, 2.0)
    pts = line + back_throat + jaw_edge
    fill = 'M ' + ' L '.join('%.2f %.2f' % p for p in pts) + ' Z'
    return {'stroke': stroke, 'fill': fill, 'exit': X}


def _turned_nape(g, view, ox, oy, back_nl, neck_fill_nl):
    """Neck-local crest line + fill for a turned 3/4 mount (see TURNED 3/4 MOUNTS)."""
    H = lambda p: (p[0] + ox, p[1] + oy)        # head-local -> neck-local
    skull = [H(p) for p in _samples(g['skull']['fill'], 24)]
    ear = [H(p) for p in _samples(g['earsBehind'][0]['fills'][0]['d'], 24)]
    neck_poly = _samples(neck_fill_nl, 24)
    back = _dense(back_nl, 80)
    B = back[-1]
    tB = _unit((back[-1][0] - back[-6][0], back[-1][1] - back[-6][1]))
    side = 1.0 if B[0] > sum(p[0] for p in skull) / len(skull) else -1.0     # +1: the nape is on the +x side
    # S: under the far ear, TURN_EAR_COVER inside its fill, on the ear's lowest part outside the skull
    cand = [p for p in ear if not _poly_inside(p, skull) and _poly_dist(p, skull) > 3.0]
    lowest = max(cand, key=lambda p: p[1])
    S = None
    for k in range(0, 200):
        q = (lowest[0] - side * 0.0, lowest[1] - k * 0.25)
        if _poly_inside(q, ear) and _poly_dist(q, ear) >= TURN_EAR_COVER:
            S = q
            break
    if S is None:
        raise SystemExit('%s: no nape start under the far ear' % view)
    d = math.hypot(B[0] - S[0], B[1] - S[1])
    c1 = (S[0] + side * 0.10 * d, S[1] + 0.36 * d)
    c2 = (B[0] - tB[0] * 0.36 * d, B[1] - tB[1] * 0.36 * d)
    crest = [_bez(S, c1, c2, B, k / 80) for k in range(81)]
    # the crest must stay clear of the skull fill below the ear (a line over the face would read as a second contour)
    clear = min((_poly_dist(p, skull) for p in crest if not _poly_inside(p, ear)), default=99.0)
    inc = max((_poly_dist(p, skull) for p in crest if _poly_inside(p, skull) and not _poly_inside(p, ear)), default=0.0)
    if inc > 0.0:
        raise SystemExit('%s: nape crest runs %.2f units inside the skull fill' % (view, inc))
    stroke = 'M %.2f %.2f C %.2f %.2f %.2f %.2f %.2f %.2f' % (S + c1 + c2 + B)
    # fill: crest S -> B, then up the old back line (TURN_BACK_COVER on the neck's side of it), then inside the skull's
    # far contour and the far ear (TURN_HIDE in) back to S
    bn = _normals(back)
    cov = []
    for p, n in zip(back, bn):
        q = (p[0] + n[0] * 2.0, p[1] + n[1] * 2.0)
        s = 1.0 if _poly_inside(q, neck_poly) else -1.0
        cov.append((p[0] + n[0] * TURN_BACK_COVER * s, p[1] + n[1] * TURN_BACK_COVER * s))
    # keep the covered back line only while it is outside the skull (inside, the skull hides it already)
    cov_vis = [p for p in cov if not (_poly_inside(p, skull) and _poly_dist(p, skull) > TURN_HIDE)]
    top = cov_vis[0] if cov_vis else cov[-1]
    # inside the skull: from where the covered line enters it, up the far contour TURN_HIDE in, into the ear
    rim = []
    for y in [top[1] - k * 2.0 for k in range(0, 60)]:
        xs = [a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) for a, b in zip(skull, skull[1:] + skull[:1])
              if (a[1] - y) * (b[1] - y) <= 0 and a[1] != b[1]]
        if not xs:
            break
        xf = max(xs) if side > 0 else min(xs)          # the far contour at this height
        p = (xf - side * TURN_HIDE, y)
        rim.append(p)
        if _poly_inside(p, ear) and _poly_dist(p, ear) >= TURN_EAR_HIDE and y < S[1] - 6.0:
            break
    # back toward S under the ear, TURN_EAR_HIDE in (the ear lifts with a sound clip and folds with earsBack)
    U = None
    for k in range(0, 120):
        q = (S[0] - side * 1.0, S[1] - 4.0 - k * 0.25)
        if _poly_inside(q, ear) and _poly_dist(q, ear) >= TURN_EAR_HIDE:
            U = q
            break
    U = U or (S[0] - side * 1.0, S[1] - 6.0)
    pts = crest + cov_vis[::-1] + rim + [U]
    fill = 'M ' + ' L '.join('%.2f %.2f' % p for p in pts[::2] + [pts[-1]]) + ' Z'
    return {'stroke': stroke, 'fill': fill, 'clear': clear}


def _edge_jaw(g, view, throat_hl, neck_fill_hl, start):
    """Head-local jaw closure for a FRONT head on a side rig (round 5): the skull fill's lower edge from `start` (a point
    the expressions' own jaw lines already cover) down the chin to where the rig's throat line leaves the skull, then down
    the throat TURN_JAW_OVERLAP units; smoothed (Catmull-Rom), TURN_EDGE_OUT outside the edge, plus the same coat fill."""
    skull = _samples(g['skull']['fill'], 24)
    neck = _samples(neck_fill_hl, 24)
    tp = _dense(throat_hl, 80)
    acc = _arclen(tp)
    iX = next(i for i, p in enumerate(tp) if not _poly_inside(p, skull) and _poly_dist(p, skull) > 0.3)
    X = tp[iX]
    n_ = len(skull)
    i_s = min(range(n_), key=lambda i: math.hypot(skull[i][0] - start[0], skull[i][1] - start[1]))
    i_x = min(range(n_), key=lambda i: math.hypot(skull[i][0] - X[0], skull[i][1] - X[1]))
    fwd = [(i_s + k) % n_ for k in range((i_x - i_s) % n_ + 1)]
    bwd = [(i_s - k) % n_ for k in range((i_s - i_x) % n_ + 1)]
    idx = fwd if len(fwd) <= len(bwd) else bwd
    edge = [skull[i] for i in idx]
    # stop the edge where it comes within reach of the throat's exit (the spline rounds into the throat from there)
    edge = [p for p in edge if math.hypot(p[0] - X[0], p[1] - X[1]) > 4.0]
    out = []
    for p, n in zip(edge, _normals(edge)):
        q = (p[0] + n[0] * 2.0, p[1] + n[1] * 2.0)
        sgn = -1.0 if _poly_inside(q, skull) else 1.0
        out.append((p[0] + n[0] * TURN_EDGE_OUT * sgn, p[1] + n[1] * TURN_EDGE_OUT * sgn))
    j1 = next(i for i in range(iX, len(tp)) if acc[i] - acc[iX] >= 2.0)
    iK = next((i for i in range(j1, len(tp)) if acc[i] - acc[iX] >= 2.0 + TURN_JAW_OVERLAP), len(tp) - 1)
    pts = [start] + _resample(out, 3.0)[1:] + _resample(tp[j1:iK + 1], 2.5)
    clean = [pts[0]]
    for p in pts[1:]:
        if math.hypot(p[0] - clean[-1][0], p[1] - clean[-1][1]) > 1.5:
            clean.append(p)
    stroke = _cr_path(clean)
    line = _dense(stroke, 20)
    worst = max([_poly_dist(p, skull) for p in line if _poly_inside(p, skull)] + [0.0])
    if worst > 1.4:
        raise SystemExit('%s: front jaw closure runs %.2f units inside the skull fill' % (view, worst))
    def inset(pts_, poly, d):
        res = []
        for p, n in zip(pts_, _normals(pts_)):
            q = (p[0] + n[0] * d, p[1] + n[1] * d)
            res.append(q if _poly_inside(q, poly) else (p[0] - n[0] * d, p[1] - n[1] * d))
        return res
    back_throat = inset(_resample(tp[iX:iK + 1], 2.0), neck, 2.0)[::-1]
    jaw_edge = inset([skull[i] for i in idx], skull, 2.0)[::-1]
    poly = line + back_throat + jaw_edge
    fill = 'M ' + ' L '.join('%.2f %.2f' % p for p in poly) + ' Z'
    return {'stroke': stroke, 'fill': fill, 'exit': X}


turned_report = {}
for _view, (_rig_side, _rig_file, _dx, _dy) in TURNED_MOUNTS.items():
    _r = _rig(_rig_file)
    _hm = _r['neck']['headMount']
    _ox, _oy = _hm['x'] + _dx, _hm['y'] + _dy
    _to_head = lambda d, ox=_ox, oy=_oy: map_path(d, lambda x, y: (x - ox, y - oy))
    _jaw_g = _turned_jaw(heads[_view], _view, _to_head(_r['neck']['strokes'][1]), _to_head(_r['neck']['fill']))
    _nape_g = _turned_nape(heads[_view], _view, _ox, _oy, _r['neck']['strokes'][0], _r['neck']['fill'])
    heads[_view]['mountJaws'] = [{'rig': _rig_side, 'fill': _jaw_g['fill'], 'stroke': _jaw_g['stroke']}]
    heads[_view]['turned'] = {'rig': _rig_side, 'nape': {'fill': _nape_g['fill'], 'stroke': _nape_g['stroke']}}
    turned_report[_view] = {'rig': _rig_side, 'throatExit': [round(v, 1) for v in _jaw_g['exit']], 'crestClear': round(_nape_g['clear'], 1)}
print('turned mounts:', turned_report)

# Round 5 (R4 review minor, seal check: 79 px at 3.2 px/u on the left rig, 82 on the right, 3-7 px per proof frame): on a
# side rig the FRONT head's chin edge, below the point where the expressions' jaw lines turn in to the mouth corner, meets
# the background between the jaw line and the neck's front line. Each side mount gets a jaw closure on the throat side,
# generated from the scaled head and that rig's neck (Head.tsx draws it only on its rig, and not with a mouth whose own jaw
# line is the whole lower contour: the shocked gasp). KEEP IN SYNC with Badger.tsx LEFT_HEAD_MOUNT.front and
# RIGHT_HEAD_MOUNT.front (dx, dy).
FRONT_MOUNTS = {'left': ('rigLeft.ts', -13.0, 25.0, (129.0, 175.0)), 'right': ('rigRight.ts', 13.0, 25.0, (278.0, 176.0))}
heads['front']['mountJaws'] = []
for _rig_side, (_rig_file, _dx, _dy, _start_nf) in FRONT_MOUNTS.items():
    _r = _rig(_rig_file)
    _hm = _r['neck']['headMount']
    _ox, _oy = _hm['x'] + _dx, _hm['y'] + _dy
    _to_head = lambda d, ox=_ox, oy=_oy: map_path(d, lambda x, y: (x - ox, y - oy))
    _sx, _sy = F(*_start_nf)
    _g = _edge_jaw(heads['front'], 'front/' + _rig_side, _to_head(_r['neck']['strokes'][1]), _to_head(_r['neck']['fill']),
                   (_sx * HEAD_SCALE_FRONT, _sy * HEAD_SCALE_FRONT))
    heads['front']['mountJaws'].append({'rig': _rig_side, 'fill': _g['fill'], 'stroke': _g['stroke']})
    turned_report['front/' + _rig_side] = {'throatExit': [round(v, 1) for v in _g['exit']]}
print('front mounts:', {k: v for k, v in turned_report.items() if k.startswith('front')})
print('profile right back contour meets the neck at', [round(v, 1) for v in _profile_r_back()])

for v in ('front', 'threeQuarterLeftScreen', 'threeQuarterRightScreen'):
    heads[v]['throat'] = None
for v in heads:
    heads[v].setdefault('neckUp', None)
    heads[v].setdefault('clipMouth', False)
    heads[v].setdefault('chin', None)
    heads[v].setdefault('bridge', None)
    heads[v].setdefault('jaw', None)
    heads[v].setdefault('turned', None)
    heads[v].setdefault('mountJaws', [])
    heads[v].setdefault('scale', 1)

# =============================================================================== FRONT NECK (bust)
# D55 (round 5): the bust neck scales with the front head about the head origin in bust coordinates (NF (208, 215) =
# (0, -19.45); the busts draw the head at translate(0 -19.5)), so the bust stays a uniformly scaled copy of the panel
FN = compose(lin(208, 250, S_NF, S_NF), lambda x, y: (x * HEAD_SCALE_FRONT, -19.45 + (y + 19.45) * HEAD_SCALE_FRONT))
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
