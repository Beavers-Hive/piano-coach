from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import shutil
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from piano_coach.brain.gemini import GeminiBrain, DEFAULT_MODEL, DEFAULT_ANALYSIS_MODEL, DEFAULT_FINGERING_MODEL, configured
from piano_coach.brain.codex import CodexBrain, codex_executable, check_subscription_environment
from piano_coach.brain.scripted import ScriptedBrain
from piano_coach.exercise.notation import MUSICXML_MEDIA_TYPE, timeline_to_musicxml
from piano_coach.exercise.registry import ExerciseTimelineCache
from piano_coach.lesson.fakes import FakeVoiceService
from piano_coach.lesson.orchestrator import LessonOrchestrator
from piano_coach.lesson.store import LessonStore
from piano_coach.paths import DATA_DIR, REPO_ROOT, ensure_data_dirs
from piano_coach.voice.google import GoogleVoiceService
from piano_coach.voice.service import VoiceService
from piano_coach.score.importer import ScoreRepository, rasterize_pages

log = logging.getLogger(__name__)
ALLOWED_WS_ORIGINS = {"http://127.0.0.1:5173", "http://localhost:5173"}


def _fake_enabled(name: str) -> bool:
    return os.environ.get(name) == "1"


def create_app(repository: ScoreRepository | None = None, lesson_store: LessonStore | None = None) -> FastAPI:
    repo = repository or ScoreRepository()
    exercises = ExerciseTimelineCache(capacity=20)
    lessons = lesson_store or LessonStore()
    brain_provider = os.environ.get("PIANO_COACH_BRAIN_PROVIDER", "gemini" if os.environ.get("GOOGLE_CLOUD_PROJECT") or os.environ.get("PORT") else "codex")
    if brain_provider not in {"codex", "gemini"}:
        raise ValueError("PIANO_COACH_BRAIN_PROVIDER must be codex or gemini")
    default_voice = "google" if brain_provider == "gemini" else "irodori"
    if _fake_enabled("PIANO_COACH_FAKE_TTS"):
        voice = FakeVoiceService()
    elif os.environ.get("PIANO_COACH_VOICE_PROVIDER", default_voice) == "irodori":
        voice = VoiceService()
    else:
        voice = GoogleVoiceService()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if os.environ.get("ANTHROPIC_API_KEY"):
            raise RuntimeError("ANTHROPIC_API_KEY must be unset")
        if brain_provider == "codex": check_subscription_environment()
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
        return {"songs": [{"songId": score.songId, "title": score.title, "composer": score.composer,
                           "progress": lessons.progress_for(score.songId)} for score in repo.all()]}

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

    @app.get("/api/exercises/{exercise_id}/score.musicxml")
    async def exercise_score(exercise_id: str) -> Response:
        stored = exercises.get(exercise_id)
        if stored is None:
            raise HTTPException(status_code=404, detail="exercise not found")
        return Response(
            content=timeline_to_musicxml(
                stored.timeline,
                key_fifths=stored.key_fifths,
                time_signature_num=stored.time_signature_num,
                time_signature_den=stored.time_signature_den,
            ),
            media_type=MUSICXML_MEDIA_TYPE,
        )

    @app.post("/api/voice/test")
    async def voice_test() -> dict:
        """準備画面の「先生の声をテスト」用。必ず VoiceService（Irodori）を通し、どのエンジンで鳴ったかを返す。"""
        text = "こんにちは😊、いっしょにピアノをひいてみよう！"
        clips = [clip async for clip in voice.speak_text("voice-test", text)]
        urls = [clip.url for clip in clips if clip.url]
        return {"engine": getattr(voice, "engine", "irodori") if urls and len(urls) == len(clips) else "webspeech", "urls": urls, "text": text}

    @app.get("/api/health")
    async def health() -> dict:
        if _fake_enabled("PIANO_COACH_FAKE_TTS"):
            tts_ok = True
        elif getattr(voice, "engine", "") == "google":
            tts_ok = configured()
        else:
            try:
                async with httpx.AsyncClient(timeout=.5) as client:
                    reply = await client.get(f"{voice.tts_url}/health")
                    tts_ok = reply.is_success and reply.json().get("ok") is True
            except (httpx.HTTPError, ValueError): tts_ok = False
        ready = configured() if brain_provider == "gemini" else bool(shutil.which(codex_executable()))
        return {"claude": _fake_enabled("PIANO_COACH_FAKE_BRAIN") or ready, "tts": tts_ok,
                "brainProvider": "scripted" if _fake_enabled("PIANO_COACH_FAKE_BRAIN") else brain_provider,
                "model": os.environ.get("PIANO_COACH_GEMINI_MODEL", DEFAULT_MODEL) if brain_provider == "gemini" else os.environ.get("PIANO_COACH_CODEX_MODEL", "gpt-6.1-sol"),
                "analysisModel": os.environ.get("PIANO_COACH_GEMINI_ANALYSIS_MODEL", DEFAULT_ANALYSIS_MODEL) if brain_provider == "gemini" else os.environ.get("PIANO_COACH_CODEX_MODEL", "gpt-6.1-sol"),
                "fingeringModel": os.environ.get("PIANO_COACH_GEMINI_FINGERING_MODEL", DEFAULT_FINGERING_MODEL) if brain_provider == "gemini" else os.environ.get("PIANO_COACH_CODEX_FINGERING_MODEL", os.environ.get("PIANO_COACH_CODEX_MODEL", "gpt-6.1-sol")),
                "ttsProvider": getattr(voice, "engine", "irodori")}

    @app.websocket("/ws")
    async def websocket(websocket: WebSocket) -> None:
        origin = websocket.headers.get("origin")
        # TestClient and non-browser local clients omit Origin. Browsers must be our Vite app.
        allowed = ALLOWED_WS_ORIGINS | set(filter(None, os.environ.get("PIANO_COACH_ALLOWED_ORIGINS", "").split(",")))
        same_host = origin is not None and urlparse(origin).scheme in {"http", "https"} and urlparse(origin).netloc == websocket.headers.get("host")
        if origin is not None and origin not in allowed and not same_host:
            await websocket.close(code=1008)
            return
        await websocket.accept()
        send_lock, tasks = asyncio.Lock(), set()
        brain = None
        async def send(kind: str, payload: dict) -> None:
            async with send_lock: await websocket.send_json({"type": kind, "payload": payload})
        lesson = LessonOrchestrator(send, voice=voice, exercise_cache=exercises, lesson_store=lessons)

        async def handle(kind: str, payload: dict) -> None:
            nonlocal brain
            try:
                if kind == "lesson.start":
                    score = repo.get(payload.get("songId", ""))
                    if not score: await send("error", {"message": "曲が見つかりません"}); return
                    if brain: await brain.close()
                    brain = ScriptedBrain() if _fake_enabled("PIANO_COACH_FAKE_BRAIN") else (GeminiBrain() if brain_provider == "gemini" else CodexBrain())
                    try:
                        await brain.open()
                        lesson.set_brain(brain)
                    except Exception as error:
                        log.warning("lesson brain unavailable: %s", error); lesson.set_brain(None)
                    pdf = repo.source_pdf(score.songId); pages = rasterize_pages(pdf, score.songId) if pdf else []
                    await lesson.start(score, [f"/api/songs/{score.songId}/pages/{index}.png" for index in range(1, len(pages)+1)], pages,
                                       resume=bool(payload.get("resume", False)))
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
            await lesson.aclose()
    web_dist = Path(os.environ.get("PIANO_COACH_WEB_DIST") or REPO_ROOT / "apps" / "web" / "dist")
    if web_dist.is_dir():
        app.mount("/", StaticFiles(directory=web_dist, html=True), name="web")
    return app
