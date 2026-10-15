from __future__ import annotations

import os
import logging
import uvicorn

from piano_coach.api.app import create_app

app = create_app()


def run() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    uvicorn.run("piano_coach.main:app", host="0.0.0.0" if os.environ.get("PORT") else "127.0.0.1",
                port=int(os.environ.get("PORT", "8787")), reload=False)
