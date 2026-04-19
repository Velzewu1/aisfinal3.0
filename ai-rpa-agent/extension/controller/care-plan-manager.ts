import type {
  CarePlan,
  Session,
  ClinicalService,
  AssignIntent,
  ScheduleRequest,
  ScheduledAssignment,
} from "@ai-rpa/schemas";
import {
  SERVICE_DEFAULT_DURATION,
  SERVICE_DOCTOR_ID,
  SERVICE_DISPLAY_NAMES,
  MAX_COURSE_DAYS,
} from "@ai-rpa/schemas";
import { newCorrelationId, nowIso } from "../shared/correlation.js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("care-plan-manager");

// ------------------------------------------------------------------ //
// In-memory CarePlan + Session registry                               //
//                                                                    //
// For hackathon demo: all state is runtime-only (service worker).     //
// Production would persist to a database.                             //
//                                                                    //
// Invariants:                                                         //
//   1. CarePlans are created ONLY via createCarePlan().               //
//   2. Expansion into sessions happens ONLY after confirmation.       //
//   3. Scheduling is delegated to the CP-SAT backend via the         //
//      schedule-request-from-context module.                          //
//   4. Re-scheduling merges new sessions with existing committed.    //
// ------------------------------------------------------------------ //

const carePlans = new Map<string, CarePlan>();
const sessions = new Map<string, Session>();
/** Ordered list of committed assignments (from schedule_generated). */
let committedAssignments: ScheduledAssignment[] = [];

/**
 * Error codes produced by care-plan-manager when a request violates
 * the hard domain rules. These are the SAME tokens the LLM-validation
 * path uses, so the sidepanel can map them to a single Russian
 * user-facing message regardless of where the violation was caught.
 */
export type CarePlanDomainError =
  | "assign_course_missing_sessions"
  | "assign_course_exceeds_max_days";

export class CarePlanDomainViolation extends Error {
  readonly code: CarePlanDomainError;
  readonly sessionsCount?: number;
  constructor(code: CarePlanDomainError, sessionsCount?: number) {
    super(code);
    this.name = "CarePlanDomainViolation";
    this.code = code;
    this.sessionsCount = sessionsCount;
  }
}

/**
 * Creates a draft CarePlan from an assign intent.
 *
 * Domain guarantees (defense-in-depth — upstream schema should already
 * have caught these, but `createCarePlan` is the LAST line of defense
 * before state mutation):
 *
 *   1. `type: "initial"` always yields `sessionsCount = 1`.
 *   2. `type: "course"` requires `intent.sessionsCount` to be present;
 *      missing → throws `assign_course_missing_sessions`. No default
 *      value (especially not 10) is EVER substituted.
 *   3. `sessionsCount > MAX_COURSE_DAYS` → throws
 *      `assign_course_exceeds_max_days`. No silent truncation.
 *
 * Callers MUST catch {@link CarePlanDomainViolation} and translate it
 * into a clinician-facing event — never let it bubble to the executor.
 */
export function createCarePlan(
  intent: AssignIntent,
  patientId: string,
  createdBy: string,
): CarePlan {
  let sessionsCount: number;
  if (intent.type === "initial") {
    sessionsCount = 1;
  } else {
    if (intent.sessionsCount === undefined) {
      throw new CarePlanDomainViolation("assign_course_missing_sessions");
    }
    if (intent.sessionsCount > MAX_COURSE_DAYS) {
      throw new CarePlanDomainViolation(
        "assign_course_exceeds_max_days",
        intent.sessionsCount,
      );
    }
    sessionsCount = intent.sessionsCount;
  }
  const durationMinutes =
    intent.durationMinutes ?? SERVICE_DEFAULT_DURATION[intent.service];

  const plan: CarePlan = {
    id: `cp_${newCorrelationId().slice(0, 12)}`,
    patientId,
    service: intent.service,
    sessionsCount,
    durationMinutes,
    type: intent.type,
    status: "draft",
    createdBy,
    createdAt: nowIso(),
    constraints: {
      maxPerDay: 1,
      breakMinutes: 0,
    },
  };

  carePlans.set(plan.id, plan);

  log.info("care_plan_created", {
    planId: plan.id,
    service: plan.service,
    type: plan.type,
    sessionsCount: plan.sessionsCount,
    patientId,
  });

  return plan;
}

/**
 * Confirms a draft CarePlan WITHOUT expanding into sessions.
 * This is used by the assign flow — clinical decision only, no scheduling.
 */
export function confirmPlan(planId: string): CarePlan | null {
  const plan = carePlans.get(planId);
  if (!plan) {
    log.warn("confirm_plan: plan not found", { planId });
    return null;
  }
  if (plan.status !== "draft") {
    log.warn("confirm_plan: plan not in draft", {
      planId,
      status: plan.status,
    });
    return null;
  }

  plan.status = "confirmed";

  log.info("care_plan_confirmed", {
    planId,
    service: plan.service,
    sessionsCount: plan.sessionsCount,
  });

  return plan;
}

