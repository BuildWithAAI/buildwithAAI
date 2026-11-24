"""probe2 (re-headed) + probe3 shapes against the round-3 scanner. A shape 'passes' if it has no violation."""
import sys
sys.path.insert(0, "/workspace/rev-voice3")
from pathlib import Path
from tests.voice import scanner
mods = scanner.voice_modules(Path("/workspace/rev-voice3/aai/voice"))
HDR = "from __future__ import annotations\n\nimport json\nimport logging\nimport re\nimport time\nfrom pathlib import Path\nfrom typing import Any, cast\n\n"
KHDR = "from __future__ import annotations\n\nimport keyring\nfrom typing import Any\n\n"
P2 = {
 "p2_getattr_literal_sys": (HDR, "def f() -> Any:\n    return getattr(logging, 'sys').modules.get('aai.ledger')\n"),
 "p2_alias_module_var": (HDR, "def f() -> Any:\n    m = logging\n    return m.sys\n"),
 "p2_default_arg_alias": (HDR, "def f(m: Any = logging) -> Any:\n    return m.x\n"),
 "p2_list_alias": (HDR, "def f() -> Any:\n    return [logging][0].x\n"),
 "p2_cast_alias": (HDR, "def f() -> Any:\n    return cast(Any, logging).x\n"),
 "p2_keyring_load": (KHDR, "def f() -> Any:\n    return getattr(keyring, 'core').load_keyring('aai.ledger.X')\n"),
 "p2_keyring_set": (KHDR, "def f() -> Any:\n    return keyring.get_keyring().set_password('a', 'b', 'c')\n"),
 "p2_path_replace": (HDR, "def f() -> Any:\n    return Path('/tmp/a').replace('/tmp/b')\n"),
 "p2_class_attr_getattr": (HDR, "class K:\n    g = getattr\n"),
 "p2_getattr_alias": (HDR, "def f() -> Any:\n    g = getattr\n    return g\n"),
 "p2_walrus": (HDR, "def f() -> Any:\n    return (m := logging).x\n"),
 "p2_lambda": (HDR, "F = lambda: logging\n"),
 "p2_format_globals": (HDR, "def f(x: Any) -> str:\n    return '{0.x}'.format(x)\n"),
}
P3 = {
 # frame walks (no dunder, no module) -> f_globals / f_builtins -> __import__
 "gen_gi_frame_builtins": (HDR, "def _g() -> Any:\n    yield 1\n\ndef f() -> Any:\n    return _g().gi_frame.f_builtins['__import__']('subprocess')\n"),
 "gen_gi_frame_globals": (HDR, "def _g() -> Any:\n    yield 1\n\ndef f() -> Any:\n    return _g().gi_frame.f_globals['__builtins__']['eval']('1+1')\n"),
 "gen_f_back_globals": (HDR, "def _g() -> Any:\n    yield 1\n\ndef f() -> Any:\n    it = _g()\n    next(it)\n    return it.gi_frame.f_back\n"),
 "coroutine_cr_frame": (HDR, "async def _c() -> None:\n    pass\n\ndef f() -> Any:\n    c = _c()\n    return c.cr_frame.f_builtins['compile']\n"),
 "exc_traceback_attr_via_getattr": (HDR, "def f() -> Any:\n    try:\n        1 / 0\n    except Exception as e:\n        return getattr(e, 'with_traceback')\n"),
 "tb_frame_via_tb_next": (HDR, "def f(tb: Any) -> Any:\n    return tb.tb_frame.f_globals\n"),
 "gi_code_consts": (HDR, "def _g() -> Any:\n    yield 1\n\ndef f() -> Any:\n    return _g().gi_code.co_consts\n"),
 # dunder walks
 "lambda_globals": (HDR, "def f() -> Any:\n    return (lambda: 0).__globals__['sys']\n"),
 "func_globals": (HDR, "def f() -> Any:\n    return f.__globals__\n"),
 "exc_dunder_traceback": (HDR, "def f() -> Any:\n    try:\n        1 / 0\n    except Exception as e:\n        return e.__traceback__.tb_frame\n"),
 "object_getattribute": (HDR, "def f(x: Any) -> Any:\n    return object.__getattribute__(x, 'y')\n"),
 "subclasses_via_tuple": (HDR, "def f() -> Any:\n    return ().__class__.__base__.__subclasses__()\n"),
 # string-keyed access to dunders via subscripts
 "subscript_dunder_key": (HDR, "def f(d: Any) -> Any:\n    return d['__builtins__']['__import__']\n"),
 # imports
 "operator_attrgetter": (HDR, "import operator\n"),
 "functools_reduce": (HDR, "from functools import reduce\n"),
 "importlib_spec": (HDR, "def f() -> Any:\n    return __spec__.loader\n"),
 "dunder_import_name": (HDR, "def f() -> Any:\n    return __import__\n"),
 "typing_get_type_hints_from": (HDR, "from typing import get_type_hints\n"),
 "typing_forwardref": (HDR, "import typing\n\ndef f() -> Any:\n    return typing.ForwardRef('x')\n"),
 "dataclasses_make": (HDR, "import dataclasses\n\ndef f() -> Any:\n    return dataclasses.make_dataclass('X', ['a'])\n"),
 "typeddict_functional_strings": (HDR, "from typing import TypedDict\n\nX = TypedDict('X', {'a': '__import__(\"os\").system(\"x\")'})\n"),
 "dataclass_string_field_type": (HDR, "from dataclasses import dataclass, field\n\n@dataclass\nclass X:\n    a: Any = field(default=None, metadata={'t': \"__import__('os')\"})\n"),
 # format paths
 "builtin_format_fn": (HDR, "def f(x: Any) -> str:\n    return format(x, '')\n"),
 "logging_formatter_brace_walk": (HDR, "def f(r: Any) -> str:\n    fm = logging.Formatter('{msg.__class__.__init__}', style='{', validate=False)\n    return fm.format(r)\n"),
 "percent_format_dict": (HDR, "def f(x: Any) -> str:\n    return '%(a)s' % x\n"),
 # three-arg type / class tricks
 "type_three_arg": (HDR, "def f() -> Any:\n    return type('X', (), {'g': getattr})\n"),
 "class_decorator_getattr": (HDR, "def deco(c: Any) -> Any:\n    return c\n\n@deco\nclass X:\n    pass\n"),
 "metaclass_kw": (HDR, "class M(type):\n    pass\n\nclass X(metaclass=M):\n    pass\n"),
 "class_body_exec_like": (HDR, "class X:\n    locals_ = dict\n"),
 # builtins not banned
 "help_builtin": (HDR, "def f() -> Any:\n    return help\n"),
 "memoryview_builtin": (HDR, "def f() -> Any:\n    return print('x', file=None)\n"),
 # file writes in 3.14+
 "path_copy_314": (HDR, "def f() -> Any:\n    return Path('/tmp/a').copy('/tmp/b')\n"),
 "path_move_314": (HDR, "def f() -> Any:\n    return Path('/tmp/a').move('/tmp/b')\n"),
 "path_write_via_getattr": (HDR, "def f() -> Any:\n    return getattr(Path('/tmp/a'), 'write_text')\n"),
 "path_open_via_class": (HDR, "def f() -> Any:\n    return Path.open\n"),
 "path_touch_via_getattr": (HDR, "def f() -> Any:\n    return getattr(Path('/x'), 'touch')\n"),
 # store
 "store_dir_setattr_via_dict": (HDR, "class _Store:\n    def audio(self) -> None:\n        self.__dict__['_dir'] = Path('/home')\n"),
 "store_dir_via_object_setattr": (HDR, "class _Store:\n    def audio(self) -> None:\n        object.__setattr__(self, '_dir', Path('/home'))\n"),
 "store_dir_augassign_tuple": (HDR, "class _Store:\n    def audio(self) -> None:\n        (self._dir, x) = (Path('/home'), 1)\n"),
 "store_dir_other_class": (HDR, "class Other:\n    def audio(self, s: Any) -> None:\n        s._dir = Path('/home')\n"),
 # httpx outside net.py through Transport internals
 "transport_client_any_url": (HDR, "def f(t: Any) -> Any:\n    return t._client.get('http://169.254.169.254/latest')\n"),
}
def run(shapes):
    out = {}
    for name, (hdr, body) in shapes.items():
        fn = "gateway.py" if name.startswith("store") else ("keys.py" if hdr is KHDR else "zz_probe.py")
        v = [x for x in scanner.scan_source(hdr + body, fn, mods) if x.rule != "import-home"]
        out[name] = sorted({f"{x.rule}:{x.detail}"[:70] for x in v}) or "PASSES-SCANNER"
    return out
for title, s in (("probe2", P2), ("probe3", P3)):
    print("==", title)
    for k, v in run(s).items():
        print(f"  {k:32s} {v}")
