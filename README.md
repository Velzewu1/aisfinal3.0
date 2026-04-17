# AI RPA System — Engineering Overview

This repository defines an **enterprise-grade AI-powered Robotic Process Automation (RPA)** platform for healthcare web systems (including interfaces comparable in complexity to Damumed-style workflows). The system combines a **Chrome Extension** (TypeScript), **voice input**, **LLM-assisted structured reasoning**, a **deterministic controller**, a **DOM executor**, a **FastAPI backend** (CP-SAT scheduling), and **event sourcing** (e.g. Supabase or equivalent).

This document is a **standards and architecture** reference. It describes *what* the system is and *why* it is shaped this way—not implementation recipes or UI detail.

---

## System overview

The platform turns **natural-language intent** (including speech) into **validated, auditable, deterministic actions** on web applications. It is **not** a conversational assistant whose primary output is text replies. It is an **autonomous execution system** with strict boundaries:

| Concern | Role |
|--------|------|
| Perception | Capture voice (and optional text) as input signals |
| Reasoning | LLM proposes **structured JSON only**—never touches the page |
| Validation | Schema enforcement (conceptually Zod on the client, Pydantic on the server); invalid output is rejected or retried |
| Decision | Controller merges policy, state, and validated intents into **allowable action plans** |
| Execution | Deterministic RPA engine is the **only** component that mutates the DOM |
| Optimization | Backend runs CP-SAT (or similar) for scheduling under constraints |
| Memory | Event-sourced immutable log for audit, replay, and analytics |

**Golden rule:** After the LLM step, behavior must be **deterministic and enforceable**. The LLM is untrusted; the controller and executor are trusted when they follow validated schemas and policies.

---

## Why this is **not** a chatbot system

- **Primary artifact is not dialogue.** Success is measured by **correct, safe, logged automation** (fills, navigation, scheduling, status changes), not by conversational coherence or “helpful” prose.
- **The LLM does not operate the browser.** It emits **structured JSON** that is validated and then **interpreted by the controller**. There is no path where the model “clicks” or “types” by generating imperative DOM instructions outside the executor.
- **User-facing explanations** (when needed) are a **secondary channel**—e.g. clarification prompts or audit summaries—not the core control loop.
- **State is operational, not conversational.** Authoritative state lives in the controller, executor contracts, and event log—not in an open-ended chat history.

---

## Enterprise RPA design principles

1. **Separation of intelligence and execution** — Models suggest; **policies and deterministic code** decide and act.
2. **Schema-first contracts** — Every machine-generated payload crosses a **validation boundary** before it influences behavior.
3. **Least privilege for AI** — AI outputs are **untrusted** until validated and approved by the controller under explicit rules.
4. **Full auditability** — Actions and decisions are **events**; the system can answer *what happened, when, and why*.
5. **Deterministic execution** — DOM changes come only from the **executor**, with stable selectors and predictable semantics.
6. **Graceful degradation** — Backend or model failures lead to **retries, clarification, or safe fallback**—not silent corruption of data or UI.
7. **Extensibility** — Layers (voice, LLM, controller, RPA, backend, events) can evolve independently as long as **contracts** stay stable.

---

## Architecture (high level)

Conceptually:

```
Voice / input → ASR + normalization → LLM (JSON intent) → Validate → Controller → Executor → DOM
                                                                    ↘ Backend (CP-SAT) ↗
                                                                    ↘ Event store (append-only)
```

- **Chrome Extension** hosts perception, validation, controller orchestration, and executor (or split across extension pages/workers per deployment).
- **FastAPI backend** provides scheduling and other **non-DOM** services; it does not replace the controller for on-page safety decisions.
- **Event sourcing** records **immutable** facts: intents, validations, decisions, actions, outcomes, and backend results.

For diagrams, boundaries, and data flow detail, see `architecture.md`. For agent lifecycle, intents, and confidence rules, see `agents.md`.

---

## Full pipeline: voice → LLM → controller → executor → backend → events

1. **Listen (perception)**  
   Voice is captured and transcribed; text may be normalized (language, PHI handling policies per org). Output: **raw utterance + metadata** (no DOM access).

2. **Interpret (reasoning)**  
   The LLM receives **context allowed by policy** (e.g. field labels, page role—not raw HTML dumps unless explicitly approved). It returns **only structured JSON** matching a versioned schema (intent, slots, confidence).

3. **Validate**  
   Client-side schema validation rejects malformed or out-of-policy payloads. **Invalid → retry with constrained prompt or ask user for clarification.**

4. **Decide (controller)**  
   The controller applies **confidence thresholds**, **intent allowlists**, **session state**, and **business rules** (healthcare workflows, scheduling constraints). It may **call the backend** for optimization (e.g. CP-SAT) or **refuse** an action.

5. **Execute (RPA)**  
   The **deterministic executor** maps approved **action plans** to DOM operations using **only** approved selector strategies (e.g. `data-field`, `data-action` attributes). **No other layer writes to the DOM.**

6. **Backend (optional per step)**  
   For **schedule**-class intents, the controller may submit structured problems to **FastAPI**; results feed back into the plan **before** execution or as a dedicated step. **Failures:** retry once at the integration layer, then degrade (see failure handling).

7. **Log (events)**  
   Every meaningful step appends an **immutable event** (who/what/when/correlation id). This supports audit, compliance, debugging, and replay.

---

## Failure handling (summary)

| Condition | Behavior |
|-----------|----------|
| Invalid schema | Reject; retry LLM with tighter schema hints **or** clarify with user |
| Low confidence (&lt; 0.7) | Require **user confirmation** before execution |
| Missing DOM targets | Executor reports failure; controller applies **fallback** (alternate selector strategy if configured) or **escalates** to user |
| Backend failure | **One** automatic retry; then **graceful degradation** (e.g. skip optimization, queue, or user prompt) |
| Unknown intent | **Escalate** to user; do not guess destructive actions |

Full detail: `agents.md` and `architecture.md`.

---

## Documentation map

| File | Purpose |
|------|---------|
| `README.md` | This overview and pipeline |
| `architecture.md` | Layers, boundaries, DOM model, backend, event sourcing |
| `agents.md` | Agent lifecycle, intents, confidence, state machine, confirmations |
| `.cursorrules` | Mandatory engineering rules for contributors |

---

## Compliance and safety posture (non-binding reminder)

Healthcare contexts impose **regulatory and organizational** requirements (e.g. access control, logging, PHI minimization). This architecture supports **auditability and least-privilege automation**; specific compliance controls are defined at the product and deployment level, not in this generic standards doc.
