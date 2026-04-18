import type { AgentEvent, PageContext, PageFieldDescriptor, RetrievedContext as RetrievedContextType } from "@ai-rpa/schemas";
import { PageContext as PageContextSchema } from "@ai-rpa/schemas";
import type { NormalizedUtteranceEvent } from "../voice/normalize.js";
import { newCorrelationId } from "../shared/correlation.js";
import { createLogger } from "../shared/logger.js";
import { assembleFilteredContext } from "../knowledge/retrieval.js";

const log = createLogger("controller.context");

/**
 * Step 5 of the agent loop: context attach.
 *
 * Responsibility: merge a `NormalizedUtteranceEvent` with the ambient
 * session context (patient, page, active form) to produce a
 * `ContextualizedUtteranceEvent` that is ready for the reasoning layer.
 *
 * Invariants:
 *   - Output depends on input + overrides + current-page context extracted
 *     by the content script via `extract_page_context` message.
 *   - Current-page context is validated through `PageContext.safeParse()`
 *     before use — rejecting raw HTML, unrestricted DOM snapshots, and
 *     structurally invalid payloads.
 *   - Emits a best-effort `context_attached` AgentEvent for observability
 *     via `chrome.runtime.sendMessage`; emission is fire-and-forget and
 *     never affects the returned `ContextualizedUtteranceEvent`.
 *   - No LLM, no network, no backend. No `document.*` in this thread.
 *   - Does NOT decide which intent runs — it only augments the utterance
 *     with labels the LLM prompt needs. Controller decision logic lives
 *     in `confidence.ts` / `index.ts`.
 *   - Mock context values are scaffolded here per Step 5 spec; real
 *     context injection flows through the `overrides` parameter so no
 *     change to this module is required when real sources land.
 */

const MOCK_CURRENT_PAGE = "primary_exam";
const UNKNOWN_PATIENT_NAME = "Unknown";

export type ContextualizedUtteranceEvent = Readonly<{
  type: "context_attached";

  correlationId: string;
  timestamp: string;

  text: string;

  context: {
    patientId?: string;
    patientName?: string;

    currentPage: string;
    activeForm?: string;

    /** `[data-field]` elements on the active tab (deduped by `field`). */
    availableFields: readonly PageFieldDescriptor[];
  };

  /**
   * Retrieved knowledge context assembled from the assets layer.
   * Conceptually separate from `context` (PageContext):
   *   - PageContext = current-page DOM state (live, factual)
   *   - retrievedContext = stored knowledge assets (templates, patient history)
   * These are NEVER merged.
   */
  retrievedContext?: RetrievedContextType;

  durationMs: number;
}>;

export interface ContextOverrides {
  readonly currentPage?: string;
  readonly activeForm?: string;
  readonly patientId?: string;
  readonly patientName?: string;
  /** When set, context extraction runs on this tab; otherwise the active tab in the current window. */
  readonly tabId?: number;
}

export async function attachContext(
  input: NormalizedUtteranceEvent,
  overrides: ContextOverrides = {},
): Promise<ContextualizedUtteranceEvent> {
  const text = input.normalizedText;

  const pageContext = await requestPageContext(input.correlationId, overrides.tabId);

  const currentPage =
    overrides.currentPage ?? pageContext?.currentPage ?? MOCK_CURRENT_PAGE;
  // activeForm is extracted from live DOM (data-form / form[id] / data-section).
  // If no form container is detected, we omit it entirely to avoid misleading the LLM.
  const activeForm = overrides.activeForm ?? pageContext?.activeForm;
  const patientId = overrides.patientId ?? pageContext?.patientId;
  const patientName =
    overrides.patientName ??
    pageContext?.patientName ??
    extractPatientName(text) ??
    UNKNOWN_PATIENT_NAME;

  const availableFields: readonly PageFieldDescriptor[] =
    pageContext?.availableFields ?? [];

  const context: ContextualizedUtteranceEvent["context"] = {
    currentPage,
    availableFields,
    ...(activeForm ? { activeForm } : {}),
    ...(patientId ? { patientId } : {}),
    ...(patientName ? { patientName } : {}),
  };

  // Assemble retrieved context (knowledge assets) — separate from PageContext.
  // Uses page/patient signals to select relevant reusable templates and
  // patient-scoped assets. This is a separate enrichment channel that
  // never merges with PageContext and never bypasses validation.
  const retrievedContext = assembleFilteredContext({
    documentType: currentPage,
    patientId: patientId,
    // Specialty and diagnosis can be extracted from utterance in future patches
  });

  const event: ContextualizedUtteranceEvent = Object.freeze({
    type: "context_attached",
    correlationId: input.correlationId,
    timestamp: new Date().toISOString(),
    text,
    context,
    ...(retrievedContext ? { retrievedContext } : {}),
    durationMs: input.durationMs,
  });

  log.info(
    "context attached",
    {
      currentPage,
      activeForm: activeForm ?? null,
      patientName,
      patientId: patientId ?? null,
      retrievedAssetCount: retrievedContext?.assets.length ?? 0,
    },
    input.correlationId,
  );
  emitContextAttached(input.correlationId, context);
  return event;
}

