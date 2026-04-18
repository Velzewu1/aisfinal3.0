"""CP-SAT scheduler for a medical rehabilitation center.

Input:  ScheduleRequest (doctors, procedures, working windows, horizon)
Output: ScheduleResult (status + assignments)

Model (per-patient schedule):

  For each procedure `p` and each compatible working window `w`
  (w.doctorId allowed for p, window fits the procedure duration, and
  w.day is inside the horizon) we create:

    x[p, w]      : BoolVar   - "procedure p is scheduled in window w"
    start[p, w]  : IntVar    - absolute start minute, bounded by the
                               window so that the procedure fits.
    iv[p, w]     : OptionalIntervalVar - presence-gated by x[p, w].

Constraints:

  C1. ExactlyOne(x[p, w] for w in compat(p))            per procedure p
  C2. NoOverlap on intervals grouped by (calendar day)   - patient cannot be in
                                                          two procedures at the
                                                          same time; multiple
                                                          procedures the same day
                                                          are allowed if times do
                                                          not overlap (different
                                                          specialists or
                                                          back-to-back). This is
                                                          temporal overlap only,
                                                          not a cap on count per day.
  C3. Encoded implicitly via compat(p):
        - only allowed specialists
        - only within working windows
        - window big enough for the procedure duration

Objective:

  Minimize the sum of procedure start times (within each window). Procedure
  instances with ids ending in ``_d{day}`` only match windows on that calendar
  day, so assignments spread across the horizon (not packed into the first days).

  Greedy fallback still applies on INFEASIBLE / UNKNOWN.

Contract:

  - Pure function. No DOM knowledge, no LLM, no `chrome.*`.
  - `WorkingWindow.day` / assignment `day` are horizon indices in ``[0, horizon-1]``
    (for the default 9-day mock UI: 0..8; UI columns map ``data-day-index = day``,
    ``data-day = day + 1``).
  - Input/output Pydantic shapes are unchanged from
    `backend/models/schedule.py`.
  - `ScheduleResult.status` Literal is unchanged. The spec's
    "degraded" fallback maps to "unknown" (the closest in-contract
    value) to honor "Keep all existing Pydantic models unchanged".
"""
from __future__ import annotations

import re
from collections import defaultdict
from typing import Dict, List, Optional, Tuple

from ortools.sat.python import cp_model

from backend.models.schedule import (
    ScheduleRequest,
    ScheduleResult,
    ScheduledAssignment,
    WorkingWindow,
)


_TIME_LIMIT_SECONDS = 10.0
_MAX_HORIZON_DAYS = 9

_PROCEDURE_DAY_SUFFIX = re.compile(r"_d(\d+)$")


def _intended_day_from_procedure_id(proc_id: str) -> Optional[int]:
    """Instance ids like ``lfk_d3`` are fixed to horizon day 3; unrelated windows are excluded."""
    m = _PROCEDURE_DAY_SUFFIX.search(proc_id)
    if not m:
        return None
    return int(m.group(1))


def solve(request: ScheduleRequest) -> ScheduleResult:
    horizon = min(request.horizonDays, _MAX_HORIZON_DAYS)

    compat = _build_compatibility(request, horizon)
    if any(len(entries) == 0 for entries in compat.values()):
        return _fallback(request, horizon)

    model = cp_model.CpModel()

    x: Dict[Tuple[str, int], cp_model.IntVar] = {}
    starts: Dict[Tuple[str, int], cp_model.IntVar] = {}
    intervals: Dict[Tuple[str, int], cp_model.IntervalVar] = {}

    for p in request.procedures:
        duration = int(p.durationMinutes)
        for w_idx, w in compat[p.id]:
            key = (p.id, w_idx)
            present = model.NewBoolVar(f"x__{p.id}__{w_idx}")
            start = model.NewIntVar(
                int(w.startMinute),
                int(w.endMinute) - duration,
                f"start__{p.id}__{w_idx}",
            )
            end = model.NewIntVar(
                int(w.startMinute) + duration,
                int(w.endMinute),
                f"end__{p.id}__{w_idx}",
            )
            iv = model.NewOptionalIntervalVar(
                start, duration, end, present, f"iv__{p.id}__{w_idx}"
            )
            x[key] = present
            starts[key] = start
            intervals[key] = iv

    # C1. Each procedure scheduled exactly once.
    for p in request.procedures:
        model.AddExactlyOne(x[(p.id, w_idx)] for w_idx, _ in compat[p.id])

    # Patient temporal feasibility: no two procedures overlap in time on the same
    # calendar day (single body). Multiple procedures per day are allowed if
    # scheduled sequentially; per-doctor overlap is implied and not modeled twice.
    by_day: Dict[int, List[cp_model.IntervalVar]] = defaultdict(list)
    for (pid, w_idx), iv in intervals.items():
        w = request.windows[w_idx]
        by_day[int(w.day)].append(iv)

    for ivs in by_day.values():
        if len(ivs) > 1:
            model.AddNoOverlap(ivs)

    # Prefer earlier starts within each window (sum over all scheduled procedures).
    model.Minimize(sum(starts[key] for key in x))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = _TIME_LIMIT_SECONDS
    status = solver.Solve(model)

    if status == cp_model.OPTIMAL:
        return _build_result("optimal", request, horizon, x, starts, solver)
    if status == cp_model.FEASIBLE:
        return _build_result("feasible", request, horizon, x, starts, solver)

    return _fallback(request, horizon)


