"""Generate BADGER head views (head-local world units) from traces over the approved sheet crops.

Spaces:
  NF = reference/crops/badger_expr_neutral.png (front head). Skull width 116..292 px -> 100 units
       (size-comparison panel: skull width ~101 units). s = 0.5556, origin NF (208, 215) (mouth centre).
  CL = reference/crops/badger_coat_left.png (left profile). Uniform k = 1.0455 (same as body height),
       origin CL (155, 100) = top of the neck (head pivot).
  T34 = reference/crops/badger_turn_34.png (3/4 facing screen right).
  CR = reference/crops/badger_coat_right.png (right profile).
  UP = reference/crops/badger_pose_looking_up.png (looking up, facing screen right).
All markings are authored per view on their ANATOMICAL side; nothing is mirrored.
"""
import json
import math
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
from pathmap import map_path, ellipse_path

OUT_TS, OUT_JSON = sys.argv[1], sys.argv[2]


def space(ox, oy, s, rot=0.0):
    a = math.radians(rot)
    ca, sa = math.cos(a), math.sin(a)

    def f(x, y):
        X, Y = (x - ox) * s, (y - oy) * s
        return (X * ca - Y * sa, X * sa + Y * ca)
    return f


def mp(d, f):
    return map_path(d, f)


def me(cx, cy, rx, ry, rot, f):
    return map_path(ellipse_path(cx, cy, rx, ry, rot), f)


def pt(x, y, f):
    X, Y = f(x, y)
    return {'x': round(X, 2), 'y': round(Y, 2)}


def eye(f, s, cx, cy, w, up, low, drop, inner, iris_r, iris_dx=0, iris_dy=0, side='L', profile=False):
    c = pt(cx, cy, f)
    return {'side': side, 'c': c, 'w': round(w * s, 2), 'up': round(up * s, 2), 'low': round(low * s, 2),
            'drop': round(drop * s, 2), 'inner': inner, 'irisR': round(iris_r * s, 2),
            'irisDX': round(iris_dx * s, 2), 'irisDY': round(iris_dy * s, 2), 'profile': profile}


def brow(f, outer, mid, inner, side):
    return {'side': side, 'outer': pt(*outer, f), 'mid': pt(*mid, f), 'inner': pt(*inner, f)}


def ear(f, side, pivot, back_rot, back_sx, fills, strokes, details=()):
    return {'side': side, 'pivot': pt(*pivot, f), 'backRot': back_rot, 'backSx': back_sx,
            'fills': [{'d': mp(d, f), 'color': c, **({'clip': True} if clip else {})} for (d, c, clip) in fills],
            'strokes': [mp(d, f) for d in strokes], 'details': [mp(d, f) for d in details]}


heads = {}
markings = {'H-EAR-L-CAP': {}, 'H-EAR-R-SPOT': {}, 'H-CHEEK-L': {}, 'H-CHEEK-R': {}}
front_neck = []

# =============================================================================== FRONT (NF)
S_NF = 0.5556
F = space(208, 215, S_NF)
skull_fill = ('M 141 31 C 165 23 245 22 262 29 L 289 92 C 293 118 294 148 288 162 C 284 170 280 174 277 177 '
              'C 271 192 262 205 252 216 C 244 230 228 243 208 244 C 188 243 172 230 164 216 '
              'C 154 205 145 192 139 177 C 135 173 131 169 127 162 C 120 148 115 125 116 100 L 122 40 Z')
