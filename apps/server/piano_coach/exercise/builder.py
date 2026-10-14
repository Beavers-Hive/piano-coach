from __future__ import annotations

import hashlib
import json
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from piano_coach.score.model import Finger, Hand, ScoreModel


class ExerciseSpec(BaseModel):
    measures: tuple[int, int]
    hand: Literal["right", "left", "both"]
    tempoPercent: int
    mode: Literal["watch", "wait", "play"]
    loop: int
    metronome: bool
    focus: str | None = None

    @field_validator("tempoPercent")
    @classmethod
    def tempo_range(cls, value: int) -> int:
        if not 30 <= value <= 120:
            raise ValueError("tempoPercent must be 30..120")
        return value

    @field_validator("loop")
    @classmethod
    def loop_range(cls, value: int) -> int:
        if not 1 <= value <= 4:
            raise ValueError("loop must be 1..4")
        return value

    @model_validator(mode="after")
    def measure_range(self) -> "ExerciseSpec":
        if self.measures[0] < 1 or self.measures[1] < self.measures[0]:
            raise ValueError("invalid measure range")
        return self


class TimelineNote(BaseModel):
    playId: str
    sourceNoteId: str
    measure: int
    loopIndex: int
    pitch: int
    startMs: float
    durationMs: float
    hand: Hand
    finger: Finger | None = None


class FingeringEvent(BaseModel):
    noteId: str
    type: Literal["thumb_under", "finger_over", "position_shift", "stretch"]
    measure: int
    tip: str


class ExerciseTimeline(BaseModel):
    exerciseId: str
    exerciseVersion: int
    spec: ExerciseSpec
    bpm: float
    beatsPerMeasure: int
    countInMs: float
    notes: list[TimelineNote]
    fingeringEvents: list[FingeringEvent] = Field(default_factory=list)


class ExerciseBuilder:
    def build(self, score: ScoreModel, spec: ExerciseSpec, version: int, events: list[FingeringEvent] | None = None) -> ExerciseTimeline:
        if spec.measures[1] > len(score.measures):
            raise ValueError("measure range exceeds score")
        begin, end = spec.measures
        selected = [note for note in score.notes if begin <= note.measure <= end and (spec.hand == "both" or note.hand == spec.hand)]
        if not selected:
            raise ValueError("exercise contains no notes")
        first_tick = score.measures[begin - 1].startTick
        end_tick = score.measures[end - 1].endTick
        bpm = score.bpm * spec.tempoPercent / 100
        milliseconds_per_tick = 60_000 / (bpm * 480)
        span_ms = (end_tick - first_tick) * milliseconds_per_tick
        timeline_notes: list[TimelineNote] = []
        for loop_index in range(spec.loop):
            for note in selected:
                start = max(note.startTick, first_tick)
                finish = min(note.startTick + note.durationTick, end_tick)
                timeline_notes.append(TimelineNote(playId=f"{note.id}#{loop_index}", sourceNoteId=note.id,
                    measure=note.measure, loopIndex=loop_index, pitch=note.pitch,
                    startMs=(start - first_tick) * milliseconds_per_tick + loop_index * span_ms,
                    durationMs=max(1, finish - start) * milliseconds_per_tick, hand=note.hand, finger=note.finger))
        timeline_notes.sort(key=lambda note: (note.startMs, note.pitch))
        included_ids = {note.sourceNoteId for note in timeline_notes}
        filtered_events = [event for event in events or [] if event.noteId in included_ids and begin <= event.measure <= end]
        payload = json.dumps({"spec": spec.model_dump(mode="json"), "v": version}, sort_keys=True)
        return ExerciseTimeline(exerciseId=hashlib.sha256(payload.encode()).hexdigest()[:12], exerciseVersion=version,
            spec=spec, bpm=bpm, beatsPerMeasure=score.timeSignature.num,
            countInMs=score.timeSignature.num * 60_000 / bpm, notes=timeline_notes, fingeringEvents=filtered_events)
