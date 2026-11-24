from __future__ import annotations
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parent.parent


def load_yaml(name: str) -> dict:
    p = ROOT / "config" / name
    with open(p) as f:
        return yaml.safe_load(f) or {}


def exposure() -> dict:
    return load_yaml("exposure.yaml")


def sources() -> dict:
    return load_yaml("sources.yaml")
