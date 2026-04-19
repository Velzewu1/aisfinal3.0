/**
 * CarePlan preview renderer for the schedule page.
 *
 * Architectural contract:
 *   - Displays the DECISION layer (assigned treatment courses).
 *   - Is INDEPENDENT of the calendar (execution layer) — never reads
 *     `window.__SCHEDULE_STATE__`, never inspects grid cells.
 *   - Only renders from the plans array passed to `renderCarePlan(plans)`
 *     (canonical) or from `window.__CARE_PLAN__` as a fallback.
 *   - The "Сформировать расписание" button dispatches a page-level
 *     `ai-rpa-build-schedule` CustomEvent; the content-script bridge
 *     relays it to the controller. The page NEVER calls the scheduler
 *     directly.
 *
 * Reactivity contract:
 *   The controller broadcasts a fresh snapshot on every CarePlan state
 *   change (create / confirm / schedule-commit). That message traverses
 *   content-script → `ai-rpa-care-plan-state` CustomEvent → bridge →
 *   `window.__CARE_PLAN__` = plans + `window` dispatch of
 *   `care_plan_updated` (detail.plans). This renderer subscribes to
 *   `care_plan_updated` and calls `renderCarePlan(detail.plans)`, which
 *   fully clears and rebuilds the `#care-plan-list` container.
 *
 *   Status flip ("не запланировано" → "запланировано") is driven by an
 *   explicit state update from the controller (push via bridge), NOT by
 *   DOM parsing of schedule cells.
 */
