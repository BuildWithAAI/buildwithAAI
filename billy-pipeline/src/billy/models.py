"""Core data contracts shared by every stage."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Side = Literal["long", "short"]
ScenarioSide = Literal["long", "short", "flat"]
Cond = Literal["above", "below"]
Kind = Literal["breakout", "retest", "sideways"]
ParseStatus = Literal["actionable", "no_trade", "unparsed", "not_outlook"]


class Post(BaseModel):
    id: str
    created_at: datetime
    text: str
    url: str
    source: str = "unknown"
    metrics: dict | None = None

    @property
    def id_int(self) -> int:
        return int(self.id)


class Scenario(BaseModel):
    """One conditional branch of an outlook, e.g. 'Holding above $X will offer a long towards $Y'."""

    side: ScenarioSide
    cond: Cond
    level: float
    target: float | None = None
    kind: Kind = "breakout"
    explicit: bool = False  # the sentence literally says "long"/"short"
    sentence: str = ""


class StatedPosition(BaseModel):
    """Present-tense description of where price is, e.g. 'is holding above $53.50'."""

    relation: Literal["above", "below", "near"]
    level: float


class Signal(BaseModel):
    post_id: str
    asset: str
    post_ts: datetime
    url: str
    close_label: str
    bias: int = 0  # -2..+2 from his close label
    parse_status: ParseStatus
    direction: ScenarioSide | None = None  # primary scenario side
    trigger: float | None = None
    targets: list[float] = Field(default_factory=list)
    invalidation: float | None = None
    condition_type: Kind | None = None
    scenarios: list[Scenario] = Field(default_factory=list)
    supports: list[float] = Field(default_factory=list)
    resistances: list[float] = Field(default_factory=list)
    stated_positions: list[StatedPosition] = Field(default_factory=list)
    flags: dict[str, bool] = Field(default_factory=dict)
    text: str = ""
