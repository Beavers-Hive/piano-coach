"""Run exactly once manually: lesson first turn plus Minuet bars 1--8 fingering."""
from __future__ import annotations

import asyncio
import os
from pathlib import Path

from piano_coach.brain import ActionReady, BrainError, ClaudeBrain, SayDelta
from piano_coach.brain.base import format_message
from piano_coach.score.fingering import compact_fingering_input
from piano_coach.score.importer import import_score


async def main() -> None:
    if os.environ.get("ANTHROPIC_API_KEY"):
        raise SystemExit("Unset ANTHROPIC_API_KEY; this smoke uses Claude subscription login.")
    score = import_score(Path(__file__).resolve().parents[3] / "assets/scores/minuet-g")
    brain = ClaudeBrain()
    try:
        await brain.open()
        action = None
        async for event in brain.send(format_message("SONG_LOADED", {"title": score.title, "timeSignature": score.timeSignature.model_dump(), "bpm": score.bpm, "measureCount": len(score.measures), "sections": [{"name": "全体", "measures": [1, len(score.measures)]}], "notesPerMeasure": []})):
            if isinstance(event, SayDelta): print(event.text, end="", flush=True)
            elif isinstance(event, ActionReady): action = event.action
            elif isinstance(event, BrainError): raise RuntimeError(event.reason)
        if not action or action.get("type") != "ask": raise RuntimeError(f"SONG_LOADED did not yield ask: {action}")
        notes = [note for note in score.notes if note.measure <= 8]
        result = await ClaudeBrain.design_fingering(compact_fingering_input(notes, score.keyFifths, score.bpm))
        if len(result.get("fingering", [])) < len(notes): raise RuntimeError("fingering omitted notes")
        print(f"\nsmoke OK: ask + {len(result['fingering'])} fingerings")
    finally:
        await brain.close()


if __name__ == "__main__":
    asyncio.run(main())
