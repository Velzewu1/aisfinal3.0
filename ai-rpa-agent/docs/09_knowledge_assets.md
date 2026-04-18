# 09 · Knowledge / Assets

The Knowledge / Assets layer provides **supporting context** for the reasoning
pipeline. It is architecturally separate from `PageContext` (which reflects the
currently visible page) and from the Event Store (which is append-only audit).
Source of truth:

- `packages/schemas/src/knowledge-assets.ts` — Zod contracts.
- `extension/knowledge/index.ts` — scope-aware in-memory registry.
- `extension/knowledge/retrieval.ts` — lightweight tag-based retrieval.
- `extension/knowledge/seed-reusable.ts` — built-in reusable asset seeds.

---

## 1. Layer position

```
PERCEPTION  →  CONTEXT  →  REASONING  →  VALIDATION  →  DECISION  →  EXECUTION
                  │
                  ├── PageContext        (live DOM, current page only)
                  │
                  └── RetrievedContext   (knowledge assets, this layer)
                        ├── Patient assets  (factual context)
                        └── Reusable assets (style/template guidance)
```

`PageContext` and `RetrievedContext` are **never merged**. They are assembled
independently and presented to the reasoning layer as separate input channels.

Within `RetrievedContext`, patient-scoped assets and reusable assets serve
different purposes:
- **Patient assets** = factual context about the current case.
- **Reusable assets** = style/format guidance, templates, presets — NOT patient facts.

---

## 2. Scope classification

All knowledge assets carry a `scope` discriminator:

| Scope       | Schema                 | Binding          | Lifecycle                                     |
|-------------|------------------------|------------------|-----------------------------------------------|
| `patient`   | `PatientContextAsset`  | `patientId` + optional `sessionId` | Scoped to case/session; stale on patient change. |
| `reusable`  | `ReusableAsset`        | None (clinic-wide) | Persists until explicit update/deletion.       |

**Classification rules:**

1. If the data is relevant **only** to a single patient's case → `patient`.
   Examples: diagnosis history, allergy snapshot, treatment plan, observation notes.
2. If the data applies **across patients and sessions** → `reusable`.
   Examples: form templates, standard phrase presets, field defaults, protocol snippets.
3. There is no `page` scope — live page data belongs to `PageContext`, not
   knowledge assets.

---

## 3. Content types

### Patient-scoped (`PatientContextAsset.contentType`)

| Content type         | Use case                                           |
|---------------------|---------------------------------------------------|
| `diagnosis_history` | Prior diagnoses carried forward from HIS.           |
| `allergy_snapshot`  | Known allergies for pre-filling allergy fields.     |
| `treatment_plan`    | Current rehabilitation plan for context.            |
| `observation_note`  | Clinician notes from prior sessions.                |
| `custom`            | Catch-all for unlisted patient-scoped data.         |

### Reusable (`ReusableAsset.contentType`)

| Content type        | Use case                                            |
|--------------------|-----------------------------------------------------|
| `form_template`    | Standard epicrisis/exam form text blocks.            |
| `phrase_preset`    | Common clinical phrases for voice-to-text accuracy.  |
| `field_default`    | Default values for common form fields.               |
| `protocol_snippet` | Treatment protocol reference fragments.              |
| `custom`           | Catch-all for unlisted reusable data.                |

---

## 4. What knowledge assets may and may not do

### May ✓

- Enrich the LLM prompt with supporting context.
- Be filtered/ranked before assembly into `RetrievedContext`.
- Be registered, queried, and removed at runtime.
- Have an `expiresAt` for lifecycle management.

### May not ✗

- **Approve actions** — only the controller (Decision layer) does this.
- **Mutate the host DOM** — only the executor (Execution layer) does this.
- **Bypass validation or policy** — all LLM output still passes Zod + controller
  policy allowlists regardless of what context was provided.
- **Store data in Supabase** — Supabase is append-only audit/realtime only.
- **Replace PageContext** — live page state is always extracted fresh from the
  current tab and never sourced from knowledge assets.
- **Be treated as factual patient truth** — reusable assets are
  style/template guidance only. Patient facts come from patient-scoped assets.

---

## 5. Generation pipeline (implemented)

The LLM receives three conceptually separate input channels, assembled in
`controller/context.ts` → consumed in `llm/interpret.ts`:

| Channel            | Source                        | Freshness       | Mutable by LLM? |
|--------------------|-------------------------------|-----------------|------------------|
| Utterance          | Voice STT / typed text        | Real-time       | No (input only)  |
| `PageContext`      | Content script → `extract_page_context` | Live (per-call) | No (read-only) |
| `RetrievedContext` | Knowledge registry + retrieval | Assembled pre-call | No (read-only) |

### Flow

