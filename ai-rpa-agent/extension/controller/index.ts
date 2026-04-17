import type { AgentEvent, Intent, ScheduleResult } from "@ai-rpa/schemas";
import { ActionPlan, DomAction, LlmInterpretation } from "@ai-rpa/schemas";
import { createLogger } from "../shared/logger.js";
import { newCorrelationId, nowIso } from "../shared/correlation.js";
import type { MessageOf } from "../shared/messages.js";
import { decideAction } from "./decision.js";
import { planActions } from "./planner.js";
import { BackendClient } from "./backend-client.js";
import { attachContext } from "./context.js";
import { validateLlmOutput } from "./validate.js";
import { interpretUtterance } from "../llm/interpret.js";
import {
  preprocessAudio,
  transcribeAudio,
  normalizeUtterance,
  type NormalizedUtteranceEvent,
} from "../voice/index.js";
import type { TranscribedTextEvent } from "../voice/transcribe.js";
import type { VoiceCapturedEvent } from "../voice/recorder.js";
import { tryBuildScheduleRequestFromContext } from "./schedule-request-from-context.js";

const log = createLogger("controller");
const backend = new BackendClient();

// Policy allowlists. Zod enforces structural shape (non-empty strings);
// these enums enforce the controller-side allowlist that the LLM prompt
// narrates but cannot itself guarantee. Keep these in sync with
// `llm/interpret.ts` and `content/selectors.ts`.
const ALLOWED_NAV_TARGETS: ReadonlySet<string> = new Set([
  "primary_exam",
  "epicrisis",
  "schedule",
]);
const ALLOWED_STATUS_ENTITIES: ReadonlySet<string> = new Set([
  "primary_exam",
  "epicrisis",
]);
const ALLOWED_STATUSES: ReadonlySet<string> = new Set([
  "draft",
  "submitted",
  "final",
  "completed",
]);
const ALLOWED_FILL_FIELDS: ReadonlySet<string> = new Set([
  "complaints",
  "anamnesis",
  "objective_status",
  "treatment",
]);

function checkIntentPolicy(intent: Intent): string | null {
  if (intent.kind === "navigate") {
    if (!ALLOWED_NAV_TARGETS.has(intent.target)) {
      return `navigate_target:${intent.target}`;
    }
  }
  if (intent.kind === "set_status") {
    if (!ALLOWED_STATUS_ENTITIES.has(intent.entity)) {
      return `set_status_entity:${intent.entity}`;
    }
    if (!ALLOWED_STATUSES.has(intent.status)) {
      return `set_status_status:${intent.status}`;
    }
  }
  if (intent.kind === "fill") {
    for (const slot of intent.slots) {
      if (!ALLOWED_FILL_FIELDS.has(slot.field)) {
        return `fill_field:${slot.field}`;
      }
    }
  }
  return null;
}

interface PendingDecision {
  correlationId: string;
  interpretation: LlmInterpretation;
}

const pendingConfirmations = new Map<string, PendingDecision>();

async function emit(event: AgentEvent): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: "event", event });
  } catch (err: unknown) {
    log.warn("emit failed", String(err), event.correlationId);
  }
}

function makeEvent<T extends AgentEvent["type"]>(
  type: T,
  correlationId: string,
  payload: Extract<AgentEvent, { type: T }>["payload"],
): Extract<AgentEvent, { type: T }> {
  return {
    id: newCorrelationId(),
    type,
    correlationId,
    ts: nowIso(),
    payload,
  } as Extract<AgentEvent, { type: T }>;
}

async function dispatchExecution(correlationId: string, intent: Intent, scheduleResult?: ScheduleResult): Promise<void> {
  const actions = planActions(intent, correlationId, scheduleResult);
  if (actions.length === 0) {
    log.warn("no actions planned", { intentKind: intent.kind }, correlationId);
    return;
  }

  // Runtime gate at the decision -> execution boundary. TypeScript types
  // alone do not protect the executor from malformed plans; an explicit
  // `ActionPlan.safeParse` ensures no unvalidated payload reaches the
  // content script via `chrome.tabs.sendMessage`.
  const plan = ActionPlan.safeParse({ correlationId, actions });
  if (!plan.success) {
    const issues = plan.error.issues
      .slice(0, 10)
      .map((i) => `${i.path.join(".") || "<root>"}:${i.code}`);
    const errorToken = `action_plan_invalid:${issues.join(",") || "unknown"}`;
    log.error("action plan validation failed", { issues }, correlationId);
    for (const action of actions) {
      const single = DomAction.safeParse(action);
      if (single.success) {
        await emit(
          makeEvent("dom_action_failed", correlationId, {
            action: single.data,
            error: errorToken,
          }),
        );
      }
    }
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    log.warn("no active tab", undefined, correlationId);
    return;
  }

  await chrome.tabs.sendMessage(tab.id, {
    type: "execute_plan",
    correlationId: plan.data.correlationId,
    actions: plan.data.actions,
  });
}

