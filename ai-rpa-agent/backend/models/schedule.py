"""Pydantic mirrors of the shared scheduling schema.

These models must stay compatible with `packages/schemas/src/schedule.ts`.
"""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field, conint, constr


NonEmptyStr = constr(min_length=1)
SlotMinutes = conint(gt=0, le=24 * 60)


class Doctor(BaseModel):
    id: NonEmptyStr
    name: NonEmptyStr
    specialty: Optional[NonEmptyStr] = None


class Procedure(BaseModel):
    id: NonEmptyStr
    name: NonEmptyStr
    durationMinutes: SlotMinutes
    allowedDoctorIds: List[NonEmptyStr] = Field(..., min_length=1)


class WorkingWindow(BaseModel):
    doctorId: NonEmptyStr
    # Horizon index 0..8 (aligned with 9-day mock UI: data-day-index = day, data-day = day + 1).
    day: conint(ge=0, le=8)
    startMinute: conint(ge=0, le=24 * 60 - 1)
    endMinute: conint(ge=1, le=24 * 60)


class ScheduleRequest(BaseModel):
    horizonDays: conint(gt=0, le=30) = 9
    doctors: List[Doctor] = Field(..., min_length=1)
    procedures: List[Procedure] = Field(..., min_length=1)
    windows: List[WorkingWindow] = Field(..., min_length=1)
    slotMinutes: SlotMinutes = 30


class ScheduledAssignment(BaseModel):
    procedureId: NonEmptyStr
    doctorId: NonEmptyStr
    # Same horizon index as the chosen window (typically 0..8).
    day: conint(ge=0, le=30)
    startMinute: conint(ge=0)
    endMinute: conint(ge=1)


class ScheduleResult(BaseModel):
    status: Literal["optimal", "feasible", "infeasible", "unknown"]
    assignments: List[ScheduledAssignment]
    objective: Optional[float] = None
    horizonDays: Optional[int] = Field(default=None, ge=1, le=30)