ear_spot_front = me(86, 53, 4.6, 9.2, 28, F)
cheek_r = me(134, 160, 4.8, 8.6, -16, F)
cheek_l = me(282, 158, 4.3, 8.2, 16, F)
markings['H-EAR-R-SPOT']['front'] = ear_spot_front
markings['H-CHEEK-R']['front'] = cheek_r
markings['H-CHEEK-L']['front'] = cheek_l
heads['front'] = {
    'earsBehind': [],
    'skull': {
        'fill': mp(skull_fill, F),
        'strokes': [mp(d, F) for d in [
            'M 158 31 C 175 25 195 22 207 22 C 225 22 245 26 258 32',
            'M 113 104 C 112 125 114 145 119 158 C 122 165 125 170 129 175',
            'M 293 100 C 295 120 294 145 289 158 C 286 165 282 171 278 176',
        ]],
        'details': [],
    },
    'shadows': [
        {'d': mp('M 190 193 C 200 199 216 199 226 193 C 230 203 236 212 246 216 C 240 232 226 246 208 247 C 190 246 176 232 170 216 C 180 212 186 203 190 193 Z', F), 'color': 'coatShadow'},
    ],
    'markings': [{'id': 'H-CHEEK-R', 'd': cheek_r}, {'id': 'H-CHEEK-L', 'd': cheek_l}],
    'nose': {'d': mp('M 208 154 C 224 154 236 159 236 170 C 236 181 226 190 215 196 C 211 198 205 198 201 196 '
                     'C 190 190 185 181 185 170 C 185 159 192 154 208 154 Z', F)},
    'philtrum': mp('M 208 197 L 208 211', F),
    'eyes': [
        eye(F, S_NF, 156, 103, 21, 10.5, 10, 10, 1, 10.6, 0.5, 1, side='R'),
        eye(F, S_NF, 259, 103, 21, 10.5, 10, 10, -1, 10.6, -0.5, 1, side='L'),
    ],
    'brows': [
        brow(F, (139, 85), (157, 76), (176, 81), 'R'),
        brow(F, (277, 85), (259, 76), (240, 81), 'L'),
    ],
    'mouth': {
        'neutral': {'strokes': [mp('M 129 175 C 137 190 147 204 160 214 C 176 219 193 217 208 211 C 223 217 240 219 252 214 C 261 204 270 191 278 176', F)],
                    'details': [mp('M 185 228 C 197 231 219 231 231 228', F)], 'fills': []},
        'happy': {'strokes': [mp('M 129 175 C 136 191 146 204 160 211 C 176 219 193 219 208 212 C 223 219 240 219 256 211 C 268 204 274 192 278 176', F),
                              mp('M 151 205 C 155 207 158 209 161 211', F)],
                  'details': [mp('M 180 226 C 196 236 220 236 236 226', F)], 'fills': []},
        'worried': {'strokes': [mp('M 129 175 C 137 190 147 205 161 215 C 176 216 192 222 208 217 C 222 213 238 220 252 215 C 261 204 270 191 278 176', F)],
                    'details': [mp('M 190 231 C 200 228 216 228 226 231', F)], 'fills': []},
        'shocked': {'strokes': [mp('M 129 175 C 137 190 147 204 162 212', F), mp('M 278 176 C 270 191 261 204 254 212', F),
                                mp('M 185 214 C 191 205 225 205 231 214 C 233 225 222 234 208 234 C 194 234 183 225 185 214 Z', F)],
                    'details': [],
                    'fills': [{'d': mp('M 185 214 C 191 205 225 205 231 214 C 233 225 222 234 208 234 C 194 234 183 225 185 214 Z', F), 'color': 'mouth'},
                              {'d': mp('M 189 224 C 197 218 219 218 227 224 C 224 231 192 231 189 224 Z', F), 'color': 'tongue'}]},
    },
    'earsFront': [
        ear(F, 'R', (128, 45), -24, 0.9, [
            ('M 158 31 C 150 25 136 17 122 17 C 109 17 97 26 86 35 C 72 45 52 55 40 66 C 34 72 35 86 42 93 '
             'C 50 102 60 113 70 116 C 77 117 83 111 89 104 C 96 107 104 111 113 113 C 114 100 118 82 124 66 '
             'C 129 56 135 50 141 47 C 147 42 153 36 158 31 Z', 'coat', False),
            ('M 92 102 C 96 85 100 68 106 55 C 110 45 116 37 123 35 C 128 34 133 38 136 45 C 132 52 127 59 124 66 '
             'C 118 80 115 92 113 106 C 105 104 98 103 92 102 Z', 'earPaleInner', True),
            (ellipse_path(88, 51, 4.6, 9.0, 28), 'spot', True),
        ], [
            'M 158 31 C 150 25 136 17 122 17 C 109 17 97 26 86 35 C 72 45 52 55 40 66 C 34 72 35 86 42 93 '
            'C 50 102 60 113 70 116 C 77 117 83 111 89 104 C 96 107 104 111 113 113',
            'M 92 102 C 96 85 100 68 106 55 C 110 45 116 37 123 35 C 128 34 133 38 136 45',
            'M 141 47 C 135 52 128 58 124 66 C 118 80 115 92 113 106',
        ], ['M 121 62 C 122 66 122 70 122 74']),
        ear(F, 'L', (283, 45), 24, 0.9, [
            ('M 296 104 C 297 92 299 80 303 70 C 310 60 325 58 334 64 C 337 68 338 72 337 75 '
             'C 330 84 316 94 303 106 C 300 108 297 107 296 104 Z', 'earPaleInner', False),
            ('M 254 33 C 264 24 278 17 292 17 C 312 19 335 38 352 52 C 362 60 366 72 365 84 C 364 94 360 101 354 101 '
             'C 349 100 345 93 341 86 C 338 79 336 70 332 65 C 324 58 310 57 301 63 C 294 68 291 78 291 88 '
             'C 291 94 292 98 293 101 C 288 90 280 70 272 55 C 266 45 260 38 254 33 Z', 'earCap', False),
        ], [
            'M 337 75 C 330 84 316 94 303 106 C 300 108 297 108 295 104',
            'M 254 33 C 264 24 278 17 292 17 C 312 19 335 38 352 52 C 362 60 366 72 365 84 C 364 94 360 101 354 101 '
            'C 349 100 345 93 341 86 C 338 79 336 70 332 65 C 324 58 310 57 301 63 C 294 68 291 78 291 88 '
            'C 291 94 292 98 293 101 C 288 90 280 70 272 55 C 266 45 260 38 254 33 Z',
        ]),
    ],
}

