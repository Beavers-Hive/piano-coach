"""Small application-wide cache for score-mode exercise documents."""
from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass

from piano_coach.exercise.builder import ExerciseTimeline
from piano_coach.score.model import ScoreModel


@dataclass(frozen=True)
class StoredExercise:
    timeline: ExerciseTimeline
    key_fifths: int
    time_signature_num: int
    time_signature_den: int


class ExerciseTimelineCache:
    """An LRU of recent timelines, shared by every WebSocket in one app."""

    def __init__(self, capacity: int = 20) -> None:
        self.capacity = capacity
        self._entries: OrderedDict[str, StoredExercise] = OrderedDict()

    def put(self, timeline: ExerciseTimeline, score: ScoreModel) -> None:
        self._entries.pop(timeline.exerciseId, None)
        self._entries[timeline.exerciseId] = StoredExercise(
            timeline=timeline,
            key_fifths=score.keyFifths,
            time_signature_num=score.timeSignature.num,
            time_signature_den=score.timeSignature.den,
        )
        while len(self._entries) > self.capacity:
            self._entries.popitem(last=False)

    def get(self, exercise_id: str) -> StoredExercise | None:
        value = self._entries.get(exercise_id)
        if value is not None:
            self._entries.move_to_end(exercise_id)
        return value
