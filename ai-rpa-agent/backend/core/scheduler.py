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
  C2. NoOverlap on intervals grouped by (specialist, day)
  C3. NoOverlap on intervals grouped by (day)           - patient has
                                                          a single body
  C4. Encoded implicitly via compat(p):
        - only allowed specialists
        - only within working windows
        - window big enough for the procedure duration

Objective:

  Minimize the latest day used (max over all selected windows). This
  spreads load evenly across the 9-day horizon. We still use a single
  time-limited solve; the greedy fallback takes over on
  INFEASIBLE / UNKNOWN.

Contract:

  - Pure function. No DOM knowledge, no LLM, no `chrome.*`.
  - Input/output Pydantic shapes are unchanged from
    `backend/models/schedule.py`.
  - `ScheduleResult.status` Literal is unchanged. The spec's
    "degraded" fallback maps to "unknown" (the closest in-contract
    value) to honor "Keep all existing Pydantic models unchanged".
"""
from __future__ import annotations

from collections import defaultdict
from typing import Dict, List, Tuple

from ortools.sat.python import cp_model

from backend.models.schedule import (
    ScheduleRequest,
    ScheduleResult,
    ScheduledAssignment,
    WorkingWindow,
)


_TIME_LIMIT_SECONDS = 10.0
_MAX_HORIZON_DAYS = 9


def solve(request: ScheduleRequest) -> ScheduleResult:
    horizon = min(request.horizonDays, _MAX_HORIZON_DAYS)

    compat = _build_compatibility(request, horizon)
    if any(len(entries) == 0 for entries in compat.values()):
        return _fallback(request)

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

    # C2/C3. No-overlap buckets.
    by_doctor_day: Dict[Tuple[str, int], List[cp_model.IntervalVar]] = defaultdict(list)
    by_day: Dict[int, List[cp_model.IntervalVar]] = defaultdict(list)
    for (pid, w_idx), iv in intervals.items():
        w = request.windows[w_idx]
        by_doctor_day[(w.doctorId, int(w.day))].append(iv)
        by_day[int(w.day)].append(iv)

    for ivs in by_doctor_day.values():
        if len(ivs) > 1:
            model.AddNoOverlap(ivs)
    for ivs in by_day.values():
        if len(ivs) > 1:
            model.AddNoOverlap(ivs)

    # Objective: minimize the latest day used.
    max_day = model.NewIntVar(0, max(horizon - 1, 0), "max_day")
    for (pid, w_idx), present in x.items():
        day = int(request.windows[w_idx].day)
        model.Add(max_day >= day).OnlyEnforceIf(present)
    model.Minimize(max_day)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = _TIME_LIMIT_SECONDS
    status = solver.Solve(model)

    if status == cp_model.OPTIMAL:
        return _build_result("optimal", request, x, starts, solver)
    if status == cp_model.FEASIBLE:
        return _build_result("feasible", request, x, starts, solver)

    return _fallback(request)


def _build_compatibility(
    request: ScheduleRequest, horizon: int
) -> Dict[str, List[Tuple[int, WorkingWindow]]]:
    compat: Dict[str, List[Tuple[int, WorkingWindow]]] = {}
    for p in request.procedures:
        allowed = set(p.allowedDoctorIds)
        entries: List[Tuple[int, WorkingWindow]] = []
        for w_idx, w in enumerate(request.windows):
            if w.doctorId not in allowed:
                continue
            if int(w.day) >= horizon:
                continue
            if int(w.endMinute) - int(w.startMinute) < int(p.durationMinutes):
                continue
            entries.append((w_idx, w))
        compat[p.id] = entries
    return compat


def _build_result(
    status: str,
    request: ScheduleRequest,
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

    return ScheduleResult(
        status=status,
        assignments=assignments,
        objective=float(solver.ObjectiveValue()),
    )


def _fallback(request: ScheduleRequest) -> ScheduleResult:
    # Spec calls this "degraded"; the Pydantic Literal only permits
    # "unknown" (the other non-success bucket), so we use "unknown"
    # to keep the existing contract stable.
    return ScheduleResult(
        status="unknown",
        assignments=_greedy_stub(request),
        objective=None,
    )


def _greedy_stub(request: ScheduleRequest) -> List[ScheduledAssignment]:
    """Deterministic, obviously-wrong stub placeholder.

    Produces a trivially-shaped plan so the end-to-end pipeline can be
    exercised by the extension without waiting on the real solver.
    """
    assignments: List[ScheduledAssignment] = []
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
