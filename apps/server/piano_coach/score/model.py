from __future__ import annotations

from typing import Literal
from pydantic import BaseModel, Field

Hand = Literal["right", "left"]
Finger = Literal[1, 2, 3, 4, 5]


class ScoreNote(BaseModel):
    id: str
    pitch: int
    startTick: int
    durationTick: int
    hand: Hand
    measure: int
    beat: float
    finger: Finger | None = None
    fingerSource: Literal["agent", "estimated"] | None = None


class Measure(BaseModel):
    index: int
    startTick: int
    endTick: int


class TimeSignature(BaseModel):
    num: int
    den: int


class ScoreModel(BaseModel):
    songId: str
    title: str
    composer: str
    ppq: Literal[480] = 480
    timeSignature: TimeSignature
    bpm: float
    keyFifths: int
    measures: list[Measure]
    notes: list[ScoreNote] = Field(default_factory=list)
