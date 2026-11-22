"""Paper-trading council. Market rows are inputs, not votes.

Primary voter is FlyVis. The crow memory heuristic votes beside it. The
hemibrain first brain joins only after admission() accepts its graph pin,
feature_loader path, and receipt. Until then its score is shadow-only.

second_brain, third_brain, and tape_brain are test fixtures.
"""
from __future__ import annotations

PRIMARY = "flyvis"
FIXTURES = ("second_brain", "third_brain", "tape_brain")


def roster() -> dict:
    from .first_brain import admission

    gate = admission()
    members = [PRIMARY, "crow"]
    if gate["ready"]:
        members.append("hemibrain")
    return {
        "primary": PRIMARY,
        "members": tuple(members),
        "fixtures": FIXTURES,
        "hemibrain": gate,
        "market_data_role": "INPUT_NOT_A_VOTE",
        "action": "NO_EXECUTION",
        "execution_allowed": False,
    }
