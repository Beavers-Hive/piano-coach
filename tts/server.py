"""Irodori-TTS の常駐サーバー（127.0.0.1:8790）。

起動（vendor/Irodori-TTS の venv、Python 3.10）:
  cd vendor/Irodori-TTS && HF_HUB_DISABLE_IMPLICIT_TOKEN=1 uv run --no-sync python ../../tts/server.py

POST /synthesize {text, seed?} -> audio/wav
GET  /health                  -> {"ok": true, "model": ...}
"""
from __future__ import annotations

import asyncio
import os
import sys
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path

# `python ../../tts/server.py` で起動すると sys.path[0] が tts/ になるので、Irodori-TTS のルートを足す。
for _root in (Path.cwd(), Path(__file__).resolve().parents[1] / "vendor" / "Irodori-TTS"):
    if (_root / "irodori_tts").is_dir() and str(_root) not in sys.path:
        sys.path.insert(0, str(_root))

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from irodori_tts.inference_runtime import (
    InferenceRuntime,
    RuntimeKey,
    SamplingRequest,
    download_hf_checkpoint,
    save_wav,
)

MODEL = os.environ.get("TTS_MODEL", "Aratako/Irodori-TTS-v4.1-Small-MF")
DEVICE = os.environ.get("TTS_DEVICE", "mps")
CODEC_DEVICE = os.environ.get("TTS_CODEC_DEVICE", "mps")
PRECISION = os.environ.get("TTS_PRECISION", "fp32")
HOST = "127.0.0.1"
PORT = int(os.environ.get("TTS_PORT", "8790"))
CAPTION = "明るく優しい20代女性のピアノの先生。落ち着いたテンポで、はきはきと話す。"
DEFAULT_SEED = 1234
MAX_TEXT_CHARS = 400

_runtime: InferenceRuntime | None = None
# MPS で同時に推論しないため、合成は 1 本ずつ直列に処理する。
_lock = asyncio.Lock()


class SynthesizeRequest(BaseModel):
    text: str
    seed: int | None = None


def _synth_wav_bytes(text: str, seed: int) -> bytes:
    assert _runtime is not None
    req = SamplingRequest(text=text, caption=CAPTION, no_ref=True, ref_wav=None, num_steps=None, seed=seed)
    result = _runtime.synthesize(req)
    with tempfile.TemporaryDirectory() as d:
        path = save_wav(Path(d) / "out.wav", result.audio, result.sample_rate)
        return Path(path).read_bytes()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _runtime
    t = time.perf_counter()
    ckpt = download_hf_checkpoint(MODEL) if not Path(MODEL).exists() else MODEL
    _runtime = InferenceRuntime.from_key(
        RuntimeKey(checkpoint=ckpt, model_device=DEVICE, model_precision=PRECISION, codec_device=CODEC_DEVICE)
    )
    print(f"[tts] model loaded in {time.perf_counter() - t:.1f}s", flush=True)
    t = time.perf_counter()
    await asyncio.to_thread(_synth_wav_bytes, "ウォームアップです。", DEFAULT_SEED)
    print(f"[tts] warmup done in {time.perf_counter() - t:.1f}s; ready on {HOST}:{PORT}", flush=True)
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/health")
async def health():
    return {"ok": _runtime is not None, "model": MODEL}


@app.post("/synthesize")
async def synthesize(body: SynthesizeRequest):
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="text is empty")
    if len(text) > MAX_TEXT_CHARS:
        raise HTTPException(status_code=422, detail=f"text too long (>{MAX_TEXT_CHARS})")
    seed = DEFAULT_SEED if body.seed is None else body.seed
    async with _lock:
        t = time.perf_counter()
        wav = await asyncio.to_thread(_synth_wav_bytes, text, seed)
        print(f"[tts] {time.perf_counter() - t:.2f}s chars={len(text)} {text[:30]!r}", flush=True)
    return Response(content=wav, media_type="audio/wav")


if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
