import pytest

from piano_coach.exercise import ExerciseSpec
from piano_coach.lesson.actions import validate_action


def test_action_validation_allows_only_implemented_state_actions():
    action = validate_action({"type": "start_exercise", "exercise": {"measures": [1, 4], "hand": "right", "tempoPercent": 60, "mode": "wait", "loop": 1, "metronome": True}}, "planning", measure_count=8)
    assert action.exercise.measures == (1, 4)
    with pytest.raises(ValueError):
        validate_action({"type": "replan"}, "reviewing")
    with pytest.raises(ValueError):
        validate_action({"type": "next"}, "practicing", current_spec=ExerciseSpec(measures=(1, 1), hand="right", tempoPercent=60, mode="wait", loop=1, metronome=True))


def test_retry_accepts_a_validated_delta():
    original = ExerciseSpec(measures=(1, 4), hand="right", tempoPercent=60, mode="play", loop=1, metronome=True)
    action = validate_action({"type": "retry", "exercise": {"tempoPercent": 45}}, "reviewing", current_spec=original)
    assert action.exercise.tempoPercent == 45
