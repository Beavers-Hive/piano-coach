"""Gemini tutor over the Vertex AI GenerateContent API (service account / ADC)."""
from __future__ import annotations

import base64
import json
import logging
import os
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from piano_coach.brain.base import ActionReady, BrainError, BrainEvent, BrainInput
from piano_coach.brain.claude import TagStreamParser, load_prompt
from piano_coach.brain.codex import ANALYSIS_SCHEMA, FINGERING_SCHEMA
from piano_coach.google_cloud import GoogleCloudAPI

log = logging.getLogger(__name__)
DEFAULT_MODEL = "gemini-3.5-flash"
DEFAULT_ANALYSIS_MODEL = "gemini-3.1-flash-lite"
DEFAULT_FINGERING_MODEL = "gemini-3.1-flash-lite"


def configured() -> bool:
    return bool(os.environ.get("GOOGLE_CLOUD_PROJECT"))


class GeminiBrain:
    """No tools, shell, connectors or external browsing are exposed to the tutor."""
    def __init__(self) -> None:
        self.api = GoogleCloudAPI()
        self.history: list[dict] = []
        self.system_prompt = ""
        self.model = os.environ.get("PIANO_COACH_GEMINI_MODEL", DEFAULT_MODEL)
        self.opened = False
        self.session_id = ""

    async def open(self, *, system_prompt: str | None = None,
                   resume_id: str | None = None, model: str | None = None) -> str:
        if not configured():
            raise RuntimeError("GOOGLE_CLOUD_PROJECT is required for Gemini on Vertex AI")
        if resume_id:
            raise ValueError("Restore lesson state using [RESUME], not a provider session id")
        self.system_prompt = system_prompt or load_prompt("tutor_system.md", "You are a kind piano teacher.")
        self.model = model or self.model
        self.history = []
        self.opened = True
        self.session_id = str(uuid.uuid4())
        return self.session_id

    async def _generate(self, system: str, contents: list[dict], *,
                        schema: dict | None = None, model: str | None = None,
                        thinking_level: str = "MINIMAL", max_output_tokens: int = 8192,
                        timeout: float = 60) -> str:
        project = os.environ.get("GOOGLE_CLOUD_PROJECT")
        if not project:
            raise RuntimeError("GOOGLE_CLOUD_PROJECT is required")
        location = os.environ.get("GOOGLE_CLOUD_LOCATION", "global")
        host = "aiplatform.googleapis.com" if location == "global" else f"{location}-aiplatform.googleapis.com"
        selected_model = model or self.model
        endpoint = f"https://{host}/v1/projects/{project}/locations/{location}/publishers/google/models/{selected_model}:generateContent"
        config: dict[str, Any] = {"maxOutputTokens": max_output_tokens}
        if selected_model.startswith("gemini-3"):
            config["thinkingConfig"] = {"thinkingLevel": thinking_level}
        if schema is not None:
            config.update(responseMimeType="application/json", responseSchema=schema)
        result = await self.api.post(endpoint, {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": contents,
            "generationConfig": config,
        }, timeout=timeout)
        candidates = result.get("candidates") or []
        if not candidates:
            raise ValueError("Gemini returned no candidate")
        candidate = candidates[0]
        if candidate.get("finishReason") not in {None, "STOP"}:
            raise ValueError(f"Gemini response did not finish: {candidate.get('finishReason')}")
        text = "".join(part.get("text", "") for part in candidate.get("content", {}).get("parts", []) if not part.get("thought"))
        if not text.strip():
            raise ValueError("Gemini returned no text")
        usage = result.get("usageMetadata", {})
        log.info("gemini model=%s input_tokens=%s output_tokens=%s", selected_model,
                 usage.get("promptTokenCount"), usage.get("candidatesTokenCount"))
        return text.strip()

    async def send(self, message: BrainInput) -> AsyncIterator[BrainEvent]:
        if not self.opened:
            yield BrainError(reason="brain is not open")
            return
        text = message if isinstance(message, str) else json.dumps(message, ensure_ascii=False)
        conversation = self.history + [{"role": "user", "parts": [{"text": text}]}]
        try:
            response = await self._generate(self.system_prompt, conversation)
            events = TagStreamParser().feed(response, final=True)
            if any(isinstance(event, BrainError) for event in events) or not any(isinstance(event, ActionReady) for event in events):
                raise ValueError("Gemini returned no complete valid action")
            self.history = conversation + [{"role": "model", "parts": [{"text": response}]}]
            for event in events:
                yield event
        except Exception as error:
            log.warning("Gemini lesson request failed: %s", error)
            yield BrainError(reason=str(error))

    async def analyze_pages(self, page_paths: list[Path], score_summary: dict[str, Any]) -> dict[str, Any]:
        parts: list[dict] = [{"text": json.dumps({"kind": "SONG_ANALYZE", **score_summary}, ensure_ascii=False)}]
        for page in page_paths:
            parts.append({"inlineData": {"mimeType": "image/png", "data": base64.b64encode(page.read_bytes()).decode()}})
        response = await self._generate(load_prompt("analyze_system.md", "Analyze the score. Return JSON."),
                                        [{"role": "user", "parts": parts}], schema=ANALYSIS_SCHEMA,
                                        model=os.environ.get("PIANO_COACH_GEMINI_ANALYSIS_MODEL", DEFAULT_ANALYSIS_MODEL))
        result = json.loads(response)
        if not isinstance(result, dict) or not result.get("title") or not result.get("summary") or not isinstance(result.get("sections"), list):
            raise ValueError("Gemini analysis did not return valid structured output")
        return result

    async def design_fingering(self, compact_score: str, violations: list[str] | None = None) -> dict[str, Any]:
        text = "[FINGERING]\n" + compact_score
        if violations:
            text += "\nViolations to fix:\n" + "\n".join(violations)
        response = await self._generate(load_prompt("fingering_system.md", "Design fingering. Return JSON."),
            [{"role": "user", "parts": [{"text": text}]}], schema=FINGERING_SCHEMA,
            model=os.environ.get("PIANO_COACH_GEMINI_FINGERING_MODEL", DEFAULT_FINGERING_MODEL),
            thinking_level="MINIMAL", max_output_tokens=8192, timeout=90)
        result = json.loads(response)
        if not isinstance(result, dict) or not isinstance(result.get("fingering"), list) or not isinstance(result.get("events"), list):
            raise ValueError("Gemini fingering did not return valid structured output")
        return result

    async def close(self) -> None:
        self.opened = False
        await self.api.aclose()
