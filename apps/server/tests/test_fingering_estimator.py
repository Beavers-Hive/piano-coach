import pytest

from piano_coach.score.fingering import FingeringEstimator
from piano_coach.score.model import ScoreNote


@pytest.mark.asyncio
async def test_estimator_sends_first_eight_bars_before_rest():
    notes = [ScoreNote(id="R-1", pitch=60, startTick=0, durationTick=480, hand="right", measure=1, beat=1),
             ScoreNote(id="R-2", pitch=62, startTick=480, durationTick=480, hand="right", measure=9, beat=1)]
    calls, updates = [], []
    async def request(prompt, _violations):
        calls.append(prompt)
        ids = ["R-1"] if "m1:" in prompt else ["R-2"]
        return {"fingering": [{"id": note_id, "finger": 1} for note_id in ids], "events": []}
    async def emit(update):
        updates.append(update)
    await FingeringEstimator(request, emit).estimate(notes, 0, 100)
    assert len(calls) == 2
    assert updates[0]["done"] is False and updates[1]["done"] is True


@pytest.mark.asyncio
async def test_long_score_is_split_into_bounded_batches():
    import re
    notes = [ScoreNote(id=f"R-{measure}", pitch=60, startTick=(measure-1)*1440,
                      durationTick=480, hand="right", measure=measure, beat=1)
             for measure in range(1, 18)]
    batches, updates = [], []
    async def request(prompt, _violations):
        ids = re.findall(r"R-\d+", prompt)
        batches.append(ids)
        assert len(ids) <= 4, "long scores must not become one unbounded model request"
        return {"fingering": [{"id": note_id, "finger": 1} for note_id in ids], "events": []}
    async def emit(update):
        updates.append(update)
    await FingeringEstimator(request, emit).estimate(notes, 0, 100)
    assert [item for batch in batches for item in batch] == [note.id for note in notes]
    assert not any(update["done"] for update in updates[:-1])
    assert updates[-1]["done"]
