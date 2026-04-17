# 05 · Events

The event log is the system's memory. Every material step of the agent loop
emits an `AgentEvent`. The log is **append-only**: corrections are new events,
never edits.

Source of truth:

- Schema: `packages/schemas/src/events.ts` (`AgentEvent` discriminated union).
- Publisher in-browser: `extension/background/event-bus.ts`.
- Sync: `extension/background/supabase-sync.ts`.
- Append-only table: `infra/supabase/0001_events.sql` (`ai_rpa_events`).
- Server-side mirror: `backend/models/events.py` +
  `backend/core/event_sink.py`.

---

## 1. Envelope

Every event shares:

| Field           | Type          | Meaning                                          |
|-----------------|---------------|--------------------------------------------------|
| `id`            | `string`      | Unique event id (generated at emission).         |
| `correlationId` | `string`      | Ties together one interpret → execute chain.     |
| `type`          | `EventType`   | Discriminator; one of the enum below.            |
| `ts`            | ISO-8601      | Emission timestamp.                              |
| `payload`       | type-specific | Discriminated by `type`.                         |

The full type is `AgentEvent` — a Zod discriminated union on `type`.

## 2. Event taxonomy

| `type`                          | Emitted by              | Payload summary                            |
|---------------------------------|-------------------------|--------------------------------------------|
| `voice_captured`                | sidepanel → controller  | duration, mime type, size                  |
| `intent_parsed`                 | controller              | validated `LlmInterpretation`              |
| `validation_passed`             | controller              | `schemaVersion`                            |
| `validation_failed`             | controller              | errors + raw (truncated) LLM output        |
| `decision_made`                 | controller              | `decision`, `confidence`, `reason`         |
| `user_confirmation_requested`   | controller              | human-readable summary                     |
| `user_confirmation_received`    | controller              | `accepted: boolean`                        |
| `schedule_requested`            | controller              | `ScheduleRequest`                          |
| `schedule_generated`            | controller (post-call)  | `ScheduleResult`                           |
| `dom_action_executed`           | controller (post-exec)  | action + `ExecutorResult`                  |
| `dom_action_failed`             | controller (post-exec)  | action + error token                       |

Events the scaffold does **not** emit (reserved for future policy):
`degraded_mode_entered`, `action_corrected`, `session_closed`.

## 3. Correlation IDs

- Generated at the earliest entry point (side-panel record button or text
  submit) via `newCorrelationId()` in `extension/shared/correlation.ts`.
- Passed on every `ExtensionMessage` between modules.
- Passed to the backend via the `x-correlation-id` HTTP header.
- Carried in every `AgentEvent`.

A single `correlationId` must be sufficient to reconstruct the full agent
chain: perception → LLM → validation → decision → backend call → execution →
completion.

## 4. Emission rules

- Only **trusted layers** (controller, content, background, backend) emit
  events. The LLM module does not emit; its outputs pass through the
  controller, which emits on its behalf.
- The controller is responsible for emitting `dom_action_executed` /
  `dom_action_failed` after receiving `ExecutorResult`. The executor does not
  emit directly — this keeps the event surface in one file.
- Events are published to the in-worker event bus first, then synced to the
  durable store. Sync failures must not block the agent loop.

## 5. Storage contract

The durable table (`public.ai_rpa_events`) is insert-only:

- Primary key: `id`.
- Indexes: `correlation_id`, `type`, `ts desc`.
- `alter table ... enable row level security`.
- Policy: insert-only for authenticated callers. **No update/delete policies
  are defined** — the schema enforces immutability.

Tenant-scoped `select` policies are deliberately not shipped; they belong in
a follow-up migration tied to the deployment's identity model.

## 6. Replay model

Because events are immutable and `correlationId`-keyed, a full session can
be replayed deterministically for audit or debugging:

1. Select all events where `correlation_id = $1` ordered by `ts`.
2. Reconstruct the pipeline state transition by transition.
3. The executed `DomAction[]` is recoverable from `dom_action_executed`
   payloads; re-running it against a snapshot of the host DOM produces the
   same result (executor determinism, see [`04_executor.md`](04_executor.md)).
