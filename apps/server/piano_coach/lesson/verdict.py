from __future__ import annotations

from typing import Literal
from pydantic import BaseModel

from piano_coach.exercise.builder import ExerciseSpec


class RealtimeSummary(BaseModel):
    total: int
    perfect: int
    good: int
    miss: int
    extra: int
    timingMeanMs: float | None = None
    timingStdMs: float | None = None
    perMeasure: list[dict] = []
    aborted: bool


def suggested_verdict(summary: RealtimeSummary, spec: ExerciseSpec) -> tuple[Literal["next", "retry"], ExerciseSpec]:
    accuracy = (summary.perfect + summary.good) / summary.total if summary.total else 0.0
    passed = accuracy >= .95 and summary.extra <= 2 and (spec.mode == "wait" or (summary.timingStdMs is not None and summary.timingStdMs <= 60))
    if not summary.aborted and passed:
        return "next", spec
    if accuracy < .7:
        return "retry", spec.model_copy(update={"tempoPercent": max(30, spec.tempoPercent - 15)})
    return "retry", spec
