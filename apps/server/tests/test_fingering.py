from piano_coach.score.fingering import validate_fingering
from piano_coach.score.model import ScoreNote


def note(id: str, pitch: int, tick: int, hand: str = "right") -> ScoreNote:
    return ScoreNote(id=id, pitch=pitch, startTick=tick, durationTick=120, hand=hand, measure=1, beat=1)


def test_fingering_validator_detects_chord_order_and_fast_same_finger():
    notes = [note("R-1", 60, 0), note("R-2", 64, 0), note("R-3", 65, 120)]
    violations = validate_fingering(notes, {"R-1": 3, "R-2": 2, "R-3": 2})
    reasons = {violation.reason for violation in violations}
    assert "finger order contradicts pitch" in reasons
    assert "same finger repeated faster than an eighth note" in reasons


def test_fingering_validator_accepts_simple_scale():
    notes = [note("R-1", 60, 0), note("R-2", 62, 480), note("R-3", 64, 960)]
    assert validate_fingering(notes, {"R-1": 1, "R-2": 2, "R-3": 3}) == []
