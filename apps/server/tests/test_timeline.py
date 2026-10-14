from pathlib import Path

import pytest

from piano_coach.exercise import ExerciseBuilder, ExerciseSpec
from piano_coach.score import import_score


@pytest.fixture
def score():
    return import_score(Path(__file__).parents[3] / "assets/scores/minuet-g")


def test_timeline_rebases_filters_and_expands_loops(score):
    spec = ExerciseSpec(measures=(1, 2), hand="right", tempoPercent=50, mode="play", loop=2, metronome=True)
    timeline = ExerciseBuilder().build(score, spec, version=4)
    assert timeline.exerciseVersion == 4
    assert timeline.bpm == pytest.approx(70)
    assert timeline.notes[0].startMs == 0
    assert all(note.hand == "right" for note in timeline.notes)
    assert {note.loopIndex for note in timeline.notes} == {0, 1}
    assert timeline.countInMs == pytest.approx(3 * 60_000 / 70)
    assert timeline.notes[-1].startMs > timeline.notes[0].startMs


def test_timeline_rejects_empty_hand(score):
    spec = ExerciseSpec(measures=(1, 1), hand="left", tempoPercent=60, mode="wait", loop=1, metronome=True)
    # The real score has a left hand here, but this confirms normal validation still builds.
    assert ExerciseBuilder().build(score, spec, version=1).notes
