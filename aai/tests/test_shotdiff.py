"""Backlog P3 screenshot regression: pure-Python PNG decode (all 5 filters) + grid diff verdicts. tmp files only."""
import struct, zlib
from pathlib import Path
import pytest
from aai import shotdiff as sd

SHOTS = Path(__file__).resolve().parents[1] / "docs" / "screenshots"


def _panels(w=240, h=160, blank=(), shift=0):
    """Synthetic HUD: dark background with textured 'panels' on a 4x2 layout; `blank` panel indexes are left flat."""
    rows = []
    for y in range(h):
        r = bytearray()
        for x in range(w):
            p = (y * 2 // h) * 4 + (x * 4 // w)
            inside = (x % (w // 4)) > 6 and (y % (h // 2)) > 6
            if inside and p not in blank:
                v = 40 + ((x * 7 + y * 13 + shift) % 160)
                r += bytes((v, (v * 3) % 256, 255 - v))
            else:
                r += b"\x08\x0c\x14"
        rows.append(bytes(r))
    return rows


def _encode_all_filters(w, h, rows, ch=3):
    """PNG bytes whose rows cycle through filters 0..4, to exercise the decoder's unfilter paths."""
    out, prev = [], bytes(w * ch)
    for y, line in enumerate(rows):
        f = y % 5
        enc = bytearray()
        for i, v in enumerate(line):
            a = line[i - ch] if i >= ch else 0
            b, c = prev[i], (prev[i - ch] if i >= ch else 0)
            pred = (0, a, b, (a + b) >> 1, sd._paeth(a, b, c))[f]
            enc.append((v - pred) & 255)
        out.append(bytes([f]) + bytes(enc))
        prev = line
    ck = lambda t, b: struct.pack(">I", len(b)) + t + b + struct.pack(">I", zlib.crc32(t + b) & 0xFFFFFFFF)
    return (sd.PNG_SIG + ck(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + ck(b"IDAT", zlib.compress(b"".join(out))) + ck(b"IEND", b""))


def test_decoder_roundtrip_every_filter():
    rows = _panels(60, 25)
    w, h, ch, got = sd.read_png(_encode_all_filters(60, 25, rows))
    assert (w, h, ch) == (60, 25, 3) and got == rows


def test_writer_roundtrip(tmp_path):
    rows = _panels(48, 32)
    sd.write_png(tmp_path / "a.png", 48, 32, rows)
    assert sd.read_png(tmp_path / "a.png")[3] == rows


def test_rejects_garbage_and_unsupported(tmp_path):
    with pytest.raises(sd.PngError):
        sd.read_png(b"GIF89a....")
    bad = tmp_path / "x.png"
    bad.write_bytes(b"not a png")
    r = sd.compare_files(bad, bad)
    assert r["verdict"] == "ERROR" and r["ok"] is False
    assert sd.main([str(bad), str(bad)]) == 2


def test_live_content_churn_passes(tmp_path):
    """Same layout, different numbers/texture phase (prices tick): stable."""
    sd.write_png(tmp_path / "a.png", 240, 160, _panels())
    sd.write_png(tmp_path / "b.png", 240, 160, _panels(shift=37))
    r = sd.compare_files(tmp_path / "a.png", tmp_path / "b.png")
    assert r["ok"] and r["verdict"] == "PASS" and r["new_blank"] == []
    assert sd.main([str(tmp_path / "a.png"), str(tmp_path / "b.png")]) == 0


def test_empty_panel_fails(tmp_path):
    sd.write_png(tmp_path / "a.png", 240, 160, _panels())
    sd.write_png(tmp_path / "b.png", 240, 160, _panels(blank=(1, 5)))
    r = sd.compare_files(tmp_path / "a.png", tmp_path / "b.png")
    assert r["verdict"] == "FAIL" and "went blank" in r["reason"] and len(r["new_blank"]) > 2
    assert sd.main([str(tmp_path / "a.png"), str(tmp_path / "b.png")]) == 1


def test_size_change_and_mass_change_fail(tmp_path):
    a = sd.read_png(_encode_all_filters(240, 160, _panels()))
    small = sd.read_png(_encode_all_filters(240, 120, _panels(h=120)))
    assert "size changed" in sd.compare(a, small)["reason"]
    flat = (240, 160, 3, [b"\xff\xff\xff" * 240] * 160)
    r = sd.compare(a, flat, max_new_blank=10_000)
    assert r["verdict"] == "FAIL" and "cells changed" in r["reason"] and r["changed_frac"] > 0.35


def test_real_chrome_screenshot_decodes():
    p = SHOTS / "zoora-zsic-1828-overdue-alarm-desk.png"
    if not p.exists():
        pytest.skip("tracked screenshot missing")
    w, h, ch, rows = sd.read_png(p)
    assert (w, h) == (1440, 1000) and len(rows) == h and len(rows[0]) == w * ch
    assert sd.compare_files(p, p)["changed_frac"] == 0.0
