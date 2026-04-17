"""FastAPI entrypoint.

The backend knows nothing about the DOM. Its only surface is:
  - scheduling (CP-SAT) via `/api/schedule`
  - append-only event audit via `/api/events`
"""
from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.routers import schedule as schedule_router
from backend.api.routers import events as events_router


def _allowed_origins() -> list[str]:
    raw = os.getenv("BACKEND_ALLOWED_ORIGINS", "chrome-extension://*,http://localhost:5173")
    return [o.strip() for o in raw.split(",") if o.strip()]


app = FastAPI(
    title="ai-rpa-agent backend",
    version="0.1.0",
    description="CP-SAT scheduling + event audit for the AI RPA agent.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_origin_regex=r"chrome-extension://.*",
    allow_methods=["GET", "POST"],
    allow_headers=["content-type", "x-correlation-id"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "ai-rpa-agent"}


app.include_router(schedule_router.router, prefix="/api")
app.include_router(events_router.router, prefix="/api")
