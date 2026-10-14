from __future__ import annotations

import json
from typing import AsyncIterator, Protocol, TypeAlias
from pydantic import BaseModel


class SayDelta(BaseModel):
    text: str


class ActionReady(BaseModel):
    action: dict


class BrainError(BaseModel):
    reason: str


BrainEvent: TypeAlias = SayDelta | ActionReady | BrainError
BrainInput: TypeAlias = str | dict


def format_message(kind: str, payload: dict) -> str:
    """Wire format mandated by prompts/tutor_system.md."""
    return f"[{kind}]\n{json.dumps(payload, ensure_ascii=False)}"


class TutorBrain(Protocol):
    async def open(self, *, system_prompt: str, resume_id: str | None = None, model: str = "sonnet") -> str: ...
    async def send(self, message: BrainInput) -> AsyncIterator[BrainEvent]: ...
    async def close(self) -> None: ...
