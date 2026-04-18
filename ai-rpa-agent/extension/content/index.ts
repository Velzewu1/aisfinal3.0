import type { DomAction, ExecutorResult } from "@ai-rpa/schemas";
import { createLogger } from "../shared/logger.js";
import { isExtensionMessage } from "../shared/messages.js";
import { executor } from "./executor.js";
import { injectNavigateToScheduleEvent } from "./navigate-bridge.js";
import { initMicRecorder } from "./recorder.js";

const log = createLogger("content");

function isNavigateToScheduleMessage(msg: unknown): msg is { type: "navigate_to_schedule" } {
  return typeof msg === "object" && msg !== null && (msg as { type?: unknown }).type === "navigate_to_schedule";
}

chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  if (isNavigateToScheduleMessage(msg)) {
    injectNavigateToScheduleEvent();
    sendResponse({ ok: true });
    return true;
  }
  if (!isExtensionMessage(msg)) return false;
  if (msg.type !== "execute_plan") return false;

  const { correlationId, actions } = msg;
  log.info("execute_plan received", { count: actions.length }, correlationId);

  void executor
    .run(actions, correlationId)
    .then((result: ExecutorResult) => {
      chrome.runtime
        .sendMessage({ type: "executor_finished", correlationId, result })
        .catch((err: unknown) => log.error("reply failed", String(err), correlationId));
      sendResponse({ ok: true, result });
    })
    .catch((err: Error) => {
      log.error("executor run failed", err.message);
      sendResponse({ ok: false, error: err.message });
    });

  return true;
});

log.info("content script ready", { url: location.href });

/**
 * Hard rule: the executor is the ONLY layer that may mutate page UI for RPA plans.
 * `navigate-bridge` only injects a MAIN-realm event (same trusted pattern as schedule
 * state injection) and does not execute planner output.
 */
void ({} as { _enforce?: DomAction });

initMicRecorder();
