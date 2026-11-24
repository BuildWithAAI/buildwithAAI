"""Static deny-list policy for aai.voice, enforced by tests/voice/scanner.py + tests/voice/test_denylist.py.

Zoora voice must never reach trade, spend, transfer, signer, ledger-write or world-edit code, run processes,
import things by string, eval strings, fetch arbitrary URLs/schemes, or write files (except the opt-in _Store).
Allowlisting is by exact dotted module, not top-level package: ``urllib.parse`` is allowed, ``urllib.request`` is
not; ``logging`` is allowed, ``logging.config`` is not.
"""

from __future__ import annotations

# Exact modules any aai.voice module may import (``import X`` or ``from X import name``).
ALLOWED_MODULES: frozenset[str] = frozenset(
    {
        "__future__",
        "base64",
        "collections.abc",
        "contextlib",
        "dataclasses",
        "hmac",
        "io",
        "json",
        "logging",
        "math",
        "pathlib",
        "re",
        "threading",
        "time",
        "typing",
        "urllib.parse",
        "wave",
        "httpx",
        "keyring",
    }
)

# Kept for compatibility with earlier tooling: the top-level names of ALLOWED_MODULES.
ALLOWED_TOP_LEVEL: frozenset[str] = frozenset(
    {
        "__future__", "base64", "collections", "contextlib", "dataclasses", "hmac", "httpx", "io", "json",
        "keyring", "logging", "math", "pathlib", "re", "threading", "time", "typing", "urllib", "wave",
    }
)  # fmt: skip

# The only first-party package voice may import is itself.
SELF_PACKAGE = "aai.voice"

# Exact names that may be imported with ``from X import ...`` (every allowlisted module is listed; anything
# else, e.g. typing.get_type_hints or contextlib.redirect_stdout, is refused).
RESTRICTED_FROM_IMPORTS: dict[str, frozenset[str]] = {
    "__future__": frozenset({"annotations"}),
    "collections.abc": frozenset({"Callable", "Iterator", "Mapping", "Sequence"}),
    "contextlib": frozenset({"contextmanager"}),
    "dataclasses": frozenset({"dataclass", "field"}),
    "pathlib": frozenset({"Path"}),
    "typing": frozenset({"Any", "Protocol", "TypedDict", "TYPE_CHECKING", "cast"}),
    "urllib.parse": frozenset({"urlsplit"}),
}
# Modules that may only be used via ``import X`` + ``X.attr`` (no ``from X import``).
NO_FROM_IMPORT: frozenset[str] = frozenset(
    {"base64", "hmac", "httpx", "io", "json", "keyring", "logging", "math", "re", "threading", "time", "wave"}
)

# Bare names that may never appear (loaded, called or subscripted) in voice code.
BANNED_NAMES: frozenset[str] = frozenset(
    {
        "__builtins__",
        "__import__",
        "__loader__",
        "__spec__",
        "builtins",
        "globals",
        "vars",
        "locals",
        "eval",
        "exec",
        "compile",
        "breakpoint",
        "input",
        "open",
        "setattr",
        "delattr",
        # string formatting / interactive builtins nothing in voice needs
        "format",
        "print",
        "help",
        "memoryview",
        "exit",
        "quit",
        "copyright",
        "credits",
        "license",
    }
)

# getattr/hasattr are allowed only with a plain identifier string literal (not a dunder) as the 2nd argument.
LITERAL_ONLY_CALLS: frozenset[str] = frozenset({"getattr", "hasattr"})

# Attribute names that may never be accessed, on anything.
BANNED_ATTRS: frozenset[str] = frozenset(
    {
        # string-driven import / eval
        "dictConfig",
        "fileConfig",
        "listen",
        "get_type_hints",
        "import_module",
        "__import__",
        # fetching arbitrary URLs / schemes outside httpx
        "urlopen",
        "urlretrieve",
        "build_opener",
        # processes
        "system",
        "popen",
        "Popen",
        "spawnv",
        "spawnl",
        "startfile",
        "execv",
        "execl",
        "fork",
        # logging to files
        "basicConfig",
        "FileHandler",
        "RotatingFileHandler",
        "TimedRotatingFileHandler",
        # raw file access
        "FileIO",
        "read_text",
        "read_bytes",
        "rmdir",
        "touch",
        "symlink_to",
        "hardlink_to",
        "chmod",
        "rename",
        "unlink",
        "remove",
        "removedirs",
        "makedirs",
        # module hops: logging.sys / pathlib.os / keyring.core -> sys.modules, os.*, load_keyring(<dotted path>)
        "sys",
        "os",
        "modules",
        "core",
        "load_keyring",
        # keyring writes (voice only ever reads keys)
        "set_password",
        "delete_password",
        # introspection / string-driven attribute walks
        "mro",
        "format",
        "format_map",
        # frame / traceback walks (the regexes below cover gi_frame, f_builtins, f_globals, tb_frame, co_consts...)
        "tb_next",
        "with_traceback",
    }
)

