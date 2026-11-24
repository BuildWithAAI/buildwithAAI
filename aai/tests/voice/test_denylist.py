"""Hard deny-list: Zoora voice can never reach trade, spend, transfer, signer, ledger-write or world-edit code.

(a) aai/voice/allowlist.py is the policy: exact-module import allowlist, per-module attribute allowlist, banned
    names/attributes, and the only allowed file-write call sites (the opt-in _Store).
(b) tests/voice/scanner.py enforces it with ast over every aai/voice module. The planted-violation tests prove the
    scanner FAILS on each of Head of Systems' six bypasses (their probe file is the fixture), both as a whole file,
    one bypass at a time without its imports, and planted into a copy of the real package.
(c) Runtime: importing aai.voice in a fresh interpreter loads no other aai.* module and nothing matching the pattern.
    (Inside the HUD process other aai modules are already loaded, so (b) is the tripwire that matters there.)
"""

from __future__ import annotations

import ast
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from aai.voice import allowlist

from .scanner import DENY, scan_package, scan_source, voice_modules

VOICE_DIR = Path(allowlist.__file__).resolve().parent
REPO_ROOT = VOICE_DIR.parent.parent
PROBE = Path(__file__).parent / "fixtures" / "hos_zz_plant_2026-11-17.py.txt"
MODS = voice_modules(VOICE_DIR)


def scan(src: str, name: str = "_probe.py"):
    return scan_source(src, name, MODS)


# ---------------------------------------------------------------- the real package is clean
def test_real_package_has_no_violations():
    v = scan_package(VOICE_DIR)
    assert not v, "\n".join(map(str, v))


def test_scan_covers_every_module():
    assert {"__init__", "gateway", "providers", "keys", "net", "redact", "config", "allowlist", "errors"} <= MODS


# ---------------------------------------------------------------- HoS's six bypasses (fixture = their probe)
PROBE_SRC = PROBE.read_text(encoding="utf-8")
PROBE_FUNCS = {
    "a": "banned-name",  # __builtins__["__imp"+"ort__"]("subprocess")
    "b2": "dynamic-getattr",  # getattr(getattr(io, "__builtins__", {}), "get", ...)("__import__")
    "c": "banned-attr",  # logging.config.dictConfig({"()": "aai.ledger.PaperLedger"})
    "d": "banned-attr",  # urllib.request.urlopen("file:///etc/hostname")
    "e": "file-write",  # pathlib.Path(...).write_text("x")
    "f": "string-annotation",  # typing.get_type_hints on a string annotation (eval)
}


def _func_src(name: str) -> str:
    tree = ast.parse(PROBE_SRC)
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            seg = ast.get_source_segment(PROBE_SRC, node)
            assert seg
            return seg
    raise AssertionError(f"probe function {name} missing")


def test_probe_file_as_a_whole_fails_the_scan():
    rules = {v.rule for v in scan(PROBE_SRC, "zz_plant.py")}
    assert {"import", "banned-name", "dynamic-getattr", "banned-attr", "file-write", "string-annotation"} <= rules


@pytest.mark.parametrize("func,expected_rule", sorted(PROBE_FUNCS.items()))
def test_each_bypass_fails_on_its_own_without_its_imports(func, expected_rule):
    """Each bypass body alone (module-level imports stripped) must still be flagged by the call/name scan."""
    rules = {v.rule for v in scan(_func_src(func))}
    assert expected_rule in rules, rules


@pytest.mark.parametrize(
    "line",
    ["import logging.config", "import urllib.request", "from logging import config", "from urllib import request"],
)
def test_probe_imports_fail(line):
    assert any(v.rule == "import" for v in scan(line + "\n")), line


def test_probe_planted_into_a_copy_of_the_package_fails(tmp_path):
    """Head of Systems' experiment: copy aai/voice, add zz_plant.py and import it from __init__ -> scan must fail."""
    pkg = tmp_path / "voice"
    shutil.copytree(VOICE_DIR, pkg, ignore=shutil.ignore_patterns("__pycache__"))
    (pkg / "zz_plant.py").write_text(PROBE_SRC, encoding="utf-8")
    init = pkg / "__init__.py"
    init.write_text(init.read_text(encoding="utf-8") + "\nfrom . import zz_plant  # noqa: F401\n", encoding="utf-8")
    v = scan_package(pkg)
    files = {x.file for x in v}
    assert files == {"zz_plant.py"}, "\n".join(map(str, v))
    assert len(v) >= 6