function emitContextAttached(
  correlationId: string,
  context: ContextualizedUtteranceEvent["context"],
): void {
  const payload: Extract<AgentEvent, { type: "context_attached" }>["payload"] = {
    currentPage: context.currentPage,
    ...(context.activeForm ? { activeForm: context.activeForm } : {}),
    ...(context.patientId ? { patientId: context.patientId } : {}),
    ...(context.patientName ? { patientName: context.patientName } : {}),
  };
  const event: Extract<AgentEvent, { type: "context_attached" }> = {
    id: newCorrelationId(),
    type: "context_attached",
    correlationId,
    ts: new Date().toISOString(),
    payload,
  };
  try {
    void chrome.runtime.sendMessage({ type: "event", event }).catch(() => {
      // Audit sink is best-effort; never propagate failure.
    });
  } catch {
    // Audit sink is best-effort; never propagate failure.
  }
}

// ------------------------------------------------------------------ //
// Current-page context: content-script extraction via message bus.    //
// ------------------------------------------------------------------ //

/**
 * Request the validated `PageContext` from the content script running in
 * the active tab. Replaces the previous `chrome.scripting.executeScript`
 * pattern with a message-based approach:
 *
 *   controller  ─ chrome.tabs.sendMessage({ type: "extract_page_context" }) ─►  content script
 *   content script  ─ sendResponse({ ok, context }) ─►  controller
 *
 * The response is validated through `PageContext.safeParse()` so that
 * malformed or policy-violating payloads (e.g. containing raw HTML) are
 * rejected before they enter the reasoning pipeline.
 */
async function requestPageContext(
  correlationId: string,
  tabIdOverride?: number,
): Promise<PageContext | undefined> {
  let tabId = tabIdOverride;
  if (tabId === undefined) {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = active?.id;
  }
  if (tabId === undefined) return undefined;

  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "extract_page_context",
    }) as { ok?: boolean; context?: unknown; error?: string } | undefined;

    if (!response || response.ok !== true || response.context === undefined) {
      log.warn(
        "page context extraction returned non-ok",
        response?.error ?? "no response",
        correlationId,
      );
      return undefined;
    }

    // Validate through the PageContext Zod schema — enforces no raw HTML,
    // field cap, path-only URL, and structural completeness.
    const parsed = PageContextSchema.safeParse(response.context);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".") || "<root>"}:${i.code}`);
      log.warn(
        "page context validation failed",
        { issues },
        correlationId,
      );
      return undefined;
    }

    return parsed.data;
  } catch (err: unknown) {
    log.warn("page context request failed", String(err), correlationId);
    return undefined;
  }
}

// ------------------------------------------------------------------ //
// Internal helpers — deterministic, no external dependencies.        //
// ------------------------------------------------------------------ //

// Normalized text from Step 4 is lowercase, so the character class below
// only needs to cover lowercase Latin + Cyrillic (including ё). The
// match is a simple two-token heuristic; absence of a match falls back
// to `UNKNOWN_PATIENT_NAME` in the caller.
const PATIENT_NAME_REGEX =
  /(?:пациент(?:ка)?)\s+([a-zа-яё][a-zа-яё-]*(?:\s+[a-zа-яё][a-zа-яё-]*)?)/;

function extractPatientName(text: string): string | undefined {
  const match = PATIENT_NAME_REGEX.exec(text);
  if (!match || !match[1]) return undefined;
  const raw = match[1].trim();
  if (raw.length === 0) return undefined;
  return raw.split(/\s+/).map(titleCase).join(" ");
}

function titleCase(word: string): string {
  if (word.length === 0) return word;
  return word.charAt(0).toUpperCase() + word.slice(1);
}
