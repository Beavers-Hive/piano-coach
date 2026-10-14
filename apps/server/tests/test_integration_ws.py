import os

from fastapi.testclient import TestClient

from piano_coach.api.app import create_app


def receive_until(ws, wanted: str):
    seen = []
    while True:
        message = ws.receive_json()
        seen.append(message)
        if message["type"] == wanted:
            return message, seen


def test_scripted_brain_end_to_end(monkeypatch):
    monkeypatch.setenv("PIANO_COACH_FAKE_BRAIN", "1")
    monkeypatch.setenv("PIANO_COACH_FAKE_TTS", "1")
    with TestClient(create_app()) as client, client.websocket_connect("/ws") as ws:
        song_id = client.get("/api/songs").json()["songs"][1]["songId"]
        ws.send_json({"type": "lesson.start", "payload": {"songId": song_id}})
        ask1, first = receive_until(ws, "agent.ask")
        assert [message["type"] for message in first[:4]] == ["lesson.state", "song.ready", "song.analysis", "lesson.state"]
        assert ask1["payload"]["questionId"] == "experience"

        ws.send_json({"type": "hearing.answer", "payload": {"questionId": "experience", "answer": "はじめて"}})
        ask2, _ = receive_until(ws, "agent.ask")
        assert ask2["payload"]["questionId"] == "range"

        ws.send_json({"type": "hearing.answer", "payload": {"questionId": "range", "answer": "最初から"}})
        demo, after_plan = receive_until(ws, "demo.play")
        assert any(message["type"] == "plan.updated" for message in after_plan)
        ready = next(message for message in after_plan if message["type"] == "exercise.ready")
        assert ready["payload"]["timeline"]["spec"]["mode"] == "watch"

        ws.send_json({"type": "demo.finished", "payload": demo["payload"]})
        practice_ready, after_demo = receive_until(ws, "exercise.ready")
        assert practice_ready["payload"]["timeline"]["spec"]["mode"] == "wait"
        version = practice_ready["payload"]["timeline"]["exerciseVersion"]
        exercise_id = practice_ready["payload"]["timeline"]["exerciseId"]
        instruction, _ = receive_until(ws, "voice.clip")
        while not instruction["payload"]["text"].startswith("次は"):
            instruction, _ = receive_until(ws, "voice.clip")
        ws.send_json({"type": "voice.done", "payload": {"utteranceId": instruction["payload"]["utteranceId"]}})
        ws.send_json({"type": "practice.started", "payload": {"exerciseId": exercise_id, "exerciseVersion": version}})
        _, _ = receive_until(ws, "lesson.state")  # practicing
        ws.send_json({"type": "attempt.submit", "payload": {"exerciseId": exercise_id, "exerciseVersion": version, "mode": "wait", "events": [], "summary": {"total": 10, "perfect": 10, "good": 0, "miss": 0, "extra": 0, "timingMeanMs": None, "timingStdMs": None, "perMeasure": [], "aborted": False}}})
        next_ready, review = receive_until(ws, "exercise.ready")
        assert next_ready["payload"]["timeline"]["exerciseVersion"] > version
        assert any(message["type"] == "agent.say" for message in review)


def test_fake_server_starts(monkeypatch):
    monkeypatch.setenv("PIANO_COACH_FAKE_BRAIN", "1")
    monkeypatch.setenv("PIANO_COACH_FAKE_TTS", "1")
    with TestClient(create_app()) as client:
        assert client.get("/api/health").json()["tts"] is True


def test_broken_brain_uses_hearing_fallback(monkeypatch):
    monkeypatch.setenv("PIANO_COACH_FAKE_BRAIN", "1")
    monkeypatch.setenv("PIANO_COACH_FAKE_BRAIN_MODE", "broken_json")
    monkeypatch.setenv("PIANO_COACH_FAKE_TTS", "1")
    with TestClient(create_app()) as client, client.websocket_connect("/ws") as ws:
        song_id = client.get("/api/songs").json()["songs"][1]["songId"]
        ws.send_json({"type": "lesson.start", "payload": {"songId": song_id}})
        ask, _ = receive_until(ws, "agent.ask")
        assert ask["payload"]["questionId"] == "experience"
