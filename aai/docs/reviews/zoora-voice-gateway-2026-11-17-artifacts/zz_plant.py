"""Planted bypasses: every one of these passes the static deny-list scan."""
from __future__ import annotations

import logging.config
import pathlib
import typing
import urllib.request


def a() -> object:  # dynamic import through getattr on builtins (no __import__ Name call)
    b = __builtins__ if isinstance(__builtins__, dict) else vars(__builtins__)
    return b["__imp" + "ort__"]("subprocess")


def b2() -> object:  # getattr chain
    import io
    return getattr(getattr(io, "__builtins__", {}), "get", lambda *_: None)("__import__")


def c() -> None:  # string-based dynamic import via logging.config factory
    logging.config.dictConfig({"version": 1, "handlers": {"h": {"()": "aai.ledger.PaperLedger"}}})


def d() -> bytes:  # arbitrary file read / any-scheme fetch via allowlisted urllib
    return urllib.request.urlopen("file:///etc/hostname").read()


def e() -> None:  # file write via allowlisted pathlib
    pathlib.Path("/tmp/voice-plant/PWNED").write_text("x")


def f() -> object:  # eval of a string through typing
    def g(x: "__import__('os').system('true')") -> None: ...
    return typing.get_type_hints(g)
