/**
 * Schedule mock UI: assignments list + grid painted from `window.__SCHEDULE_STATE__`.
 *
 * Day convention (aligned with backend / executor / inject payload `time`):
 * - INTERNAL horizon day: 0..8 (first column "День 1" → 0).
 * - DOM: `data-day-index` = internal day; `data-day` = internal day + 1 (1..9).
 * Slot / bridge `time` format: "{internalDay}:{startMinute}-{endMinute}".
 *
 * Grid: column `data-day-index` = internal day; row = `data-specialist` (doctorId), with
 * fallback to `data-doctor-label` when id does not match. Multiple procedures for the same
 * doctor/day stack in one cell.
 *
 * Does not call an LLM; only reads validated bridge state / `data-schedule-payload`.
 * Procedure labels/colors: `schedule-ui-map.js` → `window.__SCHEDULE_UI_MAPS__`.
 *
 * Assignment normalization (`normalizeScheduleAssignment`): accepts backend rows
 * `doctorId`/`procedureId`/`day`/`startMinute`/`endMinute`, inject `slots` with `time`,
 * or compact `{ doctor, procedure, time: "day:start-end" }` → unified render model with
 * `dayIndex`, minutes, `doctorLabel`, `procedureLabel`. Debug: `window.__SCHEDULE_ASSIGNMENT_NORMALIZE__`.
 */
