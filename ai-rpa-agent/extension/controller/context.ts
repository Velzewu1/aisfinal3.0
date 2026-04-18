import type { AgentEvent } from "@ai-rpa/schemas";
import type { NormalizedUtteranceEvent } from "../voice/normalize.js";
import { newCorrelationId } from "../shared/correlation.js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("controller.context");

/**
 * Step 5 of the agent loop: context attach.
 *
 * Responsibility: merge a `NormalizedUtteranceEvent` with the ambient
 * session context (patient, page, active form) to produce a
 * `ContextualizedUtteranceEvent` that is ready for the reasoning layer.
 *
 * Invariants:
 *   - Output depends on input + overrides + best-effort DOM discovery
 *     in the active tab (`chrome.scripting.executeScript` for `[data-field]`).
 *   - Emits a best-effort `context_attached` AgentEvent for observability
 *     via `chrome.runtime.sendMessage`; emission is fire-and-forget and
 *     never affects the returned `ContextualizedUtteranceEvent`.
 *   - No LLM, no network, no backend. No `document.*` in this thread — only
 *     in the injected page function.
 *   - Does NOT decide which intent runs — it only augments the utterance
 *     with labels the LLM prompt needs. Controller decision logic lives
 *     in `confidence.ts` / `index.ts`.
 *   - Mock context values are scaffolded here per Step 5 spec; real
 *     context injection flows through the `overrides` parameter so no
 *     change to this module is required when real sources land.
 */

const MOCK_CURRENT_PAGE = "primary_exam";
const MOCK_ACTIVE_FORM = "primary_exam_form";
const UNKNOWN_PATIENT_NAME = "Unknown";

/** One `[data-field]` on the active page; used for LLM + controller allowlist. */
export type PageFieldDescriptor = Readonly<{
  field: string;
  tag: string;
  placeholder: string;
  label: string;
}>;

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

  durationMs: number;
}>;

export interface ContextOverrides {
  readonly currentPage?: string;
  readonly activeForm?: string;
  readonly patientId?: string;
  readonly patientName?: string;
  /** When set, field discovery runs on this tab; otherwise the active tab in the current window. */
  readonly tabId?: number;
}

