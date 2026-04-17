export const CONFIDENCE_THRESHOLD = 0.7;

export type Decision =
  | { kind: "execute" }
  | { kind: "confirm"; reason: string }
  | { kind: "reject"; reason: string };

export function decide(params: {
  intentKind: string;
  confidence: number;
  highRisk: boolean;
}): Decision {
  if (params.intentKind === "unknown") {
    return { kind: "reject", reason: "unknown_intent" };
  }
  if (params.highRisk) {
    return { kind: "confirm", reason: "high_risk_intent" };
  }
  if (params.confidence >= CONFIDENCE_THRESHOLD) {
    return { kind: "execute" };
  }
  return { kind: "confirm", reason: `low_confidence:${params.confidence.toFixed(2)}` };
}

export function isHighRisk(intentKind: string): boolean {
  return intentKind === "set_status" || intentKind === "schedule";
}
