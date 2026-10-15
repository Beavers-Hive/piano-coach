from pathlib import Path
from xml.etree import ElementTree as ET

from music21 import articulations, chord, converter, key, meter
import pytest

from piano_coach.exercise import DrillSpec, ExerciseBuilder, ExerciseSpec
from piano_coach.exercise.notation import timeline_to_musicxml
from piano_coach.exercise.registry import ExerciseTimelineCache
from piano_coach.score import import_score


@pytest.fixture
def score():
    return import_score(Path(__file__).parents[3] / "assets/scores/minuet-g")


def render(timeline, score):
    return timeline_to_musicxml(timeline, key_fifths=score.keyFifths,
                                time_signature_num=score.timeSignature.num,
                                time_signature_den=score.timeSignature.den)


def note_pitches(parsed) -> list[int]:
    pitches = []
    for item in parsed.recurse().notes:
        if isinstance(item, chord.Chord):
            pitches.extend(pitch.midi for pitch in item.pitches)
        else:
            pitches.append(item.pitch.midi)
    return pitches


def test_musicxml_round_trip_keeps_one_loop_pitches_meter_key_and_fingers(score):
    timeline = ExerciseBuilder().build(score, ExerciseSpec(measures=(1, 8), hand="both", tempoPercent=100,
        mode="wait", loop=2, metronome=True), version=1)
    right_note = next(item for item in timeline.notes if item.loopIndex == 0 and item.hand == "right")
    right_note.finger = 3
    xml = render(timeline, score)
    root = ET.fromstring(xml)
    assert len(root.findall("part")) == 1
    assert root.findtext(".//staves") == "2"
    assert [item.attrib.get("number") for item in root.findall(".//clef")] == ["1", "2"]
    assert float(root.find(".//sound").attrib["tempo"]) == timeline.bpm

    parsed = converter.parseData(xml.decode("utf-8"), format="musicxml")
    expected = [item.pitch for item in timeline.notes if item.loopIndex == 0]
    assert sorted(note_pitches(parsed)) == sorted(expected)
    assert len(parsed.parts[0].getElementsByClass("Measure")) == 8
    assert parsed.recurse().getElementsByClass(meter.TimeSignature).first().ratioString == "3/4"
    assert parsed.recurse().getElementsByClass(key.KeySignature).first().sharps == score.keyFifths
    fingers = [item.fingerNumber for current in parsed.recurse().notes for item in current.articulations
               if isinstance(item, articulations.Fingering)]
    assert 3 in fingers


def test_right_hand_exercise_still_has_a_full_rest_left_staff(score):
    timeline = ExerciseBuilder().build(score, ExerciseSpec(measures=(1, 2), hand="right", tempoPercent=70,
        mode="wait", loop=1, metronome=True), version=1)
    xml = render(timeline, score)
    root = ET.fromstring(xml)
    assert len(root.findall("part")) == 1
    left_rests = root.findall(".//note[staff='2']/rest")
    assert left_rests


def test_exercise_timeline_cache_is_a_20_item_lru(score):
    timeline = ExerciseBuilder().build(score, ExerciseSpec(measures=(1, 1), hand="right", tempoPercent=70,
        mode="wait", loop=1, metronome=True), version=1)
    cache = ExerciseTimelineCache()
    for index in range(21):
        cache.put(timeline.model_copy(update={"exerciseId": f"exercise-{index}"}), score)
    assert cache.get("exercise-0") is None
    assert cache.get("exercise-20") is not None


@pytest.mark.parametrize("kind, drill", [
    ("five_finger", {"startPitch": 60, "bars": 1}),
    ("scale", {"startPitch": 60, "bars": 1}),
    ("rhythm", {"startPitch": 60, "bars": 2, "rhythm": "q q q"}),
])
def test_drill_musicxml_uses_its_own_key_and_starts_measure_numbers_at_one(score, kind, drill):
    spec = ExerciseSpec(measures=(99, 100), hand="right", tempoPercent=60, mode="wait", loop=2,
        metronome=True, drill=DrillSpec(kind=kind, key="F", **drill))
    timeline = ExerciseBuilder().build(score, spec, version=1)
    xml = render(timeline, score)
    root = ET.fromstring(xml)
    assert root.find("part/measure").attrib["number"] == "1"
    assert root.findtext(".//key/fifths") == "-1"
    parsed = converter.parseData(xml.decode("utf-8"), format="musicxml")
    assert note_pitches(parsed)


def test_diatonic_notes_have_no_spurious_accidentals():
    """ト長調の白鍵の音に ♮ が付かないこと（music21 が MIDI 番号から作った音に natural を付けていた）。"""
    import re
    from piano_coach.exercise.builder import ExerciseBuilder, ExerciseSpec
    from piano_coach.exercise.notation import timeline_to_musicxml
    from piano_coach.score.importer import ScoreRepository

    score = [item for item in ScoreRepository().all() if "メヌエット" in item.title][0]
    timeline = ExerciseBuilder().build(
        score, ExerciseSpec(measures=(1, 8), hand="both", tempoPercent=60, mode="wait", loop=1, metronome=True), 1
    )
    xml = timeline_to_musicxml(timeline, key_fifths=score.keyFifths, time_signature_num=3, time_signature_den=4).decode()
    assert re.findall(r"<accidental>([a-z-]+)</accidental>", xml) == []
