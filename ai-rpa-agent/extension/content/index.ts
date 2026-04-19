import type { DomAction, ExecutorResult } from "@ai-rpa/schemas";
import { createLogger } from "../shared/logger.js";
import { isExtensionMessage } from "../shared/messages.js";
import { executor } from "./executor.js";
import { extractCurrentPageContext } from "./page-context-extractor.js";
import { injectNavigateToScheduleEvent } from "./navigate-bridge.js";
import { initCarePlanBridge, publishCarePlanStateToPage } from "./care-plan-bridge.js";
import { initMicRecorder } from "./recorder.js";

const log = createLogger("content");

function isNavigateToScheduleMessage(msg: unknown): msg is { type: "navigate_to_schedule" } {
  return typeof msg === "object" && msg !== null && (msg as { type?: unknown }).type === "navigate_to_schedule";
}

function isExtractPageContextMessage(msg: unknown): msg is { type: "extract_page_context" } {
  return typeof msg === "object" && msg !== null && (msg as { type?: unknown }).type === "extract_page_context";
}

chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  // ── Read-only: current-page context extraction (dual role) ──────────
  if (isExtractPageContextMessage(msg)) {
    try {
      const context = extractCurrentPageContext();
      sendResponse({ ok: true, context });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn("extract_page_context failed", { error: message });
      sendResponse({ ok: false, error: message });
    }
    return true;
  }

  if (isNavigateToScheduleMessage(msg)) {
    injectNavigateToScheduleEvent();
    sendResponse({ ok: true });
    return true;
  }
  if (!isExtensionMessage(msg)) return false;

  // ── Read-only data bridge: CarePlan preview rows → page main world ──
  if (msg.type === "care_plan_state") {
    publishCarePlanStateToPage(msg.plans);
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type !== "execute_plan") return false;

  // ── Write: deterministic DOM execution ──────────────────────────────
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
initCarePlanBridge();