async function readApiKey(): Promise<string | null> {
  try {
    const stored = await chrome.storage.local.get("OPENAI_API_KEY");
    const key = stored["OPENAI_API_KEY"];
    return typeof key === "string" && key.length > 0 ? key : null;
  } catch (err: unknown) {
    log.warn("storage read failed", String(err));
    return null;
  }
}

function truncateForEvent(raw: unknown): string | undefined {
  try {
    const s = typeof raw === "string" ? raw : JSON.stringify(raw);
    if (typeof s !== "string") return undefined;
    return s.length > 10_000 ? s.slice(0, 10_000) : s;
  } catch {
    return undefined;
  }
}

async function runFromUtterance(
  correlationId: string,
  text: string,
  transcribedDurationMs = 0,
): Promise<void> {
  // Step 4 (utterance normalization) runs only here: voice STT and typed text
  // share this path via `user_utterance`. `normalizeUtterance`
  // expects a `TranscribedTextEvent` shim.
  const transcribedShim: TranscribedTextEvent = Object.freeze({
    type: "transcribed_text",
    correlationId,
    timestamp: nowIso(),
    text,
    durationMs: transcribedDurationMs,
  });

  let normalized: NormalizedUtteranceEvent;
  try {
    normalized = normalizeUtterance(transcribedShim);
  } catch (err: unknown) {
    const token =
      err instanceof Error && err.message.length > 0 ? err.message : "normalize_failed";
    log.error("normalize failed", token, correlationId);
    await emit(
      makeEvent("validation_failed", correlationId, {
        errors: [token],
      }),
    );
    return;
  }

  const contextualized = attachContext(normalized);

  const apiKey = await readApiKey();
  if (!apiKey) {
    log.error("OPENAI_API_KEY missing in chrome.storage.local", undefined, correlationId);
    await emit(
      makeEvent("validation_failed", correlationId, {
        errors: ["llm_api_key_missing"],
      }),
    );
    return;
  }

  let raw: unknown;
  try {
    raw = await interpretUtterance(contextualized, { apiKey });
  } catch (err: unknown) {
    const token =
      err instanceof Error && err.message.length > 0 ? err.message : "llm_parse_error";
    log.error("llm interpret failed", token, correlationId);
    await emit(
      makeEvent("validation_failed", correlationId, {
        errors: [token],
      }),
    );
    return;
  }

  const validation = validateLlmOutput(raw, correlationId);
  if (!validation.ok) {
    await emit(
      makeEvent("validation_failed", correlationId, {
        errors: [validation.error],
        raw: truncateForEvent(raw),
      }),
    );
    return;
  }

  await runWithInterpretation(correlationId, validation.data);
}

async function runWithInterpretation(correlationId: string, interpretation: LlmInterpretation): Promise<void> {
  const { intent } = interpretation;

  const policyError = checkIntentPolicy(intent);
  if (policyError) {
    log.warn("intent rejected by policy", { policyError, intentKind: intent.kind }, correlationId);
    await emit(
      makeEvent("validation_failed", correlationId, {
        errors: ["out_of_policy_value", policyError],
      }),
    );
    return;
  }

  await emit(makeEvent("intent_parsed", correlationId, { interpretation }));
  await emit(makeEvent("validation_passed", correlationId, { schemaVersion: interpretation.schemaVersion }));

  const decision = decideAction(interpretation, correlationId);

  log.info(
    "step9_decision",
    {
      kind: decision.kind,
      reason: decision.reason,
      confidence: decision.confidence,
      source: "step9_decision",
    },
    correlationId,
  );

  await emit(
    makeEvent("decision_made", correlationId, {
      decision: decision.kind,
      confidence: decision.confidence,
      reason: decision.reason,
    }),
  );

  if (decision.kind === "reject") {
    log.info("rejected", { reason: decision.reason }, correlationId);
    return;
  }

  if (decision.kind === "confirm") {
    pendingConfirmations.set(correlationId, { correlationId, interpretation });
    await emit(
      makeEvent("user_confirmation_requested", correlationId, {
        summary: `Confirm ${intent.kind} (${decision.reason})`,
      }),
    );
    return;
  }

  if (intent.kind === "schedule") {
    await emit(makeEvent("schedule_requested", correlationId, { request: intent.request }));
    try {
      const result = await backend.schedule(intent.request, correlationId);
      if (result === null) {
        log.warn("schedule unavailable; skipping injection", undefined, correlationId);
        return;
      }
      await emit(makeEvent("schedule_generated", correlationId, { result }));
      await dispatchExecution(correlationId, intent, result);
    } catch (err: unknown) {
      log.error("schedule failed", String(err), correlationId);
    }
    return;
  }

  await dispatchExecution(correlationId, intent);
}

function voiceMessageToCapture(
  correlationId: string,
  audio: MessageOf<"voice_captured">["audio"],
): VoiceCapturedEvent {
  return Object.freeze({
    type: "voice_captured",
    timestamp: Date.now(),
    correlationId,
    audioBlob: new Blob([audio.data], { type: audio.mimeType }),
    mimeType: audio.mimeType,
    durationMs: audio.durationMs,
  });
}

