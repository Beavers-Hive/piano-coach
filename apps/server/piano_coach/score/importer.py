from __future__ import annotations

import hashlib
import re
from collections import defaultdict
from pathlib import Path

import mido
import pypdfium2 as pdfium

from piano_coach.paths import ASSETS_DIR, DATA_DIR, ensure_data_dirs
from piano_coach.score.model import Measure, ScoreModel, ScoreNote, TimeSignature


def _header_value(source: Path, name: str, default: str) -> str:
    if not source.exists():
        return default
    match = re.search(rf'^\s*{re.escape(name)}\s*=\s*"([^"]+)"', source.read_text(errors="replace"), re.M)
    return match.group(1).strip() if match else default


def _song_id(pdf: Path) -> str:
    return hashlib.sha256(pdf.read_bytes()).hexdigest()[:12]


def _rescale(value: int, source_ppq: int) -> int:
    return round(value * 480 / source_ppq)


def _read_meta(score_dir: Path) -> dict:
    meta_path = score_dir / "meta.json"
    if not meta_path.is_file():
        return {}
    import json
    return json.loads(meta_path.read_text(encoding="utf-8"))


def import_score(score_dir: Path) -> ScoreModel:
    """Build the small, contract-defined score representation from tracks 1 and 2."""
    midi_path = next(score_dir.glob("*.mid"))
    pdf_path = next(score_dir.glob("*.pdf"))
    ly_paths = list(score_dir.glob("*.ly"))
    ly_path = ly_paths[0] if ly_paths else Path()
    midi = mido.MidiFile(midi_path)
    ppq = midi.ticks_per_beat
    title = _header_value(ly_path, "title", score_dir.name)
    composer = _header_value(ly_path, "composer", "Unknown")
    # meta.json があれば、表示用の日本語の曲名と作曲者で上書きする
    meta = _read_meta(score_dir)
    title = meta.get("title", title)
    composer = meta.get("composer", composer)
    bpm, numerator, denominator, fifths = 120.0, 4, 4, 0
    for track in midi.tracks:
        for message in track:
            if message.type == "set_tempo":
                bpm = round(mido.tempo2bpm(message.tempo), 3)
                break
        else:
            continue
        break
    for track in midi.tracks:
        for message in track:
            if message.type == "time_signature":
                numerator, denominator = message.numerator, message.denominator
            elif message.type == "key_signature":
                key = message.key.rstrip("m")
                fifths = {"Cb": -7, "Gb": -6, "Db": -5, "Ab": -4, "Eb": -3, "Bb": -2, "F": -1,
                          "C": 0, "G": 1, "D": 2, "A": 3, "E": 4, "B": 5, "F#": 6, "C#": 7}.get(key, 0)
    notes: list[ScoreNote] = []
    # Mutopia files include a conductor/meta track at index 0; musical tracks are 1 and 2.
    for track_index, hand, prefix in ((1, "right", "R"), (2, "left", "L")):
        if track_index >= len(midi.tracks):
            continue
        absolute = 0
        pending: dict[tuple[int, int], list[int]] = defaultdict(list)
        raw: list[tuple[int, int, int]] = []
        for message in midi.tracks[track_index]:
            absolute += message.time
            if message.type == "note_on" and message.velocity > 0:
                pending[(message.channel, message.note)].append(absolute)
            elif message.type in ("note_off", "note_on") and (message.type == "note_off" or message.velocity == 0):
                starts = pending[(message.channel, message.note)]
                if starts:
                    raw.append((starts.pop(0), absolute, message.note))
        raw.sort(key=lambda row: (row[0], row[2]))
        for index, (start, end, pitch) in enumerate(raw, 1):
            start_tick, end_tick = _rescale(start, ppq), _rescale(end, ppq)
            ticks_per_measure = 480 * numerator * 4 // denominator
            measure = start_tick // ticks_per_measure + 1
            beat = (start_tick % ticks_per_measure) / 480 + 1
            notes.append(ScoreNote(id=f"{prefix}-{index:04d}", pitch=pitch, startTick=start_tick,
                                   durationTick=max(1, end_tick - start_tick), hand=hand,
                                   measure=measure, beat=beat))
    notes.sort(key=lambda note: (note.startTick, note.hand, note.pitch))
    last_tick = max((note.startTick + note.durationTick for note in notes), default=0)
    ticks_per_measure = 480 * numerator * 4 // denominator
    measure_count = max(1, (last_tick + ticks_per_measure - 1) // ticks_per_measure)
    measures = [Measure(index=i, startTick=(i - 1) * ticks_per_measure, endTick=i * ticks_per_measure)
                for i in range(1, measure_count + 1)]
    return ScoreModel(songId=_song_id(pdf_path), title=title, composer=composer, timeSignature=TimeSignature(num=numerator, den=denominator),
                      bpm=bpm, keyFifths=fifths, measures=measures, notes=notes)


def rasterize_pages(pdf_path: Path, song_id: str) -> list[Path]:
    ensure_data_dirs()
    page_dir = DATA_DIR / "songs" / song_id / "pages"
    page_dir.mkdir(parents=True, exist_ok=True)
    document = pdfium.PdfDocument(pdf_path)
    paths: list[Path] = []
    for index in range(len(document)):
        output = page_dir / f"{index + 1}.png"
        if not output.exists():
            bitmap = document[index].render(scale=150 / 72)
            bitmap.to_pil().save(output)
        paths.append(output)
    return paths


class ScoreRepository:
    def __init__(self, assets_dir: Path = ASSETS_DIR) -> None:
        self.assets_dir = assets_dir
        self._scores: dict[str, ScoreModel] = {}

    def all(self) -> list[ScoreModel]:
        if not self._scores:
            # meta.json の order の順（デモ曲を先頭に）。order がなければ名前順で後ろに並べる
            for directory in sorted((path for path in self.assets_dir.iterdir() if path.is_dir()), key=lambda path: (_read_meta(path).get("order", 999), path.name)):
                if list(directory.glob("*.mid")) and list(directory.glob("*.pdf")):
                    score = import_score(directory)
                    self._scores[score.songId] = score
        return list(self._scores.values())

    def get(self, song_id: str) -> ScoreModel | None:
        return next((score for score in self.all() if score.songId == song_id), None)

    def source_pdf(self, song_id: str) -> Path | None:
        for directory in self.assets_dir.iterdir():
            for pdf in directory.glob("*.pdf"):
                if _song_id(pdf) == song_id:
                    return pdf
        return None
