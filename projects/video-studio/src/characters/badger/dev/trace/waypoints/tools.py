import numpy as np, os, re, math
from PIL import Image, ImageDraw, ImageFont
CROPS = '/home/user/buildwithAAI/projects/video-studio/reference/crops'
HERE = os.path.dirname(os.path.abspath(__file__))
FONT = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 11)

def load(name):
    return Image.open(os.path.join(CROPS, name)).convert('RGB')

def dark(name, thr=110):
    a = np.asarray(load(name)).astype(float)
    lum = 0.299*a[...,0] + 0.587*a[...,1] + 0.114*a[...,2]
    return lum < thr

def zhang_suen(img):
    img = img.copy().astype(np.uint8)
    changed = True
    while changed:
        changed = False
        for step in range(2):
            P = np.pad(img, 1)
            p2 = P[:-2,1:-1]; p3 = P[:-2,2:]; p4 = P[1:-1,2:]; p5 = P[2:,2:]
            p6 = P[2:,1:-1]; p7 = P[2:,:-2]; p8 = P[1:-1,:-2]; p9 = P[:-2,:-2]
            nb = [p2,p3,p4,p5,p6,p7,p8,p9]
            B = sum(n.astype(int) for n in nb)
            seq = nb + [p2]
            A = sum(((seq[i] == 0) & (seq[i+1] == 1)).astype(int) for i in range(8))
            if step == 0:
                c = (p2*p4*p6 == 0) & (p4*p6*p8 == 0)
            else:
                c = (p2*p4*p8 == 0) & (p2*p6*p8 == 0)
            m = (img == 1) & (B >= 2) & (B <= 6) & (A == 1) & c
            if m.any():
                img[m] = 0; changed = True
    return img.astype(bool)

def skeleton(name, thr=110):
    cache = os.path.join(HERE, name.replace('.png', f'_sk{thr}.npy'))
    if os.path.exists(cache):
        return np.load(cache)
    sk = zhang_suen(dark(name, thr))
    np.save(cache, sk)
    return sk

def snap_pts(name, pts, r=7, thr=110):
    sk = skeleton(name, thr)
    ys, xs = np.nonzero(sk)
    out = []
    for p in pts:
        x, y = p[0], p[1]
        if 'n' in p[2:]:
            out.append((x, y) + tuple(f for f in p[2:] if f != 'n'))
            continue
        d2 = (xs - x)**2 + (ys - y)**2
        i = int(np.argmin(d2))
        if d2[i] <= r*r:
            out.append((int(xs[i]), int(ys[i])) + tuple(p[2:]))
        else:
            out.append(tuple(p))
    return out

TOK = re.compile(r'[MLCZmlcz]|-?\d*\.?\d+(?:e-?\d+)?')
def sample_path(d, n=16):
    toks = TOK.findall(d); i = 0; cmd = None; cur = (0,0); start = (0,0); polys = []; poly = []
    def num():
        nonlocal i
        v = float(toks[i]); i += 1; return v
    while i < len(toks):
        t = toks[i]
        if re.match(r'[A-Za-z]', t):
            cmd = t; i += 1
            if cmd in 'Zz':
                poly.append(start); polys.append(poly); poly = []
            continue
        if cmd == 'M':
            if poly: polys.append(poly)
            cur = (num(), num()); start = cur; poly = [cur]; cmd = 'L'
        elif cmd == 'L':
            cur = (num(), num()); poly.append(cur)
        elif cmd == 'C':
            p1 = (num(), num()); p2 = (num(), num()); p3 = (num(), num())
            p0 = cur
            for k in range(1, n+1):
                s = k/n; u = 1-s
                poly.append((u**3*p0[0]+3*u*u*s*p1[0]+3*u*s*s*p2[0]+s**3*p3[0], u**3*p0[1]+3*u*u*s*p1[1]+3*u*s*s*p2[1]+s**3*p3[1]))
            cur = p3
    if poly: polys.append(poly)
    return polys

