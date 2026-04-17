import type { LlmInterpretation } from "@ai-rpa/schemas";
import { createLogger } from "../shared/logger.js";
import { CONFIDENCE_THRESHOLD, evaluateConfidence, isHighRisk } from "./confidence.js";

const log = createLogger("controller.decision");

/**
 * Step 9 of the agent loop: the controller decision gate.
 *
 * Responsibility: take a validated `LlmInterpretation` and produce the
 * single enforceable system action — `execute`, `confirm`, or `reject`
 * — that every downstream layer must honor.
 *
 * Invariants:
 *   - Pure synchronous function. Output depends only on `input`.
 *   - Never mutates `input`. Never auto-corrects `intent.kind`.
 *   - No DOM, no network, no backend, no `chrome.*`, no clock, no PRNG.
 *   - The only side effect is a single structured `decision_made` log
 *     line carrying `correlationId`, the decision kind, the score, the
 *     intent kind, the risk flag, and the reason token.
 *   - Unknown-intent rejection is non-negotiable and runs FIRST.
 *
 * Trust posture:
 *   - This is the sole authority for `execute` / `confirm` / `reject`.
 *     Neither the controller orchestrator nor the executor may override
 *     its verdict. Any other "decision" observed in the system must
 *     ultimately trace back to a `DecisionResult` emitted here.
 */

export type DecisionKind = "execute" | "confirm" | "reject";

export type DecisionResult = {
  kind: DecisionKind;
  reason: string;
  confidence: number;
  requiresUserConfirmation: boolean;
};

export function decideAction(
  input: LlmInterpretation,
  correlationId: string,
): DecisionResult {
  // STEP 1: compute confidence (emits its own `confidence_evaluated` log line).
  const conf = evaluateConfidence(input, correlationId);

  // STEP 2: extract intent (do not copy, do not mutate).
  const intent = input.intent;

  // STEP 3: risk check (intent-kind-based, no field-level policy here).
  const highRisk = isHighRisk(intent.kind);

  const result = classify(intent.kind, conf.score, conf.requiresConfirmation, highRisk);

  log.info(
    "decision_made",
    {
      decision: result.kind,
      reason: result.reason,
      score: conf.score,
      intentKind: intent.kind,
      highRisk,
      requiresUserConfirmation: result.requiresUserConfirmation,
    },
    correlationId,
  );

  return result;
}

// ------------------------------------------------------------------ //
// Decision classifier — strict ordering, no fallthrough ambiguity.   //
// ------------------------------------------------------------------ //

function classify(
  intentKind: string,
  score: number,
  requiresConfirmation: boolean,
  highRisk: boolean,
): DecisionResult {
  // CASE A — REJECT: unknown intent is always a hard stop.
  if (intentKind === "unknown") {
    return {
      kind: "reject",
      reason: "unknown_intent",
      confidence: score,
      requiresUserConfirmation: true,
    };
  }

  // CASE B — REJECT: below minimum confidence threshold.
  if (score < CONFIDENCE_THRESHOLD) {
    return {
      kind: "reject",
      reason: "low_confidence",
      confidence: score,
      requiresUserConfirmation: true,
    };
  }

  // CASE C — CONFIRM: high-risk intents always require confirmation.
  if (highRisk) {
    return {
      kind: "confirm",
      reason: "high_risk_operation",
      confidence: score,
      requiresUserConfirmation: true,
    };
  }

  // CASE D — CONFIRM: medium-confidence band (0.7 <= score < 0.85).
  if (requiresConfirmation) {
    return {
      kind: "confirm",
      reason: "needs_confirmation",
      confidence: score,
      requiresUserConfirmation: true,
    };
  }

  // CASE E — EXECUTE: high-confidence, low-risk, non-unknown.
  return {
    kind: "execute",
    reason: "auto_execute",
    confidence: score,
    requiresUserConfirmation: false,
  };
}
