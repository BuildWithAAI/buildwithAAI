"""Deterministic scanner package identity, without Git, environment or secrets."""
import hashlib
from pathlib import Path
from . import __version__


def package_identity(root=None):
    root = Path(root) if root is not None else Path(__file__).parent
    result = {"version": __version__, "scope": "SCANNER_PACKAGE_CONTENTS", "status": "UNVERIFIED",
              "sha256": None, "note": "Package bytes at process startup; not a Git SHA, signature or deployment attestation"}
    try:
        paths = sorted(set(root.rglob("*.py")) | {root / "static" / name for name in ("index.html", "app.js", "app.css")})
        if not 4 <= len(paths) <= 128 or root / "__init__.py" not in paths:
            return result
        digest, total = hashlib.sha256(), 0
        for path in paths:
            if path.is_symlink() or not path.is_file():
                return result
            raw = path.read_bytes()
            total += len(raw)
            if total > 2_000_000:
                return result
            relative = path.relative_to(root).as_posix().encode("utf-8")
            digest.update(relative + b"\0" + str(len(raw)).encode("ascii") + b"\0" + raw)
        result.update(status="AVAILABLE", sha256=digest.hexdigest())
    except (OSError, ValueError):
        pass
    return result