# ---------------------------------------------------------------- more bypass shapes that must fail
@pytest.mark.parametrize(
    "src",
    [
        "x = __import__('subprocess')\n",
        "x = globals()['__builtins__']\n",
        "x = vars()\n",
        "x = locals()\n",
        "import builtins\n",
        "x = eval('1')\n",
        "exec('1')\n",
        "c = compile('1', 'f', 'eval')\n",
        "f = open('/tmp/x', 'w')\n",
        "def g(o, n):\n    return getattr(o, n)\n",
        "def g(o):\n    return getattr(o, '__glob' + 'als__')\n",
        "def g(o):\n    return getattr(o, '__globals__')\n",
        "setattr(object, 'x', 1)\n",
        "def g(p):\n    w = p.write_text\n    w('x')\n",
        "def g(p):\n    p.write_bytes(b'x')\n",
        "def g(p):\n    p.open('a')\n",
        "def g(p):\n    p.unlink()\n",
        "import io\nio.open('/tmp/x', 'w')\n",
        "import keyring\nkeyring.core.load_keyring('aai.ledger.X')\n",
        "import logging\nlogging.config.fileConfig('x')\n",
        "import logging\nlogging.basicConfig(filename='x')\n",
        "import logging as L\n",
        "from json import loads as l\n",
        "from typing import get_type_hints\n",
        "from contextlib import redirect_stdout\n",
        "import importlib\n",
        "import subprocess\n",
        "import socket\n",
        "import ctypes\n",
        "import os\n",
        "from aai import economy\n",
        "from aai.ledger import PaperLedger\n",
        "from .. import ledger\n",
        "def g():\n    return ().__class__.__base__.__subclasses__()\n",
        "x: 'int' = 1\n",
        "import pyaudio\n",
        "import sounddevice\n",
    ],
)
def test_other_bypass_shapes_fail(src):
    assert scan(src), src


def test_deny_pattern():
    for name in ("aai.ledger", "aai.economy", "solana_wallet", "signer", "trade_router", "payment", "world_edit"):
        assert DENY.search(name)


# ---------------------------------------------------------------- runtime
def test_runtime_import_loads_no_forbidden_module():
    code = (
        "import json, sys\n"
        "before = set(sys.modules)\n"
        "import aai.voice\n"
        "print(json.dumps(sorted(set(sys.modules) - before)))\n"
    )
    out = subprocess.run(
        [sys.executable, "-c", code], cwd=REPO_ROOT, capture_output=True, text=True, timeout=60, check=False
    )
    assert out.returncode == 0, out.stderr
    loaded = json.loads(out.stdout.strip().splitlines()[-1])
    aai_mods = [m for m in loaded if m == "aai" or m.startswith("aai.")]
    assert all(m == "aai" or m == "aai.voice" or m.startswith("aai.voice.") for m in aai_mods), aai_mods
    assert not [m for m in loaded if DENY.search(m)], [m for m in loaded if DENY.search(m)]
    for forbidden in (
        "aai.ledger", "aai.economy", "aai.guard", "aai.risk", "aai.store", "aai.hud", "aai.zoora",
        "aai.grants", "aai.runtime", "aai.adapters", "logging.config", "pyaudio", "sounddevice", "soundcard",
    ):  # fmt: skip
        assert forbidden not in loaded


