"""Durable local progress for resuming a lesson after the app closes."""
from __future__ import annotations

import json
import logging
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from piano_coach.paths import DATA_DIR

log = logging.getLogger(__name__)


class SavedAttempt(BaseModel):
    exercise: dict[str, Any]
    summary: dict[str, Any]
    verdict: Literal["next", "retry"]


class SavedLesson(BaseModel):
    version: Literal[1] = 1
    songId: str
    plan: dict[str, Any]
    stepIndex: int = Field(ge=0)
    currentExercise: dict[str, Any] | None = None
    hearingAnswers: list[dict[str, Any]] = Field(default_factory=list)
    recentAttempts: list[SavedAttempt] = Field(default_factory=list, max_length=5)
    updatedAt: str
    finished: bool = False

    @classmethod
    def now(cls, **values: Any) -> "SavedLesson":
        return cls(updatedAt=datetime.now(timezone.utc).isoformat(), **values)


class LessonStore:
    """Versioned JSON files, atomically replaced so a partial save is harmless."""

    def __init__(self, data_dir: Path = DATA_DIR) -> None:
        self.root = data_dir / "lessons"

    def path_for(self, song_id: str) -> Path:
        return self.root / f"{Path(song_id).name}.json"

    def load(self, song_id: str) -> SavedLesson | None:
        path = self.path_for(song_id)
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            saved = SavedLesson.model_validate(raw)
            if saved.songId != song_id:
                raise ValueError("songId does not match filename")
            return saved
        except FileNotFoundError:
            return None
        except (OSError, json.JSONDecodeError, ValidationError, ValueError) as error:
            log.warning("ignoring invalid saved lesson %s: %s", path, error)
            return None

    def save(self, saved: SavedLesson) -> None:
        """Write then atomically replace; callers deliberately never see errors."""
        path = self.path_for(saved.songId)
        temporary_name: str | None = None
        try:
            self.root.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=self.root,
                                             prefix=f".{path.name}.", suffix=".tmp", delete=False) as temporary:
                temporary_name = temporary.name
                json.dump(saved.model_dump(mode="json"), temporary, ensure_ascii=False, separators=(",", ":"))
                temporary.flush()
                os.fsync(temporary.fileno())
            os.replace(temporary_name, path)
        except Exception as error:
            log.warning("could not save lesson progress %s: %s", path, error)
            if temporary_name:
                try:
                    Path(temporary_name).unlink(missing_ok=True)
                except OSError:
                    pass

    def progress_for(self, song_id: str) -> dict[str, Any] | None:
        saved = self.load(song_id)
        if saved is None or saved.finished:
            return None
        steps = saved.plan.get("steps") if isinstance(saved.plan, dict) else None
        if not isinstance(steps, list) or not steps:
            log.warning("ignoring saved lesson progress for %s: plan has no steps", song_id)
            return None
        index = min(saved.stepIndex, len(steps) - 1)
        step = steps[index] if isinstance(steps[index], dict) else {}
        return {
            "stepIndex": index,
            "stepCount": len(steps),
            "stepTitle": str(step.get("title", "")),
            "goal": str(saved.plan.get("goal", "")),
            "updatedAt": saved.updatedAt,
            "finished": saved.finished,
        }
