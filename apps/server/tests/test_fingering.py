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


def test_rejects_finger_order_against_melodic_direction():
    from piano_coach.score.fingering import _crosses_wrongly
    # 右手: 上行で 3→2 は不自然（親指くぐりでも指越えでもない）
    assert _crosses_wrongly("right", 64, 65, 3, 2)
    # 右手: 上行で 3→1 は親指くぐりなので許す。下行で 1→3 は指越えなので許す
    assert not _crosses_wrongly("right", 64, 65, 3, 1)
    assert not _crosses_wrongly("right", 65, 64, 1, 3)
    # 右手: 下行で番号が上がる（親指が絡まない）運指は誤り
    assert _crosses_wrongly("right", 74, 67, 2, 3)
    # 左手は向きが逆: 上行で 5→4 は自然、上行で 2→3 は誤り
    assert not _crosses_wrongly("left", 55, 57, 5, 4)
    assert _crosses_wrongly("left", 55, 57, 2, 3)
