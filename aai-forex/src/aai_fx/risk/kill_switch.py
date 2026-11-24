"""Kill switch: once engaged, every new order is rejected until manually reset.

Engaged by: (a) presence of a flag file (operator / AAI Terminal can `touch`
it), (b) programmatic trigger (e.g. drawdown breach). Reset is manual only.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path


class KillSwitch:
    def __init__(self, flag_file: str | Path | None = None) -> None:
        self.flag_file = Path(flag_file) if flag_file else None
        self._engaged = False
        self.reason: str | None = None

    @property
    def engaged(self) -> bool:
        if self._engaged:
            return True
        if self.flag_file is not None and self.flag_file.exists():
            self._engaged = True
            try:
                self.reason = json.loads(self.flag_file.read_text()).get("reason", "flag file present")
            except (ValueError, OSError):
                self.reason = "flag file present"
            return True
        return False

    def engage(self, reason: str, persist: bool = False) -> None:
        self._engaged = True
        self.reason = reason
        if persist and self.flag_file is not None:
            self.flag_file.parent.mkdir(parents=True, exist_ok=True)
            self.flag_file.write_text(json.dumps({"reason": reason, "at": datetime.now(timezone.utc).isoformat()}))

    def reset(self) -> None:
        self._engaged = False
        self.reason = None
        if self.flag_file is not None and self.flag_file.exists():
            self.flag_file.unlink()
