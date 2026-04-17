import type { AgentEvent, LlmInterpretation } from "@ai-rpa/schemas";
import { newCorrelationId, nowIso } from "../shared/correlation.js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("controller.confidence");

/**
 * Confidence scoring helpers only. The sole decision entry point for
 * execute / confirm / reject is `decision.ts::decideAction` — do not add a
 * parallel `decide` or classifier here.
 *
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
//   - Pure synchronous function w.r.t. its return value: output depends
//     only on `input.confidence`.
//   - Never throws. Never mutates input. Never reads DOM / network / clock.
//   - Side effects are audit-only: one `confidence_evaluated` log line and
//     one best-effort `confidence_evaluated` AgentEvent (fire-and-forget).
//     Neither side effect can influence the returned `ConfidenceResult`.
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

  emitConfidenceEvaluated(correlationId, score, level, requiresConfirmation);

  return { level, score, requiresConfirmation };
}

function emitConfidenceEvaluated(
  correlationId: string,
  score: number,
  level: ConfidenceLevel,
  requiresConfirmation: boolean,
): void {
  const event: Extract<AgentEvent, { type: "confidence_evaluated" }> = {
    id: newCorrelationId(),
    type: "confidence_evaluated",
    correlationId,
    ts: nowIso(),
    payload: { score, level, requiresConfirmation },
  };
  try {
    void chrome.runtime.sendMessage({ type: "event", event }).catch(() => {
      // Audit sink is best-effort; never propagate failure.
    });
  } catch {
    // Audit sink is best-effort; never propagate failure.
  }
}
