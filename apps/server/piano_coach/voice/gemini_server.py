"""Gemini TTS bridge. Run: uv run python -m piano_coach.voice.gemini_server"""
from __future__ import annotations

import asyncio
import base64
import logging
import time
import hashlib
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from piano_coach.paths import REPO_ROOT

MODEL = "gemini-3.8-flash-tts"
VOICE = os.environ.get("PIANO_COACH_GEMINI_VOICE", "Kore")
STYLE = os.environ.get("PIANO_COACH_GEMINI_STYLE", "明るく優しい女性のピアノの先生。自然な日本語で、はきはきと、少し速めに話す。")
ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions"
KEY_FILE = REPO_ROOT / "data" / "secrets" / "gemini_api_key"
log = logging.getLogger(__name__)
PROFILE = hashlib.sha256(json.dumps([MODEL, VOICE, STYLE], ensure_ascii=False).encode()).hexdigest()[:16]


def api_key() -> str:
    value = os.environ.get("GEMINI_API_KEY") or (KEY_FILE.read_text().strip() if KEY_FILE.is_file() else "")
    if not value:
        raise RuntimeError("Set GEMINI_API_KEY or data/secrets/gemini_api_key")
    return value


def request_body(text: str) -> dict:
    return {
        "model": MODEL,
        "input": [{"type": "user_input", "content": [{"type": "text", "text": text,
            "annotations": [{"type": "speech_metadata", "style": STYLE}]}]}],
        "response_format": {"type": "audio"},
        "generation_config": {"speech_config": [{"voice": VOICE}]},
    }


def decode_wav(result: dict) -> bytes:
    audio = [content for step in result.get("steps", []) if step.get("type") == "model_output"
             for content in step.get("content", []) if content.get("type") == "audio"]
    if not audio:
        raise ValueError("Gemini returned no audio")
    wav = base64.b64decode(audio[-1]["data"], validate=True)
    if len(wav) < 44 or not wav.startswith(b"RIFF") or wav[8:12] != b"WAVE":
        raise ValueError("Gemini returned invalid WAV audio")
    return wav


@asynccontextmanager
async def lifespan(app: FastAPI):
    api_key()
    app.state.blocked_until = 0.0
    app.state.last_error = None
    async with httpx.AsyncClient(timeout=45.0) as client:
        app.state.client = client
        yield


app = FastAPI(title="piano-coach Gemini TTS", lifespan=lifespan)


class SynthesizeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=400)
    seed: int | None = None  # accepted for compatibility; Gemini does not use it


@app.get("/health")
async def health():
    return {"ok": bool(api_key()) and app.state.last_error is None, "model": MODEL, "voice": VOICE, "voice_profile": PROFILE, "error": app.state.last_error}


@app.post("/synthesize")
async def synthesize(request: SynthesizeRequest):
    if not request.text.strip():
        raise HTTPException(status_code=422, detail="Text must not be blank")
    if time.monotonic() < app.state.blocked_until:
        raise HTTPException(status_code=429, detail=app.state.last_error,
                            headers={"Retry-After": "30"})
    try:
        for attempt in range(2):
            response = await app.state.client.post(ENDPOINT, headers={"x-goog-api-key": api_key()},
                                                   json=request_body(request.text), timeout=20.0)
            if response.status_code in (402, 429):
                # Do not retry daily quota exhaustion. Recheck on a later user request
                # so enabling billing can recover without restarting the app.
                app.state.last_error = ("Gemini TTS の課金・残高を確認してください（HTTP 402）。" if response.status_code == 402 else
                                        "Gemini TTS の利用上限に達しました。Google AI Studio の課金・利用枠を確認してください。")
                app.state.blocked_until = time.monotonic() + 30
                log.warning("Gemini TTS unavailable (HTTP %s)", response.status_code)
                raise HTTPException(status_code=429, detail=app.state.last_error,
                                    headers={"Retry-After": "30"})
            if response.status_code in (500, 502, 503, 504) and attempt == 0:
                await asyncio.sleep(0.5)
                continue
            if not response.is_success:
                log.warning("Gemini TTS provider returned HTTP %s", response.status_code)
                app.state.last_error = f"Gemini TTS returned HTTP {response.status_code}"
                raise HTTPException(status_code=502, detail=app.state.last_error)
            wav = decode_wav(response.json())
            app.state.last_error = None
            break
    except httpx.TimeoutException:
        app.state.last_error = "Gemini TTS timed out"
        raise HTTPException(status_code=504, detail=app.state.last_error) from None
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        app.state.last_error = "Gemini TTS returned no valid audio"
        raise HTTPException(status_code=502, detail=app.state.last_error) from None
    return Response(wav, media_type="audio/wav")


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PIANO_COACH_GEMINI_PORT", "8791")))
