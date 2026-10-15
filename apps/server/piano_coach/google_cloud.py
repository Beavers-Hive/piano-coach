"""ADC authentication shared by Vertex AI and Cloud Text-to-Speech.

Cloud Run uses its attached service account. No service account keys are needed.
"""
from __future__ import annotations

import asyncio
import os
from typing import Any

import httpx


class GoogleCloudAPI:
    def __init__(self) -> None:
        self.credentials: Any = None
        self._auth_lock = asyncio.Lock()
        self._client: httpx.AsyncClient | None = None

    async def headers(self) -> dict[str, str]:
        async with self._auth_lock:
            if self.credentials is None:
                import google.auth
                self.credentials, _ = await asyncio.to_thread(
                    google.auth.default, scopes=["https://www.googleapis.com/auth/cloud-platform"])
            if not self.credentials.valid:
                from google.auth.transport.requests import Request
                await asyncio.to_thread(self.credentials.refresh, Request())
            headers = {"Authorization": f"Bearer {self.credentials.token}"}
            project = os.environ.get("GOOGLE_CLOUD_PROJECT")
            if project:
                headers["x-goog-user-project"] = project
            return headers

    async def post(self, url: str, payload: dict, *, timeout: float = 60) -> dict:
        if self._client is None:
            self._client = httpx.AsyncClient()
        response = await self._client.post(url, json=payload, headers=await self.headers(), timeout=timeout)
        if not response.is_success:
            # Include Google's diagnostic without ever logging credentials or request contents.
            try:
                detail = response.json().get("error", {}).get("message", "request failed")
            except ValueError:
                detail = "request failed"
            raise RuntimeError(f"Google API {response.status_code}: {detail[:800]}")
        return response.json()

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
