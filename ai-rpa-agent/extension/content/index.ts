import type { DomAction, ExecutorResult } from "@ai-rpa/schemas";
import { createLogger } from "../shared/logger.js";
import { isExtensionMessage } from "../shared/messages.js";
import { executor } from "./executor.js";
import { initMicRecorder } from "./recorder.js";

const log = createLogger("content");

chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  if (!isExtensionMessage(msg)) return false;
  if (msg.type !== "execute_plan") return false;

  const { correlationId, actions } = msg;
  log.info("execute_plan received", { count: actions.length }, correlationId);

  void executor.run(actions, correlationId).then((result: ExecutorResult) => {
    chrome.runtime
      .sendMessage({ type: "executor_finished", correlationId, result })
      .catch((err: unknown) => log.error("reply failed", String(err), correlationId));
    sendResponse({ ok: true, result });
  });

  return true;
});

log.info("content script ready", { url: location.href });

/**
 * Hard rule: the executor is the ONLY layer that may touch the DOM.
 * Nothing else in this file, or anywhere else in the extension, should
 * call document.*, Element.prototype.*, or similar mutators.
 */
void ({} as { _enforce?: DomAction });

initMicRecorder();