/**
 * Expands a confirmed CarePlan into sessions.
 * Only works on "confirmed" plans (already confirmed by doctor).
 * Used by the build_schedule flow — logistics step.
 */
export function expandConfirmedPlan(planId: string): Session[] {
  const plan = carePlans.get(planId);
  if (!plan) {
    log.warn("expand: plan not found", { planId });
    return [];
  }
  if (plan.status !== "confirmed") {
    log.warn("expand: plan not confirmed", {
      planId,
      status: plan.status,
    });
    return [];
  }

  const expanded = expandToSessions(plan);

  log.info("care_plan_expanded", {
    planId,
    sessionsCount: expanded.length,
    service: plan.service,
  });

  return expanded;
}

/**
 * Legacy: Confirms a draft CarePlan AND expands it into sessions.
 * Now accepts both "draft" and "confirmed" status.
 */
export function confirmAndExpand(planId: string): Session[] {
  const plan = carePlans.get(planId);
  if (!plan) {
    log.warn("confirm_expand: plan not found", { planId });
    return [];
  }
  if (plan.status !== "draft" && plan.status !== "confirmed") {
    log.warn("confirm_expand: plan not in valid state", {
      planId,
      status: plan.status,
    });
    return [];
  }

  plan.status = "confirmed";
  const expanded = expandToSessions(plan);

  log.info("care_plan_expanded", {
    planId,
    sessionsCount: expanded.length,
    service: plan.service,
  });

  return expanded;
}

/**
 * Returns all confirmed CarePlans (ready for scheduling).
 */
export function getConfirmedCarePlans(): CarePlan[] {
  const result: CarePlan[] = [];
  for (const [, plan] of carePlans) {
    if (plan.status === "confirmed") {
      result.push(plan);
    }
  }
  return result;
}

/**
 * Generates N session entities from a confirmed CarePlan.
 * Sessions are distributed one-per-day starting from day 0.
 */
function expandToSessions(plan: CarePlan): Session[] {
  const result: Session[] = [];
  const maxPerDay = plan.constraints?.maxPerDay ?? 1;

  for (let i = 0; i < plan.sessionsCount; i++) {
    // Distribute sessions across days, respecting maxPerDay
    const dayIndex = Math.floor(i / maxPerDay);
    const session: Session = {
      id: `sess_${plan.id}_${i + 1}`,
      carePlanId: plan.id,
      service: plan.service,
      dayIndex,
      sessionNumber: i + 1,
      status: "pending",
    };
    sessions.set(session.id, session);
    result.push(session);
  }

  return result;
}

/**
 * Builds a ScheduleRequest from expanded sessions, compatible with the
 * CP-SAT backend. Merges with any existing committed assignments.
 */
export function buildScheduleRequestFromSessions(
  newSessions: Session[],
  plan: CarePlan,
  horizonDays?: number,
): ScheduleRequest {
  const doctorId = SERVICE_DOCTOR_ID[plan.service];
  // Scheduler "horizon" is the calendar window the solver places sessions
  // into — NOT the number of sessions. The two are independent: a 2-day
  // course still needs a valid working-hour window on 2 days. We clamp
  // explicitly to `MAX_COURSE_DAYS` (the mock grid max); `plan.sessionsCount`
  // has already been validated to lie in [1, MAX_COURSE_DAYS].
  const requestedHorizon = horizonDays ?? plan.sessionsCount;
  const cappedHorizon = Math.max(
    1,
    Math.min(requestedHorizon, MAX_COURSE_DAYS),
  );

  // Build procedures: one per session
  const procedures = newSessions.map((s) => ({
    id: `${plan.service}_d${s.dayIndex}`,
    name: SERVICE_DISPLAY_NAMES[plan.service],
    durationMinutes: plan.durationMinutes,
    allowedDoctorIds: [doctorId],
  }));

  // Build working windows for each day in horizon
  const windows = [];
  for (let day = 0; day < cappedHorizon; day++) {
    windows.push({
      doctorId,
      day,
      startMinute: 540, // 09:00
      endMinute: 1020, // 17:00
    });
  }

  // If there are existing committed assignments for OTHER services,
  // include those doctors/procedures/windows too for proper constraint resolution
  const existingOtherServices = getCommittedForOtherServices(plan.service);
  if (existingOtherServices.length > 0) {
    const otherDoctorIds = new Set<string>();
    for (const a of existingOtherServices) {
      otherDoctorIds.add(a.doctorId);
      procedures.push({
        id: a.procedureId,
        name: a.procedureId, // simplified for constraint
        durationMinutes: plan.durationMinutes,
        allowedDoctorIds: [a.doctorId],
      });
    }
    for (const otherId of otherDoctorIds) {
      for (let day = 0; day < cappedHorizon; day++) {
        if (
          !windows.find((w) => w.doctorId === otherId && w.day === day)
        ) {
          windows.push({
            doctorId: otherId,
            day,
            startMinute: 540,
            endMinute: 1020,
          });
        }
      }
    }
  }

  // Build doctors list
  const doctorIds = new Set(procedures.map((p) => p.allowedDoctorIds[0]));
  const doctors = [...doctorIds].map((id) => {
    // Look up name from SERVICE_DOCTOR_ID reverse map
    const serviceEntry = Object.entries(SERVICE_DOCTOR_ID).find(
      ([, did]) => did === id,
    );
    const serviceName = serviceEntry
      ? SERVICE_DISPLAY_NAMES[serviceEntry[0] as ClinicalService]
      : id;
    return { id, name: serviceName };
  });

  return {
    horizonDays: cappedHorizon,
    doctors,
    procedures,
    windows,
    slotMinutes: 30,
  };
}

