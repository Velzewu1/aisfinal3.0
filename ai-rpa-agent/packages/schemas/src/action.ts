import { z } from "zod";

/**
 * Deterministic commands that the executor (content script) can perform.
 * This is the ONLY surface the controller uses to drive the DOM.
 * Selectors are always expressed as approved data-* attributes.
 */

export const FillAction = z.object({
  kind: z.literal("fill"),
  field: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

/** @deprecated Reserved for future planner branches; not emitted today (`planner.ts` never produces `click`). Kept for executor + schema union stability. */
export const ClickAction = z.object({
  kind: z.literal("click"),
  action: z.string().min(1),
});

export const NavigateAction = z.object({
  kind: z.literal("navigate"),
  nav: z.string().min(1),
});

export const SetStatusAction = z.object({
  kind: z.literal("set_status"),
  entity: z.string().min(1),
  status: z.string().min(1),
});

/** One rendered slot in the host schedule grid (`day:start-end` minute encoding in `time`). */
export const InjectScheduleSlot = z.object({
  time: z.string().min(1),
  doctorId: z.string().min(1),
  procedureId: z.string().min(1),
  /** Base procedure display name (omit instance suffix like `lfk_d3`). */
  procedureName: z.string().min(1).optional(),
});
export type InjectScheduleSlot = z.infer<typeof InjectScheduleSlot>;

/**
 * Strict payload carried on `inject_schedule` actions (DOM / `CustomEvent` detail).
 *
 * Distinct from `ScheduleResult` in `./schedule.ts` (solver API). The planner maps that
 * API shape into this executor-facing object (`grid`, `slots`, optional `metadata`).
 */
export const ScheduleInjectPayload = z.object({
  grid: z.string().min(1),
  slots: z.array(InjectScheduleSlot),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type ScheduleInjectPayload = z.infer<typeof ScheduleInjectPayload>;

/** Stable alias for {@link ScheduleInjectPayload}. */
export const InjectSchedulePayload = ScheduleInjectPayload;
export type InjectSchedulePayload = ScheduleInjectPayload;

export const InjectScheduleAction = z.object({
  kind: z.literal("inject_schedule"),
  grid: z.string().min(1),
  payload: ScheduleInjectPayload,
});

export const DomAction = z.discriminatedUnion("kind", [
  FillAction,
  ClickAction,
  NavigateAction,
  SetStatusAction,
  InjectScheduleAction,
]);
export type DomAction = z.infer<typeof DomAction>;

export const ActionPlan = z.object({
  correlationId: z.string().min(1),
  actions: z.array(DomAction).min(1),
});
export type ActionPlan = z.infer<typeof ActionPlan>;

export const ExecutorResult = z.object({
  correlationId: z.string().min(1),
  ok: z.boolean(),
  executed: z.array(DomAction),
  failed: z
    .array(
      z.object({
        action: DomAction,
        error: z.string().min(1),
      }),
    )
    .default([]),
});
export type ExecutorResult = z.infer<typeof ExecutorResult>;