def _build_compatibility(
    request: ScheduleRequest, horizon: int
) -> Dict[str, List[Tuple[int, WorkingWindow]]]:
    compat: Dict[str, List[Tuple[int, WorkingWindow]]] = {}
    for p in request.procedures:
        allowed = set(p.allowedDoctorIds)
        intended = _intended_day_from_procedure_id(p.id)
        entries: List[Tuple[int, WorkingWindow]] = []
        for w_idx, w in enumerate(request.windows):
            if w.doctorId not in allowed:
                continue
            if int(w.day) >= horizon:
                continue
            if int(w.endMinute) - int(w.startMinute) < int(p.durationMinutes):
                continue
            if intended is not None and int(w.day) != intended:
                continue
            entries.append((w_idx, w))
        compat[p.id] = entries
    return compat


def _build_result(
    status: str,
    request: ScheduleRequest,
    horizon: int,
    x: Dict[Tuple[str, int], cp_model.IntVar],
    starts: Dict[Tuple[str, int], cp_model.IntVar],
    solver: cp_model.CpSolver,
) -> ScheduleResult:
    picks: Dict[str, Tuple[int, int]] = {}
    for (pid, w_idx), present in x.items():
        if solver.Value(present) == 1:
            picks[pid] = (w_idx, int(solver.Value(starts[(pid, w_idx)])))

    assignments: List[ScheduledAssignment] = []
    for p in request.procedures:
        if p.id not in picks:
            continue
        w_idx, start_minute = picks[p.id]
        w = request.windows[w_idx]
        assignments.append(
            ScheduledAssignment(
                procedureId=p.id,
                doctorId=w.doctorId,
                day=int(w.day),
                startMinute=start_minute,
                endMinute=start_minute + int(p.durationMinutes),
            )
        )

    _days_used = sorted({a.day for a in assignments})
    print(f"[scheduler] assignments count: {len(assignments)}, days used: {_days_used}")

    return ScheduleResult(
        status=status,
        assignments=assignments,
        objective=float(solver.ObjectiveValue()),
        horizonDays=horizon,
    )


def _fallback(request: ScheduleRequest, horizon: int) -> ScheduleResult:
    # Spec calls this "degraded"; the Pydantic Literal only permits
    # "unknown" (the other non-success bucket), so we use "unknown"
    # to keep the existing contract stable.
    assignments = _greedy_stub(request)
    _days_used = sorted({a.day for a in assignments})
    print(f"[scheduler] fallback assignments count: {len(assignments)}, days used: {_days_used}")

    return ScheduleResult(
        status="unknown",
        assignments=assignments,
        objective=None,
        horizonDays=horizon,
    )


def _greedy_stub(request: ScheduleRequest) -> List[ScheduledAssignment]:
    """Deterministic, obviously-wrong stub placeholder.

    Produces a trivially-shaped plan so the end-to-end pipeline can be
    exercised by the extension without waiting on the real solver.
    """
    assignments: List[ScheduledAssignment] = []
    for i, proc in enumerate(request.procedures):
        doctor_id = proc.allowedDoctorIds[0]
        # TZ: stagger fallback placements by 30 minutes (independent of slot grid).
        start = i * 30
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
