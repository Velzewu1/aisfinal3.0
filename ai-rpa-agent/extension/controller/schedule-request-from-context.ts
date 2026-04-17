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

const DEFAULT_DOCTOR: Doctor = Object.freeze({
  id: "doc_clinic_primary",
  name: "Primary Clinician",
  specialty: "general_medicine",
});

const DEFAULT_WEEKDAYS = [1, 2, 3, 4, 5] as const;

function defaultWeekdayWindows(doctorId: string): WorkingWindow[] {
  return DEFAULT_WEEKDAYS.map((day) => ({
    doctorId,
    day,
    startMinute: 9 * 60,
    endMinute: 17 * 60,
  }));
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
  const doctors: Doctor[] = input.doctors ? [...input.doctors] : [DEFAULT_DOCTOR];
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
    : defaultWeekdayWindows(primaryDoctorId);

  const raw = {
    horizonDays: input.horizonDays ?? 9,
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
