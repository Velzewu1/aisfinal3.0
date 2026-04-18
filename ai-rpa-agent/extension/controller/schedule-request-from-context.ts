import type { ContextualizedUtteranceEvent } from "./context.js";
import {
  ScheduleRequest as ScheduleRequestSchema,
  type Doctor,
  type Procedure,
  type ScheduleRequest,
  type WorkingWindow,
} from "@ai-rpa/schemas";

/**
 * Deterministic ScheduleRequest construction for the system (non-LLM) path.
 *
 * Inputs are validated session/UI context plus optional overrides. The LLM
 * is never consulted; output is always run through `ScheduleRequest.safeParse`.
 */

export type ValidatedScheduleContext = ContextualizedUtteranceEvent["context"];

export type ScheduleRequestBuildInput = {
  readonly doctors?: readonly Doctor[];
  readonly procedures?: readonly Procedure[];
  readonly windows?: readonly WorkingWindow[];
  readonly horizonDays?: number;
  readonly slotMinutes?: number;
  /** Used only when `procedures` is omitted. */
  readonly procedureName?: string;
  /** Used only when `procedures` is omitted. */
  readonly defaultProcedureDurationMinutes?: number;
};

export type BuildScheduleRequestResult =
  | { ok: true; request: ScheduleRequest }
  | { ok: false; error: string };

/** Canonical mock schedule grid ids — must match `mock-ui/schedule.html` SPECIALISTS and `schedule-ui-map.js` DOCTOR_UI_MAP. */
const MOCK_SCHEDULE_DOCTOR_LFK: Doctor = Object.freeze({
  id: "lkf_1",
  name: "Врач ЛФК",
  specialty: "ЛФК и спорт",
});

const MOCK_SCHEDULE_DOCTOR_MASSAGE: Doctor = Object.freeze({
  id: "massage_1",
  name: "Массажист",
  specialty: "Массаж",
});

const DEFAULT_MOCK_SCHEDULE_DOCTORS: readonly Doctor[] = Object.freeze([
  MOCK_SCHEDULE_DOCTOR_LFK,
  MOCK_SCHEDULE_DOCTOR_MASSAGE,
]);

/** Horizon day indices 0..n-1 (internal contract). Mock grid: `data-day-index` = day, `data-day` = day + 1. */
function horizonDayIndices(horizonDays: number): number[] {
  const n = Math.min(Math.max(Math.floor(horizonDays), 1), 9);
  return Array.from({ length: n }, (_, i) => i);
}

function defaultWeekdayWindows(doctorId: string, horizonDays: number): WorkingWindow[] {
  return horizonDayIndices(horizonDays).map((day) => ({
    doctorId,
    day,
    startMinute: 9 * 60,
    endMinute: 17 * 60,
  }));
}

/** Availability for each default mock specialist across the full horizon (only `lkf_1` and `massage_1`). */
function defaultMockScheduleWindows(horizonDays: number): WorkingWindow[] {
  const windows: WorkingWindow[] = [];
  for (const d of DEFAULT_MOCK_SCHEDULE_DOCTORS) {
    windows.push(...defaultWeekdayWindows(d.id, horizonDays));
  }
  return windows;
}

function sanitizeIdPart(raw: string | undefined): string {
  if (raw === undefined || raw.length === 0) return "default";
  const s = raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  return s.length > 0 ? s : "default";
}

function defaultProcedureId(context: ValidatedScheduleContext): string {
  return `proc_patient_${sanitizeIdPart(context.patientId)}`;
}

function defaultProcedureDisplayName(
  context: ValidatedScheduleContext,
  input: ScheduleRequestBuildInput,
): string {
  if (input.procedureName !== undefined && input.procedureName.length > 0) {
    return input.procedureName;
  }
  const name = context.patientName?.trim();
  return name && name.length > 0 ? `Visit — ${name}` : "Visit — patient";
}

/**
 * Builds a CP-SAT-ready `ScheduleRequest` from trusted context (e.g. after
 * `attachContext`) and optional UI/session overrides.
 */
export function tryBuildScheduleRequestFromContext(
  context: ValidatedScheduleContext,
  input: ScheduleRequestBuildInput = {},
): BuildScheduleRequestResult {
  const horizonDays = input.horizonDays ?? 9;
  const doctors: Doctor[] = input.doctors ? [...input.doctors] : [...DEFAULT_MOCK_SCHEDULE_DOCTORS];
  const primaryDoctorId = doctors[0]?.id;
  if (primaryDoctorId === undefined || primaryDoctorId.length === 0) {
    return { ok: false, error: "schedule_builder:no_doctors" };
  }

  const duration =
    input.defaultProcedureDurationMinutes !== undefined
      ? input.defaultProcedureDurationMinutes
      : 30;

  const procedures: Procedure[] = input.procedures
    ? [...input.procedures]
    : [
        {
          id: defaultProcedureId(context),
          name: defaultProcedureDisplayName(context, input),
          durationMinutes: duration,
          allowedDoctorIds: [primaryDoctorId],
        },
      ];

  const windows: WorkingWindow[] = input.windows
    ? [...input.windows]
    : input.doctors
      ? defaultWeekdayWindows(primaryDoctorId, horizonDays)
      : defaultMockScheduleWindows(horizonDays);

  const raw = {
    horizonDays,
    doctors,
    procedures,
    windows,
    slotMinutes: input.slotMinutes ?? 15,
  };

  const parsed = ScheduleRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 8)
      .map((i) => `${i.path.join(".") || "<root>"}:${i.code}`)
      .join(",");
    return { ok: false, error: `schedule_builder:schema:${issues || "invalid"}` };
  }

  return { ok: true, request: parsed.data };
}

/** Convenience: use the context block from a `ContextualizedUtteranceEvent`. */
export function tryBuildScheduleRequestFromContextualized(
  event: ContextualizedUtteranceEvent,
  input?: ScheduleRequestBuildInput,
): BuildScheduleRequestResult {
  return tryBuildScheduleRequestFromContext(event.context, input);
}
