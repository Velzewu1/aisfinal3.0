/**
 * Builds the schedule grid markup (page context). Loaded via src= for CSP compliance.
 */
(function () {
  "use strict";

  var DAYS = 9;
  var SPECIALISTS = [
    { id: "lkf_1", name: "Инструктор ЛФК", role: "ЛФК", kind: "lfk" },
    { id: "massage_1", name: "Массажист", role: "Массаж", kind: "massage" },
    { id: "psych_1", name: "Психолог", role: "Психология", kind: "psychologist" },
    { id: "speech_1", name: "Логопед", role: "Логопедия", kind: "speech" },
    { id: "physio_1", name: "Физиотерапевт", role: "Физиотерапия", kind: "default" }
  ];

  function formatShortDate(d) {
    try {
      return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
    } catch (e) {
      var dd = String(d.getDate()).padStart(2, "0");
      var mm = String(d.getMonth() + 1).padStart(2, "0");
      return dd + "." + mm;
    }
  }

  function renderDateHeaders() {
    var today = new Date();
    var headers = document.querySelectorAll("[data-day-header]");
    headers.forEach(function (th) {
      var offset = parseInt(th.getAttribute("data-day-header"), 10) - 1;
      if (isNaN(offset)) return;
      var d = new Date(today);
      d.setDate(today.getDate() + offset);
      var dateEl = th.querySelector(".dh-date");
      if (dateEl) dateEl.textContent = formatShortDate(d);
    });
  }

  /** day: 1..9 display column; internal horizon index = day - 1 (= data-day-index). */
  function buildCell(day, spec) {
    var td = document.createElement("td");
    td.setAttribute("data-schedule-cell", "");
    td.setAttribute("data-day", String(day));
    td.setAttribute("data-day-index", String(day - 1));
    td.setAttribute("data-doctor-label", spec.name);
    td.setAttribute("data-specialist", spec.id);
    td.setAttribute("data-specialist-kind", spec.kind);
    td.setAttribute("data-filled", "false");
    td.textContent = "Свободно";
    return td;
  }

  function renderBody() {
    var tbody = document.querySelector("[data-schedule-body]");
    if (!tbody) return;
    tbody.replaceChildren();
    SPECIALISTS.forEach(function (spec) {
      var tr = document.createElement("tr");
      var label = document.createElement("td");
      label.className = "spec-cell";
      label.setAttribute("data-specialist-row", spec.id);
      var nameEl = document.createElement("span");
      nameEl.className = "spec-name";
      nameEl.textContent = spec.name;
      var roleEl = document.createElement("span");
      roleEl.className = "spec-role";
      roleEl.textContent = spec.role;
      label.appendChild(nameEl);
      label.appendChild(roleEl);
      tr.appendChild(label);
      for (var d = 1; d <= DAYS; d += 1) {
        tr.appendChild(buildCell(d, spec));
      }
      tbody.appendChild(tr);
    });
  }

  function onScheduleInjected() {
    var meta = document.getElementById("schedMeta");
    if (meta) meta.classList.add("has-payload");
  }

  document.addEventListener("DOMContentLoaded", function () {
    renderDateHeaders();
    renderBody();
    var host = document.querySelector('[data-schedule-grid="primary"]');
    if (host) {
      host.addEventListener("schedule-injected", onScheduleInjected);
    }
  });
})();
