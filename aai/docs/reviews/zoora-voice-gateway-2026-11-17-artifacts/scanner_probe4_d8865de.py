import sys
sys.path.insert(0, "/workspace/rev-voice4")
from pathlib import Path
from tests.voice import scanner
mods = scanner.voice_modules(Path("/workspace/rev-voice4/aai/voice"))
HDR = "from __future__ import annotations\n\nimport json\nimport logging\nimport re\nimport time\nfrom pathlib import Path\nfrom typing import Any, cast\n\n"
S = {
 "sys_getframe_via_logging": "def f() -> Any:\n    return logging.sys._getframe(0)\n",
 "logging_currentframe": "def f() -> Any:\n    return logging.currentframe()\n",
 "logging_findCaller": "def f() -> Any:\n    return logging.getLogger().findCaller(stack_info=True)\n",
 "logrecord_exc_info_frame": "def f(r: Any) -> Any:\n    return r.exc_info[2].tb_frame\n",
 "inspect_import": "import inspect\n",
 "inspect_from": "from inspect import currentframe\n",
 "traceback_import": "import traceback\n",
 "dunder_traceback": "def f(e: Any) -> Any:\n    return e.__traceback__\n",
 "getattr_dunder_traceback": "def f(e: Any) -> Any:\n    return getattr(e, '__traceback__')\n",
 "gi_yieldfrom": "def f(g: Any) -> Any:\n    return g.gi_yieldfrom\n",
 "cr_await": "def f(c: Any) -> Any:\n    return c.cr_await\n",
 "ag_await": "def f(c: Any) -> Any:\n    return c.ag_await\n",
 "gi_running_harmless": "def f(g: Any) -> Any:\n    return g.gi_running\n",
 "reduce_ex": "def f(x: Any) -> Any:\n    return x.__reduce_ex__(2)\n",
 "getstate": "def f(x: Any) -> Any:\n    return x.__getstate__()\n",
 "dunder_subscript": "def f(d: Any) -> Any:\n    return d['__import__']\n",
 "dunder_concat_subscript": "def f(d: Any) -> Any:\n    return d['__imp' + 'ort__']\n",
 "dunder_join_subscript": "def f(d: Any) -> Any:\n    return d[''.join(['__', 'import', '__'])]\n",
 "dunder_dict_get": "def f(d: Any) -> Any:\n    return d.get('__builtins__')\n",
 "dunder_dict_get_concat": "def f(d: Any) -> Any:\n    return d.get('_' + '_builtins__')\n",
 "getattr_concat_name": "def f(x: Any) -> Any:\n    return getattr(x, 'gi_' + 'frame')\n",
 "re_sub_build_name": "def f(d: Any) -> Any:\n    return d[re.sub('x', '_', 'xximportxx')]\n",
 "json_loads_name": "def f(d: Any) -> Any:\n    return d[json.loads('\"__import__\"')]\n",
 "bytes_decode_name": "def f(d: Any) -> Any:\n    return d[bytes([95, 95]).decode() + 'import__']\n",
 "chr_name": "def f(d: Any) -> Any:\n    return d[chr(95) * 2 + 'import' + chr(95) * 2]\n",
 "exc_args_frame_harmless": "def f() -> Any:\n    try:\n        1 / 0\n    except Exception as e:\n        return e.args\n",
 "sys_exc_info_via_logging": "def f() -> Any:\n    return logging.sys.exc_info()\n",
 "threading_stack": "import threading\n\ndef f() -> Any:\n    return threading.current_thread()\n",
 "threading_settrace": "import threading\n\ndef f() -> Any:\n    return threading.settrace(print)\n",
 "async_gen": "async def g() -> Any:\n    yield 1\n",
 "lambda_gen_frame": "def f() -> Any:\n    return (x for x in [1]).gi_frame\n",
 "vars_like_dict": "def f(x: Any) -> Any:\n    return x.__dict__\n",
}
bad_passes = []
for name, body in S.items():
    v = [x for x in scanner.scan_source(HDR + body, "zz_probe.py", mods) if x.rule != "import-home"]
    r = sorted({f"{x.rule}:{x.detail}"[:60] for x in v}) or "PASSES-SCANNER"
    print(f"  {name:28s} {r}")
