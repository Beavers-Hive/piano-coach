from __future__ import annotations

import asyncio
import os
import json
import logging
import uuid
from collections import defaultdict
from collections.abc import AsyncIterator, Awaitable, Callable
from pathlib import Path
from typing import Any

from piano_coach.brain.base import ActionReady, BrainError, SayDelta, TutorBrain, format_message
from piano_coach.exercise.builder import DrillSpec, ExerciseBuilder, ExerciseSpec
from piano_coach.lesson.actions import AgentAction, validate_action
from piano_coach.lesson.verdict import RealtimeSummary, suggested_verdict
from piano_coach.paths import DATA_DIR
from piano_coach.score.fingering import FingeringEstimator
from piano_coach.score.model import ScoreModel

log = logging.getLogger(__name__)
Send = Callable[[str, dict], Awaitable[None]]
_END = object()
LESSON_TURN_TIMEOUT_S = 25
ANALYSIS_TIMEOUT_S = 60
# Opus（推論: 高）は 1 チャンクに数分かかることがある。事前生成のスクリプトでは、さらに長くする
FINGERING_CHUNK_TIMEOUT_S = float(os.environ.get("PIANO_COACH_FINGERING_TIMEOUT", "300"))


class LessonOrchestrator:
    def __init__(self, send: Send, brain: TutorBrain | None = None, voice: Any | None = None) -> None:
        self.send, self.brain, self.voice = send, brain, voice
        self._brain_factory = type(brain) if brain is not None else None
        self.state, self.score, self.plan, self.timeline = "idle", None, None, None
        self.exercise_version, self.awaiting_voice, self._step_index = 0, None, 0
        self._brain_lock, self._send_lock = asyncio.Lock(), asyncio.Lock()
        self._builder, self._queued_user_messages = ExerciseBuilder(), []
        self._attempt_counts: dict[tuple, int] = defaultdict(int)
        self._poor_retry_streak = 0
        self._poor_retry_key: tuple | None = None
        self._drill_return_spec: ExerciseSpec | None = None
        self._owned_tasks: set[asyncio.Task] = set()
        self._voice_workers: set[asyncio.Task] = set()
        self._active_utterances: set[str] = set()
        self._closed = False

    def _own_task(self, coroutine: Any) -> asyncio.Task:
        task = asyncio.create_task(coroutine)
        self._owned_tasks.add(task)
        task.add_done_callback(self._owned_tasks.discard)
        return task

    def set_brain(self, brain: TutorBrain | None) -> None:
        self.brain = brain
        if brain is not None:
            self._brain_factory = type(brain)

    async def _close_brain(self) -> None:
        if self.brain is not None:
            try:
                await self.brain.close()
            except Exception as error:
                log.warning("could not close brain: %s", error)
            self.brain = None

    async def _ensure_brain(self) -> bool:
        if self.brain is not None:
            return True
        if self._brain_factory is None or self._closed:
            return False
        try:
            self.brain = self._brain_factory()
            await self.brain.open()
            return True
        except Exception as error:
            log.warning("could not reopen lesson brain: %s", error)
            self.brain = None
            return False

    async def aclose(self) -> None:
        """Cancel work owned by this connection before its WebSocket disappears."""
        self._closed = True
        for utterance_id in self._active_utterances:
            cancel = getattr(self.voice, "cancel", None)
            if cancel:
                cancel(utterance_id)
        tasks = [*self._owned_tasks, *self._voice_workers]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._owned_tasks.clear()
        self._voice_workers.clear()
        await self._close_brain()

    async def emit(self, kind: str, payload: dict) -> None:
        async with self._send_lock:
            await self.send(kind, payload)

    async def transition(self, state: str) -> None:
        self.state = state
        await self.emit("lesson.state", {"state": state})

    def _song_dir(self) -> Path:
        assert self.score
        path = DATA_DIR / "songs" / self.score.songId
        path.mkdir(parents=True, exist_ok=True)
        return path

    async def start(self, score: ScoreModel, page_urls: list[str], page_paths: list[Path]) -> None:
        self.score = score
        await self.transition("analyzing")
        await self.emit("song.ready", {"score": score.model_dump(mode="json"), "pageImageUrls": page_urls})
        analysis = await self._analysis(page_paths)
        await self.emit("song.analysis", analysis)
        await self.transition("hearing")
        action = await self._brain_turn("SONG_LOADED", self._song_payload(analysis))
        # 運指の設計（別の Claude プロセス）は、先生の最初の発話が終わってから始める。
        # 同時に起動すると CPU とメモリが混み合い、最初の発話の音声合成が 6〜9 秒かかって代替音声になっていた。
        # 運指はお手本（計画の後）までに間に合えばよい。
        self._own_task(self.estimate_fingering())
        if action: await self.apply_action(action)
        else: await self.ask_fallback(0)

    def _song_payload(self, analysis: dict) -> dict:
        assert self.score
        counts = {measure.index: {"right": 0, "left": 0} for measure in self.score.measures}
        for note in self.score.notes: counts[note.measure][note.hand] += 1
        return {"title": analysis.get("title", self.score.title), "timeSignature": self.score.timeSignature.model_dump(), "bpm": self.score.bpm,
                "measureCount": len(self.score.measures), "sections": analysis.get("sections", []),
                "notesPerMeasure": [{"measure": number, **count} for number, count in counts.items()]}

    async def _analysis(self, page_paths: list[Path]) -> dict:
        assert self.score
        cache = self._song_dir() / "analysis.json"
        if cache.exists():
            try: return json.loads(cache.read_text())
            except (OSError, json.JSONDecodeError) as error: log.warning("analysis cache ignored: %s", error)
        result = {"title": self.score.title, "summary": "楽譜を読み込みました。", "sections": [{"name": "全体", "measures": [1, len(self.score.measures)]}]}
        if self.brain:
            try:
                async with asyncio.timeout(ANALYSIS_TIMEOUT_S):
                    result = await getattr(self.brain, "analyze_pages")(page_paths, {"measureCount": len(self.score.measures), "timeSignature": self.score.timeSignature.model_dump(), "bpm": self.score.bpm, "keyFifths": self.score.keyFifths})
            except TimeoutError:
                log.warning("analysis timed out after %ss; fallback", ANALYSIS_TIMEOUT_S)
                await self._close_brain()
            except Exception as error: log.warning("analysis failed; fallback: %s", error)
        try: cache.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
        except OSError as error: log.warning("could not cache analysis: %s", error)
        return result

    async def _brain_turn(self, kind: str, payload: dict) -> AgentAction | None:
        if not await self._ensure_brain(): return None
        utterance_id, queue, saw_say = str(uuid.uuid4()), asyncio.Queue(), False
        self._active_utterances.add(utterance_id)
        async def stream() -> AsyncIterator[str]:
            while True:
                item = await queue.get()
                if item is _END: return
                yield str(item)
        async def voice_worker() -> None:
            if not self.voice: return
            try:
                async for clip in self.voice.speak(utterance_id, stream()):
                    await self.emit("voice.clip", {"utteranceId": clip.utterance_id, "seq": clip.seq, "url": clip.url, "text": clip.text, "last": clip.last})
            except Exception as error: log.warning("voice stream failed: %s", error)
        worker, raw, failed = asyncio.create_task(voice_worker()), None, False
        self._voice_workers.add(worker)
        try:
            async with self._brain_lock:
                try:
                    async with asyncio.timeout(LESSON_TURN_TIMEOUT_S):
                        async for event in self.brain.send(format_message(kind, payload)):
                            if isinstance(event, SayDelta):
                                saw_say = True
                                await self.emit("agent.say", {"utteranceId": utterance_id, "delta": event.text, "final": False})
                                await queue.put(event.text)
                            elif isinstance(event, ActionReady): raw = event.action
                            elif isinstance(event, BrainError): failed = True; log.warning("brain %s failed: %s", kind, event.reason)
                except TimeoutError:
                    failed = True
                    log.warning("brain %s timed out after %ss", kind, LESSON_TURN_TIMEOUT_S)
                    await self._close_brain()
                except Exception as error: failed = True; log.warning("brain %s exception: %s", kind, error)
        finally:
            await queue.put(_END)
            if not worker.done():
                try:
                    await worker
                except asyncio.CancelledError:
                    raise
                except Exception as error:
                    log.warning("voice worker failed: %s", error)
            self._voice_workers.discard(worker)
            self._active_utterances.discard(utterance_id)
        if saw_say: await self.emit("agent.say", {"utteranceId": utterance_id, "delta": "", "final": True})
        if failed or raw is None: return None
        try: return validate_action(raw, self.state, current_spec=self.timeline.spec if self.timeline else None, measure_count=len(self.score.measures) if self.score else None)
        except Exception as error: log.warning("invalid %s action: %s", kind, error); return None

    async def _speak_fixed(self, text: str, gate: bool = False) -> str:
        utterance_id = str(uuid.uuid4())
        self._active_utterances.add(utterance_id)
        if gate: self.awaiting_voice = utterance_id
        await self.emit("agent.say", {"utteranceId": utterance_id, "delta": text, "final": True})
        try:
            if self.voice:
                async for clip in self.voice.speak_text(utterance_id, text):
                    await self.emit("voice.clip", {"utteranceId": clip.utterance_id, "seq": clip.seq, "url": clip.url, "text": clip.text, "last": clip.last})
            else: raise RuntimeError("voice unavailable")
        except Exception as error:
            log.warning("fixed voice fallback: %s", error)
            await self.emit("voice.clip", {"utteranceId": utterance_id, "seq": 0, "url": None, "text": text, "last": True})
        finally:
            self._active_utterances.discard(utterance_id)
        return utterance_id

    async def ask_fallback(self, index: int) -> None:
        question = [
            {"id": "experience", "text": "ピアノの経験はどれくらいですか？", "options": ["はじめて", "少し弾ける", "経験あり"], "allowFree": True},
            {"id": "range", "text": "どこから練習したいですか？", "options": ["最初のフレーズ", "右手から", "全部"], "allowFree": True},
        ][index]
        await self.emit("agent.ask", {"questionId": question["id"], "text": question["text"], "options": question["options"], "allowFree": question["allowFree"]})

    async def hearing_answer(self, question_id: str, answer: str) -> None:
        if self.state != "hearing": return
        action = await self._brain_turn("HEARING_ANSWER", {"questionId": question_id, "answer": answer})
        if action: await self.apply_action(action)
        elif question_id == "experience": await self.ask_fallback(1)
        else: await self.apply_default_plan()

    async def apply_default_plan(self) -> None:
        assert self.score
        spec = ExerciseSpec(measures=(1, min(8, len(self.score.measures))), hand="right", tempoPercent=60, mode="wait", loop=1, metronome=True)
        self.plan = {"goal": "最初のフレーズをひけるようになる", "currentStepId": "step-1", "steps": [
            {"id": "step-1", "title": "右手を確認", "description": "右手をゆっくり確認", "status": "doing", "exercise": spec},
            {"id": "step-2", "title": "右手でひく", "description": "リズムに合わせる", "status": "todo", "exercise": spec.model_copy(update={"mode": "play"})}]}
        await self.transition("planning"); await self.emit("plan.updated", {"plan": self.public_plan()}); await self.begin_demo(spec.model_copy(update={"mode": "watch"}))

    def public_plan(self) -> dict:
        assert self.plan
        return {"goal": self.plan["goal"], "currentStepId": self.plan["currentStepId"], "steps": [{k: v for k, v in step.items() if k != "exercise"} for step in self.plan["steps"]]}

    async def _apply_plan(self, action: AgentAction) -> None:
        await self.transition("planning")
        self.plan = {"goal": action.plan.goal, "currentStepId": "step-1", "steps": []}
        for index, step in enumerate(action.plan.steps):
            self.plan["steps"].append({"id": f"step-{index+1}", "title": step.title, "description": step.description, "status": "doing" if index == 0 else "todo", "exercise": step.exercise})
        await self.emit("plan.updated", {"plan": self.public_plan()})
        first = self.plan["steps"][0]["exercise"]
        follow = await self._brain_turn("PLAN_ACCEPTED", {"goal": self.plan["goal"], "exercise": first.model_dump()})
        if follow: await self.apply_action(follow)
        else: await self.begin_demo(first.model_copy(update={"mode": "watch"}))

    async def prepare_exercise(self, spec: ExerciseSpec) -> bool:
        assert self.score
        # Build first: a bad agent request must not invalidate the current version/timeline.
        next_version = self.exercise_version + 1
        try:
            timeline = self._builder.build(self.score, spec, next_version)
        except (ValueError, TypeError) as error:
            log.warning("exercise generation rejected: %s", error)
            await self.emit("error", {"message": "課題を作れませんでした。前の課題を続けます。"})
            return False
        self.exercise_version, self.timeline = next_version, timeline
        await self.transition("briefing"); await self.emit("exercise.ready", {"timeline": self.timeline.model_dump(mode="json")})
        await self._speak_fixed(self.exercise_instruction(spec), gate=True)
        return True

    async def begin_demo(self, spec: ExerciseSpec) -> None:
        if not await self.prepare_exercise(spec.model_copy(update={"mode": "watch"})):
            return
        await self.transition("demo"); await self.emit("demo.play", {"exerciseId": self.timeline.exerciseId, "exerciseVersion": self.exercise_version})

    def exercise_instruction(self, spec: ExerciseSpec) -> str:
        hand = {"right": "右手", "left": "左手", "both": "両手"}[spec.hand]
        if spec.drill:
            drill_text = {
                "five_finger": f"{hand}の5本の指で、ゆっくり上り下りしてみよう。",
                "scale": f"{hand}で、ゆっくり音階を上り下りしてみよう。",
                "rhythm": f"{hand}で、同じ音をリズムに合わせてひいてみよう。",
            }[spec.drill.kind]
            return f"次は基礎練習。{drill_text}"
        bpm = self.score.bpm * spec.tempoPercent / 100 if self.score else 60
        pace = "ゆっくり" if bpm < 70 else "すこしゆっくり" if bpm < 100 else "もとのテンポで"
        return f"次は{hand}で、{spec.measures[0]}から{spec.measures[1]}しょうせつめを、{pace}ひいてみよう。"

    async def voice_done(self, utterance_id: str) -> None:
        if utterance_id == self.awaiting_voice: self.awaiting_voice = None

    async def practice_started(self, exercise_id: str, version: int) -> None:
        if self.timeline and self.state == "briefing" and self.awaiting_voice is None and exercise_id == self.timeline.exerciseId and version == self.exercise_version: await self.transition("practicing")

    async def demo_finished(self, exercise_id: str, version: int) -> None:
        if not self.timeline or self.state != "demo" or exercise_id != self.timeline.exerciseId or version != self.exercise_version: return
        # お手本の課題（watch）のまま演奏を始められないよう、次の課題が決まるまでは reviewing（先生が考え中）にする
        await self.transition("reviewing")
        action = await self._brain_turn("DEMO_FINISHED", {"exercise": self.timeline.spec.model_dump()})
        if action: await self.apply_action(action)
        else: await self.prepare_exercise(self.timeline.spec.model_copy(update={"mode": "wait"}))

    async def submit_attempt(self, payload: dict) -> None:
        if not self.timeline or payload.get("exerciseVersion") != self.exercise_version or payload.get("exerciseId") != self.timeline.exerciseId: return
        await self.transition("reviewing"); summary = RealtimeSummary.model_validate(payload["summary"])
        key = (self.timeline.spec.measures, self.timeline.spec.hand, self.timeline.spec.mode); self._attempt_counts[key] += 1
        verdict, fallback = suggested_verdict(summary, self.timeline.spec)
        action = await self._brain_turn("ATTEMPT_RESULT", {"exercise": self.timeline.spec.model_dump(), "summary": summary.model_dump(), "suggestedVerdict": verdict, "attemptCountOnThisExercise": self._attempt_counts[key]})
        if action: await self.apply_action(action)
        else:
            await self._speak_fixed("よくがんばったね。もう一回確認してみよう。")
            await self.prepare_exercise(self._fallback_exercise(summary, verdict, fallback))
        queued, self._queued_user_messages = self._queued_user_messages, []
        for text in queued: await self.user_message(text)

    def _fallback_exercise(self, summary: RealtimeSummary, verdict: str, fallback: ExerciseSpec) -> ExerciseSpec:
        """Choose a safe deterministic recovery when the tutor did not act.

        Two genuinely poor retries on the same phrase become a short,
        score-independent warm-up.  A clearly successful warm-up returns to
        the exact phrase that caused it, rather than leaving the learner in an
        unrelated exercise.
        """
        assert self.timeline is not None
        current = self.timeline.spec
        accuracy = (summary.perfect + summary.good) / summary.total if summary.total else 0.0
        if current.drill:
            if accuracy >= .95 and self._drill_return_spec is not None:
                restored, self._drill_return_spec = self._drill_return_spec, None
                self._poor_retry_streak = 0
                self._poor_retry_key = None
                return restored
            return fallback

        phrase_key = (current.measures, current.hand, current.mode)
        if verdict == "retry" and accuracy < .70:
            self._poor_retry_streak = self._poor_retry_streak + 1 if self._poor_retry_key == phrase_key else 1
            self._poor_retry_key = phrase_key
        else:
            self._poor_retry_streak = 0
            self._poor_retry_key = None
        if self._poor_retry_streak < 2:
            return fallback

        first_note = min(self.timeline.notes, key=lambda note: note.startMs)
        start_pitch = max(21, min(101, first_note.pitch))
        key = {1: "G", -1: "F", 2: "D"}.get(self.score.keyFifths if self.score else 0, "C")
        self._drill_return_spec = current.model_copy(deep=True)
        self._poor_retry_streak = 0
        self._poor_retry_key = None
        return current.model_copy(update={
            "tempoPercent": 60, "mode": "wait", "loop": 1,
            "focus": "5本の指を順番に", "drill": DrillSpec(kind="five_finger", startPitch=start_pitch, key=key, bars=2),
        })

    async def user_message(self, text: str) -> None:
        if self.state == "practicing": self._queued_user_messages.append(text); return
        action = await self._brain_turn("USER_MESSAGE", {"text": text})
        if action: await self.apply_action(action)

    async def apply_action(self, action: AgentAction) -> None:
        if action.ui: await self.emit("ui.hint", action.ui)
        if action.type == "ask": await self.emit("agent.ask", {"questionId": action.question.id, "text": action.question.text, "options": action.question.options, "allowFree": action.question.allowFree})
        elif action.type == "set_plan": await self._apply_plan(action)
        elif action.type == "demo": await self.begin_demo(action.exercise)
        elif action.type in {"start_exercise", "retry"}: await self.prepare_exercise(action.exercise)
        elif action.type == "next": await self.next_step()
        elif action.type == "finish": await self.transition("finished")

    async def next_step(self) -> None:
        if not self.plan: return
        self.plan["steps"][self._step_index]["status"] = "done"; self._step_index += 1
        if self._step_index >= len(self.plan["steps"]): await self.transition("finished"); return
        step = self.plan["steps"][self._step_index]; step["status"] = "doing"; self.plan["currentStepId"] = step["id"]
        await self.emit("plan.updated", {"plan": self.public_plan()})
        action = await self._brain_turn("STEP_STARTED", {"exercise": step["exercise"].model_dump()})
        if action: await self.apply_action(action)
        else: await self.prepare_exercise(step["exercise"])

    async def estimate_fingering(self, force: bool = False) -> None:
        """force=True のときはキャッシュを使わずに設計し直す（成功したときだけ上書きする）。"""
        assert self.score
        cache = self._song_dir() / "fingering.json"
        if cache.exists() and not force:
            try: await self._replay_fingering(json.loads(cache.read_text())); return
            except (OSError, json.JSONDecodeError, KeyError) as error: log.warning("fingering cache ignored: %s", error)
        updates: list[dict] = []
        async def request(compact: str, violations: list) -> dict:
            if not self.brain: raise RuntimeError("no brain")
            try:
                async with asyncio.timeout(FINGERING_CHUNK_TIMEOUT_S):
                    return await getattr(self.brain, "design_fingering")(compact, [f"{x.note_id}: {x.reason}" for x in violations])
            except TimeoutError:
                log.warning("fingering chunk timed out after %ss", FINGERING_CHUNK_TIMEOUT_S)
                await self._close_brain()
                raise
        async def update(value: dict) -> None: updates.append(value); await self.emit("fingering.updated", value)
        try:
            await FingeringEstimator(request, update).estimate(self.score.notes, self.score.keyFifths, self.score.bpm)
            cache.write_text(json.dumps({"updates": updates}, ensure_ascii=False), encoding="utf-8")
        except Exception as error: log.warning("fingering failed: %s", error)

    async def _replay_fingering(self, cached: dict) -> None:
        assert self.score
        notes = {note.id: note for note in self.score.notes}; groups: dict[int, list] = defaultdict(list)
        for update in cached["updates"]:
            for finger in update.get("fingers", []):
                if note := notes.get(finger["id"]): note.finger, note.fingerSource = finger["finger"], finger["source"]; groups[note.measure].append(finger)
        events = [event for update in cached["updates"] for event in update.get("events", [])]
        for measure in sorted(groups):
            await self.emit("fingering.updated", {"fingers": groups[measure], "events": [x for x in events if x.get("measure") == measure], "done": measure == max(groups)})
            await asyncio.sleep(.03)
