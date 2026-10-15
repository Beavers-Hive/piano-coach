from __future__ import annotations

import uvicorn

from piano_coach.api.app import create_app
from piano_coach.brain.codex import check_subscription_environment

app = create_app()


def run() -> None:
    check_subscription_environment()
    uvicorn.run("piano_coach.main:app", host="127.0.0.1", port=8787, reload=False)
