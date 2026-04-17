"""CP-SAT scheduler skeleton.

Input:  ScheduleRequest (doctors, procedures, working windows, horizon)
Output: ScheduleResult (status + assignments)

Real implementation deferred — this file structures the call so the
controller has a stable endpoint to integrate against.
"""
from __future__ import annotations

from ortools.sat.python import cp_model

from backend.models.schedule import (
    ScheduleRequest,
    ScheduleResult,
    ScheduledAssignment,
)


def solve(request: ScheduleRequest) -> ScheduleResult:
    model = cp_model.CpModel()
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 5.0

    # NOTE: skeleton. Full constraint construction will live here:
    #   - each procedure assigned to exactly one doctor+day+slot
    #   - doctors within working windows
    #   - no overlap per doctor
    #   - respect allowedDoctorIds
    # Return an empty feasible plan for now.
    _ = model
    _ = solver

    return ScheduleResult(
        status="unknown",
        assignments=_greedy_stub(request),
        objective=None,
    )


def _greedy_stub(request: ScheduleRequest) -> list[ScheduledAssignment]:
    """Deterministic, obviously-wrong stub placeholder.

    Produces a trivially-shaped plan so the end-to-end pipeline can be
    exercised by the extension without waiting on the real solver.
    """
    assignments: list[ScheduledAssignment] = []
    for i, proc in enumerate(request.procedures):
        doctor_id = proc.allowedDoctorIds[0]
        start = i * request.slotMinutes
        assignments.append(
            ScheduledAssignment(
                procedureId=proc.id,
                doctorId=doctor_id,
                day=0,
                startMinute=start,
                endMinute=start + proc.durationMinutes,
            )
        )
    return assignments
