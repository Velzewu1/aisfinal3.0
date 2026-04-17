import type { LlmInterpretation } from "@ai-rpa/schemas";
import { createLogger } from "../shared/logger.js";

const log = createLogger("controller.confidence");

/**
 * Minimum confidence required to auto-execute a non-high-risk intent.
 * Below this we always require user confirmation.
 */
export const CONFIDENCE_THRESHOLD = 0.7;

/**
 * Step 8 threshold: at or above this score the controller may execute
 * without user confirmation (subject to risk-class checks in Step 9).
 */
export const HIGH_CONFIDENCE_THRESHOLD = 0.85;

export function isHighRisk(intentKind: string): boolean {
  return intentKind === "set_status" || intentKind === "schedule";
}

// ------------------------------------------------------------------ //
// Step 8 — Confidence evaluation                                     //
// ------------------------------------------------------------------ //
//
// Responsibility: turn a validated `LlmInterpretation.confidence` score
// into a discrete, deterministic signal consumed by the Step 9 decision
// gate.
//
// Invariants:
//   - Pure synchronous function. Output depends only on `input.confidence`.
//   - Never throws. Never mutates input. Never reads DOM / network / clock.
//   - Only side effect: a single structured `confidence_evaluated` log
//     line carrying `correlationId`.
//
// The mapping is intentionally *classification only* — the actual
// `execute` / `confirm` / `reject` decision lives in
// `controller/decision.ts::decideAction`, which additionally considers
// risk class and intent kind (`unknown` → reject regardless of score).

export type ConfidenceLevel = "high" | "medium" | "low";

export type ConfidenceResult = {
  level: ConfidenceLevel;
  score: number;
  requiresConfirmation: boolean;
};

export function evaluateConfidence(
  input: LlmInterpretation,
  correlationId: string,
): ConfidenceResult {
  const score = input.confidence;

  let level: ConfidenceLevel;
  let requiresConfirmation: boolean;

  if (score >= HIGH_CONFIDENCE_THRESHOLD) {
    level = "high";
    requiresConfirmation = false;
  } else if (score >= CONFIDENCE_THRESHOLD) {
    level = "medium";
    requiresConfirmation = true;
  } else {
    level = "low";
    requiresConfirmation = true;
  }

  log.info(
    "confidence_evaluated",
    { score, level, requiresConfirmation },
    correlationId,
  );

  return { level, score, requiresConfirmation };
}
