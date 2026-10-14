from __future__ import annotations

from pathlib import Path

SERVER_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVER_ROOT.parents[1]
ASSETS_DIR = REPO_ROOT / "assets" / "scores"
DATA_DIR = REPO_ROOT / "data"
PROMPTS_DIR = REPO_ROOT / "prompts"


def ensure_data_dirs() -> None:
    (DATA_DIR / "songs").mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "tts").mkdir(parents=True, exist_ok=True)
