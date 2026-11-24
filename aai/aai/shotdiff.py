"""Screenshot layout regression (backlog P3 "Screenshot regression"): dependency-free PNG decode + grid diff.

The live HUD changes every second (prices, clocks, the orb), so a raw pixel diff is useless. Instead each screenshot is
cut into a grid of cells; per cell we keep mean luminance and texture (std-dev). A cell "changed" when either moves
past a tolerance, and a cell is "newly blank" when it had texture in the baseline but is now flat (an empty or
collapsed panel). The verdict fails on a size change, too many changed cells, or too many newly blank cells.
Read-only: it only reads the two PNG files it is given. Pure Python (zlib + struct), no Pillow/numpy."""
from __future__ import annotations

import struct
import zlib

PNG_SIG = b"\x89PNG\r\n\x1a\n"
_CHANNELS = {0: 1, 2: 3, 4: 2, 6: 4}          # gray, RGB, gray+alpha, RGBA (8-bit only)
MAX_PIXELS = 40_000_000                         # refuse absurd images rather than eat the box's memory


class PngError(ValueError):
    pass


def _paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    return b if pb <= pc else c


def read_png(path_or_bytes) -> tuple[int, int, int, list[bytes]]:
    """Decode an 8-bit, non-interlaced PNG → (width, height, channels, rows). Raises PngError otherwise."""
    data = path_or_bytes if isinstance(path_or_bytes, (bytes, bytearray)) else open(path_or_bytes, "rb").read()
    if data[:8] != PNG_SIG:
        raise PngError("not a PNG")
    pos, idat, hdr = 8, [], None
    while pos + 8 <= len(data):
        n, typ = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + n]
        pos += 12 + n
        if typ == b"IHDR":
            hdr = struct.unpack(">IIBBBBB", body)
        elif typ == b"IDAT":
            idat.append(body)
        elif typ == b"IEND":
            break
    if not hdr:
        raise PngError("missing IHDR")
    w, h, depth, ctype, _comp, _flt, interlace = hdr
    if depth != 8 or ctype not in _CHANNELS or interlace:
        raise PngError(f"unsupported PNG (depth={depth} color={ctype} interlace={interlace})")
    if w * h > MAX_PIXELS or not w or not h:
        raise PngError(f"bad size {w}x{h}")
    ch = _CHANNELS[ctype]
    raw = zlib.decompress(b"".join(idat))
    stride = w * ch
    if len(raw) < h * (stride + 1):
        raise PngError("truncated image data")
    rows: list[bytes] = []
    prev = bytearray(stride)
    for y in range(h):
        off = y * (stride + 1)
        f, line = raw[off], bytearray(raw[off + 1:off + 1 + stride])
        if f == 1:
            for i in range(ch, stride):
                line[i] = (line[i] + line[i - ch]) & 255
        elif f == 2:
            line = bytearray((x + p) & 255 for x, p in zip(line, prev))
        elif f == 3:
            for i in range(stride):
                left = line[i - ch] if i >= ch else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                left = line[i - ch] if i >= ch else 0
                ul = prev[i - ch] if i >= ch else 0
                line[i] = (line[i] + _paeth(left, prev[i], ul)) & 255
        elif f != 0:
            raise PngError(f"bad filter {f} on row {y}")
        rows.append(bytes(line))
        prev = line
    return w, h, ch, rows


def write_png(path, w: int, h: int, rgb_rows: list[bytes]) -> None:
    """Minimal RGB PNG writer (filter 0). Used by tests and to save diff fixtures; never touches the HUD."""
    def chunk(t: bytes, b: bytes) -> bytes:
        return struct.pack(">I", len(b)) + t + b + struct.pack(">I", zlib.crc32(t + b) & 0xFFFFFFFF)
    raw = b"".join(b"\x00" + bytes(r) for r in rgb_rows)
    out = PNG_SIG + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b"")
    with open(path, "wb") as fh:
        fh.write(out)


