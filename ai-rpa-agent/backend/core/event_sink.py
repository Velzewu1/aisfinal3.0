"""Append-only event sink skeleton.

In production this writes to Supabase / Postgres with RLS.
For the scaffold we only buffer in memory so the API surface is stable.
"""
from __future__ import annotations

from collections import deque
from typing import Deque, List

from backend.models.events import EventEnvelope


class EventSink:
    _BUFFER_MAX = 1000

    def __init__(self) -> None:
        self._buffer: Deque[EventEnvelope] = deque(maxlen=self._BUFFER_MAX)

    def append(self, event: EventEnvelope) -> None:
        self._buffer.append(event)

    def recent(self, limit: int = 50) -> List[EventEnvelope]:
        return list(self._buffer)[-limit:]


sink = EventSink()
