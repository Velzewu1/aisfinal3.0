import { createLogger } from "../shared/logger.js";
import type { ExtensionMessage } from "../shared/messages.js";
import { controller } from "../controller/index.js";

const log = createLogger("router");

/**
 * Message router.
 *
 * The router NEVER mutates DOM and NEVER talks to the LLM directly.
 * Its only job is to route typed messages to the correct trusted layer.
 */
export const router = {
  async dispatch(msg: ExtensionMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
    switch (msg.type) {
      case "voice_captured":
      case "user_utterance":
        return controller.onInput(msg);

      case "llm_interpretation":
        return controller.onInterpretation(msg);

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
