# 04 · Executor

The executor is the **only** layer that mutates the host DOM. It runs inside
the Chrome content script and accepts fully-specified, already-approved
`DomAction` objects from the controller.

Source of truth:

- `extension/content/index.ts` — message listener (dual role: execution + context).
- `extension/content/executor.ts` — action dispatch loop.
- `extension/content/selectors.ts` — approved selector resolver.
- `extension/content/page-context-extractor.ts` — read-only `PageContext` extraction.

---

## 1. Hard rules

1. No other file in the repository may call `document.*`, `Element.prototype.*`
   mutators, `eval`, `innerHTML =`, or equivalents against the host page.
2. The executor never parses natural language, never calls the LLM, never
   calls the backend.
3. The executor accepts only `DomAction` values — the discriminated union
   defined in `packages/schemas/src/action.ts`.
4. The executor resolves elements **only** through `selectByDataAttr`, which
   enforces an allowlist of attribute names.
5. The content script has a **dual role**: `execute_plan` (write, DOM mutation)
   and `extract_page_context` (read-only, context extraction). The extraction
   handler (`page-context-extractor.ts`) never mutates the DOM, never reads
   `innerHTML`/`outerHTML`/`textContent` from arbitrary elements, and returns
   only policy-approved field descriptors. These two handlers are separate
   code paths in `index.ts`.

## 2. Action schema (`DomAction`)

Discriminated union on `kind`:

| `kind`            | Payload                                    | Target attribute        |
|-------------------|--------------------------------------------|-------------------------|
| `fill`            | `field: string, value: string \| number \| boolean` | `data-field`    |
| `click`           | `action: string`                           | `data-action`           |
| `navigate`        | `nav: string`                              | `data-nav`              |
| `set_status`      | `entity: string, status: string`           | `data-status-entity`    |
| `inject_schedule` | `grid: string, payload: unknown`           | `data-schedule-grid`    |

Any other shape fails Zod parsing at the controller boundary and never reaches
the executor.

## 3. Selector policy

Defined in `selectors.ts`:

```ts
const APPROVED_ATTRS = new Set([
  "data-field",
  "data-action",
  "data-nav",
  "data-status-entity",
  "data-schedule-grid",
]);
```

Rules:

- Only attributes in `APPROVED_ATTRS` may be used to select a target.
- Values must match `^[a-zA-Z0-9_\-.:]+$`.
- Raw CSS selectors, XPath, or text-based heuristics are forbidden and the
  resolver throws.
- The host application (or its integration layer) is responsible for marking
  automatable controls with these attributes. This is the contract between
  the host page and the RPA layer.

## 4. Action semantics

All actions are synchronous, best-effort, and return a per-action result.
The executor never retries internally — retry policy belongs to the
controller.

| Action            | Effect                                                                 |
|-------------------|------------------------------------------------------------------------|
| `fill`            | Set `.value`; dispatch bubbling `input` and `change` events.           |
| `click`           | Call `.click()` on the resolved `HTMLElement`.                         |
| `navigate`        | Same as `click` but against a `data-nav` target (tab / route button).  |
| `set_status`      | Set `data-status` attribute; dispatch `status-changed` `CustomEvent`.  |
| `inject_schedule` | Set `data-schedule-payload` to JSON; dispatch `schedule-injected` `CustomEvent` carrying the payload as `detail`. |

The executor never injects HTML strings. The host page's scripts are
responsible for rendering structured payloads (see `mock-ui/selectors-demo.js`
for the reference implementation).

## 5. Return contract (`ExecutorResult`)

```
ExecutorResult = {
  correlationId: string,
  ok: boolean,
  executed: DomAction[],
  failed: { action: DomAction, error: string }[],
}
```

- `ok = failed.length === 0`.
- The executor processes actions in array order and does not stop on failure
  — each is recorded independently so the controller can decide on recovery.
- `error` strings are stable, machine-matchable tokens, not prose. The
  canonical errors are:
  - `dom_target_missing: <attr>="<value>"`
  - `unapproved_selector_attr: <attr>`
  - `invalid_selector_value: <value>`
  - `unknown_action`

## 6. Determinism guarantees

- Given an identical `ActionPlan` and an identical DOM snapshot, the executor
  produces an identical `ExecutorResult` and an identical post-state.
- No timers, no randomness, no cross-action shared state.
- No animation awaits; if the host page needs async readiness, the controller
  plans a preceding `navigate` action and the content script's own handlers
  absorb the latency.

## 7. Missing element handling

When `selectByDataAttr` returns `null` or the wrong element type, the executor
throws `dom_target_missing`. That action is added to `failed` with the stable
error token. The controller:

1. Emits `dom_action_failed` with the action and error.
2. Chooses between configured alternate selectors (if policy allows), retry,
   or escalation. The executor itself makes none of those choices.

## 8. What the executor deliberately does not do

- Does not decide whether an action is "safe enough" — that lives in
  [`03_controller.md`](03_controller.md).
- Does not resolve logical → physical field ids — the `data-*` manifest of the
  host page is the resolution contract. A missing attribute is a host-page
  integration bug, not an executor bug.
- Does not emit `AgentEvent` directly — it returns an `ExecutorResult` and the
  controller owns event emission. This keeps the event schema in one place.
