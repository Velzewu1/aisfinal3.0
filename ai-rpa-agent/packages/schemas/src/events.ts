import { z } from "zod";
import { CorrelationId, IsoTimestamp } from "./common.js";
import { LlmInterpretation } from "./intent.js";
import { DomAction, ExecutorResult } from "./action.js";
import { ScheduleRequest, ScheduleResult } from "./schedule.js";
import { ClinicalService, CarePlanStatus, SessionStatus } from "./care-plan.js";

/**
 * `AgentEvent.type` values map to the agent loop in `docs/02_agent_loop.md`.
 * Primary emitters (extension):
 * - Step 1 `voice_captured` — sidepanel → background (`controller/index` mirrors on ingest).
 * - Step 2 `audio_preprocessed` — `extension/voice/preprocess.ts`.
 * - Step 3 `text_transcribed` (+ legacy `speech_to_text_completed`) — `extension/voice/transcribe.ts`.
 * - Step 4 `text_normalized` (+ legacy `utterance_normalized`) — `extension/voice/normalize.ts` (typed + voice text paths via `runFromUtterance`).
 * - Step 5 `context_attached` — `extension/controller/context.ts`.
 * - Step 8 `confidence_evaluated` — `extension/controller/confidence.ts`.
 * - Step 11 `action_plan_created` — `extension/controller/planner.ts`.
 */
