import { z } from "zod";
import { Confidence } from "./common.js";
import { ScheduleRequest } from "./schedule.js";
import { ClinicalService } from "./care-plan.js";

export const IntentKind = z.enum([
  "assign",
  "build_schedule",
  "fill",
  "navigate",
  "schedule",
  "set_status",
  "unknown",
]);
export type IntentKind = z.infer<typeof IntentKind>;

export const FillSlot = z.object({
  field: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]),
});
export type FillSlot = z.infer<typeof FillSlot>;

export const FillIntent = z.object({
  kind: z.literal("fill"),
  slots: z.array(FillSlot).min(1),
});

export const NavigateIntent = z.object({
  kind: z.literal("navigate"),
  target: z.string().min(1),
  /**
   * Optional patient selector. When present, the planner emits an
   * `open_patient` DomAction (fuzzy match on the patient-list page)
   * instead of a `navigate` action; the page's own row click handler
   * performs the URL change, preserving the deterministic boundary.
   */
  patientQuery: z.string().min(1).optional(),
});

export const ScheduleIntent = z.object({
  kind: z.literal("schedule"),
  request: ScheduleRequest,
});

export const SetStatusIntent = z.object({
  kind: z.literal("set_status"),
  entity: z.string().min(1),
  status: z.string().min(1),
});

export const UnknownIntent = z.object({
  kind: z.literal("unknown"),
  reason: z.string().min(1).optional(),
});

/**
 * Clinical assignment intent: referral to specialist (initial) or
 * treatment course prescription (course with sessionsCount).
 *
 * Created by primary doctor ("Назначь логопеда") or specialist
 * ("Назначить логопеда на 10 дней"). The controller uses this to
 * create a CarePlan, NOT to directly manipulate the schedule.
 */
export const AssignIntent = z.object({
  kind: z.literal("assign"),
  /** Clinical service type. */
  service: ClinicalService,
  /** Single referral vs multi-session treatment course. */
  type: z.enum(["initial", "course"]),
  /** Number of sessions (required for "course", default 1 for "initial"). */
  sessionsCount: z.number().int().positive().optional(),
  /** Session duration override (minutes); defaults from SERVICE_DEFAULT_DURATION. */
  durationMinutes: z.number().int().positive().optional(),
});
export type AssignIntent = z.infer<typeof AssignIntent>;

/**
 * Logistics-only intent: schedule what's been assigned.
 *
 * Triggered by "составь расписание", "разложи по дням", "запланируй курс".
 * The controller finds all confirmed CarePlans and expands them into
 * a conflict-aware schedule via the CP-SAT backend.
 *
 * MUST NOT be confused with AssignIntent — build_schedule never creates
 * a CarePlan, only consumes confirmed ones.
 */
export const BuildScheduleIntent = z.object({
  kind: z.literal("build_schedule"),
});
export type BuildScheduleIntent = z.infer<typeof BuildScheduleIntent>;

export const Intent = z.discriminatedUnion("kind", [
  AssignIntent,
  BuildScheduleIntent,
  FillIntent,
  NavigateIntent,
  ScheduleIntent,
  SetStatusIntent,
  UnknownIntent,
]);
export type Intent = z.infer<typeof Intent>;

/**
 * The exact contract the LLM must return.
 * If JSON fails this schema, the controller MUST reject and retry/clarify.
 */
export const LlmInterpretation = z.object({
  schemaVersion: z.literal("1.0.0"),
  intent: Intent,
  confidence: Confidence,
  rationale: z.string().max(2000).optional(),
});
export type LlmInterpretation = z.infer<typeof LlmInterpretation>;
