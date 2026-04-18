import type { ContextualizedUtteranceEvent } from "./context.js";
import {
  ScheduleRequest as ScheduleRequestSchema,
  type Doctor,
  type Procedure,
  type ScheduleRequest,
  type WorkingWindow,
} from "@ai-rpa/schemas";
import { createLogger } from "../shared/logger.js";

const log = createLogger("schedule-request");

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
  /**
   * Optional LLM `rationale` (e.g. voice path). When `horizonDays` is not set,
   * {@link extractHorizonFromRationale} reads `horizonDays:N` from this string.
   */
  readonly rationale?: string;
};

/** Parses `horizonDays:N` from LLM rationale; default 9; max 9 for mock grid. */
export function extractHorizonFromRationale(rationale?: string): number {
  if (rationale === undefined || rationale.length === 0) return 9;
  const match = /horizonDays:(\d+)/.exec(rationale);
  if (!match) return 9;
  const n = Number.parseInt(match[1], 10);
  if (!Number.isFinite(n)) return 9;
  return Math.min(Math.max(n, 1), 9);
}

export type BuildScheduleRequestResult =
  | { ok: true; request: ScheduleRequest }
  | { ok: false; error: string };

/** Canonical mock schedule grid ids — must match `mock-ui/schedule.html` SPECIALISTS and `schedule-ui-map.js` DOCTOR_UI_MAP. */
export const DEFAULT_DOCTORS: readonly Doctor[] = Object.freeze([
  { id: "lkf_1", name: "Инструктор ЛФК", specialty: "ЛФК" },
  { id: "massage_1", name: "Массажист", specialty: "Массаж" },
  { id: "psych_1", name: "Психолог", specialty: "Психология" },
  { id: "speech_1", name: "Логопед", specialty: "Логопедия" },
  { id: "physio_1", name: "Физиотерапевт", specialty: "Физиотерапия" },
]);

