from __future__ import annotations

import os

import uvicorn

from piano_coach.api.app import create_app

app = create_app()


def run() -> None:
    if os.environ.get("ANTHROPIC_API_KEY"):
        raise SystemExit("ANTHROPIC_API_KEY must be unset; refusing API-billed startup")
    uvicorn.run("piano_coach.main:app", host="127.0.0.1", port=8787, reload=False)
