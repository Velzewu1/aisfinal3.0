import type { AgentEvent, Intent, LlmInterpretation, ScheduleResult } from "@ai-rpa/schemas";
import { createLogger } from "../shared/logger.js";
import { newCorrelationId, nowIso } from "../shared/correlation.js";
import type { MessageOf } from "../shared/messages.js";
import { decide, isHighRisk } from "./confidence.js";
import { planActions } from "./planner.js";
import { BackendClient } from "./backend-client.js";

const log = createLogger("controller");
const backend = new BackendClient();

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
  const actions = planActions(intent, scheduleResult);
  if (actions.length === 0) {
    log.warn("no actions planned", { intentKind: intent.kind }, correlationId);
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    log.warn("no active tab", undefined, correlationId);
    return;
  }

  await chrome.tabs.sendMessage(tab.id, { type: "execute_plan", correlationId, actions });
}

async function runWithInterpretation(correlationId: string, interpretation: LlmInterpretation): Promise<void> {
  await emit(makeEvent("intent_parsed", correlationId, { interpretation }));
  await emit(makeEvent("validation_passed", correlationId, { schemaVersion: interpretation.schemaVersion }));

  const { intent, confidence } = interpretation;
  const decision = decide({
    intentKind: intent.kind,
    confidence,
    highRisk: isHighRisk(intent.kind),
  });

  await emit(
    makeEvent("decision_made", correlationId, {
      decision: decision.kind,
      confidence,
      reason: decision.kind !== "execute" ? decision.reason : undefined,
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
      await emit(makeEvent("schedule_generated", correlationId, { result }));
      await dispatchExecution(correlationId, intent, result);
    } catch (err: unknown) {
      log.error("schedule failed", String(err), correlationId);
    }
    return;
  }

  await dispatchExecution(correlationId, intent);
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
    }
    log.info("input received", { type: msg.type }, correlationId);
    return { accepted: true };
  },

  async onInterpretation(msg: MessageOf<"llm_interpretation">): Promise<unknown> {
    await runWithInterpretation(msg.correlationId, msg.interpretation);
    return { accepted: true };
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
      try {
        const result = await backend.schedule(intent.request, msg.correlationId);
        await emit(makeEvent("schedule_generated", msg.correlationId, { result }));
        await dispatchExecution(msg.correlationId, intent, result);
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