/** Base procedure definitions (one row per service type); expanded daily via {@link buildTzExpandedProceduresAndWindows}. */
export const DEFAULT_PROCEDURES: readonly Procedure[] = Object.freeze([
  {
    id: "lfk",
    name: "Лечебная физкультура",
    durationMinutes: 40,
    allowedDoctorIds: ["lkf_1"],
  },
  {
    id: "massage",
    name: "Массаж лечебный",
    durationMinutes: 30,
    allowedDoctorIds: ["massage_1"],
  },
  {
    id: "psychology",
    name: "Консультация психолога",
    durationMinutes: 40,
    allowedDoctorIds: ["psych_1"],
  },
  {
    id: "speech",
    name: "Логопедия",
    durationMinutes: 40,
    allowedDoctorIds: ["speech_1"],
  },
  {
    id: "physio",
    name: "Физиотерапия",
    durationMinutes: 30,
    allowedDoctorIds: ["physio_1"],
  },
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

/** Working windows: 09:00–17:00 for every day in the horizon, for each doctor. */
export function buildDefaultWindowsForDoctors(
  doctorIds: readonly string[],
  horizonDays: number,
): WorkingWindow[] {
  const windows: WorkingWindow[] = [];
  const days = horizonDayIndices(horizonDays);
  for (const day of days) {
    for (const doctorId of doctorIds) {
      windows.push({
        doctorId,
        day,
        startMinute: 9 * 60,
        endMinute: 17 * 60,
      });
    }
  }
  return windows;
}

/**
 * Base rows for TZ expansion: one window per (procedure type × day), doctor ids must match
 * {@link DEFAULT_DOCTORS} / mock `data-specialist` (e.g. `lkf_1`, not `lfk_1`).
 *
 * Instance ids MUST use `_d${day}` (e.g. `lfk_d0`). Using `_day${day}` breaks any `_d`-based
 * parsing because `"lfk_day0".split("_d")` → `["lfk", "ay0"]`.
 */
const BASE_PROCEDURES_FOR_HORIZON: readonly {
  readonly id: string;
  readonly name: string;
  readonly durationMinutes: number;
  readonly doctorId: string;
}[] = [
  {
    id: "lfk",
    name: "Лечебная физкультура",
    durationMinutes: 40,
    doctorId: "lkf_1",
  },
  {
    id: "massage",
    name: "Массаж лечебный",
    durationMinutes: 30,
    doctorId: "massage_1",
  },
  {
    id: "psychology",
    name: "Консультация психолога",
    durationMinutes: 40,
    doctorId: "psych_1",
  },
  {
    id: "speech",
    name: "Логопедия",
    durationMinutes: 40,
    doctorId: "speech_1",
  },
  {
    id: "physio",
    name: "Физиотерапия",
    durationMinutes: 30,
    doctorId: "physio_1",
  },
];

/**
 * One procedure instance per (base procedure × calendar day in horizon), each with one matching window.
 * Yields `actualHorizon × 5` instances (e.g. 35 for 7 days, 45 for 9 days).
 */
export function buildTzExpandedProceduresAndWindows(horizonDays: number): {
  procedures: Procedure[];
  windows: WorkingWindow[];
} {
  const actualHorizon = Math.min(Math.max(Math.floor(horizonDays), 1), 9);
  const procedures: Procedure[] = [];
  const windows: WorkingWindow[] = [];

  for (let day = 0; day < actualHorizon; day += 1) {
    for (const base of BASE_PROCEDURES_FOR_HORIZON) {
      const instanceId = `${base.id}_d${day}`;

      procedures.push({
        id: instanceId,
        name: base.name,
        durationMinutes: base.durationMinutes,
        allowedDoctorIds: [base.doctorId],
      });

      windows.push({
        doctorId: base.doctorId,
        day,
        startMinute: 540,
        endMinute: 1020,
      });
    }
  }

  const windowsByDay = windows.reduce<Record<number, number>>((acc, w) => {
    acc[w.day] = (acc[w.day] ?? 0) + 1;
    return acc;
  }, {});
  console.log("windows by day:", windowsByDay);

  procedures.forEach((p) => {
    const dayStr = p.id.split("_d")[1];
    const dayFromId =
      dayStr !== undefined && dayStr.length > 0 ? Number.parseInt(dayStr, 10) : Number.NaN;
    const hasWindow =
      windows.find(
        (w) =>
          w.doctorId === p.allowedDoctorIds[0] &&
          w.day === dayFromId &&
          Number.isFinite(dayFromId),
      ) !== undefined;
    console.log(p.id, p.allowedDoctorIds, hasWindow ? "HAS WINDOW" : "NO WINDOW");
  });

  const dayCount = new Set(windows.map((w) => w.day)).size;
  console.log(
    `[schedule-context] built: ${procedures.length} procedures, ${windows.length} windows, ${dayCount} days`,
  );

  return { procedures, windows };
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
  const horizonDays = input.horizonDays ?? extractHorizonFromRationale(input.rationale);
  const doctors: Doctor[] = input.doctors ? [...input.doctors] : [...DEFAULT_DOCTORS];
  const primaryDoctorId = doctors[0]?.id;
  if (primaryDoctorId === undefined || primaryDoctorId.length === 0) {
    return { ok: false, error: "schedule_builder:no_doctors" };
  }

  const duration =
    input.defaultProcedureDurationMinutes !== undefined
      ? input.defaultProcedureDurationMinutes
      : 30;

  let procedures: Procedure[];
  let windows: WorkingWindow[];

  if (input.procedures !== undefined) {
    procedures = [...input.procedures];
    windows = input.windows
      ? [...input.windows]
      : buildDefaultWindowsForDoctors(
          doctors.map((d) => d.id),
          horizonDays,
        );
  } else if (input.doctors !== undefined) {
    procedures = [
      {
        id: defaultProcedureId(context),
        name: defaultProcedureDisplayName(context, input),
        durationMinutes: duration,
        allowedDoctorIds: [primaryDoctorId],
      },
    ];
    windows = input.windows
      ? [...input.windows]
      : defaultWeekdayWindows(primaryDoctorId, horizonDays);
  } else {
    const expanded = buildTzExpandedProceduresAndWindows(horizonDays);
    procedures = expanded.procedures;
    windows = input.windows ? [...input.windows] : expanded.windows;
  }

  const raw = {
    horizonDays,
    doctors,
    procedures,
    windows,
    slotMinutes: input.slotMinutes ?? 30,
  };

  const parsed = ScheduleRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 8)
      .map((i) => `${i.path.join(".") || "<root>"}:${i.code}`)
      .join(",");
    return { ok: false, error: `schedule_builder:schema:${issues || "invalid"}` };
  }

  log.info("schedule_request_built", {
    horizonDays: parsed.data.horizonDays,
    proceduresCount: parsed.data.procedures.length,
    windowsCount: parsed.data.windows.length,
  });

  return { ok: true, request: parsed.data };
}

/** Convenience: use the context block from a `ContextualizedUtteranceEvent`. */
export function tryBuildScheduleRequestFromContextualized(
  event: ContextualizedUtteranceEvent,
  input?: ScheduleRequestBuildInput,
): BuildScheduleRequestResult {
  return tryBuildScheduleRequestFromContext(event.context, input);
}
