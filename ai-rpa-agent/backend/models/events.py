"""Append-only event model accepted from the extension for server-side audit."""
from __future__ import annotations

from typing import Any, Dict

from pydantic import BaseModel, constr


NonEmptyStr = constr(min_length=1)


class EventEnvelope(BaseModel):
    id: NonEmptyStr
    type: NonEmptyStr
    correlationId: NonEmptyStr
    ts: NonEmptyStr
    payload: Dict[str, Any]
