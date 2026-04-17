import { z } from "zod";
import { CorrelationId, IsoTimestamp } from "./common.js";
import { LlmInterpretation } from "./intent.js";
import { DomAction, ExecutorResult } from "./action.js";
import { ScheduleRequest, ScheduleResult } from "./schedule.js";

export const EventType = z.enum([
  "voice_captured",
  "intent_parsed",
  "validation_passed",
  "validation_failed",
  "decision_made",
  "dom_action_executed",
  "dom_action_failed",
  "schedule_requested",
  "schedule_generated",
  "user_confirmation_requested",
  "user_confirmation_received",
]);
export type EventType = z.infer<typeof EventType>;

const BaseEvent = z.object({
  id: z.string().min(1),
  correlationId: CorrelationId,
  ts: IsoTimestamp,
});

export const VoiceCapturedEvent = BaseEvent.extend({
  type: z.literal("voice_captured"),
  payload: z.object({
    durationMs: z.number().int().nonnegative(),
    mimeType: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
  }),
});

export const IntentParsedEvent = BaseEvent.extend({
  type: z.literal("intent_parsed"),
  payload: z.object({
    interpretation: LlmInterpretation,
  }),
});

export const ValidationPassedEvent = BaseEvent.extend({
  type: z.literal("validation_passed"),
  payload: z.object({
    schemaVersion: z.string().min(1),
  }),
});

export const ValidationFailedEvent = BaseEvent.extend({
  type: z.literal("validation_failed"),
  payload: z.object({
    errors: z.array(z.string().min(1)),
    raw: z.string().max(10_000).optional(),
  }),
});

export const DecisionMadeEvent = BaseEvent.extend({
  type: z.literal("decision_made"),
  payload: z.object({
    decision: z.enum(["execute", "confirm", "reject"]),
    confidence: z.number().min(0).max(1),
    reason: z.string().min(1).optional(),
  }),
});

export const DomActionExecutedEvent = BaseEvent.extend({
  type: z.literal("dom_action_executed"),
  payload: z.object({
    action: DomAction,
    result: ExecutorResult,
  }),
});

export const DomActionFailedEvent = BaseEvent.extend({
  type: z.literal("dom_action_failed"),
  payload: z.object({
    action: DomAction,
    error: z.string().min(1),
  }),
});

export const ScheduleRequestedEvent = BaseEvent.extend({
  type: z.literal("schedule_requested"),
  payload: z.object({
    request: ScheduleRequest,
  }),
});

export const ScheduleGeneratedEvent = BaseEvent.extend({
  type: z.literal("schedule_generated"),
  payload: z.object({
    result: ScheduleResult,
  }),
});

export const UserConfirmationRequestedEvent = BaseEvent.extend({
  type: z.literal("user_confirmation_requested"),
  payload: z.object({
    summary: z.string().min(1),
  }),
});

export const UserConfirmationReceivedEvent = BaseEvent.extend({
  type: z.literal("user_confirmation_received"),
  payload: z.object({
    accepted: z.boolean(),
  }),
});

export const AgentEvent = z.discriminatedUnion("type", [
  VoiceCapturedEvent,
  IntentParsedEvent,
  ValidationPassedEvent,
  ValidationFailedEvent,
  DecisionMadeEvent,
  DomActionExecutedEvent,
  DomActionFailedEvent,
  ScheduleRequestedEvent,
  ScheduleGeneratedEvent,
  UserConfirmationRequestedEvent,
  UserConfirmationReceivedEvent,
]);
export type AgentEvent = z.infer<typeof AgentEvent>;
