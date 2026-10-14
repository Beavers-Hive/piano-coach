from __future__ import annotations

import os
from pathlib import Path

SERVER_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVER_ROOT.parents[1]
ASSETS_DIR = REPO_ROOT / "assets" / "scores"
# E2E のフェイクサーバーは別のフォルダを使う（運指などのキャッシュが本番に混ざらないように）
DATA_DIR = Path(os.environ.get("PIANO_COACH_DATA_DIR") or REPO_ROOT / "data")
PROMPTS_DIR = REPO_ROOT / "prompts"


def ensure_data_dirs() -> None:
    (DATA_DIR / "songs").mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "tts").mkdir(parents=True, exist_ok=True)
