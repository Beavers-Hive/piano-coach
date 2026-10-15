import os
from pathlib import Path

import pytest

from piano_coach.exercise import ExerciseSpec
from piano_coach.lesson.store import LessonStore, SavedAttempt, SavedLesson
from piano_coach.lesson.orchestrator import LessonOrchestrator
from piano_coach.score import import_score
from piano_coach.lesson.store import LessonStore, SavedAttempt, SavedLesson


def saved_lesson(song_id: str = "song") -> SavedLesson:
    exercise = ExerciseSpec(measures=(1, 2), hand="right", tempoPercent=60, mode="wait", loop=1, metronome=True).model_dump(mode="json")
    return SavedLesson.now(songId=song_id, plan={"goal": "ひけるようになる", "currentStepId": "step-1", "steps": [
        {"id": "step-1", "title": "右手", "description": "右手から", "status": "doing", "exercise": exercise},
        {"id": "step-2", "title": "両手", "description": "両手で", "status": "todo", "exercise": exercise},
    ]}, stepIndex=0, currentExercise=exercise, hearingAnswers=[{"questionId": "experience", "answer": "はじめて"}])


def test_store_round_trips_and_writes_atomically(tmp_path, monkeypatch):
    store = LessonStore(tmp_path)
    replace = os.replace
    calls = []

    def observing_replace(source, target):
        calls.append((source, target, os.path.exists(source)))
        replace(source, target)

    monkeypatch.setattr("piano_coach.lesson.store.os.replace", observing_replace)
    expected = saved_lesson()
    store.save(expected)
    assert calls and calls[0][2] and str(calls[0][0]).endswith(".tmp")
    assert store.load("song") == expected
    assert [path.name for path in (tmp_path / "lessons").iterdir()] == ["song.json"]


def test_store_ignores_broken_file_and_finished_progress_is_hidden(tmp_path, caplog):
    store = LessonStore(tmp_path)
    path = store.path_for("song")
    path.parent.mkdir(parents=True)
    path.write_text("{broken", encoding="utf-8")
    assert store.load("song") is None
    assert "ignoring invalid saved lesson" in caplog.text
    saved = saved_lesson()
    store.save(saved)
    assert store.progress_for("song") == {
        "stepIndex": 0, "stepCount": 2, "stepTitle": "右手", "goal": "ひけるようになる",
        "updatedAt": saved.updatedAt, "finished": False,
    }
    store.save(saved.model_copy(update={"finished": True}))
    assert store.progress_for("song") is None


def test_saved_attempts_are_limited_to_five():
    attempt = SavedAttempt(exercise={"measures": [1, 1]}, summary={"total": 1}, verdict="retry")
    saved = saved_lesson().model_copy(update={"recentAttempts": [attempt] * 5})
    assert len(saved.recentAttempts) == 5


@pytest.mark.asyncio
async def test_orchestrator_persists_only_the_most_recent_five_attempts(tmp_path):
    store = LessonStore(tmp_path)

    async def send(*_):
        return None

    lesson = LessonOrchestrator(send, lesson_store=store)
    lesson.score = import_score(Path(__file__).parents[3] / "assets/scores/minuet-g")
    spec = ExerciseSpec(measures=(1, 1), hand="right", tempoPercent=60, mode="wait", loop=1, metronome=True)
    lesson.plan = {"goal": "右手", "currentStepId": "step-1", "steps": [
        {"id": "step-1", "title": "右手", "description": "", "status": "doing", "exercise": spec},
    ]}
    assert await lesson.prepare_exercise(spec)
    for _ in range(6):
        assert lesson.timeline
        await lesson.submit_attempt({"exerciseId": lesson.timeline.exerciseId, "exerciseVersion": lesson.exercise_version,
            "summary": {"total": 10, "perfect": 0, "good": 0, "miss": 10, "extra": 0,
                        "timingMeanMs": None, "timingStdMs": None, "perMeasure": [], "aborted": False}})
    saved = store.load(lesson.score.songId)
    assert saved and len(saved.recentAttempts) == 5
