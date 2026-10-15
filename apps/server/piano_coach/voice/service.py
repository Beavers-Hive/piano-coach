"""VoiceService: 文の分割 -> 読み補正 -> TTS（キャッシュ付き）-> VoiceClip。"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import AsyncIterator

import httpx
from piano_coach.paths import DATA_DIR

from .splitter import SentenceSplitter
from .yomi import subtitle_text, tts_text

log = logging.getLogger(__name__)

DEFAULT_SEED = 1234
SYNTH_TIMEOUT_S = float(os.environ.get("PIANO_COACH_TTS_TIMEOUT", "8.0"))  # デモでは代替の機械音声より、少し待っても Irodori の声を優先する
DEFAULT_TTS_URL = "http://127.0.0.1:8790"
# apps/server/piano_coach/voice/service.py -> リポジトリ直下
_REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_CACHE_DIR = DATA_DIR / "tts"

WARMUP_PHRASES = [
    "ナイス！",
    "いいね！",
    "惜しい！",
    "もう一回いってみよう！",
    "次へ進みましょう！",
    "いい感じ！",
]

_SPEAKABLE_RE = re.compile(r"\w")


@dataclass
class VoiceClip:
    utterance_id: str
    seq: int
    url: str | None  # "/api/tts/{hash}.wav"。None のときはフロントが Web Speech で読む
    text: str  # 字幕用（絵文字なし、読み補正前）
    last: bool


def cache_key(tts_str: str, seed: int = DEFAULT_SEED, profile: str = "") -> str:
    """TTS に送る文字列 + seed（+ 声の設定の識別子）の sha256 先頭 16 文字。

    profile は TTS サーバーの /health の voice_profile。話す速さや声の固定を変えたときに、
    古い設定で作った音声のキャッシュを再利用しないために混ぜる（空なら従来のキー）。"""
    suffix = f"\n{profile}" if profile else ""
    return hashlib.sha256(f"{tts_str}\n{seed}{suffix}".encode("utf-8")).hexdigest()[:16]


_END = object()


class VoiceService:
    engine = "irodori"
    cache_namespace = ""
    def __init__(
        self,
        tts_url: str | None = None,
        cache_dir: str | Path | None = None,
        seed: int = DEFAULT_SEED,
        timeout_s: float = SYNTH_TIMEOUT_S,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.tts_url = (tts_url or os.environ.get("PIANO_COACH_TTS_URL") or DEFAULT_TTS_URL).rstrip("/")
        self.cache_dir = Path(cache_dir or os.environ.get("PIANO_COACH_TTS_CACHE") or DEFAULT_CACHE_DIR)
        self.seed = seed
        self._voice_profile: str | None = None
        self._batch_utterances = False
        self.last_error: str | None = None
        self.timeout_s = timeout_s
        self._client = client
        self._own_client = client is None
        self._cancelled: set[str] = set()
        self._synth_lock: asyncio.Lock | None = None

    # ---- 公開 API ------------------------------------------------------

    async def speak_text(self, utterance_id: str, text: str) -> AsyncIterator[VoiceClip]:
        async def one() -> AsyncIterator[str]:
            yield text

        async for clip in self.speak(utterance_id, one()):
            yield clip

    async def speak(self, utterance_id: str, text_stream: AsyncIterator[str]) -> AsyncIterator[VoiceClip]:
        """文が 1 つそろうたびに合成し、できた順に VoiceClip を返す。

        テキストの受信は別タスクで続けるので、前の文の合成中にも次の文が溜まる。
        最後のクリップだけ last=True にするため、クリップは「次の文が来る」か
        「ストリームが終わる」まで 1 つ保留する（合成の完了は待たない）。
        """
        await self._profile()
        queue: asyncio.Queue = asyncio.Queue()
        reader = asyncio.create_task(self._read(text_stream, queue))
        seq = 0
        held: VoiceClip | None = None
        try:
            while True:
                item = await queue.get()
                if item is _END:
                    break
                if isinstance(item, BaseException):
                    raise item
                if self._is_cancelled(utterance_id):
                    break
                # 次の文が来たので、保留していた前のクリップは last=False で先に送り出す
                # （この文の合成を待たせない）。
                if held is not None:
                    yield held
                    held = None
                sub, tts_str = item
                url = await self._synthesize(tts_str)
                if self._is_cancelled(utterance_id):
                    break
                held = VoiceClip(utterance_id, seq, url, sub, False)
                seq += 1
            if held is not None and not self._is_cancelled(utterance_id):
                held.last = True
                yield held
        finally:
            reader.cancel()
            # Cancellation alone does not reap a task; a disconnected WebSocket used
            # to leave this reader awaiting its input stream indefinitely.
            await asyncio.gather(reader, return_exceptions=True)
            self._cancelled.discard(utterance_id)

    def cancel(self, utterance_id: str) -> None:
        """その発話の、未合成の文を捨てる（合成中のものも結果を捨てる）。"""
        self._cancelled.add(utterance_id)

    async def warmup_phrases(self) -> None:
        await self._profile()
        if self._batch_utterances:
            return  # Cloud TTS: do not spend requests on unsolicited startup audio.
        for phrase in WARMUP_PHRASES:
            tts_str = tts_text(phrase)
            try:
                await self._synthesize(tts_str)
            except Exception:  # noqa: BLE001
                log.exception("warmup failed: %s", phrase)

    async def aclose(self) -> None:
        if self._client is not None and self._own_client:
            await self._client.aclose()
            self._client = None

    # ---- 内部 ----------------------------------------------------------

    def _is_cancelled(self, utterance_id: str) -> bool:
        return utterance_id in self._cancelled

    async def _read(self, text_stream: AsyncIterator[str], queue: asyncio.Queue) -> None:
        splitter = SentenceSplitter()
        try:
            if self._batch_utterances:
                chunks = [chunk async for chunk in text_stream]
                text = "".join(chunks)
                # The bridge accepts at most 400 characters. Typical tutor turns
                # fit in one request, instead of one request per sentence.
                for start in range(0, len(text), 350):
                    self._enqueue(queue, text[start:start + 350])
                queue.put_nowait(_END)
                return
            async for chunk in text_stream:
                for sentence in splitter.feed(chunk):
                    self._enqueue(queue, sentence)
            for sentence in splitter.finish():
                self._enqueue(queue, sentence)
            queue.put_nowait(_END)
        except asyncio.CancelledError:
            raise
        except BaseException as e:  # noqa: BLE001
            queue.put_nowait(e)

    @staticmethod
    def _enqueue(queue: asyncio.Queue, sentence: str) -> None:
        sub = subtitle_text(sentence)
        if not _SPEAKABLE_RE.search(sub):
            return  # 空白・絵文字・記号だけの文は捨てる
        queue.put_nowait((sub, tts_text(sentence)))

    async def _profile(self) -> str:
        """TTS サーバーの声の設定の識別子。最初の 1 回だけ取得して覚える（取得できなければ空。次回また試す）。"""
        if self._voice_profile is None:
            try:
                if self._client is None:
                    self._client = httpx.AsyncClient(timeout=self.timeout_s)
                reply = await self._client.get(f"{self.tts_url}/health", timeout=2.0)
                reply.raise_for_status()
                metadata = reply.json()
                self._batch_utterances = str(metadata.get("model", "")).startswith("gemini-")
                self._voice_profile = str(metadata.get("voice_profile") or "")
            except Exception:  # noqa: BLE001  TTS が起動していない間は、従来のキーで続ける
                return ""
        return self._voice_profile

    def _path(self, key: str) -> Path:
        return self.cache_dir / f"{key}.wav"

    async def _synthesize(self, tts_str: str) -> str | None:
        """キャッシュを確認し、無ければ TTS サーバーで合成する。失敗・タイムアウトは None。"""
        key = cache_key(f"{self.cache_namespace}\n{tts_str}" if self.cache_namespace else tts_str, self.seed, await self._profile())
        path = self._path(key)
        url = f"/api/tts/{key}.wav"
        if path.exists() and path.stat().st_size > 0:
            return url
        if self._synth_lock is None:
            self._synth_lock = asyncio.Lock()
        async with self._synth_lock:
            if path.exists() and path.stat().st_size > 0:  # 待っている間に別の呼び出しが作った
                return url
            t = time.perf_counter()
            try:
                wav = await asyncio.wait_for(self._request(tts_str), timeout=self.timeout_s)
            except asyncio.TimeoutError:
                log.warning("tts timeout (%.1fs): %r", self.timeout_s, tts_str)
                return None
            except Exception as e:  # noqa: BLE001  接続不可、HTTP エラーなど
                log.warning("tts failed: %s: %r", type(e).__name__, tts_str)
                return None
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".wav.tmp")
            tmp.write_bytes(wav)
            tmp.replace(path)
            log.info("tts %.2fs %r", time.perf_counter() - t, tts_str)
            return url

    async def _request(self, tts_str: str) -> bytes:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self.timeout_s)
        r = await self._client.post(
            f"{self.tts_url}/synthesize", json={"text": tts_str, "seed": self.seed}, timeout=self.timeout_s
        )
        if not r.is_success:
            try:
                self.last_error = str(r.json().get("detail", "音声合成に失敗しました"))
            except (ValueError, AttributeError):
                self.last_error = "音声合成に失敗しました"
        else:
            self.last_error = None
        r.raise_for_status()
        if not r.content.startswith(b"RIFF"):
            raise ValueError("TTS response is not a wav")
        return r.content