(function () {
  "use strict";

  var BLOCK_ID = "care-plan-block";
  var LIST_ID = "care-plan-list";
  var BUILD_BUTTON_ID = "care-plan-build-schedule";

  /** internal service id → human-readable UI label */
  var SERVICE_LABELS = {
    speech_therapy: "Логопед",
    psychologist: "Психолог",
    massage: "Массаж",
    lfk: "ЛФК",
    physio: "Физиотерапия"
  };

  /**
   * Map CarePlan lifecycle status → user-facing label.
   *   draft / confirmed              → "не запланировано"
   *   scheduled / active / completed → "запланировано"
   */
  function statusLabel(status) {
    if (status === "scheduled" || status === "active" || status === "completed") {
      return "запланировано";
    }
    return "не запланировано";
  }

  function serviceLabel(service) {
    if (typeof service !== "string") return "Назначение";
    if (SERVICE_LABELS[service]) return SERVICE_LABELS[service];
    return service
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, function (c) {
        return c.toUpperCase();
      });
  }

  /**
   * Normalizes and defensively validates a raw plans list from any
   * source (event detail, global, or argument). Returns a plain array
   * of `{ service, sessionsCount, status }` — never null.
   */
  function normalizePlans(raw) {
    if (!Array.isArray(raw)) return [];
    var out = [];
    for (var i = 0; i < raw.length; i += 1) {
      var p = raw[i];
      if (!p || typeof p !== "object") continue;
      var service = typeof p.service === "string" ? p.service : "";
      var sessions = typeof p.sessionsCount === "number" && isFinite(p.sessionsCount)
        ? Math.max(1, Math.round(p.sessionsCount))
        : 1;
      var status = typeof p.status === "string" ? p.status : "draft";
      if (service.length === 0) continue;
      out.push({ service: service, sessionsCount: sessions, status: status });
    }
    return out;
  }

  function renderEmpty(listEl) {
    var empty = document.createElement("div");
    empty.className = "care-plan-empty";
    empty.textContent = "Нет назначений";
    listEl.appendChild(empty);
  }

  function renderItem(plan) {
    var item = document.createElement("div");
    item.className = "care-plan-item";
    item.setAttribute("data-care-plan-status", plan.status);

    var title = document.createElement("div");
    title.className = "care-plan-item-service";
    title.textContent = serviceLabel(plan.service);

    var sessions = document.createElement("div");
    sessions.className = "care-plan-item-sessions";
    sessions.textContent = plan.sessionsCount + " " + pluralizeSessions(plan.sessionsCount);

    var status = document.createElement("div");
    status.className = "care-plan-item-status";
    var label = statusLabel(plan.status);
    status.setAttribute("data-status-label", label);
    status.textContent = "Статус: " + label;

    item.appendChild(title);
    item.appendChild(sessions);
    item.appendChild(status);
    return item;
  }

  function pluralizeSessions(n) {
    var mod10 = n % 10;
    var mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return "занятие";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "занятия";
    return "занятий";
  }

  /**
   * Canonical entry point: clears and fully rebuilds the CarePlan list.
   * Accepts an optional plans array; when omitted, falls back to the
   * latest page-level snapshot at `window.__CARE_PLAN__`.
   *
   *   renderCarePlan([])            → "Нет назначений"
   *   renderCarePlan(undefined)     → reads window.__CARE_PLAN__
   *   renderCarePlan(plans)         → rebuild from plans
   *
   * Exposed on `window` so other page modules (and the bridge listener)
   * can invoke it directly without relying on implicit globals.
   */
  function renderCarePlan(plans) {
    var listEl = document.getElementById(LIST_ID);
    var buildBtn = document.getElementById(BUILD_BUTTON_ID);
    if (!listEl) return;

    var source = plans === undefined ? window.__CARE_PLAN__ : plans;
    var normalized = normalizePlans(source);

    // Keep the page-level snapshot in sync when called with explicit
    // plans — other modules may read __CARE_PLAN__ directly.
    if (plans !== undefined) {
      window.__CARE_PLAN__ = normalized;
    }

    listEl.replaceChildren();

    if (normalized.length === 0) {
      renderEmpty(listEl);
      if (buildBtn) buildBtn.setAttribute("disabled", "");
      return;
    }

    normalized.forEach(function (plan) {
      listEl.appendChild(renderItem(plan));
    });

    // Button is only meaningful when at least one plan is not yet
    // scheduled — otherwise the scheduler has nothing left to do.
    var hasUnscheduled = normalized.some(function (p) {
      return statusLabel(p.status) === "не запланировано";
    });
    if (buildBtn) {
      if (hasUnscheduled) {
        buildBtn.removeAttribute("disabled");
      } else {
        buildBtn.setAttribute("disabled", "");
      }
    }
  }

  function onCarePlanUpdated(event) {
    var detailPlans =
      event && event.detail && Array.isArray(event.detail.plans)
        ? event.detail.plans
        : undefined;
    renderCarePlan(detailPlans);
  }

  function onBuildClick(ev) {
    ev.preventDefault();
    try {
      document.documentElement.dispatchEvent(
        new CustomEvent("ai-rpa-build-schedule", { bubbles: true })
      );
    } catch (err) {
      console.error("[care-plan] build-schedule dispatch failed", err);
    }
  }

  function requestStateFromExtension() {
    // Page-init request: the content-script bridge relays this to the
    // controller, which replies by pushing the latest snapshot.
    try {
      document.documentElement.dispatchEvent(
        new CustomEvent("ai-rpa-care-plan-request", { bubbles: true })
      );
    } catch (err) {
      console.error("[care-plan] state request dispatch failed", err);
    }
  }

  function init() {
    var block = document.getElementById(BLOCK_ID);
    if (!block) return;

    var buildBtn = document.getElementById(BUILD_BUTTON_ID);
    if (buildBtn) buildBtn.addEventListener("click", onBuildClick);

    // Canonical reactivity channel — fired by schedule-bridge-listener
    // whenever the controller broadcasts a new snapshot.
    window.addEventListener("care_plan_updated", onCarePlanUpdated);

    // Initial paint from whatever snapshot is already on the page, then
    // ask the controller for the authoritative state.
    renderCarePlan();
    requestStateFromExtension();
  }

  // Expose canonical entry point for other page modules / tests.
  window.renderCarePlan = renderCarePlan;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