def test_runtime_module_globals_hold_no_aliased_modules_or_getattr():
    """Runtime half of B1': after import, a module object may only sit under its own import name (no `m = logging`
    alias at module or class level), httpx only in net and keyring only in keys, and no builtin like getattr is
    re-bound under another name."""
    code = r"""
import builtins, importlib, inspect, json, sys, types
from aai.voice import allowlist as A
mods = sys.argv[1].split(",")
bad = []
watched = {id(getattr(builtins, n)): n for n in ("getattr", "hasattr", "setattr", "delattr", "eval", "exec",
                                                 "compile", "open", "__import__", "vars", "globals", "locals")}
for short in mods:
    m = importlib.import_module("aai.voice." + short)
    def check(where, k, v):
        if isinstance(v, types.ModuleType):
            name = v.__name__
            if name.startswith("aai.voice"):
                if where != short or k != name.rsplit(".", 1)[-1]:
                    bad.append(f"{short}:{where}.{k} -> {name}")
                return
            top = name.split(".")[0]
            if name not in A.ALLOWED_MODULES or where != short or k != top:
                bad.append(f"{short}:{where}.{k} -> module {name}")
            homes = A.IMPORT_ONLY_IN.get(top)
            if homes is not None and short + ".py" not in homes:
                bad.append(f"{short}: {top} outside {sorted(homes)}")
        elif id(v) in watched and (where != "builtins" or k != watched[id(v)]):
            bad.append(f"{short}:{where}.{k} aliases builtin {watched[id(v)]}")
    for k, v in vars(m).items():
        check(short, k, v)
        if inspect.isclass(v) and getattr(v, "__module__", "") == m.__name__:
            for ck, cv in vars(v).items():
                check(f"{short}.{k}", ck, cv)
print(json.dumps(bad))
"""
    mods = sorted(m for m in MODS if m != "__init__")
    out = subprocess.run(
        [sys.executable, "-c", code, ",".join(mods)],
        cwd=REPO_ROOT, capture_output=True, text=True, timeout=60, check=False,
    )  # fmt: skip
    assert out.returncode == 0, out.stderr
    bad = json.loads(out.stdout.strip().splitlines()[-1])
    assert not bad, bad


# ---------------------------------------------------------------- HoS's probe2 (24b36d3): every shape must fail
PROBE2 = Path(__file__).parent / "fixtures" / "hos_scanner_probe2_24b36d3.py.txt"


def _probe2() -> tuple[str, dict[str, str]]:
    tree = ast.parse(PROBE2.read_text(encoding="utf-8"))
    found: dict[str, object] = {}
    for node in tree.body:
        target = node.targets[0] if isinstance(node, ast.Assign) and len(node.targets) == 1 else None
        if isinstance(node, ast.Assign) and isinstance(target, ast.Name) and target.id in ("HDR", "SHAPES"):
            found[target.id] = ast.literal_eval(node.value)
    hdr, shapes = found["HDR"], found["SHAPES"]
    assert isinstance(hdr, str) and isinstance(shapes, dict)
    return hdr, shapes


PROBE2_HDR, PROBE2_SHAPES = _probe2()


def test_probe2_has_all_31_shapes():
    assert len(PROBE2_SHAPES) == 31


@pytest.mark.parametrize("name", sorted(PROBE2_SHAPES))
def test_probe2_shape_fails(name):
    """Same harness as HoS's probe (header + body, gateway.py for _Store shapes), but only violations on the shape's
    own lines count, so the header's own `import keyring` (keys.py-only) can't make a shape pass by accident."""
    fn = "gateway.py" if "store" in name else "zz_probe.py"
    first_body_line = PROBE2_HDR.count("\n") + 1
    v = [x for x in scan(PROBE2_HDR + PROBE2_SHAPES[name], fn) if x.line >= first_body_line]
    assert v, f"{name} passed the scan"


@pytest.mark.parametrize(
    "src",
    [
        "import re\ndef f():\n    return re\n",
        "import re\nx = {'m': re}\n",
        "import re\nprint(re)\n",
        "import re\nfrom typing import cast, Any\nx = cast(Any, re)\n",
        "import re\nfor m in (re,):\n    pass\n",
        "import re\nclass K:\n    m = re\n",
        "from . import net\nx = net\n",
        "h = hasattr\n",
        "def f(x):\n    return getattr(x, 'set_password')\n",
        "def f(x):\n    return getattr(x, 'write_text')\n",
        "def f(x):\n    return getattr(x, 'sys')\n",
        "def f(x):\n    return getattr(x, 'n', default=None)\n",
        "import re\ndef f():\n    return getattr(re, 'compile')\n",
        "def f(o):\n    o.execvpe('a', [], {})\n",
        "def f(o):\n    o.spawnlp(0, 'a')\n",
        "def f(o):\n    o.posix_spawnp('a', [], {})\n",
        "def f(o):\n    o.removedirs('a')\n",
        "def f(o):\n    o.makedirs('a')\n",
        "def f(o):\n    o.delete_password('s', 'n')\n",
        "def f(t):\n    return t.replace('a', 'b')\n",
        "def f(o):\n    return '{}'.format_map(o)\n",
        "import httpx\n",
        "from keyring import get_password\n",
    ],
)
def test_alias_and_glob_shapes_fail(src):
    assert scan(src), src


