"""Render an ExerciseTimeline as a single piano part in MusicXML."""
from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from xml.etree import ElementTree as ET

from music21 import articulations, chord, clef, key, meter, note, stream, tempo, pitch
from music21.musicxml.m21ToXml import GeneralObjectExporter

from piano_coach.exercise.builder import ExerciseTimeline, TimelineNote

MUSICXML_MEDIA_TYPE = "application/vnd.recordare.musicxml+xml"


def _drill_fifths(timeline: ExerciseTimeline, fallback: int) -> int:
    drill = timeline.spec.drill
    if not drill:
        return fallback
    return {"C": 0, "G": 1, "F": -1, "D": 2}[drill.key]


def _quarter_offset(timeline_note: TimelineNote, bpm: float) -> float:
    return round(timeline_note.startMs * bpm / 60_000 * 4) / 4


def _quarter_length(timeline_note: TimelineNote, bpm: float) -> float:
    # The timeline is millisecond-based.  A sixteenth-note grid is enough for
    # tonight's MIDI material and avoids noisy floating-point tuplet output.
    raw = timeline_note.durationMs * bpm / 60_000
    return max(0.25, round(raw * 4) / 4)


def _spelled_pitch(midi: int, key_fifths: int) -> pitch.Pitch:
    """MIDI の音高を、調に合った綴りの Pitch にする。

    music21 は MIDI 番号から作った白鍵の音に「ナチュラル」を明示的に付けるため、そのまま書き出すと
    ト長調の白鍵の音すべてに ♮ が表示されていた。白鍵は臨時記号なしにし、黒鍵は調号の向き
    （♯系なら ♯、♭系なら ♭）で綴る。調号との差分の臨時記号は、makeNotation が付ける。
    """
    spelled = pitch.Pitch(midi=midi)
    if spelled.accidental is not None and spelled.accidental.name == "natural":
        spelled.accidental = None
    if key_fifths < 0 and spelled.accidental is not None and spelled.accidental.name == "sharp":
        spelled = spelled.getEnharmonic()
    return spelled


def _piano_element(notes: list[TimelineNote], bpm: float, key_fifths: int = 0):
    """Make one note or chord at an identical onset/duration."""
    if len(notes) == 1:
        item = note.Note(_spelled_pitch(notes[0].pitch, key_fifths), quarterLength=_quarter_length(notes[0], bpm))
        if notes[0].finger is not None:
            item.articulations.append(articulations.Fingering(notes[0].finger))
        return item

    item = chord.Chord(
        [_spelled_pitch(timeline_note.pitch, key_fifths) for timeline_note in notes],
        quarterLength=_quarter_length(notes[0], bpm),
    )
    # MusicXML represents a chord's technical annotations on its note heads;
    # music21 exports these chord articulations as <fingering> elements.
    for timeline_note in notes:
        if timeline_note.finger is not None:
            item.articulations.append(articulations.Fingering(timeline_note.finger))
    return item


