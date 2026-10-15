import asyncio
from pathlib import Path

import pytest

from piano_coach.brain.base import BrainInput
from piano_coach.exercise import ExerciseSpec
from piano_coach.lesson import orchestrator as orchestrator_module
from piano_coach.lesson.actions import validate_action
from piano_coach.lesson.orchestrator import LessonOrchestrator
from piano_coach.score import import_score


def test_watch_is_rejected_for_start_and_retry():
    watch = {"measures": [1, 2], "hand": "right", "tempoPercent": 60, "mode": "watch", "loop": 1, "metronome": True}
    with pytest.raises(ValueError, match="watch requires demo"):
        validate_action({"type": "start_exercise", "exercise": watch}, "planning", measure_count=8)
    current = ExerciseSpec.model_validate({**watch, "mode": "wait"})
    with pytest.raises(ValueError, match="watch requires demo"):
        validate_action({"type": "retry", "exercise": {"mode": "watch"}}, "reviewing", current_spec=current, measure_count=8)


def test_plan_steps_are_checked_against_score_range():
    spec = {"measures": [33, 36], "hand": "right", "tempoPercent": 60, "mode": "wait", "loop": 1, "metronome": True}
    with pytest.raises(ValueError, match="plan exercise exceeds"):
        validate_action({"type": "set_plan", "plan": {"goal": "x", "steps": [{"title": "x", "description": "x", "exercise": spec}]}}, "hearing", measure_count=32)


@pytest.mark.asyncio
async def test_failed_exercise_build_preserves_previous_version_and_timeline():
    sent = []
    async def send(kind, payload): sent.append((kind, payload))
    lesson = LessonOrchestrator(send)
    lesson.score = import_score(Path(__file__).parents[3] / "assets/scores/minuet-g")
    valid = ExerciseSpec(measures=(1, 1), hand="right", tempoPercent=60, mode="wait", loop=1, metronome=True)
    assert await lesson.prepare_exercise(valid)
    previous_version, previous_timeline = lesson.exercise_version, lesson.timeline
    invalid = valid.model_copy(update={"measures": (99, 100)})
    assert not await lesson.prepare_exercise(invalid)
    assert lesson.exercise_version == previous_version
    assert lesson.timeline is previous_timeline


class NeverRespondingBrain:
    closed = 0
    async def open(self, **_): return "never"
    async def close(self): self.closed += 1
    async def send(self, _: BrainInput):
        await asyncio.Event().wait()
        yield  # pragma: no cover

    async def analyze_pages(self, *_):
        await asyncio.Event().wait()

    async def design_fingering(self, *_):
        await asyncio.Event().wait()


class ReopeningBrain:
    instances = 0
    def __init__(self):
        type(self).instances += 1
        self.number = type(self).instances
    async def open(self, **_): return "reopened"
    async def close(self): return None
    async def send(self, _):
        if self.number == 1:
            await asyncio.Event().wait()
        else:
            from piano_coach.brain.base import ActionReady
            yield ActionReady(action={"type": "ask", "question": {"id": "q", "text": "q", "options": [], "allowFree": True}})


@pytest.mark.asyncio
async def test_brain_turn_timeout_closes_session_and_falls_back(monkeypatch):
    monkeypatch.setattr(orchestrator_module, "LESSON_TURN_TIMEOUT_S", 0.01)
    brain = NeverRespondingBrain()
    lesson = LessonOrchestrator(lambda *_: asyncio.sleep(0), brain=brain)
    assert await lesson._brain_turn("SONG_LOADED", {}) is None
    assert brain.closed == 1
    assert lesson.brain is None


@pytest.mark.asyncio
async def test_next_brain_request_reopens_session_after_timeout(monkeypatch):
    monkeypatch.setattr(orchestrator_module, "LESSON_TURN_TIMEOUT_S", 0.01)
    ReopeningBrain.instances = 0
    lesson = LessonOrchestrator(lambda *_: asyncio.sleep(0), brain=ReopeningBrain())
    lesson.state = "hearing"
    assert await lesson._brain_turn("SONG_LOADED", {}) is None
    action = await lesson._brain_turn("SONG_LOADED", {})
    assert action and action.type == "ask" and ReopeningBrain.instances == 2


@pytest.mark.asyncio
async def test_analysis_timeout_closes_brain_and_returns_fallback(monkeypatch, tmp_path):
    monkeypatch.setattr(orchestrator_module, "ANALYSIS_TIMEOUT_S", 0.01)
    monkeypatch.setattr(orchestrator_module, "DATA_DIR", tmp_path)
    brain = NeverRespondingBrain()
    lesson = LessonOrchestrator(lambda *_: asyncio.sleep(0), brain=brain)
    lesson.score = import_score(Path(__file__).parents[3] / "assets/scores/minuet-g")
    analysis = await lesson._analysis([])
    assert analysis["sections"] == [{"name": "全体", "measures": [1, 32]}]
    assert brain.closed == 1 and lesson.brain is None


@pytest.mark.asyncio
async def test_fingering_chunk_timeout_closes_brain(monkeypatch, tmp_path):
    monkeypatch.setattr(orchestrator_module, "FINGERING_CHUNK_TIMEOUT_S", 0.01)
    monkeypatch.setattr(orchestrator_module, "DATA_DIR", tmp_path)
    brain = NeverRespondingBrain()
    lesson = LessonOrchestrator(lambda *_: asyncio.sleep(0), brain=brain)
    lesson.score = import_score(Path(__file__).parents[3] / "assets/scores/minuet-g")
    await lesson.estimate_fingering()
    assert brain.closed == 1 and lesson.brain is None


@pytest.mark.asyncio
async def test_aclose_cancels_owned_background_work():
    cancelled = asyncio.Event()
    async def forever():
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise
    lesson = LessonOrchestrator(lambda *_: asyncio.sleep(0))
    task = lesson._own_task(forever())
    await asyncio.sleep(0)
    await lesson.aclose()
    assert cancelled.is_set()
    assert task.cancelled()


@pytest.mark.asyncio
async def test_agent_exercise_instruction_is_not_followed_by_a_duplicate_fixed_voice(monkeypatch, tmp_path):
    from piano_coach.brain.scripted import ScriptedBrain
    from piano_coach.lesson.fakes import FakeVoiceService
    monkeypatch.setattr(orchestrator_module, 'DATA_DIR', tmp_path)
    sent=[]
    async def send(kind,payload):sent.append((kind,payload))
    lesson=LessonOrchestrator(send,brain=ScriptedBrain(),voice=FakeVoiceService())
    lesson.score=import_score(Path(__file__).parents[3]/'assets/scores/minuet-g')
    lesson.state='reviewing'
    action=await lesson._brain_turn('DEMO_FINISHED',{'exercise':{'measures':[1,2],'hand':'right','tempoPercent':60,'mode':'watch','loop':1,'metronome':True}})
    assert action
    clip=next(payload for kind,payload in sent if kind=='voice.clip')
    # Playback may finish before the action reaches exercise.ready.
    await lesson.voice_done(clip['utteranceId'])
    await lesson.apply_action(action)
    assert len([p for k,p in sent if k=='voice.clip']) == 1
    assert lesson.awaiting_voice is None
    assert any(k=='exercise.ready' for k,p in sent)
