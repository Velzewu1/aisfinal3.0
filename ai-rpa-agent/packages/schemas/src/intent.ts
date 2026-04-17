import { z } from "zod";
import { Confidence } from "./common.js";
import { ScheduleRequest } from "./schedule.js";

export const IntentKind = z.enum([
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

export const Intent = z.discriminatedUnion("kind", [
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
