"""Public, reproducible SOFTWARE TEST data. No learner or model was trained."""
from .education import Answer, Curriculum, Learner, PracticeAttempt
from .paper_school import PaperDecision, PaperMarket, PaperPolicy, Quote


def synthetic_attempt(curriculum, learner=None, track="solana", at=None):
    at = at if at is not None else curriculum.data()["reviewed_at_ms"] + 43_200_000
    return PracticeAttempt(learner or Learner("synthetic_student", "1" * 64), curriculum.sha256(),
                           track, at - 1000, at, "SYNTHETIC_FIXTURE",
                           tuple(Answer(case["case_id"], case["expected"]) for case in curriculum.cases(track)))


def paper_fixture(curriculum=None):
    curriculum = curriculum or Curriculum.load()
    attempt = synthetic_attempt(curriculum)
    at = attempt.completed_ms + 100
    market = PaperMarket("solana", "devnet", "synthetic_lab", "SYNTHETIC:BASE", "SYNTHETIC:QUOTE",
                         1, "quote_atoms", "SYNTHETIC_FIXTURE")
    policy = PaperPolicy(1_000_000, 50_000, 100_000, 500_000, 50_000, 100_000,
                         10_000, 5, 1, 100, 1000, False)
    quotes = tuple(Quote("quote_" + str(index), market.sha256(), at + index * 10, at + index * 10,
                         bid, bid + 1, 10_000, 10_000, True)
                   for index, bid in enumerate((99, 101, 110, 111, 112)))
    decisions = (PaperDecision("buy_fixture", at + 1, "BUY", 100, "quote_0"),
                 PaperDecision("sell_fixture", at + 21, "SELL", 100, "quote_2"))
    return curriculum, attempt, market, policy, quotes, decisions