export async function attachContext(
  input: NormalizedUtteranceEvent,
  overrides: ContextOverrides = {},
): Promise<ContextualizedUtteranceEvent> {
  const text = input.normalizedText;

  const pageSnapshot = await discoverPageSnapshot(input.correlationId, overrides.tabId);

  const currentPage =
    overrides.currentPage ?? pageSnapshot?.currentPage ?? MOCK_CURRENT_PAGE;
  const activeForm = overrides.activeForm ?? MOCK_ACTIVE_FORM;
  const patientId = overrides.patientId ?? pageSnapshot?.patientId;
  const patientName =
    overrides.patientName ??
    pageSnapshot?.patientName ??
    extractPatientName(text) ??
    UNKNOWN_PATIENT_NAME;

  const availableFields = await discoverPageFields(input.correlationId, overrides.tabId);

  const context: ContextualizedUtteranceEvent["context"] = {
    currentPage,
    availableFields,
    ...(activeForm ? { activeForm } : {}),
    ...(patientId ? { patientId } : {}),
    ...(patientName ? { patientName } : {}),
  };

  const event: ContextualizedUtteranceEvent = Object.freeze({
    type: "context_attached",
    correlationId: input.correlationId,
    timestamp: new Date().toISOString(),
    text,
    context,
    durationMs: input.durationMs,
  });

  log.info(
    "context attached",
    { currentPage, activeForm: activeForm ?? null, patientName, patientId: patientId ?? null },
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

interface PageSnapshot {
  readonly currentPage?: string;
  readonly patientId?: string;
  readonly patientName?: string;
}

/**
 * One-shot DOM introspection: infers `currentPage` from the URL path (mock-ui
 * file -> mock-ui `data-nav` slug) and reads the patient snapshot exported by
 * `mock-ui/patient-loader.js` as `window.__CURRENT_PATIENT__`. Pure read-only;
 * does not mutate the page.
 */
async function discoverPageSnapshot(
  correlationId: string,
  tabIdOverride?: number,
): Promise<PageSnapshot | undefined> {
  let tabId = tabIdOverride;
  if (tabId === undefined) {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = active?.id;
  }
  if (tabId === undefined) return undefined;

  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (): { currentPage?: string; patientId?: string; patientName?: string } => {
        const pageByFile: Record<string, string> = {
          "index.html": "patient_list",
          "": "patient_list",
          "primary_exam.html": "primary_exam",
          "epicrisis.html": "epicrisis",
          "diary.html": "diary",
          "schedule.html": "schedule",
        };
        const path = (window.location.pathname || "").split("/").pop() || "";
        const currentPage = pageByFile[path];
        const current = (window as unknown as {
          __CURRENT_PATIENT__?: { id?: string; name?: string; shortName?: string };
        }).__CURRENT_PATIENT__;
        return {
          ...(currentPage ? { currentPage } : {}),
          ...(current?.id ? { patientId: current.id } : {}),
          ...(current?.shortName || current?.name
            ? { patientName: current.shortName ?? current.name }
            : {}),
        };
      },
    });
    const raw = injection?.result;
    if (typeof raw !== "object" || raw === null) return undefined;
    const rec = raw as { currentPage?: unknown; patientId?: unknown; patientName?: unknown };
    const out: PageSnapshot = {
      ...(typeof rec.currentPage === "string" && rec.currentPage.length > 0
        ? { currentPage: rec.currentPage }
        : {}),
      ...(typeof rec.patientId === "string" && rec.patientId.length > 0
        ? { patientId: rec.patientId }
        : {}),
      ...(typeof rec.patientName === "string" && rec.patientName.length > 0
        ? { patientName: rec.patientName }
        : {}),
    };
    return out;
  } catch (err: unknown) {
    log.warn("page snapshot discovery failed", String(err), correlationId);
    return undefined;
  }
}

async function discoverPageFields(
  correlationId: string,
  tabIdOverride?: number,
): Promise<readonly PageFieldDescriptor[]> {
  let tabId = tabIdOverride;
  if (tabId === undefined) {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = active?.id;
  }
  if (tabId === undefined) return [];

  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (): Array<{ field: string; tag: string; placeholder: string; label: string }> => {
        const seen = new Set<string>();
        const out: Array<{ field: string; tag: string; placeholder: string; label: string }> = [];
        for (const el of document.querySelectorAll("[data-field]")) {
          if (!(el instanceof HTMLElement)) continue;
          const field = el.dataset.field;
          if (field === undefined || field.length === 0) continue;
          if (seen.has(field)) continue;
          seen.add(field);
          const tag = el.tagName.toLowerCase();
          const placeholder =
            el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.placeholder : "";
          const row = el.closest(".form-group, .field-wrapper, tr");
          const labelEl = row?.querySelector("label, th");
          const label = labelEl?.textContent?.trim() ?? "";
          out.push({ field, tag, placeholder, label });
        }
        return out;
      },
    });
    const raw = injection?.result;
    if (!Array.isArray(raw)) return [];
    const out: PageFieldDescriptor[] = [];
    for (const item of raw) {
      if (typeof item !== "object" || item === null) continue;
      const rec = item as { field?: unknown; tag?: unknown; placeholder?: unknown; label?: unknown };
      if (typeof rec.field !== "string" || rec.field.length === 0) continue;
      out.push({
        field: rec.field,
        tag: typeof rec.tag === "string" ? rec.tag : "",
        placeholder: typeof rec.placeholder === "string" ? rec.placeholder : "",
        label: typeof rec.label === "string" ? rec.label : "",
      });
    }
    return out;
  } catch (err: unknown) {
    log.warn("page field discovery failed", String(err), correlationId);
    return [];
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
