from __future__ import annotations

import base64
import json
import os
import logging
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from piano_coach.brain.base import ActionReady, BrainError, BrainEvent, BrainInput, SayDelta
from piano_coach.paths import PROMPTS_DIR

log = logging.getLogger(__name__)

def load_prompt(name: str, fallback: str) -> str:
    path = PROMPTS_DIR / name
    return path.read_text(encoding="utf-8") if path.exists() else fallback


# output_format を使うと、CLI は構造化出力のための内部ツールを 1 つだけ報告する。
# それ以外のツール（claude.ai コネクタ等）が見えたら、安全のため処理を止める。
STRUCTURED_OUTPUT_TOOLS = {"StructuredOutput"}


def _check_structured_tools(tools: list, kind: str) -> None:
    unexpected = [tool for tool in tools if tool not in STRUCTURED_OUTPUT_TOOLS]
    if unexpected:
        raise RuntimeError(f"unsafe Claude {kind} session initialized with tools: {unexpected[:5]}")


class TagStreamParser:
    """Consumes arbitrary token chunks and exposes only say deltas plus complete actions."""
    def __init__(self) -> None:
        self.buffer = ""
        self.in_say = False
        self.in_action = False

    def feed(self, chunk: str, final: bool = False) -> list[BrainEvent]:
        self.buffer += chunk
        output: list[BrainEvent] = []
        while self.buffer:
            if not self.in_say and not self.in_action:
                say_at, action_at = self.buffer.find("<say>"), self.buffer.find("<action>")
                starts = [value for value in (say_at, action_at) if value >= 0]
                if not starts:
                    # Preserve a possible split tag suffix.
                    keep = max((len(prefix) for prefix in ("<say>", "<action>") if self.buffer.endswith(prefix[:len(self.buffer)])), default=0)
                    self.buffer = self.buffer[-keep:] if keep else ""
                    break
                start = min(starts)
                tag = "<say>" if say_at == start else "<action>"
                self.buffer = self.buffer[start + len(tag):]
                self.in_say = tag == "<say>"
                self.in_action = not self.in_say
            if self.in_say:
                end = self.buffer.find("</say>")
                if end >= 0:
                    if end:
                        output.append(SayDelta(text=self.buffer[:end]))
                    self.buffer = self.buffer[end + len("</say>"):]
                    self.in_say = False
                    continue
                if final:
                    if self.buffer:
                        output.append(SayDelta(text=self.buffer))
                    self.buffer = ""
                    self.in_say = False
                elif len(self.buffer) > len("</say>"):
                    safe = len(self.buffer) - len("</say>") + 1
                    output.append(SayDelta(text=self.buffer[:safe]))
                    self.buffer = self.buffer[safe:]
                break
            if self.in_action:
                end = self.buffer.find("</action>")
                if end < 0:
                    if final:
                        output.append(BrainError(reason="action tag was not closed"))
                        self.buffer = ""
                        self.in_action = False
                    break
                raw = self.buffer[:end]
                self.buffer = self.buffer[end + len("</action>"):]
                self.in_action = False
                try:
                    parsed = json.loads(raw)
                    if not isinstance(parsed, dict):
                        raise ValueError("action must be an object")
                    output.append(ActionReady(action=parsed))
                except (ValueError, json.JSONDecodeError) as error:
                    output.append(BrainError(reason=f"invalid action JSON: {error}"))
        return output


