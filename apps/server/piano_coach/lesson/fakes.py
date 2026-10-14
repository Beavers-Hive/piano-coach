from __future__ import annotations

from dataclasses import dataclass
from typing import AsyncIterator


@dataclass
class FakeClip:
    utterance_id: str
    seq: int
    url: str | None
    text: str
    last: bool


class FakeVoiceService:
    async def speak(self, utterance_id: str, text_stream: AsyncIterator[str]) -> AsyncIterator[FakeClip]:
        text = ""
        async for chunk in text_stream:
            text += chunk
        if text:
            yield FakeClip(utterance_id, 0, None, text, True)

    async def speak_text(self, utterance_id: str, text: str) -> AsyncIterator[FakeClip]:
        yield FakeClip(utterance_id, 0, None, text, True)

    async def warmup_phrases(self) -> None:
        return None
