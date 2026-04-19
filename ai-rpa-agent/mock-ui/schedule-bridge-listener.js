/**
 * Page-context bridge: receives DOM CustomEvents from the extension content script
 * (isolated world) and updates window.__SCHEDULE_STATE__ in the main world.
 * Avoids inline script injection (CSP-safe for MV3).
 */
(function () {
  "use strict";

  var root = document.documentElement;

  root.addEventListener(
    "ai-rpa-schedule-state",
    function (e) {
      if (!e || !e.detail) return;
      try {
        if (e.detail.state !== undefined) {
          window.__SCHEDULE_STATE__ = e.detail.state;
        }
        window.dispatchEvent(
          new CustomEvent("schedule_updated", {
            bubbles: true,
            detail: {
              state: window.__SCHEDULE_STATE__,
              source: (e.detail && e.detail.source) || "bridge",
            },
          }),
        );
      } catch (err) {
        console.error("[ai-rpa] schedule bridge listener failed", err);
        try {
          window.dispatchEvent(
            new CustomEvent("schedule_updated", {
              bubbles: true,
              detail: { source: "bridge_runtime_error", state: null },
            }),
          );
        } catch (e2) {
          console.error("[ai-rpa] schedule bridge recovery event failed", e2);
        }
      }
    },
    false,
  );

  root.addEventListener(
    "ai-rpa-navigate-to-schedule",
    function () {
      try {
        window.dispatchEvent(new CustomEvent("navigate_to_schedule"));
      } catch (err) {
        console.error("[ai-rpa] navigate_to_schedule dispatch failed", err);
      }
    },
    false,
  );

  /**
   * CarePlan preview bridge: content script (isolated world) dispatches
   * `ai-rpa-care-plan-state` with { plans } → page main world updates
   * `window.__CARE_PLAN__` and fires `care_plan_updated` so the renderer
   * can re-draw the assignments block without DOM parsing.
   *
   * CarePlan state is INTENTIONALLY separate from __SCHEDULE_STATE__:
   * clinical decisions (data layer) must not be conflated with
   * scheduled slots (execution layer).
   */
  root.addEventListener(
    "ai-rpa-care-plan-state",
    function (e) {
      if (!e || !e.detail) return;
      try {
        var plans = Array.isArray(e.detail.plans) ? e.detail.plans : [];
        window.__CARE_PLAN__ = plans;
        window.dispatchEvent(
          new CustomEvent("care_plan_updated", {
            bubbles: true,
            detail: { plans: plans },
          }),
        );
      } catch (err) {
        console.error("[ai-rpa] care_plan bridge listener failed", err);
      }
    },
    false,
  );
})();
