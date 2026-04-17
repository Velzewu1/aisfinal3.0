# 00 · Product overview

## What this system is

An **enterprise AI RPA platform** for healthcare web automation. It turns a
clinician's natural-language intent (voice or text) into **validated,
auditable, deterministic actions** inside a host web application — forms,
navigation, status transitions, and schedule placement.

The deployment target is a Chrome Manifest V3 extension paired with a FastAPI
backend. The reference host surface is a Damumed-style HIS (hospital
information system) UI.

## What this system is **not**

- **Not a chatbot.** The primary artifact is a completed workflow action, not
  a dialogue. Prose output is a secondary channel (clarifications, audit
  summaries) and never a control signal.
- **Not an "AI agent that clicks buttons."** The LLM never operates the
  browser. It emits structured JSON that is validated and then executed by a
  trusted, deterministic pipeline.
- **Not a shared decision surface.** The LLM, the backend, and the host page
  do **not** make decisions about what runs. One component does: the
  controller.

## Core design stance

| Principle                           | Consequence in the system                                               |
|-------------------------------------|-------------------------------------------------------------------------|
| Separation of intelligence & action | LLM proposes; controller decides; executor acts.                        |
| Schema-first contracts              | Every cross-layer payload passes a validation boundary.                 |
| Least privilege for AI              | LLM output is untrusted until validated and approved.                   |
| Deterministic execution             | DOM mutation only via the executor, only via approved `data-*` targets. |
| Full auditability                   | Every material step emits an immutable event with a correlation id.     |
| Graceful degradation                | Failures fall back to retry → clarify → confirm → escalate.             |

## Primary automation capabilities

| Capability   | Surface                                 |
|--------------|-----------------------------------------|
| `fill`       | Populate form fields from structured slots. |
| `navigate`   | Move between allowed views / tabs.     |
| `schedule`   | Solve scheduling problems via CP-SAT on the backend and inject the grid. |
| `set_status` | Transition workflow state (draft → submitted → final, etc.). |

Any utterance that does not map cleanly to one of the above MUST be classified
as `unknown` and escalated — never silently coerced.

## Where to go next

| You want to...                                       | Read                        |
|------------------------------------------------------|-----------------------------|
| Understand the layers and trust boundaries           | [`01_architecture.md`](01_architecture.md) |
| Follow an utterance end-to-end through the 18 steps  | [`02_agent_loop.md`](02_agent_loop.md) |
| Understand confidence, gating, and confirmation      | [`03_controller.md`](03_controller.md) |
| Understand how DOM changes actually happen           | [`04_executor.md`](04_executor.md) |
| Understand the event model                           | [`05_events.md`](05_events.md) |
| Understand the backend and CP-SAT contract           | [`06_backend.md`](06_backend.md) |
| Run it locally                                       | [`07_dev_setup.md`](07_dev_setup.md) |
| Check what is wired vs scaffold                      | [`08_scaffold_status.md`](08_scaffold_status.md) |