```
utterance + PageContext + RetrievedContext
    │
    ▼  (controller/context.ts — attachContext)
ContextualizedUtteranceEvent
    │
    ▼  (llm/interpret.ts — buildUserMessage)
LLM prompt with:
  - [page=... form=...] [patient=...]
  - AVAILABLE FIELDS ON THIS PAGE
  - PATIENT CONTEXT (factual)
  - STYLE/TEMPLATE GUIDANCE (reusable)
  - utterance: ...
    │
    ▼  LLM → raw JSON
    │
    ▼  (controller/validate.ts — Step 7)
LlmInterpretation
    │
    ▼  (controller/index.ts — decision gate)
    │
    ├── fill intent → DRAFT PREVIEW (always requires clinician approval)
    ├── navigate/set_status → normal decision gate
    └── schedule → backend + injection
```

### Scope-aware policy in the prompt

The `buildUserMessage` function labels assets by scope:

- **`PATIENT CONTEXT`** — labeled "factual, use as supporting data for this patient"
- **`STYLE/TEMPLATE GUIDANCE`** — labeled "use for writing style, structure, and phrasing only; NOT patient facts"

The system prompt explicitly instructs:
> "Retrieved context never changes which intent kind to emit — it only enriches fill slot values."

### Draft preview gate

All `fill` intents are routed through the draft preview approval flow
regardless of confidence score. No generated content reaches the host DOM
without explicit clinician confirmation.

## 6. Registry API (`extension/knowledge/index.ts`)

| Function                     | Description                                     |
|-----------------------------|-------------------------------------------------|
| `registerAsset(raw)`        | Validate + store an asset. Returns `{ ok, asset }` or `{ ok: false, error }`. |
| `getPatientAssets(patientId)` | All non-expired patient-scoped assets for a patient. |
| `getReusableAssets()`       | All non-expired reusable assets.                 |
| `removeAsset(id)`           | Remove a single asset by ID.                     |
| `assembleRetrievedContext(patientId?)` | Build a validated `RetrievedContext` (max 10 assets). |
| `clear()`                   | Reset the store (session reset / tests).         |
| `size()`                    | Current store size.                              |

**Trust posture:** The registry module is in the Context zone. It never touches
DOM, never decides plans, never calls the executor or backend.

---

## 7. Retrieval layer (`extension/knowledge/retrieval.ts`)

Lightweight tag-based retrieval — no vector search, no embeddings.

### Retrieval signals

| Signal         | Weight | Matches against                     |
|----------------|--------|-------------------------------------|
| `documentType` | 3      | Asset tags or label                 |
| `contentType`  | 2      | `asset.contentType` (exact match)   |
| `diagnosis`    | 2      | Asset tags (code or keyword)        |
| `specialty`    | 1      | Asset tags or label                 |

Assets are scored by summing weights of matched signals. Higher score = higher
relevance. Assets with score 0 are included only if tagged `"general"`.

### Retrieval API

| Function | Description |
|----------|-------------|
| `retrieveReusableAssets(query)` | Returns scored, ranked reusable assets (max 6). |
| `assembleFilteredContext(query)` | Builds a validated `RetrievedContext` combining patient assets (max 4) + reusable assets (max 6), capped at 10 total. |

### Example query

```ts
assembleFilteredContext({
  documentType: "primary_exam",
  diagnosis: "g80",
  specialty: "lkf",
  patientId: "patient-123",
});
```

This returns: patient assets for `patient-123` (factual) + G80-related
templates + primary exam templates + LKF presets (style guidance).

---

## 8. Seed assets (`extension/knowledge/seed-reusable.ts`)

Built-in reusable assets are seeded at extension install time via
`seedReusableAssets()` called in `background/index.ts`.

### Included seeds

| Category | Count | Examples |
|----------|-------|---------|
| Primary exam templates | 3 | Complaints, objective findings, disease anamnesis |
| Epicrisis templates | 3 | Discharge status, treatment summary, recommendations |
| Diary templates | 1 | Objective findings (compact) |
| Diagnosis presets | 2 | G80 (cerebral palsy), G93.2 (intracranial hypertension) |
| Specialty presets | 4 | LFK, massage, psychologist, speech therapy |
| Field defaults | 1 | Resuscitation status combobox |

Tags like `"primary_exam"`, `"g80"`, `"lkf"` drive retrieval signal matching.

---

## 9. File upload (`extension/knowledge/file-parser.ts`)

The sidepanel supports uploading patient-related files (PDF, plain text) which
are parsed and registered as `PatientContextAsset` entries.

| Format | Method | Limitations |
|--------|--------|-------------|
| Text (.txt) | UTF-8 decode | None |
| PDF (.pdf) | pdf.js text extraction | No OCR for image-only PDFs |

Content is normalized (whitespace, control chars) and capped at 4000 chars.

---

## 10. Future work

- ~~Wire retrieval into controller~~ — **DONE** (`attachContext` calls
  `assembleFilteredContext`, `buildUserMessage` includes assets in prompt).
- **Persistence** — optional local storage / IndexedDB for reusable assets
  that survive extension restarts.
- **Custom seed management** — admin UI for adding/editing reusable presets.
- **Content-aware ranking** — use utterance tokens for relevance boosting.
- **Diagnosis extraction** — parse ICD codes from utterance to pass as
  `diagnosis` signal to retrieval for better preset matching.
- **Draft editing** — allow clinician to edit individual field values in
  the draft preview before approval.

