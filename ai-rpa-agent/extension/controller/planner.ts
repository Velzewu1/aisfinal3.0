import type { AgentEvent, DomAction, Intent, ScheduleInjectPayload, ScheduleResult } from "@ai-rpa/schemas";
import { newCorrelationId } from "../shared/correlation.js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("planner");

/** Base id from instance ids like `lfk_d3` → `lfk`; used for Russian labels in inject payload. */
const PROCEDURE_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  lfk: "Лечебная физкультура",
  massage: "Массаж лечебный",
  psychology: "Консультация психолога",
  speech: "Логопедия",
  physio: "Физиотерапия",
};

function baseProcedureIdFromInstanceId(procedureId: string): string {
  const idx = procedureId.indexOf("_d");
  if (idx <= 0) return procedureId;
  return procedureId.slice(0, idx);
}

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
  // `assign` is a clinical state change, NOT an executable action. The
  // planner must never observe it; treat a stray call as a controller
  // contract violation and refuse without emitting an ActionPlan.
  if (intent.kind === "assign") {
    log.warn("planner_refused_assign_intent", {
      correlationId,
      note: "assign_is_state_change_no_action_plan_allowed",
    });
    return [];
  }

  const actions = buildActions(intent, scheduleResult);
  emitActionPlanCreated(correlationId, intent.kind, actions);
  return actions;
}

function toInjectSchedulePayload(grid: string, result: ScheduleResult): ScheduleInjectPayload {
  const metadata: Record<string, unknown> = { status: result.status };
  if (result.objective !== undefined) metadata.objective = result.objective;
  const slots = result.assignments.map((a) => {
    const baseProcId = baseProcedureIdFromInstanceId(a.procedureId);
    const procedureName = PROCEDURE_DISPLAY_NAMES[baseProcId] ?? baseProcId;
    return {
      time: `${a.day}:${a.startMinute}-${a.endMinute}`,
      doctorId: a.doctorId,
      procedureId: a.procedureId,
      procedureName,
    };
  });
  log.info("schedule_inject_payload", {
    horizonDays: result.horizonDays,
    slotsCount: slots.length,
    slots,
  });
  return {
    grid,
    // `a.day` is horizon index 0..8; UI uses the same for data-day-index and data-day = day+1.
    slots,
    metadata,
  };
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
      if (intent.patientQuery) {
        // Patient selection from a list: delegate to `open_patient`, which
        // fires a native click on the matching row. The mock-ui's own
        // handler performs the URL change, keeping the AI out of the
        // DOM-mutation path.
        return [{ kind: "open_patient", patientQuery: intent.patientQuery }];
      }
      return [{ kind: "navigate", nav: intent.target }];

    case "set_status":
      return [{ kind: "set_status", entity: intent.entity, status: intent.status }];

    case "schedule": {
      if (!scheduleResult) return [];
      const grid = "primary";
      return [
        {
          kind: "inject_schedule",
          grid,
          payload: toInjectSchedulePayload(grid, scheduleResult),
        },
      ];
    }

    case "assign":
      // Unreachable: `planActions` refuses `assign` before reaching here.
      // Assign is a clinical state change handled by the controller's
      // CarePlan flow; it MUST NOT produce any DomAction.
      return [];

    case "build_schedule":
      // Logistics step. The controller expands confirmed CarePlans
      // and calls the scheduler. No direct DOM actions needed.
      return [];

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
    ts: new Date().toISOString(),
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
