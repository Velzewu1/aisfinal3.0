import type { AgentEvent } from "@ai-rpa/schemas";
import { LlmInterpretation } from "@ai-rpa/schemas";
import { createLogger } from "../shared/logger.js";
import type { ExtensionMessage } from "../shared/messages.js";
import { controller } from "../controller/index.js";
import { newCorrelationId, nowIso } from "../shared/correlation.js";

const log = createLogger("router");

const MAX_LOGGED_ISSUES = 10;

async function emitEvent(event: AgentEvent): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: "event", event });
  } catch (err: unknown) {
    log.warn("emit failed", String(err), event.correlationId);
  }
}

/**
 * Message router.
 *
 * The router NEVER mutates DOM and NEVER talks to the LLM directly.
 * Its only job is to route typed messages to the correct trusted layer.
 *
 * Trust boundary: `llm_interpretation` messages are re-validated at
 * runtime with `LlmInterpretation.safeParse` before being handed to the
 * controller. TypeScript types alone are insufficient here because this
 * message can be injected from any runtime sender (sidepanel, tests,
 * devtools) and must not be trusted to skip Step 7 validation.
 */
export const router = {
  async dispatch(msg: ExtensionMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
    switch (msg.type) {
      case "voice_captured":
      case "user_utterance":
        return controller.onInput(msg);

      case "llm_interpretation": {
        const parsed = LlmInterpretation.safeParse(msg.interpretation);
        if (!parsed.success) {
          const issues = parsed.error.issues
            .slice(0, MAX_LOGGED_ISSUES)
            .map((i) => `${i.path.join(".") || "<root>"}:${i.code}`);
          log.warn("inbound llm_interpretation rejected", { issues }, msg.correlationId);
          await emitEvent({
            id: newCorrelationId(),
            type: "validation_failed",
            correlationId: msg.correlationId,
            ts: nowIso(),
            payload: {
              errors: issues.length > 0 ? issues : ["validation_failed"],
            },
          });
          return { accepted: false, error: "validation_failed" };
        }
        return controller.onInterpretation({
          type: "llm_interpretation",
          correlationId: msg.correlationId,
          interpretation: parsed.data,
        });
      }

      case "user_confirmation":
        return controller.onUserConfirmation(msg);

      case "executor_finished":
        return controller.onExecutorFinished(msg);

      case "execute_plan":
        log.warn("execute_plan received at background; ignoring (executor owns DOM)", {
          correlationId: msg.correlationId,
        });
        return { ignored: true };

      case "event":
        return { forwarded: true };

      default: {
        const _exhaustive: never = msg;
        void _exhaustive;
        void sender;
        return { error: "unknown_message_type" };
      }
    }
  },
};
