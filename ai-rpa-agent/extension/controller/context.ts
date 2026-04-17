import type { NormalizedUtteranceEvent } from "../voice/normalize.js";
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
 *   - Pure synchronous function. Output depends only on input + overrides.
 *   - No LLM, no network, no backend, no `chrome.*`, no `document.*`.
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
  };

  durationMs: number;
}>;

export interface ContextOverrides {
  readonly currentPage?: string;
  readonly activeForm?: string;
  readonly patientId?: string;
  readonly patientName?: string;
}

export function attachContext(
  input: NormalizedUtteranceEvent,
  overrides: ContextOverrides = {},
): ContextualizedUtteranceEvent {
  const text = input.normalizedText;

  const currentPage = overrides.currentPage ?? MOCK_CURRENT_PAGE;
  const activeForm = overrides.activeForm ?? MOCK_ACTIVE_FORM;
  const patientId = overrides.patientId;
  const patientName =
    overrides.patientName ?? extractPatientName(text) ?? UNKNOWN_PATIENT_NAME;

  const context: ContextualizedUtteranceEvent["context"] = {
    currentPage,
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
  return event;
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
