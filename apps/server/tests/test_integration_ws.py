import os

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

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
        # お手本の直後は、次の課題が決まるまで reviewing（先生が考え中）。briefing に戻してはいけない
        # （戻すと、お手本用の watch 課題のまま演奏を始められてしまう。本物の Claude での通しテストで発覚）
        states_after_demo = [m["payload"]["state"] for m in after_demo if m["type"] == "lesson.state"]
        assert states_after_demo and states_after_demo[0] == "reviewing", states_after_demo
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


def test_exercise_score_api_after_exercise_ready(monkeypatch):
    monkeypatch.setenv("PIANO_COACH_FAKE_BRAIN", "1")
    monkeypatch.setenv("PIANO_COACH_FAKE_TTS", "1")
    with TestClient(create_app()) as client, client.websocket_connect("/ws") as ws:
        song_id = client.get("/api/songs").json()["songs"][1]["songId"]
        ws.send_json({"type": "lesson.start", "payload": {"songId": song_id}})
        receive_until(ws, "agent.ask")
        ws.send_json({"type": "hearing.answer", "payload": {"questionId": "experience", "answer": "はじめて"}})
        receive_until(ws, "agent.ask")
        ws.send_json({"type": "hearing.answer", "payload": {"questionId": "range", "answer": "最初から"}})
        ready, _ = receive_until(ws, "exercise.ready")
        exercise_id = ready["payload"]["timeline"]["exerciseId"]
        response = client.get(f"/api/exercises/{exercise_id}/score.musicxml")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/vnd.recordare.musicxml+xml")
        assert b"<score-partwise" in response.content
        assert client.get("/api/exercises/missing/score.musicxml").status_code == 404


def test_scripted_brain_switches_to_drill_after_two_poor_attempts(monkeypatch):
    monkeypatch.setenv("PIANO_COACH_FAKE_BRAIN", "1")
    monkeypatch.setenv("PIANO_COACH_FAKE_TTS", "1")
    with TestClient(create_app()) as client, client.websocket_connect("/ws") as ws:
        song_id = client.get("/api/songs").json()["songs"][1]["songId"]
        ws.send_json({"type": "lesson.start", "payload": {"songId": song_id}})
        receive_until(ws, "agent.ask")
        ws.send_json({"type": "hearing.answer", "payload": {"questionId": "experience", "answer": "はじめて"}})
        receive_until(ws, "agent.ask")
        ws.send_json({"type": "hearing.answer", "payload": {"questionId": "range", "answer": "最初から"}})
        demo, _ = receive_until(ws, "demo.play")
        ws.send_json({"type": "demo.finished", "payload": demo["payload"]})
        ready, _ = receive_until(ws, "exercise.ready")

        def start_practice(timeline):
            clip, _ = receive_until(ws, "voice.clip")
            while not clip["payload"]["text"].startswith("次は"):
                clip, _ = receive_until(ws, "voice.clip")
            ws.send_json({"type": "voice.done", "payload": {"utteranceId": clip["payload"]["utteranceId"]}})
            ws.send_json({"type": "practice.started", "payload": {"exerciseId": timeline["exerciseId"], "exerciseVersion": timeline["exerciseVersion"]}})
            receive_until(ws, "lesson.state")

        def submit_poor(timeline):
            ws.send_json({"type": "attempt.submit", "payload": {"exerciseId": timeline["exerciseId"], "exerciseVersion": timeline["exerciseVersion"],
                "summary": {"total": 10, "perfect": 6, "good": 0, "miss": 4, "extra": 0, "timingMeanMs": None,
                            "timingStdMs": None, "perMeasure": [], "aborted": False}}})

        start_practice(ready["payload"]["timeline"])
        submit_poor(ready["payload"]["timeline"])
        retry_ready, _ = receive_until(ws, "exercise.ready")
        start_practice(retry_ready["payload"]["timeline"])
        submit_poor(retry_ready["payload"]["timeline"])
        drill_ready, _ = receive_until(ws, "exercise.ready")
        assert drill_ready["payload"]["timeline"]["spec"]["drill"]["kind"] == "five_finger"


def test_broken_brain_uses_hearing_fallback(monkeypatch):
    monkeypatch.setenv("PIANO_COACH_FAKE_BRAIN", "1")
    monkeypatch.setenv("PIANO_COACH_FAKE_BRAIN_MODE", "broken_json")
    monkeypatch.setenv("PIANO_COACH_FAKE_TTS", "1")
    with TestClient(create_app()) as client, client.websocket_connect("/ws") as ws:
        song_id = client.get("/api/songs").json()["songs"][1]["songId"]
        ws.send_json({"type": "lesson.start", "payload": {"songId": song_id}})
        ask, _ = receive_until(ws, "agent.ask")
        assert ask["payload"]["questionId"] == "experience"


def test_websocket_rejects_untrusted_origin(monkeypatch):
    monkeypatch.setenv("PIANO_COACH_FAKE_TTS", "1")
    with TestClient(create_app()) as client:
        with pytest.raises(WebSocketDisconnect) as error:
            with client.websocket_connect("/ws", headers={"origin": "https://evil.example"}):
                pass
        assert error.value.code == 1008