class ClaudeBrain:
    """The sole Claude SDK adapter.  It deliberately exposes no tools or local settings."""
    def __init__(self) -> None:
        self.client: Any | None = None
        self.session_id: str = ""

    async def open(self, *, system_prompt: str | None = None, resume_id: str | None = None, model: str = "sonnet") -> str:
        if os.environ.get("ANTHROPIC_API_KEY"):
            raise RuntimeError("ANTHROPIC_API_KEY must be unset: this app uses Claude subscription login")
        from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient
        options: dict[str, Any] = {
            "system_prompt": system_prompt or load_prompt("tutor_system.md", "You are a kind piano teacher. Respond with <say>...</say><action>{...}</action>."),
            "model": "sonnet", "tools": [], "strict_mcp_config": True, "setting_sources": [],
            "include_partial_messages": True, "max_turns": 1,
        }
        if resume_id:
            options["resume"] = resume_id
        self.client = ClaudeSDKClient(options=ClaudeAgentOptions(**options))
        await self.client.__aenter__()
        # The SDK reports this in an init SystemMessage after the first query.  It is checked in send.
        return self.session_id

    async def send(self, message: BrainInput) -> AsyncIterator[BrainEvent]:
        if self.client is None:
            yield BrainError(reason="brain is not open")
            return
        text = message if isinstance(message, str) else json.dumps(message, ensure_ascii=False)
        parser = TagStreamParser()
        try:
            from claude_agent_sdk import ResultMessage, StreamEvent, SystemMessage
            await self.client.query(text)
            async for response in self.client.receive_response():
                if isinstance(response, SystemMessage) and response.subtype == "init":
                    tool_count = len(response.data.get("tools") or [])
                    if tool_count:
                        yield BrainError(reason=f"Claude SDK initialized with {tool_count} tools; refusing unsafe session")
                        return
                    self.session_id = str(response.data.get("session_id") or self.session_id)
                elif isinstance(response, StreamEvent):
                    event = response.event
                    if event.get("type") == "content_block_delta":
                        delta = event.get("delta", {})
                        if delta.get("type") == "text_delta":
                            for parsed in parser.feed(delta.get("text", "")):
                                yield parsed
                elif isinstance(response, ResultMessage):
                    self.session_id = str(getattr(response, "session_id", None) or self.session_id)
            for parsed in parser.feed("", final=True):
                yield parsed
        except Exception as error:  # fallback is owned by the orchestrator
            log.warning("Claude lesson request failed: %s", error)
            yield BrainError(reason=str(error))

    async def close(self) -> None:
        if self.client is not None:
            await self.client.__aexit__(None, None, None)
            self.client = None

    @staticmethod
    async def analyze_pages(page_paths: list[Path], score_summary: dict[str, Any]) -> dict[str, Any]:
        """One-shot structured image analysis. Kept separate from the long-lived lesson session."""
        if os.environ.get("ANTHROPIC_API_KEY"):
            raise RuntimeError("ANTHROPIC_API_KEY must be unset")
        from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient, ResultMessage, SystemMessage
        schema = {"type": "object", "properties": {"title": {"type": "string"}, "summary": {"type": "string"}, "sections": {"type": "array", "items": {"type": "object", "properties": {"name": {"type": "string"}, "measures": {"type": "array", "items": {"type": "integer"}, "minItems": 2, "maxItems": 2}}, "required": ["name", "measures"]}}}, "required": ["title", "summary", "sections"]}
        prompt = load_prompt("analyze_system.md", "Analyze the supplied piano score. Return only the requested JSON.")
        content: list[dict[str, Any]] = [{"type": "text", "text": json.dumps({"kind": "SONG_ANALYZE", **score_summary}, ensure_ascii=False)}]
        for page in page_paths:
            content.append({"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": base64.b64encode(page.read_bytes()).decode()}})
        options = ClaudeAgentOptions(system_prompt=prompt, model="sonnet", tools=[], strict_mcp_config=True,
            setting_sources=[], include_partial_messages=True, max_turns=3, output_format={"type": "json_schema", "schema": schema})
        async def messages() -> AsyncIterator[dict[str, Any]]:
            yield {"type": "user", "message": {"role": "user", "content": content}, "parent_tool_use_id": None}
        async with ClaudeSDKClient(options=options) as client:
            await client.query(messages())
            async for response in client.receive_response():
                if isinstance(response, SystemMessage) and response.subtype == "init":
                    _check_structured_tools(response.data.get("tools") or [], "analysis")
                if isinstance(response, ResultMessage) and getattr(response, "structured_output", None):
                    result = response.structured_output
                    if isinstance(result, dict) and result.get("title") and result.get("summary"):
                        return result
        raise RuntimeError("Claude analysis did not return structured output")

    @staticmethod
    async def design_fingering(compact_score: str, violations: list[str] | None = None) -> dict[str, Any]:
        """One-shot structured fingering session; never shares lesson conversation context."""
        if os.environ.get("ANTHROPIC_API_KEY"):
            raise RuntimeError("ANTHROPIC_API_KEY must be unset")
        from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient, ResultMessage, SystemMessage
        schema = {"type": "object", "properties": {
            "fingering": {"type": "array", "items": {"type": "object", "properties": {"id": {"type": "string"}, "finger": {"type": "integer", "minimum": 1, "maximum": 5}}, "required": ["id", "finger"]}},
            "events": {"type": "array", "items": {"type": "object", "properties": {"noteId": {"type": "string"}, "type": {"type": "string", "enum": ["thumb_under", "finger_over", "position_shift", "stretch"]}, "measure": {"type": "integer"}, "tip": {"type": "string"}}, "required": ["noteId", "type", "measure", "tip"]}}}, "required": ["fingering", "events"]}
        prompt = load_prompt("fingering_system.md", "Design ergonomic piano fingering. Return only the requested JSON.")
        user_input = "[FINGERING]\n" + compact_score
        if violations:
            user_input += "\nViolations to fix:\n" + "\n".join(violations)
        options = ClaudeAgentOptions(system_prompt=prompt, model="sonnet", tools=[], strict_mcp_config=True,
            setting_sources=[], include_partial_messages=True, max_turns=3, output_format={"type": "json_schema", "schema": schema})
        async with ClaudeSDKClient(options=options) as client:
            await client.query(user_input)
            async for response in client.receive_response():
                if isinstance(response, SystemMessage) and response.subtype == "init":
                    _check_structured_tools(response.data.get("tools") or [], "fingering")
                if isinstance(response, ResultMessage) and isinstance(getattr(response, "structured_output", None), dict):
                    return response.structured_output
        raise RuntimeError("Claude fingering did not return structured output")
