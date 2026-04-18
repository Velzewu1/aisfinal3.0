# 02 · Agent loop (runtime pipeline)

This document is the **canonical runtime execution chain**. It contains the
18 runtime steps and nothing else. Architectural rationale lives in
[`01_architecture.md`](01_architecture.md). Decision policy lives in
[`03_controller.md`](03_controller.md).

Every step below runs under a single `correlationId` that threads the full
interpret → decide → execute → audit chain.

**Text input path:** Typed utterances enter at Step 4 (normalize), skipping
Steps 1–3 (voice capture, preprocess, STT).

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
Output: normalized text. (Typed input joins here; see pipeline note above.)

---

## Reasoning

### Step 5 — Context attach
The controller sends `extract_page_context` to the content script in the
active tab, which returns a `PageContext` snapshot (URL slug, logical page id,
patient state, `[data-field]` descriptors, extraction timestamp). The response
is validated through `PageContext.safeParse()` — rejecting raw HTML,
unrestricted DOM snapshots, and structurally invalid payloads. Only the
normalized, policy-approved `PageContext` is merged into the contextualized
utterance that reaches the reasoning layer. Raw HTML is never attached; only
logical labels allowed by policy.

Reasoning input is conceptually three separate channels:

| Channel            | Source                      | Merged here? |
|--------------------|-----------------------------|--------------|
| Utterance          | Step 4 normalization        | Yes          |
| `PageContext`      | Content script (live DOM)   | Yes          |
| `RetrievedContext` | Knowledge registry (assets) | Placeholder (empty in current patch) |

`PageContext` and `RetrievedContext` are **never merged with each other** — they
are assembled independently and kept as separate input to the LLM prompt.
See [`09_knowledge_assets.md`](09_knowledge_assets.md).

### Step 6 — LLM reasoning (Claude Tool Use / OpenAI structured outputs)
Model returns **only** a JSON object matching `LlmInterpretation`:
`schemaVersion`, `intent`, `confidence`, optional `rationale`. No prose
control signal.

---

## Validation

### Step 7 — Schema validation (Zod)
`LlmInterpretation.safeParse(raw)` on the client. On Zod failure: emit
`validation_failed` and either retry with a constrained prompt or request
clarification from the user. The controller then applies the intent **policy
allowlist** (controller-enumerated values, e.g. nav targets, fill fields);
allowlist failure emits `validation_failed` as well. Emit
`intent_parsed`, then **`validation_passed` on Zod + policy allowlist success**.

---

## Decision

Steps 8–11 are **Decision** layer only. **Step 8 (confidence evaluation) lives
here under Decision, not under Validation.** Step 7 is the validation boundary
for structured LLM output.

### Step 8 — Confidence evaluation
Extract `confidence ∈ [0, 1]` and attach risk flags derived from the
intent kind. Implemented as a pure helper
(`controller/confidence.ts::evaluateConfidence`) that is invoked from the
decision gate (Step 9) rather than as a separate stage in the pipeline;
it shares the Decision layer's trust posture.
See [`03_controller.md`](03_controller.md).

### Step 9 — Controller decision gate
The controller emits `decision_made` with one of:

- `execute` — proceed.
- `confirm` — require user confirmation before proceeding.
- `reject` — stop; record the reason.

### Step 10 — Intent routing
Route the validated intent into one of four branches:
`fill` · `navigate` · `schedule` · `set_status`.

### Step 11 — Action planning
Convert the intent into an `ActionPlan` = ordered `DomAction[]`. Actions
carry **logical** field / nav / entity ids; no CSS or XPath. Pure
function; no DOM, no network, no LLM.

---

## Execution

### Step 12 — DOM selector resolution
Map the logical ids carried in each `DomAction` to approved `data-*`
attributes (`data-field`, `data-action`, `data-nav`, `data-status-entity`,
`data-schedule-grid`). Owned by the **executor** (`content/executor.ts`):
the controller / planner never emit CSS or XPath, and the resolution is
the first thing the executor does inside `dispatch` for each action.
Raw CSS/XPath is rejected at this boundary.

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
9-day horizon by default) and returns a `ScheduleResult`. Controller emits
`schedule_generated` on HTTP response receipt from backend.

### Step 17 — Schedule injection back to DOM
Controller wraps the `ScheduleResult` as an `inject_schedule` `DomAction` and
dispatches it to the executor. The grid renders from the structured payload
only — no HTML fragments from the backend.

---

## Audit

### Step 18 — Event logging + Supabase sync
Critical steps emit `AgentEvent` records sharing the same `correlationId`;
other steps are logged internally through the structured logger without
creating a durable event. The exact set of durable event types is defined
by the `AgentEvent` discriminated union in `packages/schemas/src/events.ts`
and enumerated in [`05_events.md`](05_events.md); additions require a
schema version bump. The background service worker:

1. Publishes every emitted event to the in-process event bus.
2. Syncs to the append-only `ai_rpa_events` table in Supabase.
3. Notifies the side-panel timeline for live display.

Events are immutable: corrections are recorded as new events, never as edits.
The full taxonomy lives in [`05_events.md`](05_events.md).