def test_store_dir_is_fixed_after_init():
    src = "class _Store:\n    def __init__(self, d):\n        self._dir = d\n    def audio(self):\n        self._dir = 1\n"
    v = scan(src, "gateway.py")
    assert [x.rule for x in v] == ["protected-attr"] and v[0].line == 5


def test_str_replace_still_allowed_at_its_call_site():
    assert not scan("def scrub(text, s):\n    return text.replace(s, '*')\n", "redact.py")


# ---------------------------------------------------------------- HoS's probe3 (f23ebd9): every shape must fail
PROBE3 = Path(__file__).parent / "fixtures" / "hos_scanner_probe3_f23ebd9.py.txt"


def _probe3() -> dict[str, tuple[str, str, str]]:
    """name -> (filename, header, body), resolving the HDR/KHDR names exactly as the probe's run() does."""
    tree = ast.parse(PROBE3.read_text(encoding="utf-8"))
    consts: dict[str, str] = {}
    tables: dict[str, ast.Dict] = {}
    for node in tree.body:
        target = node.targets[0] if isinstance(node, ast.Assign) and len(node.targets) == 1 else None
        if not (isinstance(node, ast.Assign) and isinstance(target, ast.Name)):
            continue
        if target.id in ("HDR", "KHDR"):
            consts[target.id] = ast.literal_eval(node.value)
        elif target.id in ("P2", "P3") and isinstance(node.value, ast.Dict):
            tables[target.id] = node.value
    out: dict[str, tuple[str, str, str]] = {}
    for table in tables.values():
        for k, v in zip(table.keys, table.values, strict=True):
            assert isinstance(k, ast.Constant) and isinstance(v, ast.Tuple)
            hdr_name, body = v.elts
            assert isinstance(hdr_name, ast.Name)
            name, hdr = k.value, consts[hdr_name.id]
            fn = "gateway.py" if name.startswith("store") else ("keys.py" if hdr_name.id == "KHDR" else "zz_probe.py")
            out[name] = (fn, hdr, ast.literal_eval(body))
    return out


PROBE3_SHAPES = _probe3()


def test_probe3_has_all_shapes():
    assert len(PROBE3_SHAPES) == 54  # 13 re-headed probe2 shapes + 41 new ones
    assert sum(n.startswith("p2_") for n in PROBE3_SHAPES) == 13


@pytest.mark.parametrize("name", sorted(PROBE3_SHAPES))
def test_probe3_shape_fails(name):
    fn, hdr, body = PROBE3_SHAPES[name]
    first_body_line = hdr.count("\n") + 1
    v = [x for x in scan(hdr + body, fn) if x.line >= first_body_line and x.rule != "import-home"]
    assert v, f"{name} passed the scan"


@pytest.mark.parametrize(
    "src",
    [
        "def f(g):\n    return g.ag_frame\n",
        "def f(g):\n    return g.gi_yieldfrom\n",
        "def f(fr):\n    return fr.f_locals\n",
        "def f(c):\n    return c.co_names\n",
        "def f(tb):\n    return tb.tb_next\n",
        "def f(e):\n    return e.with_traceback(None)\n",
        "def f(d):\n    return d.get('__builtins__')\n",
        "def f(d):\n    return d['__import__']\n",
        "def f(p):\n    return p.copy_into('/tmp')\n",
        "def f(p):\n    return p.move_into('/tmp')\n",
        "def f(t):\n    return t._client\n",
        "def f(t):\n    return getattr(t, '_client')\n",
        "def f(t):\n    return t._transport._pool\n",
        "x = print\n",
        "def f():\n    return (p := help)\n",
        "def f(x):\n    return '%s' % x\n",
        "@property\n@functools_wraps\ndef f():\n    pass\n",
        "class X(object, metaclass=type):\n    pass\n",
        "class X(dict, total=False):\n    pass\n",
        "async def f():\n    pass\n",
    ],
)
def test_frame_and_round4_shapes_fail(src):
    assert scan(src), src


