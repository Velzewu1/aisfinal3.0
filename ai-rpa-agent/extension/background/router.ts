import type { AgentEvent } from "@ai-rpa/schemas";
import { LlmInterpretation } from "@ai-rpa/schemas";
import { createLogger } from "../shared/logger.js";
import type { ExtensionMessage } from "../shared/messages.js";
import { controller } from "../controller/index.js";
import { newCorrelationId } from "../shared/correlation.js";

const log = createLogger("router");

const MAX_LOGGED_ISSUES = 10;

/**
 * Use callback `chrome.tabs.query` (not async/await) so the active tab is
 * resolved reliably in the service worker.
 */
async function sendToContentScript(tabId: number, message: unknown, retries = 3): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      await chrome.tabs.sendMessage(tabId, message);
      return;
    } catch (e: unknown) {
      if (i === retries - 1) {
        throw e instanceof Error ? e : new Error(String(e));
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}

export function recordingStartFromSidepanel(correlationId: string): Promise<{ started: true }> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) {
        log.error("no active tab found for mic recording");
        reject(new Error("no_active_tab"));
        return;
      }
      void sendToContentScript(tab.id, { type: "start_mic_recording", correlationId })
        .then(() => resolve({ started: true }))
        .catch((e: unknown) => {
          log.error("mic message failed", String(e));
          reject(e instanceof Error ? e : new Error(String(e)));
        });
    });
  });
}

export function recordingStopFromSidepanel(correlationId: string): Promise<{ stopped: true }> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) {
        log.error("no active tab found for mic recording");
        reject(new Error("no_active_tab"));
        return;
      }
      void sendToContentScript(tab.id, { type: "stop_mic_recording", correlationId })
        .then(() => resolve({ stopped: true }))
        .catch((e: unknown) => {
          log.error("mic message failed", String(e));
          reject(e instanceof Error ? e : new Error(String(e)));
        });
    });
  });
}

export function continuousStartFromSidepanel(sessionId: string): Promise<{ started: true }> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) {
        log.error("no active tab found for continuous mic");
        reject(new Error("no_active_tab"));
        return;
      }
      void sendToContentScript(tab.id, { type: "start_continuous_mic", sessionId })
        .then(() => resolve({ started: true }))
        .catch((e: unknown) => {
          log.error("continuous mic start failed", String(e));
          reject(e instanceof Error ? e : new Error(String(e)));
        });
    });
  });
}

export function continuousStopFromSidepanel(sessionId: string): Promise<{ stopped: true }> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) {
        log.error("no active tab found for continuous mic");
        reject(new Error("no_active_tab"));
        return;
      }
      void sendToContentScript(tab.id, { type: "stop_continuous_mic", sessionId })
        .then(() => resolve({ stopped: true }))
        .catch((e: unknown) => {
          log.error("continuous mic stop failed", String(e));
          reject(e instanceof Error ? e : new Error(String(e)));
        });
    });
  });
}

export async function forwardAudioChunkToSidepanel(correlationId: string, chunk: string): Promise<void> {
  await chrome.runtime
    .sendMessage({
      type: "audio_chunk_forward",
      correlationId,
      chunk,
    })
    .catch(() => {});
}

/**
 * Relays content-script `audio_complete` to the side panel: forwards base64 and
 * metadata as-is (no mutation) so the panel can rebuild the Blob for `voice_captured`.
 */
export async function relayAudioCompleteFromContent(msg: {
  correlationId: string;
  mimeType: string;
  startedAt: number;
  base64: string;
  sessionId?: string;
}): Promise<void> {
  await chrome.runtime
    .sendMessage({
      type: "audio_complete_forward",
      correlationId: msg.correlationId,
      mimeType: msg.mimeType,
      startedAt: msg.startedAt,
      base64: msg.base64,
      ...(typeof msg.sessionId === "string" && msg.sessionId.length > 0
        ? { sessionId: msg.sessionId }
        : {}),
    })
    .catch(() => {});
}

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
            ts: new Date().toISOString(),
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

      case "schedule_from_context":
        return controller.onScheduleFromContext(msg);

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