(function () {
  "use strict";

  var GRID_SELECTOR = '[data-schedule-grid="primary"]';
  var CONTAINER_SELECTOR = "[data-schedule-assignments]";
  var OPEN_BUTTON_SELECTOR = '[data-action="schedule-open"]';
  var PAYLOAD_ATTR = "data-schedule-payload";

  /** Base procedure id → Russian label (instance ids are `lfk_d3`, etc.). */
  var PROCEDURE_DISPLAY_NAMES = {
    lfk: "Лечебная физкультура",
    massage: "Массаж лечебный",
    psychology: "Консультация психолога",
    speech: "Логопедия",
    physio: "Физиотерапия"
  };

  var KIND_FALLBACK_PATTERNS = [
    [/(лфк|exercise[_-]?therapy|lfk|kineso|kinezo)/i, "lfk"],
    [/(массаж|massage)/i, "massage"],
    [/(психолог|psycholog|psychologist)/i, "psychologist"],
    [/(логопед|speech|logoped)/i, "speech"]
  ];

  function resolveKindFallback(doctorId, procedureId) {
    var probe = String(doctorId) + " " + String(procedureId);
    for (var i = 0; i < KIND_FALLBACK_PATTERNS.length; i += 1) {
      if (KIND_FALLBACK_PATTERNS[i][0].test(probe)) return KIND_FALLBACK_PATTERNS[i][1];
    }
    return "default";
  }

  /**
   * @param {{ dayIndex?: number|null, startMinute?: number|null, endMinute?: number|null }} [ctx]
   * @returns {{ label: string, dataSlotKind: string, inline: { background: string, border: string } | null }}
   */
  function resolveProcedureVisual(procedureId, doctorId, ctx) {
    var maps = typeof window !== "undefined" ? window.__SCHEDULE_UI_MAPS__ : null;
    if (maps && typeof maps.resolveProcedureUi === "function") {
      return maps.resolveProcedureUi(procedureId, doctorId, ctx || {});
    }
    return {
      label: humanizeProcedureId(procedureId),
      dataSlotKind: resolveKindFallback(doctorId, procedureId),
      inline: null
    };
  }

  function resolveDoctorVisual(doctorId) {
    var maps = typeof window !== "undefined" ? window.__SCHEDULE_UI_MAPS__ : null;
    if (maps && typeof maps.resolveDoctorLabel === "function") {
      return maps.resolveDoctorLabel(doctorId);
    }
    return humanizeProcedureId(doctorId);
  }

  /** Strip solver instance suffix `*_dN` / `*_dayN` for display / map lookup. */
  function canonicalProcedureIdForDisplay(procedureId) {
    return String(procedureId).replace(/_d\d+$|_day\d+$/g, "");
  }

  function humanizeProcedureId(procedureId) {
    var stripped = canonicalProcedureIdForDisplay(procedureId).replace(/^(proc|procedure)[_-]/i, "");
    var spaced = stripped.replace(/[_-]+/g, " ").trim();
    if (spaced.length === 0) return String(procedureId);
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }

  /**
   * @param {number} minutes minutes since midnight (0..1440)
   * @returns {string} "HH:MM"
   */
  function minutesToTime(minutes) {
    if (typeof minutes !== "number" || !isFinite(minutes)) return "—";
    var h = Math.floor(minutes / 60);
    var m = Math.round(minutes % 60);
    var hs = String(h).padStart(2, "0");
    var ms = String(m).padStart(2, "0");
    return hs + ":" + ms;
  }

  function escapeCss(val) {
    var s = String(val);
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(s);
    }
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  /**
   * Column: `data-day-index` matches solver dayIndex (0-based).
   * Row: `data-specialist` matches payload / backend doctorId (same as executor).
   */
  function findCellByDayIndexAndDoctorId(host, dayIndex, doctorId) {
    var id = String(doctorId).trim();
    if (id.length === 0) return null;
    return host.querySelector(
      '[data-schedule-cell][data-day-index="' +
        escapeCss(String(dayIndex)) +
        '"][data-specialist="' +
        escapeCss(id) +
        '"]'
    );
  }

  /**
   * Column: `data-day-index` matches solver dayIndex (0-based).
   * Row: `data-doctor-label` matches row header display name (legacy / fallback).
   */
  function findCellByDayIndexAndDoctorLabel(host, dayIndex, doctorLabel) {
    var label = String(doctorLabel).trim();
    if (label.length === 0) return null;
    return host.querySelector(
      '[data-schedule-cell][data-day-index="' +
        escapeCss(String(dayIndex)) +
        '"][data-doctor-label="' +
        escapeCss(label) +
        '"]'
    );
  }

  /**
   * Prefer stable id match (`data-specialist`); only then label match (`data-doctor-label`).
   */
  function findCellForScheduleAssignment(host, dayIndex, doctorId, doctorLabel) {
    var byId = findCellByDayIndexAndDoctorId(host, dayIndex, doctorId);
    if (byId) return byId;
    return findCellByDayIndexAndDoctorLabel(host, dayIndex, doctorLabel);
  }

  function resetAllCells(host) {
    var emptyLabel = host.getAttribute("data-schedule-empty-label") || "Свободно";
    host.querySelectorAll("[data-schedule-cell]").forEach(function (cell) {
      cell.classList.remove("occupied");
      cell.removeAttribute("data-slot-kind");
      cell.style.backgroundColor = "";
      cell.style.borderLeft = "";
      cell.setAttribute("data-filled", "false");
      var def =
        cell.getAttribute("data-specialist-kind-default") ||
        cell.getAttribute("data-specialist-kind") ||
        "default";
      cell.setAttribute("data-specialist-kind", def);
      cell.textContent = emptyLabel;
    });
  }

  /**
   * Parse `time` like "0:540-570" → internal horizon day (0..8), startMinute, endMinute.
   */
  function parseScheduleTimeString(raw) {
    if (typeof raw !== "string") return null;
    var match = /^\s*(-?\d+)\s*:\s*(\d+)\s*-\s*(\d+)\s*$/.exec(raw);
    if (!match) return null;
    var dayIndex = Number(match[1]);
    var startMinute = Number(match[2]);
    var endMinute = Number(match[3]);
    if (!isFinite(dayIndex) || !isFinite(startMinute) || !isFinite(endMinute)) return null;
    return { dayIndex: dayIndex, startMinute: startMinute, endMinute: endMinute };
  }

  /**
   * Canonical render model after normalization.
   * Accepts legacy backend rows, inject payload slots, or `{ doctor, procedure, time }`.
   *
   * @returns {{
   *   doctorId: string,
   *   procedureId: string,
   *   doctorLabel: string,
   *   procedureLabel: string,
   *   procedureUi: ReturnType<typeof resolveProcedureVisual>,
   *   dayIndex: number (internal horizon day 0..8, equals data-day-index),
   *   startMinute: number | null,
   *   endMinute: number | null
   * } | null}
   */
  function normalizeScheduleAssignment(raw) {
    if (!raw || typeof raw !== "object") return null;
    var doctorId = stringOrEmpty(raw.doctorId != null ? raw.doctorId : raw.doctor);
    var procedureId = stringOrEmpty(raw.procedureId != null ? raw.procedureId : raw.procedure);
    var procedureNameFromPayload =
      typeof raw.procedureName === "string" && raw.procedureName.trim().length > 0
        ? raw.procedureName.trim()
        : "";

    var dayIndex = null;
    var startMinute = null;
    var endMinute = null;

    if (typeof raw.time === "string" && raw.time.trim().length > 0) {
      var parsed = parseScheduleTimeString(raw.time);
      if (parsed) {
        dayIndex = parsed.dayIndex;
        startMinute = parsed.startMinute;
        endMinute = parsed.endMinute;
      }
    }
    if (dayIndex === null) {
      var d =
        raw.dayIndex !== undefined && raw.dayIndex !== null ? Number(raw.dayIndex) : Number(raw.day);
      dayIndex = isFinite(d) ? d : null;
    }
    if (startMinute === null) startMinute = toFiniteNumber(raw.startMinute);
    if (endMinute === null) endMinute = toFiniteNumber(raw.endMinute);

    if (dayIndex === null || !isFinite(dayIndex) || doctorId.length === 0) return null;

    var baseId = canonicalProcedureIdForDisplay(procedureId);
    var procedureLabel = procedureNameFromPayload;
    if (procedureLabel.length === 0) {
      procedureLabel = PROCEDURE_DISPLAY_NAMES[baseId] || "";
    }
    var procedureUi = resolveProcedureVisual(procedureId, doctorId, {
      dayIndex: dayIndex,
      startMinute: startMinute,
      endMinute: endMinute
    });
    if (procedureLabel.length === 0) {
      procedureLabel = procedureUi.label;
    }
    return {
      doctorId: doctorId,
      procedureId: procedureId,
      doctorLabel: resolveDoctorVisual(doctorId),
      procedureLabel: procedureLabel,
      procedureUi: procedureUi,
      dayIndex: dayIndex,
      startMinute: startMinute,
      endMinute: endMinute
    };
  }

  /**
   * Raw rows from payload (before per-row normalize).
   */
  function extractRawAssignmentsFromPayload(payload) {
    if (!payload || typeof payload !== "object") return [];

    if (Array.isArray(payload.assignments)) {
      return payload.assignments.slice();
    }

    if (Array.isArray(payload.slots)) {
      return payload.slots.map(function (s) {
        if (!s || typeof s !== "object") return {};
        return {
          doctorId: stringOrEmpty(s.doctorId),
          procedureId: stringOrEmpty(s.procedureId),
          procedureName: typeof s.procedureName === "string" ? s.procedureName : "",
          time: typeof s.time === "string" ? s.time : ""
        };
      });
    }

    return [];
  }

  function stringOrEmpty(v) {
    return typeof v === "string" ? v : "";
  }

  function toFiniteNumber(v) {
    return typeof v === "number" && isFinite(v) ? v : null;
  }

  /** Time-of-day only (no day index); uses normalized start/end minutes. */
  function formatTime(a) {
    if (a.startMinute === null || a.endMinute === null) {
      return "—";
    }
    return minutesToTime(a.startMinute) + "–" + minutesToTime(a.endMinute);
  }

  function sortAssignments(list) {
    return list.slice().sort(function (a, b) {
      var da = typeof a.dayIndex === "number" && isFinite(a.dayIndex) ? a.dayIndex : Number.POSITIVE_INFINITY;
      var db = typeof b.dayIndex === "number" && isFinite(b.dayIndex) ? b.dayIndex : Number.POSITIVE_INFINITY;
      if (da !== db) return da - db;
      var sa = a.startMinute === null ? Number.POSITIVE_INFINITY : a.startMinute;
      var sb = b.startMinute === null ? Number.POSITIVE_INFINITY : b.startMinute;
      if (sa !== sb) return sa - sb;
      return a.doctorId.localeCompare(b.doctorId);
    });
  }

  function getAssignmentsForUi() {
    var raws = [];
    var st = window.__SCHEDULE_STATE__;
    if (st && st.status === "generated" && Array.isArray(st.assignments)) {
      raws = st.assignments;
    } else {
      var grid = document.querySelector(GRID_SELECTOR);
      if (!grid) return [];
      var attr = grid.getAttribute(PAYLOAD_ATTR);
      if (attr === null || attr.length === 0) return [];
      try {
        raws = extractRawAssignmentsFromPayload(JSON.parse(attr));
      } catch (e) {
        return [];
      }
    }
    return raws.map(normalizeScheduleAssignment).filter(Boolean);
  }

  function renderScheduleGridFromState(host, assignments) {
    resetAllCells(host);
    if (!assignments || assignments.length === 0) return;

    var buckets = new Map();
    assignments.forEach(function (a) {
      if (typeof a.dayIndex !== "number" || !isFinite(a.dayIndex)) return;
      var did = String(a.doctorId || "").trim();
      if (did.length === 0) return;
      var key = did + "\0" + String(a.dayIndex);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(a);
    });

    buckets.forEach(function (items, key) {
      items.sort(function (x, y) {
        var ax = x.startMinute !== null ? x.startMinute : 0;
        var ay = y.startMinute !== null ? y.startMinute : 0;
        return ax - ay;
      });
      var sep = key.indexOf("\0");
      var doctorId = key.slice(0, sep);
      var dayIndex = Number(key.slice(sep + 1));
      var doctorLabel = items[0] ? String(items[0].doctorLabel || "").trim() : "";
      var cell = findCellForScheduleAssignment(host, dayIndex, doctorId, doctorLabel);
      if (!cell) return;

      cell.setAttribute("data-filled", "true");
      cell.classList.add("occupied");

      var dominantUi =
        items[0].procedureUi ||
        resolveProcedureVisual(items[0].procedureId, items[0].doctorId, {
          dayIndex: items[0].dayIndex,
          startMinute: items[0].startMinute,
          endMinute: items[0].endMinute
        });
      var slotKind = dominantUi.dataSlotKind;
      cell.setAttribute("data-slot-kind", slotKind);
      var domKind = slotKind === "custom" ? "default" : slotKind;
      cell.setAttribute("data-specialist-kind", domKind);

      if (slotKind === "custom" && dominantUi.inline) {
        cell.style.backgroundColor = dominantUi.inline.background;
        cell.style.borderLeft = "3px solid " + dominantUi.inline.border;
      }

      var lines = items.map(function (a) {
        var lab = a.procedureLabel || a.procedureId;
        var range = formatTime(a);
        return range + " · " + lab;
      }).filter(Boolean);
      cell.textContent = lines.length > 0 ? lines.join(" · ") : "—";
    });
  }

  function renderTable(container, assignments) {
    container.replaceChildren();

    var title = document.createElement("div");
    title.className = "sched-assign-title";
    title.textContent = "Список назначений";

    var count = document.createElement("span");
    count.className = "sched-assign-count";
    count.textContent = String(assignments.length);
    title.appendChild(count);
    container.appendChild(title);

    if (assignments.length === 0) {
      var empty = document.createElement("div");
      empty.className = "sched-assign-empty";
      empty.textContent = "Нет назначений — ожидание генерации расписания.";
      container.appendChild(empty);
      return;
    }

    var table = document.createElement("table");
    table.className = "sched-assign-table";

    var thead = document.createElement("thead");
    var headerRow = document.createElement("tr");
    ["Процедура", "Специалист", "Время"].forEach(function (label) {
      var th = document.createElement("th");
      th.textContent = label;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    var tbody = document.createElement("tbody");
    sortAssignments(assignments).forEach(function (a) {
      var tr = document.createElement("tr");
      tr.setAttribute("data-assignment-row", "");
      tr.setAttribute("data-doctor", a.doctorId);
      tr.setAttribute("data-procedure", a.procedureId);

      var procCell = document.createElement("td");
      procCell.textContent = a.procedureLabel || a.procedureId || "—";
      tr.appendChild(procCell);

      var doctorCell = document.createElement("td");
      doctorCell.textContent = a.doctorLabel;
      tr.appendChild(doctorCell);

      var timeCell = document.createElement("td");
      timeCell.className = "sched-assign-time";
      timeCell.textContent = formatTime(a);
      tr.appendChild(timeCell);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  }

  function updateOpenButton(btn, enabled) {
    if (!btn) return;
    if (enabled) {
      btn.removeAttribute("disabled");
      btn.setAttribute("aria-disabled", "false");
      btn.setAttribute("title", "Прокрутить к расписанию");
    } else {
      btn.setAttribute("disabled", "");
      btn.setAttribute("aria-disabled", "true");
      btn.setAttribute("title", "Появится после генерации расписания");
    }
  }

  /**
   * Single behavior for "open schedule" / focus grid (toolbar + extension sidepanel via injected event).
   */
  function focusScheduleGrid() {
    var grid = document.querySelector(GRID_SELECTOR);
    scrollToGrid(grid);
  }

  function scrollToGrid(grid) {
    if (!grid) return;
    if (typeof grid.scrollIntoView === "function") {
      grid.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    try {
      grid.setAttribute("data-schedule-flash", String(Date.now()));
      window.setTimeout(function () {
        grid.removeAttribute("data-schedule-flash");
      }, 900);
    } catch (e) {
      /* visual nudge */
    }
  }

  function syncAll() {
    var grid = document.querySelector(GRID_SELECTOR);
    var container = document.querySelector(CONTAINER_SELECTOR);
    var openBtn = document.querySelector(OPEN_BUTTON_SELECTOR);
    if (!grid || !container) return;

    var assignments = getAssignmentsForUi();
    renderScheduleGridFromState(grid, assignments);
    renderTable(container, assignments);
    updateOpenButton(openBtn, assignments.length > 0);
  }

  /** Debug: every full render pass should be traceable (MutationObserver + schedule_updated + init). */
  function onRenderTrigger(source) {
    console.debug("[schedule-renderer] render trigger received", { source: source });
    syncAll();
  }

  function init() {
    var grid = document.querySelector(GRID_SELECTOR);
    if (!grid) return;
    var openBtn = document.querySelector(OPEN_BUTTON_SELECTOR);

    if (openBtn) {
      openBtn.addEventListener("click", function (ev) {
        if (openBtn.hasAttribute("disabled")) {
          ev.preventDefault();
          return;
        }
        window.dispatchEvent(new CustomEvent("navigate_to_schedule"));
      });
    }

    window.addEventListener("navigate_to_schedule", function () {
      focusScheduleGrid();
    });

    window.addEventListener("schedule_updated", function () {
      onRenderTrigger("window.schedule_updated");
    });

    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i += 1) {
        var m = mutations[i];
        if (m.type === "attributes" && m.attributeName === PAYLOAD_ATTR) {
          onRenderTrigger("MutationObserver:" + PAYLOAD_ATTR);
          return;
        }
      }
    });
    observer.observe(grid, {
      attributes: true,
      attributeFilter: [PAYLOAD_ATTR]
    });

    onRenderTrigger("init:first-paint");
    requestAnimationFrame(function () {
      onRenderTrigger("init:requestAnimationFrame");
    });
  }

  if (typeof window !== "undefined") {
    window.__SCHEDULE_ASSIGNMENT_NORMALIZE__ = {
      normalizeScheduleAssignment: normalizeScheduleAssignment,
      parseScheduleTimeString: parseScheduleTimeString,
      findCellByDayIndexAndDoctorId: findCellByDayIndexAndDoctorId,
      findCellByDayIndexAndDoctorLabel: findCellByDayIndexAndDoctorLabel,
      findCellForScheduleAssignment: findCellForScheduleAssignment
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
