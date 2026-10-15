from __future__ import annotations

import hashlib
import json
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from piano_coach.score.model import Finger, Hand, ScoreModel


_RHYTHM_BEATS = {"q": 1.0, "e": 0.5, "h": 2.0, "r": 1.0}
_MAJOR_INTERVALS = {
    "C": (0, 2, 4, 5, 7, 9, 11, 12),
    "G": (0, 2, 4, 5, 7, 9, 11, 12),
    "F": (0, 2, 4, 5, 7, 9, 10, 12),
    "D": (0, 2, 4, 5, 7, 9, 11, 12),
}


class DrillSpec(BaseModel):
    """A score-independent, short technical exercise.

    The meter is owned by ``ScoreModel`` rather than the wire format, so the
    exact one-bar check for a rhythm drill is deliberately done by the builder.
    This model still rejects malformed patterns before they reach the builder.
    """

    kind: Literal["five_finger", "rhythm", "scale"]
    startPitch: int
    key: Literal["C", "G", "F", "D"] = "C"
    rhythm: str | None = None
    bars: int

    @field_validator("startPitch")
    @classmethod
    def pitch_range(cls, value: int) -> int:
        if not 21 <= value <= 108:
            raise ValueError("startPitch must be 21..108")
        return value

    @field_validator("bars")
    @classmethod
    def bars_range(cls, value: int) -> int:
        if not 1 <= value <= 4:
            raise ValueError("bars must be 1..4")
        return value

    @model_validator(mode="after")
    def valid_rhythm(self) -> "DrillSpec":
        if self.kind == "rhythm" and (not self.rhythm or not self.rhythm.split()):
            raise ValueError("rhythm drill needs rhythm")
        if self.rhythm:
            unknown = set(self.rhythm.split()) - set(_RHYTHM_BEATS)
            if unknown:
                raise ValueError("rhythm must contain only q, e, h, r")
        return self

    def rhythm_tokens(self) -> list[str]:
        return self.rhythm.split() if self.rhythm else []


class ExerciseSpec(BaseModel):
    measures: tuple[int, int]
    hand: Literal["right", "left", "both"]
    tempoPercent: int
    mode: Literal["watch", "wait", "play"]
    loop: int
    metronome: bool
    focus: str | None = None
    drill: DrillSpec | None = None

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
        if spec.drill:
            return self._build_drill(score, spec, version)
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

    def _build_drill(self, score: ScoreModel, spec: ExerciseSpec, version: int) -> ExerciseTimeline:
        """Expand a DrillSpec into ordinary timeline notes.

        ``bars`` repeats the selected drill phrase.  For rhythm drills that
        phrase is exactly one score bar; five-finger and scale drills retain
        their natural quarter-note phrase length.
        """
        assert spec.drill is not None
        drill = spec.drill
        beats_per_bar = score.timeSignature.num * 4 / score.timeSignature.den
        if drill.kind == "rhythm":
            tokens = drill.rhythm_tokens()
            if abs(sum(_RHYTHM_BEATS[token] for token in tokens) - beats_per_bar) > 1e-9:
                raise ValueError("rhythm pattern must fill exactly one measure")

        hand: Hand = "right" if spec.hand == "both" else spec.hand
        phrase: list[tuple[int | None, float, Finger]]
        if drill.kind == "five_finger":
            pitches = [drill.startPitch + interval for interval in _MAJOR_INTERVALS[drill.key][:5]]
            fingers: list[Finger] = ([1, 2, 3, 4, 5, 4, 3, 2, 1] if hand == "right"
                                      else [5, 4, 3, 2, 1, 2, 3, 4, 5])
            phrase = [(pitch, 1.0, finger) for pitch, finger in zip(pitches + pitches[-2::-1], fingers, strict=True)]
        elif drill.kind == "scale":
            ascending = [drill.startPitch + interval for interval in _MAJOR_INTERVALS[drill.key]]
            pitches = ascending + ascending[::-1]  # Include the top tonic in both directions.
            fingers = ([1, 2, 3, 1, 2, 3, 4, 5, 5, 4, 3, 2, 1, 3, 2, 1] if hand == "right"
                       else [5, 4, 3, 2, 1, 3, 2, 1, 1, 2, 3, 1, 2, 3, 4, 5])
            phrase = [(pitch, 1.0, finger) for pitch, finger in zip(pitches, fingers, strict=True)]
        else:
            phrase = [(None if token == "r" else drill.startPitch, _RHYTHM_BEATS[token], 3) for token in drill.rhythm_tokens()]

        # A source note identifies a position in one unlooped exercise.  Rest
        # positions advance time but intentionally do not consume an ID.
        base: list[tuple[str, int, float, float, Finger]] = []
        source_number, cursor = 1, 0.0
        scale_events: list[FingeringEvent] = []
        for _bar in range(drill.bars):
            previous_finger: Finger | None = None
            for pitch, duration, finger in phrase:
                if pitch is not None:
                    source_id = f"D-{source_number:04d}"
                    source_number += 1
                    measure = int(cursor // beats_per_bar) + 1
                    base.append((source_id, pitch, cursor, duration, finger))
                    # The prescribed scale fingerings cross the thumb at the
                    # 1/3 changes; no events are made for other drill kinds.
                    if drill.kind == "scale" and {previous_finger, finger} == {1, 3}:
                        scale_events.append(FingeringEvent(noteId=source_id, type="thumb_under", measure=measure, tip="親指をくぐらせよう"))
                previous_finger = finger
                cursor += duration

        if not base:
            raise ValueError("exercise contains no notes")
        bpm = score.bpm * spec.tempoPercent / 100
        ms_per_beat = 60_000 / bpm
        timeline_notes = [
            TimelineNote(playId=f"{source_id}#{loop_index}", sourceNoteId=source_id,
                measure=int(start // beats_per_bar) + 1, loopIndex=loop_index, pitch=pitch,
                startMs=(start + loop_index * cursor) * ms_per_beat, durationMs=duration * ms_per_beat,
                hand=hand, finger=finger)
            for loop_index in range(spec.loop)
            for source_id, pitch, start, duration, finger in base
        ]
        payload = json.dumps({"spec": spec.model_dump(mode="json"), "v": version}, sort_keys=True)
        return ExerciseTimeline(
            exerciseId=hashlib.sha256(payload.encode()).hexdigest()[:12], exerciseVersion=version,
            spec=spec, bpm=bpm, beatsPerMeasure=score.timeSignature.num,
            countInMs=beats_per_bar * ms_per_beat, notes=timeline_notes, fingeringEvents=scale_events,
        )
