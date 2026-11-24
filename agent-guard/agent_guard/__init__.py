"""agent-guard: shared safety layer for the Zoorped AI-agent economy.

Import surface (stdlib only, Python >= 3.10):
    from agent_guard import check_order, OrderIntent, guard_money_movement, money_movement,
                            killswitch, wrap_untrusted, detect_injection, require_clean, safe_field,
                            audit_log, GuardError
"""
from . import audit_log, killswitch
from .errors import (ApprovalRequired, GuardConfigError, GuardError, KillSwitchEngaged, MoneyMovementBlocked,
                     RiskLimitViolation, UntrustedContentRejected)
from .money import guard_money_movement, money_movement
from .redact import fingerprint, redact
from .risk import OrderIntent, check_order
from .sanitize import detect_injection, max_severity, normalize, require_clean, safe_field, strip_instructions, wrap_untrusted

__version__ = "1.0.0"
__all__ = ["max_severity", "normalize", "audit_log", "killswitch", "check_order", "OrderIntent", "guard_money_movement", "money_movement",
           "wrap_untrusted", "detect_injection", "require_clean", "safe_field", "strip_instructions", "fingerprint",
           "redact", "GuardError", "KillSwitchEngaged", "RiskLimitViolation", "ApprovalRequired",
           "MoneyMovementBlocked", "UntrustedContentRejected", "GuardConfigError"]