# front neck / collar bust (NF space, local origin NF (208, 250))
FN = space(208, 250, S_NF)
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
front_neck.append({'id': 'L-NECK', 'side': 'left', 'path': me(260, 243, 4.6, 11, 6, FN),
                   'ref': {'crop': 'badger_expr_neutral.png', 'x': 260, 'y': 243},
                   'desc': 'left neck spot seen from the front (same marking as the left-view L-NECK)'})
front_neck.append({'id': 'R-NECK', 'side': 'right', 'path': me(154, 240, 6, 13, -8, FN),
                   'ref': {'crop': 'badger_expr_neutral.png', 'x': 154, 'y': 240},
                   'desc': 'right neck spot (badger_coat_right.png, below the pale ear) seen from the front'})

# =============================================================================== PROFILE LEFT (CL)
K_CL = 1.0455
KX_CL = 0.9587  # same horizontal factor as the left body so the profile keeps the coat map's head:body ratio


def space_aniso(ox, oy, kx, ky):
    def f(x, y):
        return ((x - ox) * kx, (y - oy) * ky)
    return f


C = space_aniso(155, 100, KX_CL, K_CL)
EAR_PL = ('M 139 39 C 150 36 162 36 172 40 C 182 44 192 51 195 59 C 197 66 194 72 187 76 '
          'C 180 80 172 85 163 89 C 159 90 155 89 152 86 C 147 80 143 68 141 56 C 140 50 139 44 139 39 Z')
