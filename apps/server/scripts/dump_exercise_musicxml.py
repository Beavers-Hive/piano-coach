"""Write score-mode MusicXML examples for the web mock screen.

Run from apps/server:
    uv run python scripts/dump_exercise_musicxml.py
"""
from __future__ import annotations

from pathlib import Path

from piano_coach.exercise import DrillSpec, ExerciseBuilder, ExerciseSpec
from piano_coach.exercise.notation import timeline_to_musicxml
from piano_coach.paths import REPO_ROOT
from piano_coach.score import import_score


def examples() -> dict[str, ExerciseSpec]:
    common = {"tempoPercent": 70, "mode": "wait", "loop": 1, "metronome": True}
    return {
        "exercise-minuet-1-8.musicxml": ExerciseSpec(measures=(1, 8), hand="both", **common),
        "exercise-minuet-right-hand.musicxml": ExerciseSpec(measures=(1, 8), hand="right", **common),
        "exercise-drill-five-finger.musicxml": ExerciseSpec(measures=(1, 1), hand="right", **common,
            drill=DrillSpec(kind="five_finger", startPitch=67, key="G", bars=2)),
        "exercise-drill-scale.musicxml": ExerciseSpec(measures=(1, 1), hand="right", **common,
            drill=DrillSpec(kind="scale", startPitch=67, key="G", bars=1)),
        "exercise-drill-rhythm.musicxml": ExerciseSpec(measures=(1, 1), hand="right", **common,
            drill=DrillSpec(kind="rhythm", startPitch=67, bars=2, rhythm="q q q")),
    }


def main() -> None:
    score = import_score(REPO_ROOT / "assets" / "scores" / "minuet-g")
    output = REPO_ROOT / "apps" / "web" / "public" / "mock"
    output.mkdir(parents=True, exist_ok=True)
    builder = ExerciseBuilder()
    for index, (name, spec) in enumerate(examples().items(), start=1):
        timeline = builder.build(score, spec, version=index)
        musicxml = timeline_to_musicxml(timeline, key_fifths=score.keyFifths,
                                        time_signature_num=score.timeSignature.num,
                                        time_signature_den=score.timeSignature.den)
        (output / name).write_bytes(musicxml)
        print(output / name)


if __name__ == "__main__":
    main()