/**
 * After scheduling succeeds, update sessions with their assigned slots
 * and commit the assignments.
 */
export function commitScheduleResult(
  planId: string,
  assignments: ScheduledAssignment[],
): void {
  const plan = carePlans.get(planId);
  if (!plan) return;

  plan.status = "scheduled";

  // Match assignments to sessions by procedureId pattern
  for (const assignment of assignments) {
    // Find the matching session
    for (const [, session] of sessions) {
      if (
        session.carePlanId === planId &&
        session.status === "pending" &&
        assignment.procedureId.startsWith(plan.service)
      ) {
        session.status = "scheduled";
        session.scheduledStartMinute = assignment.startMinute;
        session.scheduledEndMinute = assignment.endMinute;
        session.dayIndex = assignment.day;
        break; // One assignment per session
      }
    }
  }

  // Store committed assignments for future re-scheduling merges
  committedAssignments = [
    ...committedAssignments.filter(
      (a) => !a.procedureId.startsWith(plan.service),
    ),
    ...assignments,
  ];

  log.info("schedule_committed", {
    planId,
    assignmentsCount: assignments.length,
    totalCommitted: committedAssignments.length,
  });
}

/**
 * Marks a session as completed with an optional diary note.
 */
export function markSessionCompleted(
  sessionId: string,
  diaryNote?: string,
): Session | null {
  const session = sessions.get(sessionId);
  if (!session) {
    log.warn("session_not_found", { sessionId });
    return null;
  }

  session.status = "completed";
  if (diaryNote) session.diaryNote = diaryNote;

  // Check if all sessions in the plan are completed
  const plan = carePlans.get(session.carePlanId);
  if (plan) {
    const planSessions = getSessionsForPlan(session.carePlanId);
    const allCompleted = planSessions.every((s) => s.status === "completed");
    if (allCompleted) {
      plan.status = "completed";
      log.info("care_plan_completed", { planId: plan.id });
    } else {
      plan.status = "active";
    }
  }

  log.info("session_completed", {
    sessionId,
    carePlanId: session.carePlanId,
    sessionNumber: session.sessionNumber,
    diaryNote: diaryNote?.slice(0, 100),
  });

  return session;
}

/**
 * Returns active care plans for a patient.
 */
export function getActiveCarePlans(patientId: string): CarePlan[] {
  const result: CarePlan[] = [];
  for (const [, plan] of carePlans) {
    if (
      plan.patientId === patientId &&
      plan.status !== "completed" &&
      plan.status !== "draft"
    ) {
      result.push(plan);
    }
  }
  return result;
}

/** Returns all care plans (any status). */
export function getAllCarePlans(): CarePlan[] {
  return [...carePlans.values()];
}

/** Returns a specific CarePlan by ID. */
export function getCarePlan(planId: string): CarePlan | undefined {
  return carePlans.get(planId);
}

/** Returns all sessions for a CarePlan. */
export function getSessionsForPlan(planId: string): Session[] {
  const result: Session[] = [];
  for (const [, session] of sessions) {
    if (session.carePlanId === planId) {
      result.push(session);
    }
  }
  return result.sort((a, b) => a.sessionNumber - b.sessionNumber);
}

/** Returns sessions scheduled for a specific day. */
export function getSessionsForDay(dayIndex: number): Session[] {
  const result: Session[] = [];
  for (const [, session] of sessions) {
    if (session.dayIndex === dayIndex && session.status !== "skipped") {
      result.push(session);
    }
  }
  return result.sort(
    (a, b) => (a.scheduledStartMinute ?? 0) - (b.scheduledStartMinute ?? 0),
  );
}

/** Returns the next pending session for a service (for "я провел прием" logic). */
export function getNextPendingSession(
  service?: ClinicalService,
): Session | null {
  for (const [, session] of sessions) {
    if (
      session.status === "scheduled" &&
      (service === undefined || session.service === service)
    ) {
      return session;
    }
  }
  return null;
}

/** Returns committed assignments for services OTHER than the given one. */
function getCommittedForOtherServices(
  excludeService: ClinicalService,
): ScheduledAssignment[] {
  return committedAssignments.filter(
    (a) => !a.procedureId.startsWith(excludeService),
  );
}

/** Returns all committed assignments. */
export function getCommittedAssignments(): ScheduledAssignment[] {
  return [...committedAssignments];
}