heads['profileLeftScreen'] = {
    'earsBehind': [],
    'skull': {
        'fill': mp('M 50 76 C 62 72 78 68 88 63 C 92 58 97 52 104 48 C 115 42 128 39 142 38 C 165 38 185 43 192 57 '
                   'C 196 65 194 76 186 84 C 178 96 168 108 152 116 C 140 120 132 121 126 121 C 118 117 108 115 96 115 '
                   'C 80 117 64 115 54 110 C 46 105 44 96 46 86 C 47 80 48 78 50 76 Z', C),
        'strokes': [mp('M 141 38 C 128 39 115 42 104 48 C 97 52 92 58 88 63 C 78 68 62 72 49 77', C),
                    mp('M 45 99 C 49 105 56 110 66 113 C 82 117 100 116 112 117 C 118 118 122 119 126 122', C)],
        'details': [mp('M 153 98 C 150 104 145 108 138 111', C)],
    },
    'shadows': [],
    'markings': [],
    'nose': {'d': mp('M 51 77 C 42 75 34 80 32 87 C 31 94 36 100 44 100 C 50 100 54 95 54 89 C 54 83 54 79 51 77 Z', C)},
    'philtrum': None,
    'eyes': [eye(C, K_CL, 100, 66.5, 11.5, 5.4, 4.0, 3.5, -1, 5.4, -3.2, 0.3, side='L', profile=True)],
    'brows': [brow(C, (111, 57), (103, 54), (94, 57), 'L')],
    'mouth': {
        'neutral': {'strokes': [], 'details': [mp('M 110 114 C 115 115 119 117 122 121', C)], 'fills': []},
        'happy': {'strokes': [], 'details': [mp('M 104 116 C 111 115 116 112 119 107', C)], 'fills': []},
        'worried': {'strokes': [], 'details': [mp('M 106 115 C 112 117 116 120 118 125', C)], 'fills': []},
        'shocked': {'strokes': [mp('M 50 106 C 70 117 98 121 118 118', C)], 'details': [],
                    'fills': [{'d': mp('M 47 103 C 70 113 100 115 120 116 C 104 121 78 122 58 116 C 52 113 49 108 47 103 Z', C), 'color': 'mouth'}]},
    },
    'earsFront': [
        ear(C, 'L', (150, 44), -24, 0.92, [
            (EAR_PL, 'earCap', False),
        ], [EAR_PL]),
    ],
}
markings['H-EAR-L-CAP']['profileLeftScreen'] = 'near ear'

res = {'heads': heads, 'frontNeck': front_neck_geom}
with open(OUT_TS, 'w') as fh:
    fh.write('/**\n * BADGER head views, head-local world units (origin = head pivot). GENERATED by\n'
             ' * src/characters/badger/dev/trace/gen_heads.py from traces over the approved sheet crops.\n'
             ' * Edit the tracer, not this file. Markings are authored per view on their anatomical side.\n */\n')
    fh.write('export const HEAD_GEOM = ' + json.dumps(heads, indent='\t') + ' as const;\n\n')
    fh.write('export const FRONT_NECK_GEOM = ' + json.dumps(front_neck_geom, indent='\t') + ' as const;\n')

mk = [
    {'id': 'H-EAR-L-CAP', 'side': 'left', 'desc': 'dark cap: the whole outer flap of the anatomical LEFT ear (screen right in the front head)', 'paths': {}},
    {'id': 'H-EAR-R-SPOT', 'side': 'right', 'desc': 'small dark spot on the outer flap of the pale anatomical RIGHT ear',
     'paths': {k: v for k, v in markings['H-EAR-R-SPOT'].items()}},
    {'id': 'H-CHEEK-R', 'side': 'right', 'desc': 'spot on the right cheek beside the muzzle (screen left in the front head)',
     'paths': markings['H-CHEEK-R']},
    {'id': 'H-CHEEK-L', 'side': 'left', 'desc': 'spot on the left cheek beside the muzzle (screen right in the front head)',
     'paths': markings['H-CHEEK-L']},
]
with open(OUT_JSON, 'w') as fh:
    json.dump({'head': mk, 'frontNeck': front_neck}, fh, indent=1)
print('heads:', list(heads))
