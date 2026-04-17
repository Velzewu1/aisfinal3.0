from __future__ import annotations

from typing import List

from fastapi import APIRouter

from backend.core.event_sink import sink
from backend.models.events import EventEnvelope


router = APIRouter(tags=["events"])


@router.post("/events", response_model=dict)
def append_event(event: EventEnvelope) -> dict[str, bool]:
    sink.append(event)
    return {"ok": True}


@router.get("/events", response_model=List[EventEnvelope])
def list_events(limit: int = 50) -> list[EventEnvelope]:
    return sink.recent(limit=limit)