export const controller = {
  async onInput(msg: MessageOf<"voice_captured"> | MessageOf<"user_utterance">): Promise<unknown> {
    const { correlationId } = msg;

    if (msg.type === "voice_captured") {
      await emit(
        makeEvent("voice_captured", correlationId, {
          durationMs: msg.audio.durationMs,
          mimeType: msg.audio.mimeType,
          sizeBytes: msg.audio.sizeBytes,
        }),
      );
      log.info("input received", { type: msg.type }, correlationId);

      const apiKey = await readApiKey();
      if (!apiKey) {
        return {
          accepted: false,
          step: "config" as const,
          error:
            "OPENAI_API_KEY missing in chrome.storage.local; run chrome.storage.local.set({ OPENAI_API_KEY: 'sk-...' })",
        };
      }

      const capture = voiceMessageToCapture(correlationId, msg.audio);

      let preprocessed;
      try {
        preprocessed = await preprocessAudio(capture);
      } catch (err: unknown) {
        log.error("audio preprocess failed", String(err), correlationId);
        return { accepted: false, step: "preprocess" as const, error: String(err) };
      }

      let transcribed;
      try {
        transcribed = await transcribeAudio(preprocessed, { apiKey });
      } catch (err: unknown) {
        log.error("transcription failed", String(err), correlationId);
        return { accepted: false, step: "transcribe" as const, error: String(err) };
      }

      return { accepted: true, text: transcribed.text, durationMs: transcribed.durationMs };
    }

    log.info("input received", { type: msg.type, chars: msg.text.length }, correlationId);
    try {
      await runFromUtterance(correlationId, msg.text, msg.transcribedDurationMs ?? 0);
    } catch (err: unknown) {
      log.error("pipeline failed", String(err), correlationId);
    }
    return { accepted: true };
  },

  async onInterpretation(msg: MessageOf<"llm_interpretation">): Promise<unknown> {
    await runWithInterpretation(msg.correlationId, msg.interpretation);
    return { accepted: true };
  },

  /**
   * System path: validated UI/session context → deterministic `ScheduleRequest`
   * → same decision + backend + executor chain as LLM-produced schedule intents.
   */
  async onScheduleFromContext(
    msg: MessageOf<"schedule_from_context">,
  ): Promise<{ ok: boolean; error?: string }> {
    const built = tryBuildScheduleRequestFromContext(msg.context, msg.build);
    if (!built.ok) {
      await emit(
        makeEvent("validation_failed", msg.correlationId, {
          errors: [built.error],
        }),
      );
      return { ok: false, error: built.error };
    }

    const interpretation = LlmInterpretation.safeParse({
      schemaVersion: "1.0.0",
      intent: { kind: "schedule", request: built.request },
      confidence: 1,
    });

    if (!interpretation.success) {
      const issues = interpretation.error.issues
        .slice(0, 10)
        .map((i) => `${i.path.join(".") || "<root>"}:${i.code}`);
      await emit(
        makeEvent("validation_failed", msg.correlationId, {
          errors: issues.length > 0 ? issues : ["interpretation_parse_failed"],
        }),
      );
      return { ok: false, error: "interpretation_parse_failed" };
    }

    try {
      await runWithInterpretation(msg.correlationId, interpretation.data);
    } catch (err: unknown) {
      log.error("schedule_from_context pipeline failed", String(err), msg.correlationId);
      return { ok: false, error: String(err) };
    }
    return { ok: true };
  },

  async onUserConfirmation(msg: MessageOf<"user_confirmation">): Promise<unknown> {
    await emit(
      makeEvent("user_confirmation_received", msg.correlationId, {
        accepted: msg.accepted,
      }),
    );
    const pending = pendingConfirmations.get(msg.correlationId);
    pendingConfirmations.delete(msg.correlationId);
    if (!pending || !msg.accepted) return { executed: false };

    const { intent } = pending.interpretation;
    if (intent.kind === "schedule") {
      await emit(makeEvent("schedule_requested", msg.correlationId, { request: intent.request }));
      try {
        const result = await backend.schedule(intent.request, msg.correlationId);
        if (result === null) {
          log.warn(
            "confirmed schedule unavailable; skipping injection",
            undefined,
            msg.correlationId,
          );
        } else {
          await emit(makeEvent("schedule_generated", msg.correlationId, { result }));
          await dispatchExecution(msg.correlationId, intent, result);
        }
      } catch (err: unknown) {
        log.error("confirmed schedule failed", String(err), msg.correlationId);
      }
    } else {
      await dispatchExecution(msg.correlationId, intent);
    }
    return { executed: true };
  },

  async onExecutorFinished(msg: MessageOf<"executor_finished">): Promise<unknown> {
    for (const action of msg.result.executed) {
      await emit(makeEvent("dom_action_executed", msg.correlationId, { action, result: msg.result }));
    }
    for (const { action, error } of msg.result.failed) {
      await emit(makeEvent("dom_action_failed", msg.correlationId, { action, error }));
    }
    return { recorded: true };
  },
};
