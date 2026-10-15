import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from piano_coach.api.app import create_app


def test_static_build_and_api_are_served_together(monkeypatch, tmp_path):
    monkeypatch.setenv("PIANO_COACH_FAKE_TTS", "1")
    monkeypatch.setenv("PIANO_COACH_FAKE_BRAIN", "1")
    monkeypatch.setenv("PIANO_COACH_WEB_DIST", str(tmp_path))
    (tmp_path / "index.html").write_text("<html>Piano Coach</html>")
    with TestClient(create_app()) as client:
        assert "Piano Coach" in client.get("/").text
        assert client.get("/api/songs").json()["songs"]
        assert client.get("/api/health").json()["brainProvider"] == "scripted"
        assert client.get("/api/missing").status_code == 404


def test_cloud_websocket_accepts_same_host_and_rejects_other_origin(monkeypatch):
    monkeypatch.setenv("PIANO_COACH_FAKE_TTS", "1")
    with TestClient(create_app(), base_url="https://piano.example") as client:
        with client.websocket_connect("wss://piano.example/ws", headers={"origin": "https://piano.example"}):
            pass
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect("wss://piano.example/ws", headers={"origin": "https://piano.example.evil.test"}):
                pass


@pytest.mark.parametrize('provider', ['codex', 'gemini'])
def test_merged_runtime_preserves_explicit_brain_provider(monkeypatch, provider):
    monkeypatch.setenv('PIANO_COACH_FAKE_TTS', '1')
    monkeypatch.delenv('PIANO_COACH_FAKE_BRAIN', raising=False)
    monkeypatch.setenv('PIANO_COACH_BRAIN_PROVIDER', provider)
    monkeypatch.setenv('GOOGLE_CLOUD_PROJECT', 'test-project')
    with TestClient(create_app()) as client:
        health = client.get('/api/health').json()
        assert health['brainProvider'] == provider
        assert health['model'] == ('gpt-6.1-sol' if provider == 'codex' else 'gemini-3.5-flash')
