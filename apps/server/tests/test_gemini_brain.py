import base64
import json

import pytest

from piano_coach.brain.base import ActionReady, BrainError, SayDelta
from piano_coach.brain.gemini import GeminiBrain
from piano_coach.voice.google import GoogleVoiceService


@pytest.mark.asyncio
async def test_gemini_keeps_history_and_does_not_accept_broken_actions(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "test-project")
    brain = GeminiBrain()
    await brain.open(system_prompt="teacher")
    calls = []
    async def generate(system, contents, **kwargs):
        calls.append((system, contents))
        return '<say>こんにちは</say><action>{"type":"ask","question":{"id":"experience","text":"経験は？","options":[],"allowFree":true}}</action>'
    monkeypatch.setattr(brain, "_generate", generate)
    events = [event async for event in brain.send("first")]
    assert any(isinstance(event, SayDelta) for event in events)
    assert any(isinstance(event, ActionReady) for event in events)
    await anext(brain.send("second"))
    assert [item["role"] for item in calls[-1][1]] == ["user", "model", "user"]
    assert calls[-1][1][0]["parts"][0]["text"] == "first"
    previous = list(brain.history)
    async def invalid(*args, **kwargs):
        return '<say>こんにちは</say><action>{broken}</action>'
    monkeypatch.setattr(brain, "_generate", invalid)
    assert isinstance(await anext(brain.send("third")), BrainError)
    assert brain.history == previous
    await brain.close()
    assert isinstance(await anext(brain.send("closed")), BrainError)


@pytest.mark.asyncio
async def test_vertex_request_contains_schema_images_and_no_tools(monkeypatch, tmp_path):
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "test-project")
    monkeypatch.setenv("GOOGLE_CLOUD_LOCATION", "global")
    brain = GeminiBrain()
    calls = []
    result = {"title": "曲", "summary": "紹介", "sections": [{"name": "最初", "measures": [1, 4]}]}
    async def post(url, payload, **kwargs):
        calls.append((url, payload))
        return {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"thought": True, "text": "private reasoning"}, {"text": json.dumps(result)}]}}]}
    monkeypatch.setattr(brain.api, "post", post)
    page = tmp_path / "page.png"
    page.write_bytes(b"image bytes")
    assert await brain.analyze_pages([page], {"measureCount": 4}) == result
    url, payload = calls[0]
    assert "/locations/global/" in url and url.endswith(":generateContent")
    assert "/models/gemini-3.1-flash-lite:" in url
    assert payload["generationConfig"]["responseMimeType"] == "application/json"
    assert payload["generationConfig"]["responseSchema"]["type"] == "object"
    assert "tools" not in payload
    assert payload["generationConfig"]["thinkingConfig"]["thinkingLevel"] == "MINIMAL"
    image = payload["contents"][0]["parts"][1]["inlineData"]
    assert image["mimeType"] == "image/png"
    assert base64.b64decode(image["data"]) == b"image bytes"


@pytest.mark.asyncio
async def test_gemini_rejects_truncated_output(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "test-project")
    brain = GeminiBrain()
    async def post(*args, **kwargs):
        return {"candidates": [{"finishReason": "MAX_TOKENS", "content": {"parts": [{"text": "partial"}]}}]}
    monkeypatch.setattr(brain.api, "post", post)
    with pytest.raises(ValueError, match="did not finish"):
        await brain._generate("teacher", [])


@pytest.mark.asyncio
async def test_google_voice_generates_served_wav_and_separates_voice_cache(monkeypatch, tmp_path):
    wav = b"RIFF" + b"\0" * 40
    calls = []
    async def post(url, payload, **kwargs):
        calls.append(payload)
        return {"audioContent": base64.b64encode(wav).decode()}
    voice = GoogleVoiceService(cache_dir=tmp_path)
    monkeypatch.setattr(voice.api, "post", post)
    clips = [clip async for clip in voice.speak_text("one", "こんにちは。")]
    assert clips and clips[-1].last and clips[0].url
    assert (tmp_path / clips[0].url.rsplit("/", 1)[1]).read_bytes() == wav
    assert calls[0]["audioConfig"]["audioEncoding"] == "LINEAR16"
    assert len([clip async for clip in voice.speak_text("two", "こんにちは。")]) == 1
    assert len(calls) == 1
    monkeypatch.setenv("PIANO_COACH_GOOGLE_VOICE", "ja-JP-Neural2-C")
    other = GoogleVoiceService(cache_dir=tmp_path)
    monkeypatch.setattr(other.api, "post", post)
    other_clips = [clip async for clip in other.speak_text("other", "こんにちは。")]
    assert other_clips[0].url != clips[0].url
    await voice.aclose()
    await other.aclose()
