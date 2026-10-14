from pathlib import Path

from piano_coach.score import import_score


def test_minuet_midi_becomes_contract_score_model():
    score = import_score(Path(__file__).parents[3] / "assets/scores/minuet-g")
    assert score.ppq == 480
    assert score.timeSignature.num == 3
    assert len([note for note in score.notes if note.hand == "right"]) == 129
    assert len([note for note in score.notes if note.hand == "left"]) == 75
    assert min(note.id for note in score.notes if note.hand == "right") == "R-0001"
    assert score.measures[-1].index == 32
