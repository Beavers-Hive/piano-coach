from pathlib import Path

import pytest

from piano_coach.exercise import DrillSpec, ExerciseBuilder, ExerciseSpec
from piano_coach.lesson.actions import validate_action
from piano_coach.lesson.orchestrator import LessonOrchestrator
from piano_coach.score import import_score


@pytest.fixture
def score():
    return import_score(Path(__file__).parents[3] / "assets/scores/minuet-g")


def drill_spec(kind: str, **drill) -> ExerciseSpec:
    return ExerciseSpec(
        # Drill exercises deliberately ignore this otherwise-invalid-for-the
        # current score range.  It makes that contract explicit in the test.
        measures=(99, 100), hand="right", tempoPercent=60, mode="wait", loop=1, metronome=True,
        drill=DrillSpec(kind=kind, startPitch=60, bars=1, **drill),
    )


def test_five_finger_drill_creates_notes_and_prescribed_fingers(score):
    spec = drill_spec("five_finger")
    timeline = ExerciseBuilder().build(score, spec, version=1)
    assert [note.pitch for note in timeline.notes] == [60, 62, 64, 65, 67, 65, 64, 62, 60]
    assert [note.finger for note in timeline.notes] == [1, 2, 3, 4, 5, 4, 3, 2, 1]
    assert [note.sourceNoteId for note in timeline.notes] == [f"D-{index:04d}" for index in range(1, 10)]
    repeated = spec.model_copy(update={"loop": 2, "drill": spec.drill.model_copy(update={"bars": 2})})
    repeated_timeline = ExerciseBuilder().build(score, repeated, version=1)
    assert len(repeated_timeline.notes) == 9 * 2 * 2  # phrase × bars × loop
    assert {note.loopIndex for note in repeated_timeline.notes} == {0, 1}


def test_scale_drill_adds_thumb_under_events_and_left_fingering(score):
    spec = drill_spec("scale").model_copy(update={"hand": "left"})
    timeline = ExerciseBuilder().build(score, spec, version=1)
    assert len(timeline.notes) == 16
    assert [note.finger for note in timeline.notes] == [5, 4, 3, 2, 1, 3, 2, 1, 1, 2, 3, 1, 2, 3, 4, 5]
    assert timeline.fingeringEvents
    assert {event.type for event in timeline.fingeringEvents} == {"thumb_under"}
    assert {event.tip for event in timeline.fingeringEvents} == {"親指をくぐらせよう"}


def test_rhythm_drill_uses_rests_without_notes_and_checks_score_meter(score):
    spec = drill_spec("rhythm", rhythm="q r q")
    timeline = ExerciseBuilder().build(score, spec, version=1)
    assert [(note.pitch, note.startMs, note.durationMs, note.finger) for note in timeline.notes] == [
        (60, 0.0, pytest.approx(60_000 / 84), 3),
        (60, pytest.approx(2 * 60_000 / 84), pytest.approx(60_000 / 84), 3),
    ]
    invalid = drill_spec("rhythm", rhythm="q q e e q")
    with pytest.raises(ValueError, match="fill exactly one measure"):
        ExerciseBuilder().build(score, invalid, version=1)


def test_drill_action_ignores_measures_but_watch_is_still_rejected():
    raw = drill_spec("five_finger").model_dump(mode="json")
    action = validate_action({"type": "start_exercise", "exercise": raw}, "planning", measure_count=1)
    assert action.exercise and action.exercise.drill and action.exercise.measures == (99, 100)
    retry = validate_action({"type": "retry", "exercise": raw}, "reviewing", current_spec=ExerciseSpec.model_validate(raw), measure_count=1)
    assert retry.exercise and retry.exercise.drill
    with pytest.raises(ValueError, match="watch requires demo"):
        validate_action({"type": "start_exercise", "exercise": {**raw, "mode": "watch"}}, "planning", measure_count=1)


@pytest.mark.asyncio
async def test_fallback_changes_to_drill_after_two_poor_attempts_and_returns(score):
    sent = []

    async def send(kind, payload):
        sent.append((kind, payload))

    lesson = LessonOrchestrator(send)
    lesson.score = score
    original = ExerciseSpec(measures=(1, 2), hand="right", tempoPercent=60, mode="wait", loop=1, metronome=True)
    assert await lesson.prepare_exercise(original)

    async def submit(perfect: int, total: int = 10):
        assert lesson.timeline
        await lesson.submit_attempt({"exerciseId": lesson.timeline.exerciseId, "exerciseVersion": lesson.exercise_version,
            "summary": {"total": total, "perfect": perfect, "good": 0, "miss": total - perfect, "extra": 0,
                        "timingMeanMs": None, "timingStdMs": None, "perMeasure": [], "aborted": False}})

    await submit(6)
    assert lesson.timeline and lesson.timeline.spec.drill is None
    await submit(6)
    assert lesson.timeline and lesson.timeline.spec.drill is not None
    assert lesson.timeline.spec.drill.kind == "five_finger"
    await submit(10)
    assert lesson.timeline and lesson.timeline.spec.drill is None
    assert lesson.timeline.spec.measures == (1, 2)
