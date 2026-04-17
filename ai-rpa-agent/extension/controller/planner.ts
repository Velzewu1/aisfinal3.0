import type { DomAction, Intent, ScheduleResult } from "@ai-rpa/schemas";

/**
 * Converts a validated intent into a deterministic DOM action plan.
 * Pure function: no DOM, no network, no LLM, no side effects.
 */
export function planActions(intent: Intent, scheduleResult?: ScheduleResult): DomAction[] {
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
