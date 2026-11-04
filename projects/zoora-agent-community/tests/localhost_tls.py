"""Loopback certificate for tests. The private key is created here and never committed."""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import tempfile

_CACHE: tuple[Path, Path] | None = None


def _openssl() -> str:
    found = shutil.which("openssl")
    if found:
        return found
    if os.name == "nt":
        candidate = Path(r"C:\Program Files\Git\usr\bin\openssl.exe")
        if candidate.is_file():
            return str(candidate)
    raise RuntimeError("openssl is required to generate the loopback test certificate")


def ensure_localhost_tls() -> tuple[Path, Path]:
    """Return a process-local cert and key for 127.0.0.1 and localhost."""
    global _CACHE
    if _CACHE is not None and _CACHE[0].is_file() and _CACHE[1].is_file():
        return _CACHE
    directory = Path(tempfile.mkdtemp(prefix="zoora-localhost-tls-"))
    key = directory / "localhost-key.pem"
    cert = directory / "localhost-cert.pem"
    subprocess.run(
        [
            _openssl(), "req", "-x509", "-newkey", "rsa:2048",
            "-keyout", str(key), "-out", str(cert),
            "-days", "2", "-nodes",
            "-subj", "/CN=localhost",
            "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
            "-addext", "basicConstraints=critical,CA:TRUE",
        ],
        check=True,
        capture_output=True,
        timeout=30,
    )
    if os.name == "posix":
        os.chmod(key, 0o600)
    _CACHE = (cert, key)
    return _CACHE