def test_transport_private_client_is_fine_inside_net():
    assert not scan("def f(self):\n    return self._client.close()\n", "net.py")


def test_allowlist_is_pure_data():
    """allowlist.py is exempt from the dunder-string rule, so it may hold nothing but literal policy data."""
    tree = ast.parse((VOICE_DIR / "allowlist.py").read_text(encoding="utf-8"))
    allowed_calls = {"frozenset", "tuple"}
    for node in tree.body:
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant):
            continue  # docstring
        if isinstance(node, ast.ImportFrom) and node.module == "__future__":
            continue
        assert isinstance(node, ast.Assign | ast.AnnAssign), ast.dump(node)[:80]
        assert node.value is not None
        for sub in ast.walk(node.value):  # annotations (frozenset[str]...) are not executed values
            if isinstance(sub, ast.Call):
                assert isinstance(sub.func, ast.Name) and sub.func.id in allowed_calls, ast.unparse(sub)
            assert not isinstance(sub, ast.Lambda | ast.Attribute | ast.Subscript | ast.NamedExpr), ast.unparse(sub)


def test_runtime_bytecode_names_no_frame_walks_or_banned_names():
    """Runtime half of B1'': compile-time names in every voice function (co_names, recursively through nested code
    objects) contain no frame/traceback/code attribute, banned attribute or banned builtin, and no voice module or
    class holds a frame, generator, coroutine, traceback or code object."""
    code = r"""
import importlib, inspect, json, re, sys, types
from aai.voice import allowlist as A
bad = []
pats = [re.compile(p) for p in A.BANNED_ATTR_PATTERNS]
# co_names mixes globals and attribute names, so bare-name bans that are also allowlisted module attributes
# (re.compile, wave.open) are left to the AST scan, which can tell them apart.
legit_attrs = set().union(*A.MODULE_ATTR_ALLOWLIST.values()) | set(A.GUARDED_ATTRS)
def banned(n):
    return (n in A.BANNED_NAMES and n not in legit_attrs) or n in A.BANNED_ATTRS or any(p.search(n) for p in pats)
def walk(co, where):
    for n in co.co_names:
        if banned(n):
            bad.append(f"{where}: {n}")
    for c in co.co_consts:
        if isinstance(c, types.CodeType):
            walk(c, f"{where}.{c.co_name}")
live = (types.FrameType, types.GeneratorType, types.CoroutineType, types.AsyncGeneratorType,
        types.TracebackType, types.CodeType)
for short in sys.argv[1].split(","):
    m = importlib.import_module("aai.voice." + short)
    walk(compile(open(m.__file__, encoding="utf-8").read(), m.__file__, "exec"), short)
    for k, v in vars(m).items():
        items = [(k, v)]
        if inspect.isclass(v) and v.__module__ == m.__name__:
            items += [(f"{k}.{ck}", cv) for ck, cv in vars(v).items()]
        for name, obj in items:
            if isinstance(obj, live):
                bad.append(f"{short}.{name} is a {type(obj).__name__}")
print(json.dumps(bad))
"""
    mods = sorted(m for m in MODS if m not in ("__init__", "allowlist"))
    out = subprocess.run(
        [sys.executable, "-c", code, ",".join(mods)],
        cwd=REPO_ROOT, capture_output=True, text=True, timeout=60, check=False,
    )  # fmt: skip
    assert out.returncode == 0, out.stderr
    bad = json.loads(out.stdout.strip().splitlines()[-1])
    assert not bad, bad


def test_allowed_top_level_matches_modules():
    assert {m.split(".")[0] for m in allowlist.ALLOWED_MODULES} == allowlist.ALLOWED_TOP_LEVEL