# Regexes over attribute names (the glob families posix_spawn*, exec*p*, spawn*p, plus exec[lv]*/spawn[lv]*).
BANNED_ATTR_PATTERNS: tuple[str, ...] = (
    r"^posix_spawn",
    r"^exec.*p",
    r"^exec[lv]",
    r"^spawn",
    # generator/coroutine/async-gen frames and code, traceback frames, frame and code object fields:
    # gi_frame.f_builtins['__import__'], cr_frame, ag_frame, tb_frame.f_globals, f_back, gi_code.co_consts ...
    r"^(gi|cr|ag|tb|f|co)_",
)

# File-write/open attributes: banned except at the explicit call sites below.
# ``replace`` is here because Path.replace moves files; str.replace stays usable at the listed call sites.
# copy/move/copy_into/move_into are Path file operations on Python 3.14+ (no call site is allowlisted).
GUARDED_ATTRS: frozenset[str] = frozenset(
    {"open", "write_text", "write_bytes", "mkdir", "replace", "copy", "move", "copy_into", "move_into"}
)

# (file, enclosing qualname, exact call target source) -> the only places a GUARDED_ATTRS call may appear.
CALLSITE_ALLOWLIST: frozenset[tuple[str, str, str]] = frozenset(
    {
        ("gateway.py", "_wav_duration", "wave.open"),  # parses an in-memory BytesIO, never a path
        ("gateway.py", "_Store.transcript", "self._dir.mkdir"),
        ("gateway.py", "_Store.transcript", "(self._dir / 'transcripts.jsonl').open"),
        ("gateway.py", "_Store.audio", "self._dir.mkdir"),
        ("gateway.py", "_Store.audio", "(self._dir / f'ptt-{time.time_ns()}.bin').write_bytes"),
        ("redact.py", "scrub", "text.replace"),  # str.replace on the text being redacted
    }
)

# Attributes that may only be assigned (or deleted) at these (file, qualname) sites: _Store's target directory is
# fixed at construction, so a method can't retarget the allowlisted write sites (`self._dir = Path("/home")`).
PROTECTED_STORE_ATTRS: dict[str, frozenset[tuple[str, str]]] = {
    "_dir": frozenset({("gateway.py", "_Store.__init__")}),
}

# Private attributes that may only be touched in these files: Transport's httpx client (and httpx internals) stay
# inside net.py, so no other module can send an arbitrary request around Transport.request's checks.
PRIVATE_ATTR_HOMES: dict[str, frozenset[str]] = {
    "_client": frozenset({"net.py"}),
    "_transport": frozenset({"net.py"}),
    "_pool": frozenset({"net.py"}),
    "_mounts": frozenset({"net.py"}),
}

# The only decorators voice code may use (by name, bare or called). Class decorators, metaclasses and class
# keywords can run arbitrary code at class creation, so classes take no keywords at all.
ALLOWED_DECORATORS: frozenset[str] = frozenset(
    {"dataclass", "contextmanager", "classmethod", "staticmethod", "property"}
)

# Top-level packages that only one voice file may import: all network I/O goes through net.py, all keyring
# access through keys.py.
IMPORT_ONLY_IN: dict[str, frozenset[str]] = {
    "httpx": frozenset({"net.py"}),
    "keyring": frozenset({"keys.py"}),
}

# ``X.attr`` on an imported module name X is restricted to exactly these attributes (blocks logging.config,
# urllib.request, keyring.core.load_keyring(<dotted path>), io.open, typing.get_type_hints, ...).
MODULE_ATTR_ALLOWLIST: dict[str, frozenset[str]] = {
    "base64": frozenset({"b64decode", "b64encode"}),
    "hmac": frozenset({"compare_digest"}),
    "httpx": frozenset(
        {"Client", "Timeout", "TimeoutException", "HTTPError", "Limits", "HTTPTransport", "MockTransport"}
    ),
    "io": frozenset({"BytesIO"}),
    "json": frozenset({"dumps", "loads"}),
    "keyring": frozenset({"get_password", "get_keyring"}),
    "logging": frozenset({"getLogger", "Filter", "Formatter", "LogRecord", "Logger", "WARNING", "INFO", "DEBUG"}),
    "math": frozenset({"isfinite"}),
    "re": frozenset({"compile", "sub", "IGNORECASE", "Pattern", "Match"}),
    "threading": frozenset({"Lock", "local", "Timer"}),
    "time": frozenset({"monotonic", "time", "time_ns"}),
    "urllib": frozenset({"parse"}),
    "wave": frozenset({"open", "Error"}),
    "typing": frozenset({"TYPE_CHECKING", "Any", "cast"}),
    "pathlib": frozenset({"Path"}),
    "contextlib": frozenset({"contextmanager"}),
    "dataclasses": frozenset({"dataclass", "field"}),
}

# Dunder attributes that are allowed (everything else shaped __x__ is refused: __subclasses__, __globals__...).
ALLOWED_DUNDER_ATTRS: frozenset[str] = frozenset({"__name__", "__module__"})

# Any import whose dotted name matches this (case-insensitive) fails the static scan, even if allowlisted.
DENY_PATTERN = r"trade|spend|transfer|signer|ledger|wallet|world|chunk|economy|payment"
