import base64
import io
import wave

import httpx
import pytest
from fastapi.testclient import TestClient
from piano_coach.voice import gemini_server as tts


def wav_bytes():
    output = io.BytesIO()
    with wave.open(output, 'wb') as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(24000)
        stream.writeframes(b'\x00\x00' * 240)
    return output.getvalue()


def result(wav):
    return {'steps': [{'type':'model_output', 'content':[{'type':'audio', 'data':base64.b64encode(wav).decode()}]}]}


def test_decode_and_reject_invalid_audio():
    assert tts.decode_wav(result(wav_bytes())) == wav_bytes()
    for payload in ({}, result(b'RIFF')):
        with pytest.raises(ValueError):
            tts.decode_wav(payload)


def test_transcript_and_voice_styling_are_separate():
    body = tts.request_body('こんにちは')
    assert body['model'] == 'gemini-3.8-flash-tts'
    assert body['input'][0]['content'][0]['text'] == 'こんにちは'
    assert body['input'][0]['content'][0]['annotations'][0]['type'] == 'speech_metadata'


def test_bridge_returns_wav_and_redacts_provider_errors(monkeypatch):
    monkeypatch.setattr(tts, 'api_key', lambda:'secret-test-value')
    response_status = [200]
    def handler(request):
        assert request.headers['x-goog-api-key'] == 'secret-test-value'
        if response_status[0] != 200:
            return httpx.Response(403, json={'error':'secret-test-value'})
        return httpx.Response(200, json=result(wav_bytes()))
    original = httpx.AsyncClient
    monkeypatch.setattr(tts.httpx, 'AsyncClient', lambda **kw:original(transport=httpx.MockTransport(handler)))
    with TestClient(tts.app) as client:
        assert client.get('/health').json()['model'] == 'gemini-3.8-flash-tts'
        response = client.post('/synthesize',json={'text':'こんにちは','seed':1234})
        assert response.status_code == 200 and response.content == wav_bytes()
        response_status[0] = 403
        response = client.post('/synthesize',json={'text':'こんにちは'})
        assert response.status_code == 502
        assert 'secret-test-value' not in response.text
        assert client.post('/synthesize',json={'text':' '}).status_code == 422


def test_daily_quota_is_not_retried_and_health_reports_failure(monkeypatch):
    monkeypatch.setattr(tts, 'api_key', lambda:'secret-test-value')
    calls = []
    responses = [429, 200]
    def handler(request):
        calls.append(request)
        status = responses.pop(0)
        if status == 429:
            return httpx.Response(429, json={'error':{'message':'10 requests per day secret-test-value'}})
        return httpx.Response(200, json=result(wav_bytes()))
    original = httpx.AsyncClient
    monkeypatch.setattr(tts.httpx, 'AsyncClient', lambda **kw:original(transport=httpx.MockTransport(handler)))
    with TestClient(tts.app) as client:
        assert client.post('/synthesize',json={'text':'こんにちは'}).status_code == 429
        assert client.post('/synthesize',json={'text':'もう一文'}).status_code == 429
        assert len(calls) == 1
        health = client.get('/health').json()
        assert health['ok'] is False and '利用上限' in health['error']
        assert 'secret-test-value' not in str(health)
        tts.app.state.blocked_until = 0
        assert client.post('/synthesize',json={'text':'課金設定後'}).status_code == 200
        assert client.get('/health').json()['ok'] is True


def test_temporary_provider_failure_is_retried_once(monkeypatch):
    monkeypatch.setattr(tts, 'api_key', lambda:'secret-test-value')
    responses = [503, 200]
    def handler(request):
        status = responses.pop(0)
        return httpx.Response(status,json=result(wav_bytes()) if status == 200 else {})
    original = httpx.AsyncClient
    monkeypatch.setattr(tts.httpx, 'AsyncClient', lambda **kw:original(transport=httpx.MockTransport(handler)))
    with TestClient(tts.app) as client:
        assert client.post('/synthesize',json={'text':'こんにちは'}).status_code == 200
        assert responses == []