def overlay(name, paths, out, zoom=2.0, box=None, colors=None, labels=None, grid=20, fade=0.55):
    im = load(name)
    if box: 
        x0,y0,x1,y1 = box
    else:
        x0,y0,x1,y1 = 0,0,im.width,im.height
    im = im.crop((x0,y0,x1,y1)).resize((int((x1-x0)*zoom), int((y1-y0)*zoom)), Image.LANCZOS)
    im = Image.blend(im, Image.new('RGB', im.size, (255,255,255)), fade) if fade else im
    d = ImageDraw.Draw(im)
    if grid:
        for gx in range((x0//grid)*grid, x1+1, grid):
            X = (gx-x0)*zoom; d.line([(X,0),(X,im.height)], fill=(200,200,255)); d.text((X+1,1), str(gx), fill=(0,0,160), font=FONT)
        for gy in range((y0//grid)*grid, y1+1, grid):
            Y = (gy-y0)*zoom; d.line([(0,Y),(im.width,Y)], fill=(200,200,255)); d.text((1,Y+1), str(gy), fill=(0,0,160), font=FONT)
    pal = [(220,0,0),(0,150,0),(0,0,230),(200,0,200),(0,160,160),(230,120,0)]
    for k, pth in enumerate(paths):
        col = (colors[k] if colors else pal[k % len(pal)])
        for poly in sample_path(pth):
            P = [((x-x0)*zoom, (y-y0)*zoom) for x,y in poly]
            if len(P) > 1: d.line(P, fill=col, width=2)
    if labels:
        for (x,y,t) in labels:
            d.text(((x-x0)*zoom+3, (y-y0)*zoom-12), t, fill=(0,0,0), font=FONT)
    im.save(out)

from collections import deque as _dq
def _nearest(sk, x, y, r=8):
    ys, xs = np.nonzero(sk)
    d2 = (xs - x)**2 + (ys - y)**2
    i = int(np.argmin(d2))
    return (int(xs[i]), int(ys[i])) if d2[i] <= r*r else None

def _bfs(sk, a, b, limit=4000):
    H, W = sk.shape
    prev = {a: None}; q = _dq([a])
    while q:
        c = q.popleft()
        if c == b: break
        for dx in (-1,0,1):
            for dy in (-1,0,1):
                if not dx and not dy: continue
                n = (c[0]+dx, c[1]+dy)
                if 0 <= n[0] < W and 0 <= n[1] < H and sk[n[1], n[0]] and n not in prev:
                    prev[n] = c; q.append(n)
        if len(prev) > limit*10: break
    if b not in prev: return None
    path = []; c = b
    while c is not None: path.append(c); c = prev[c]
    return path[::-1]

def trace(name, wps, step=10, r=8, thr=110, report=None):
    """Follow the outline skeleton through waypoints; returns resampled points (keeps waypoint flags 'c')."""
    sk = skeleton(name, thr)
    snapped = []
    for w in wps:
        flags = tuple(w[2:])
        if 'n' in flags:
            snapped.append(((w[0], w[1]), flags, False)); continue
        p = _nearest(sk, w[0], w[1], r)
        if p is None:
            if report is not None: report.append(('nosnap', w))
            snapped.append(((w[0], w[1]), flags, False))
        else:
            snapped.append((p, flags, True))
    pts = [snapped[0]]
    for (a, fa, sa), (b, fb, sb) in zip(snapped, snapped[1:]):
        seg = _bfs(sk, a, b) if (sa and sb) else None
        if seg is None or len(seg) > 3 * (abs(a[0]-b[0]) + abs(a[1]-b[1])) + 20:
            if report is not None and sa and sb: report.append(('nopath', a, b))
            pts.append((b, fb, sb)); continue
        # resample along seg
        acc = 0.0; last = seg[0]
        L = sum(math.hypot(seg[i+1][0]-seg[i][0], seg[i+1][1]-seg[i][1]) for i in range(len(seg)-1))
        nseg = max(1, round(L / step)); target = L / nseg; nxt = target
        for i in range(1, len(seg)):
            d = math.hypot(seg[i][0]-seg[i-1][0], seg[i][1]-seg[i-1][1]); acc += d
            if acc >= nxt - 1e-6 and i < len(seg) - 1 and nxt < L - target * 0.5:
                pts.append((seg[i], (), True)); nxt += target
        pts.append((b, fb, sb))
    return [tuple(p) + tuple(f) for p, f, _ in pts]
