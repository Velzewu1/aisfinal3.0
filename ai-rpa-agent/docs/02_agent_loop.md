# 02 · Agent loop (runtime pipeline)

This document is the **canonical runtime execution chain**. It contains the
18 runtime steps and nothing else. Architectural rationale lives in
[`01_architecture.md`](01_architecture.md). Decision policy lives in
[`03_controller.md`](03_controller.md).

Every step below runs under a single `correlationId` that threads the full
interpret → decide → execute → audit chain.

---

## Perception

### Step 1 — Voice capture
Clinician triggers recording in the side panel; `MediaRecorder` produces an
audio blob. Emits `voice_captured`. No DOM access.

### Step 2 — Audio preprocessing
Optional denoise / normalization before transcription. Still in the perception
layer. No DOM access.

### Step 3 — Speech-to-text (Whisper)
Audio → text. Medical-vocabulary-tuned if available.

### Step 4 — Utterance normalization
Cleanup: punctuation, terminology, language, and PHI minimization per policy.
Output: normalized text.

---

## Reasoning

### Step 5 — Context attach
Bound context added to the prompt: active patient id, current page id, active
form id. Raw HTML is never attached; only logical labels allowed by policy.

### Step 6 — LLM reasoning (Claude Tool Use / OpenAI structured outputs)
Model returns **only** a JSON object matching `LlmInterpretation`:
`schemaVersion`, `intent`, `confidence`, optional `rationale`. No prose
control signal.

---

## Validation

### Step 7 — Schema validation (Zod)
`LlmInterpretation.safeParse(raw)` on the client. On failure: emit
`validation_failed` and either retry with a constrained prompt or request
clarification from the user. On success: emit `validation_passed`.

### Step 8 — Confidence evaluation
Extract `confidence ∈ [0, 1]`. Attach risk flags from the intent kind
(see [`03_controller.md`](03_controller.md)).

---

## Decision

### Step 9 — Controller decision gate
The controller emits `decision_made` with one of:

- `execute` — proceed.
- `confirm` — require user confirmation before proceeding.
- `reject` — stop; record the reason.

### Step 10 — Intent routing
Route the validated intent into one of four branches:
`fill` · `navigate` · `schedule` · `set_status`.

### Step 11 — Action planning
Convert the intent into an `ActionPlan` = ordered `DomAction[]`. Pure
function; no DOM, no network, no LLM.

### Step 12 — DOM selector resolution
Map logical field ids to approved `data-*` attributes
(`data-field`, `data-action`, `data-nav`, `data-status-entity`,
`data-schedule-grid`). Raw CSS/XPath is rejected at this boundary.

---

## Execution

### Step 13 — Executor dispatch
Controller sends `execute_plan` to the active tab via
`chrome.tabs.sendMessage`. The service worker never touches the DOM.

### Step 14 — DOM execution
The content script runs each `DomAction` in order: fill inputs, click
`data-action` targets, navigate tabs, transition status badges. Each action
either succeeds or returns a structured failure.

---

## Backend (conditional)

### Step 15 — Backend call (when intent = schedule)
Controller `POST /api/schedule` with a validated `ScheduleRequest`. Request
carries `x-correlation-id`. Emits `schedule_requested`.

### Step 16 — CP-SAT optimization
Backend solves the constraint problem (doctors × procedures × windows over a
9-day horizon by default) and returns a `ScheduleResult`. Emits
`schedule_generated` on receipt.

### Step 17 — Schedule injection back to DOM
Controller wraps the `ScheduleResult` as an `inject_schedule` `DomAction` and
dispatches it to the executor. The grid renders from the structured payload
only — no HTML fragments from the backend.

---

## Audit

### Step 18 — Event logging + Supabase sync
Every step above emits one or more `AgentEvent` records sharing the same
`correlationId`. The background service worker:

1. Publishes to the in-process event bus.
2. Syncs to the append-only `ai_rpa_events` table in Supabase.
3. Notifies the side-panel timeline for live display.

Events are immutable: corrections are recorded as new events, never as edits.
The full taxonomy lives in [`05_events.md`](05_events.md).
