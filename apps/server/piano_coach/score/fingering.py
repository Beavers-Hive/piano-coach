from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from collections.abc import Awaitable, Callable
from typing import Any, Iterable

from piano_coach.exercise.builder import FingeringEvent
from piano_coach.score.model import ScoreNote

# Conservative semitone reach by pair; unspecified pairs use the largest safe common reach.
REACH = {(1, 1): 0, (1, 2): 7, (1, 3): 9, (1, 4): 10, (1, 5): 12,
         (2, 2): 0, (2, 3): 4, (2, 4): 5, (2, 5): 7,
         (3, 3): 0, (3, 4): 3, (3, 5): 5, (4, 4): 0, (4, 5): 3, (5, 5): 0}


@dataclass(frozen=True)
class FingeringViolation:
    note_id: str
    reason: str


def _crosses_wrongly(hand: str, previous_pitch: int, pitch: int, previous_finger: int, finger: int) -> bool:
    """音の進む向きと指番号の向きが逆なのに、親指くぐり・指越えになっていないか。

    右手は高い音ほど大きい指番号（左手は逆）。向きが逆になってよいのは、
    親指が他の指の下をくぐる（次の指が 1）か、指が親指を越える（前の指が 1）ときだけ。
    """
    if pitch == previous_pitch or finger == previous_finger:
        return False
    pitch_up = pitch > previous_pitch
    finger_up = finger > previous_finger
    natural = pitch_up == finger_up if hand == "right" else pitch_up != finger_up
    if natural:
        return False
    return not (finger == 1 or previous_finger == 1)


def validate_fingering(notes: Iterable[ScoreNote], fingers: dict[str, int]) -> list[FingeringViolation]:
    notes = sorted(notes, key=lambda note: (note.hand, note.startTick, note.pitch))
    errors: list[FingeringViolation] = []
    by_hand: dict[str, list[ScoreNote]] = defaultdict(list)
    for note in notes:
        finger = fingers.get(note.id)
        if finger not in (1, 2, 3, 4, 5):
            errors.append(FingeringViolation(note.id, "finger must be 1..5"))
        by_hand[note.hand].append(note)
    for hand, hand_notes in by_hand.items():
        chords: dict[int, list[ScoreNote]] = defaultdict(list)
        for note in hand_notes:
            chords[note.startTick].append(note)
        for chord in chords.values():
            ordered = sorted(chord, key=lambda note: note.pitch)
            used = [fingers.get(note.id) for note in ordered]
            if len(set(used)) != len(used):
                errors.extend(FingeringViolation(note.id, "duplicate finger in chord") for note in ordered)
            expected = sorted(used, reverse=hand == "left")
            if used != expected:
                errors.extend(FingeringViolation(note.id, "finger order contradicts pitch") for note in ordered)
        sequence = [note for note in hand_notes if fingers.get(note.id) in (1, 2, 3, 4, 5)]
        for previous, current in zip(sequence, sequence[1:]):
            if previous.startTick == current.startTick:
                continue
            a, b = fingers[previous.id], fingers[current.id]
            distance = abs(current.pitch - previous.pitch)
            if distance > REACH[tuple(sorted((a, b)))]:
                errors.append(FingeringViolation(current.id, "finger stretch exceeds reach"))
            if _crosses_wrongly(hand, previous.pitch, current.pitch, a, b):
                errors.append(FingeringViolation(current.id, "finger order contradicts melodic direction"))
            if a == b and previous.pitch != current.pitch and current.startTick - previous.startTick < 240:
                errors.append(FingeringViolation(current.id, "same finger repeated faster than an eighth note"))
    return errors


def parsed_fingering(payload: dict, notes: list[ScoreNote]) -> tuple[dict[str, int], list[FingeringEvent]]:
    known_ids = {note.id for note in notes}
    fingers = {item["id"]: item["finger"] for item in payload.get("fingering", []) if item.get("id") in known_ids}
    events = [FingeringEvent.model_validate(event) for event in payload.get("events", []) if event.get("noteId") in known_ids]
    return fingers, events


FingeringRequest = Callable[[str, list[FingeringViolation]], Awaitable[dict[str, Any]]]
FingeringUpdate = Callable[[dict[str, Any]], Awaitable[None]]


def compact_fingering_input(notes: list[ScoreNote], key_fifths: int, bpm: float) -> str:
    """The intentionally compact per-measure form from DESIGN §8.3."""
    key_names = {-7: "Cb", -6: "Gb", -5: "Db", -4: "Ab", -3: "Eb", -2: "Bb", -1: "F", 0: "C", 1: "G", 2: "D", 3: "A", 4: "E", 5: "B", 6: "F#", 7: "C#"}
    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    lines = [f"key: {key_names.get(key_fifths, 'C')} major, time: 3/4, tempo: {round(bpm)}"]
    for hand in ("right", "left"):
        grouped: dict[int, list[ScoreNote]] = defaultdict(list)
        for note in notes:
            if note.hand == hand:
                grouped[note.measure].append(note)
        if grouped:
            measures = []
            for measure, entries in grouped.items():
                body = " | ".join(f"{note.id} {names[note.pitch % 12]}{note.pitch // 12 - 1} b{note.beat:g} dur={note.durationTick / 480:g}" for note in entries)
                measures.append(f"m{measure}: {body}")
            lines.append(f"[{hand.upper()}] " + " ; ".join(measures))
    return "\n".join(lines)


class FingeringEstimator:
    """Generate bounded four-bar batches from the start; permit one repair per batch."""
    def __init__(self, request: FingeringRequest, emit: FingeringUpdate) -> None:
        self.request, self.emit = request, emit

    async def estimate(self, score_notes: list[ScoreNote], key_fifths: int, bpm: float) -> None:
        max_measure = max((note.measure for note in score_notes), default=0)
        ranges = [(start, min(start + 3, max_measure)) for start in range(1, max_measure + 1, 4)]
        for start, end in ranges:
            if start > end:
                continue
            notes = [note for note in score_notes if start <= note.measure <= end]
            if not notes:
                continue
            violations: list[FingeringViolation] = []
            fingers: dict[str, int] = {}
            events: list[FingeringEvent] = []
            for attempt in range(2):
                prompt = compact_fingering_input(notes, key_fifths, bpm)
                if violations:
                    prompt += "\nrepair these violations: " + "; ".join(f"{item.note_id}: {item.reason}" for item in violations)
                payload = await self.request(prompt, violations)
                fingers, events = parsed_fingering(payload, notes)
                violations = validate_fingering(notes, fingers)
                if not violations:
                    break
            invalid_ids = {item.note_id for item in violations}
            updates = []
            for note in notes:
                finger = fingers.get(note.id)
                if finger not in (1, 2, 3, 4, 5):
                    # A visible but deliberately marked fallback; the agent gets only one repair pass.
                    finger = 1 if note.hand == "right" else 5
                    invalid_ids.add(note.id)
                note.finger = finger
                note.fingerSource = "estimated" if note.id in invalid_ids else "agent"
                updates.append({"id": note.id, "finger": finger, "source": note.fingerSource})
            await self.emit({"fingers": updates, "events": [event.model_dump() for event in events], "done": end == max_measure})
