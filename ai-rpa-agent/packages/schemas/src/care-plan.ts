import { z } from "zod";
import { IsoTimestamp } from "./common.js";

// ------------------------------------------------------------------ //
// CarePlan + Session — clinical workflow entities                     //
//                                                                    //
// A CarePlan represents a treatment course (e.g. "10 sessions of     //
// speech therapy"). It is expanded into individual Session entities   //
// that are then scheduled via the CP-SAT backend.                    //
//                                                                    //
// Policy invariants:                                                  //
//   1. CarePlans are created ONLY by clinical decisions (assign       //
//      intent from doctor/specialist voice command).                   //
//   2. No schedule is written without explicit confirmation.          //
//   3. Sessions are scheduling units — not calendar entries until     //
//      the schedule is confirmed.                                     //
// ------------------------------------------------------------------ //

/** Service identifiers — must match mock-ui specialist types. */
export const ClinicalService = z.enum([
  "lfk",
  "massage",
  "psychologist",
  "speech_therapy",
  "physio",
]);
export type ClinicalService = z.infer<typeof ClinicalService>;

/** Human-readable labels for services (Russian). */
export const SERVICE_DISPLAY_NAMES: Readonly<Record<ClinicalService, string>> =
  Object.freeze({
    lfk: "Лечебная физкультура",
    massage: "Массаж лечебный",
    psychologist: "Консультация психолога",
    speech_therapy: "Логопедия",
    physio: "Физиотерапия",
  });

/** Default session duration per service (minutes). */
export const SERVICE_DEFAULT_DURATION: Readonly<
  Record<ClinicalService, number>
> = Object.freeze({
  lfk: 40,
  massage: 30,
  psychologist: 40,
  speech_therapy: 40,
  physio: 30,
});

/** Maps clinical service → scheduler doctor ID (from schedule-request-from-context). */
export const SERVICE_DOCTOR_ID: Readonly<Record<ClinicalService, string>> =
  Object.freeze({
    lfk: "lkf_1",
    massage: "massage_1",
    psychologist: "psych_1",
    speech_therapy: "speech_1",
    physio: "physio_1",
  });

export const CarePlanStatus = z.enum([
  "draft",
  "confirmed",
  "scheduled",
  "active",
  "completed",
]);
export type CarePlanStatus = z.infer<typeof CarePlanStatus>;

export const CarePlanConstraints = z.object({
  /** Maximum sessions per day for this service. */
  maxPerDay: z.number().int().positive().default(1),
  /** Minimum break between sessions of this type (minutes). */
  breakMinutes: z.number().int().nonnegative().default(0),
});
export type CarePlanConstraints = z.infer<typeof CarePlanConstraints>;

/**
 * A treatment course prescribed by a doctor or specialist.
 *
 * Created by an `assign` intent, expanded into {@link Session} entities
 * after confirmation, then scheduled via the CP-SAT backend.
 */
export const CarePlan = z.object({
  /** Unique plan identifier. */
  id: z.string().min(1),

  /** Patient this plan belongs to. */
  patientId: z.string().min(1),

  /** Clinical service type (maps to scheduler doctor/procedure). */
  service: ClinicalService,

  /** Number of sessions in the course. */
  sessionsCount: z.number().int().positive(),

  /** Duration of each session (minutes). */
  durationMinutes: z.number().int().positive(),

  /** Whether this is an initial (single) visit or a full course. */
  type: z.enum(["initial", "course"]),

  /** Lifecycle status. */
  status: CarePlanStatus,

  /** Who created this plan (role identifier). */
  createdBy: z.string().min(1),

  /** ISO-8601 creation timestamp. */
  createdAt: IsoTimestamp,

  /** Scheduling constraints. */
  constraints: CarePlanConstraints.optional(),
});
export type CarePlan = z.infer<typeof CarePlan>;

export const SessionStatus = z.enum([
  "pending",
  "scheduled",
  "completed",
  "skipped",
]);
export type SessionStatus = z.infer<typeof SessionStatus>;

/**
 * A single session within a {@link CarePlan}.
 *
 * Created during CarePlan expansion. Initially `pending`, then `scheduled`
 * after the CP-SAT solver places it, then `completed` when the specialist
 * marks it as done.
 */
export const Session = z.object({
  /** Unique session identifier. */
  id: z.string().min(1),

  /** Parent CarePlan. */
  carePlanId: z.string().min(1),

  /** Clinical service (denormalized from CarePlan for quick lookups). */
  service: ClinicalService,

  /** Day index in the planning horizon (0-based). */
  dayIndex: z.number().int().min(0),

  /** Session ordering within the plan (1-based). */
  sessionNumber: z.number().int().positive(),

  /** Lifecycle status. */
  status: SessionStatus,

  /** Scheduled start minute (set after CP-SAT assignment). */
  scheduledStartMinute: z.number().int().optional(),

  /** Scheduled end minute (set after CP-SAT assignment). */
  scheduledEndMinute: z.number().int().optional(),

  /** Diary note written on completion. */
  diaryNote: z.string().optional(),
});
export type Session = z.infer<typeof Session>;
