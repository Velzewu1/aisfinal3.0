import { IntentKind, LlmInterpretation, MAX_COURSE_DAYS } from "@ai-rpa/schemas";
import type { LlmInterpretation as LlmInterpretationType } from "@ai-rpa/schemas";
import { createLogger } from "../shared/logger.js";

const log = createLogger("controller.validate");

/**
 * Step 7 of the agent loop: schema validation (the trust boundary).
 *
 * Responsibility: accept raw, untrusted JSON from the LLM (Step 6) and
 * either promote it to a fully-typed `LlmInterpretation` or reject it
 * with a stable, machine-matchable error token.
 *
 * Invariants:
 *   - Pure synchronous function. Output depends only on `raw`.
 *   - No DOM, no network, no backend, no `chrome.*`, no clock, no PRNG.
 *   - Never mutates the input. Never attempts to repair or coerce
 *     invalid payloads — rejection is the only failure mode.
 *   - Logging is the ONLY side effect; it cannot gate control flow.
 *
 * Trust posture:
 *   - Inputs are untrusted. Everything that returns `{ ok: true }`
 *     has passed the same Zod schema that the rest of the controller,
 *     planner, executor, and backend all share.
 */

export type ValidationError =
  | "validation_failed"
  | "invalid_schema_version"
  | "missing_intent"
  | "invalid_intent_shape"
  // Domain-level assign rejections — surfaced specifically so the
  // sidepanel can show clinician-facing Russian messages instead of a
  // generic parse error.
  | "assign_course_missing_sessions"
  | "assign_course_exceeds_max_days";

export type ValidationResult =
  | { readonly ok: true; readonly data: LlmInterpretationType }
  | { readonly ok: false; readonly error: ValidationError };

const EXPECTED_SCHEMA_VERSION = "1.0.0" as const;
const ALLOWED_INTENT_KINDS: ReadonlySet<string> = new Set<string>(IntentKind.options);
const MAX_LOGGED_ISSUES = 10;

export function validateLlmOutput(raw: unknown, correlationId: string): ValidationResult {
  const parsed = LlmInterpretation.safeParse(raw);

  if (parsed.success) {
    log.info(
      "validation_passed",
      {
        schemaVersion: parsed.data.schemaVersion,
        intentKind: parsed.data.intent.kind,
      },
      correlationId,
    );
    return { ok: true, data: parsed.data };
  }

  const error = categorizeError(raw);
  log.warn(
    "validation_failed",
    {
      error,
      issues: parsed.error.issues
        .slice(0, MAX_LOGGED_ISSUES)
        .map((i) => ({ path: i.path, code: i.code, message: i.message })),
    },
    correlationId,
  );
  return { ok: false, error };
}

// ------------------------------------------------------------------ //
// Error categorization — structural inspection only, no coercion.    //
// ------------------------------------------------------------------ //

function categorizeError(raw: unknown): ValidationError {
  if (!isRecord(raw)) {
    return "validation_failed";
  }

  if (raw["schemaVersion"] !== EXPECTED_SCHEMA_VERSION) {
    return "invalid_schema_version";
  }

  const intent = raw["intent"];
  if (intent === undefined || intent === null) {
    return "missing_intent";
  }

  if (!isRecord(intent)) {
    return "invalid_intent_shape";
  }

  const kind = intent["kind"];
  if (typeof kind !== "string" || kind.length === 0) {
    return "invalid_intent_shape";
  }
  if (!ALLOWED_INTENT_KINDS.has(kind)) {
    return "invalid_intent_shape";
  }

  // Domain-specific assign failures (detected on the raw JSON — structural
  // inspection only, no coercion). These are reported BEFORE the generic
  // "validation_failed" bucket so the UI can render the right Russian
  // message. See `packages/schemas/src/intent.ts` for the authoritative
  // constraints.
  if (kind === "assign" && intent["type"] === "course") {
    const rawSessions = intent["sessionsCount"];
    if (rawSessions === undefined || rawSessions === null) {
      return "assign_course_missing_sessions";
    }
    if (
      typeof rawSessions === "number" &&
      Number.isInteger(rawSessions) &&
      rawSessions > MAX_COURSE_DAYS
    ) {
      return "assign_course_exceeds_max_days";
    }
  }

  // Schema-version, intent presence, and intent.kind all look structurally
  // correct — the Zod failure is in a deeper field (e.g. missing slots,
  // out-of-range confidence, etc.). Report the generic bucket.
  return "validation_failed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
