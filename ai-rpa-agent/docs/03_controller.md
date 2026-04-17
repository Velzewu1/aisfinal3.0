# 03 · Controller

The controller is the **single trusted decision layer**. It never mutates the
DOM and never calls the LLM for decisions — it uses the LLM only as an
input source, already validated against schema.

Source of truth:

- `extension/controller/confidence.ts` — thresholds, risk flags, decisions.
- `extension/controller/planner.ts` — intent → `DomAction[]`.
- `extension/controller/backend-client.ts` — `/api/schedule` adapter.
- `extension/controller/index.ts` — orchestration + event emission.

---

## 1. Inputs and outputs

| Input                              | Source                         |
|------------------------------------|--------------------------------|
| `LlmInterpretation` (validated)    | `extension/llm` via background |
| `ExecutorResult`                   | `extension/content`            |
| `UserConfirmation`                 | `extension/sidepanel`          |
| `ScheduleResult`                   | `backend/api/schedule`         |

| Output                             | Sink                           |
|------------------------------------|--------------------------------|
| `execute_plan` (`DomAction[]`)     | `extension/content`            |
| `ScheduleRequest`                  | `backend/api/schedule`         |
| `AgentEvent` stream                | background event bus → Supabase|

## 2. Decision gate

Defined in `confidence.ts`:

```
CONFIDENCE_THRESHOLD = 0.7
```

Decision table:

| Condition                                                   | Decision   |
|-------------------------------------------------------------|------------|
| `intent.kind == "unknown"`                                  | `reject`   |
| `isHighRisk(intent.kind)` (see §3)                          | `confirm`  |
| `confidence >= 0.7` and not high risk                       | `execute`  |
| `confidence <  0.7`                                         | `confirm`  |

Every decision emits a `decision_made` event with `{ decision, confidence, reason }`.

## 3. Risk classification

High-risk intents always require confirmation regardless of confidence:

| Intent        | High risk? | Rationale                                          |
|---------------|------------|----------------------------------------------------|
| `fill`        | no         | Reversible in-place edit; covered by schema.       |
| `navigate`    | no         | Controlled by `data-nav` allowlist.                |
| `schedule`    | **yes**    | Writes a multi-entity plan; involves backend.      |
| `set_status`  | **yes**    | Workflow state transitions are often irreversible. |
| `unknown`     | reject     | Never executed.                                    |

Product policy may upgrade specific fields (e.g. `data-field="diagnosis"`) to
high-risk; that upgrade lives in the controller policy, never in the LLM.

## 4. Confirmation protocol

When the decision is `confirm`, the controller:

1. Stores the pending `LlmInterpretation` keyed by `correlationId`.
2. Emits `user_confirmation_requested` with a short, human-readable summary.
3. Waits for a `user_confirmation` message from the side panel.
4. Emits `user_confirmation_received { accepted }`.
5. If `accepted`, runs the plan (and the backend call if schedule). If not,
   drops the pending intent.

The controller **must not** dispatch `execute_plan` before a
`user_confirmation_received { accepted: true }` event exists for that
correlation id.

## 5. Planner contract

`planActions(intent, scheduleResult?) → DomAction[]` is:

- **Pure** — no DOM, no network, no LLM, no clock, no storage.
- **Total** — every `Intent` kind is exhaustively matched.
- **Stable** — identical inputs produce identical outputs (no randomness).

Branches:

| Intent        | Produces                                                       |
|---------------|----------------------------------------------------------------|
| `fill`        | one `fill` action per slot, in declaration order.              |
| `navigate`    | one `navigate` action pointing at `data-nav=<target>`.         |
| `set_status`  | one `set_status` action on `data-status-entity=<entity>`.      |
| `schedule`    | one `inject_schedule` action carrying the `ScheduleResult`.    |
| `unknown`     | `[]` (should never reach the planner; filtered by the gate).   |

## 6. Session state machine

The controller runs a session-scoped FSM. This is not the HIS state machine —
only the agent session.

```
[Idle]
  → input                          : [Listening]
[Listening]
  → transcript ready               : [Interpreting]
[Interpreting]
  → LLM JSON valid                 : [Validating]
  → LLM JSON invalid (after retry) : [Recovering] → [AwaitingUser]
[Validating]
  → schema valid                   : [Deciding]
  → schema invalid                 : [Recovering]
[Deciding]
  → execute                        : [Executing] | [CallingBackend] → [Executing]
  → confirm                        : [AwaitingUser]
  → reject                         : [Idle]
[CallingBackend]
  → success                        : [Executing]
  → failure (after 1 retry)        : [Degraded] → [AwaitingUser]
[Executing]
  → success                        : [Logging] → [Idle]
  → failure                        : [Recovering] → [AwaitingUser]
[AwaitingUser]
  → accepted                       : [Deciding] | [Executing]
  → rejected                       : [Idle]
```

Every transition material to audit emits an event
(see [`05_events.md`](05_events.md)).

## 7. Fallback policy

| Situation                              | Fallback                                                           |
|----------------------------------------|--------------------------------------------------------------------|
| Schema invalid after N LLM retries     | Clarify with user; log `validation_failed`; never execute.         |
| Ambiguous slot values                  | One round-trip slot refinement to the user, then decide again.     |
| Executor reports `dom_target_missing`  | Log `dom_action_failed`; controller chooses retry / escalate.      |
| Partial multi-step plan failure        | Stop the chain; do not attempt "best effort" remainder.            |
| Backend timeout / error                | One retry at the backend client; then degrade (skip optimization or queue). |
| Unknown intent                         | Escalate to user; never guess a destructive action.                |

**Recovery invariant:** the page must never be left in an unknown state
without an event recording what was attempted and what failed.
