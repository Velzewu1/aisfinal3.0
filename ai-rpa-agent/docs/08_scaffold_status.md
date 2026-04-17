# 08 · Scaffold status

Engineering readiness snapshot for the current build. No architecture, no
rationale — only: **is this module wired, and what's the next step?**

Last verified: scaffold build on `0.1.0`.

---

## 1. Build state

| Artifact                                | Status |
|-----------------------------------------|--------|
| `packages/schemas` → `dist/`            | builds |
| `extension/dist/background.js`          | builds |
| `extension/dist/content.js`             | builds |
| `extension/dist/sidepanel.js`           | builds |
| `backend` imports + syntax              | clean  |
| Strict TypeScript (`tsc --noEmit`)      | zero errors |

## 2. Module readiness

| Module                                 | Wired? | Notes                                                      |
|----------------------------------------|--------|------------------------------------------------------------|
| `extension/voice/`                     | ✅     | `MediaRecorder` wrapper; start / stop; emits metadata.     |
| `extension/llm/client.ts`              | ✅     | Validates provider output against `LlmInterpretation`.     |
| `extension/llm/providers/claude.ts`    | ❌     | Scaffold; throws `llm_not_implemented`.                    |
| `extension/llm/providers/openai.ts`    | ❌     | Scaffold; throws `llm_not_implemented`.                    |
| `extension/controller/confidence.ts`   | ✅     | Threshold (0.7) + risk classifier.                         |
| `extension/controller/planner.ts`      | ✅     | Pure `Intent → DomAction[]` for all intent kinds.          |
| `extension/controller/backend-client.ts` | ✅   | `POST /api/schedule`; validates response; no retry yet.    |
| `extension/controller/index.ts`        | ✅     | Full decision pipeline; confirmation protocol; events.     |
| `extension/content/executor.ts`        | ✅     | Deterministic dispatch for all five `DomAction` kinds.     |
| `extension/content/selectors.ts`       | ✅     | Allowlist enforced; value regex enforced.                  |
| `extension/background/router.ts`       | ✅     | Routes all `ExtensionMessage` variants.                    |
| `extension/background/event-bus.ts`    | ✅     | In-worker pub/sub with ring buffer.                        |
| `extension/background/supabase-sync.ts`| 🟡     | Implemented; under reconciliation with the `ai_rpa_events` migration. |
| `extension/sidepanel/main.ts`          | ✅     | Record / stop / text / confirm buttons.                    |
| `backend/api/main.py`                  | ✅     | FastAPI app; CORS; health; routers mounted.                |
| `backend/api/routers/schedule.py`      | ✅     | Contract surface is live; body validated.                  |
| `backend/api/routers/events.py`        | ✅     | In-memory append + recent query.                           |
| `backend/core/scheduler.py`            | 🟡    | OR-Tools imported; constraints are a deterministic stub.   |
| `backend/core/event_sink.py`           | 🟡    | In-memory ring buffer only; Supabase binding pending.      |
| `mock-ui/`                             | ✅     | All three pages with approved `data-*` attributes.         |
| `infra/supabase/0001_events.sql`       | ✅     | Append-only migration ready; not applied by scaffold.      |

Legend: ✅ wired · 🟡 skeleton (runs, minimal logic) · ❌ not wired.

## 3. Explicit non-wiring

The pipeline is **deliberately** broken at one seam so the AI surface can be
developed in isolation:

```
voice ─► sidepanel ─► background ─► controller
                                       │
                                       │  LLM call is stubbed here:
                                       │  provider.interpret() throws
                                       │  llm_not_implemented.
                                       ▼
                                  (no-op)
```

Downstream of the seam — controller → planner → executor, controller →
backend — is fully wired. That is why the smoke test in
[`07_dev_setup.md`](07_dev_setup.md) bypasses voice/LLM and dispatches a
`DomAction[]` directly to the content script.

## 4. Success criteria (frozen)

| Criterion                                                | Status |
|----------------------------------------------------------|--------|
| Extension builds without errors (MV3)                    | ✅     |
| Modules cleanly separated by layer                       | ✅     |
| DOM executor exists but is NOT connected to AI yet       | ✅ (by design) |
| Backend runs a FastAPI server with a CP-SAT endpoint     | ✅     |
| Schemas are shared and strongly typed (Zod + Pydantic)   | ✅     |
| Mock UI is usable for testing DOM actions                | ✅     |
| Events carry `correlationId` end-to-end                  | ✅     |
| Supabase sync is wired                                   | 🟡 implemented; under reconciliation |
| LLM provider returns validated JSON                      | ❌ pending |
| CP-SAT solver enforces full constraint set               | 🟡 stub |

## 5. Next milestones (ordered)

1. **Wire one LLM provider** behind `LlmClient.interpret`. Keep provider calls
   in the controller only; never move them into content/background hot
   paths.
2. **Complete `scheduler.solve`** with the constraint set from
   [`06_backend.md`](06_backend.md) §4. Add unit tests against pinned inputs.
3. **Reconcile Supabase sync** in `supabase-sync.ts` against the
   `ai_rpa_events` migration (table name, column names, row shape). Sink
   is implemented and non-blocking; remaining work is verifying
   end-to-end insert parity with `infra/supabase/0001_events.sql`.
4. **Side-panel event timeline** that subscribes to the background event bus
   and renders recent events by `correlationId`.
5. **Alternate-selector fallback** in the controller for
   `dom_target_missing` (policy-gated).

## 6. Explicitly out of scope for the scaffold

- Authn/authz on the backend.
- Tenant-scoped RLS `select` policies on `ai_rpa_events`.
- ASR (Whisper) integration; the voice module stops at audio blob metadata.
- Retry/backoff on the backend client beyond the single budgeted retry that
  the controller will own.
- UI polish on the side panel beyond functional controls.
