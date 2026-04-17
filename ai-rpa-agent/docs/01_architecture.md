# 01 · Architecture

The canonical structural reference. **No runtime steps, no setup, no build
logs.** Those live in [`02_agent_loop.md`](02_agent_loop.md),
[`07_dev_setup.md`](07_dev_setup.md), and
[`08_scaffold_status.md`](08_scaffold_status.md) respectively.

---

## 1. Layer stack

```
┌────────────────────────────────────────────────────────────────────┐
│  PERCEPTION            voice capture, normalization                │
└────────────────────────────────────────────────────────────────────┘
                               │ utterance + metadata
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│  REASONING (LLM)       untrusted; returns STRUCTURED JSON ONLY     │
└────────────────────────────────────────────────────────────────────┘
                               │ LlmInterpretation (raw)
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│  VALIDATION            Zod (client) / Pydantic (server)             │
└────────────────────────────────────────────────────────────────────┘
                               │ LlmInterpretation (validated)
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│  DECISION (Controller) sole approver of plans; never touches DOM   │
└────────────────────────────────────────────────────────────────────┘
                  │                                │
       ActionPlan │                                │ ScheduleRequest
                  ▼                                ▼
┌──────────────────────────┐       ┌────────────────────────────────┐
│  EXECUTION               │       │  BACKEND (FastAPI)             │
│  only DOM mutator        │       │  CP-SAT, no DOM                │
└──────────────────────────┘       └────────────────────────────────┘
                  │                                │
                  └──────────────┬─────────────────┘
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│  EVENT STORE           append-only; correlation-id keyed           │
└────────────────────────────────────────────────────────────────────┘
```

## 2. Trust model

| Zone        | Components                      | Trust                                  |
|-------------|---------------------------------|----------------------------------------|
| AI          | `extension/llm`                 | **Untrusted** — output must validate.  |
| Control     | `packages/schemas`, `extension/controller` | **Trusted** — enforces rules. |
| Execution   | `extension/content`             | **Trusted** — deterministic DOM.       |
| Service     | `backend/*`                     | **Trusted** — no DOM knowledge.        |
| Audit       | `extension/background`, `infra/supabase` | **Trusted** — append-only.    |

**Invariant:** nothing in the AI zone may trigger a side effect (DOM, network
mutation, storage) directly. All effects flow
`Validation → Controller → (Executor | Backend)`.

## 3. Module map

| Path                               | Layer     | May mutate DOM? | May call network? | Decides? |
|------------------------------------|-----------|-----------------|-------------------|----------|
| `extension/voice/`                 | perception| no              | no                | no       |
| `extension/llm/`                   | reasoning | no              | yes (provider)    | no       |
| `packages/schemas/`                | contract  | no              | no                | no       |
| `extension/controller/`            | decision  | no              | yes (backend)     | **yes**  |
| `extension/content/`               | execution | **yes**         | no                | no       |
| `extension/background/`            | audit     | no              | yes (Supabase)    | no       |
| `extension/sidepanel/`             | UI        | its own DOM only| no                | no       |
| `backend/api/`                     | service   | no              | —                 | no       |
| `backend/core/scheduler.py`        | service   | no              | —                 | no       |

## 4. Why the controller exists

1. It is the **only** place that turns a validated intent into an approved
   `ActionPlan`.
2. It encodes policy: allowlists, confidence thresholds, risk overrides.
3. It orchestrates the backend without giving the LLM imperative control.
4. It keeps the executor simple: the executor receives fully-specified,
   already-approved operations and never "interprets" anything.

Detailed decision logic lives in [`03_controller.md`](03_controller.md).

## 5. Why the executor is deterministic

- Safety: a stable `ActionPlan → DOM` mapping bounds blast radius.
- Audit: events can reproduce exact operations without branching on model
  output.
- Test: the executor can be unit-tested without flaking on LLM drift.
- Compliance: a reviewer can demonstrate exactly how automation touches the
  host system.

Selector policy, action schema, and missing-element handling live in
[`04_executor.md`](04_executor.md).

## 6. Contracts

All cross-layer payloads are defined once in `packages/schemas/src/` as Zod
schemas and mirrored in `backend/models/` as Pydantic models. The core types:

| Type                 | Owner                 | Consumer                              |
|----------------------|-----------------------|---------------------------------------|
| `LlmInterpretation`  | LLM (untrusted input) | Controller (after validation).        |
| `Intent` (discriminated union) | Controller  | Planner → ActionPlan.                 |
| `DomAction` (discriminated union) | Planner  | Executor.                             |
| `ActionPlan`         | Controller            | Executor.                             |
| `ExecutorResult`     | Executor              | Controller (event emission).          |
| `ScheduleRequest` / `ScheduleResult` | Controller / Backend | Both sides of `/api/schedule`. |
| `AgentEvent` (discriminated union) | Any trusted layer | Event store.                    |

Contract change = schema version bump + matching Pydantic update. There is no
other legitimate cross-layer shape.

## 7. Extension topology (Chrome MV3)

```
[sidepanel]  chrome.runtime.sendMessage  ─►  [background service worker]
                                                    │
                                                    ├─► controller (in-worker module)
                                                    │        │
                                                    │        └─► backend (fetch)
                                                    │
                                                    └─► chrome.tabs.sendMessage ─► [content script]
                                                                                         │
                                             ◄─ chrome.runtime.sendMessage ──────────────┘
```

- The **service worker** is the message router and event bus host.
- The **content script** is the executor; it is the only thing running in the
  page context.
- The **side panel** is the user surface (push-to-talk, text fallback,
  confirmation buttons, event timeline).

## 8. Extension points

- Swap LLM vendor → replace `extension/llm/providers/*`; contract is unchanged.
- Add intent → extend `Intent` schema + controller policy + planner branch +
  executor opcode (if it introduces a new `DomAction`).
- Swap event store → replace `extension/background/supabase-sync.ts`; the
  event shape is fixed by `AgentEvent`.
- Reuse in a non-healthcare domain → change the host page's `data-*` manifest
  and controller policy; no change to executor code.
