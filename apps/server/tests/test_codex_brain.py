import asyncio
import json
from pathlib import Path

import pytest

from piano_coach.brain import ActionReady, BrainError, CodexBrain, SayDelta
from piano_coach.brain.codex import check_subscription_environment, codex_executable


@pytest.mark.parametrize('name', ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CODEX_API_KEY'])
def test_subscription_rejects_api_keys(monkeypatch, name):
    monkeypatch.setenv(name, 'test-key')
    with pytest.raises(RuntimeError, match=name):
        check_subscription_environment()


async def test_codex_conversation_and_invalid_output(monkeypatch):
    brain = CodexBrain()
    await brain.open(system_prompt='teacher')
    prompts = []
    async def request(prompt, **kwargs):
        prompts.append(prompt)
        return '<say>こんにちは</say><action>{"type":"next"}</action>'
    monkeypatch.setattr(brain, '_request', request)
    events = [event async for event in brain.send('first')]
    assert any(isinstance(event, SayDelta) for event in events)
    assert any(isinstance(event, ActionReady) for event in events)
    await anext(brain.send('second'))
    assert 'first' in prompts[-1] and 'second' in prompts[-1]
    async def invalid(prompt, **kwargs):
        return 'invalid'
    monkeypatch.setattr(brain, '_request', invalid)
    assert isinstance(await anext(brain.send('third')), BrainError)
    await brain.close()
    assert isinstance(await anext(brain.send('closed')), BrainError)


async def test_cli_isolation_images_and_structured_output(monkeypatch, tmp_path):
    calls = []
    class Process:
        returncode = None
        async def communicate(self, text):
            self.returncode = 0
            return None, b''
        def kill(self):
            self.returncode = -9
        async def wait(self):
            return self.returncode
    async def spawn(*args, **kwargs):
        calls.append((args, kwargs))
        Path(args[args.index('--output-last-message') + 1]).write_text('{"ok":true}')
        schema = json.loads(Path(args[args.index('--output-schema') + 1]).read_text())
        assert schema['additionalProperties'] is False
        return Process()
    monkeypatch.setattr(asyncio, 'create_subprocess_exec', spawn)
    brain = CodexBrain()
    result = await brain._request('hello', images=[tmp_path/'page.png'], schema={'type':'object','properties':{'ok':{'type':'boolean'}},'required':['ok']})
    args, kwargs = calls[0]
    assert '--ignore-user-config' in args and '--ephemeral' in args
    assert 'forced_login_method="chatgpt"' in args
    assert str((tmp_path/'page.png').resolve()) in args
    assert kwargs['cwd'] != str(Path.cwd())
    assert result == '{"ok":true}'
    assert not brain.processes


async def test_cancelled_cli_is_killed_and_reaped(monkeypatch):
    started = asyncio.Event()
    class Process:
        returncode = None
        waited = False
        async def communicate(self, text):
            started.set()
            await asyncio.Future()
        def kill(self):
            self.returncode = -9
        async def wait(self):
            self.waited = True
    process = Process()
    async def spawn(*args, **kwargs):
        return process
    monkeypatch.setattr(asyncio, 'create_subprocess_exec', spawn)
    brain = CodexBrain()
    task = asyncio.create_task(brain._request('hello'))
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert process.returncode == -9 and process.waited
    assert not brain.processes


def test_cli_path_prefers_desktop_binary(monkeypatch):
    monkeypatch.delenv("PIANO_COACH_CODEX_BIN", raising=False)
    monkeypatch.setenv("CODEX_CLI_PATH", "/desktop/codex")
    assert codex_executable() == "/desktop/codex"
    monkeypatch.setenv("PIANO_COACH_CODEX_BIN", "/custom/codex")
    assert codex_executable() == "/custom/codex"


async def test_hearing_uses_luna_and_plan_uses_regular_tutor(monkeypatch):
    brain = CodexBrain()
    await brain.open(system_prompt='teacher')
    calls = []
    async def request(prompt, **kwargs):
        model = kwargs.get('model')
        calls.append((prompt, model))
        if model == 'gpt-6-luna':
            return '<say>経験は？</say><action>{"type":"ask"}</action>'
        return '<say>計画です</say><action>{"type":"set_plan"}</action>'
    monkeypatch.setattr(brain, '_request', request)
    for message in ('[SONG_LOADED]\n{}', '[HEARING_ANSWER]\n{"answer":"はじめて"}', '[HEARING_ANSWER]\n{"answer":"右手"}'):
        events = [e async for e in brain.send(message)]
        assert len([e for e in events if isinstance(e, ActionReady)]) == 1
    assert [model for _, model in calls] == ['gpt-6-luna', 'gpt-6-luna', None]
    assert 'はじめて' in calls[-1][0] and '右手' in calls[-1][0]
    assert len(calls) == 3  # No wasted Luna plan generation before Sol.
    await brain.close()
