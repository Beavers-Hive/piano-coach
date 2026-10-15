from __future__ import annotations

import asyncio
import json
import os
import shutil
import tempfile
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from piano_coach.brain.base import BrainError, BrainEvent, BrainInput
from piano_coach.brain.claude import TagStreamParser, load_prompt


def codex_executable() -> str:
    return os.environ.get("PIANO_COACH_CODEX_BIN") or os.environ.get("CODEX_CLI_PATH") or "codex"


def check_subscription_environment() -> None:
    for name in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY"):
        if os.environ.get(name):
            raise RuntimeError(f"{name} must be unset; this app uses ChatGPT subscription login")


def strict_schema(value: Any) -> Any:
    if isinstance(value, dict):
        value = {key: strict_schema(item) for key, item in value.items()}
        if value.get("type") == "object":
            value["additionalProperties"] = False
        return value
    if isinstance(value, list):
        return [strict_schema(item) for item in value]
    return value


class CodexBrain:
    """Codex CLI adapter with isolated settings and explicit conversation history.

    Runs outside the repository so project instructions cannot affect the teacher.
    Cancellation always reaps the CLI process, including one-shot score requests.
    """

    def __init__(self) -> None:
        self.session_id = ""
        self.system_prompt = ""
        self.history: list[dict[str, str]] = []
        self.model: str | None = None
        self.processes: set[asyncio.subprocess.Process] = set()
        self.opened = False

    async def open(self, *, system_prompt: str | None = None,
                   resume_id: str | None = None, model: str | None = None) -> str:
        check_subscription_environment()
        if resume_id:
            raise ValueError("Codex CLI sessions are ephemeral; restore lesson state with [RESUME]")
        if not shutil.which(codex_executable()):
            raise RuntimeError("Codex CLI is required: install it and run codex login")
        self.system_prompt = system_prompt or load_prompt("tutor_system.md", "You are a kind piano teacher.")
        self.model = model or os.environ.get("PIANO_COACH_CODEX_MODEL")
        self.history = []
        self.session_id = str(uuid.uuid4())
        self.opened = True
        return self.session_id

    async def _request(self, prompt: str, *, images: list[Path] | None = None,
                       schema: dict | None = None, model: str | None = None,
                       effort: str = "low") -> str:
        check_subscription_environment()
        with tempfile.TemporaryDirectory(prefix="piano-coach-codex-") as directory:
            output = Path(directory) / "response.txt"
            args = [codex_executable(), "--ask-for-approval", "never", "exec", "--ignore-user-config",
                    "--ignore-rules", "--ephemeral", "--skip-git-repo-check",
                    "--sandbox", "read-only", "--color", "never", "--cd", directory,
                    "-c", 'forced_login_method="chatgpt"',
                    "-c", 'web_search="disabled"',
                    "-c", f'model_reasoning_effort={json.dumps(effort)}',
                    "--output-last-message", str(output)]
            for feature in ("shell_tool", "unified_exec", "apps", "plugins", "hooks",
                            "multi_agent", "multi_agent_v2", "computer_use", "image_generation",
                            "memories"):
                args.extend(["--disable", feature])
            selected_model = model or self.model or os.environ.get("PIANO_COACH_CODEX_MODEL", "gpt-6.1-sol")
            if selected_model:
                args.extend(["--model", selected_model])
            if schema:
                schema_path = Path(directory) / "schema.json"
                schema_path.write_text(json.dumps(strict_schema(schema)), encoding="utf-8")
                args.extend(["--output-schema", str(schema_path)])
            for path in images or []:
                args.extend(["--image", str(path.resolve())])
            args.append("-")
            env = {key: value for key, value in os.environ.items()
                   if key in {"HOME", "USER", "PATH", "LANG", "LC_ALL", "TMPDIR", "CODEX_HOME"}}
            process = await asyncio.create_subprocess_exec(
                *args, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE, cwd=directory, env=env)
            self.processes.add(process)
            try:
                async with asyncio.timeout(120):
                    _, stderr = await process.communicate(prompt.encode("utf-8"))
                if process.returncode:
                    raise RuntimeError(f"Codex exited {process.returncode}: {stderr.decode(errors='replace')[-1500:]}")
                result = output.read_text(encoding="utf-8").strip()
                if not result:
                    raise RuntimeError("Codex returned an empty response")
                return result
            finally:
                if process.returncode is None:
                    process.kill()
                    await process.wait()
                self.processes.discard(process)

    async def send(self, message: BrainInput) -> AsyncIterator[BrainEvent]:
        if not self.opened:
            yield BrainError(reason="brain is not open")
            return
        text = message if isinstance(message, str) else json.dumps(message, ensure_ascii=False)
        conversation = self.history + [{"role": "user", "content": text}]
        prompt = (self.system_prompt + "\nUse no tools. Return only <say>...</say><action>{...}</action>.\n"
                  + json.dumps(conversation, ensure_ascii=False))
        try:
            response = await self._request(prompt)
            events = TagStreamParser().feed(response, final=True)
            from piano_coach.brain.base import ActionReady
            if not any(isinstance(event, ActionReady) for event in events):
                raise ValueError("Codex response has no complete action")
            self.history = conversation + [{"role": "assistant", "content": response}]
            for event in events:
                yield event
        except Exception as error:
            yield BrainError(reason=str(error))

    async def close(self) -> None:
        self.opened = False
        for process in tuple(self.processes):
            if process.returncode is None:
                process.kill()
                await process.wait()
        self.processes.clear()

    @staticmethod
    async def analyze_pages(page_paths: list[Path], score_summary: dict[str, Any]) -> dict[str, Any]:
        brain = CodexBrain()
        prompt = load_prompt("analyze_system.md", "Analyze the piano score and return JSON.")
        response = await brain._request(prompt + "\n" + json.dumps({"kind": "SONG_ANALYZE", **score_summary}, ensure_ascii=False),
                                        images=page_paths, schema=ANALYSIS_SCHEMA)
        result = json.loads(response)
        if not isinstance(result, dict) or not result.get("title") or not result.get("summary") or not isinstance(result.get("sections"), list):
            raise ValueError("Codex analysis did not return valid structured output")
        return result

    @staticmethod
    async def design_fingering(compact_score: str, violations: list[str] | None = None) -> dict[str, Any]:
        brain = CodexBrain()
        prompt = load_prompt("fingering_system.md", "Design ergonomic piano fingering and return JSON.")
        user_input = "[FINGERING]\n" + compact_score
        if violations:
            user_input += "\nViolations to fix:\n" + "\n".join(violations)
        response = await brain._request(prompt + "\n" + user_input, schema=FINGERING_SCHEMA,
                                        model=os.environ.get("PIANO_COACH_CODEX_FINGERING_MODEL"),
                                        effort=os.environ.get("PIANO_COACH_FINGERING_EFFORT", "high"))
        result = json.loads(response)
        if not isinstance(result, dict) or not isinstance(result.get("fingering"), list) or not isinstance(result.get("events"), list):
            raise ValueError("Codex fingering did not return valid structured output")
        return result


ANALYSIS_SCHEMA = {'type': 'object', 'properties': {'title': {'type': 'string'}, 'summary': {'type': 'string'}, 'sections': {'type': 'array', 'items': {'type': 'object', 'properties': {'name': {'type': 'string'}, 'measures': {'type': 'array', 'items': {'type': 'integer'}, 'minItems': 2, 'maxItems': 2}}, 'required': ['name', 'measures']}}}, 'required': ['title', 'summary', 'sections']}
FINGERING_SCHEMA = {'type': 'object', 'properties': {'fingering': {'type': 'array', 'items': {'type': 'object', 'properties': {'id': {'type': 'string'}, 'finger': {'type': 'integer', 'minimum': 1, 'maximum': 5}}, 'required': ['id', 'finger']}}, 'events': {'type': 'array', 'items': {'type': 'object', 'properties': {'noteId': {'type': 'string'}, 'type': {'type': 'string', 'enum': ['thumb_under', 'finger_over', 'position_shift', 'stretch']}, 'measure': {'type': 'integer'}, 'tip': {'type': 'string'}}, 'required': ['noteId', 'type', 'measure', 'tip']}}}, 'required': ['fingering', 'events']}
