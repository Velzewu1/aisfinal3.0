# 08 · Scaffold status

Engineering readiness snapshot for the current build. No architecture, no
rationale — only: **is this module wired, and what's the next step?**

**Overall status: MVP COMPLETE** (end-to-end voice/text → validation → decision
→ executor and optional CP-SAT + Supabase audit).

Last verified: `0.1.0` MVP build.

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
| **Stack: Whisper STT + LLM reasoning** | ✅   | **IMPLEMENTED:** OpenAI Whisper STT (`voice/transcribe.ts`) + OpenAI Chat Completions structured JSON (`llm/interpret.ts`, Step 6 Tool Use / JSON-object mode). Alternate vendors: `llm/providers/*` + `LlmClient` pattern. |
| `extension/voice/`                     | ✅     | Content-tab + content-script mic path; preprocess + Whisper STT. |
| `extension/llm/interpret.ts`           | ✅     | Primary reasoning path: OpenAI, `response_format: json_object`. |
| `extension/llm/client.ts`              | ✅     | Validates provider output against `LlmInterpretation`.       |
| `extension/llm/providers/claude.ts`    | ✅     | Claude Tool Use–shaped provider class (swap-in; live traffic uses `interpret.ts` today). |
| `extension/llm/providers/openai.ts`    | ✅     | Structured-output provider class (swap-in; live traffic uses `interpret.ts` today). |
| `extension/controller/confidence.ts`   | ✅     | Threshold (0.7) + risk classifier.                         |
| `extension/controller/planner.ts`      | ✅     | Pure `Intent → DomAction[]` for all intent kinds.          |
| `extension/controller/backend-client.ts` | ✅   | `POST /api/schedule`; validates response with Zod.         |
| `extension/controller/index.ts`        | ✅     | Full pipeline; **IMPLEMENTED** nav/fill/status allowlists + policy gate. |
| `extension/content/executor.ts`        | ✅     | Deterministic dispatch for all `DomAction` kinds.          |
| `extension/content/selectors.ts`       | ✅     | Allowlist enforced; value regex enforced.                  |
| `extension/content/recorder.ts`        | ✅     | **IMPLEMENTED:** mic capture in page context for demo UI.   |
| `extension/background/router.ts`       | ✅     | Routes all `ExtensionMessage` variants.                    |
| `extension/background/event-bus.ts`    | ✅     | In-worker pub/sub with ring buffer.                        |
| `extension/background/supabase-sync.ts`| ✅     | **IMPLEMENTED:** non-blocking insert to `ai_rpa_events` when URL/key present. |
| `extension/sidepanel/main.ts`          | ✅     | Record / stop / text / confirm; timeline via events.      |
| `backend/api/main.py`                  | ✅     | FastAPI app; CORS; health; routers mounted.                |
| `backend/api/routers/schedule.py`      | ✅     | Contract surface is live; body validated.                 |
| `backend/api/routers/events.py`        | ✅     | In-memory append + recent query.                           |
| `backend/core/scheduler.py`            | ✅     | **IMPLEMENTED:** full OR-Tools CP-SAT model (constraints + objective + timed solve; greedy fallback when infeasible). |
| `backend/core/event_sink.py`           | ✅     | In-memory ring buffer for `/api/events`.                   |
| `mock-ui/`                             | ✅     | All three pages with approved `data-*` attributes.         |
| `infra/supabase/0001_events.sql`       | ✅     | Append-only migration ready; apply for remote audit.       |

Legend: ✅ wired / implemented.

## 3. Live pipeline (MVP)

```
voice / text ─► sidepanel ─► background ─► controller
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    ▼                         ▼                         ▼
              preprocess +            LLM interpret            Zod + allowlists
              Whisper STT             (OpenAI)                  + decision gate
                    │                         │                         │
                    └─────────────────────────┴─────────────────────────┘
                                              │
                    ┌─────────────────────────┴─────────────────────────┐
                    ▼                                                   ▼
             content executor                                 POST /api/schedule
             (execute_plan)                                   (CP-SAT)
                    │                                                   │
                    └─────────────────────────┬─────────────────────────┘
                                              ▼
                                    AgentEvent + Supabase sync
```

## 4. Success criteria (MVP)

| Criterion                                                | Status |
|----------------------------------------------------------|--------|
| Extension builds without errors (MV3)                    | ✅     |
| Modules cleanly separated by layer                       | ✅     |
| DOM executor connected to validated intents + plans      | ✅     |
| Backend runs FastAPI with CP-SAT `/api/schedule`           | ✅     |
| Schemas shared and strongly typed (Zod + Pydantic)       | ✅     |
| Mock UI usable for testing DOM actions                   | ✅     |
| Events carry `correlationId` end-to-end                  | ✅     |
| Supabase sync wired (optional credentials)               | ✅     |
| LLM + STT paths return structured / text for controller  | ✅     |
| CP-SAT solver enforces full constraint set (OR-Tools)    | ✅     |
| Controller allowlists enforced                           | ✅     |
| Audio pipeline via content-script recorder + STT         | ✅     |

## 5. Next milestones (post-MVP)

1. Hardening: retries, backoff, and clearer failure events for schedule/STT.
2. Provider wiring: route all LLM traffic through `LlmClient` + chosen provider consistently.
3. Supabase: verify RLS and production insert paths against deployed project.
4. **Alternate-selector fallback** in the controller for `dom_target_missing`
   (policy-gated).

## 6. Explicitly out of scope for this MVP doc

- Authn/authz on the backend beyond basic CORS.
- Tenant-scoped RLS `select` policies on `ai_rpa_events` (migration is ready;
  policies are deploy-time).
- UI polish on the side panel beyond functional controls and timeline.