def _staff_part(
    notes: list[TimelineNote], *, hand: str, measure_numbers: list[int], beats_per_measure: float,
    time_signature: str, key_fifths: int, bpm: float,
) -> stream.PartStaff:
    part = stream.PartStaff(id=hand)
    by_measure: dict[int, list[TimelineNote]] = defaultdict(list)
    first_number = measure_numbers[0]
    for timeline_note in notes:
        index = int(_quarter_offset(timeline_note, bpm) // beats_per_measure)
        by_measure[first_number + index].append(timeline_note)

    for index, number in enumerate(measure_numbers):
        measure = stream.Measure(number=number)
        if index == 0:
            measure.insert(0, key.KeySignature(key_fifths))
            measure.insert(0, meter.TimeSignature(time_signature))
            measure.insert(0, tempo.MetronomeMark(number=bpm))
            measure.insert(0, clef.TrebleClef() if hand == "right" else clef.BassClef())
        groups: dict[tuple[float, float], list[TimelineNote]] = defaultdict(list)
        for timeline_note in by_measure[number]:
            offset = _quarter_offset(timeline_note, bpm) - (number - first_number) * beats_per_measure
            groups[(round(offset, 6), round(_quarter_length(timeline_note, bpm), 6))].append(timeline_note)
        for (offset, _), grouped_notes in groups.items():
            measure.insert(offset, _piano_element(sorted(grouped_notes, key=lambda item: item.pitch), bpm, key_fifths))
        part.append(measure)

    # Empty staff measures and gaps are actual full rests, not omitted staves.
    part.makeRests(inPlace=True, fillGaps=True, timeRangeFromBarDuration=True)
    # This normalizes noteheads, ties and beams before export.  (Calling it on
    # the complete score after both staff parts are combined avoids tiny split
    # artifacts that PartStaff.makeNotation can create at a measure boundary.)
    return part


def _merge_staff_parts(xml: bytes, *, beats_per_measure: float) -> bytes:
    """Turn music21's two PartStaff XML parts into one MusicXML piano part.

    music21 correctly lays out/ties/beams each staff but serializes PartStaff as
    two MusicXML parts.  The score-mode contract instead requires one part with
    two staves, so merge corresponding measures with a backup between staves.
    """
    root = ET.fromstring(xml)
    part_list = root.find("part-list")
    parts = root.findall("part")
    if part_list is None or len(parts) != 2:
        raise ValueError("music21 did not produce two staff parts")
    score_parts = part_list.findall("score-part")
    first_id = parts[0].attrib["id"]
    if score_parts:
        score_parts[0].set("id", first_id)
        name = score_parts[0].find("part-name")
        if name is not None:
            name.text = ""  # 楽譜パネルではパート名を出さない
        for extra in score_parts[1:]:
            part_list.remove(extra)

    right, left = parts
    right.set("id", first_id)
    left_measures = {measure.attrib.get("number"): measure for measure in left.findall("measure")}
    for right_measure in right.findall("measure"):
        left_measure = left_measures.get(right_measure.attrib.get("number"))
        if left_measure is None:
            continue
        attributes = right_measure.find("attributes")
        left_attributes = left_measure.find("attributes")
        if attributes is not None:
            for treble_clef in attributes.findall("clef"):
                treble_clef.set("number", "1")
            staves = ET.Element("staves")
            staves.text = "2"
            attributes.append(staves)
            for staff_clef in left_attributes.findall("clef") if left_attributes is not None else []:
                bass_clef = deepcopy(staff_clef)
                bass_clef.set("number", "2")
                attributes.append(bass_clef)

        right_notes = list(right_measure.findall("note"))
        left_notes = list(left_measure.findall("note"))
        for item in right_notes:
            staff = ET.Element("staff")
            staff.text = "1"
            item.append(staff)
        if right_notes and left_notes:
            backup = ET.Element("backup")
            value = ET.SubElement(backup, "duration")
            divisions_text = (attributes.findtext("divisions") if attributes is not None else None) or "10080"
            value.text = str(round(float(divisions_text) * beats_per_measure))
            right_measure.append(backup)
        for item in left_notes:
            staff = ET.Element("staff")
            staff.text = "2"
            item.append(staff)
            right_measure.append(item)
    root.remove(left)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def timeline_to_musicxml(
    timeline: ExerciseTimeline, *, key_fifths: int, time_signature_num: int, time_signature_den: int,
) -> bytes:
    """Create contract-compliant, one-part/two-staff MusicXML for one loop."""
    beats_per_measure = time_signature_num * 4 / time_signature_den
    if timeline.spec.drill:
        first_measure = 1
        count = max((note.measure for note in timeline.notes if note.loopIndex == 0), default=1)
    else:
        first_measure = timeline.spec.measures[0]
        count = timeline.spec.measures[1] - first_measure + 1
    measure_numbers = list(range(first_measure, first_measure + count))
    one_loop = [timeline_note for timeline_note in timeline.notes if timeline_note.loopIndex == 0]
    exported_key = _drill_fifths(timeline, key_fifths)
    signature = f"{time_signature_num}/{time_signature_den}"
    right = _staff_part([item for item in one_loop if item.hand == "right"], hand="right", measure_numbers=measure_numbers,
                        beats_per_measure=beats_per_measure, time_signature=signature, key_fifths=exported_key, bpm=timeline.bpm)
    left = _staff_part([item for item in one_loop if item.hand == "left"], hand="left", measure_numbers=measure_numbers,
                       beats_per_measure=beats_per_measure, time_signature=signature, key_fifths=exported_key, bpm=timeline.bpm)
    score = stream.Score(id="exercise")
    score.insert(0, right)
    score.insert(0, left)
    score.makeNotation(inPlace=True, cautionaryNotImmediateRepeat=False)
    return _merge_staff_parts(GeneralObjectExporter(score).parse(), beats_per_measure=beats_per_measure)
