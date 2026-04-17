import type { AgentEvent, DomAction, Intent, ScheduleResult } from "@ai-rpa/schemas";
import { newCorrelationId, nowIso } from "../shared/correlation.js";

/**
 * Converts a validated intent into a deterministic DOM action plan.
 *
 * Return value is a pure function of `(intent, scheduleResult)`. Emits a
 * best-effort `action_plan_created` AgentEvent for observability; emission
 * is fire-and-forget and never observable from the return value.
 */
export function planActions(
  intent: Intent,
  correlationId: string,
  scheduleResult?: ScheduleResult,
): DomAction[] {
  const actions = buildActions(intent, scheduleResult);
  emitActionPlanCreated(correlationId, intent.kind, actions);
  return actions;
}

function buildActions(intent: Intent, scheduleResult?: ScheduleResult): DomAction[] {
  switch (intent.kind) {
    case "fill":
      return intent.slots.map((slot) => ({
        kind: "fill" as const,
        field: slot.field,
        value: slot.value,
      }));

    case "navigate":
      return [{ kind: "navigate", nav: intent.target }];

    case "set_status":
      return [{ kind: "set_status", entity: intent.entity, status: intent.status }];

    case "schedule": {
      if (!scheduleResult) return [];
      return [
        {
          kind: "inject_schedule",
          grid: "primary",
          payload: scheduleResult,
        },
      ];
    }

    case "unknown":
      return [];

    default: {
      const _exhaustive: never = intent;
      void _exhaustive;
      return [];
    }
  }
}

function emitActionPlanCreated(
  correlationId: string,
  intentKind: string,
  actions: DomAction[],
): void {
  const event: Extract<AgentEvent, { type: "action_plan_created" }> = {
    id: newCorrelationId(),
    type: "action_plan_created",
    correlationId,
    ts: nowIso(),
    payload: {
      intentKind,
      actionCount: actions.length,
      actionKinds: actions.map((a) => a.kind),
    },
  };
  try {
    void chrome.runtime.sendMessage({ type: "event", event }).catch(() => {
      // Audit sink is best-effort; never propagate failure.
    });
  } catch {
    // Audit sink is best-effort; never propagate failure.
  }
}
