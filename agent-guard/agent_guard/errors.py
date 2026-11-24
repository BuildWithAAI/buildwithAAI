class GuardError(PermissionError):
    """Base class: any guard refusal. Callers must treat this as 'do not act'."""


class KillSwitchEngaged(GuardError):
    pass


class RiskLimitViolation(GuardError):
    pass


class ApprovalRequired(GuardError):
    pass


class MoneyMovementBlocked(GuardError):
    pass


class UntrustedContentRejected(GuardError):
    pass


class GuardConfigError(GuardError):
    pass
