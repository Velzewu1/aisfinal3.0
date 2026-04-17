# 06 · Backend (FastAPI + CP-SAT)

The backend exists for one reason: **server-only capabilities** the extension
cannot or should not do, primarily **constraint-based scheduling**. It does
not drive the DOM, does not see the host page, and does not make decisions
about what the agent should do next.

Source of truth:

- Entrypoint: `backend/api/main.py`.
- Routers: `backend/api/routers/schedule.py`, `backend/api/routers/events.py`.
- Solver: `backend/core/scheduler.py` (OR-Tools CP-SAT).
- Event sink: `backend/core/event_sink.py`.
- Models: `backend/models/schedule.py`, `backend/models/events.py`
  (Pydantic mirrors of `packages/schemas`).

---

## 1. Hard rules

- The backend never mutates the DOM. It never returns HTML fragments or
  scripts.
- The backend returns **structured results only** — the executor renders them.
- The backend is strictly separated from the extension: the only shared
  surface is the Pydantic ↔ Zod contract pair.
- The backend may refuse a request on validation grounds. It does not
  reinterpret ambiguous input — that is the controller's job.

## 2. Contracts

Pydantic models in `backend/models/` are 1:1 mirrors of the Zod schemas in
`packages/schemas/src/`:

| Zod (client)       | Pydantic (server)    |
|--------------------|----------------------|
| `ScheduleRequest`  | `ScheduleRequest`    |
| `ScheduleResult`   | `ScheduleResult`     |
| `ScheduledAssignment` | `ScheduledAssignment` |
| `AgentEvent` (envelope) | `EventEnvelope`  |

A contract change is a coordinated two-file change. Drift is a bug.

## 3. Endpoints

### `POST /api/schedule`

| Field          | Value                                         |
|----------------|-----------------------------------------------|
| Request body   | `ScheduleRequest` (JSON).                     |
| Request header | `x-correlation-id: <cid>` (optional but recommended). |
| Response body  | `ScheduleResult` (JSON).                      |
| Failure        | `422` on schema mismatch; `500` on solver error. |

Behavior:

1. Pydantic validates the request. Rejected requests never reach the solver.
2. `scheduler.solve(request)` runs OR-Tools CP-SAT with a bounded wall-clock
   (`max_time_in_seconds = 5.0` in the scaffold).
3. Response status is one of `"optimal" | "feasible" | "infeasible" | "unknown"`.

### `POST /api/events`

| Field          | Value                         |
|----------------|-------------------------------|
| Request body   | `EventEnvelope` (JSON).       |
| Response body  | `{ "ok": true }`.             |

Appends to an in-memory ring buffer in the scaffold. Production binding:
Supabase `ai_rpa_events`.

### `GET /api/events?limit=N`

Returns the most recent `N` `EventEnvelope` records from the sink (scaffold
convenience; production would query Supabase directly).

### `GET /health`

`{ "status": "ok", "service": "ai-rpa-agent" }` — liveness only.

## 4. CP-SAT problem shape

Input (`ScheduleRequest`):

- `horizonDays` — default 9.
- `slotMinutes` — default 15.
- `doctors[]` — `{ id, name, specialty? }`.
- `procedures[]` — `{ id, name, durationMinutes, allowedDoctorIds[] }`.
- `windows[]` — `{ doctorId, day, startMinute, endMinute }`.

Constraints the full solver enforces (skeleton is in place):

1. Each `procedure` is assigned exactly one `(doctor, day, startMinute)`.
2. `doctor` appearing in the assignment must be in `procedure.allowedDoctorIds`.
3. Assigned interval lies inside at least one of the doctor's `windows`.
4. No two procedures assigned to the same doctor may overlap in time.
5. Optional objective: minimize makespan / maximize utilization — product
   tuned.

Output (`ScheduleResult`):

```
{
  status: "optimal" | "feasible" | "infeasible" | "unknown",
  assignments: [ { procedureId, doctorId, day, startMinute, endMinute }, ... ],
  objective?: number
}
```

The controller wraps this as an `inject_schedule` `DomAction` — see
[`04_executor.md`](04_executor.md).

## 5. CORS and origins

Configured in `backend/api/main.py` from `BACKEND_ALLOWED_ORIGINS`:

- `chrome-extension://*` (regex) — the extension itself.
- `http://localhost:5173` — the mock UI during development.
- Allowed methods: `GET`, `POST`.
- Allowed headers: `content-type`, `x-correlation-id`.

## 6. Failure handling

| Condition                              | Backend behavior                                   |
|----------------------------------------|----------------------------------------------------|
| Invalid `ScheduleRequest`              | `422` with Pydantic errors; no solver work.        |
| Solver timeout                         | Return `status: "unknown"` with empty assignments. |
| Solver infeasibility                   | Return `status: "infeasible"`.                     |
| Internal exception                     | `500` — the controller retries once, then degrades.|

Client-side retry and degradation policy lives in the controller
(see [`03_controller.md`](03_controller.md)). The backend itself does not
retry — it fails fast with a structured status.

## 7. Security posture

- Authn/authz are deliberately unspecified in the scaffold. Production
  deployments MUST:
  - Require a session / service token on every request.
  - Authorize the caller for the target patient / tenant scope.
  - Never trust the extension alone for authorization of sensitive ops.
- No secrets in request or response bodies. `x-correlation-id` is the only
  non-content header used.
- PHI minimization is upstream of the backend: the controller is responsible
  for what ends up in a `ScheduleRequest`.
