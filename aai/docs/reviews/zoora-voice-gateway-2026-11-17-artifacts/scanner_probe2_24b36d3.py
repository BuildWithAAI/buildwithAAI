import sys, json
sys.path.insert(0, "/workspace/rev-voice2")
from pathlib import Path
sys.path.insert(0, "/workspace/rev-voice2/tests/voice")
from tests.voice import scanner
mods = scanner.voice_modules(Path("/workspace/rev-voice2/aai/voice"))
HDR = "from __future__ import annotations\n\nimport json\nimport keyring\nimport logging\nimport pathlib\nimport re\nimport time\nimport typing\nfrom pathlib import Path\nfrom typing import Any, cast\n\n"
SHAPES = {
 "getattr_literal_sys_modules": "def f() -> Any:\n    return getattr(logging, 'sys').modules.get('aai.ledger')\n",
 "alias_module_var": "def f() -> Any:\n    m = logging\n    return m.sys.modules.get('aai.ledger')\n",
 "default_arg_alias": "def f(m: Any = logging) -> Any:\n    return m.sys.modules.get('aai.ledger')\n",
 "list_subscript_alias": "def f() -> Any:\n    return [logging][0].sys.modules.get('aai.ledger')\n",
 "cast_alias": "def f() -> Any:\n    return cast(Any, logging).sys.modules.get('aai.ledger')\n",
 "keyring_load_by_string": "def f() -> Any:\n    return getattr(keyring, 'core').load_keyring('aai.ledger.PaperLedger')\n",
 "pathlib_os_spawn": "def f() -> Any:\n    return getattr(pathlib, 'os').posix_spawn('/bin/true', ['/bin/true'], {})\n",
 "os_remove_via_alias": "def f() -> Any:\n    k = pathlib\n    return k.os.remove\n",
 "path_replace_move": "def f() -> Any:\n    return Path('/tmp/a').replace('/tmp/b')\n",
 "keyring_set_password": "def f() -> Any:\n    return keyring.get_keyring().set_password('zoora-voice', 'xai-key', 'x')\n",
 "format_spec_globals_read": "def f(x: Any) -> str:\n    return '{0.__init__.__globals__}'.format(x)\n",
 "fstring_conversion": "def f(x: Any) -> str:\n    return f'{x!r:>{10}}'\n",
 "type_mro_walk": "def f() -> Any:\n    return type.mro(type)\n",
 "class_attr_call": "class K:\n    g = getattr\n\ndef f() -> Any:\n    return K.g(logging, '__dict__')\n",
 "decorator_getattr": "def f() -> Any:\n    g = getattr\n    return g(logging, 'sys')\n",
 "re_module_sys": "def f() -> Any:\n    return getattr(re, 'enum')\n",
 "json_decoder_scanner": "def f() -> Any:\n    return getattr(json, 'decoder')\n",
 "subclasses": "def f() -> Any:\n    return type(1).__subclasses__\n",
 "class_walk": "def f(x: Any) -> Any:\n    return x.__class__\n",
 "codecs_import": "import codecs\n",
 "zipimport": "import zipimport\n",
 "functools_partial": "import functools\n",
 "operator_attrgetter": "import operator\n",
 "loader": "def f() -> Any:\n    return __loader__\n",
 "aliased_store_attr": "class _Store:\n    def transcript(self) -> None:\n        w = (self._dir / 'transcripts.jsonl').open\n        w('w')\n",
 "store_dir_retarget": "class _Store:\n    def transcript(self) -> None:\n        self._dir = Path('/home/box')\n        (self._dir / 'transcripts.jsonl').open('a')\n",
 "httpx_any_url": "import httpx\n\ndef f() -> Any:\n    return httpx.Client().post\n",
 "dict_method_getattr": "def f() -> Any:\n    return logging.__dict__\n",
 "walrus_alias": "def f() -> Any:\n    return (m := logging).sys\n",
 "lambda_alias": "F = lambda: logging\n\ndef f() -> Any:\n    return F().sys.modules\n",
 "tuple_unpack_alias": "def f() -> Any:\n    (a, b) = (logging, 1)\n    return a.sys.modules\n",
}
res = {}
for name, body in SHAPES.items():
    fn = "gateway.py" if "store" in name else "zz_probe.py"
    v = scanner.scan_source(HDR + body, fn, mods)
    res[name] = [f"{x.rule}:{x.detail}" for x in v] or "PASSES-SCANNER"
for k, v in res.items():
    print(f"{k:28s} {v}")