export const EventType = z.enum([
  "voice_captured",
  "audio_preprocessed",
  "speech_to_text_completed",
  "text_transcribed",
  "utterance_normalized",
  "text_normalized",
  "context_attached",
  "intent_parsed",
  "validation_passed",
  "validation_failed",
  "confidence_evaluated",
  "decision_made",
  "action_plan_created",
  "dom_action_executed",
  "dom_action_failed",
  "schedule_requested",
  "schedule_generated",
  "user_confirmation_requested",
  "user_confirmation_received",
  "care_plan_created",
  "care_plan_confirmed",
  "care_plan_expanded",
  "session_completed",
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

export const AudioPreprocessedEvent = BaseEvent.extend({
  type: z.literal("audio_preprocessed"),
  payload: z.object({
    durationMs: z.number().int().nonnegative(),
    mimeType: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    sampleRateHint: z.number().int().positive().optional(),
  }),
});

const SpeechToTextPayload = z.object({
  chars: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  language: z.string().min(1).optional(),
});

export const SpeechToTextCompletedEvent = BaseEvent.extend({
  type: z.literal("speech_to_text_completed"),
  payload: SpeechToTextPayload,
});

/** Canonical step-3 perception event; same payload as `speech_to_text_completed`. */
export const TextTranscribedEvent = BaseEvent.extend({
  type: z.literal("text_transcribed"),
  payload: SpeechToTextPayload,
});

const UtteranceNormalizedPayload = z.object({
  rawChars: z.number().int().nonnegative(),
  normalizedChars: z.number().int().nonnegative(),
  detectedLanguage: z.string().min(1).optional(),
});

export const UtteranceNormalizedEvent = BaseEvent.extend({
  type: z.literal("utterance_normalized"),
  payload: UtteranceNormalizedPayload,
});

/** Canonical step-4 perception event; same payload as `utterance_normalized`. */
export const TextNormalizedEvent = BaseEvent.extend({
  type: z.literal("text_normalized"),
  payload: UtteranceNormalizedPayload,
});

export const ContextAttachedEvent = BaseEvent.extend({
  type: z.literal("context_attached"),
  payload: z.object({
    currentPage: z.string().min(1),
    activeForm: z.string().min(1).optional(),
    patientId: z.string().min(1).optional(),
    patientName: z.string().min(1).optional(),
    reusableAssetsUsed: z.array(z.string()).optional(),
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

export const ConfidenceEvaluatedEvent = BaseEvent.extend({
  type: z.literal("confidence_evaluated"),
  payload: z.object({
    score: z.number().min(0).max(1),
    level: z.enum(["high", "medium", "low"]),
    requiresConfirmation: z.boolean(),
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

export const ActionPlanCreatedEvent = BaseEvent.extend({
  type: z.literal("action_plan_created"),
  payload: z.object({
    intentKind: z.string().min(1),
    actionCount: z.number().int().nonnegative(),
    actionKinds: z.array(z.string().min(1)),
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
    /** When present, the confirmation is a draft preview for a fill intent. */
    draftFields: z
      .array(
        z.object({
          field: z.string().min(1),
          label: z.string().min(1).optional(),
          value: z.string(),
        }),
      )
      .optional(),
    /** Intent kind that produced the draft (e.g. "fill", "set_status"). */
    intentKind: z.string().min(1).optional(),
  }),
});

export const UserConfirmationReceivedEvent = BaseEvent.extend({
  type: z.literal("user_confirmation_received"),
  payload: z.object({
    accepted: z.boolean(),
  }),
});

/** Emitted when a CarePlan is created from an assign intent (before confirmation). */
export const CarePlanCreatedEvent = BaseEvent.extend({
  type: z.literal("care_plan_created"),
  payload: z.object({
    planId: z.string().min(1),
    service: ClinicalService,
    type: z.enum(["initial", "course"]),
    sessionsCount: z.number().int().positive(),
    durationMinutes: z.number().int().positive(),
    status: CarePlanStatus,
    patientId: z.string().optional(),
  }),
});

/**
 * Emitted when a doctor confirms a draft CarePlan.
 *
 * SEPARATION OF CONCERNS:
 *   `assign` is a CLINICAL DECISION in the data layer. Confirmation
 *   persists the CarePlan and STOPS. No ActionPlan, no DOM actions,
 *   no scheduler invocation may follow this event in the same turn.
 *   Scheduling is a distinct `build_schedule` intent handled by the
 *   planning layer.
 */
export const CarePlanConfirmedEvent = BaseEvent.extend({
  type: z.literal("care_plan_confirmed"),
  payload: z.object({
    planId: z.string().min(1),
    service: ClinicalService,
    type: z.enum(["initial", "course"]),
    sessionsCount: z.number().int().positive(),
    durationMinutes: z.number().int().positive(),
    status: CarePlanStatus,
    patientId: z.string().optional(),
  }),
});

/** Emitted when a confirmed CarePlan is expanded into sessions. */
export const CarePlanExpandedEvent = BaseEvent.extend({
  type: z.literal("care_plan_expanded"),
  payload: z.object({
    planId: z.string().min(1),
    sessionsCount: z.number().int().positive(),
    service: ClinicalService,
  }),
});

/** Emitted when a specialist marks a session as completed. */
export const SessionCompletedEvent = BaseEvent.extend({
  type: z.literal("session_completed"),
  payload: z.object({
    sessionId: z.string().min(1),
    carePlanId: z.string().min(1),
    service: ClinicalService,
    sessionNumber: z.number().int().positive(),
    totalSessions: z.number().int().positive(),
    status: SessionStatus,
    diaryNote: z.string().optional(),
  }),
});

export const AgentEvent = z.discriminatedUnion("type", [
  VoiceCapturedEvent,
  AudioPreprocessedEvent,
  SpeechToTextCompletedEvent,
  TextTranscribedEvent,
  UtteranceNormalizedEvent,
  TextNormalizedEvent,
  ContextAttachedEvent,
  IntentParsedEvent,
  ValidationPassedEvent,
  ValidationFailedEvent,
  ConfidenceEvaluatedEvent,
  DecisionMadeEvent,
  ActionPlanCreatedEvent,
  DomActionExecutedEvent,
  DomActionFailedEvent,
  ScheduleRequestedEvent,
  ScheduleGeneratedEvent,
  UserConfirmationRequestedEvent,
  UserConfirmationReceivedEvent,
  CarePlanCreatedEvent,
  CarePlanConfirmedEvent,
  CarePlanExpandedEvent,
  SessionCompletedEvent,
]);
export type AgentEvent = z.infer<typeof AgentEvent>;
