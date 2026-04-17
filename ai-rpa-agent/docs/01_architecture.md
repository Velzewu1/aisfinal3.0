# 01 · Architecture

The canonical structural reference. **No runtime steps, no setup, no build
logs.** Those live in [`02_agent_loop.md`](02_agent_loop.md),
[`07_dev_setup.md`](07_dev_setup.md), and
[`08_scaffold_status.md`](08_scaffold_status.md) respectively.

---

## 1. Layer stack

```
┌────────────────────────────────────────────────────────────────────┐
│  PERCEPTION            voice capture, normalization, STT (API)   │
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

**Invariant:** untrusted **outputs** from the AI zone (`extension/llm`) must not
drive DOM mutation, storage mutation, or integration side effects without
validation and controller approval. The LLM client may still call its provider
over the network.

**Perception (`extension/voice`) and STT:** Speech-to-text is an **external
perception dependency**: the voice module **may** use the network **only** to
call the STT provider (e.g. OpenAI Whisper via `fetch`). That path turns audio
into text; it does not produce or enforce automation semantics. The voice module
**must not** validate `LlmInterpretation` / structured intents (Zod or
equivalent), **decide** plans or policy outcomes, or **execute** RPA / mutate
the host page DOM—those stay in the controller and content script respectively.

All **control-path** effects (approved automation, scheduling) flow
`Validation → Controller → (Executor | Backend)`.

## 3. Module map

| Path                               | Layer     | May mutate DOM? | May call network? | Decides? |
|------------------------------------|-----------|-----------------|-------------------|----------|
| `extension/voice/`                 | perception| no              | yes (STT only)    | no       |
| `extension/llm/`                   | reasoning | no              | yes (provider)    | no       |
| `packages/schemas/`                | contract  | no              | no                | no       |
| `extension/controller/`            | decision  | no              | yes (backend)     | **yes**  |
| `extension/content/`               | execution | **yes**         | no                | no       |
| `extension/background/`            | audit     | no              | yes (Supabase)    | no       |
| `extension/sidepanel/`             | UI orchestrator | its own DOM only | **indirect** — may start perception/STT **via messages**; no direct STT/LLM HTTP in the panel (see §3) | no       |
| `backend/api/`                     | service   | no              | —                 | no       |
| `backend/core/scheduler.py`        | service   | no              | —                 | no       |

**`extension/voice/`:** Implements capture, optional preprocessing, and
transcription. **Network:** STT provider API only (see §2). **Out of scope:**
`LlmInterpretation` validation, controller decisions, and host DOM execution.

**`extension/sidepanel/` (UI orchestrator):** The side panel **may** trigger the
perception pipeline from the UI (e.g. record/stop, typed utterance submit) via
`chrome.runtime.sendMessage` to the service worker / controller. It **may**
**initiate STT network activity indirectly**—user actions and messages cause the
controller to run preprocessing and transcription, which performs the STT
`fetch` inside `extension/voice` (not in the side panel). It **may** kick off the
normalization path the same way (messages that ultimately run `normalizeUtterance`
after text is available). The side panel **must not** **decide** automation
(`execute` / `confirm` / `reject`), **validate** `LlmInterpretation` or policy, or
**execute** host-page RPA / `DomAction` DOM automation (it only mutates its own
extension UI). It does **not** call the LLM or STT HTTP APIs directly.

## 4. Why the controller exists

1. It is the **only** place that turns a validated intent into an approved
   `ActionPlan`.
2. It encodes policy: allowlists, confidence thresholds, risk overrides.
   Confidence evaluation is a pure helper invoked from the decision gate,
   not a standalone pipeline stage — it runs inside the Decision layer.
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

The executor also **owns selector resolution**: `DomAction`s cross the
Decision → Execution boundary carrying logical ids only (e.g.
`field: "complaints"`), and the executor is the single place that maps
those ids to approved `data-*` attributes. The controller and planner
never emit CSS or XPath. This keeps the Decision layer DOM-free and
makes selector policy reviewable in one file.

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
  confirmation buttons, event timeline) and a **UI orchestrator**: it **may**
  trigger the perception pipeline and **indirectly** cause STT (and follow-on
  normalization) via messages to the service worker. It **must not** validate
  structured intents, decide plans, or execute host-page automation; it does not
  perform STT or LLM HTTP calls itself.

## 8. Extension points

- Swap LLM vendor → replace `extension/llm/providers/*`; contract is unchanged.
- Add intent → extend `Intent` schema + controller policy + planner branch +
  executor opcode (if it introduces a new `DomAction`).
- Swap event store → replace `extension/background/supabase-sync.ts`; the
  event shape is fixed by `AgentEvent`.
- Reuse in a non-healthcare domain → change the host page's `data-*` manifest
  and controller policy; no change to executor code.
