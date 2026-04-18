import type { AgentEvent, DomAction, ExecutorResult, LlmInterpretation } from "@ai-rpa/schemas";
import type { PageFieldDescriptor } from "../controller/context.js";
import type { ScheduleRequestBuildInput } from "../controller/schedule-request-from-context.js";

/**
 * Message bus shape used between modules.
 *
 * Flow:
 *   voice  -> background  (VoiceCaptured)
 *   sidepanel -> background (UserConfirmation)
 *   background -> controller (routed internally)
 *   controller -> content (ExecutePlan)
 *   content   -> background (ExecutorFinished)
 *
 * The LLM module and backend clients are invoked from the controller only.
 */

export type ExtensionMessage =
  | {
      type: "voice_captured";
      correlationId: string;
      audio: { mimeType: string; sizeBytes: number; durationMs: number; data: ArrayBuffer };
      /** When set (e.g. content-tab path), controller decodes this instead of relying on `audio.data` (MV3 clone quirks). */
      base64?: string;
      /** MIME for decoded `base64` payload; falls back to `audio.mimeType`. */
      mimeType?: string;
    }
  | { type: "user_utterance"; correlationId: string; text: string; transcribedDurationMs?: number }
  | { type: "llm_interpretation"; correlationId: string; interpretation: LlmInterpretation }
  | { type: "execute_plan"; correlationId: string; actions: DomAction[] }
  | { type: "executor_finished"; correlationId: string; result: ExecutorResult }
  | { type: "user_confirmation"; correlationId: string; accepted: boolean }
  | {
      type: "schedule_from_context";
      correlationId: string;
      context: {
        currentPage: string;
        activeForm?: string;
        patientId?: string;
        patientName?: string;
        availableFields?: readonly PageFieldDescriptor[];
      };
      build?: ScheduleRequestBuildInput;
    }
  | { type: "auto_schedule"; correlationId: string }
  | { type: "event"; event: AgentEvent };

export type MessageOf<T extends ExtensionMessage["type"]> = Extract<ExtensionMessage, { type: T }>;

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as { type: unknown }).type === "string"
  );
}
