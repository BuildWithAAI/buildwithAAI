"""A PDF-looking header is not an executable.
"""
from __future__ import annotations

import json

from .artifact_inspect import inspect


def self_check() -> dict:
    body = inspect(b"%PDF-1.4")
    if not body["hire_allowed"]:
        raise RuntimeError("PDF_REJECTED")
    return body


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
