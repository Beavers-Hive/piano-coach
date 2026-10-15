from __future__ import annotations

import base64
import os

from piano_coach.google_cloud import GoogleCloudAPI
from piano_coach.voice.service import VoiceService


class GoogleVoiceService(VoiceService):
    engine = "google"

    def __init__(self, **kwargs) -> None:
        voice = os.environ.get("PIANO_COACH_GOOGLE_VOICE", "ja-JP-Neural2-B")
        # Separate providers/voices so an Irodori cache cannot be mistaken for Cloud TTS.
        super().__init__(**kwargs)
        self.cache_namespace = f"google:{voice}"
        self.voice_name = voice
        self.api = GoogleCloudAPI()
        self._batch_utterances = True

    async def _profile(self) -> str:
        return ""  # Cloud TTS has no local /health service; cache_namespace isolates its voice.

    async def _request(self, text: str) -> bytes:
        result = await self.api.post("https://texttospeech.googleapis.com/v1/text:synthesize", {
            "input": {"text": text},
            "voice": {"languageCode": "ja-JP", "name": self.voice_name},
            "audioConfig": {"audioEncoding": "LINEAR16", "speakingRate": 1.02},
        }, timeout=self.timeout_s)
        audio = base64.b64decode(result["audioContent"], validate=True)
        if not audio.startswith(b"RIFF"):
            raise ValueError("Cloud TTS response is not WAV")
        return audio

    async def aclose(self) -> None:
        await self.api.aclose()
        await super().aclose()