def grid(img, cols: int = 12, rows: int = 8, step: int = 2) -> list[list[tuple[float, float]]]:
    """Per-cell (mean luma, std-dev luma) on a `cols`×`rows` grid, sampling every `step` px in x and y."""
    w, h, ch, data = img
    out = []
    for gy in range(rows):
        y0, y1 = gy * h // rows, (gy + 1) * h // rows
        line = []
        for gx in range(cols):
            x0, x1 = gx * w // cols, (gx + 1) * w // cols
            n = s = ss = 0
            for y in range(y0, y1, step):
                r = data[y]
                for x in range(x0, x1, step):
                    i = x * ch
                    v = r[i] if ch < 3 else (r[i] * 299 + r[i + 1] * 587 + r[i + 2] * 114) // 1000
                    n += 1
                    s += v
                    ss += v * v
            mean = s / n if n else 0.0
            var = max(0.0, ss / n - mean * mean) if n else 0.0
            line.append((round(mean, 2), round(var ** 0.5, 2)))
        out.append(line)
    return out


def compare(base, new, cols: int = 12, rows: int = 8, mean_tol: float = 18.0, std_tol: float = 14.0,
            blank_std: float = 2.0, threshold: float = 0.35, max_new_blank: int = 2) -> dict:
    """Grid diff of two decoded images (see module doc). Returns a JSON-safe verdict dict."""
    if base[:2] != new[:2]:
        return {"ok": False, "verdict": "FAIL", "reason": f"size changed {base[0]}x{base[1]} -> {new[0]}x{new[1]}",
                "changed_frac": 1.0, "changed": [], "new_blank": []}
    ga, gb = grid(base, cols, rows), grid(new, cols, rows)
    changed, new_blank = [], []
    for y in range(rows):
        for x in range(cols):
            (ma, sa), (mb, sb) = ga[y][x], gb[y][x]
            if abs(ma - mb) > mean_tol or abs(sa - sb) > std_tol:
                changed.append([x, y])
            if sa > blank_std * 3 and sb <= blank_std:
                new_blank.append([x, y])
    frac = round(len(changed) / float(cols * rows), 4)
    reasons = []
    if frac > threshold:
        reasons.append(f"{len(changed)}/{cols * rows} cells changed ({frac:.0%} > {threshold:.0%})")
    if len(new_blank) > max_new_blank:
        reasons.append(f"{len(new_blank)} cells went blank (> {max_new_blank}): possible empty/collapsed panel")
    return {"ok": not reasons, "verdict": "PASS" if not reasons else "FAIL", "reason": "; ".join(reasons) or "layout stable",
            "size": [base[0], base[1]], "grid": [cols, rows], "changed_frac": frac, "changed": changed, "new_blank": new_blank}


def compare_files(base_path, new_path, **kw) -> dict:
    try:
        a, b = read_png(base_path), read_png(new_path)
    except (OSError, PngError, zlib.error) as e:
        return {"ok": False, "verdict": "ERROR", "reason": f"{type(e).__name__}: {e}"[:200]}
    out = compare(a, b, **kw)
    out.update(base=str(base_path), new=str(new_path))
    return out


def main(argv=None) -> int:
    import argparse, json
    ap = argparse.ArgumentParser(description="Zoora screenshot layout regression (grid diff, pure Python).")
    ap.add_argument("base"), ap.add_argument("new")
    ap.add_argument("--threshold", type=float, default=0.35, help="max fraction of changed grid cells (default 0.35)")
    ap.add_argument("--max-new-blank", type=int, default=2, help="max cells that may turn blank (default 2)")
    ap.add_argument("--cols", type=int, default=12), ap.add_argument("--rows", type=int, default=8)
    a = ap.parse_args(argv)
    res = compare_files(a.base, a.new, threshold=a.threshold, max_new_blank=a.max_new_blank,
                        cols=max(1, a.cols), rows=max(1, a.rows))
    print(json.dumps(res, indent=2))
    return 0 if res.get("ok") else (2 if res.get("verdict") == "ERROR" else 1)


if __name__ == "__main__":
    raise SystemExit(main())
