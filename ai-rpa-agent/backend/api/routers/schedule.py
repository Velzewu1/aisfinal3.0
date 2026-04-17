from __future__ import annotations

from fastapi import APIRouter, Header

from backend.core.scheduler import solve
from backend.models.schedule import ScheduleRequest, ScheduleResult


router = APIRouter(tags=["schedule"])


@router.post("/schedule", response_model=ScheduleResult)
def create_schedule(
    request: ScheduleRequest,
    x_correlation_id: str | None = Header(default=None, alias="x-correlation-id"),
) -> ScheduleResult:
    _ = x_correlation_id
    return solve(request)
