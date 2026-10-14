from __future__ import annotations

import asyncio
import hashlib
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse

from piano_coach.brain.claude import ClaudeBrain
from piano_coach.brain.scripted import ScriptedBrain
from piano_coach.lesson.fakes import FakeVoiceService
from piano_coach.lesson.orchestrator import LessonOrchestrator
from piano_coach.paths import DATA_DIR, ensure_data_dirs
from piano_coach.score.importer import ScoreRepository, rasterize_pages

log = logging.getLogger(__name__)


def _fake_enabled(name: str) -> bool:
    return os.environ.get(name) == "1"


def create_app(repository: ScoreRepository | None = None) -> FastAPI:
    repo = repository or ScoreRepository()
    voice = FakeVoiceService() if _fake_enabled("PIANO_COACH_FAKE_TTS") else __import__("piano_coach.voice", fromlist=["VoiceService"]).VoiceService()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if os.environ.get("ANTHROPIC_API_KEY"):
            raise RuntimeError("ANTHROPIC_API_KEY must be unset; Claude subscription login is required")
        ensure_data_dirs()
        warmup = asyncio.create_task(voice.warmup_phrases())
        try:
            yield
        finally:
            if not warmup.done(): warmup.cancel()
            try: await warmup
            except asyncio.CancelledError: pass
            close = getattr(voice, "aclose", None)
            if close: await close()

    app = FastAPI(title="piano-coach", lifespan=lifespan)

    @app.get("/api/songs")
    async def songs() -> dict:
        return {"songs": [{"songId": score.songId, "title": score.title, "composer": score.composer} for score in repo.all()]}

    @app.post("/api/songs")
    async def upload_song(file: UploadFile = File(...)) -> dict:
        digest = hashlib.sha256(await file.read()).hexdigest()[:12]
        if not repo.get(digest): raise HTTPException(status_code=422, detail="PDF does not match a bundled score")
        return {"songId": digest}

    @app.get("/api/songs/{song_id}/pages/{page}.png")
    async def page(song_id: str, page: int):
        pdf = repo.source_pdf(song_id)
        if not pdf or page < 1: raise HTTPException(status_code=404, detail="song/page not found")
        rendered = rasterize_pages(pdf, song_id)
        if page > len(rendered): raise HTTPException(status_code=404, detail="page not found")
        return FileResponse(rendered[page - 1], media_type="image/png")

    @app.get("/api/tts/{clip_hash}.wav")
    async def tts(clip_hash: str):
        path = DATA_DIR / "tts" / f"{Path(clip_hash).name}.wav"
        if not path.is_file(): raise HTTPException(status_code=404, detail="voice clip not found")
        return FileResponse(path, media_type="audio/wav")

    @app.post("/api/voice/test")
    async def voice_test() -> dict:
        """準備画面の「先生の声をテスト」用。必ず VoiceService（Irodori）を通し、どのエンジンで鳴ったかを返す。"""
        text = "こんにちは😊、いっしょにピアノをひいてみよう！"
        clips = [clip async for clip in voice.speak_text("voice-test", text)]
        urls = [clip.url for clip in clips if clip.url]
        return {"engine": "irodori" if urls and len(urls) == len(clips) else "webspeech", "urls": urls, "text": text}

    @app.get("/api/health")
    async def health() -> dict:
        if _fake_enabled("PIANO_COACH_FAKE_TTS"): return {"claude": not bool(os.environ.get("ANTHROPIC_API_KEY")), "tts": True}
        try:
            async with httpx.AsyncClient(timeout=.5) as client: tts_ok = (await client.get("http://127.0.0.1:8790/health")).is_success
        except httpx.HTTPError: tts_ok = False
        return {"claude": not bool(os.environ.get("ANTHROPIC_API_KEY")), "tts": tts_ok}

    @app.websocket("/ws")
    async def websocket(websocket: WebSocket) -> None:
        await websocket.accept()
        send_lock, tasks = asyncio.Lock(), set()
        brain = None
        async def send(kind: str, payload: dict) -> None:
            async with send_lock: await websocket.send_json({"type": kind, "payload": payload})
        lesson = LessonOrchestrator(send, voice=voice)

        async def handle(kind: str, payload: dict) -> None:
            nonlocal brain
            try:
                if kind == "lesson.start":
                    score = repo.get(payload.get("songId", ""))
                    if not score: await send("error", {"message": "曲が見つかりません"}); return
                    if brain: await brain.close()
                    brain = ScriptedBrain() if _fake_enabled("PIANO_COACH_FAKE_BRAIN") else ClaudeBrain()
                    try:
                        await brain.open()
                        lesson.brain = brain
                    except Exception as error:
                        log.warning("lesson brain unavailable: %s", error); lesson.brain = None
                    pdf = repo.source_pdf(score.songId); pages = rasterize_pages(pdf, score.songId) if pdf else []
                    await lesson.start(score, [f"/api/songs/{score.songId}/pages/{index}.png" for index in range(1, len(pages)+1)], pages)
                elif kind == "hearing.answer": await lesson.hearing_answer(payload.get("questionId", ""), payload.get("answer", ""))
                elif kind == "voice.done": await lesson.voice_done(payload.get("utteranceId", ""))
                elif kind == "practice.started": await lesson.practice_started(payload.get("exerciseId", ""), payload.get("exerciseVersion", -1))
                elif kind == "demo.finished": await lesson.demo_finished(payload.get("exerciseId", ""), payload.get("exerciseVersion", -1))
                elif kind == "attempt.submit": await lesson.submit_attempt(payload)
                elif kind == "user.message": await lesson.user_message(payload.get("text", ""))
                else: await send("error", {"message": f"未対応のメッセージです: {kind}"})
            except Exception as error:
                log.exception("websocket message %s failed", kind)
                await send("error", {"message": str(error)})

        try:
            while True:
                message = await websocket.receive_json()
                task = asyncio.create_task(handle(message.get("type", ""), message.get("payload", {})))
                tasks.add(task); task.add_done_callback(tasks.discard)
        except WebSocketDisconnect: pass
        finally:
            for task in tasks: task.cancel()
            if tasks: await asyncio.gather(*tasks, return_exceptions=True)
            if brain: await brain.close()
    return app
