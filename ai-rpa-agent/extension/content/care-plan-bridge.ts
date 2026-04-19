import { createLogger } from "../shared/logger.js";
import { newCorrelationId } from "../shared/correlation.js";
import type { CarePlanPreview } from "../shared/messages.js";

const log = createLogger("care-plan-bridge");

/**
 * CarePlan page-bridge. Mirrors `schedule-bridge`: content script (isolated
 * world) ↔ page main world via DOM CustomEvents on `document.documentElement`.
 * CSP-safe — no inline scripts, no `script.textContent` injection.
 *
 * Direction summary:
 *   extension → page   `ai-rpa-care-plan-state`   (push CarePlan preview rows)
 *   page      → extension `ai-rpa-care-plan-request` (page asks for latest state)
 *   page      → extension `ai-rpa-build-schedule`    (user clicked the build button)
 *
 * The bridge NEVER mutates DOM directly. The page's own renderer
 * (`mock-ui/care-plan-renderer.js`) owns presentation.
 */

/** Publishes a CarePlan preview array to the page's main world. */
export function publishCarePlanStateToPage(plans: ReadonlyArray<CarePlanPreview>): void {
  try {
    document.documentElement.dispatchEvent(
      new CustomEvent("ai-rpa-care-plan-state", {
        bubbles: true,
        detail: { plans },
      }),
    );
  } catch (err: unknown) {
    log.warn("care_plan state dispatch failed", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Initializes the page→extension listeners:
 *   - `ai-rpa-care-plan-request` — the page (schedule-page renderer) asks
 *     the controller for the current CarePlan snapshot. We relay via
 *     `chrome.runtime.sendMessage`; the router responds by pushing
 *     `care_plan_state` back to this content script.
 *   - `ai-rpa-build-schedule` — the page button dispatches this event.
 *     We relay it as a `build_schedule_from_plans` runtime message.
 *     The controller is the sole authority over scheduling; this bridge
 *     only forwards user intent.
 */
export function initCarePlanBridge(): void {
  document.documentElement.addEventListener(
    "ai-rpa-care-plan-request",
    () => {
      const correlationId = newCorrelationId();
      chrome.runtime
        .sendMessage({ type: "care_plan_state_request", correlationId })
        .catch((err: unknown) => {
          log.warn("care_plan_state_request send failed", String(err), correlationId);
        });
    },
    false,
  );

  document.documentElement.addEventListener(
    "ai-rpa-build-schedule",
    () => {
      const correlationId = newCorrelationId();
      log.info("build_schedule_button_clicked", undefined, correlationId);
      chrome.runtime
        .sendMessage({ type: "build_schedule_from_plans", correlationId })
        .catch((err: unknown) => {
          log.warn("build_schedule_from_plans send failed", String(err), correlationId);
        });
    },
    false,
  );
}
