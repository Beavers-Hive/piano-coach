"""Deterministic brain for local WebSocket integration tests and demo recovery."""
from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator

from piano_coach.brain.base import ActionReady, BrainError, BrainEvent, BrainInput, SayDelta


def _message_parts(message: BrainInput) -> tuple[str, dict]:
    text = message if isinstance(message, str) else ""
    header, _, body = text.partition("\n")
    try:
        return header.strip("[]"), json.loads(body or "{}")
    except json.JSONDecodeError:
        return header.strip("[]"), {}


class ScriptedBrain:
    def __init__(self) -> None:
        self.answer_count = 0
        self.low_attempt_count = 0
        self.drill_return_exercise: dict | None = None

    async def open(self, **_: object) -> str:
        return "scripted-session"

    async def close(self) -> None:
        return None

    async def send(self, message: BrainInput) -> AsyncIterator[BrainEvent]:
        kind, body = _message_parts(message)
        if os.environ.get("PIANO_COACH_FAKE_BRAIN_MODE") == "timeout":
            yield BrainError(reason="scripted timeout")
            return
        if os.environ.get("PIANO_COACH_FAKE_BRAIN_MODE") == "broken_json":
            yield ActionReady(action={"type": "not_implemented"})
            return
        if kind == "SONG_LOADED":
            yield SayDelta(text="メヌエットだね。いっしょに楽しくひいていこう😊")
            yield ActionReady(action={"type": "ask", "question": {"id": "experience", "text": "ピアノの経験はどれくらいですか？", "options": ["はじめて", "少し弾ける"], "allowFree": True}})
        elif kind == "HEARING_ANSWER":
            self.answer_count += 1
            if self.answer_count == 1:
                yield SayDelta(text="教えてくれてありがとう。どこから始めたい？")
                yield ActionReady(action={"type": "ask", "question": {"id": "range", "text": "どこからひきたいですか？", "options": ["最初から", "右手から"], "allowFree": True}})
            else:
                spec = {"measures": [1, 8], "hand": "right", "tempoPercent": 60, "mode": "wait", "loop": 1, "metronome": True}
                yield SayDelta(text="最初は右手を小さく分けて進めよう💪")
                yield ActionReady(action={"type": "set_plan", "plan": {"goal": "最初のフレーズをひけるようになる", "steps": [
                    {"title": "右手を確認", "description": "右手をゆっくり確認", "exercise": spec},
                    {"title": "右手でひく", "description": "リズムに合わせる", "exercise": {**spec, "mode": "play"}},
                ]}})
        elif kind == "PLAN_ACCEPTED":
            spec = body.get("exercise") or {"measures": [1, 8], "hand": "right", "tempoPercent": 60, "mode": "watch", "loop": 1, "metronome": True}
            yield SayDelta(text="まずはお手本を見てみよう。")
            yield ActionReady(action={"type": "demo", "exercise": {**spec, "mode": "watch"}})
        elif kind == "DEMO_FINISHED":
            spec = body.get("exercise") or {"measures": [1, 8], "hand": "right", "tempoPercent": 60, "mode": "wait", "loop": 1, "metronome": True}
            yield SayDelta(text="いいね。今度は自分でひいてみよう。")
            yield ActionReady(action={"type": "start_exercise", "exercise": {**spec, "mode": "wait"}})
        elif kind == "RESUME":
            spec = body.get("currentExercise") or {"measures": [1, 8], "hand": "right", "tempoPercent": 60, "mode": "wait", "loop": 1, "metronome": True}
            yield SayDelta(text="おかえりなさい。前回の続きからいこう😊")
            yield ActionReady(action={"type": "start_exercise", "exercise": {**spec, "mode": "wait"}})
        elif kind == "ATTEMPT_RESULT":
            exercise = body.get("exercise") or {}
            summary = body.get("summary") or {}
            total = summary.get("total", 0)
            accuracy = (summary.get("perfect", 0) + summary.get("good", 0)) / total if total else 0
            if exercise.get("drill"):
                if accuracy >= .95 and self.drill_return_exercise:
                    restored, self.drill_return_exercise = self.drill_return_exercise, None
                    self.low_attempt_count = 0
                    yield SayDelta(text="準備運動ができたね。もとのフレーズに戻ろう。")
                    yield ActionReady(action={"type": "start_exercise", "exercise": restored})
                    return
                yield SayDelta(text="指を順番に動かして、もう一回やってみよう。")
                yield ActionReady(action={"type": "retry"})
                return
            if body.get("suggestedVerdict") == "retry" and accuracy < .70:
                self.low_attempt_count += 1
                if self.low_attempt_count >= 2:
                    self.low_attempt_count = 0
                    self.drill_return_exercise = exercise
                    hand = exercise.get("hand", "right")
                    yield SayDelta(text="いったん曲から離れて、指の準備運動をしよう。")
                    yield ActionReady(action={"type": "start_exercise", "exercise": {
                        **exercise, "hand": hand, "tempoPercent": 60, "mode": "wait", "loop": 1,
                        "focus": "5本の指を順番に", "drill": {"kind": "five_finger", "startPitch": 60, "key": "C", "bars": 2},
                    }})
                    return
            else:
                self.low_attempt_count = 0
            verdict = body.get("suggestedVerdict", "retry")
            yield SayDelta(text="よくできたね。")
            yield ActionReady(action={"type": verdict})
        elif kind == "STEP_STARTED":
            yield SayDelta(text="次の練習に進もう。")
            yield ActionReady(action={"type": "start_exercise", "exercise": body["exercise"]})
        else:
            yield SayDelta(text="分かったよ。続けよう。")
            yield ActionReady(action={"type": "retry"})

    @staticmethod
    async def analyze_pages(_: list, summary: dict) -> dict:
        count = summary["measureCount"]
        return {"title": "メヌエット ト長調", "summary": "やさしい三拍子の曲だよ。いっしょにひいてみよう😊", "sections": [{"name": "全体", "measures": [1, count]}]}

    @staticmethod
    async def design_fingering(compact_score: str, _: list[str] | None = None) -> dict:
        import re
        ids = re.findall(r"\b([RL]-\d{4})\b", compact_score)
        return {"fingering": [{"id": note_id, "finger": (index % 5) + 1} for index, note_id in enumerate(dict.fromkeys(ids))], "events": []}
