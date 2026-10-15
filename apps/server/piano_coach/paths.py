from __future__ import annotations

import os
from pathlib import Path

SERVER_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVER_ROOT.parents[1]
ASSETS_DIR = REPO_ROOT / "assets" / "scores"
# E2E のフェイクサーバーは別のフォルダを使う（運指などのキャッシュが本番に混ざらないように）
def _default_data_dir() -> Path:
    # フェイクの Claude（PIANO_COACH_FAKE_BRAIN）で起動したサーバーは、起動の仕方に関係なく data-e2e/ を使う。
    # 手動で起動したフェイクのサーバーが、本番の data/ に機械的な運指を書き込んでいた（2026-10-15 に 2 回発生）。
    if os.environ.get("PIANO_COACH_FAKE_BRAIN", "").lower() in {"1", "true", "yes", "on"}:
        return REPO_ROOT / "data-e2e"
    return REPO_ROOT / "data"


DATA_DIR = Path(os.environ.get("PIANO_COACH_DATA_DIR") or _default_data_dir())
PROMPTS_DIR = REPO_ROOT / "prompts"


def ensure_data_dirs() -> None:
    (DATA_DIR / "songs").mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "tts").mkdir(parents=True, exist_ok=True)
