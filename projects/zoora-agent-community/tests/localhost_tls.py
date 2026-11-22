"""Loopback certificate for tests. The private key is created here and never committed.

The HTTPS fixture and the CLI subprocesses it launches must present and trust the
same certificate. A process-local key made the server and the child disagree, so
the child reported BRIDGE_UNAVAILABLE instead of the provider status under test.
"""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

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


def _directory() -> Path:
    configured = os.environ.get("ZOORA_LOCALHOST_TLS_DIR")
    if configured:
        path = Path(configured)
    else:
        try:
            owner = str(os.getuid())
        except AttributeError:
            owner = os.environ.get("USERNAME") or os.environ.get("USER") or "local"
        path = Path(tempfile.gettempdir()) / ("zoora-localhost-tls-" + owner)
    path.mkdir(parents=True, exist_ok=True)
    if os.name == "posix":
        os.chmod(path, 0o700)
    return path


def _lock(path: Path):
    deadline = time.monotonic() + 30
    while True:
        try:
            return os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            try:
                stale = time.time() - path.stat().st_mtime > 60
            except FileNotFoundError:
                continue
            if stale:
                try:
                    path.unlink()
                except FileNotFoundError:
                    pass
                continue
            if time.monotonic() > deadline:
                raise TimeoutError("loopback test certificate lock") from None
            time.sleep(0.05)


def _public_key(openssl: str, args: list[str]) -> bytes | None:
    result = subprocess.run([openssl, *args], capture_output=True, timeout=15, check=False)
    if result.returncode != 0:
        return None
    return result.stdout.replace(b"\r\n", b"\n")


def _usable(openssl: str, cert: Path, key: Path) -> bool:
    if not cert.is_file() or not key.is_file():
        return False
    if not (0 < cert.stat().st_size <= 20000 and 0 < key.stat().st_size <= 20000):
        return False
    names = _public_key(openssl, ["x509", "-in", str(cert), "-noout", "-ext", "subjectAltName"])
    cert_pub = _public_key(openssl, ["x509", "-in", str(cert), "-noout", "-pubkey"])
    key_pub = _public_key(openssl, ["pkey", "-in", str(key), "-pubout"])
    if names is None or cert_pub is None or key_pub is None or cert_pub != key_pub:
        return False
    text = names.decode("ascii", "replace")
    if "127.0.0.1" not in text or "localhost" not in text:
        return False
    remaining = subprocess.run(
        [openssl, "x509", "-in", str(cert), "-noout", "-checkend", "3600"],
        capture_output=True,
        timeout=15,
        check=False,
    )
    return remaining.returncode == 0


def _generate(openssl: str, cert: Path, key: Path) -> None:
    directory = cert.parent
    temporary = Path(tempfile.mkdtemp(prefix="new-", dir=directory))
    try:
        pending_key = temporary / "key.pem"
        pending_cert = temporary / "cert.pem"
        subprocess.run(
            [
                openssl, "req", "-x509", "-newkey", "rsa:2048",
                "-keyout", str(pending_key), "-out", str(pending_cert),
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
            os.chmod(pending_key, 0o600)
        os.replace(pending_cert, cert)
        os.replace(pending_key, key)
        if os.name == "posix":
            os.chmod(key, 0o600)
    finally:
        shutil.rmtree(temporary, ignore_errors=True)


def ensure_localhost_tls() -> tuple[Path, Path]:
    """Return one cert and key for 127.0.0.1 and localhost, shared by subprocesses."""
    global _CACHE
    if _CACHE is not None and _CACHE[0].is_file() and _CACHE[1].is_file():
        return _CACHE
    openssl = _openssl()
    directory = _directory()
    cert = directory / "localhost-cert.pem"
    key = directory / "localhost-key.pem"
    lock = directory / ".lock"
    fd = _lock(lock)
    try:
        if not _usable(openssl, cert, key):
            _generate(openssl, cert, key)
        _CACHE = (cert, key)
        return _CACHE
    finally:
        os.close(fd)
        try:
            lock.unlink()
        except FileNotFoundError:
            pass
