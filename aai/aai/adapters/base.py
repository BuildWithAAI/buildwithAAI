from __future__ import annotations
import time


class AdapterError(RuntimeError):
    pass


class Adapter:
    name = "base"
    sector = None
    placeholder = False

    def __init__(self, cfg: dict, store=None):
        self.cfg, self.store = cfg, store

    def health(self) -> dict:
        raise NotImplementedError


class Placeholder(Adapter):
    """Clearly-marked not-built adapter. health() reports not_configured, never fake data."""
    placeholder = True

    def __init__(self, name, sector, why, cfg=None, store=None):
        super().__init__(cfg or {}, store)
        self.name, self.sector, self.why = name, sector, why

    def health(self) -> dict:
        return {"ok": None, "status": "not_configured", "detail": self.why, "checked_at": time.time()}
